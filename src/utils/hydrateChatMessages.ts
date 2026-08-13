import type { AgentInputItem } from '@openai/agents';
import type { ChatMessage } from '@/types/chat';
import { GUARDRAIL_NOTICE_TYPE } from './guardrailNotice';
import { unwrapToolOutput } from './toolOutput';

// Convert a canonical AgentInputItem[] history into ChatMessage[] bubbles
// for display. Used when loading /c/[id] — the DB stores the canonical
// history (that's what the agent's run() consumes), and this function
// derives the UI-facing bubble structure from it.
//
// Grouping rule: each user turn opens a new user bubble AND a new agent
// bubble; every function_call / function_call_result / assistant message
// that follows before the next user turn accumulates onto the current
// agent bubble. This mirrors what useAgentChat builds up live via SSE
// events — the loaded page should look identical to the just-chatted one.
//
// UI-only concepts (handoffs, blockedBy, streaming pending state) don't
// survive persistence — they're transient turn-metadata. Restored
// bubbles show `handoffs: []` and `pending: false`.
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
export function hydrateChatMessages(history: AgentInputItem[]): ChatMessage[] {
  const bubbles: ChatMessage[] = [];
  // The current agent bubble being built up from the history. When we see a user turn, we flush the current agent bubble (if any) and start a new one. When we see an assistant message or tool call, we append to the current agent bubble. If there is no current agent bubble, we skip appending (this can happen if the history starts with a user turn).
  let currentAgent: ChatMessage | null = null;

  // Push the in-progress agent bubble (if it has any content) before
  // opening a new one. Skip empty ones — they'd render as blank bubbles
  // which look broken.
  const flushAgent = () => {
    if (
      currentAgent &&
      (currentAgent.text.length > 0 || currentAgent.toolCalls.length > 0)
    ) {
      // Only push if the agent bubble has any text or tool calls. If it's empty, we skip it.
      bubbles.push(currentAgent);
    }
    currentAgent = null;
  };

  for (const item of history) {
    // Discriminate on the two ways the SDK identifies items: `role` for
    // user/assistant messages, `type` for function_call / function_call_result.
    const record = item as {
      role?: unknown;
      type?: unknown;
      content?: unknown;
      name?: unknown;
      arguments?: unknown;
      callId?: unknown;
      output?: unknown;
    };

    // ── User turn — closes any open agent bubble and opens the next one.
    if (record.role === 'user' && typeof record.content === 'string') {
      // Flush the current agent bubble (if any) before starting a new one. This ensures that each user turn starts a new agent bubble, and any previous agent bubble is completed and added to the bubbles array.
      flushAgent();

      // Push a new user bubble with the user's message. The id is generated based on the current length of the bubbles array, ensuring uniqueness. The role is 'user', and the text is the content of the user message. Tool calls and handoffs are empty arrays, and pending is false since this is a completed message.
      bubbles.push({
        id: `h-u-${bubbles.length}`,
        role: 'user',
        text: record.content,
        toolCalls: [],
        handoffs: [],
        pending: false,
      });

      // Open a new agent bubble for the next assistant response. The id is generated based on the current length of the bubbles array, ensuring uniqueness. The role is 'agent', and the text is initially empty. Tool calls and handoffs are empty arrays, and pending is false since this is a new bubble that will be filled in with the assistant's response.
      currentAgent = {
        id: `h-a-${bubbles.length}`,
        role: 'agent',
        text: '',
        toolCalls: [],
        handoffs: [],
        pending: false,
      };
      continue;
    }

    // Nothing below makes sense without an open agent bubble — the very
    // first history items are always a user turn.
    if (!currentAgent) continue;

    // ── Tool call — attach a new ToolCall to the current agent bubble.
    if (record.type === 'function_call') {
      const args = typeof record.arguments === 'string' ? record.arguments : '';
      currentAgent.toolCalls.push({
        callId: typeof record.callId === 'string' ? record.callId : undefined,
        name: typeof record.name === 'string' ? record.name : '(unknown)',
        args,
      });
      continue;
    }

    // ── Tool call result — find the matching ToolCall by callId and
    // attach the output text. The output field is a { type: 'text' | ..., text }
    // envelope — we only care about the text form (matches rebuildCollectorFromHistory).
    if (record.type === 'function_call_result') {
      // E.g, record = { type: 'function_call_result', callId: 'call_1', output: { type: 'text', text: '{"tempC":32,"conditions":"sunny"}' } }
      const callId =
        typeof record.callId === 'string' ? record.callId : undefined;

      // The output field is expected to be an object with a type and text property. We check if the type is 'text' and if the text is a string before assigning it to the corresponding ToolCall's output. If the output is not in the expected format, we skip it.
      const output = record.output as
        | { type?: string; text?: string }
        | undefined;
      if (
        !callId ||
        output?.type !== 'text' ||
        typeof output.text !== 'string'
      ) {
        continue;
      }

      // Find the matching ToolCall in the current agent bubble by callId and set its output to the text from the function_call_result. If no matching ToolCall is found, we skip it. This ensures that the output of the tool call is correctly associated with the corresponding tool call in the agent's response.
      // E.g., output.text = '{"tempC":32,"conditions":"sunny"}' and callId = 'call_1' → find the ToolCall with callId 'call_1' and set its output to '{"tempC":32,"conditions":"sunny"}'.
      const tc = currentAgent.toolCalls.find((c) => c.callId === callId);
      if (tc) tc.output = normalizeMcpEnvelope(output.text);
      continue;
    }

    // ── Guardrail notice (Stage 22 backlog #2a) — our custom shape
    // (not part of the SDK's item vocabulary) that carries the friendly
    // policy-notice text plus the `kind` ('input' | 'output'). We treat
    // it like an assistant message for text purposes AND set
    // `blockedBy` on the bubble so MessageBubble renders it with the
    // soft "policy notice" styling — same as the live experience. See
    // src/utils/guardrailNotice.ts for the shape.
    if (record.type === GUARDRAIL_NOTICE_TYPE) {
      const message =
        typeof (record as { message?: unknown }).message === 'string'
          ? (record as { message: string }).message
          : '';

      const kind = (record as { kind?: unknown }).kind;

      if (message) currentAgent.text += message;

      if (kind === 'input' || kind === 'output') {
        currentAgent.blockedBy = { kind };
      }
      continue;
    }

    // ── Assistant turn — the SDK stores assistant messages with
    // `role: 'assistant'` and a content array; each entry has a text field
    // when it's an output_text piece. Concatenate text pieces for display.
    // E.g, record = { role: 'assistant', content: [{ type: 'output_text', text: "It's 32°C and sunny in Athens." }] } → currentAgent.text += "It's 32°C and sunny in Athens."
    if (record.role === 'assistant' && Array.isArray(record.content)) {
      // E.g., parts = [{ type: 'output_text', text: "It's 32°C and sunny in Athens." }]
      const parts = record.content as Array<{
        type?: string;
        text?: string;
      }>;

      const text = parts
        .filter((p) => typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('');

      // Now, e.g, text = "It's 32°C and sunny in Athens." and we append it to the current agent bubble's text. If there is no text, we skip appending to avoid adding empty strings.
      if (text) currentAgent.text += text;
      continue;
    }
  }

  flushAgent();
  return bubbles;
}

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
