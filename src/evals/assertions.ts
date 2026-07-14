import type { AssertionResult, CaseOutput } from './types';

// Shared assertion helpers for eval cases. Each returns an AssertionResult
// so case files can just spread them into their `expect` array. Case-
// specific logic (numeric arithmetic checks, cross-field verification,
// per-tool payload inspection) stays inline in the case that needs it —
// these helpers cover only the patterns that repeat across cases.

// Every case that expects a clean run leads with this. Fails if either an
// exception (network, MCP, model) or a guardrail trip landed. Cases that
// deliberately want a guardrail trip use `noThrownErrors` + `guardrailTripped`
// instead.
export function noErrorsOrGuardrails(out: CaseOutput): AssertionResult {
  return {
    description: 'no unexpected errors or guardrail trips',
    passed: !out.errored && !out.guardrailTripped,
    details: out.errored ?? out.guardrailTripped,
  };
}

// Variant for guardrail-expected cases: the guardrail trip is normal, but
// any thrown exception (network, MCP, model failure) still counts as
// unexpected. Pairs with `guardrailTripped`.
export function noThrownErrors(out: CaseOutput): AssertionResult {
  return {
    description: 'no unexpected errors',
    passed: !out.errored,
    details: out.errored,
  };
}

// Expected-guardrail-trip cases assert this. Optionally, pass a regex to
// also require the surfaced message matches (guards against the guardrail
// tripping with an empty/wrong friendly message).
export function guardrailTripped(
  out: CaseOutput,
  opts?: { messageMatches?: RegExp; matchDescription?: string },
): AssertionResult {
  // `!!x` coerces any value to a boolean. `!` flips to boolean, then `!`
  // flips again — end result: truthy → true, falsy → false. We only care
  // whether a message was set, not what it was.
  const tripped = !!out.guardrailTripped;
  const matchesPattern = opts?.messageMatches
    ? opts.messageMatches.test(out.guardrailTripped ?? '')
    : true;
  const description = opts?.messageMatches
    ? `guardrail tripped and message ${opts.matchDescription ?? `matches ${opts.messageMatches}`}`
    : 'guardrail tripped';
  return {
    description,
    passed: tripped && matchesPattern,
    details: out.guardrailTripped ?? '(no guardrail trip)',
  };
}

export function finalAgent(
  out: CaseOutput,
  name: string,
): AssertionResult {
  return {
    description: `final agent was ${name}`,
    passed: out.lastAgent === name,
    details: `last agent: ${out.lastAgent}`,
  };
}

// Assert that at least one tool call was made with the given name (or one
// of the given names — useful for tools that are semantically
// interchangeable like get_weather / get_forecast).
export function toolCalled(
  out: CaseOutput,
  name: string | string[],
): AssertionResult {
  const names = Array.isArray(name) ? name : [name];
  const passed = out.toolCalls.some((t) => names.includes(t.name));
  return {
    description: `called ${names.join(' or ')}`,
    passed,
    details: `tools called: ${listToolNames(out) || '(none)'}`,
  };
}

// Assert that a specific tool was NOT called — used by cases where a tool
// call would indicate drift (e.g. searching flights before the user gave
// an origin, or invoking flight tools in a hotel-only conversation).
export function toolNotCalled(
  out: CaseOutput,
  name: string,
): AssertionResult {
  const count = out.toolCalls.filter((t) => t.name === name).length;
  return {
    description: `did NOT call ${name}`,
    passed: count === 0,
    details: `${name} calls: ${count}`,
  };
}

// Assert that no tools were called at all. Used by cases where the agent
// is supposed to short-circuit before any tool runs (e.g. an off-topic
// prompt that trips the input guardrail).
export function noToolCalls(out: CaseOutput): AssertionResult {
  return {
    description: 'no tools were called',
    passed: out.toolCalls.length === 0,
    details: `tools called: ${out.toolCalls.length}${
      out.toolCalls.length > 0 ? ` (${listToolNames(out)})` : ''
    }`,
  };
}

// Assert that at least one call to `name` had args satisfying `matcher`.
// `describe` is the human-readable description of what we're matching —
// e.g. "city=Berlin", "no return_date (one-way)".
export function toolArgsMatch(
  out: CaseOutput,
  name: string,
  matcher: (args: unknown) => boolean,
  describe: string,
): AssertionResult {
  const calls = out.toolCalls.filter((t) => t.name === name);
  const passed = calls.some((c) => matcher(c.args));
  return {
    description: `${name} args match: ${describe}`,
    passed,
    details:
      calls.length === 0
        ? `${name} was not called`
        : calls.map((c) => JSON.stringify(c.args)).join(' ; '),
  };
}

export function finalMessageMatches(
  out: CaseOutput,
  pattern: RegExp,
  describe?: string,
): AssertionResult {
  return {
    description: describe ?? `final message matches ${pattern}`,
    passed: pattern.test(out.finalText),
    details: out.finalText.slice(0, 200),
  };
}

export function finalMessageDoesNotMatch(
  out: CaseOutput,
  pattern: RegExp,
  describe?: string,
): AssertionResult {
  return {
    description: describe ?? `final message does not match ${pattern}`,
    passed: !pattern.test(out.finalText),
    details: out.finalText.slice(0, 200),
  };
}

// Small formatting helper used in a couple of the assertion details.
function listToolNames(out: CaseOutput): string {
  return out.toolCalls.map((t) => t.name).join(', ');
}
