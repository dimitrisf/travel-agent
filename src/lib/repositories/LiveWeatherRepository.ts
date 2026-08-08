import { sleep } from '@/utils/sleep';
import type {
  CurrentWeatherRow,
  ForecastDayRow,
  ForecastRow,
  WeatherRepository,
} from './WeatherRepository';

// Live adapter for OpenWeatherMap (Stage 20). Same interface as
// SeededWeatherRepository — WeatherService doesn't know or care which
// one it's holding. Selection happens in createWeatherService based on
// the USE_SEEDED_WEATHER env var.
//
// Design notes:
//
//   - Hardcoded city → lookup mapping. OpenWeatherMap's `q=` parameter
//     accepts city names, but "Berlin" alone can resolve to Berlin, DE
//     or Berlin, US. Passing `q=Berlin,DE` is unambiguous. The demo
//     library only covers five cities so a hardcoded map is fine; a
//     production version would use OpenWeatherMap's Geocoding API to
//     resolve city → lat/lon first.
//     Shape uses `Record<string, CityKey>` with an optional `state`
//     field even though every current entry is country-only — this
//     lets us add a US-state-disambiguated entry (e.g. `'Athens, GA':
//     { country: 'US', state: 'GA' }`) later without touching the
//     lookup or URL-builder code. OWM supports both `q=City,Country`
//     and `q=City,State,Country` forms; the helper below picks based
//     on whether `state` is set.
//   - Free-tier /forecast returns 5 days in 3-hour intervals (40 data
//     points), not daily. We aggregate to daily min/max/mode-conditions
//     to match the shape SeededWeatherRepository returns. This is what
//     OpenWeatherMap themselves do server-side for their paid daily
//     endpoint. Coverage is capped at 5 days regardless of what the
//     caller asks for — the seeded path promises 7 but live can't
//     deliver that on free tier. Documented in the Stage 20 README.
//   - In-memory TTL cache. Rate-limit protection more than latency —
//     free tier is 60/min, cache means five users asking about the same
//     city inside 5 min collapse to one API call. Not persistent
//     (restart clears it), which is fine for demo scale.
//   - HTTP error mapping: 401 → INTERNAL_ERROR (bad key), 404 →
//     null (city not found — service maps to CITY_NOT_FOUND), 429 →
//     one retry with 1s wait, 5xx → two retries with exponential
//     backoff, network → INTERNAL_ERROR. Errors from below throw a
//     LiveWeatherFetchError which the service layer catches and re-
//     wraps as WeatherServiceError.

// Disambiguation key for a city entry in the lookup below. Country is
// required; state is optional and only used for US-internal
// disambiguation (e.g. Athens, GA vs Athens, TN — not needed today,
// pre-installed for the next time we grow the city list).
type CityKey = { country: string; state?: string };

const CITY_LOOKUP: Record<string, CityKey> = {
  Athens: { country: 'GR' },
  Berlin: { country: 'DE' },
  London: { country: 'GB' },
  Tokyo: { country: 'JP' },
  'New York': { country: 'US' },
};

// Build the value we pass to OpenWeatherMap's `q=` parameter.
// - With state:    "Athens,GA,US"
// - Without state: "Berlin,DE"
// Extracts the leading city portion (part before the first comma) so a
// qualified lookup key like "Athens, GA" doesn't produce "Athens, GA,GA,US".
// Today every key is unqualified so the split is a no-op; the extraction
// is here so future qualified entries just work.
function qualifyForOwm(cityName: string, key: CityKey): string {
  const cityPart = cityName.split(',')[0].trim();

  return key.state
    ? `${cityPart},${key.state},${key.country}`
    : `${cityPart},${key.country}`;
}

const OWM_BASE = 'https://api.openweathermap.org/data/2.5';
const FORECAST_CAP_DAYS = 5;
const CURRENT_TTL_MS = 5 * 60 * 1000; // 5 min
const FORECAST_TTL_MS = 60 * 60 * 1000; // 1 hour

// Shapes OpenWeatherMap actually returns. Only the fields we consume are
// typed; the rest of their (large) response goes unread.
interface OwmCurrentResponse {
  main: { temp: number };
  weather: Array<{ description: string }>;
}

interface OwmForecastResponse {
  list: Array<{
    dt_txt: string; // "2026-08-08 12:00:00" — UTC per OWM docs.
    main: { temp: number };
    weather: Array<{ description: string }>;
  }>;
}

// Thrown by the low-level fetch helper. WeatherService catches it and
// re-wraps as WeatherServiceError with INTERNAL_ERROR.
export class LiveWeatherFetchError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LiveWeatherFetchError';
  }
}

type CacheEntry<T> = { value: T; expiresAt: number };

export class LiveWeatherRepository implements WeatherRepository {
  private readonly apiKey: string;

  // E.g, `current:Berlin` → { value: CurrentWeatherRow, expiresAt: 1234567890 }
  private readonly currentCache = new Map<
    string,
    CacheEntry<CurrentWeatherRow>
  >();

  // E.g, `forecast:Berlin:3` → { value: ForecastRow, expiresAt: 1234567890 }
  private readonly forecastCache = new Map<string, CacheEntry<ForecastRow>>();

