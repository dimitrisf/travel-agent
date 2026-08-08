// Ports-and-adapters boundary (Stage 20). WeatherService depends on
// this interface, not on any concrete class, so the underlying data
// source can swap between seeded DB and live OpenWeatherMap without
// touching the service layer or anything above it.
//
// Two implementations, one per file, both consuming this interface:
//   - SeededWeatherRepository (see SeededWeatherRepository.ts) —
//     reads from Prisma tables the demo library populates. Used by
//     evals + CI + the fresh-install default.
//   - LiveWeatherRepository (see LiveWeatherRepository.ts) — fetches
//     from OpenWeatherMap's free tier. Opt-in via USE_SEEDED_WEATHER=0.

export interface CurrentWeatherRow {
  city: string;
  tempC: number;
  conditions: string;
}

export interface ForecastDayRow {
  date: string;
  tempCMin: number;
  tempCMax: number;
  conditions: string;
}

export interface ForecastRow {
  city: string;
  days: ForecastDayRow[];
}

export interface WeatherRepository {
  findCurrentWeatherByCity(cityName: string): Promise<CurrentWeatherRow | null>;

  findForecastByCity(
    cityName: string,
    days: number,
  ): Promise<ForecastRow | null>;
}
