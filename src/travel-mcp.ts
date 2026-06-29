import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const FLIGHT_BASE = process.env.FLIGHT_API_BASE ?? 'http://localhost:3001';
const HOTEL_BASE = process.env.HOTEL_API_BASE ?? 'http://localhost:3002';

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
  async (args) => {
    const url = new URL('/flights', FLIGHT_BASE);
    setParam(url, 'origin', args.origin);
    setParam(url, 'destination', args.destination);
    setParam(url, 'departure_date', args.departure_date);
    setParam(url, 'return_date', args.return_date);
    setParam(url, 'adults', args.adults);
    setParam(url, 'children', args.children);
    setParam(url, 'cabin_class', args.cabin_class);
    setParam(url, 'nonstop_only', args.nonstop_only);
    setParam(url, 'max_price', args.max_price);
    setParam(url, 'preferred_airlines', args.preferred_airlines);
    setParam(url, 'currency', args.currency);
    return fetchAsToolResult(url);
  },
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
  async (args) => {
    const url = new URL('/hotels', HOTEL_BASE);
    setParam(url, 'city', args.city);
    setParam(url, 'checkin', args.checkin);
    setParam(url, 'checkout', args.checkout);
    setParam(url, 'guests', args.guests);
    setParam(url, 'rooms', args.rooms);
    setParam(url, 'min_stars', args.min_stars);
    setParam(url, 'max_price', args.max_price);
    setParam(url, 'currency', args.currency);
    setParam(url, 'breakfast_required', args.breakfast_required);
    setParam(url, 'free_cancellation', args.free_cancellation);
    setParam(url, 'pet_friendly', args.pet_friendly);
    return fetchAsToolResult(url);
  },
);

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

// Helper to set a query parameter on a URL, skipping undefined or null values. Arrays are joined with commas.
// e.g. setParam(url, 'preferred_airlines', ['A3', 'LH']) → ?preferred_airlines=A3,LH
// e.g. setParam(url, 'max_price', undefined) → (no query parameter added)
// e.g. setParam(url, 'cabin_class', 'economy') → ?cabin_class=economy
// e.g. setParam(url, 'nonstop_only', true) → ?nonstop_only=true
// e.g. setParam(url, 'nonstop_only', false) → ?nonstop_only=false
// e.g. setParam(url, 'return_date', null) → (no query parameter added)
// e.g. setParam(url, 'return_date', '2024-07-01') → ?return_date=2024-07-01
// e.g. setParam(url, 'preferred_airlines', []) → ?preferred_airlines= (empty string)
function setParam(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  url.searchParams.set(
    key,
    Array.isArray(value) ? value.join(',') : String(value),
  );
}

// Helper to fetch a URL and return the result in the format expected by the MCP server. Returns an object with `content` (array of text blocks) and `isError` (boolean indicating if the response was not OK).
async function fetchAsToolResult(url: URL) {
  const r = await fetch(url);
  const text = await r.text();
  return {
    content: [{ type: 'text' as const, text }],
    isError: !r.ok,
  };
}

// ───────────────────────────────────────────────
// Connect
// ───────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[travel MCP] proxying flights → ${FLIGHT_BASE}, hotels → ${HOTEL_BASE}`,
);
