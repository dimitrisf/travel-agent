import type { StreamEvent } from '@/types/stream';
import { unwrapToolOutput } from './toolOutput';

// Pure translator: SDK stream event → wire-format SSE frame (or null).
//
// Extracted from app/api/agent/route.ts so the deterministic event
// mapping is unit-testable in isolation from the SSE controller. The
// route's stream loop is now just:
//
//   for await (const event of stream) {
//     const frame = toSseFrame(event);
//     if (frame) send(frame);
//   }
//
// Every current branch emits at most one frame. Unknown / malformed
// events return null — the loop just skips them.
export function toSseFrame(event: unknown): StreamEvent | null {
  const e = event as { type?: string };
  if (!e || typeof e.type !== 'string') return null;

  // Agent-updated events fire when the active agent changes — i.e. after
  // a handoff. Forward the new agent's name to the client so the UI can
  // show which specialist is now driving.
  if (e.type === 'agent_updated_stream_event') {
    const agent = (event as { agent?: { name?: string } }).agent;
    if (agent?.name) {
      return { type: 'agent_updated', agentName: agent.name };
    }
    return null;
  }

  // Handle streaming events from the agent
  if (e.type === 'raw_model_stream_event') {
    // The model may send partial text output in chunks; 'raw_model_stream_event' events contain these chunks. We can display them as they arrive.
    const data = (event as { data?: { type?: string; delta?: string } }).data;

    // 'output_text_delta' events contain the actual text output from the model. We can send these chunks to the client as they arrive.
    if (data?.type === 'output_text_delta' && typeof data.delta === 'string') {
      // We send a "text_delta" event to the client with the partial text output from the model. The client can use this to display the agent's response in real-time as it is generated.
      return { type: 'text_delta', delta: data.delta };
    }
    return null;
  }

  if (e.type === 'run_item_stream_event') {
    // 'run_item_stream_event' events contain information about the execution of individual items in the agent's plan. We can use these events to display tool calls and their outputs in real-time.
    const item = (
      event as {
        item?: { type?: string; rawItem?: unknown; output?: unknown };
      }
    ).item;
    if (!item) return null;

    if (item.type === 'tool_call_item') {
      // The agent is calling a tool. We can send a "tool_call" event with the tool name and arguments to the client.
      const raw = item.rawItem as {
        name?: string;
        arguments?: unknown;
        // The raw item may have a callId, call_id, or id property that we can use to tag the event with a unique identifier for the tool call. This allows the client to match the tool output to the correct tool call, even when several calls happen in parallel.
        // We have multiple possible property names for the call ID because different tools may use different naming conventions. We check for each one in order of preference and use the first one that exists.
        callId?: string;
        call_id?: string;
        id?: string;
      };
      if (raw && 'name' in raw && 'arguments' in raw) {
        const args =
          typeof raw.arguments === 'string'
            ? raw.arguments
            : JSON.stringify(raw.arguments);
        const callId = raw.callId ?? raw.call_id ?? raw.id;
        return { type: 'tool_call', name: raw.name!, args, callId };
      }
      return null;
    }

    if (item.type === 'tool_call_output_item') {
      // The agent has received output from a tool call. We tag the event with the same callId so the client can match it to the correct tool call, even when several calls happen in parallel.
      const outRaw = (
        item as {
          rawItem?: { callId?: string; call_id?: string; id?: string };
        }
      ).rawItem;
      const callId = outRaw?.callId ?? outRaw?.call_id ?? outRaw?.id;
      return {
        type: 'tool_output',
        callId,
        output: unwrapToolOutput(item.output),
      };
    }

    return null;
  }

  return null;
}
