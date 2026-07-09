import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/apiErrorResponse';
import { createHotelService, parseBool, type SearchHotelsInput } from '@/lib';

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

// Helper function to parse the query parameters from the request URL and return a SearchHotelsInput object. This function handles optional parameters and converts them to the appropriate types (e.g., number, boolean).
function parseSearchHotelsQuery(req: NextRequest): SearchHotelsInput {
  const q = req.nextUrl.searchParams;
  return {
    city: String(q.get('city') ?? ''),
    checkin: String(q.get('checkin') ?? ''),
    checkout: String(q.get('checkout') ?? ''),
    guests: q.get('guests') !== null ? Number(q.get('guests')) : undefined,
    rooms: q.get('rooms') !== null ? Number(q.get('rooms')) : undefined,
    min_stars:
      q.get('min_stars') !== null ? Number(q.get('min_stars')) : undefined,
    max_price:
      q.get('max_price') !== null ? Number(q.get('max_price')) : undefined,
    currency: q.get('currency') ?? undefined,
    breakfast_required: parseBool(q.get('breakfast_required')),
    free_cancellation: parseBool(q.get('free_cancellation')),
    pet_friendly: parseBool(q.get('pet_friendly')),
  };
}
