import { bookingCrossReferenceOutputGuardrail } from '@/guardrails/bookingCrossReferenceOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial-complement — regression for the Stage 22 backlog fix.
// The agent quotes a legitimate hotel line-item subtotal (€188.60) in
// booking-adjacent phrasing that DOESN'T equal the grand total (€471.60).
// Both figures came straight from the propose_booking response — grand
// total from `totalPriceEUR` at the top, hotel subtotal from
// `hotelBookings[0].totalPriceEUR`. Check (b) must recognize the subtotal
// as a known figure and NOT trip.
//
// If check (b) ever regresses to a grand-total-only comparison, this
// case fails and the fix is visible.
export const hotelSubtotalQuoteAllowed: SyntheticGuardrailCase = {
  name: 'synthetic-hotel-subtotal-quote-allowed',
  description:
    'Agent quotes a real hotel line-item subtotal alongside the grand total — cross-reference guardrail must NOT trip.',
  guardrail: bookingCrossReferenceOutputGuardrail,
  agentOutput:
    'Your trip is ready to confirm. Reference: BKG-2026-A9F3K2. Hotel total: €188.60. Round-trip flight total: €283. Trip total: €471.60. Click Confirm in the card below.',
  toolCallCollector: [
    {
      name: 'propose_booking',
      args: {},
      result:
        '{"reference":"BKG-2026-A9F3K2","totalPriceEUR":471.6,"status":"PROPOSED","flightBookings":[{"totalPriceEUR":283}],"hotelBookings":[{"totalPriceEUR":188.6}]}',
      parsedResult: {
        reference: 'BKG-2026-A9F3K2',
        totalPriceEUR: 471.6,
        status: 'PROPOSED',
        flightBookings: [{ totalPriceEUR: 283 }],
        hotelBookings: [{ totalPriceEUR: 188.6 }],
      },
    },
  ],
  expect: (result) => [
    {
      description:
        'tripwire NOT triggered (real hotel subtotal + real grand total)',
      passed: result.tripwireTriggered === false,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
  ],
};
