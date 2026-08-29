// Data shapes for the weather domain. Self-contained — no imports — so
// client bundles that only need the API response types don't drag in
// service, repository, or Prisma code at type-resolution time.

// A single city's current conditions, as returned by any
// WeatherRepository implementation (SeededWeatherRepository from Prisma,
// LiveWeatherRepository from OpenWeatherMap).
export interface CurrentWeatherRow {
  city: string;
  tempC: number;
  conditions: string;
}

// One day of a multi-day forecast.
export interface ForecastDayRow {
  date: string;
  tempCMin: number;
  tempCMax: number;
  conditions: string;
}

// A city's forecast — one row per day, sorted by date ascending.
export interface ForecastRow {
  city: string;
  days: ForecastDayRow[];
}

// Shape returned by WeatherService.getCurrentWeather — the JSON body of
// /api/weather/current. Wraps the repository Row with the units brand.
export interface CurrentWeatherResult extends CurrentWeatherRow {
  units: 'celsius';
}

// Shape returned by WeatherService.getForecast — the JSON body of
// /api/weather/forecast. Adds requested/provided day counts so callers
// can honestly acknowledge a provider-capped forecast (e.g. OWM free
// tier caps at 5 days even when 7 were asked for).
export interface ForecastResult extends ForecastRow {
  units: 'celsius';
  requestedDays: number;
  providedDays: number;
}
