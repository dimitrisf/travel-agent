import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createMcpApiClient } from '../lib';

const BASE = process.env.WEATHER_API_BASE ?? 'http://localhost:3000';
const WEATHER_PATH = '/api/weather/current';
const FORECAST_PATH = '/api/weather/forecast';

const { callApi } = createMcpApiClient(BASE);

const server = new McpServer({
  name: 'weather',
  version: '1.0.0',
});

server.registerTool(
  'get_weather',
  {
    title: 'Get Current Weather',
    description: 'Get current weather conditions for a city.',
    inputSchema: {
      city: z.string().describe('City name, e.g. "Athens"'),
    },
  },
  async (args) => callApi(WEATHER_PATH, args),
);

server.registerTool(
  'get_forecast',
  {
    title: 'Get Forecast',
    description: 'Get an N-day forecast for a city.',
    inputSchema: {
      city: z.string().describe('City name'),
      days: z
        .number()
        .int()
        .min(1)
        .max(7)
        .optional()
        .describe('Number of days to forecast (1–7). Defaults to 3.'),
    },
  },
  async (args) => callApi(FORECAST_PATH, args),
);

const transport = new StdioServerTransport();

async function main() {
  await server.connect(transport);
  console.error(`[weather MCP] proxying to ${BASE}`);
}

main().catch((error) => {
  console.error('[weather MCP] failed to start:', error);
  process.exit(1);
});
