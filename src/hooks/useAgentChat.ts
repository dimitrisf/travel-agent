import { useState } from 'react';
import type { AgentInputItem } from '@openai/agents';
import type { ChatMessage } from '@/types/chat';
import type { StreamEvent } from '@/types/stream';
import { hydrateChatMessages } from '@/utils/hydrateChatMessages';

// Options for the hook. All optional — the / page passes nothing (fresh
// anon or signed-in chat), the /c/[id] page passes both `initialHistory`
// and `initialConversationId` (resumed conversation).
export type UseAgentChatOptions = {
  initialHistory?: AgentInputItem[];
  initialConversationId?: string;
};

// useAgentChat encapsulates the chat-with-the-agent state and streaming
// protocol. Owns the displayed messages, the conversation history sent to
// the agent on the next turn, the current conversationId (Stage 17 Phase 3),
// and the in-flight pending flag. Exposes a single `send(prompt)` action;
// callers deal with the UI (text input, autoscroll, form submit) themselves.
export function useAgentChat(opts: UseAgentChatOptions = {}) {
  // messages is the chat history displayed in the UI. Each message has an id, role (user or agent), text content, an array of tool calls (if any), and a pending flag indicating if the message is still being processed.
  // Seeded from initialHistory when hydrating a resumed conversation (/c/[id]).
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    // We use hydrateChatMessages to convert the canonical AgentInputItem[] history into ChatMessage[] bubbles for display. This ensures that the UI-facing bubble structure matches what the agent's run() consumes, and that the loaded page looks identical to a live chat session.
    opts.initialHistory ? hydrateChatMessages(opts.initialHistory) : [],
  );

  // history is the conversation history sent to the agent for context; in other words, it is the transcript the agent needs on the next turn. It includes both user and agent messages, but does not include the tool call details.
  // It is updated when the agent sends a 'done' event, which includes the full history of the conversation so far.
  // The difference between messages and history is that messages are for display in the UI, while history is for sending to the agent to maintain context across turns.
  const [history, setHistory] = useState<AgentInputItem[]>(
    opts.initialHistory ?? [],
  );

  // conversationId (Stage 17 Phase 3) is the id of the persisted
  // Conversation this chat belongs to. Null for anonymous chats and for
  // the pre-first-turn signed-in state on `/`; server sets it on the
  // first turn's `done` event, after which the client swaps the URL to
  // /c/[id] so refresh + bookmarking work.
  const [conversationId, setConversationId] = useState<string | null>(
    opts.initialConversationId ?? null,
  );

  // pending indicates if a request to the agent is currently in progress.
  // It locks the send button and input field to prevent multiple simultaneous requests, i.e., while a turn is in flight.
  const [pending, setPending] = useState(false);

  // send is called when the user submits a prompt. It sends the prompt to the agent API, handles streaming events, and updates the messages and history state accordingly.
  async function send(prompt: string) {
    const userInput = prompt.trim();
    if (!userInput || pending) return;

    // We need to add the user message to the messages state immediately, so it appears in the UI while we wait for the agent's response.
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: userInput,
      toolCalls: [],
      handoffs: [],
      pending: false,
    };

    // We also add a placeholder agent message with pending: true, which will be updated as we receive streaming events from the agent API.
    // We need a agentMsgId to identify this message in the messages state, so we can update it as we receive events from the agent API. We generate a unique id using the current timestamp.
    // We need this agentMsgId, because we may have multiple agent messages in flight at the same time, and we need to know which one to update when we receive events from the agent API. We use this id to find the correct message in the messages state and update its text, toolCalls, or pending flag as needed.
    //
    // More specifically:
    //
    // agentMsgId uniquely identifies which agent bubble to update as SSE events stream in. Every user turn creates a new agent bubble, so every turn needs a new ID. Two concrete cases:
    //
    // Case 1 — Two sequential turns (the common case)
    // You: "What's the weather in Athens?"
    //   ▲
    //   ├── send() runs:
    //   │     agentMsgId = "a-1730000001000"    ← first ID
    //   │     pushes user bubble + empty agent bubble
    //   │     starts SSE stream
    //   │
    // Agent: [streams: get_weather(Athens) → text → done]
    //   ▲
    //   └── every setMessages update targets a-1730000001000
    //
    // You: "And Berlin?"
    //   ▲
    //   ├── send() runs (a few seconds later):
    //   │     agentMsgId = "a-1730000030000"    ← second ID, fresh timestamp
    //   │     pushes another user bubble + another empty agent bubble
    //   │     starts a NEW SSE stream
    //   │
    // Agent: [streams: get_weather(Berlin) → text → done]
    //   ▲
    //   └── every setMessages update targets a-1730000030000
    //       (a-1730000001000 stays frozen with its finished content)
    //
    // At any moment messages might look like:
    //  [
    //    { id: 'u-…001', role: 'user',  text: "What's the weather in Athens?" },
    //    { id: 'a-1730000001000', role: 'agent', text: 'Athens is 32°C, sunny.', toolCalls: [...] },
    //    { id: 'u-…030', role: 'user',  text: 'And Berlin?' },
    //    { id: 'a-1730000030000', role: 'agent', text: 'Berlin is…',            toolCalls: [...], pending: true },
    // ]
    //
    // When a text_delta frame arrives for the second turn, applyEvent needs to append it to a-1730000030000 — not to the last agent bubble by position (works by luck here, but breaks in Case 2), and definitely not to the first one.
    // Case 2 — Two turns in flight simultaneously (why the ID actually matters)
    //
    // The current code enforces one turn at a time via the pending flag:
    //
    // if (!userInput || pending) return;
    //
    // But suppose we relaxed that to allow parallel turns — e.g. the user could send a follow-up while the first is still streaming, and both stream side-by-side. Now:
    //
    // Time  Event                 State
    // t=0   User types "Athens weather?"
    //       → send() runs: agentMsgId_1 = "a-…001"
    //       → adds user bubble, agent bubble a-…001
    //       → starts stream #1
    //
    // t=1   tool_call get_weather Athens  (stream #1)     append to a-…001
    //
    // t=2   User types "Berlin weather?"                   ← second turn starts while first is still streaming
    //       → send() runs: agentMsgId_2 = "a-…002"
    //       → adds user bubble, agent bubble a-…002
    //       → starts stream #2
    //
    // t=3   tool_call get_weather Berlin  (stream #2)     append to a-…002
    //       tool_output Athens             (stream #1)     append to a-…001
    //       text_delta "Athens is…"        (stream #1)     append to a-…001
    //       tool_output Berlin             (stream #2)     append to a-…002
    //       text_delta "Berlin is…"        (stream #2)     append to a-…002
    //
    // Two streams are simultaneously calling setMessages. Without agentMsgId_1 / agentMsgId_2 captured in the closure of each send() invocation, there's no way for a text_delta in stream #2 to know which bubble it belongs to. Position won't help — both bubbles exist, both are "agent," and their order in the array might change. Only the ID guarantees the delta lands in the right place.
    //
    // The pattern in short
    //
    // send() is an async function that closes over agentMsgId. That closure carries the ID through every applyEvent call within that turn:
    //
    // async function send(prompt: string) {
    //    const agentMsgId = `a-${Date.now()}`;   // captured in closure
    //  …
    //    for await (…) {
    //      applyEvent(agentMsgId, payload);       // always the right bubble
    //    }
    // }
    const agentMsgId = `a-${Date.now()}`;
    // The agent message will be updated as we receive streaming events from the agent API.
    const agentMsg: ChatMessage = {
      id: agentMsgId,
      role: 'agent',
      text: '',
      toolCalls: [],
      handoffs: [],
      pending: true,
    };

    // We add the user message and the placeholder agent message to the messages state, so they appear in the UI immediately. The agent message will be updated as we receive streaming events from the agent API.
    setMessages((prev) => [...prev, userMsg, agentMsg]);
    setPending(true);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Request body: current history + this turn's input + optional
        // conversationId (for signed-in follow-up turns). If no id yet,
        // the server creates a Conversation on this turn and echoes the
        // id back via the `done` event.
        body: JSON.stringify({
          history,
          userInput,
          conversationId: conversationId ?? undefined,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      // The response body is a ReadableStream of Server-Sent Events (SSE) from the agent API. We read it in chunks, decode it, and parse each event to update the UI in real-time.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx: number;
        // We split the buffer into frames separated by double newlines (\n\n). Each frame may contain multiple lines, each starting with "data: " followed by a JSON payload. We parse each line and apply the event to update the messages state.
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          // We extract the next frame from the buffer and remove it from the buffer. Each frame may contain multiple lines, each starting with "data: " followed by a JSON payload. We parse each line and apply the event to update the messages state.
          // E.g., a frame may look like:
          // data: {"type":"text_delta","delta":"Hello, "}
          // data: {"type":"text_delta","delta":"world!"}
          // We parse each line and apply the event to update the messages state.
          const frame = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);

          // E.g., frame = "data: {\"type\":\"text_delta\",\"delta\":\"Hello, \"}\ndata: {\"type\":\"text_delta\",\"delta\":\"world!\"}", so we split it into these lines:
          // [
          //   "data: {\"type\":\"text_delta\",\"delta\":\"Hello, \"}",
          //   "data: {\"type\":\"text_delta\",\"delta\":\"world!\"}"
          // ]
          for (const line of frame.split('\n')) {
            // We only process lines that start with "data: ". Other lines (e.g., comments or empty lines) are ignored. We parse the JSON payload after "data: " and apply the event to update the messages state.
            if (!line.startsWith('data: ')) continue;
            try {
              // We parse the JSON payload after "data: " and apply the event to update the messages state. The payload has a type field that indicates the kind of event (text_delta, tool_call, tool_output, done, or error) and additional fields depending on the type. We call applyEvent to update the messages state accordingly.
              // E.g. {"type":"text_delta","delta":"Hello, "}
              // or {"type":"tool_call","name":"search_hotels","args":"{\"city\":\"Berlin\"}","callId":"12345"}
              // or {"type":"tool_output","output":"{\"hotels\":[{\"name\":\"Hotel A\"}]}","callId":"12345"}
              const payload = JSON.parse(line.slice(6)) as StreamEvent;
              applyEvent(agentMsgId, payload);
            } catch {
              // ignore malformed frame
            }
          }
        }
      }
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, text: `Error: ${message}`, pending: false }
            : m,
        ),
      );
    } finally {
      setPending(false);
      // Mark the agent message as no longer pending, so the UI can stop showing the "thinking..." indicator.
      // agentMsgId is the id of the agent message we added to the messages state when we sent the prompt. We find that message and set its pending flag to false, so the UI can stop showing the "thinking..." indicator.
      setMessages((prev) =>
        prev.map((m) => (m.id === agentMsgId ? { ...m, pending: false } : m)),
      );
    }
  }

  // Dispatch an SSE frame to the right handler. Switch on `payload.type`
  // uses TypeScript's discriminated-union narrowing so each handler
  // receives its precise payload shape. The `never` fallthrough is an
  // exhaustiveness check — tsc errors here if StreamEvent gains a new
  // variant and we forget to handle it.
  function applyEvent(agentMsgId: string, payload: StreamEvent): void {
    switch (payload.type) {
      case 'text_delta':
        return handleTextDelta(agentMsgId, payload);
      case 'tool_call':
        return handleToolCall(agentMsgId, payload);
      case 'tool_output':
        return handleToolOutput(agentMsgId, payload);
      case 'agent_updated':
        return handleAgentUpdated(agentMsgId, payload);
      case 'done':
        return handleDone(payload);
      case 'error':
        return handleError(agentMsgId, payload);
      case 'guardrail_blocked':
        return handleGuardrailBlocked(agentMsgId, payload);
      default: {
        const _exhaustive: never = payload;
        void _exhaustive;
      }
    }
  }

  // ── Per-frame handlers. Inner functions so they close over
  // setMessages / setHistory / adoptConversationId without leaking
  // those setters into the module scope. Each takes its narrowed
  // payload variant via Extract<StreamEvent, { type: '…' }>.

  // Append delta to the current agent message's text. Displays the
  // agent's response in real-time as it is generated.
  // E.g., payload = { type: 'text_delta', delta: 'Hello, ' }
  function handleTextDelta(
    agentMsgId: string,
    payload: Extract<StreamEvent, { type: 'text_delta' }>,
  ): void {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === agentMsgId ? { ...m, text: m.text + payload.delta } : m,
      ),
    );
  }

  // Push a ToolCall { name, args } onto the current agent message's
  // toolCalls array. Lets the UI track the tool calls made by the agent.
  // E.g., payload = { type: 'tool_call', name: 'search_hotels', args: '{"city":"Berlin"}', callId: '12345' }
  function handleToolCall(
    agentMsgId: string,
    payload: Extract<StreamEvent, { type: 'tool_call' }>,
  ): void {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === agentMsgId
          ? {
              ...m,
              toolCalls: [
                ...m.toolCalls,
                {
                  callId: payload.callId,
                  name: payload.name,
                  args: payload.args,
                },
              ],
            }
          : m,
      ),
    );
  }

  // Update the tool call that matches payload.callId with the incoming
  // output. If no callId is provided (or no match), fall back to the
  // first still-pending tool call (output === undefined). Handles the
  // parallel-calls case where several tools are in flight at once.
  // E.g., payload = { type: 'tool_output', output: '{"hotels":[{"name":"Hotel A"}]}', callId: '12345' }
  function handleToolOutput(
    agentMsgId: string,
    payload: Extract<StreamEvent, { type: 'tool_output' }>,
  ): void {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== agentMsgId) return m;
        // Copy tool calls to a new array so we don't mutate state directly.
        const tc = [...m.toolCalls];
        let idx = -1;
        if (payload.callId) {
          idx = tc.findIndex((c) => c.callId === payload.callId);
        }
        if (idx === -1) {
          // Fallback for events without callId — attach to the first
          // still-pending call.
          idx = tc.findIndex((c) => c.output === undefined);
        }
        if (idx !== -1) {
          tc[idx] = { ...tc[idx], output: payload.output };
        }
        return { ...m, toolCalls: tc };
      }),
    );
  }

  // Fires when the SDK hands off control to a different agent. We
  // record the new agent's name so the UI can render a chip like
  // "→ handed off to WeatherAgent".
  function handleAgentUpdated(
    agentMsgId: string,
    payload: Extract<StreamEvent, { type: 'agent_updated' }>,
  ): void {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === agentMsgId
          ? { ...m, handoffs: [...m.handoffs, payload.agentName] }
          : m,
      ),
    );
  }

  // Update client-side history and, on the first turn of a signed-in
  // conversation, adopt the server-assigned conversationId (Stage 17
  // Phase 3) — swaps the URL to /c/[id] via adoptConversationId.
  // E.g., payload = { type: 'done', history: [...], conversationId: 'abc123' }
  function handleDone(
    payload: Extract<StreamEvent, { type: 'done' }>,
  ): void {
    setHistory(payload.history);
    adoptConversationId(payload.conversationId);
  }

  // Replace the current agent message with an error (prefixed with
  // "Error:" so it renders as a failure, not a policy notice).
  function handleError(
    agentMsgId: string,
    payload: Extract<StreamEvent, { type: 'error' }>,
  ): void {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === agentMsgId
          ? { ...m, text: `Error: ${payload.message}`, pending: false }
          : m,
      ),
    );
  }

  // A guardrail tripwire fired — replace whatever the agent had
  // streamed so far (which may be nothing, for input trips, or partial
  // text, for output trips) with the guardrail's friendly message.
  // `blockedBy` triggers the softer chat bubble styling in MessageBubble;
  // no "Error:" prefix because this is a policy notice, not a failure.
  // Also adopts conversationId (Stage 22 backlog #2b) so a first-turn
  // guardrail trip still swaps the URL to /c/[id].
  function handleGuardrailBlocked(
    agentMsgId: string,
    payload: Extract<StreamEvent, { type: 'guardrail_blocked' }>,
  ): void {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === agentMsgId
          ? {
              ...m,
              text: payload.message,
              blockedBy: { kind: payload.kind },
              pending: false,
            }
          : m,
      ),
    );
    adoptConversationId(payload.conversationId);
  }

  // Adopt a conversationId returned by the server (from `done` or from
  // `guardrail_blocked`) and swap the URL to `/c/[id]` if we're not
  // already there. No-ops for anon callers (undefined id) and for
  // follow-up turns to an already-known conversation.
  function adoptConversationId(newId: string | undefined) {
    if (!newId || newId === conversationId) return;

    setConversationId(newId);

    // We only manipulate the URL in the browser environment (window is defined).
    // If window is undefined, we are likely in a server-side rendering context.
    if (typeof window !== 'undefined') {
      const target = `/c/${newId}`;
      // Only replace the URL if it is different from the current pathname.
      // This prevents unnecessary history entries and avoids triggering a re-render loop.
      // We use window.history.replaceState to change the URL without reloading the page.
      if (window.location.pathname !== target) {
        window.history.replaceState({}, '', target);
      }
    }
  }

  // `history` is exposed for Stage 17 Phase 3.5 — ChatContainer needs
  // to auto-save the anon-user history to sessionStorage on every
  // update so a mid-flow sign-in can resume the conversation on the
  // signed-in side. Not needed for any other consumer.
  return { messages, pending, send, conversationId, history };
}
