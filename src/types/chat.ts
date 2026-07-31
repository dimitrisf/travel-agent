// Types for the chat UI. Shared between page.tsx (owner of the messages
// state) and the components under src/components (renderers of that state).

export type ToolCall = {
  callId?: string;
  name: string;
  args: string;
  output?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  text: string;
  toolCalls: ToolCall[];
  // Agent names emitted by the SDK as it walks handoffs. Populated from
  // `agent_updated_stream_event` during streaming — one entry per handoff,
  // in the order they happened. Values are actual agent names
  // ('TravelAgent', 'WeatherAgent'), not generic labels like 'agent' or
  // 'tool' — tools aren't handed off to, they're called BY the current
  // agent. The starting agent (Triage) doesn't appear here — only agents
  // that were handed OFF to. E.g., "user asks for the weather" → Triage
  // hands off to WeatherAgent → handoffs = ['WeatherAgent'].
  handoffs: string[];
  pending: boolean;
  // Set when a guardrail tripwire replaced the agent's output with a
  // policy notice. UI renders `text` as-is (no "Error:" prefix) and
  // uses a softer visual than a normal error message. `kind` says which
  // side of the run the guardrail lived on — useful for future
  // differentiation (e.g. showing input trips as a rejection of what
  // the user typed vs. output trips as a rewrite of what the agent said).
  blockedBy?: { kind: 'input' | 'output' };
};
