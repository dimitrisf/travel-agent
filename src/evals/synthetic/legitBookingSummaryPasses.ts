import { bookingCrossReferenceOutputGuardrail } from '@/guardrails/bookingCrossReferenceOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial-complement — the case that MUST NOT trip. A legitimate
// booking summary that quotes the real reference and the real total
// verbatim, in booking-adjacent phrasing. All three cross-reference
// checks should pass through cleanly.
//
// This is the regression check for the guardrail's false-positive rate.
// If any of checks (a), (b), (c) misfires on this input, the guardrail
// is over-blocking legit flows — a UX regression as bad as under-blocking
// drift. Balances the three "must trip" cases above.
// Why this one matters: false-positive rate. Adding checks (a)(b)(c) risks over-blocking legit flows. This case is the smoke test that guards against that class of regression.
export const legitBookingSummaryPasses: SyntheticGuardrailCase = {
  name: 'synthetic-legit-booking-summary-passes',
  description:
    'Booking summary that quotes the real reference and total — cross-reference guardrail must NOT trip.',
  guardrail: bookingCrossReferenceOutputGuardrail,
  agentOutput:
    "Your booking is ready to confirm. Reference: BKG-2026-A9F3K2. Booking total: €471.60. Click Confirm in the card below when you're ready.",
  toolCallCollector: [
    {
      name: 'propose_booking',
      args: { customer_name: 'Dimitris', customer_email: 'd@example.com' },
      result:
        '{"reference":"BKG-2026-A9F3K2","totalPriceEUR":471.6,"status":"PROPOSED"}',
      parsedResult: {
        reference: 'BKG-2026-A9F3K2',
        totalPriceEUR: 471.6,
        status: 'PROPOSED',
      },
    },
  ],
  expect: (result) => [
    // The guardrail must NOT trip because the agent output quotes the real reference and total verbatim.
    {
      description: 'tripwire NOT triggered (legit booking summary)',
      passed: result.tripwireTriggered === false,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
  ],
};
