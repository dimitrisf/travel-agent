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
  // The 'error' event is emitted when a genuine failure occurs during
  // processing (network, MCP, model call). The UI renders it with an
  // error prefix. Guardrail trips do NOT come through this channel —
  // they get their own 'guardrail_blocked' frame so the UI can render
  // them as a policy notice rather than an error.
  | { type: 'error'; message: string }
  // The 'guardrail_blocked' event is emitted when a guardrail tripwire
  // fires — the system deliberately blocked the agent, either before it
  // ran (input guardrail on the entry agent) or after it produced its
  // final text (output guardrail on a specialist). The payload's
  // `message` is the friendly, user-facing text set by the guardrail's
  // outputInfo. `kind` says which layer blocked, so the UI can hint at
  // the reason if useful (input = "your input was blocked", output =
  // "the agent's response was blocked").
  | {
      type: 'guardrail_blocked';
      kind: 'input' | 'output';
      message: string;
    };
