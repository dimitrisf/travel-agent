import { forecastAttributionOutputGuardrail } from '@/guardrails/forecastAttributionOutputGuardrail';
import type { SyntheticGuardrailCase } from '../types';

// Adversarial-complement — Stage 12 forecast-attribution layer.
// The MUST-NOT-TRIP case. Same shape as the out-of-range sibling case,
// but the date the reply talks about (July 18) IS inside the covered
// range (2026-07-17..2026-07-23). The classifier should recognize the
// coverage and pass through.
//
// False-positive regression check. If the classifier trips here, it's
// blocking a legitimate forecast quote — a UX failure as bad as letting
// drift through. Balances the two must-trip vectors above.
export const weatherClaimWithinCoverageAllowed: SyntheticGuardrailCase = {
  name: 'synthetic-weather-claim-within-coverage-allowed',
  description:
    'Agent quotes weather for a date INSIDE the forecast coverage — forecast-attribution guardrail must NOT trip.',
  guardrail: forecastAttributionOutputGuardrail,
  agentOutput:
    'The forecast for Berlin shows partly cloudy skies on July 18 with a high of 25°C — pleasant weather for the day.',
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
    // The guardrail must NOT trip because July 18 falls within the
    // covered range 2026-07-17..2026-07-23 and the reply's specifics
    // (25°C, partly cloudy) match the returned forecast day.
    {
      description: 'tripwire NOT triggered (weather claim within coverage)',
      passed: result.tripwireTriggered === false,
      details: `tripwireTriggered=${result.tripwireTriggered}, outputInfo=${JSON.stringify(result.outputInfo)}`,
    },
  ],
};
