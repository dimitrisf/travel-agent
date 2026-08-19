import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  buildFlightGenerationResponseSchema,
  type FlightGenerationInput,
  type FlightGenerationResponse,
} from './flightGenerationSchema';

// Stage 23 — on-demand LLM generator for flight inventory. Called by
// FlightRepository's cache-first search path: local DB has nothing for
// this (route, date) → repository asks LlmFlightSource for offers →
// repository upserts the result into Airline/FlightDefinition/
// FlightInstance and returns the newly-persisted rows to the agent.
//
// Uses OpenAI's Responses API (client.responses.parse) with structured
// outputs so the LLM output is guaranteed to conform to the Zod schema
// built at call time. The schema's airline enum is the current DB
// list, so the LLM literally cannot produce an unknown airline code —
// constrained decoding filters invalid tokens during generation.
//
// Deliberately on the Responses API (not chat.completions.parse) to
// stay consistent with the rest of the codebase — the @openai/agents
// runtime is Responses-based, and the repo's name literally reads
// "OpenAI Responses learning journey".
//
// Fails open on every error (network, rate-limit, refusal, Zod
// validation): logs the failure and returns null. FlightRepository
// treats null the same way it treats "no matches in seeded data" —
// the agent gets an empty result set and tells the user so. Same UX
// as if seed data had no coverage for the route.

const SYSTEM_PROMPT = [
  'You generate realistic flight offers for a travel demo application.',
  '',
  'You will be given a specific route (origin airport, destination airport, date), a list of available airlines, and asked to return between 3 and 6 offers in the strict JSON schema provided.',
  '',
  'REQUIREMENTS',
  '- Spread departure times across the day (early morning, morning, afternoon, evening).',
  '- Duration must match the geography of the route: short-haul intra-Europe 60-240 min; medium-haul (e.g. Europe ↔ North Africa) 180-360 min; long-haul intercontinental 360-840 min; ultra-long-haul (Europe ↔ Asia/Oceania) 600-1200 min.',
  '- Prices reflect realistic economy fares for the route length: short-haul ~€60-250; medium-haul ~€150-450; long-haul ~€400-1200. Occasionally include one premium fare up to 2x median.',
  '- flightNumber is DIGITS ONLY (2-4 digits, e.g. "1234", "824"). Do NOT include the airline prefix — the schema stores it separately as airlineIata.',
  '- Vary airlineIata across offers when possible — do not put all 6 offers on the same airline unless only one airline is allowed.',
  '- stops: 0 for most offers; occasionally 1 for a cheaper option; never more than 2.',
  '- aircraft: common types (A320, A321, A330, A350, B737, B777, B787). null is acceptable if you have no strong preference.',
  '- seatsAvailable: realistic remaining-seat counts (typically 10-200).',
  '',
  'You will only receive route/date combinations for real airports in the demo library. Treat the input as trusted and produce plausible offers — do not refuse benign travel-shopping requests.',
].join('\n');

