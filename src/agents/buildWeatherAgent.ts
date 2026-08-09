import { Agent, MCPServerStreamableHttp } from '@openai/agents';
import { forecastAttributionOutputGuardrail } from '@/guardrails/forecastAttributionOutputGuardrail';
import { CITY_NAMES } from '@/lib/cities';
import { attachToolCollectorHook } from './agentRunContext';

// The weather specialist. Narrow scope: current conditions and short-term
// forecasts for the five demo cities. Triage will hand off to it for pure
// weather questions; anything mixing travel returns to the Travel specialist.
//
// Only output guardrails live here — input guardrails on non-entry agents
// never fire (SDK contract). The Stage 12 forecast-attribution guardrail
// runs here (same one wired on TravelAgent) so weather claims made from
// WeatherAgent are also cross-checked against get_forecast / get_weather
// tool history.
export function buildWeatherAgent(
  mcpWeather: MCPServerStreamableHttp,
  today: string,
  todayWeekday: string,
) {
  const agent = new Agent({
    name: 'WeatherAgent',
    model: 'gpt-4o-mini',
    outputGuardrails: [forecastAttributionOutputGuardrail],
    instructions: [
      `You are the Weather specialist. Today is ${today} (${todayWeekday}).`,
      'Tools:',
      '- `get_weather(city)` returns current conditions for a city.',
      '- `get_forecast(city, days?)` returns a 1–7 day forecast for a city.',
      `Cities available: ${CITY_NAMES.join(', ')}. If the user asks about a different city, tell them only these ${CITY_NAMES.length} are supported.`,
      'Answer only weather / forecast questions. If the user shifts to flights, hotels, budgets, or trip planning, tell them a trip-planning specialist will handle it and stop — do not attempt to plan the trip yourself.',
      'Be concise: city, temperature in °C, conditions. For forecasts, include the date range and per-day highlights.',
      'FORECAST HORIZON RULE: the `get_forecast` tool response carries `requestedDays` and `providedDays` fields. If `providedDays` is less than `requestedDays` (e.g., you asked for 7 but got 5), you MUST explicitly acknowledge the shortfall in your first sentence — required phrasing: "The forecast horizon only extends {providedDays} days, so I can show you the next {providedDays} rather than the {requestedDays} you asked about:" — and NEVER frame the response as an N-day forecast when fewer days actually came back. Do NOT parrot the user\'s requested count in prose if the tool delivered less.',
    ].join(' '),
    mcpServers: [mcpWeather],
  });
  // Wire the SDK's `agent_tool_end` event to push each completed tool
  // call into the RunContext's collector. The forecast-attribution
  // guardrail reads the collector to verify date claims against real
  // get_forecast / get_weather outputs. Fresh listener per built agent
  // — agents are built per request/case, no leak.
  //
  // Before this, only TravelAgent had attachToolCollectorHook. That was a latent gap from Stage 11: when WeatherAgent called get_forecast or get_weather, those calls weren't populating the collector because no hook was listening on WeatherAgent. Which means if a pure-weather turn made a bad claim, the collector would be empty when the guardrail read it, and Phase 4's fail-open would silently skip. Stage 12 closes that gap for both agents.
  attachToolCollectorHook(agent);
  return agent;
}
