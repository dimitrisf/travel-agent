import { bookingCrossReferenceOutputGuardrail } from '@/guardrails/bookingCrossReferenceOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — check (c) of the cross-reference guardrail:
// the agent talks about a booking as if it exists, but the collector is
// empty (no propose_booking was ever called). The check should trip
// because there's no data to back the claim.
//
// Note the interplay with the OTHER booking guardrail (regex-based
// finality-claim): the agent output below uses "your booking has been
// prepared" — deliberately NON-finality wording, so the regex guardrail
// does NOT trip on it. That isolates check (c): we're testing that
// mentioning a booking without any tool call is caught even when the
// wording is otherwise fine.
export const bookingWithoutCallTrips: SyntheticGuardrailCase = {
  name: 'synthetic-booking-without-call-trips',
  description:
    'Agent talks about a booking as if it exists but no propose_booking was ever called — cross-reference guardrail must trip (check c).',
  guardrail: bookingCrossReferenceOutputGuardrail,
  agentOutput:
    'Your booking is ready to confirm. Click the button below and your trip is booked.',
  toolCallCollector: [],
  expect: (result) => [
    // The guardrail must trip because the agent output mentions a booking but no propose_booking was ever called.
    // result.tripwireTriggered should be true.
    {
      description: 'tripwire triggered',
      passed: result.tripwireTriggered === true,
      details: `tripwireTriggered=${result.tripwireTriggered}`,
    },
    // The guardrail must report the pattern name in outputInfo.
    // result.outputInfo.patternName should be "booking-without-call"
    //  — makes sure the RIGHT check tripped, not accidentally a different one.
    {
      description: 'outputInfo.patternName is "booking-without-call"',
      passed:
        (result.outputInfo as { patternName?: unknown })?.patternName ===
        'booking-without-call',
      details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
    },
  ],
};
