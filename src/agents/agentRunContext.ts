import type { Agent, AgentInputItem } from '@openai/agents';
import { unwrapToolOutput } from '@/utils/toolOutput';

// The shared run-context object we pass into every `run()` call. Its sole
// purpose is to carry a running record of the tools the agent has invoked
// so far, so output guardrails can cross-reference agent claims against
// what actually happened (Stage 11).
//
// Populated from two sources:
//   1. `rebuildCollectorFromHistory` — at the start of a request, walks
//      the client-sent history to reconstruct prior turns' tool calls.
//   2. `attachToolCollectorHook` — during the run, pushes each new
//      tool-end into the same collector via the SDK's `agent_tool_end`
//      lifecycle event.
//
// The collector is READ by output guardrails via `context.context`
// inside their `execute` callback. Guardrails fail open if the collector
// is missing (e.g. `run()` was invoked without a context), so this
// mechanism is additive — nothing breaks if a call site doesn't opt in.
export type ToolCallRecord = {
  // Tool name as the SDK reports it (e.g. 'propose_booking').
  name: string;
  // Parsed args when the SDK gave us a JSON string; raw string otherwise.
  args: unknown;
  // Raw result string as returned by the SDK hook / as it appears in
  // history. For MCP tool outputs this is typically a JSON-wrapped body.
  result: string;
  // Best-effort JSON.parse of `result` — undefined if the tool returned
  // non-JSON text or if parsing failed. Guardrails should treat as optional.
  parsedResult?: unknown;
};

// The run-context object we pass into every `run()` call. Its sole
// purpose is to carry a running record of the tools the agent has invoked
// so far, so output guardrails can cross-reference agent claims against
// what actually happened (Stage 11).
export type AgentRunContext = {
  toolCallCollector: ToolCallRecord[];
};

// Create a fresh AgentRunContext for a new request. The collector is
// empty at the start of a request; it will be populated by
// `rebuildCollectorFromHistory` and `attachToolCollectorHook`.
export function newAgentRunContext(): AgentRunContext {
  return { toolCallCollector: [] };
}

