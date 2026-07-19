import { searchResultFabricationOutputGuardrail } from '@/guardrails/searchResultFabricationOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — Stage 13 fabrication guardrail, check (a):
// agent quotes a flight number that no `search_flights` result ever
// returned. Collector below has flights A3 824 and A3 825 (a real
// round-trip); reply quotes A3 999 (fabricated) as the outbound flight.
// The guardrail must trip on the fabricated token.
//
// If this ever passes when it shouldn't, either the flight-number
// regex missed the fake token or the normalized substring match found
// it in the blob by accident (very unlikely — "A3 999" doesn't appear
// in the blob and normalizes to "a3999" which also doesn't).
export const fabricatedFlightNumberTrips: SyntheticGuardrailCase = {
  name: 'synthetic-fabricated-flight-number-trips',
  description:
    'Agent quotes a flight number that no search_flights result returned — search-result fabrication guardrail must trip (check a).',
  guardrail: searchResultFabricationOutputGuardrail,
  agentOutput:
    'Here are your flight options:\n\n**Outbound:** Aegean A3 999, departing 09:40, arriving 11:20, €138.\n**Return:** Aegean A3 825, departing 12:30, arriving 14:20, €145.',
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
    // patternName should be "fabricated-flight-number" — confirms
    // check (a) tripped, not accidentally check (b) or nothing.
    {
      description: 'outputInfo.patternName is "fabricated-flight-number"',
      passed:
        (result.outputInfo as { patternName?: unknown })?.patternName ===
        'fabricated-flight-number',
      details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
    },
    // matchedText should be the fabricated token so log/debug can
    // surface it. Whitespace-normalized comparison means we accept
    // "A3 999" verbatim from the reply.
    {
      description: 'outputInfo.matchedText is the fabricated flight number',
      passed:
        (result.outputInfo as { matchedText?: unknown })?.matchedText ===
        'A3 999',
      details: `matchedText=${(result.outputInfo as { matchedText?: unknown })?.matchedText}`,
    },
  ],
};
