import { searchResultFabricationOutputGuardrail } from '@/guardrails/searchResultFabricationOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial-complement — Stage 13 fabrication guardrail. The
// MUST-NOT-TRIP regression check for the grouped-by-hotel reply format.
//
// The bug this catches: the hotel-indicator pattern includes `Suites?`
// so it matches "Suite" (singular) too. When the agent's reply groups
// room types under each hotel and bolds them — **Junior Suite**,
// **Executive Suite** — the candidate extractor treats those as
// candidate hotel names. Before the fix, `extractRealHotelNames`
// pulled only `"hotel":"…"` values from the tool blob; room-type names
// were never in the "real names" pool, so any bolded room type
// containing "Suite" would trip as fabricated even though it came
// straight from search_hotels output.
//
// The fix is to widen the real-names pool to include `"room_type":"…"`
// values as well. This eval locks that in: reply enumerates real
// room types under real hotels; guardrail must not trip.
export const legitRoomTypesUnderHotelsAllowed: SyntheticGuardrailCase = {
  name: 'synthetic-legit-room-types-under-hotels-allowed',
  description:
    'Reply groups real room types (including "Junior Suite", "Executive Suite") under real hotels — search-result fabrication guardrail must NOT trip.',
  guardrail: searchResultFabricationOutputGuardrail,
  agentOutput: [
    'Here are the hotels available for your stay:',
    '',
    '1. **Charlottenburg Boutique** — 4 stars, 8.5/10',
    '   - **Standard Double** — €150/night × 2 = €300',
    '   - **Junior Suite** — €280/night × 2 = €560',
    '',
    '2. **Spree View Hotel** — 5 stars, 9.0/10',
    '   - **Standard Twin** — €250/night × 2 = €500',
    '   - **Executive Suite** — €480/night × 2 = €960',
  ].join('\n'),
  toolCallCollector: [
    {
      name: 'search_hotels',
      args: {
        city: 'Berlin',
        checkin: '2026-09-10',
        checkout: '2026-09-12',
        guests: 2,
        rooms: 1,
      },
      result:
        '[{"hotel_id":23,"room_type_id":40,"hotel":"Charlottenburg Boutique","city":"Berlin","stars":4,"rating":8.5,"room_type":"Standard Double","price_per_night":150,"total_price":300},{"hotel_id":23,"room_type_id":39,"hotel":"Charlottenburg Boutique","city":"Berlin","stars":4,"rating":8.5,"room_type":"Junior Suite","price_per_night":280,"total_price":560},{"hotel_id":22,"room_type_id":47,"hotel":"Spree View Hotel","city":"Berlin","stars":5,"rating":9,"room_type":"Standard Twin","price_per_night":250,"total_price":500},{"hotel_id":22,"room_type_id":38,"hotel":"Spree View Hotel","city":"Berlin","stars":5,"rating":9,"room_type":"Executive Suite","price_per_night":480,"total_price":960}]',
      parsedResult: [
        { hotel: 'Charlottenburg Boutique', room_type: 'Standard Double' },
        { hotel: 'Charlottenburg Boutique', room_type: 'Junior Suite' },
        { hotel: 'Spree View Hotel', room_type: 'Standard Twin' },
        { hotel: 'Spree View Hotel', room_type: 'Executive Suite' },
      ],
    },
  ],
  expect: (result) => [
    {
      description:
        'tripwire NOT triggered (bolded room types match real search_hotels values)',
      passed: result.tripwireTriggered === false,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
  ],
};
