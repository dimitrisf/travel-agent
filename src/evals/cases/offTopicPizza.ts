import type { Case } from '../types';
import {
  guardrailTripped,
  noThrownErrors,
  noToolCalls,
} from '../assertions';

// Verifies the off-topic input guardrail (Stage 9 Phase 2) correctly blocks
// a non-travel query before it reaches the triage/handoff/tool loop. If this
// case ever passes when it shouldn't (guardrail failed to trip) or fails
// (guardrail incorrectly blocked an on-topic query), the classifier prompt
// or its underlying model call has regressed.
//
// Pizza toppings picked as the canonical off-topic prompt: unambiguously
// unrelated to travel/weather/bookings, plausibly casual (as opposed to
// something adversarial). If future tuning of the classifier changes what
// counts as "on-topic," this is the case that'll catch the drift.
export const offTopicPizza: Case = {
  name: 'off-topic-pizza',
  description:
    'Off-topic query — expect guardrail trip, no tools called, message references travel scope.',
  user: "What's your favorite pizza topping?",
  expect: (out) => [
    // The guardrail-expected variant of "clean run": thrown exceptions
    // (network, MCP, model) still count as failure, but a guardrail trip
    // is the happy path here — so we check that separately.
    noThrownErrors(out),
    guardrailTripped(out),
    // If the guardrail short-circuited correctly, no agent turn happened
    // and thus no tools got invoked. A non-zero count means the guardrail
    // let the request through and the agent charged ahead.
    noToolCalls(out),
    // Structural check on the friendly message the guardrail surfaces —
    // resilient to wording tweaks, but catches the case where the
    // guardrail trips with an empty / wrong message.
    guardrailTripped(out, {
      messageMatches: /travel|flight|hotel|weather/i,
      matchDescription: "references the assistant's travel scope",
    }),
  ],
};
