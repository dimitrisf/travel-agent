import { priceFabricationOutputGuardrail } from '@/guardrails/priceFabricationOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — Stage 14 price-fabrication guardrail, check (b):
// agent quotes a flight per-leg price that doesn't appear in any real
// search_flights result. Collector below has A3 824 at €138 and A3 825
// at €145; reply says "A3 824 for €160" (wrong price for the outbound).
// The guardrail must trip on €160.
//
// The reply also mentions the real €145 for the return leg to prove
// the extractor iterates in order and reports the fabricated one first,
// even when a legit price appears too.
export const fabricatedFlightPriceTrips: SyntheticGuardrailCase = {
  name: 'synthetic-fabricated-flight-price-trips',
  description:
    'Agent quotes a flight per-leg price that no search_flights result returned — price-fabrication guardrail must trip (check b).',
  guardrail: priceFabricationOutputGuardrail,
  agentOutput:
    'Flight options:\n\nOutbound: A3 824 for €160.\nReturn: A3 825 for €145.',
  toolCallCollector: [
    {
      name: 'search_flights',
      args: {
        origin: 'ATH',
        destination: 'BER',
        departure_date: '2026-07-24',
        return_date: '2026-07-26',
      },
      result:
        '{"outbound":[{"flight_instance_id":"fi_1","flight_number":"A3 824","airline":"Aegean Airlines","origin":"ATH","destination":"BER","price":138}],"inbound":[{"flight_instance_id":"fi_2","flight_number":"A3 825","airline":"Aegean Airlines","origin":"BER","destination":"ATH","price":145}]}',
      parsedResult: {
        outbound: [{ flight_number: 'A3 824', price: 138 }],
        inbound: [{ flight_number: 'A3 825', price: 145 }],
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
      description: 'outputInfo.patternName is "fabricated-flight-price"',
      passed:
        (result.outputInfo as { patternName?: unknown })?.patternName ===
        'fabricated-flight-price',
      details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
    },
    // The fabricated €160 (not the real €145) should be reported.
    {
      description: 'outputInfo.matchedText is the fabricated €160',
      passed:
        (result.outputInfo as { matchedText?: unknown })?.matchedText ===
        '€160',
      details: `matchedText=${(result.outputInfo as { matchedText?: unknown })?.matchedText}`,
    },
  ],
};
