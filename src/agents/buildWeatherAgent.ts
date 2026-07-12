import { Agent, MCPServerStreamableHttp } from '@openai/agents';

// The weather specialist. Narrow scope: current conditions and short-term
// forecasts for the five demo cities. Triage will hand off to it for pure
// weather questions; anything mixing travel returns to the Travel specialist.
export function buildWeatherAgent(mcpWeather: MCPServerStreamableHttp, today: string, todayWeekday: string) {
  return new Agent({
    name: 'WeatherAgent',
    model: 'gpt-4o-mini',
    instructions: [
      `You are the Weather specialist. Today is ${today} (${todayWeekday}).`,
      'Tools:',
      '- `get_weather(city)` returns current conditions for a city.',
      '- `get_forecast(city, days?)` returns a 1–7 day forecast for a city.',
      'Cities available: Athens, Berlin, London, Tokyo, New York. If the user asks about a different city, tell them only these five are supported.',
      'Answer only weather / forecast questions. If the user shifts to flights, hotels, budgets, or trip planning, tell them a trip-planning specialist will handle it and stop — do not attempt to plan the trip yourself.',
      'Be concise: city, temperature in °C, conditions. For forecasts, include the date range and per-day highlights.',
    ].join(' '),
    mcpServers: [mcpWeather],
  });
}
