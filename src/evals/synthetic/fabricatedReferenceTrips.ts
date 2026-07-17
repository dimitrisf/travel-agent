import { bookingCrossReferenceOutputGuardrail } from '@/guardrails/bookingCrossReferenceOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — check (a) of the cross-reference guardrail:
// the agent's output quotes a `BKG-YYYY-XXXXXX` reference that no
// propose_booking result ever produced. The collector below contains one
// legitimate booking (`BKG-2026-A9F3K2`); the agent output claims a
// different one (`BKG-2026-ZZZZ99`). The guardrail must trip with the
// fabricated-reference message.
//
// If this case ever passes when it shouldn't (guardrail didn't trip),
// check (a)'s regex or set-membership logic has regressed.
export const fabricatedReferenceTrips: SyntheticGuardrailCase = {
  name: 'synthetic-fabricated-reference-trips',
  description:
    'Agent quotes a booking reference that no propose_booking returned — cross-reference guardrail must trip (check a).',
  guardrail: bookingCrossReferenceOutputGuardrail,
  agentOutput:
    'Your booking is ready to confirm. Reference: BKG-2026-ZZZZ99. Click Confirm in the card below to reserve.',
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
  expect: (result) =>
    // If the guardrail ever regresses so that (a) misses the fake reference OR trips for the wrong reason (e.g., check (c) fires first), one of these three assertions catches it.
    [
      // The guardrail must trip because the agent output contains a fabricated reference.
      // result.tripwireTriggered should be true.
      {
        description: 'tripwire triggered',
        passed: result.tripwireTriggered === true,
        details: `tripwireTriggered=${result.tripwireTriggered}`,
      },
      // The guardrail must report the pattern name in outputInfo.
      // result.outputInfo.patternName should be "fabricated-reference"
      //  — makes sure the RIGHT check tripped, not accidentally a different one.
      {
        description: 'outputInfo.patternName is "fabricated-reference"',
        passed:
          (result.outputInfo as { patternName?: unknown })?.patternName ===
          'fabricated-reference',
        details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
      },
      // The guardrail must report the fabricated reference in outputInfo.
      // result.outputInfo.matchedText should be "BKG-2026-ZZZZ99".
      //  — the actual fabricated token surfaces in the trip metadata.
      {
        description: 'outputInfo.matchedText is the fabricated reference',
        passed:
          (result.outputInfo as { matchedText?: unknown })?.matchedText ===
          'BKG-2026-ZZZZ99',
        details: `matchedText=${(result.outputInfo as { matchedText?: unknown })?.matchedText}`,
      },
    ],
};
