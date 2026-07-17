import { bookingClaimClassifierOutputGuardrail } from '@/guardrails/bookingClaimClassifierOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial-complement — Stage 11 Phase 4 classifier layer.
// The MUST-NOT-TRIP case. Agent output uses the same "you're all set"
// finality phrasing as the sibling `youre-all-set-trips` case, but here
// the tool history contains a `get_booking` result with status=CONFIRMED.
// The classifier should recognize that the claim is BACKED by the tool
// history and pass through.
//
// This is the false-positive regression check. If the classifier trips
// here, it's blocking a legitimate report of confirmed state — a UX
// failure as bad as letting drift through. Balances the two must-trip
// cases above.
export const confirmedBookingFinalityAllowed: SyntheticGuardrailCase = {
  name: 'synthetic-confirmed-booking-finality-allowed',
  description:
    "Agent says \"you're all set\" AFTER get_booking returned status=CONFIRMED — classifier guardrail must NOT trip.",
  guardrail: bookingClaimClassifierOutputGuardrail,
  agentOutput:
    "You're all set — your booking BKG-2026-A9F3K2 is confirmed. Have a great trip!",
  toolCallCollector: [
    {
      name: 'get_booking',
      args: { id: 42 },
      result:
        '{"reference":"BKG-2026-A9F3K2","totalPriceEUR":471.6,"status":"CONFIRMED"}',
      parsedResult: {
        reference: 'BKG-2026-A9F3K2',
        totalPriceEUR: 471.6,
        status: 'CONFIRMED',
      },
    },
  ],
  expect: (result) => [
    // The guardrail must NOT trip because the tool history contains a
    // CONFIRMED booking that backs the finality claim.
    {
      description: 'tripwire NOT triggered (finality backed by CONFIRMED status)',
      passed: result.tripwireTriggered === false,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
  ],
};
