import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  aggregateToDaily,
  fetchWithRetries,
  LiveWeatherFetchError,
  modeString,
  qualifyForOwm,
  readCache,
  writeCache,
  type CacheEntry,
  type OwmForecastResponse,
} from './LiveWeatherRepository';
import type { CityMetadata } from '../cities';

// ─── qualifyForOwm ─────────────────────────────────────────────────

describe('qualifyForOwm', () => {
  it('formats country-only entries as "City,Country"', () => {
    const key: CityMetadata = { country: 'DE', iata: 'BER' };
    expect(qualifyForOwm('Berlin', key)).toBe('Berlin,DE');
  });

  it('formats US-state entries as "City,State,Country"', () => {
    const key: CityMetadata = { country: 'US', state: 'GA', iata: 'AHN' };
    expect(qualifyForOwm('Athens', key)).toBe('Athens,GA,US');
  });

  it('strips a leading qualified suffix from the city name before joining', () => {
    // Guards against future qualified lookup keys like "Athens, GA"
    // producing malformed output like "Athens, GA,GA,US".
    const key: CityMetadata = { country: 'US', state: 'GA', iata: 'AHN' };
    expect(qualifyForOwm('Athens, GA', key)).toBe('Athens,GA,US');
  });

  it('handles multi-word city names', () => {
    const key: CityMetadata = { country: 'US', iata: 'JFK' };
    expect(qualifyForOwm('New York', key)).toBe('New York,US');
  });

  it('ignores extra fields on the metadata (iata is not part of the OWM query)', () => {
    const key: CityMetadata = { country: 'JP', iata: 'HND' };
    // iata is present but unused — result is city,country only.
    expect(qualifyForOwm('Tokyo', key)).toBe('Tokyo,JP');
  });
});

// ─── modeString ────────────────────────────────────────────────────

describe('modeString', () => {
  it('returns the most-common value in the list', () => {
    expect(modeString(['clear sky', 'few clouds', 'clear sky'])).toBe(
      'clear sky',
    );
  });

  it('breaks ties by first occurrence', () => {
    // clear sky, few clouds, scattered clouds — each appears once.
    // clear sky was seen first; it wins.
    expect(modeString(['clear sky', 'few clouds', 'scattered clouds'])).toBe(
      'clear sky',
    );
  });

  it('returns "unknown" for an empty list', () => {
    expect(modeString([])).toBe('unknown');
  });

  it('handles a single-value list', () => {
    expect(modeString(['light rain'])).toBe('light rain');
  });

  it('handles all-identical values', () => {
    expect(modeString(['overcast', 'overcast', 'overcast'])).toBe('overcast');
  });
});

// ─── aggregateToDaily ──────────────────────────────────────────────

// Small helper for building the OWM list-entry shape without repetition.
function point(
  dt_txt: string,
  temp: number,
  description: string,
): OwmForecastResponse['list'][number] {
  return { dt_txt, main: { temp }, weather: [{ description }] };
}

describe('aggregateToDaily', () => {
  it('buckets 3-hour points by YYYY-MM-DD and computes per-day min/max/mode', () => {
    const list: OwmForecastResponse['list'] = [
      point('2026-08-08 00:00:00', 18, 'clear sky'),
      point('2026-08-08 12:00:00', 27, 'few clouds'),
      point('2026-08-08 21:00:00', 19, 'clear sky'),
      point('2026-08-09 03:00:00', 17, 'light rain'),
      point('2026-08-09 15:00:00', 24, 'light rain'),
    ];

    const result = aggregateToDaily(list, 5);

    expect(result).toEqual([
      {
        date: '2026-08-08',
        tempCMin: 18,
        tempCMax: 27,
        conditions: 'clear sky',
      },
      {
        date: '2026-08-09',
        tempCMin: 17,
        tempCMax: 24,
        conditions: 'light rain',
      },
    ]);
  });

  it('rounds temperatures to one decimal', () => {
    const list = [
      point('2026-08-08 12:00:00', 22.37, 'clear sky'),
      point('2026-08-08 15:00:00', 22.89, 'clear sky'),
    ];
    const result = aggregateToDaily(list, 1);
    expect(result[0].tempCMin).toBe(22.4);
    expect(result[0].tempCMax).toBe(22.9);
  });

  it('clamps the output to maxDays entries', () => {
    const list = [
      point('2026-08-08 12:00:00', 20, 'clear sky'),
      point('2026-08-09 12:00:00', 21, 'clear sky'),
      point('2026-08-10 12:00:00', 22, 'clear sky'),
      point('2026-08-11 12:00:00', 23, 'clear sky'),
      point('2026-08-12 12:00:00', 24, 'clear sky'),
    ];
    const result = aggregateToDaily(list, 3);
    expect(result).toHaveLength(3);
    expect(result.map((d) => d.date)).toEqual([
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
    ]);
  });

  it('emits days in ascending date order regardless of input order', () => {
    const list = [
      point('2026-08-10 12:00:00', 22, 'clear sky'),
      point('2026-08-08 12:00:00', 20, 'clear sky'),
      point('2026-08-09 12:00:00', 21, 'clear sky'),
    ];
    const result = aggregateToDaily(list, 5);
    expect(result.map((d) => d.date)).toEqual([
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
    ]);
  });

  it('returns an empty array for an empty input list', () => {
    expect(aggregateToDaily([], 5)).toEqual([]);
  });

  it('falls back to "unknown" conditions when a point lacks a weather entry', () => {
    const list: OwmForecastResponse['list'] = [
      { dt_txt: '2026-08-08 12:00:00', main: { temp: 20 }, weather: [] },
    ];
    const result = aggregateToDaily(list, 1);
    expect(result[0].conditions).toBe('unknown');
  });
});

