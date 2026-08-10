import { createMcpApiClient } from '@/mcp/mcpApiClient';
import { createMcpHttpHandler } from '@/mcp/mcpHttpHandler';
import { makeGetWeatherToolSpec } from '@/mcp/tools/weather/getWeatherToolSpec';
import { makeGetForecastToolSpec } from '@/mcp/tools/weather/getForecastToolSpec';
import { getDefaultAppBase } from '@/utils/appBase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE = process.env.WEATHER_API_BASE ?? getDefaultAppBase();
const { callApi } = createMcpApiClient(BASE);

export const POST = createMcpHttpHandler({
  name: 'weather',
  version: '1.0.0',
  tools: [makeGetWeatherToolSpec(callApi), makeGetForecastToolSpec(callApi)],
});
