import type { Case } from '../types';

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
    {
      description: 'no unexpected errors or guardrail trips',
      passed: !out.errored && !out.guardrailTripped,
      details: out.errored ?? out.guardrailTripped,
    },
    {
      description: 'called get_weather or get_forecast',
      passed: out.toolCalls.some(
        (t) => t.name === 'get_weather' || t.name === 'get_forecast',
      ),
      details: `tools called: ${
        out.toolCalls.map((t) => t.name).join(', ') || '(none)'
      }`,
    },
    {
      description: 'final agent was WeatherAgent',
      passed: out.lastAgent === 'WeatherAgent',
      details: `last agent: ${out.lastAgent}`,
    },
    {
      description: 'final message mentions Berlin',
      passed: /berlin/i.test(out.finalText),
      details: out.finalText.slice(0, 120),
    },
  ],
};
