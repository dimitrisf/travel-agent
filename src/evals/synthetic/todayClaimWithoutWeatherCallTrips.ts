import { forecastAttributionOutputGuardrail } from '@/guardrails/forecastAttributionOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — Stage 12 forecast-attribution layer.
// Second must-trip vector: the agent makes a "today" / "currently"
// weather assertion but the collector is empty (no get_weather call).
// Different code path from the out-of-range case — validates that the
// classifier catches the empty-history branch too, not just the
// dates-outside-range one.
//
// Kept concise on purpose. The agent output uses "currently" as the
// present-tense anchor, plus a specific temperature reading, exactly
// the kind of concrete claim that carries fabrication risk.
export const todayClaimWithoutWeatherCallTrips: SyntheticGuardrailCase = {
  name: 'synthetic-today-claim-without-weather-call-trips',
  description:
    'Agent asserts current-conditions weather with no get_weather call — forecast-attribution guardrail must trip.',
  guardrail: forecastAttributionOutputGuardrail,
  agentOutput:
    "It's currently 22°C and partly cloudy in Berlin — pleasant conditions right now.",
  toolCallCollector: [],
  expect: (result) => [
    // The guardrail must trip because the collector is empty and the
    // reply asserts current-conditions weather.
    {
      description: 'tripwire triggered',
      passed: result.tripwireTriggered === true,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
    {
      description: 'outputInfo.patternName is "unbacked-forecast"',
      passed:
        (result.outputInfo as { patternName?: unknown })?.patternName ===
        'unbacked-forecast',
      details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
    },
  ],
};
