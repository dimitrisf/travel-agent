import type { McpToolSpec } from '@/mcp/mcpHttpHandler';
import type { createMcpApiClient } from '@/mcp/mcpApiClient';

type ApiClient = ReturnType<typeof createMcpApiClient>;

export function makeCancelBookingToolSpec(
  postApi: ApiClient['postApi'],
): McpToolSpec {
  return {
    name: 'cancel_booking',
    title: 'Cancel Booking',
    description:
      'Cancel a booking by its numeric id. For PAID bookings, restores inventory and refunds; enforces per-hotel cancellation policy (non-refundable hotels reject cancellation). For PROPOSED bookings, always succeeds. Confirm with the user before calling — cancellation is often irreversible for non-refundable items.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          description: 'The numeric booking id.',
        },
        reason: {
          type: 'string',
          description: 'Optional free-text reason for the cancellation.',
        },
      },
      required: ['id'],
    },
    handler: async (args) => {
      // Destructure `id` from args and pass the rest as the body to the POST request
      // E.g., if args = { id: 123, reason: "User requested cancellation" }, then body = { reason: "User requested cancellation" }
      // args comes from the MCP request, which is a JSON object. We want to extract the `id` to construct the URL and use the rest of the properties as the request body.
      const { id, ...body } = args as { id: number; reason?: string };
      return postApi(`/api/booking/${id}/cancel`, body);
    },
  };
}