// LlmFlightSource generates flight inventory on demand via OpenAI's
// Responses API. Constructor takes an options object so tests can
// inject a mock client; both fields default in production.
export class LlmFlightSource {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts: { client?: OpenAI; model?: string } = {}) {
    // Default: new OpenAI() picks up OPENAI_API_KEY from env (same
    // pattern as the guardrail classifiers under src/guardrails/).
    this.client = opts.client ?? new OpenAI();
    // Cheap default that handles structured outputs well. OpenAI's
    // current docs recommend gpt-5.6 for new projects (used in their
    // own sample code) — worth benchmarking cost + quality before
    // switching. Callers / tests can override via opts.model.
    this.model = opts.model ?? 'gpt-4o-mini';
  }

  // Generate 3-6 flight offers for the given route on the given date.
  // Returns null on any failure (network, refusal, Zod validation).
  // The caller (FlightRepository) treats null as "no coverage" — the
  // agent reports no matches to the user.
  async generateFlightsForRoute(
    // E.g., input = {
    //   originAirport: { iataCode: 'ATH', cityName: 'Athens' },
    //   destinationAirport: { iataCode: 'FRA', cityName: 'Frankfurt' },
    //   departureDate: '2024-07-01',
    //   allowedAirlines: [
    //     { iataCode: 'A3', name: 'Aegean Airlines' },
    //     { iataCode: 'LH', name: 'Lufthansa' },
    //   ],
    // }
    input: FlightGenerationInput,
  ): Promise<FlightGenerationResponse | null> {
    // Now allowedAirlineIatas = ['A3', 'LH'] for the above example. Used to build the z.enum for the schema.
    const allowedAirlineIatas = input.allowedAirlines.map((a) => a.iataCode);

    // Now as per above example, schema wraps the per-offer shape in
    // an outer flights-array container:
    //   z.object({
    //     flights: z.array(z.object({
    //       airlineIata: z.enum(['A3', 'LH']),
    //       flightNumber: ...,
    //       ...
    //     })).min(3).max(6),
    //   })
    // The schema is built at call time so the airline enum is always
    // the current DB list. Structured outputs enforces this during
    // generation, so the LLM literally cannot produce an unknown
    // airline code.
    const schema = buildFlightGenerationResponseSchema(allowedAirlineIatas);

    // Now airlineList = "A3 (Aegean Airlines), LH (Lufthansa)" for the above example. Used in the user prompt to give the LLM context on what airlines are available for this route/date.
    const airlineList = input.allowedAirlines
      .map((a) => `${a.iataCode} (${a.name})`)
      .join(', ');

    // Soft preference hints biasing the LLM toward what the caller
    // will actually keep post-filter. Kept as prompt text (not schema
    // constraints) so the cache still receives some diversity for
    // later callers with different filters. See FlightGenerationInput
    // for the rationale.
    const preferenceLines: string[] = [];
    if (input.callerPreferences?.nonstopOnly) {
      preferenceLines.push(
        'Caller preference: nonstop only — most offers should use stops=0 (still allowed to include at most one stops=1 option to enrich the cache).',
      );
    }
    const preferredCodes = input.callerPreferences?.preferredAirlineCodes;
    if (preferredCodes && preferredCodes.length > 0) {
      preferenceLines.push(
        `Caller preference: prefer these airlines — ${preferredCodes.join(', ')}. Weight the majority of offers to these; one or two offers on other allowed airlines is fine for cache diversity.`,
      );
    }

    // Now userPrompt = "Route: ATH (Athens) → FRA (Frankfurt)\nDeparture date: 2024-07-01\nAvailable airlines: A3 (Aegean Airlines), LH (Lufthansa)\n\nReturn the flight offers as JSON matching the provided schema."
    const userPrompt = [
      `Route: ${input.originAirport.iataCode} (${input.originAirport.cityName}) → ${input.destinationAirport.iataCode} (${input.destinationAirport.cityName})`,
      `Departure date: ${input.departureDate}`,
      `Available airlines: ${airlineList}`,
      ...preferenceLines,
      '',
      'Return the flight offers as JSON matching the provided schema.',
    ].join('\n');

    const startedAt = Date.now();

    try {
      const response = await this.client.responses.parse({
        model: this.model,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        text: {
          // The Responses API uses a "text.format" envelope to carry the
          // schema. zodTextFormat wraps our Zod schema in the correct
          // envelope shape for the API.
          // E.g, { type: 'json_schema', name, strict, schema } where
          // the inner `schema` is what OpenAI actually enforces during
          // generation.
          format: zodTextFormat(schema, 'flight_generation'),
        },
      });

      // Responses API returns output_parsed = null in three cases:
      // (a) the model refused (a 'refusal' item shows up in
      //     response.output);
      // (b) the response was cut off (length limit) before finishing;
      // (c) Zod validation failed on a malformed structured output.
      // We treat all three identically — log + return null — because
      // the caller only cares "did we get usable offers or not."
      const parsed = response.output_parsed;

      if (!parsed) {
        console.error(
          `[LlmFlightSource] parse returned no data (route ${input.originAirport.iataCode}→${input.destinationAirport.iataCode}) — possible refusal, length cutoff, or validation failure`,
        );
        return null;
      }

      const latencyMs = Date.now() - startedAt;
      console.log(
        `[LlmFlightSource] generated ${parsed.flights.length} offers for ${input.originAirport.iataCode}→${input.destinationAirport.iataCode} on ${input.departureDate} in ${latencyMs}ms`,
      );

      // The structured output is guaranteed to conform to the Zod schema
      // because we passed it to the Responses API in text.format. No
      // further validation is needed here.
      // The type of `parsed` is FlightGenerationResponse, so we can return it directly.
      // As per example above, parsed = {
      //   flights: [
      //     {
      //       airlineIata: 'A3',
      //       flightNumber: '1234',
      //       departureTimeHHMM: '08:30',
      //       durationMinutes: 180,
      //       basePriceEUR: 150,
      //       stops: 0,
      //       aircraft: 'A320',
      //       seatsAvailable: 50,
      //     },
      //     ...
      //   ]
      // }
      return parsed;
    } catch (err) {
      // Covers network errors, rate limits, SDK-level parse errors,
      // and refusal-throwing modes if the SDK ever surfaces them that
      // way in a future version.
      console.error(
        `[LlmFlightSource] generation failed (route ${input.originAirport.iataCode}→${input.destinationAirport.iataCode}):`,
        err,
      );
      return null;
    }
  }
}
