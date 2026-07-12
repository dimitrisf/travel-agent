import type { McpToolSpec } from '@/mcp/mcpHttpHandler';
import type { createMcpApiClient } from '@/mcp/mcpApiClient';

type ApiClient = ReturnType<typeof createMcpApiClient>;

export function makeSearchFlightsToolSpec(callApi: ApiClient['callApi']): McpToolSpec {
  return {
    name: 'search_flights',
    title: 'Search Flights',
    description:
      'Search for flights between two airports on a specific date. Use 3-letter IATA codes for origin and destination (e.g. "ATH" for Athens, "BER" for Berlin). Returns matching flights with airline, departure/arrival times, price, stops, and origin/destination metadata. Round-trip is supported via `return_date`. Result shape: `{ outbound: [...], inbound: [...] }`.',
    inputSchema: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: '3-letter IATA code for the origin airport, e.g. "ATH".',
        },
        destination: {
          type: 'string',
          description:
            '3-letter IATA code for the destination airport, e.g. "BER".',
        },
        departure_date: {
          type: 'string',
          description: 'Outbound date in YYYY-MM-DD.',
        },
        return_date: {
          type: 'string',
          description:
            'Optional return date in YYYY-MM-DD for round-trip search.',
        },
        adults: {
          type: 'integer',
          description: 'Number of adult travelers. Defaults to 1.',
        },
        children: {
          type: 'integer',
          description: 'Number of child travelers. Defaults to 0.',
        },
        cabin_class: {
          type: 'string',
          enum: ['economy', 'premium_economy', 'business', 'first'],
          description: 'Cabin class. Defaults to economy.',
        },
        nonstop_only: {
          type: 'boolean',
          description: 'If true, only direct (nonstop) flights are returned.',
        },
        max_price: {
          type: 'number',
          description: 'Maximum price per ticket in the requested currency.',
        },
        preferred_airlines: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Restrict to flights operated by these airlines (IATA codes, e.g. ["A3", "LH"]).',
        },
        currency: {
          type: 'string',
          description:
            'ISO currency code. Defaults to EUR (the only currency the demo API supports).',
        },
      },
      required: ['origin', 'destination', 'departure_date'],
    },
    handler: async (args) => callApi('/api/flights', args),
  };
}
