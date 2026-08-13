import { bookingCrossReferenceOutputGuardrail } from '@/guardrails/bookingCrossReferenceOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial-complement — regression for Stage 22 backlog #1a.
//
// Booking has two flight legs (€150 outbound, €133 return) plus a
// hotel (€200). Grand total €483. Agent quotes "Round-trip flight
// total: €283" — a legitimate sum of the two legs, but €283 isn't
// stored anywhere in the booking as its own field. Under the #1 fix
// alone, the known set is [483, 150, 133, 200] and €283 would trip
// as fabricated. The #1a fix adds sum-of-flight-line-totals as a
// derived aggregate, so the set becomes [483, 150, 133, 200, 283, 200]
// and the €283 claim now matches.
//
// If the derived-aggregate step ever regresses, this case trips.
export const flightAggregateQuoteAllowed: SyntheticGuardrailCase = {
  name: 'synthetic-flight-aggregate-quote-allowed',
  description:
    'Agent quotes the sum of round-trip flight legs alongside the grand total — cross-reference guardrail must NOT trip.',
  guardrail: bookingCrossReferenceOutputGuardrail,
  agentOutput:
    'Your trip is ready to confirm. Reference: BKG-2026-A9F3K2. Round-trip flight total: €283. Hotel total: €200. Trip total: €483. Click Confirm in the card below.',
  toolCallCollector: [
    {
      name: 'propose_booking',
      args: {},
      result:
        '{"reference":"BKG-2026-A9F3K2","totalPriceEUR":483,"status":"PROPOSED","flightBookings":[{"totalPriceEUR":150},{"totalPriceEUR":133}],"hotelBookings":[{"totalPriceEUR":200}]}',
      parsedResult: {
        reference: 'BKG-2026-A9F3K2',
        totalPriceEUR: 483,
        status: 'PROPOSED',
        flightBookings: [{ totalPriceEUR: 150 }, { totalPriceEUR: 133 }],
        hotelBookings: [{ totalPriceEUR: 200 }],
      },
    },
  ],
  expect: (result) => [
    {
      description:
        'tripwire NOT triggered (real round-trip flight sum + real grand total)',
      passed: result.tripwireTriggered === false,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
  ],
};
