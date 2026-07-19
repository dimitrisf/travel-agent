import { searchResultFabricationOutputGuardrail } from '@/guardrails/searchResultFabricationOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial-complement — Stage 13 fabrication guardrail. The
// MUST-NOT-TRIP regression check. Reply quotes REAL flight numbers
// (A3 824, A3 825) and REAL hotel names (City Budget Inn, Hotel
// Berlin Central) verbatim — exactly matching what the tool blob
// contains. The guardrail should pass through cleanly.
//
// If this ever trips, either the flight-number extractor is picking up
// non-flight tokens or the hotel-name extractor is picking up bolded
// prose the hotel-indicator filter should have dropped. Balances the
// two must-trip cases above — false-positive rate check.
export const legitSearchResultsAllowed: SyntheticGuardrailCase = {
  name: 'synthetic-legit-search-results-allowed',
  description:
    'Reply quotes real flight numbers and real hotel names verbatim — search-result fabrication guardrail must NOT trip.',
  guardrail: searchResultFabricationOutputGuardrail,
  agentOutput:
    'Here is a trip option for Berlin:\n\n**Outbound:** Aegean A3 824, departing 09:40.\n**Return:** Aegean A3 825, departing 12:30.\n\n**Hotel:** **City Budget Inn** (3 stars) — €94.30/night. Alternative: **Hotel Berlin Central** (4 stars) — €148.40/night.',
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
    {
      name: 'search_hotels',
      args: {
        city: 'Berlin',
        checkin: '2026-07-24',
        checkout: '2026-07-26',
        guests: 2,
      },
      result:
        '[{"hotel_id":2,"room_type_id":4,"hotel":"City Budget Inn","city":"Berlin","stars":3,"price_per_night":94.3},{"hotel_id":3,"room_type_id":5,"hotel":"Hotel Berlin Central","city":"Berlin","stars":4,"price_per_night":148.4}]',
      parsedResult: [
        { hotel: 'City Budget Inn', stars: 3, price_per_night: 94.3 },
        { hotel: 'Hotel Berlin Central', stars: 4, price_per_night: 148.4 },
      ],
    },
  ],
  expect: (result) => [
    {
      description:
        'tripwire NOT triggered (legit reply quotes real flights and hotels verbatim)',
      passed: result.tripwireTriggered === false,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
  ],
};
