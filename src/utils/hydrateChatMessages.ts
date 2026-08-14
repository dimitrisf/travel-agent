import type { AgentInputItem } from '@openai/agents';
import type { ChatMessage } from '@/types/chat';
import { isGuardrailNotice } from './guardrailNotice';
import { unwrapToolOutput } from './toolOutput';

// Convert a canonical AgentInputItem[] history into ChatMessage[] bubbles
// for display. Used when loading /c/[id] — the DB stores the canonical
// history (that's what the agent's run() consumes), and this function
// derives the UI-facing bubble structure from it.
//
// Grouping rule: each user turn opens a new user bubble AND a new agent
// bubble; every function_call / function_call_result / assistant /
// guardrail_notice message that follows before the next user turn
// accumulates onto the current agent bubble. This mirrors what
// useAgentChat builds up live via SSE events — the loaded page should
// look identical to the just-chatted one.
//
// UI-only concepts (handoffs, streaming pending state) don't survive
// persistence — they're transient turn-metadata. Restored bubbles show
// `handoffs: []` and `pending: false`. `blockedBy` DOES survive —
// carried by a `guardrail_notice` item (see guardrailNotice.ts).
//
// Example — a simple "what's the weather in Athens?" turn:
//
//   history = [
//     { role: 'user', content: "What's the weather in Athens?" },
//     { type: 'function_call', callId: 'call_1', name: 'get_weather',
//       arguments: '{"city":"Athens"}' },
//     { type: 'function_call_result', callId: 'call_1',
//       output: { type: 'text', text: '{"tempC":32,"conditions":"sunny"}' } },
//     { role: 'assistant',
//       content: [{ type: 'output_text', text: "It's 32°C and sunny in Athens." }] },
//   ]
//
//   →
//
//   [
//     { id: 'h-u-0', role: 'user',
//       text: "What's the weather in Athens?",
//       toolCalls: [], handoffs: [], pending: false },
//     { id: 'h-a-1', role: 'agent',
//       text: "It's 32°C and sunny in Athens.",
//       toolCalls: [{ callId: 'call_1', name: 'get_weather',
//                     args: '{"city":"Athens"}',
//                     output: '{"tempC":32,"conditions":"sunny"}' }],
//       handoffs: [], pending: false },
//   ]
//
// Id numbering (`h-u-N` / `h-a-N`) uses `bubbles.length` at the moment
// each bubble is created — the user bubble gets `h-u-0` (length 0 pre-push);
// the agent bubble opens next with `h-a-1` (length 1 after the user push).
//
// Structure: the loop reads as a table of contents. Each branch's
// body lives in a small named helper below (predicates + mutators) so
// the branch logic is testable and the loop stays a list of routes.
export function hydrateChatMessages(history: AgentInputItem[]): ChatMessage[] {
  const bubbles: ChatMessage[] = [];
  let currentAgent: ChatMessage | null = null;

  for (const item of history) {
    // Discriminate on the two ways items identify themselves: `role`
    // for user/assistant messages, `type` for function_call,
    // function_call_result, and our custom guardrail_notice.
    const record = item as HistoryRecord;

    // User turn resets the bubble pair; must run before the null guard.
    if (isUserTurn(record)) {
      currentAgent = openBubblesForUserTurn(record, bubbles, currentAgent);
      continue;
    }

    // Everything below accumulates onto the current agent bubble.
    // The very first history items are always a user turn, so a null
    // currentAgent here means malformed history — skip silently.
    if (!currentAgent) continue;

    if (isFunctionCall(record)) {
      appendToolCall(record, currentAgent);
      continue;
    }
    if (isFunctionCallResult(record)) {
      attachToolOutput(record, currentAgent);
      continue;
    }
    if (isGuardrailNotice(record)) {
      applyGuardrailNotice(record, currentAgent);
      continue;
    }
    if (isAssistantTurn(record)) {
      appendAssistantText(record, currentAgent);
      continue;
    }
  }

  flushAgentBubble(bubbles, currentAgent);
  return bubbles;
}

// ───────────────────────────────────────────────
// Record shape + type predicates
// ───────────────────────────────────────────────

// Loose duck-typed shape we cast history items to before dispatching.
// Everything is `unknown` — the predicates below narrow to the fields
// they actually care about. Items arrive from JSON.parse (DB or SSE),
// so prototype-based checks (instanceof) don't apply.
type HistoryRecord = {
  role?: unknown;
  type?: unknown;
  content?: unknown;
  name?: unknown;
  arguments?: unknown;
  callId?: unknown;
  output?: unknown;
  message?: unknown;
  kind?: unknown;
};

function isUserTurn(record: HistoryRecord): boolean {
  return record.role === 'user' && typeof record.content === 'string';
}

function isFunctionCall(record: HistoryRecord): boolean {
  return record.type === 'function_call';
}

function isFunctionCallResult(record: HistoryRecord): boolean {
  return record.type === 'function_call_result';
}

function isAssistantTurn(record: HistoryRecord): boolean {
  return record.role === 'assistant' && Array.isArray(record.content);
}

