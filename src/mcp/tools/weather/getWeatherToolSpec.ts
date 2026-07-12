import type { McpToolSpec } from '@/mcp/mcpHttpHandler';
import type { createMcpApiClient } from '@/mcp/mcpApiClient';

type ApiClient = ReturnType<typeof createMcpApiClient>;

export function makeGetWeatherToolSpec(callApi: ApiClient['callApi']): McpToolSpec {
  return {
    name: 'get_weather',
    title: 'Get Current Weather',
    description: 'Get current weather conditions for a city.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name, e.g. "Athens".' },
      },
      required: ['city'],
    },
    handler: async (args) => callApi('/api/weather/current', args),
  };
}