  constructor(opts: { apiKey: string }) {
    if (!opts.apiKey) {
      throw new Error(
        'LiveWeatherRepository requires OPENWEATHERMAP_API_KEY. ' +
          'Either set it in the environment or run with USE_SEEDED_WEATHER=1.',
      );
    }
    this.apiKey = opts.apiKey;
  }

  async findCurrentWeatherByCity(
    cityName: string,
  ): Promise<CurrentWeatherRow | null> {
    // Lookup the disambiguation key for the city. If it's not in the
    // hardcoded map, treat it as "not found" — same contract as the seeded
    // repo.
    const key = CITY_LOOKUP[cityName];
    if (!key) return null; // Same "not in library" contract as seeded.

    // Prefix the cache key with "current:" so it doesn't collide with the
    // forecast cache. Cache is in-memory only, so a restart clears it.
    const cacheKey = `current:${cityName}`;
    const cached = readCache(this.currentCache, cacheKey);

    if (cached) return cached;

    const q = qualifyForOwm(cityName, key);
    const url = `${OWM_BASE}/weather?q=${encodeURIComponent(
      q,
    )}&appid=${this.apiKey}&units=metric`;

    const res = await fetchWithRetries(url);
    if (res === null) return null; // 404 — treated as city-not-found.

    const json = (await res.json()) as OwmCurrentResponse;

    const row: CurrentWeatherRow = {
      city: cityName,
      tempC: Math.round(json.main.temp * 10) / 10,
      conditions: json.weather[0]?.description ?? 'unknown',
    };

    writeCache(this.currentCache, cacheKey, row, CURRENT_TTL_MS);

    return row;
  }

  async findForecastByCity(
    cityName: string,
    days: number,
  ): Promise<ForecastRow | null> {
    // Lookup the disambiguation key for the city. If it's not in the
    // hardcoded map, treat it as "not found" — same contract as the seeded
    // repo.
    const key = CITY_LOOKUP[cityName];
    if (!key) return null;

    // Cap at free-tier's 5-day horizon regardless of what the caller
    // asked for. The service happily accepts 1-7 and hands whatever it
    // gets back to the agent; the agent's FORECAST BOUNDARY RULE in
    // the prompt already handles "fewer days than requested" honestly.
    const requestedDays = Math.min(Math.max(days, 1), FORECAST_CAP_DAYS);

    const cacheKey = `forecast:${cityName}:${requestedDays}`;

    const cached = readCache(this.forecastCache, cacheKey);

    if (cached) return cached;

    // OpenWeatherMap's free /forecast returns up to 40 data points
    // (5 days × 8 per day). We ask for enough to cover the requested
    // days; aggregation trims any tail.
    const cnt = requestedDays * 8;
    const q = qualifyForOwm(cityName, key);
    const url = `${OWM_BASE}/forecast?q=${encodeURIComponent(
      q,
    )}&appid=${this.apiKey}&units=metric&cnt=${cnt}`;

    const res = await fetchWithRetries(url);
    if (res === null) return null;

    const json = (await res.json()) as OwmForecastResponse;

    const row: ForecastRow = {
      city: cityName,
      days: aggregateToDaily(json.list, requestedDays),
    };

    writeCache(this.forecastCache, cacheKey, row, FORECAST_TTL_MS);
    return row;
  }
}

// Aggregate OpenWeatherMap's 3-hour data points into per-day min/max
// temperature and a single conditions label per day. Returns at most
// `maxDays` entries, ordered by date ascending. If a day has no data
// points (shouldn't happen with cnt = days × 8, but defend anyway),
// it's dropped from the output.
function aggregateToDaily(
  list: OwmForecastResponse['list'],
  maxDays: number,
): ForecastDayRow[] {
  // E.g., list = [
  //   { dt_txt: "2026-08-08 00:00:00", main: { temp: 20 }, weather: [{ description: "clear sky" }] },
  //   { dt_txt: "2026-08-08 03:00:00", main: { temp: 18 }, weather: [{ description: "few clouds" }] },
  //   ...
  // ]

  // Bucket by YYYY-MM-DD extracted from dt_txt.
  const byDate = new Map<string, { temps: number[]; conditions: string[] }>();

  for (const point of list) {
    // E.g., point = { dt_txt: "2026-08-08 12:00:00", main: { temp: 22 }, weather: [{ description: "scattered clouds" }] }
    const date = point.dt_txt.slice(0, 10); // "2026-08-08 12:00:00" → "2026-08-08"

    // Create a bucket for this date if it doesn't exist yet.
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = { temps: [], conditions: [] };
      byDate.set(date, bucket);
    }

    // Accumulate the temperature and conditions for this 3-hour point.
    bucket.temps.push(point.main.temp);
    bucket.conditions.push(point.weather[0]?.description ?? 'unknown');
  }

  // E.g., at this point, byDate might look like:
  // Map {
  //   "2026-08-08" => { temps: [20, 18, 22, ...], conditions: ["clear sky", "few clouds", "scattered clouds", ...] },
  //   "2026-08-09" => { temps: [21, 19, 23, ...], conditions: ["clear sky", "few clouds", "scattered clouds", ...] },
  //   ...
  // }

  const days: ForecastDayRow[] = [];

  // Sort the dates ascending and take at most `maxDays`. For each date,
  // compute the min/max temperature and the mode of the conditions.
  const sortedDates = Array.from(byDate.keys()).sort();

  // E.g., at this point, sortedDates might look like:
  // ["2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"]
  for (const date of sortedDates.slice(0, maxDays)) {
    // Defensive: if a day has no data points, skip it. Shouldn't happen with cnt = days × 8, but defend anyway.
    const bucket = byDate.get(date);
    if (!bucket || bucket.temps.length === 0) continue;

    days.push({
      date,
      tempCMin: Math.round(Math.min(...bucket.temps) * 10) / 10,
      tempCMax: Math.round(Math.max(...bucket.temps) * 10) / 10,
      conditions: modeString(bucket.conditions),
    });
  }

  // E.g., at this point, days might look like:
  // [
  //   { date: "2026-08-08", tempCMin: 18, tempCMax: 22, conditions: "few clouds" },
  //   { date: "2026-08-09", tempCMin: 19, tempCMax: 23, conditions: "clear sky" },
  //   ...
  // ]
  return days;
}

