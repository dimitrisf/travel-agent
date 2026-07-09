import { createMcpApiClient } from '@/lib';
import {
  createMcpHttpHandler,
  type McpToolSpec,
} from '@/lib/mcpHttpHandler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE =
  process.env.WEATHER_API_BASE ??
  `http://localhost:${process.env.PORT ?? 3000}`;
const { callApi } = createMcpApiClient(BASE);

const getWeather: McpToolSpec = {
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

const getForecast: McpToolSpec = {
  name: 'get_forecast',
  title: 'Get Forecast',
  description: 'Get an N-day forecast for a city.',
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

export const POST = createMcpHttpHandler({
  name: 'weather',
  version: '1.0.0',
  tools: [getWeather, getForecast],
});
