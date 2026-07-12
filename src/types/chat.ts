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
};
