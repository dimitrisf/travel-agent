import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = process.env.WEATHER_API_BASE ?? 'http://localhost:3000';

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
  async ({ city }) => {
    const url = new URL('/weather', BASE);
    url.searchParams.set('city', city);
    const r = await fetch(url);
    const text = await r.text();
    // Return the raw JSON text from the REST API, along with an error flag if the response was not OK
    return {
      content: [{ type: 'text', text }],
      isError: !r.ok,
    };
  },
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
  async ({ city, days }) => {
    const url = new URL('/forecast', BASE);
    url.searchParams.set('city', city);
    if (days !== undefined) url.searchParams.set('days', String(days));
    const r = await fetch(url);
    const text = await r.text();
    // Return the raw JSON text from the REST API, along with an error flag if the response was not OK
    return {
      content: [{ type: 'text', text }],
      isError: !r.ok,
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[weather MCP] proxying to ${BASE}`);
