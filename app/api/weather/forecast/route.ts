import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/apiErrorResponse';
import { createWeatherService } from '@/lib';

const weatherService = createWeatherService();

// GET /api/weather/forecast?city=Athens&days=3
//
// Who calls this endpoint? The weather-mcp.ts server calls this endpoint when the get_forecast tool is invoked. The weather-mcp.ts server is an MCP server that proxies requests from the agent to the weather API. The agent calls the get_forecast tool when it needs to get an N-day forecast for a city. The get_forecast tool is registered in weather-mcp.ts with the input schema { city: string, days?: number } and the output schema ForecastResult. The weather-mcp.ts server uses the createMcpApiClient function to create a client that calls this endpoint with the city and days query parameters.
export async function GET(req: NextRequest) {
  const daysParam = req.nextUrl.searchParams.get('days');
  try {
    const result = await weatherService.getForecast({
      // We parse the city and days query parameters from the request URL. If the city is not provided, we default to an empty string. If days is not provided, we leave it as undefined, which allows the weather service to use its default value (3 days).
      city: String(req.nextUrl.searchParams.get('city') ?? ''),
      days: daysParam !== null ? Number(daysParam) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
