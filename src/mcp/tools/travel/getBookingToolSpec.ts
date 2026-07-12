import type { McpToolSpec } from '@/mcp/mcpHttpHandler';
import type { createMcpApiClient } from '@/mcp/mcpApiClient';

type ApiClient = ReturnType<typeof createMcpApiClient>;

export function makeGetBookingToolSpec(callApi: ApiClient['callApi']): McpToolSpec {
  return {
    name: 'get_booking',
    title: 'Get Booking',
    description:
      'Look up a booking by its numeric id. Returns the full booking with all line items (flights, hotels, payments) and current status (PROPOSED, PAID, CANCELLED, …). Use this when the user references a prior booking or asks about its state.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          description: 'The numeric booking id.',
        },
      },
      required: ['id'],
    },
    handler: async (args) => callApi(`/api/booking/${args.id}`, {}),
  };
}
