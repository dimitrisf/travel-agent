import { searchResultFabricationOutputGuardrail } from '@/guardrails/searchResultFabricationOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — Stage 13 fabrication guardrail, check (b):
// agent quotes a hotel name that no `search_hotels` result returned.
// Collector below has "City Budget Inn" and "Hotel Berlin Central"
// (the demo seed's Berlin hotels); reply lists a fabricated
// "Berlin Grand Palace Hotel" as option 2. The guardrail must trip.
//
// The reply also includes a legitimately-real hotel ("City Budget Inn")
// so we verify the guardrail returns the FABRICATED name in matchedText,
// not the real one — proving the extractor iterates in order and reports
// the first mismatch.
export const fabricatedHotelNameTrips: SyntheticGuardrailCase = {
  name: 'synthetic-fabricated-hotel-name-trips',
  description:
    'Agent quotes a hotel name that no search_hotels result returned — search-result fabrication guardrail must trip (check b).',
  guardrail: searchResultFabricationOutputGuardrail,
  agentOutput:
    'Here are hotel options in Berlin:\n\n1. **City Budget Inn** (3 stars) — €94.30/night, Free WiFi.\n2. **Berlin Grand Palace Hotel** (5 stars) — €280/night, Spa included.\n\nLet me know which you prefer.',
  toolCallCollector: [
    {
      name: 'search_hotels',
      args: {
        city: 'Berlin',
        checkin: '2026-07-24',
        checkout: '2026-07-26',
        guests: 2,
      },
      result:
        '[{"hotel_id":2,"room_type_id":4,"hotel":"City Budget Inn","city":"Berlin","stars":3,"price_per_night":94.3},{"hotel_id":3,"room_type_id":5,"hotel":"Hotel Berlin Central","city":"Berlin","stars":4,"price_per_night":148.4}]',
      parsedResult: [
        { hotel: 'City Budget Inn', stars: 3, price_per_night: 94.3 },
        { hotel: 'Hotel Berlin Central', stars: 4, price_per_night: 148.4 },
      ],
    },
  ],
  expect: (result) => [
    {
      description: 'tripwire triggered',
      passed: result.tripwireTriggered === true,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
    {
      description: 'outputInfo.patternName is "fabricated-hotel-name"',
      passed:
        (result.outputInfo as { patternName?: unknown })?.patternName ===
        'fabricated-hotel-name',
      details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
    },
    // The FABRICATED name is what should surface — not the legit first
    // option. Confirms extraction iterates in reply order and reports
    // the first mismatch (which is the real drift signal).
    {
      description: 'outputInfo.matchedText is the fabricated hotel name',
      passed:
        (result.outputInfo as { matchedText?: unknown })?.matchedText ===
        'Berlin Grand Palace Hotel',
      details: `matchedText=${(result.outputInfo as { matchedText?: unknown })?.matchedText}`,
    },
  ],
};
