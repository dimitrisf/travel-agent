import { priceFabricationOutputGuardrail } from '@/guardrails/priceFabricationOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial-complement — Stage 14 price-fabrication guardrail. The
// MUST-NOT-TRIP regression check. Reply quotes REAL per-night hotel
// prices (€94.30, €148.40) and REAL flight per-leg prices (€138, €145)
// verbatim. It ALSO computes trip totals (€283 flight sum, €471.60
// grand total) — those are agent arithmetic and must NOT trip since
// the context-aware patterns only extract per-night / per-leg prices.
//
// If this trips, either the per-night extractor is picking up flight
// prices, the flight extractor is picking up trip totals, or the
// "total" negative lookahead in the flight pattern is not filtering
// correctly. Any of those would be UX-breaking on real trip summaries.
export const legitPricesAllowed: SyntheticGuardrailCase = {
  name: 'synthetic-legit-prices-allowed',
  description:
    'Reply quotes real per-night hotel prices and real flight per-leg prices verbatim, plus computed trip totals — price-fabrication guardrail must NOT trip.',
  guardrail: priceFabricationOutputGuardrail,
  agentOutput:
    'Trip summary:\n\nFlights:\nOutbound A3 824 for €138.\nReturn A3 825 for €145.\nFlight Total: €138 + €145 = €283.\n\nHotel: **City Budget Inn** — €94.30/night.\nHotel Total: €94.30 × 2 nights = €188.60.\n\nGrand Total: €283 + €188.60 = €471.60.',
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
        '[{"hotel_id":2,"room_type_id":4,"hotel":"City Budget Inn","city":"Berlin","stars":3,"price_per_night":94.3,"total_price":188.6}]',
      parsedResult: [
        { hotel: 'City Budget Inn', price_per_night: 94.3, total_price: 188.6 },
      ],
    },
  ],
  expect: (result) => [
    // Neither per-night nor per-leg patterns should match the computed
    // totals (€283, €188.60, €471.60) because the "total" lookahead
    // excludes them from the flight extractor and the per-night
    // extractor only matches explicit "€X/night" phrasings.
    {
      description:
        'tripwire NOT triggered (legit per-night and per-leg prices; trip totals not extracted)',
      passed: result.tripwireTriggered === false,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
  ],
};
