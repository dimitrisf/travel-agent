import type { CurrentWeatherRow, ForecastRow } from '@/types/weather';

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
//
// Row data shapes live in @/types/weather (self-contained) so client
// code can import them without pulling in this file's transitive deps.

export interface WeatherRepository {
  findCurrentWeatherByCity(cityName: string): Promise<CurrentWeatherRow | null>;

  findForecastByCity(
    cityName: string,
    days: number,
  ): Promise<ForecastRow | null>;
}
