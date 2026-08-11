import { bookingCrossReferenceOutputGuardrail } from '@/guardrails/bookingCrossReferenceOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial-complement — parallel to hotelSubtotalQuoteAllowed but
// for flight legs. Round-trip flight-only booking: outbound €150 +
// return €133 = €283 grand total. Agent quotes each leg's subtotal in
// booking-adjacent phrasing ("Outbound flight total: €150", etc.); all
// three figures came from the propose_booking response — €150 and €133
// from the two `flightBookings` rows, €283 from the top-level
// totalPriceEUR. Check (b)'s walk must descend into a MULTI-element
// array and collect both legs so no claim looks fabricated.
//
// If the walk ever regresses to top-level-only or single-element-array-
// only, one of the two leg claims fails to match [283] and this case
// trips.
export const flightSubtotalQuoteAllowed: SyntheticGuardrailCase = {
  name: 'synthetic-flight-subtotal-quote-allowed',
  description:
    'Agent quotes real per-leg flight subtotals for a round-trip in booking-adjacent phrasing — cross-reference guardrail must NOT trip.',
  guardrail: bookingCrossReferenceOutputGuardrail,
  agentOutput:
    'Your round-trip is ready to confirm. Reference: BKG-2026-A9F3K2. Outbound flight total: €150. Return flight total: €133. Trip total: €283. Click Confirm in the card below.',
  toolCallCollector: [
    {
      name: 'propose_booking',
      args: {},
      result:
        '{"reference":"BKG-2026-A9F3K2","totalPriceEUR":283,"status":"PROPOSED","flightBookings":[{"totalPriceEUR":150},{"totalPriceEUR":133}],"hotelBookings":[]}',
      parsedResult: {
        reference: 'BKG-2026-A9F3K2',
        totalPriceEUR: 283,
        status: 'PROPOSED',
        flightBookings: [{ totalPriceEUR: 150 }, { totalPriceEUR: 133 }],
        hotelBookings: [],
      },
    },
  ],
  expect: (result) => [
    {
      description:
        'tripwire NOT triggered (real per-leg flight subtotals + real grand total)',
      passed: result.tripwireTriggered === false,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
  ],
};
