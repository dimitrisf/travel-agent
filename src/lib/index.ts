import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { FlightRepository } from './FlightRepository';
import { FlightService } from './FlightService';
import { HotelRepository } from './HotelRepository';
import { HotelService } from './HotelService';
import { TravelServiceError } from './TravelServiceError';
import { WeatherRepository } from './WeatherRepository';
import { WeatherService } from './WeatherService';
import { WeatherServiceError } from './WeatherServiceError';

// ───── Weather ─────
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

// ───── Travel — flights ─────
export { FlightRepository } from './FlightRepository';
export type { FlightSearchOptions, FlightSearchRow } from './FlightRepository';
export { FlightService } from './FlightService';
export type {
  FlightResult,
  SearchFlightsInput,
  SearchFlightsResult,
} from './FlightService';

// ───── Travel — hotels ─────
export { HotelRepository } from './HotelRepository';
export type { HotelSearchOptions, HotelSearchRow } from './HotelRepository';
export { HotelService } from './HotelService';
export type { HotelResult, SearchHotelsInput } from './HotelService';

// ───── Travel — shared error ─────
export {
  TravelServiceError,
  type TravelServiceErrorCode,
} from './TravelServiceError';

// ───── HTTP query-string parsing ─────
export { parseBool, parseList } from './queryParsing';

// ───── MCP → REST API helper ─────
export { createMcpApiClient } from './mcpApiClient';

// ───── Helpers ─────
let defaultPrisma: PrismaClient | undefined;

// Returns a shared PrismaClient instance for the library. If you want to use your own PrismaClient instance, you can pass it to the service constructors instead of using this function.
// This is useful for serverless environments where you want to reuse the same PrismaClient instance across invocations.
// If you are using this library in a serverless environment, you should call this function once at the top level of your application (e.g. in your API route handler) and reuse the returned PrismaClient instance for all service constructors. This will help avoid exhausting database connections.
// If you are using this library in a long-running process (e.g. a server), you can also call this function once at the top level of your application and reuse the returned PrismaClient instance for all service constructors. This will help avoid exhausting database connections.
// ??= means "assign if undefined". So if defaultPrisma is already defined, it will not be reassigned. This is useful for serverless environments where the module may be reloaded multiple times, but we want to reuse the same PrismaClient instance across invocations.
function sharedPrisma(): PrismaClient {
  return (defaultPrisma ??= new PrismaClient());
}

export function createWeatherService(prisma?: PrismaClient): WeatherService {
  const client = prisma ?? sharedPrisma();
  return new WeatherService(new WeatherRepository(client));
}

export function createFlightService(prisma?: PrismaClient): FlightService {
  const client = prisma ?? sharedPrisma();
  return new FlightService(new FlightRepository(client));
}

export function createHotelService(prisma?: PrismaClient): HotelService {
  const client = prisma ?? sharedPrisma();
  return new HotelService(new HotelRepository(client));
}

export function isWeatherServiceError(
  err: unknown,
): err is WeatherServiceError {
  return err instanceof WeatherServiceError;
}

export function isTravelServiceError(err: unknown): err is TravelServiceError {
  return err instanceof TravelServiceError;
}

export function isZodValidationError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError;
}
