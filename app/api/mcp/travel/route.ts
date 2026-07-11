import { createMcpApiClient } from '@/lib';
import { createMcpHttpHandler, type McpToolSpec } from '@/lib/mcpHttpHandler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Loopback base — the tool handlers reach the flight/hotel Route Handlers
// living in the same Next.js process. The trip through localhost keeps the
// layer story crisp (MCP wraps REST) at the cost of a few milliseconds.
const BASE =
  process.env.TRAVEL_API_BASE ?? `http://localhost:${process.env.PORT ?? 3000}`;
const { callApi, postApi } = createMcpApiClient(BASE);

const searchFlights: McpToolSpec = {
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

const searchHotels: McpToolSpec = {
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

// The POST handler for the MCP endpoint. It uses the createMcpHttpHandler function to create a handler that supports the "search_flights" and "search_hotels" tools. The handler will respond to JSON-RPC requests with the appropriate tool results or errors.
// E.g., a client may send a JSON-RPC request to invoke "search_flights" with the required parameters, and the server will call the corresponding handler and return the result.
// ───────────────────────────────────────────────
// Bookings (Stage 8)
// ───────────────────────────────────────────────
// The agent proposes bookings via `propose_booking`. It should NOT call
// `confirm_booking` on the user's behalf — confirmation is a user action
// triggered by clicking a button in the chat UI. `get_booking` and
// `cancel_booking` are safe for the agent to invoke.

const proposeBooking: McpToolSpec = {
  name: 'propose_booking',
  title: 'Propose Booking',
  description:
    'Create a PROPOSED booking for a trip. The booking is NOT paid or confirmed by this call — the user must click "Confirm" in the chat UI to actually reserve inventory. Before calling this tool, always summarize the trip in prose and get the user\'s go-ahead. The tool is idempotent on `idempotency_key`: reuse the same key for retries within one booking intent, generate a fresh UUID for each new booking. For a round-trip, include TWO entries in `flights`: outbound + return.',
  inputSchema: {
    type: 'object',
    properties: {
      idempotency_key: {
        type: 'string',
        description:
          'A UUID you generate. Same key on retries → same booking (no duplicate). Fresh UUID for each new booking intent.',
      },
      customer_name: {
        type: 'string',
        description: 'Full name of the customer.',
      },
      customer_email: {
        type: 'string',
        description: 'Contact email for the booking confirmation.',
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
              enum: ['economy', 'premium_economy', 'business', 'first'],
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
    required: ['idempotency_key', 'customer_name', 'customer_email'],
  },
  handler: async (args) => postApi('/api/booking/propose', args),
};

const getBooking: McpToolSpec = {
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

const cancelBooking: McpToolSpec = {
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

// Deliberately not exposing `confirm_booking` to the agent. The user must click "Confirm" in the chat UI to actually reserve inventory. The agent should only propose bookings and let the user confirm them.

export const POST = createMcpHttpHandler({
  name: 'travel',
  version: '1.0.0',
  tools: [
    searchFlights,
    searchHotels,
    proposeBooking,
    getBooking,
    cancelBooking,
  ],
});
