import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/apiErrorResponse';
import { createWeatherService } from '@/lib';

const weatherService = createWeatherService();

// GET /api/weather/current?city=Athens
//
// Who calls this endpoint? The weather-mcp.ts server calls this endpoint when the get_weather tool is invoked. The weather-mcp.ts server is an MCP server that proxies requests from the agent to the weather API. The agent calls the get_weather tool when it needs to get current weather conditions for a city. The get_weather tool is registered in weather-mcp.ts with the input schema { city: string } and the output schema CurrentWeatherResult. The weather-mcp.ts server uses the createMcpApiClient function to create a client that calls this endpoint with the city query parameter.
export async function GET(req: NextRequest) {
  try {
    const result = await weatherService.getCurrentWeather({
      // We parse the city query parameter from the request URL. If it is not provided, we default to an empty string. This allows the weather service to handle the case where no city is specified.
      city: String(req.nextUrl.searchParams.get('city') ?? ''),
    });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
