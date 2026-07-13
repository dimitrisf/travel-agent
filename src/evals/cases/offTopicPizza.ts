import type { Case } from '../types';

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
    {
      description: 'guardrail tripped (off-topic filter fired)',
      // !! means "truthy" — we don't care what the message is, just that it tripped.
      // Double logical NOT — a JavaScript idiom for coercing any value to a boolean.
      //
      // !x — coerce x to boolean, then flip it. So !undefined → true, !"hello" → false.
      // !!x — do that twice. Result: x coerced to boolean, no flip.
      passed: !!out.guardrailTripped,
      details: out.guardrailTripped ?? '(no guardrail trip)',
    },
    {
      description: 'no unexpected errors',
      passed: !out.errored,
      details: out.errored,
    },
    {
      description: 'no tools were called (agent never ran)',
      // If the guardrail short-circuited correctly, no agent turn happened
      // and thus no tools got invoked. A non-zero count here means the
      // guardrail let the request through and the agent charged ahead.
      passed: out.toolCalls.length === 0,
      details: `tools called: ${out.toolCalls.length} ${
        out.toolCalls.length > 0
          ? `(${out.toolCalls.map((t) => t.name).join(', ')})`
          : ''
      }`,
    },
    {
      description: "guardrail message references the assistant's travel scope",
      // Structural check on the friendly message the guardrail surfaces —
      // resilient to wording tweaks, but catches the case where the
      // guardrail trips but with an empty / wrong message.
      passed: /travel|flight|hotel|weather/i.test(out.guardrailTripped ?? ''),
      details: out.guardrailTripped ?? '(no message)',
    },
  ],
};
