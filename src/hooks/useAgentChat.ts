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

  function applyEvent(agentMsgId: string, payload: StreamEvent) {
    // We update the messages state based on the type of event received from the agent API. Each event type has different fields and requires different updates to the messages state.

    // We find the agent message in the messages state by its id (agentMsgId) and update its text, toolCalls, or pending flag based on the event type. We also update the history state when we receive a 'done' event, which includes the full conversation history so far.
    if (payload.type === 'text_delta') {
      // Append delta to the current agent message's text. We find the agent message in the messages state by its id (agentMsgId) and append the delta to its text. This allows us to display the agent's response in real-time as it is generated.
      // E.g., payload = { type: 'text_delta', delta: 'Hello, ' }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId ? { ...m, text: m.text + payload.delta } : m,
        ),
      );
    } else if (payload.type === 'tool_call') {
      // Push a ToolCall { name, args } onto the current agent message's toolCalls array. We find the agent message in the messages state by its id (agentMsgId) and add a new tool call object to its toolCalls array. This allows us to track the tool calls made by the agent and display them in the UI.
      // E.g., payload = { type: 'tool_call', name: 'search_hotels', args: '{"city":"Berlin"}', callId: '12345' }
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
    } else if (payload.type === 'tool_output') {
      // Populate the last ToolCall.output with the payload.output.
      // We find the agent message in the messages state by its id (agentMsgId) and update the output of the tool call with the matching callId. If no callId is provided, we attach the output to the first still-pending tool call.
      // E.g., payload = { type: 'tool_output', output: '{"hotels":[{"name":"Hotel A"}]}', callId: '12345' }
      setMessages((prev) =>
        prev.map((m) => {
          // m has this shape: { id, role, text, toolCalls, pending }
          // We find the tool call in m.toolCalls that has the same callId as the payload, and update its output with the payload.output. If no callId is provided, we attach the output to the first still-pending tool call. This allows us to match tool outputs to their corresponding tool calls, even when several calls happen in parallel.
          // We find the agent message in the messages state by its id (agentMsgId) and update the output of the tool call with the matching callId. If no callId is provided, we attach the output to the first still-pending tool call. This allows us to match tool outputs to their corresponding tool calls, even when several calls happen in parallel.
          if (m.id !== agentMsgId) return m;

          // E.g., m.toolCalls = [{ callId: '12345', name: 'search_hotels', args: '{"city":"Berlin"}' }]
          // We create a new array of tool calls with the updated output, and return a new message object with the updated toolCalls array. This ensures that we do not mutate the existing state directly, which is important for React state management.
          const tc = [...m.toolCalls];
          let idx = -1;
          if (payload.callId) {
            idx = tc.findIndex((c) => c.callId === payload.callId);
          }
          if (idx === -1) {
            // Fallback for events without callId — attach to the first still-pending call, i.e., the first tool call that does not yet have an output. This allows us to handle tool outputs that do not include a callId, by matching them to the first tool call that is still waiting for output.
            idx = tc.findIndex((c) => c.output === undefined);
          }
          // Here we update the tool call at index idx with the output from the payload. We create a new array of tool calls with the updated output, and return a new message object with the updated toolCalls array. This ensures that we do not mutate the existing state directly, which is important for React state management.
          if (idx !== -1) {
            // E.g., tc[idx] = { callId: '12345', name: 'search_hotels', args: '{"city":"Berlin"}' }
            // E.g., payload.output = '{"hotels":[{"name":"Hotel A"}]}'
            // After this line, tc[idx] will be updated to include the output from the payload, so it will look like: { callId: '12345', name: 'search_hotels', args: '{"city":"Berlin"}', output: '{"hotels":[{"name":"Hotel A"}]}' }
            tc[idx] = { ...tc[idx], output: payload.output };
          }

          // We return a new message object with the updated toolCalls array, so that the messages state is updated with the new output for the tool call. This ensures that we do not mutate the existing state directly, which is important for React state management.
          return { ...m, toolCalls: tc };
        }),
      );
    } else if (payload.type === 'agent_updated') {
      // Fires when the SDK hands off control to a different agent. We record
      // the new agent's name so the UI can render a chip like
      // "→ handed off to WeatherAgent".
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, handoffs: [...m.handoffs, payload.agentName] }
            : m,
        ),
      );
    } else if (payload.type === 'done') {
      // Update client-side history; unlock send button
      // Mark the agent message as no longer pending, so the UI can stop showing the "thinking..." indicator. We find the agent message in the messages state by its id (agentMsgId) and set its pending flag to false. This indicates that the agent has finished processing the user's input and has sent a final response.
      // E.g., payload = { type: 'done', history: [...], conversationId: 'abc123' }
      setHistory(payload.history);
      // Stage 17 Phase 3: if this is the first turn of a fresh signed-in
      // conversation, the server assigned an id. Swap the URL to /c/[id]
      // via history.replaceState (no page reload, no re-render loop) so
      // refresh + bookmarking work. Skip when the id is already set (we
      // opened /c/[id] directly) or absent (anon chat).
      if (payload.conversationId && payload.conversationId !== conversationId) {
        setConversationId(payload.conversationId);

        // We only manipulate the URL in the browser environment (window is defined). If window is undefined, we are likely in a server-side rendering context, and we should not attempt to change the URL.
        if (typeof window !== 'undefined') {
          const target = `/c/${payload.conversationId}`;

          // Only replace the URL if it is different from the current pathname. This prevents unnecessary history entries and avoids triggering a re-render loop. We use window.history.replaceState to change the URL without reloading the page or causing a full navigation.
          if (window.location.pathname !== target) {
            window.history.replaceState({}, '', target);
          }
        }
      }
    } else if (payload.type === 'error') {
      // Replace agent message with an error
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, text: `Error: ${payload.message}`, pending: false }
            : m,
        ),
      );
    } else if (payload.type === 'guardrail_blocked') {
      // A guardrail tripwire fired — replace whatever the agent had
      // streamed so far (which may be nothing, for input trips, or
      // partial text, for output trips) with the guardrail's friendly
      // message. `blockedBy` triggers the softer chat bubble styling in
      // MessageBubble; no "Error:" prefix because this is a policy
      // notice, not a failure.
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
    }
  }

  // `history` is exposed for Stage 17 Phase 3.5 — ChatContainer needs
  // to auto-save the anon-user history to sessionStorage on every
  // update so a mid-flow sign-in can resume the conversation on the
  // signed-in side. Not needed for any other consumer.
  return { messages, pending, send, conversationId, history };
}
