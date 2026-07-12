import { MCPServerStreamableHttp } from '@openai/agents';
import { WEEKDAY_NAMES, upcomingFridaysFrom } from '@/utils/dates';
import { buildTravelAgent } from './buildTravelAgent';
import { buildTriageAgent } from './buildTriageAgent';
import { buildWeatherAgent } from './buildWeatherAgent';

// Wire the three agents together for one turn. Returns the triage as the entry
// point; the Runner walks handoffs as they happen.
export function buildAgentGraph(
  mcpTravel: MCPServerStreamableHttp,
  mcpWeather: MCPServerStreamableHttp,
) {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const today = now.toISOString().slice(0, 10);
  const todayWeekday = WEEKDAY_NAMES[now.getUTCDay()];
  const upcomingFridays = upcomingFridaysFrom(now);

  const weatherAgent = buildWeatherAgent(mcpWeather, today, todayWeekday);
  const travelAgent = buildTravelAgent(
    mcpTravel,
    mcpWeather,
    today,
    todayWeekday,
    upcomingFridays,
  );
  return buildTriageAgent(weatherAgent, travelAgent);
}
