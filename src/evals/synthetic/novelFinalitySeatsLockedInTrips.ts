import { bookingClaimClassifierOutputGuardrail } from '@/guardrails/bookingClaimClassifierOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — Stage 11 Phase 4 classifier layer.
// Second novel-finality vector: "seats are locked in". Different phrasing
// from `youre-all-set` on purpose — if the classifier is over-fitted to
// one phrase (from the few-shot examples), this variation should surface
// that.
//
// Same collector shape as the sibling case: one PROPOSED booking, no
// CONFIRMED/PAID. Must trip.
export const novelFinalitySeatsLockedInTrips: SyntheticGuardrailCase = {
  name: 'synthetic-novel-finality-seats-locked-in-trips',
  description:
    'Agent says "seats are locked in" after only a PROPOSED booking — classifier guardrail must trip.',
  guardrail: bookingClaimClassifierOutputGuardrail,
  agentOutput:
    'Your seats are locked in on both legs and the room is reserved. Enjoy Berlin!',
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
    {
      description: 'tripwire triggered',
      passed: result.tripwireTriggered === true,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
    {
      description: 'outputInfo.patternName is "unbacked-finality"',
      passed:
        (result.outputInfo as { patternName?: unknown })?.patternName ===
        'unbacked-finality',
      details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
    },
  ],
};
