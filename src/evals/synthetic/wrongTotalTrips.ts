import { bookingCrossReferenceOutputGuardrail } from '@/guardrails/bookingCrossReferenceOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — check (b) of the cross-reference guardrail:
// the agent quotes a € figure in booking-context phrasing that doesn't
// match any real `totalPriceEUR` (±€1 slack). Collector below has one
// booking totalling €471.60; agent output claims €580 as the booking
// total. Delta = €108.40, well outside the ±€1 tolerance, so check (b)
// must trip.
//
// If this ever passes when it shouldn't, either (b)'s regex is missing
// the phrase family or the tolerance is too generous.
export const wrongTotalTrips: SyntheticGuardrailCase = {
  name: 'synthetic-wrong-total-trips',
  description:
    "Agent quotes a booking total that doesn't match any real totalPriceEUR — cross-reference guardrail must trip (check b).",
  guardrail: bookingCrossReferenceOutputGuardrail,
  agentOutput:
    'Your booking is ready to confirm. Reference: BKG-2026-A9F3K2. Total for the booking: €580. Click Confirm to reserve.',
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
    // Assertions verify tripwire fires, patternName is wrong-booking-total, and matchedText mentions both the claimed and actual values (so the details surface enough info to debug).
    [
      {
        description: 'tripwire triggered',
        passed: result.tripwireTriggered === true,
        details: `tripwireTriggered=${result.tripwireTriggered}`,
      },
      {
        description: 'outputInfo.patternName is "wrong-booking-total"',
        passed:
          (result.outputInfo as { patternName?: unknown })?.patternName ===
          'wrong-booking-total',
        details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
      },
      {
        description:
          'outputInfo.matchedText mentions €580 (claimed) and €471.6 (actual)',
        passed: (() => {
          const t = String(
            (result.outputInfo as { matchedText?: unknown })?.matchedText ?? '',
          );
          return t.includes('580') && t.includes('471.6');
        })(),
        details: `matchedText=${(result.outputInfo as { matchedText?: unknown })?.matchedText}`,
      },
    ],
};
