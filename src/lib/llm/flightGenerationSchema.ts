import { z } from 'zod';

// The LLM output contract for LlmFlightSource. Schemas are BUILT PER
// CALL (not module-level constants) because the airline enum depends
// on which airlines currently exist in the DB — Scope B constrains the
// LLM to pick from the seeded airline list rather than invent new
// IATA codes. Passing the current list into z.enum() means OpenAI's
// structured-outputs constrained decoding literally cannot produce
// any other value.
//
// Constraints imposed by OpenAI's structured outputs (json_schema
// mode with strict:true): all fields required, .nullable() OK, no
// .default(), no .refine(), max nesting depth 5. These schemas
// comply.

// Input the repository hands to LlmFlightSource.generateFlightsForRoute.
// origin/destination carry both iataCode (for later upsert lookup) and
// cityName (for the prompt to give the LLM realistic context).
export interface FlightGenerationInput {
  originAirport: { iataCode: string; cityName: string };
  destinationAirport: { iataCode: string; cityName: string };
  // YYYY-MM-DD, interpreted as UTC calendar day (matches
  // FlightSearchOptions.departureDate in FlightRepository).
  departureDate: string;
  // Passed in by the repository from a DB query. LLM picks from this
  // list; upsert can then look up the airline by iataCode with
  // certainty that the row exists.
  allowedAirlines: Array<{ iataCode: string; name: string }>;
  // Optional caller preferences threaded into the user prompt as
  // soft bias — NOT schema-enforced (that would collapse cache
  // diversity for later callers with different filters). The LLM is
  // still free to include a few off-preference offers to enrich the
  // cache; the repository's queryDb filter applies the user's actual
  // hard filter on the way out.
  callerPreferences?: {
    // Mirrors FlightSearchOptions.nonstopOnly. When true, the prompt
    // tells the LLM to favor stops=0.
    nonstopOnly?: boolean;
    // Mirrors FlightSearchOptions.airlineCodes — a whitelist of
    // preferred IATA codes. Prompt asks the LLM to lean into these.
    preferredAirlineCodes?: string[];
  };
}

// Builds the Zod schema for a single flight offer. Exported for tests.
// The `allowedAirlineIatas` array becomes a z.enum, which structured
// outputs enforces during token generation.
export function buildFlightOfferSchema(allowedAirlineIatas: readonly string[]) {
  return z.object({
    // Hard-constrained by structured outputs — LLM cannot produce any
    // other value. The cast to [string, ...string[]] is required by
    // z.enum's signature (it wants a non-empty tuple type).
    airlineIata: z.enum(allowedAirlineIatas as [string, ...string[]]),
    // Airline-scoped flight number (digits only), e.g. "1234" for the
    // "LH1234" you'd see on a boarding pass. The airline prefix comes
    // from `airlineIata` above.
    flightNumber: z.string().regex(/^\d{2,4}$/),
    // Local departure time at origin airport, HH:MM 24-hour. Date is
    // not repeated in the schema — the repository combines this with
    // the input departureDate to build the full departureDatetime, and
    // computes arrivalDatetime from departureDatetime + durationMinutes.
    // This removes any chance of the LLM producing arrival-before-
    // departure or off-by-day errors.
    departureTimeHHMM: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    // Bounded so the LLM cannot produce obviously wrong durations
    // (a 5-minute intercontinental flight, or a 30-hour short-haul).
    durationMinutes: z.number().int().min(30).max(1440),
    basePriceEUR: z.number().positive().max(5000),
    stops: z.number().int().min(0).max(2),
    // Aircraft type (e.g. "A320", "B737"). Nullable because the LLM
    // may legitimately not commit to a specific aircraft for some
    // routes.
    aircraft: z.string().nullable(),
    // Realistic bound for narrow/wide-body seat counts. Constrains
    // the LLM away from producing e.g. 10000 seats.
    seatsAvailable: z.number().int().min(0).max(500),
  });
}

// Builds the full response schema (array of 3-6 flight offers).
// Called by LlmFlightSource per request with the current airline list.
export function buildFlightGenerationResponseSchema(
  allowedAirlineIatas: readonly string[],
) {
  return z.object({
    flights: z.array(buildFlightOfferSchema(allowedAirlineIatas)).min(3).max(6),
  });
}

export type FlightOffer = z.infer<ReturnType<typeof buildFlightOfferSchema>>;

export type FlightGenerationResponse = z.infer<
  ReturnType<typeof buildFlightGenerationResponseSchema>
>;
