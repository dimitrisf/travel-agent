import type { Case } from '../types';
import {
  finalAgent,
  finalMessageMatches,
  noErrorsOrGuardrails,
  toolCalled,
} from '../assertions';

// Simplest possible on-topic case. Verifies:
//   - the off-topic guardrail lets weather queries through
//   - triage hands off to WeatherAgent
//   - the specialist calls one of the weather tools
//   - the final message actually references Berlin
// If this fails, something structural is broken (MCP init, guardrail
// misfiring, wrong handoff). Sanity check for the whole loop.
export const weatherInBerlin: Case = {
  name: 'weather-in-berlin',
  description:
    'Simple weather query — hand off to WeatherAgent, call a weather tool, mention Berlin.',
  user: 'What is the weather in Berlin?',
  expect: (out) => [
    noErrorsOrGuardrails(out),
    toolCalled(out, ['get_weather', 'get_forecast']),
    finalAgent(out, 'WeatherAgent'),
    finalMessageMatches(out, /berlin/i, 'final message mentions Berlin'),
  ],
};
