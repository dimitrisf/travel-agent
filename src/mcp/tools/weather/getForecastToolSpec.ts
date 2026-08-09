import type { McpToolSpec } from '@/mcp/mcpHttpHandler';
import type { createMcpApiClient } from '@/mcp/mcpApiClient';

type ApiClient = ReturnType<typeof createMcpApiClient>;

export function makeGetForecastToolSpec(callApi: ApiClient['callApi']): McpToolSpec {
  return {
    name: 'get_forecast',
    title: 'Get Forecast',
    description:
      'Get an N-day forecast for a city. Response includes `requestedDays` and `providedDays` fields — `providedDays` may be less than requested if the underlying weather source caps the horizon (e.g. OpenWeatherMap free tier: 5-day maximum).',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name.' },
        days: {
          type: 'integer',
          description: 'Number of days to forecast (1–7). Defaults to 3.',
        },
      },
      required: ['city'],
    },
    handler: async (args) => callApi('/api/weather/forecast', args),
  };
}
