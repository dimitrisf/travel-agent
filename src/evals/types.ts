// Shared shapes for the eval harness (Stage 10).

export type Case = {
  // Short kebab-case identifier used for filtering and log labels.
  name: string;
  // One-line explanation of what this case is checking.
  description: string;
  // The user's message that starts the turn.
  user: string;
  // Given the observed run output, return an array of assertion results.
  // Multiple assertions per case make failures self-diagnostic (you see
  // which specific properties held and which didn't).
  expect: (out: CaseOutput) => AssertionResult[];
};

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
};

export type AssertionResult = {
  // What we asserted, in plain English. Rendered next to a ✓ / ✗ in the log.
  description: string;
  // Whether the assertion held.
  passed: boolean;
  // Optional context to print on failure (or always, for debugging).
  details?: string;
};
