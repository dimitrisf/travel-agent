import type { AgentInputItem } from '@openai/agents';

// Reconstruct the AgentInputItem[] to persist for a turn that ended in
// a guardrail trip. Extracted from app/api/agent/route.ts so the
// deterministic item construction is unit-testable in isolation from
// the persistence side effect (appendTurn).
//
// Returned items, in order:
//   1. The user's message (rebuilt from `userInput`).
//   2. Any function_call / function_call_result items the stream
//      captured before the trip. Output guardrails trip after tools
//      may have run; input guardrails trip before any tool runs, so
//      this slice is empty for input trips.
//   3. A synthetic assistant message carrying the guardrail's friendly
//      text (`message`).
//
// The offending final assistant text (if any) is deliberately dropped
// — the client replaced it with the friendly notice live, so refresh
// shouldn't show it either. Only function_call / function_call_result
// items pass through the filter; assistant items in the stream slice
// are stripped.
// E.g., if params = {
//   userInput: "Book that hotel",
//   streamHistory: [
//     // Prior turn — excluded by the slice below.
//     { role: 'user', content: "What hotels are in Athens?" },
//     { role: 'assistant', content: [{ type: 'output_text', text: "Here are some…" }] },
//     // This turn — the slice starts here.
//     { role: 'user', content: "Book that hotel" },
//     { type: 'function_call', callId: 'c1', name: 'propose_booking', arguments: '{}' },
//     { type: 'function_call_result', callId: 'c1',
//       output: { type: 'text', text: '{"reference":"BKG-1"}' } },
//     { role: 'assistant', content: [{ type: 'output_text', text: "OFFENDING TEXT" }] },
//   ],
//   priorHistoryLength: 2,
//   message: "I can't confirm bookings that way.",
// }
// then the return value is:
// [
//   { role: 'user', content: "Book that hotel" },
//   { type: 'function_call', callId: 'c1', name: 'propose_booking', arguments: '{}' },
//   { type: 'function_call_result', callId: 'c1',
//     output: { type: 'text', text: '{"reference":"BKG-1"}' } },
//   { role: 'assistant', content: [{ type: 'output_text', text: "I can't confirm bookings that way." }] },
// ]
// Note the SDK shape: tool calls and results are TOP-LEVEL items with
// their own `type` field (not nested inside an assistant.content
// array). That's what the filter below tests for.
export function buildGuardrailBlockedItems(params: {
  userInput: string;
  streamHistory: AgentInputItem[];
  priorHistoryLength: number;
  message: string;
}): AgentInputItem[] {
  const { userInput, streamHistory, priorHistoryLength, message } = params;

  // streamHistory is the full conversation history including this turn.
  // We slice from priorHistoryLength (i.e. history.length in the caller)
  // to isolate just the items added during this turn — the user's
  // message and any tool calls that ran before the trip.
  // E.g., continuing the block-comment example above with
  // priorHistoryLength = 2 and streamHistory = [
  //   { role: 'user', content: "What hotels are in Athens?" },
  //   { role: 'assistant', content: [{ type: 'output_text', text: "Here are some…" }] },
  //   { role: 'user', content: "Book that hotel" },
  //   { type: 'function_call', callId: 'c1', name: 'propose_booking', arguments: '{}' },
  //   { type: 'function_call_result', callId: 'c1',
  //     output: { type: 'text', text: '{"reference":"BKG-1"}' } },
  //   { role: 'assistant', content: [{ type: 'output_text', text: "OFFENDING TEXT" }] },
  // ]
  // then streamNew = [
  //   { role: 'user', content: "Book that hotel" },
  //   { type: 'function_call', callId: 'c1', name: 'propose_booking', arguments: '{}' },
  //   { type: 'function_call_result', callId: 'c1',
  //     output: { type: 'text', text: '{"reference":"BKG-1"}' } },
  //   { role: 'assistant', content: [{ type: 'output_text', text: "OFFENDING TEXT" }] },
  // ]
  const streamNew = streamHistory.slice(priorHistoryLength);

  // Keep only tool calls and tool call results. Assistant text is
  // dropped (see block comment above).
  const toolItems = streamNew.filter((item) => {
    const t = (item as { type?: string }).type;
    return t === 'function_call' || t === 'function_call_result';
  });

  return [
    { role: 'user', content: userInput } as AgentInputItem,
    ...toolItems,
    {
      role: 'assistant',
      content: [{ type: 'output_text', text: message }],
    } as AgentInputItem,
  ];
}
