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
  // Agent names emitted by the SDK as it walks handoffs.
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
