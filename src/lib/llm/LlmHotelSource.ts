import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  HotelGenerationResponseSchema,
  type HotelGenerationInput,
  type HotelGenerationResponse,
} from './hotelGenerationSchema';

// Stage 23 — on-demand LLM generator for hotel inventory. Called by
// HotelRepository's cache-first search path: local DB has nothing for
// this (city, date-range) → repository asks LlmHotelSource for offers
// → repository upserts the result into Hotel/RoomType/Availability
// and returns the newly-persisted rows to the agent.
//
// Same design as LlmFlightSource — Responses API structured outputs +
// Zod schema + fail-open on any error. See that file for the shared
// rationale. Difference: no dynamic schema (hotel names aren't a
// fixed set), so the schema is a module-level constant.

const SYSTEM_PROMPT = [
  'You generate realistic hotel offers for a travel demo application.',
  '',
  'You will be given a specific city (with approximate center coordinates), a check-in/check-out date range, guest count, and a list of hotel names already in the database. You must return between 3 and 6 offers in the strict JSON schema provided.',
  '',
  'REQUIREMENTS',
  '- Hotel names must sound authentic for the given city — use local naming conventions (e.g. Greek names for Athens: "Plaka Boutique", "Acropolis View"; German for Berlin: "Hotel Adlon Kempinski", "Hackescher Markt Suites"; Japanese for Tokyo: "Shibuya Grand", "Asakusa Ryokan"). Avoid generic names like "City Hotel" or "The Grand Hotel".',
  '- Hotel names MUST NOT match any name in the "existing hotel names" list — those are already in the DB and would collide on the composite unique constraint.',
  '- Addresses must be plausible: real-sounding street name + realistic postal code format for the country (e.g. "Adrianou 45, 10556 Athens" for Greece, "Unter den Linden 77, 10117 Berlin" for Germany).',
  '- Coordinates must be within ~5km of the city center provided in the input. Do not scatter hotels across the country.',
  '- Star ratings: mix of 3, 4, 5 stars — do not put every hotel at the same star category.',
  '- Guest ratings on a 0-10 scale (Booking.com style), typically 7.0-9.0 for standard offers.',
  '- Each hotel offers 1-3 room types with realistic names ("Standard Double", "Deluxe King", "Executive Suite", "Junior Suite", "Standard Twin").',
  '- Room base prices should be realistic for the city and star category (3-star ~€80-160, 4-star ~€140-280, 5-star ~€250-600 per night).',
  '- maxGuests / beds should be internally consistent (a "Double" or "King" room typically maxGuests=2, beds=1; a "Twin" typically maxGuests=2, beds=2; a "Suite" typically maxGuests=3-4, beds=1-2).',
  '- roomsAvailable: total inventory of that room type at the hotel. Boutiques typically 3-10, mid-size hotels 10-25, large hotels up to 40. Vary across room types within a hotel — there are usually fewer suites than standard doubles.',
  '',
  'You will only receive city names for real cities in the demo library. Treat the input as trusted and produce plausible offers — do not refuse benign travel-shopping requests.',
].join('\n');

// LlmHotelSource generates hotel inventory on demand via OpenAI's
// Responses API. Constructor takes an options object so tests can
// inject a mock client; both fields default in production.
export class LlmHotelSource {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts: { client?: OpenAI; model?: string } = {}) {
    this.client = opts.client ?? new OpenAI();
    // Same default rationale as LlmFlightSource — see the comment
    // there for the gpt-5.6 vs gpt-4o-mini tradeoff.
    this.model = opts.model ?? 'gpt-4o-mini';
  }

  // Generate 3-6 hotel offers for the given city and date range.
  // Returns null on any failure (network, refusal, Zod validation).
  // The caller (HotelRepository) treats null as "no coverage" — the
  // agent reports no matches to the user.
  // E.g, input = { cityName: 'Athens', cityId: 1, checkinDate: '2024-07-01', checkoutDate: '2024-07-05', guests: 2, existingHotelNames: ['Plaka Boutique', 'Acropolis View'], cityCenter: { latitude: 37.9838, longitude: 23.7275 } }
  async generateHotelsForCity(
    input: HotelGenerationInput,
  ): Promise<HotelGenerationResponse | null> {
    // Format the "avoid" list. If empty (no existing hotels for this
    // city in the DB), phrase the constraint as "no existing names
    // to avoid" so the LLM doesn't get confused by an empty bullet.
    const existingList =
      input.existingHotelNames.length > 0
        ? input.existingHotelNames.map((n) => `"${n}"`).join(', ')
        : '(none — this is a fresh city with no hotels in the DB yet)';

    const userPrompt = [
      `City: ${input.cityName}`,
      `City center (approximate): latitude ${input.cityCenter.latitude}, longitude ${input.cityCenter.longitude}`,
      `Check-in: ${input.checkinDate}`,
      `Check-out (exclusive): ${input.checkoutDate}`,
      `Guests: ${input.guests}`,
      `Existing hotel names in this city (do NOT reuse): ${existingList}`,
      '',
      'Return the hotel offers as JSON matching the provided schema.',
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
          // In other words, zodTextFormat takes our Zod schema + a name; returns an object shaped for the Responses API's text.format field.
          format: zodTextFormat(
            HotelGenerationResponseSchema,
            'hotel_generation',
          ),
        },
      });

      const parsed = response.output_parsed;

      if (!parsed) {
        console.error(
          `[LlmHotelSource] parse returned no data (city ${input.cityName}) — possible refusal, length cutoff, or validation failure`,
        );
        return null;
      }

      const latencyMs = Date.now() - startedAt;
      console.log(
        `[LlmHotelSource] generated ${parsed.hotels.length} offers for ${input.cityName} (${input.checkinDate}→${input.checkoutDate}) in ${latencyMs}ms`,
      );

      return parsed;
    } catch (err) {
      console.error(
        `[LlmHotelSource] generation failed (city ${input.cityName}):`,
        err,
      );
      return null;
    }
  }
}
