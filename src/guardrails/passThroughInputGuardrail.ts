import type { InputGuardrail } from '@openai/agents';

// Stub input guardrail — never trips. Wired in Phase 1 of Stage 9 to
// establish the plumbing without changing agent behaviour. Real input
// guardrails (topic filter, prompt-injection defense) land in Phases 2 and 4.
//
// The Agents SDK invokes each input guardrail with { agent, input, context }
// before the model turn begins. If any guardrail returns tripwireTriggered:
// true, the run halts and the SDK throws InputGuardrailTripwireTriggered from
// run() — caught by app/api/agent/route.ts and forwarded as an 'error' SSE
// frame in later phases.
export const passThroughInputGuardrail: InputGuardrail = {
  name: 'pass_through_input',
  async execute() {
    return { tripwireTriggered: false, outputInfo: null };
  },
};
