import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createMcpApiClient } from '../lib';

const BASE = process.env.TRAVEL_API_BASE ?? 'http://localhost:3000';
const FLIGHTS_PATH = '/api/flights';
const HOTELS_PATH = '/api/hotels';

const { callApi } = createMcpApiClient(BASE);

const server = new McpServer({
  name: 'travel',
  version: '1.0.0',
});

// ───────────────────────────────────────────────
// search_flights
// ───────────────────────────────────────────────

server.registerTool(
  'search_flights',
  {
    title: 'Search Flights',
    description:
      'Search for flights between two airports on a specific date. Use 3-letter IATA codes for origin and destination (e.g. "ATH" for Athens, "BER" for Berlin). Returns matching flights with airline, departure/arrival times, price, stops, and origin/destination metadata. Round-trip is supported via `return_date`. Result shape: `{ outbound: [...], inbound: [...] }`.',
    inputSchema: {
      origin: z
        .string()
        .describe('3-letter IATA code for the origin airport, e.g. "ATH".'),
      destination: z
        .string()
        .describe(
          '3-letter IATA code for the destination airport, e.g. "BER".',
        ),
      departure_date: z.string().describe('Outbound date in YYYY-MM-DD.'),
      return_date: z
        .string()
        .optional()
        .describe('Optional return date in YYYY-MM-DD for round-trip search.'),
      adults: z
        .number()
        .int()
        .optional()
        .describe('Number of adult travelers. Defaults to 1.'),
      children: z
        .number()
        .int()
        .optional()
        .describe('Number of child travelers. Defaults to 0.'),
      cabin_class: z
        .enum(['economy', 'premium_economy', 'business', 'first'])
        .optional()
        .describe('Cabin class. Defaults to economy.'),
      nonstop_only: z
        .boolean()
        .optional()
        .describe('If true, only direct (nonstop) flights are returned.'),
      max_price: z
        .number()
        .optional()
        .describe('Maximum price per ticket in the requested currency.'),
      preferred_airlines: z
        .array(z.string())
        .optional()
        .describe(
          'Restrict to flights operated by these airlines (IATA codes, e.g. ["A3", "LH"]).',
        ),
      currency: z
        .string()
        .optional()
        .describe(
          'ISO currency code. Defaults to EUR (the only currency the demo API supports).',
        ),
    },
  },
  // Handler for the search_flights tool. Constructs a URL with query parameters based on the input arguments and fetches the results from the flight API.
  // args comes from the inputSchema defined above, and is used to set query parameters for the flight search.
  // URL is constructed using the BASE and FLIGHTS_PATH constants, and query parameters are set using the setParam helper function. (URL() is a built-in class in Node.js and browsers that makes it easy to construct and manipulate URLs.)
  async (args) => callApi(FLIGHTS_PATH, args),
);

// ───────────────────────────────────────────────
// search_hotels
// ───────────────────────────────────────────────

server.registerTool(
  'search_hotels',
  {
    title: 'Search Hotels',
    description:
      'Search for hotels in a city with given check-in / check-out dates. Returns hotels with available rooms across the full stay, including room type, total price, average price per night, amenities, and cancellation policy. Filters: `min_stars`, `max_price` (per night), `breakfast_required`, `free_cancellation`, `pet_friendly`. Results are sorted by price ascending.',
    inputSchema: {
      city: z.string().describe('City name, e.g. "Berlin".'),
      checkin: z.string().describe('Check-in date in YYYY-MM-DD.'),
      checkout: z
        .string()
        .describe(
          'Check-out date in YYYY-MM-DD (exclusive — last night is checkout - 1).',
        ),
      guests: z
        .number()
        .int()
        .optional()
        .describe('Number of guests. Defaults to 2.'),
      rooms: z
        .number()
        .int()
        .optional()
        .describe('Number of rooms required. Defaults to 1.'),
      min_stars: z
        .number()
        .int()
        .optional()
        .describe('Minimum hotel star rating (1–5).'),
      max_price: z
        .number()
        .optional()
        .describe('Maximum average price per night in the requested currency.'),
      currency: z
        .string()
        .optional()
        .describe(
          'ISO currency code. Defaults to EUR (the only currency the demo API supports).',
        ),
      breakfast_required: z
        .boolean()
        .optional()
        .describe('If true, only hotels that include breakfast are returned.'),
      free_cancellation: z
        .boolean()
        .optional()
        .describe(
          'If true, only hotels with a free-cancellation policy are returned.',
        ),
      pet_friendly: z
        .boolean()
        .optional()
        .describe('If true, only pet-friendly hotels are returned.'),
    },
  },
  // Handler for the search_hotels tool. Constructs a URL with query parameters based on the input arguments and fetches the results from the hotel API.
  async (args) => callApi(HOTELS_PATH, args),
);

// ───────────────────────────────────────────────
// Connect
// ───────────────────────────────────────────────

const transport = new StdioServerTransport();

async function main() {
  await server.connect(transport);
  console.error(`[travel MCP] proxying to ${BASE}`);
}

main().catch((error) => {
  console.error('[travel MCP] failed to start:', error);
  process.exit(1);
});
