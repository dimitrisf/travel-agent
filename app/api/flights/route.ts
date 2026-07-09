import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/apiErrorResponse';
import {
  createFlightService,
  parseBool,
  parseList,
  type SearchFlightsInput,
} from '@/lib';

const flightService = createFlightService();

// GET /api/flights?origin=JFK&destination=LAX&departure_date=2024-06-01&return_date=2024-06-10&adults=2&children=1&cabin_class=economy&nonstop_only=true&max_price=500&preferred_airlines=Delta,United&currency=USD
//
// Who calls this endpoint? The travel-mcp.ts server calls this endpoint when the search_flights tool is invoked. The travel-mcp.ts server is an MCP server that proxies requests from the agent to the travel API. The agent calls the search_flights tool when it needs to search for flights between two airports on a specific date. The search_flights tool is registered in travel-mcp.ts with the input schema SearchFlightsInput and the output schema SearchFlightsResult. The travel-mcp.ts server uses the createMcpApiClient function to create a client that calls this endpoint with the query parameters matching the SearchFlightsInput schema.
export async function GET(req: NextRequest) {
  try {
    const input = parseSearchFlightsQuery(req);
    const result = await flightService.searchFlights(input);
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

// Helper function to parse the query parameters from the request URL and return a SearchFlightsInput object. This function handles optional parameters and converts them to the appropriate types (e.g., number, boolean, array).
function parseSearchFlightsQuery(req: NextRequest): SearchFlightsInput {
  const q = req.nextUrl.searchParams;
  return {
    origin: String(q.get('origin') ?? ''),
    destination: String(q.get('destination') ?? ''),
    departure_date: String(q.get('departure_date') ?? ''),
    return_date: q.get('return_date') ?? undefined,
    adults: q.get('adults') !== null ? Number(q.get('adults')) : undefined,
    children:
      q.get('children') !== null ? Number(q.get('children')) : undefined,
    cabin_class:
      q.get('cabin_class') !== null
        ? (String(q.get('cabin_class')) as SearchFlightsInput['cabin_class'])
        : undefined,
    nonstop_only: parseBool(q.get('nonstop_only')),
    max_price:
      q.get('max_price') !== null ? Number(q.get('max_price')) : undefined,
    preferred_airlines: parseList(q.get('preferred_airlines')),
    currency: q.get('currency') ?? undefined,
  };
}
