import { forecastAttributionOutputGuardrail } from '@/guardrails/forecastAttributionOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial synthetic — Stage 12 forecast-attribution layer.
// The canonical failure mode: agent asserts weather for dates BEYOND
// what get_forecast returned. Collector below covers 2026-07-17 through
// 2026-07-23 (7 days); the reply claims sunshine on July 24, one day
// past coverage. The classifier must recognize the out-of-range date
// and trip.
//
// If this ever passes when it shouldn't, either the classifier is
// mis-prompted or the tool-history summary isn't surfacing the covered
// date range clearly enough for the model to reason about.
export const weatherClaimOutsideCoverageTrips: SyntheticGuardrailCase = {
  name: 'synthetic-weather-claim-outside-coverage-trips',
  description:
    'Agent asserts weather for a date beyond what get_forecast returned — forecast-attribution guardrail must trip.',
  guardrail: forecastAttributionOutputGuardrail,
  agentOutput:
    'Expect sunny skies on July 24 with a high of 27°C — a great day for your trip.',
  toolCallCollector: [
    {
      name: 'get_forecast',
      args: { city: 'Berlin', days: 7 },
      result:
        '{"city":"Berlin","days":[{"date":"2026-07-17","tempCMin":18,"tempCMax":26,"conditions":"sunny"},{"date":"2026-07-18","tempCMin":17,"tempCMax":25,"conditions":"partly cloudy"},{"date":"2026-07-19","tempCMin":16,"tempCMax":24,"conditions":"clear"},{"date":"2026-07-20","tempCMin":18,"tempCMax":27,"conditions":"sunny"},{"date":"2026-07-21","tempCMin":19,"tempCMax":28,"conditions":"sunny"},{"date":"2026-07-22","tempCMin":17,"tempCMax":25,"conditions":"partly cloudy"},{"date":"2026-07-23","tempCMin":16,"tempCMax":23,"conditions":"cloudy"}],"units":"celsius"}',
      parsedResult: {
        city: 'Berlin',
        days: [
          { date: '2026-07-17', tempCMin: 18, tempCMax: 26, conditions: 'sunny' },
          { date: '2026-07-18', tempCMin: 17, tempCMax: 25, conditions: 'partly cloudy' },
          { date: '2026-07-19', tempCMin: 16, tempCMax: 24, conditions: 'clear' },
          { date: '2026-07-20', tempCMin: 18, tempCMax: 27, conditions: 'sunny' },
          { date: '2026-07-21', tempCMin: 19, tempCMax: 28, conditions: 'sunny' },
          { date: '2026-07-22', tempCMin: 17, tempCMax: 25, conditions: 'partly cloudy' },
          { date: '2026-07-23', tempCMin: 16, tempCMax: 23, conditions: 'cloudy' },
        ],
        units: 'celsius',
      },
    },
  ],
  expect: (result) => [
    // The guardrail must trip because July 24 is outside the covered range
    // 2026-07-17..2026-07-23.
    {
      description: 'tripwire triggered',
      passed: result.tripwireTriggered === true,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
    // patternName should be "unbacked-forecast" — confirms the classifier
    // (not some upstream shortcut) is what tripped.
    {
      description: 'outputInfo.patternName is "unbacked-forecast"',
      passed:
        (result.outputInfo as { patternName?: unknown })?.patternName ===
        'unbacked-forecast',
      details: `patternName=${(result.outputInfo as { patternName?: unknown })?.patternName}`,
    },
  ],
};