// Most-common string in the list; ties broken by first occurrence.
// Used for the daily conditions label — the 3-hour points across a day
// often oscillate (clear → few clouds → scattered clouds), so picking
// the mode gives a reasonable single-word summary.
// E.g., modeString(["clear sky", "few clouds", "clear sky"]) → "clear sky"
// E.g., modeString(["few clouds", "scattered clouds", "few clouds"]) → "few clouds"
// E.g., modeString(["clear sky", "few clouds", "scattered clouds"]) → "clear sky" (first occurrence of a tie)
function modeString(values: string[]): string {
  const counts = new Map<string, number>();

  let bestValue = values[0] ?? 'unknown';
  let bestCount = 0;

  // counts would look like:
  // Map {
  //   "clear sky" => 2,
  //   "few clouds" => 1,
  //   "scattered clouds" => 1
  // }
  for (const v of values) {
    const next = (counts.get(v) ?? 0) + 1;
    counts.set(v, next);

    if (next > bestCount) {
      bestValue = v;
      bestCount = next;
    }
  }

  // E.g., at this point, bestValue would be "clear sky" and bestCount would be 2.
  return bestValue;
}

// Strip the appid= value from a URL before logging. Prevents the API
// key from leaking into dev-server / production logs.
function maskApiKey(url: string): string {
  return url.replace(/(appid=)[^&]+/, '$1***');
}

// Fetch with status-code-aware retry:
//   - 200 → return the response.
//   - 404 → return null (caller treats as "city not found").
//   - 401 → throw with a specific message about the API key.
//   - 429 → one retry after 1s, then throw.
//   - 5xx → two retries with exponential backoff (1s, 2s), then throw.
//   - other 4xx → throw immediately (no retry — it's a request problem).
//   - network / parse error → throw.
//
// Return type is `Response | null` because 404 is a semantically
// meaningful "not found" that maps to the same behaviour the seeded
// repo's `null` returns.
async function fetchWithRetries(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    let res: Response;

    try {
      console.log(
        `[weather:live] OWM fetch: ${maskApiKey(url)}` +
          (attempt > 0 ? ` (retry ${attempt})` : ''),
      );
      res = await fetch(url);
    } catch (err) {
      // Network-level failure. Retry once for transient DNS/socket
      // hiccups, then give up.
      if (attempt < 2) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      throw new LiveWeatherFetchError(
        'OpenWeatherMap request failed at network layer',
        err,
      );
    }

    if (res.ok) return res;

    // 404 is a semantically meaningful "not found" that maps to the same
    // behaviour the seeded repo's `null` returns. No retry.
    if (res.status === 404) return null;

    if (res.status === 401) {
      throw new LiveWeatherFetchError(
        'OpenWeatherMap rejected the API key (401). Check OPENWEATHERMAP_API_KEY. ' +
          'Newly-created keys can take up to a few hours to activate.',
      );
    }

    if (res.status === 429) {
      // Rate-limited. Retry once after 1s, then give up.
      if (attempt < 1) {
        await sleep(1000);
        continue;
      }
      throw new LiveWeatherFetchError(
        'OpenWeatherMap rate-limited the request (429). Retry gave up.',
      );
    }

    if (res.status >= 500 && res.status < 600) {
      // 5xx — server-side problem. Retry twice with exponential backoff,
      // then give up. This is the only case where we retry more than once.
      if (attempt < 2) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }

      throw new LiveWeatherFetchError(
        `OpenWeatherMap upstream error (HTTP ${res.status}). Retries gave up.`,
      );
    }

    // Other 4xx — request problem, no retry.
    throw new LiveWeatherFetchError(
      `OpenWeatherMap returned HTTP ${res.status}.`,
    );
  }

  // Unreachable — every loop iteration either returns or throws.
  throw new LiveWeatherFetchError('fetchWithRetries: unreachable');
}

function readCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function writeCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
