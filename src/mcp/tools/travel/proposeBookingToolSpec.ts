import type { McpToolSpec } from '@/mcp/mcpHttpHandler';
import type { createMcpApiClient } from '@/mcp/mcpApiClient';
import { CabinClass } from '@/lib/pricing';

type ApiClient = ReturnType<typeof createMcpApiClient>;

// ───────────────────────────────────────────────
// Bookings (Stage 8)
// ───────────────────────────────────────────────
// The agent proposes bookings via `propose_booking`. It should NOT call
// `confirm_booking` on the user's behalf — confirmation is a user action
// triggered by clicking a button in the chat UI. `get_booking` and
// `cancel_booking` are safe for the agent to invoke.

export function makeProposeBookingToolSpec(
  postApi: ApiClient['postApi'],
): McpToolSpec {
  return {
    name: 'propose_booking',
    title: 'Propose Booking',
    description:
      'Create a PROPOSED booking for a trip. The booking is NOT paid or confirmed by this call — the user must click "Confirm" in the chat UI to actually reserve inventory. Before calling this tool, always summarize the trip in prose and get the user\'s go-ahead. The tool is idempotent on `idempotency_key`: reuse the same key for retries within one booking intent, generate a fresh UUID for each new booking. For a round-trip, include TWO entries in `flights`: outbound + return. Customer identity is derived server-side from the authenticated session — do NOT ask the user for their name or email, do NOT try to pass those fields. Anonymous callers can propose freely; the booking gets an owner only when someone signs in and clicks Confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        idempotency_key: {
          type: 'string',
          description:
            'A UUID you generate. Same key on retries → same booking (no duplicate). Fresh UUID for each new booking intent.',
        },
        flights: {
          type: 'array',
          description:
            'One entry per flight leg. Empty array if hotel-only. Round-trip = 2 entries (outbound + return).',
          items: {
            type: 'object',
            properties: {
              flight_instance_id: {
                type: 'integer',
                description:
                  'The `flight_instance_id` from a `search_flights` result.',
              },
              cabin_class: {
                type: 'string',
                enum: [...CabinClass.options],
                description: 'Cabin class. Defaults to economy.',
              },
              adults: {
                type: 'integer',
                description:
                  'Number of adult passengers on this leg. Defaults to 1.',
              },
              children: {
                type: 'integer',
                description:
                  'Number of child passengers on this leg. Defaults to 0.',
              },
            },
            required: ['flight_instance_id'],
          },
        },
        hotels: {
          type: 'array',
          description:
            'One entry per hotel stay. Empty array if flight-only. Multiple entries for multi-city trips.',
          items: {
            type: 'object',
            properties: {
              room_type_id: {
                type: 'integer',
                description: 'The `room_type_id` from a `search_hotels` result.',
              },
              checkin: {
                type: 'string',
                description: 'Check-in date in YYYY-MM-DD.',
              },
              checkout: {
                type: 'string',
                description: 'Check-out date in YYYY-MM-DD (exclusive).',
              },
              guests: {
                type: 'integer',
                description: 'Number of guests. Defaults to 2.',
              },
              rooms: {
                type: 'integer',
                description: 'Number of rooms. Defaults to 1.',
              },
            },
            required: ['room_type_id', 'checkin', 'checkout'],
          },
        },
      },
      required: ['idempotency_key'],
    },
    handler: async (args) => postApi('/api/booking/propose', args),
  };
}
