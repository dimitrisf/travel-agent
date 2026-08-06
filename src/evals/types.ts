// Shared shapes for the eval harness (Stage 10).

import type { GuardrailFunctionOutput, OutputGuardrail } from '@openai/agents';
import type { ToolCallRecord } from '../agents/agentRunContext';

export type Case = {
  // Short kebab-case identifier used for filtering and log labels.
  name: string;
  // One-line explanation of what this case is checking.
  description: string;
  // Single-turn convenience — exactly equivalent to `turns: [user]`. Set
  // one of `user` or `turns`, not both. Prefer `turns` for multi-turn
  // cases where the sequence matters (Phase 4).
  user?: string;
  // Sequence of user messages for multi-turn cases. Each entry becomes
  // its own turn: the run is invoked once per entry, with the prior
  // history threaded through. Aggregated output (all tool calls, final
  // text/agent from the last turn) is what the case's `expect` sees.
  turns?: string[];
  // Given the observed run output, return an array of assertion results.
  // Multiple assertions per case make failures self-diagnostic (you see
  // which specific properties held and which didn't).
  expect: (out: CaseOutput) => AssertionResult[];
};

// Normalize a Case's user / turns fields into an array. Throws if
// neither is set — caller should have validated that.
export function getTurns(c: Case): string[] {
  if (c.turns && c.turns.length > 0) return c.turns;
  if (c.user) return [c.user];
  throw new Error(
    `Case "${c.name}" has neither \`user\` nor \`turns\` set — nothing to run.`,
  );
}

export type CaseOutput = {
  // Every tool the agent(s) invoked in order, with parsed args, the agent
  // that made the call, and — once the tool returns — the string output and
  // best-effort JSON parse. Both `output` and `parsedOutput` are undefined
  // until the matching tool_call_output_item lands.
  toolCalls: Array<{
    name: string;
    args: unknown;
    agent: string;
    // The string output from the tool, if it returned successfully. Undefined
    // if the tool errored or hasn't returned yet.
    output?: string;
    // Best-effort JSON parse of the tool output. Undefined if the tool errored
    // or hasn't returned yet.
    parsedOutput?: unknown;
  }>;
  // The final assistant text (or empty string if the run failed / was blocked).
  finalText: string;
  // Which agent produced the final output — useful for asserting handoffs.
  lastAgent: string;
  // If an input/output guardrail tripped, its friendly message lands here.
  guardrailTripped?: string;
  // Any other unexpected error (network, MCP, model call, etc.).
  errored?: string;
  // Total 429 retries the runner absorbed across all turns of this case
  // (Stage 17.6). Reported next to the case timing so chronic TPM
  // offenders stay visible even when they pass. Zero on the vast
  // majority of runs.
  retries?: number;
};

export type AssertionResult = {
  // What we asserted, in plain English. Rendered next to a ✓ / ✗ in the log.
  description: string;
  // Whether the assertion held.
  passed: boolean;
  // Optional context to print on failure (or always, for debugging).
  details?: string;
};

// Synthetic guardrail cases — direct-invocation tests for output guardrails.
// Regular Cases run an entire agent turn and check its observable state;
// synthetic cases skip the agent and call `guardrail.execute(...)` with a
// hand-crafted agent output + tool-call collector. Necessary for adversarial
// coverage since the real model won't naturally hallucinate on demand.
//
// Kept separate from Case (rather than a union) because the two shapes
// share nothing — different inputs, different execute path, different
// expect signature. Runner iterates SYNTHETIC_CASES in a second loop after
// CASES with the same reporting.
export type SyntheticGuardrailCase = {
  name: string;
  description: string;
  // The guardrail to test. The runner will call `guardrail.execute(...)` with
  // the provided `agentOutput` and `toolCallCollector`.
  guardrail: OutputGuardrail;
  // The agent output to feed into the guardrail. This is the same shape as
  // the `agentOutput` property of CaseOutput, but the runner doesn't need to
  // run an agent to produce it.
  agentOutput: string;
  // The tool calls the agent made while producing `agentOutput`. The runner
  // will feed these into the guardrail's `toolCallCollector` so it can
  // validate them.
  toolCallCollector: ToolCallRecord[];
  // Given the observed guardrail output, return an array of assertion results.
  // Multiple assertions per case make failures self-diagnostic (you see
  // which specific properties held and which didn't).
  expect: (result: GuardrailFunctionOutput) => AssertionResult[];
};
