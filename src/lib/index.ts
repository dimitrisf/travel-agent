import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { WeatherRepository } from './WeatherRepository';
import { WeatherService } from './WeatherService';
import { WeatherServiceError } from './WeatherServiceError';

export { WeatherRepository } from './WeatherRepository';
export type {
  CurrentWeatherRow,
  ForecastDayRow,
  ForecastRow,
} from './WeatherRepository';
export { WeatherService } from './WeatherService';
export type {
  CurrentWeatherResult,
  ForecastResult,
  GetCurrentWeatherInput,
  GetForecastInput,
} from './WeatherService';
export {
  WeatherServiceError,
  type WeatherServiceErrorCode,
} from './WeatherServiceError';

let defaultPrisma: PrismaClient | undefined;

export function createWeatherService(prisma?: PrismaClient): WeatherService {
  const client = prisma ?? (defaultPrisma ??= new PrismaClient());
  return new WeatherService(new WeatherRepository(client));
}

export function isWeatherServiceError(
  err: unknown,
): err is WeatherServiceError {
  return err instanceof WeatherServiceError;
}

export function isZodValidationError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError;
}