// Walk the client-sent history and reconstruct one ToolCallRecord per
// completed tool call. Function calls and their results are paired by
// `callId`. Items without a matching pair (e.g. an in-flight call at the
// tail of history) are skipped. Image-only outputs are also skipped —
// nothing our guardrails care about lives inside image results.
//
// Runs at the START of every request in the app, so the collector is pre-populated with prior turns' tool calls before the current turn even begins.
// In other words, called once per request, before `run()`, so the current turn's guardrail
// sees the same tool history the current turn's agent sees.
// E.g., history = [
//   { type: 'function_call', callId: 'abc', name: 'foo', arguments: '{}' },
//   { type: 'function_call_result', callId: 'abc', output: { type: 'text', text: '{"x":1}' } }
// ]
// becomes records = [
//   { name: 'foo', args: {}, result: '{"x":1}', parsedResult: { x: 1 } }
// ]
export function rebuildCollectorFromHistory(
  history: AgentInputItem[],
): ToolCallRecord[] {
  // Index the function-call items by callId first so we can look them up
  // when we hit the corresponding results.
  // E.g. history = [
  //   { type: 'function_call', callId: 'abc', name: 'foo', arguments: '{}' },
  //   { type: 'function_call_result', callId: 'abc', output: { type: 'text', text: '{"x":1}' } }
  // ]
  // becomes callsByCallId = { 'abc': { name: 'foo', arguments: '{}' } }
  const callsByCallId = new Map<string, { name: string; arguments: string }>();

  for (const item of history) {
    // Skip anything that isn't a function call. The SDK may emit other
    // items (e.g. text messages) into the history, but we only care about
    // function calls and their results.
    if ((item as { type?: string }).type !== 'function_call') continue;

    // E.g., item = { type: 'function_call', callId: 'abc', name: 'foo', arguments: '{}' }
    const call = item as {
      callId?: string;
      name?: string;
      arguments?: string;
    };

    // Skip any function call that doesn't have a callId, name, or arguments. The SDK may emit malformed items into the history, but we only care about well-formed function calls.
    if (!call.callId || !call.name || call.arguments == null) continue;

    // E.g., callsByCallId = { 'abc': { name: 'foo', arguments: '{}' } }
    callsByCallId.set(call.callId, {
      name: call.name,
      arguments: call.arguments,
    });
  }

  // At this point, callsByCallId could look like:
  // {
  //   'abc': { name: 'foo', arguments: '{}' },
  //   'def': { name: 'bar', arguments: '{"x":1}' }
  // }

  // Now walk the history again, looking for function call results. For
  // each result, look up the corresponding function call by callId and
  // create a ToolCallRecord. Skip any result that doesn't have a matching
  // function call (e.g. an in-flight call at the tail of history).

  const records: ToolCallRecord[] = [];

  for (const item of history) {
    // Skip anything that isn't a function call result. The SDK may emit other
    // items (e.g. text messages) into the history, but we only care about
    // function call results.
    if ((item as { type?: string }).type !== 'function_call_result') continue;

    // At this point, item is a function call result. E.g., item = { type: 'function_call_result', callId: 'abc', output: { type: 'text', text: '{"x":1}' } }
    // We need to look up the corresponding function call by callId and create a ToolCallRecord.
    const result = item as {
      callId?: string;
      output?: { type?: string; text?: string };
    };

    // Skip any function call result that doesn't have a callId. The SDK may emit malformed items into the history, but we only care about well-formed function call results.
    if (!result.callId) continue;

    // Look up the corresponding function call by callId. If we don't find one, skip this result. The SDK may emit results for calls that were never recorded (e.g. if the agent crashed), but we only care about results that have a matching function call.
    const call = callsByCallId.get(result.callId);
    if (!call) continue;

    // At this point, call is the corresponding function call for this result. E.g., call = { name: 'foo', arguments: '{}' }

    // Only text outputs carry payloads the guardrails inspect. Skip
    // image outputs silently — the pair still counted as "a tool ran",
    // but we have no result string to feed cross-reference checks.
    if (
      result.output?.type !== 'text' ||
      typeof result.output.text !== 'string'
    ) {
      continue;
    }

    // E.g., result.output.text = '{"x":1}'
    // call.name = 'foo'
    // call.arguments = '{ "x":1 }'
    // result.output.text = '{"x":2}'
    // becomes records.push({ name: 'foo', args: { x: 1 }, result: '{"x":2}', parsedResult: { x: 2 } })
    records.push(makeRecord(call.name, call.arguments, result.output.text));
  }

  return records;
}

