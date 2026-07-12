import type { AgentInputItem } from '@openai/agents';

// StreamEvent represents the different types of events that can be received from the agent API via Server-Sent Events (SSE). Each event type has a specific payload structure, which is used to update the chat UI in real-time as the agent processes the user's input and interacts with tools.
export type StreamEvent =
  // The 'text_delta' event is emitted when the agent generates text output. The payload includes the delta (new text) to append to the current agent message.
  | { type: 'text_delta'; delta: string }
  // The 'tool_call' event is emitted when the agent calls a tool. The payload includes the tool name, arguments, and an optional callId that can be used to match the corresponding 'tool_output' event.
  | { type: 'tool_call'; name: string; args: string; callId?: string }
  // The 'tool_output' event is emitted when the agent receives output from a tool call. The payload includes the output string and an optional callId that can be used to match the corresponding 'tool_call' event.
  | { type: 'tool_output'; output: string; callId?: string }
  // The 'agent_updated' event is emitted when the SDK hands off control to a different agent. The payload includes the new agent's name, which can be used to display a chip in the UI indicating the handoff.
  | { type: 'agent_updated'; agentName: string }
  // The 'done' event is emitted when the agent has finished processing the user's input and has sent a final response. The payload includes the full conversation history so far, which can be used to update the client-side history state.
  | { type: 'done'; history: AgentInputItem[] }
  // The 'error' event is emitted when an error occurs during processing. The payload includes an error message, which can be displayed in the UI to inform the user of the issue.
  | { type: 'error'; message: string };