// ─── fetchWithRetries ──────────────────────────────────────────────

describe('fetchWithRetries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Small factory for the fetch mock — returns a Response-like with the
  // requested status. Body is empty since fetchWithRetries doesn't
  // consume it; the caller does.
  function mockFetch(...statuses: number[]) {
    let call = 0;

    const spy = vi.fn(async () => {
      const status = statuses[call] ?? statuses[statuses.length - 1];
      call++;
      // Return a Response-like object with the requested status. Body is
      // empty since fetchWithRetries doesn't consume it; the caller does.
      return new Response(null, { status });
    });

    // Stub the global fetch with our spy. The spy is returned so the test can assert on call count, etc.
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('returns the response on 200', async () => {
    const fetchSpy = mockFetch(200);
    const res = await fetchWithRetries('https://example/x');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null on 404 with no retry (city-not-found semantic)', async () => {
    const fetchSpy = mockFetch(404);
    const res = await fetchWithRetries('https://example/x');
    expect(res).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws LiveWeatherFetchError with API-key hint on 401', async () => {
    const fetchSpy = mockFetch(401);
    let caught: unknown;
    try {
      await fetchWithRetries('https://example/x');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LiveWeatherFetchError);
    expect((caught as Error).message).toMatch(/API key/i);
    expect((caught as Error).message).toMatch(/401/);
    // 401 is not retried — one call only.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries once on 429, then throws if it persists', async () => {
    const fetchSpy = mockFetch(429, 429);
    const promise = fetchWithRetries('https://example/x');
    const settled = promise.catch((e) => e as Error);

    // Retry backoff is 1s for 429.
    await vi.advanceTimersByTimeAsync(2000);
    const err = await settled;

    expect(err).toBeInstanceOf(LiveWeatherFetchError);
    expect((err as Error).message).toMatch(/rate-limited/i);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('succeeds on 429 → 200 after one retry', async () => {
    const fetchSpy = mockFetch(429, 200);
    const promise = fetchWithRetries('https://example/x');
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries twice on 5xx (1s, 2s backoff), then throws if it persists', async () => {
    const fetchSpy = mockFetch(500, 500, 500);
    const promise = fetchWithRetries('https://example/x');
    const settled = promise.catch((e) => e as Error);

    // Two retries: 1s (attempt 0→1), 2s (attempt 1→2).
    await vi.advanceTimersByTimeAsync(5000);
    const err = await settled;

    expect(err).toBeInstanceOf(LiveWeatherFetchError);
    expect((err as Error).message).toMatch(/HTTP 500/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('succeeds on 500 → 502 → 200 after two retries', async () => {
    const fetchSpy = mockFetch(500, 502, 200);
    const promise = fetchWithRetries('https://example/x');
    await vi.advanceTimersByTimeAsync(5000);
    const res = await promise;

    expect(res!.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on non-401/404/429/5xx 4xx (e.g. 400) with no retry', async () => {
    const fetchSpy = mockFetch(400);
    await expect(fetchWithRetries('https://example/x')).rejects.toMatchObject({
      name: 'LiveWeatherFetchError',
      message: expect.stringMatching(/HTTP 400/),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries once on network error, then throws', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const promise = fetchWithRetries('https://example/x');
    const settled = promise.catch((e) => e as Error);

    // Backoff on network error is 1s * (attempt + 1).
    await vi.advanceTimersByTimeAsync(10000);
    const err = await settled;

    expect(err).toBeInstanceOf(LiveWeatherFetchError);
    expect((err as Error).message).toMatch(/network layer/i);
    // Attempts: 0 (initial), 1 (first retry), 2 (second retry).
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

// ─── readCache / writeCache ────────────────────────────────────────

describe('cache helpers', () => {
  it('writeCache stores an entry with the correct expiresAt', () => {
    const cache = new Map<string, CacheEntry<string>>();
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    writeCache(cache, 'key', 'value', 5000);

    expect(cache.get('key')).toEqual({
      value: 'value',
      expiresAt: now + 5000,
    });
    vi.restoreAllMocks();
  });

  it('readCache returns the value when not yet expired', () => {
    const cache = new Map<string, CacheEntry<string>>();
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    writeCache(cache, 'key', 'fresh', 5000);
    expect(readCache(cache, 'key')).toBe('fresh');
    vi.restoreAllMocks();
  });

  it('readCache returns null and deletes the entry when expired', () => {
    const cache = new Map<string, CacheEntry<string>>();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    writeCache(cache, 'key', 'stale', 5000);
    expect(cache.has('key')).toBe(true);

    // Jump past expiry.
    dateNow.mockReturnValue(1_000_000 + 5001);
    expect(readCache(cache, 'key')).toBeNull();
    expect(cache.has('key')).toBe(false);
    vi.restoreAllMocks();
  });

  it('readCache returns null for a missing key', () => {
    const cache = new Map<string, CacheEntry<string>>();
    expect(readCache(cache, 'nope')).toBeNull();
  });

  it('readCache treats exactly-at-expiry as expired (Date.now >= expiresAt)', () => {
    const cache = new Map<string, CacheEntry<string>>();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    writeCache(cache, 'key', 'boundary', 5000);
    dateNow.mockReturnValue(1_000_000 + 5000); // Exactly at expiry.
    expect(readCache(cache, 'key')).toBeNull();
    vi.restoreAllMocks();
  });
});
