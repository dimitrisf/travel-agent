import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { BookingRepository } from './repositories/BookingRepository';
import { BookingService } from './services/BookingService';
import { BookingServiceError } from './services/BookingServiceError';
import { ConversationRepository } from './repositories/ConversationRepository';
import { ConversationService } from './services/ConversationService';
import { ConversationServiceError } from './services/ConversationServiceError';
import { FlightRepository } from './repositories/FlightRepository';
import { FlightService } from './services/FlightService';
import { HotelRepository } from './repositories/HotelRepository';
import { HotelService } from './services/HotelService';
import { TravelServiceError } from './services/TravelServiceError';
import { LiveWeatherRepository } from './repositories/LiveWeatherRepository';
import { SeededWeatherRepository } from './repositories/SeededWeatherRepository';
import { WeatherService } from './services/WeatherService';
import { WeatherServiceError } from './services/WeatherServiceError';

// ───── Weather ─────
export { SeededWeatherRepository } from './repositories/SeededWeatherRepository';
export { LiveWeatherRepository } from './repositories/LiveWeatherRepository';
export type {
  CurrentWeatherRow,
  ForecastDayRow,
  ForecastRow,
  WeatherRepository,
} from './repositories/WeatherRepository';
export { WeatherService } from './services/WeatherService';
export type {
  CurrentWeatherResult,
  ForecastResult,
  GetCurrentWeatherInput,
  GetForecastInput,
} from './services/WeatherService';
export {
  WeatherServiceError,
  type WeatherServiceErrorCode,
} from './services/WeatherServiceError';

// ───── Travel — flights ─────
export { FlightRepository } from './repositories/FlightRepository';
export type {
  FlightSearchOptions,
  FlightSearchRow,
} from './repositories/FlightRepository';
export { FlightService } from './services/FlightService';
export type {
  FlightResult,
  SearchFlightsInput,
  SearchFlightsResult,
} from './services/FlightService';

// ───── Travel — hotels ─────
export { HotelRepository } from './repositories/HotelRepository';
export type {
  HotelSearchOptions,
  HotelSearchRow,
} from './repositories/HotelRepository';
export { HotelService } from './services/HotelService';
export type { HotelResult, SearchHotelsInput } from './services/HotelService';

// ───── Travel — shared error ─────
export {
  TravelServiceError,
  type TravelServiceErrorCode,
} from './services/TravelServiceError';

// ───── Bookings (Stage 8) ─────
export { BookingRepository } from './repositories/BookingRepository';
export type { BookingWithRelations } from './repositories/BookingRepository';
export { BookingService } from './services/BookingService';
export type { ProposeBookingInput } from './services/BookingService';
export {
  BookingServiceError,
  type BookingServiceErrorCode,
} from './services/BookingServiceError';

// ───── Conversations (Stage 17 Phase 3) ─────
export { ConversationRepository } from './repositories/ConversationRepository';
export type {
  ConversationSummary,
  ConversationWithMessages,
} from './repositories/ConversationRepository';
export { ConversationService } from './services/ConversationService';
export type { LoadedConversation } from './services/ConversationService';
export {
  ConversationServiceError,
  type ConversationServiceErrorCode,
} from './services/ConversationServiceError';

// ───── Helpers ─────
let defaultPrisma: PrismaClient | undefined;

// Returns a shared PrismaClient instance for the library. If you want to use your own PrismaClient instance, you can pass it to the service constructors instead of using this function.
// This is useful for serverless environments where you want to reuse the same PrismaClient instance across invocations.
// If you are using this library in a serverless environment, you should call this function once at the top level of your application (e.g. in your API route handler) and reuse the returned PrismaClient instance for all service constructors. This will help avoid exhausting database connections.
// If you are using this library in a long-running process (e.g. a server), you can also call this function once at the top level of your application and reuse the returned PrismaClient instance for all service constructors. This will help avoid exhausting database connections.
// ??= means "assign if undefined". So if defaultPrisma is already defined, it will not be reassigned. This is useful for serverless environments where the module may be reloaded multiple times, but we want to reuse the same PrismaClient instance across invocations.
// Exported for use by the NextAuth Prisma adapter (Stage 17) so the auth
// tables share the same connection pool as the rest of the app.
export function getSharedPrisma(): PrismaClient {
  return (defaultPrisma ??= new PrismaClient());
}

// createWeatherService picks between the seeded (Prisma) and live
// (OpenWeatherMap HTTP) repositories based on the USE_SEEDED_WEATHER
// env var. Default is seeded (safest for evals + tests + fresh dev
// installs without an OWM key).
//
// The `prisma` argument is only consumed in seeded mode. In live mode
// the DB isn't needed at all — getSharedPrisma() is deliberately NOT
// called, so live-only deployments can run without DATABASE_URL and
// without opening an unused Neon connection.
export function createWeatherService(prisma?: PrismaClient): WeatherService {
  const useSeeded = process.env.USE_SEEDED_WEATHER !== '0';

  if (useSeeded) {
    const client = prisma ?? getSharedPrisma();
    return new WeatherService(new SeededWeatherRepository(client));
  }

  const apiKey = process.env.OPENWEATHERMAP_API_KEY ?? '';
  return new WeatherService(new LiveWeatherRepository({ apiKey }));
}

export function createFlightService(prisma?: PrismaClient): FlightService {
  const client = prisma ?? getSharedPrisma();
  return new FlightService(new FlightRepository(client));
}

export function createHotelService(prisma?: PrismaClient): HotelService {
  const client = prisma ?? getSharedPrisma();
  return new HotelService(new HotelRepository(client));
}

export function createBookingService(prisma?: PrismaClient): BookingService {
  const client = prisma ?? getSharedPrisma();
  return new BookingService(client, new BookingRepository(client));
}

export function createConversationService(
  prisma?: PrismaClient,
): ConversationService {
  const client = prisma ?? getSharedPrisma();
  return new ConversationService(new ConversationRepository(client));
}

export function isWeatherServiceError(
  err: unknown,
): err is WeatherServiceError {
  return err instanceof WeatherServiceError;
}

export function isTravelServiceError(err: unknown): err is TravelServiceError {
  return err instanceof TravelServiceError;
}

export function isBookingServiceError(
  err: unknown,
): err is BookingServiceError {
  return err instanceof BookingServiceError;
}

export function isConversationServiceError(
  err: unknown,
): err is ConversationServiceError {
  return err instanceof ConversationServiceError;
}

export function isZodValidationError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError;
}
