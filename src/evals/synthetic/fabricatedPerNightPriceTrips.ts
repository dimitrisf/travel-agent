import { priceFabricationOutputGuardrail } from '@/guardrails/priceFabricationOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — Stage 14 price-fabrication guardrail, check (a):
// agent quotes a per-night hotel price that doesn't appear in any real
// search_hotels result. Collector below has "City Budget Inn" at €94.30
// per night; reply says €120/night for the same hotel. The guardrail
// must trip on the €120 mention.
//
// The reply also mentions the REAL €94.30 for a second option to prove
// that (i) the extractor picks up multiple per-night prices, and (ii)
// the guardrail iterates in order and reports the first fabricated one.
export const fabricatedPerNightPriceTrips: SyntheticGuardrailCase = {
  name: 'synthetic-fabricated-per-night-price-trips',
  description:
    'Agent quotes a per-night hotel price that no search_hotels result returned — price-fabrication guardrail must trip (check a).',
  guardrail: priceFabricationOutputGuardrail,
  agentOutput:
    'Hotel options in Berlin:\n\n1. **City Budget Inn** — €120/night, Free WiFi.\n2. **Hotel Berlin Central** — €148.40/night, Breakfast included.',
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
        '[{"hotel_id":2,"room_type_id":4,"hotel":"City Budget Inn","city":"Berlin","stars":3,"price_per_night":94.3,"total_price":188.6},{"hotel_id":3,"room_type_id":5,"hotel":"Hotel Berlin Central","city":"Berlin","stars":4,"price_per_night":148.4,"total_price":296.8}]',
      parsedResult: [
        { hotel: 'City Budget Inn', price_per_night: 94.3, total_price: 188.6 },
        {
          hotel: 'Hotel Berlin Central',
          price_per_night: 148.4,
          total_price: 296.8,
        },
      ],
    },
  ],
  expect: (result) => [
    {
      description: 'tripwire triggered',
      passed: result.tripwireTriggered === true,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
    // patternName should identify which check tripped.
    {
      description: 'outputInfo.patternName is "fabricated-per-night-price"',
      passed:
        (result.outputInfo as { patternName?: unknown })?.patternName ===
        'fabricated-per-night-price',
      details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
    },
    // matchedText should surface the fabricated price (€120), not the
    // legit €148.40 that appears later in the reply.
    {
      description: 'outputInfo.matchedText is the fabricated €120',
      passed:
        (result.outputInfo as { matchedText?: unknown })?.matchedText ===
        '€120',
      details: `matchedText=${(result.outputInfo as { matchedText?: unknown })?.matchedText}`,
    },
  ],
};
