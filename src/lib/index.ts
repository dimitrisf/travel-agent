import { PrismaClient } from '@prisma/client';
import { LlmFlightSource } from './llm/LlmFlightSource';
import { LlmHotelSource } from './llm/LlmHotelSource';
import { BookingRepository } from './repositories/BookingRepository';
import { BookingService } from './services/BookingService';
import { ConversationRepository } from './repositories/ConversationRepository';
import { ConversationService } from './services/ConversationService';
import { FlightRepository } from './repositories/FlightRepository';
import { FlightService } from './services/FlightService';
import { HotelRepository } from './repositories/HotelRepository';
import { HotelService } from './services/HotelService';
import { LiveWeatherRepository } from './repositories/LiveWeatherRepository';
import { SeededWeatherRepository } from './repositories/SeededWeatherRepository';
import { WeatherService } from './services/WeatherService';

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

// ───── Error taxonomy (OO refactor) ─────
// Abstract base for anything the API layer can serialize into an HTTP
// response. CodedServiceError is the intermediate template-method base
// for the four domain error classes (they share the { error, code }
// body shape and the INTERNAL_ERROR log pattern). Two library-side
// wrappers cover errors we don't own (ZodError) and everything
// unclassified (UnexpectedError). See utils/apiErrorResponse.ts for
// the classifier.
export { ServiceError, type ServiceErrorCode } from './services/ServiceError';
export { CodedServiceError } from './services/CodedServiceError';
export { ZodValidationError } from './services/ZodValidationError';
export { UnexpectedError } from './services/UnexpectedError';

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

// Stage 23 — LLM inventory generation is opt-in via USE_LLM_GENERATION=1.
// Default off keeps evals, unit tests, and fresh dev installs on the
// deterministic seeded-only path (no OpenAI dependency at repo layer).
// When enabled, FlightRepository / HotelRepository fall back to an
// LlmFlightSource / LlmHotelSource on cache miss and upsert the result
// into the local DB — see those repo files for the cache-first flow.
function llmGenerationEnabled(): boolean {
  return process.env.USE_LLM_GENERATION === '1';
}

export function createFlightService(prisma?: PrismaClient): FlightService {
  const client = prisma ?? getSharedPrisma();
  const llmSource = llmGenerationEnabled() ? new LlmFlightSource() : undefined;

  return new FlightService(new FlightRepository(client, llmSource));
}

export function createHotelService(prisma?: PrismaClient): HotelService {
  const client = prisma ?? getSharedPrisma();
  const llmSource = llmGenerationEnabled() ? new LlmHotelSource() : undefined;
  return new HotelService(new HotelRepository(client, llmSource));
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
