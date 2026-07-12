import type { OutputGuardrail } from '@openai/agents';

// Stub output guardrail — never trips. Wired in Phase 1 of Stage 9 to
// establish the plumbing without changing agent behaviour. The real
// booking-truthfulness output guardrail lands in Phase 3.
//
// The Agents SDK invokes each output guardrail with { agent, agentOutput,
// context } after the model produces its final text. If any guardrail returns
// tripwireTriggered: true, the SDK throws OutputGuardrailTripwireTriggered
// from run() — caught by app/api/agent/route.ts in later phases.
export const passThroughOutputGuardrail: OutputGuardrail = {
  name: 'pass_through_output',
  async execute() {
    return { tripwireTriggered: false, outputInfo: null };
  },
};