// Wire the SDK's `agent_tool_end` lifecycle event to append into whatever
// AgentRunContext is threaded through this run. Agents are built fresh
// per request/case, so the listener is attached fresh each time — no leak.
//
// Uses `agent_tool_end` (not `agent_tool_start`) because guardrails run
// at final-output time, well after every tool has resolved. `start` would
// add nothing except latency data we don't currently use.
//
// During the current turn, every tool that resolves pushes a fresh record into the same collector. Same shape as the history-rebuilt records.
// E.g., context = { context: { toolCallCollector: [] } }, tool = { name: 'foo' }, result = '{"x":2}', details = { toolCall: { name: 'foo', arguments: '{ "x":1 }', callId: 'abc' } }
// becomes ctx.toolCallCollector.push({ name: 'foo', args: { x: 1 }, result: '{"x":2}', parsedResult: { x: 2 } })
export function attachToolCollectorHook(agent: Agent): void {
  // 'agent_tool_end' is emitted after a tool has finished running, with the result and any details. We use this to populate the AgentRunContext's toolCallCollector with a ToolCallRecord for each completed tool call.
  agent.on('agent_tool_end', (context, tool, result, details) => {
    // The context passed to the hook wraps our AgentRunContext. If the
    // caller didn't opt in (no `context` passed to `run()`), there's
    // nothing to populate — silently skip. The guardrail will fail open (i.e., allow the agent to continue).
    const ctx = context.context as AgentRunContext | undefined;
    if (!ctx?.toolCallCollector) return;

    // At this point, e.g., context = { context: { toolCallCollector: [] } }, tool = { name: 'foo' }, result = '{"x":2}', details = { toolCall: { name: 'foo', arguments: '{ "x":1 }', callId: 'abc' } }
    // We need to extract the tool name and arguments from details.toolCall, normalize the result, and push a ToolCallRecord into ctx.toolCallCollector.
    //
    // The SDK may emit malformed items into the history, but we only care about well-formed function calls. If any of the fields are missing, we fall back to defaults (e.g., '(unknown)' for name, undefined for args).
    const raw = details.toolCall as {
      name?: string;
      arguments?: unknown;
      callId?: string;
    };

    // At this point, raw = { name: 'foo', arguments: '{ "x":1 }', callId: 'abc' }

    const name = raw.name ?? tool.name ?? '(unknown)';

    // E.g, raw.arguments = '{ "x":1 }' becomes args = { x: 1 }
    // If raw.arguments is not a string, we just pass it through as-is. The SDK may emit non-string arguments (e.g., an object), but we only care about string arguments that can be parsed as JSON.
    const args =
      typeof raw.arguments === 'string'
        ? (tryParseJson(raw.arguments) ?? raw.arguments)
        : raw.arguments;

    // E.g, result = '{"x":2}' becomes normalized = '{"x":2}' and parsedResult = { x: 2 }
    const normalized = normalizeResult(result);
    ctx.toolCallCollector.push({
      name,
      args,
      result: normalized,
      parsedResult: tryParseJson(normalized),
    });
  });
}

// Build a ToolCallRecord from raw string args + raw string result. Same
// parsing rules as the hook variant so the two producers stay symmetric.
function makeRecord(
  name: string,
  argsRaw: string,
  resultRaw: string,
): ToolCallRecord {
  // E.g, resultRaw = '{"content":[{"type":"text","text":"{\\"x\\":1}"}]}'
  // becomes normalized = '{"x":1}'
  const normalized = normalizeResult(resultRaw);
  return {
    name,
    // E.g., argsRaw = '{"x":1}' becomes args = { x: 1 }
    args: tryParseJson(argsRaw) ?? argsRaw,
    result: normalized,
    // E.g., normalized = '{"x":1}' becomes parsedResult = { x: 1 }
    parsedResult: tryParseJson(normalized),
  };
}

// If the raw result parses to an MCP-envelope shape (`{ content: [...] }`
// or `{ text: '…' }`), peel back to the inner body string via the same
// helper the streaming route uses. Otherwise pass through. This keeps
// `parsedResult` pointing at the real tool payload (e.g. a Booking
// object), not the transport wrapper.
// The guardrails don't care about the MCP envelope, only the tool's
// actual output. This is a best-effort normalization; if the result is
// malformed or not JSON, we just return it as-is.
//
// E.g.:
//   raw = '{"content":[{"type":"text","text":"{\\"x\\":1}"}]}'
//   normalizeResult(raw) => '{"x":1}'
//   raw = '{"text":"{\\"x\\":1}"}'
//   normalizeResult(raw) => '{"x":1}'
//   raw = 'not json'
//   normalizeResult(raw) => 'not json'
function normalizeResult(raw: string): string {
  const parsed = tryParseJson(raw);
  if (
    parsed &&
    typeof parsed === 'object' &&
    ('content' in parsed || 'text' in parsed)
  ) {
    // E.g., parsed = { content: [{ type: 'text', text: '{"x":1}' }] } or
    // parsed = { text: '{"x":1}' }
    // then unwrapToolOutput(parsed) returns '{"x":1}'
    return unwrapToolOutput(parsed);
  }

  // At this point, the result is either not JSON or not an MCP envelope. Return it as-is.
  return raw;
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