// ───────────────────────────────────────────────
// Bubble-list helpers
// ───────────────────────────────────────────────

// Only push the current agent bubble if it has something to render.
// Skip empty ones — they'd render as blank bubbles which look broken.
// Type predicate lets callers narrow currentAgent to non-null via the
// same check.
function agentBubbleHasContent(
  agent: ChatMessage | null,
): agent is ChatMessage {
  return (
    agent !== null &&
    (agent.text.length > 0 || agent.toolCalls.length > 0)
  );
}

function flushAgentBubble(
  bubbles: ChatMessage[],
  currentAgent: ChatMessage | null,
): void {
  if (agentBubbleHasContent(currentAgent)) bubbles.push(currentAgent);
}

// ───────────────────────────────────────────────
// Per-branch mutators
// ───────────────────────────────────────────────

// User turn — flush the in-progress agent bubble (if any), push the
// user bubble, and return the freshly-opened agent bubble that
// subsequent items will accumulate onto. The caller assigns the return
// value to `currentAgent`.
function openBubblesForUserTurn(
  record: HistoryRecord,
  bubbles: ChatMessage[],
  currentAgent: ChatMessage | null,
): ChatMessage {
  flushAgentBubble(bubbles, currentAgent);
  bubbles.push({
    id: `h-u-${bubbles.length}`,
    role: 'user',
    // isUserTurn guarantees record.content is a string; the cast just
    // narrows what TypeScript can't infer through the boolean predicate.
    text: record.content as string,
    toolCalls: [],
    handoffs: [],
    pending: false,
  });
  return {
    id: `h-a-${bubbles.length}`,
    role: 'agent',
    text: '',
    toolCalls: [],
    handoffs: [],
    pending: false,
  };
}

// Attach a new ToolCall to the current agent bubble.
function appendToolCall(
  record: HistoryRecord,
  currentAgent: ChatMessage,
): void {
  const args = typeof record.arguments === 'string' ? record.arguments : '';
  currentAgent.toolCalls.push({
    callId: typeof record.callId === 'string' ? record.callId : undefined,
    name: typeof record.name === 'string' ? record.name : '(unknown)',
    args,
  });
}

// Find the matching ToolCall by callId and set its output text.
// Skip silently on malformed shapes (no callId, non-text output, etc.).
// The output field is a { type: 'text' | ..., text } envelope — we only
// care about the text form (matches rebuildCollectorFromHistory).
function attachToolOutput(
  record: HistoryRecord,
  currentAgent: ChatMessage,
): void {
  const callId = typeof record.callId === 'string' ? record.callId : undefined;
  const output = record.output as
    | { type?: string; text?: string }
    | undefined;
  if (!callId || output?.type !== 'text' || typeof output.text !== 'string') {
    return;
  }
  const tc = currentAgent.toolCalls.find((c) => c.callId === callId);
  if (tc) tc.output = normalizeMcpEnvelope(output.text);
}

// Guardrail notice (Stage 22 backlog #2a) — our custom shape (not part
// of the SDK's item vocabulary) that carries the friendly policy-notice
// text plus the `kind` ('input' | 'output'). We treat it like an
// assistant message for text purposes AND set `blockedBy` on the
// bubble so MessageBubble renders it with the soft "policy notice"
// styling — same as the live experience. See guardrailNotice.ts.
function applyGuardrailNotice(
  record: HistoryRecord,
  currentAgent: ChatMessage,
): void {
  const message = typeof record.message === 'string' ? record.message : '';
  const kind = record.kind;
  if (message) currentAgent.text += message;
  if (kind === 'input' || kind === 'output') {
    currentAgent.blockedBy = { kind };
  }
}

// Assistant turn — the SDK stores assistant messages with
// `role: 'assistant'` and a content array; each entry has a text field
// when it's an output_text piece. Concatenate text pieces for display.
function appendAssistantText(
  record: HistoryRecord,
  currentAgent: ChatMessage,
): void {
  const parts = record.content as Array<{ type?: string; text?: string }>;
  const text = parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
  if (text) currentAgent.text += text;
}

// ───────────────────────────────────────────────
// MCP envelope normalizer
// ───────────────────────────────────────────────

// The live agent-route SSE path unwraps MCP envelopes via unwrapToolOutput
// before delivering to the client (see /api/agent's tool_call_output_item
// handler). But `stream.history` — which is what gets persisted and
// hydrated here — may still contain the wrapped shape, e.g.:
//   {"content":[{"type":"text","text":"{\"id\":42,\"reference\":\"BKG-…\"}"}]}
// If we hand that wrapped string to the UI as toolCall.output, then
// ToolCallView's `tryParseBooking` fails (id/reference/status aren't at
// top level) and the rich BookingCard degrades to a generic accordion.
// This normalizer mirrors what rebuildCollectorFromHistory does for
// guardrails, keeping the two hydration paths behaviorally aligned.
function normalizeMcpEnvelope(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      ('content' in parsed || 'text' in parsed)
    ) {
      return unwrapToolOutput(parsed);
    }
  } catch {
    // Not JSON — return raw text unchanged.
  }
  return raw;
}
