import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { assertNoPastDates } from '@/utils/dateGuards';
import { createFlightService } from '@/lib';
import { parseSearchFlightsQuery } from '@/utils/queries/searchFlightsQuery';

const flightService = createFlightService();

// GET /api/flights?origin=JFK&destination=LAX&departure_date=2024-06-01&return_date=2024-06-10&adults=2&children=1&cabin_class=economy&nonstop_only=true&max_price=500&preferred_airlines=Delta,United&currency=USD
//
// Who calls this endpoint? The travel-mcp.ts server calls this endpoint when the search_flights tool is invoked. The travel-mcp.ts server is an MCP server that proxies requests from the agent to the travel API. The agent calls the search_flights tool when it needs to search for flights between two airports on a specific date. The search_flights tool is registered in travel-mcp.ts with the input schema SearchFlightsInput and the output schema SearchFlightsResult. The travel-mcp.ts server uses the createMcpApiClient function to create a client that calls this endpoint with the query parameters matching the SearchFlightsInput schema.
export async function GET(req: NextRequest) {
  try {
    const input = parseSearchFlightsQuery(req);
    // Reject past dates at the boundary — services stay lenient so
    // internal test fixtures pinned to fixed dates keep working.
    // Covers Explorer, Assistant (via MCP), and any direct HTTP
    // caller with the same guard in one place.
    assertNoPastDates([
      ['departure_date', input.departure_date],
      ['return_date', input.return_date],
    ]);
    const result = await flightService.searchFlights(input);
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
