import type { McpToolSpec } from '@/mcp/mcpHttpHandler';
import type { createMcpApiClient } from '@/mcp/mcpApiClient';

type ApiClient = ReturnType<typeof createMcpApiClient>;

export function makeSearchHotelsToolSpec(callApi: ApiClient['callApi']): McpToolSpec {
  return {
    name: 'search_hotels',
    title: 'Search Hotels',
    description:
      'Search for hotels in a city with given check-in / check-out dates. Returns hotels with available rooms across the full stay, including room type, total price, average price per night, amenities, and cancellation policy. Filters: `min_stars`, `max_price` (per night), `breakfast_required`, `free_cancellation`, `pet_friendly`. Results are sorted by price ascending.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name, e.g. "Berlin".' },
        checkin: { type: 'string', description: 'Check-in date in YYYY-MM-DD.' },
        checkout: {
          type: 'string',
          description:
            'Check-out date in YYYY-MM-DD (exclusive — last night is checkout - 1).',
        },
        guests: {
          type: 'integer',
          description: 'Number of guests. Defaults to 2.',
        },
        rooms: {
          type: 'integer',
          description: 'Number of rooms required. Defaults to 1.',
        },
        min_stars: {
          type: 'integer',
          description: 'Minimum hotel star rating (1–5).',
        },
        max_price: {
          type: 'number',
          description:
            'Maximum average price per night in the requested currency.',
        },
        currency: {
          type: 'string',
          description:
            'ISO currency code. Defaults to EUR (the only currency the demo API supports).',
        },
        breakfast_required: {
          type: 'boolean',
          description:
            'If true, only hotels that include breakfast are returned.',
        },
        free_cancellation: {
          type: 'boolean',
          description:
            'If true, only hotels with a free-cancellation policy are returned.',
        },
        pet_friendly: {
          type: 'boolean',
          description: 'If true, only pet-friendly hotels are returned.',
        },
      },
      required: ['city', 'checkin', 'checkout'],
    },
    handler: async (args) => callApi('/api/hotels', args),
  };
}
