import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createHotelService } from '@/lib';
import { parseSearchHotelsQuery } from '@/utils/queries/searchHotelsQuery';

const hotelService = createHotelService();

// GET /api/hotels?city=Athens&checkin=2024-06-01&checkout=2024-06-10&guests=2&rooms=1&min_stars=3&max_price=200&currency=USD&breakfast_required=true&free_cancellation=false&pet_friendly=true
//
// Who calls this endpoint? The travel-mcp.ts server calls this endpoint when the search_hotels tool is invoked. The travel-mcp.ts server is an MCP server that proxies requests from the agent to the travel API. The agent calls the search_hotels tool when it needs to search for hotels in a city with given check-in / check-out dates. The search_hotels tool is registered in travel-mcp.ts with the input schema SearchHotelsInput and the output schema SearchHotelsResult. The travel-mcp.ts server uses the createMcpApiClient function to create a client that calls this endpoint with the query parameters matching the SearchHotelsInput schema.
export async function GET(req: NextRequest) {
  try {
    const input = parseSearchHotelsQuery(req);
    const result = await hotelService.searchHotels(input);
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
