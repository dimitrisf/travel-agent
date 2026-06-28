import { z } from 'zod';
import type {
  CurrentWeatherRow,
  ForecastRow,
  WeatherRepository,
} from './WeatherRepository';
import { WeatherServiceError } from './WeatherServiceError';

const GetCurrentWeatherInput = z.object({
  city: z.string().trim().min(1, 'City name is required.'),
});

const GetForecastInput = z.object({
  city: z.string().trim().min(1, 'City name is required.'),
  days: z.number().int().min(1).max(7).default(3),
});

export type GetCurrentWeatherInput = z.input<typeof GetCurrentWeatherInput>;
export type GetForecastInput = z.input<typeof GetForecastInput>;

export interface CurrentWeatherResult extends CurrentWeatherRow {
  units: 'celsius';
}

export interface ForecastResult extends ForecastRow {
  units: 'celsius';
}

export class WeatherService {
  constructor(private readonly repository: WeatherRepository) {}

  async getCurrentWeather(
    input: GetCurrentWeatherInput,
  ): Promise<CurrentWeatherResult> {
    const { city } = GetCurrentWeatherInput.parse(input);

    let row: CurrentWeatherRow | null;
    try {
      row = await this.repository.findCurrentWeatherByCity(city);
    } catch (err) {
      throw new WeatherServiceError(
        'Failed to fetch current weather.',
        'INTERNAL_ERROR',
        { cause: err },
      );
    }

    if (!row) {
      throw new WeatherServiceError(
        `City "${city}" not found.`,
        'CITY_NOT_FOUND',
      );
    }
    return { ...row, units: 'celsius' };
  }

  async getForecast(input: GetForecastInput): Promise<ForecastResult> {
    const { city, days } = GetForecastInput.parse(input);

    let row: ForecastRow | null;
    try {
      row = await this.repository.findForecastByCity(city, days);
    } catch (err) {
      throw new WeatherServiceError(
        'Failed to fetch forecast.',
        'INTERNAL_ERROR',
        { cause: err },
      );
    }

    if (!row) {
      throw new WeatherServiceError(
        `City "${city}" not found.`,
        'CITY_NOT_FOUND',
      );
    }
    if (row.days.length === 0) {
      throw new WeatherServiceError(
        `No forecast available for "${city}".`,
        'NO_FORECAST_AVAILABLE',
      );
    }
    return { ...row, units: 'celsius' };
  }
}
