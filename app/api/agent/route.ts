import 'server-only';
import { NextRequest } from 'next/server';
import {
  MCPServerStreamableHttp,
  run,
  type AgentInputItem,
} from '@openai/agents';
import { buildAgentGraph } from '@/agents/buildAgentGraph';
import { unwrapToolOutput } from '@/utils/toolOutput';
import { userFacingGuardrailErrorMessage } from '@/utils/userFacingGuardrailErrorMessage';

export const runtime = 'nodejs';
// This route is a streaming endpoint, so we force dynamic to avoid caching issues
export const dynamic = 'force-dynamic';
// We set a generous timeout for the agent to complete its work, since it may need to call multiple tools and wait for their responses. Units are seconds.
export const maxDuration = 120;

// ───────────────────────────────────────────────
// MCP singletons (persisted across requests via globalThis)
// ───────────────────────────────────────────────

// We define a type for the MCP server bundle, which includes the travel and weather MCP servers. This allows us to type the global variable that will hold the initialized MCP server instances.
type McpBundle = {
  mcpTravel: MCPServerStreamableHttp;
  mcpWeather: MCPServerStreamableHttp;
};

// We use a global variable to hold the MCP server instances so that they are only initialized once and reused across requests. This avoids the overhead of starting new processes for each request.
// globalThis is a special object in Node.js that persists across requests, so we can attach our MCP server instances to it. We use a type assertion to extend the globalThis type with our _mcpInit property, which will hold a Promise that resolves to our MCP server instances. This allows us to check if the servers have already been initialized and reuse them if they have.
type G = typeof globalThis & { _mcpInit?: Promise<McpBundle> };

// We define a function that returns a Promise that resolves to the MCP server instances. If the servers have not been initialized yet, we start them and store the Promise in the global variable. If they have already been initialized, we return the existing Promise. This ensures that we only start the servers once and reuse them for subsequent requests.
const g = globalThis as G;

// We define a function that returns a Promise that resolves to the MCP server instances. If the servers have not been initialized yet, we start them and store the Promise in the global variable. If they have already been initialized, we return the existing Promise. This ensures that we only start the servers once and reuse them for subsequent requests.
function getOrInitMcps(): Promise<McpBundle> {
  if (!g._mcpInit) {
    g._mcpInit = (async () => {
      // Both MCP endpoints live inside the same Next.js process, one path
      // segment apart. The URL can be overridden per-server via env var when
      // deploying MCPs as separate services.
      const appBase =
        process.env.APP_BASE ?? `http://localhost:${process.env.PORT ?? 3000}`;
      const mcpTravel = new MCPServerStreamableHttp({
        name: 'travel',
        url: process.env.TRAVEL_MCP_URL ?? `${appBase}/api/mcp/travel`,
      });
      const mcpWeather = new MCPServerStreamableHttp({
        name: 'weather',
        url: process.env.WEATHER_MCP_URL ?? `${appBase}/api/mcp/weather`,
      });
      await Promise.all([mcpTravel.connect(), mcpWeather.connect()]);
      return { mcpTravel, mcpWeather };
    })();
  }
  return g._mcpInit;
}

// ───────────────────────────────────────────────
// POST /api/agent — SSE stream of the agent's turn
// ───────────────────────────────────────────────
// We define a POST handler for the /api/agent route. This handler receives a request with a JSON body containing the user's input and the conversation history. It validates the input, initializes the MCP servers and agent, and runs the agent to generate a response. The response is streamed back to the client as Server-Sent Events (SSE) in real-time.
export async function POST(req: NextRequest) {
  // We only accept userInput as a string and history as an array of AgentInputItem.
  // This is what is being sent from app/page.tsx when the user submits a prompt.
  const body = (await req.json()) as {
    // AgentInputItem is a discriminated union of { role: 'user' | 'assistant' | 'system', content: string } and { role: 'tool', content: string, toolName: string, toolArgs: unknown }.
    history: AgentInputItem[];
    userInput: string;
  };
  const { history = [], userInput } = body;

  // We validate that userInput is a non-empty string. If it is not, we return a 400 Bad Request response with an error message. This ensures that the agent has a valid input to process.
  if (!userInput || typeof userInput !== 'string') {
    return new Response(JSON.stringify({ error: 'userInput is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { mcpTravel, mcpWeather } = await getOrInitMcps();
  // Start at the triage agent; the Runner follows handoffs into the specialists.
  const agent = buildAgentGraph(mcpTravel, mcpWeather);

  // We run the agent with the user's input and the conversation history. We pass the stream: true option to enable streaming of the agent's output. The agent will process the input, call tools as needed, and generate a response in real-time.
  //
  // This agent (actually the triage agent) will hand off to the appropriate specialist (WeatherAgent or TravelAgent) based on the user's input. The agent's output is streamed back to the client as SSE events, allowing the client to display the response in real-time as it is generated.
  // We call the agent passed to the run() function the "entry agent" because it is the first agent that receives the user's input. The entry agent is responsible for routing the input to the appropriate specialist agent based on the user's intent. The entry agent's input guardrails are applied to the user's input before it is passed to the specialist agents.
  const stream = await run(
    agent,
    [...history, { role: 'user', content: userInput }],
    { stream: true },
  );

  const encoder = new TextEncoder();

  // We create a ReadableStream that will send SSE events to the client. The stream will enqueue events as they are received from the agent's run() method. Each event is encoded as a JSON string and prefixed with "data: " and suffixed with "\n\n" to conform to the SSE format. We also handle errors and completion of the stream.
  const readable = new ReadableStream({
    // The stream's start() iterates the run events, encodes each as data: …\n\n, and enqueues bytes to the controller.
    // The start() method is called when the stream is first created. We define a helper function send() that enqueues an SSE event to the stream. We then iterate over the events from the agent's run() method and handle them based on their type. We send text deltas, tool calls, and tool outputs to the client as they arrive. When the stream is completed, we send a "done" event with the conversation history. If an error occurs, we send an "error" event with the error message.
    async start(controller) {
      // We define a helper function that sends an SSE event to the client. The event is encoded as a JSON string and enqueued in the ReadableStream. This allows us to send events to the client in real-time as they are received from the agent.
      function send(payload: unknown) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      }

      try {
        // The agent's output is streamed in real-time. We can handle the streaming events as they arrive.
        //
        // The for await (const event of stream) block does essentially what the CLI REPL did — but instead of console.log-ing tool calls and streaming to stdout, it sends SSE frames to the browser.
        for await (const event of stream) {
          // Agent-updated events fire when the active agent changes — i.e. after
          // a handoff. Forward the new agent's name to the client so the UI can
          // show which specialist is now driving.
          if (event.type === 'agent_updated_stream_event') {
            const agent = (event as { agent?: { name?: string } }).agent;
            if (agent?.name) {
              send({ type: 'agent_updated', agentName: agent.name });
            }
            continue;
          }

          // Handle streaming events from the agent
          if (event.type === 'raw_model_stream_event') {
            // The model may send partial text output in chunks; 'raw_model_stream_event' events contain these chunks. We can display them as they arrive.
            const data = event.data as { type?: string; delta?: string };

            // 'output_text_delta' events contain the actual text output from the model. We can send these chunks to the client as they arrive.
            if (
              data.type === 'output_text_delta' &&
              typeof data.delta === 'string'
            ) {
              // We send a "text_delta" event to the client with the partial text output from the model. The client can use this to display the agent's response in real-time as it is generated.
              send({ type: 'text_delta', delta: data.delta });
            }
            continue;
          }

          if (event.type === 'run_item_stream_event') {
            // 'run_item_stream_event' events contain information about the execution of individual items in the agent's plan. We can use these events to display tool calls and their outputs in real-time.
            const item = event.item;
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
              if ('name' in raw && 'arguments' in raw) {
                const args =
                  typeof raw.arguments === 'string'
                    ? raw.arguments
                    : JSON.stringify(raw.arguments);
                const callId = raw.callId ?? raw.call_id ?? raw.id;
                send({ type: 'tool_call', name: raw.name, args, callId });
              }
            } else if (item.type === 'tool_call_output_item') {
              // The agent has received output from a tool call. We tag the event with the same callId so the client can match it to the correct tool call, even when several calls happen in parallel.
              const outRaw = (
                item as {
                  rawItem?: { callId?: string; call_id?: string; id?: string };
                }
              ).rawItem;
              const callId = outRaw?.callId ?? outRaw?.call_id ?? outRaw?.id;
              send({
                type: 'tool_output',
                callId,
                output: unwrapToolOutput(item.output),
              });
            }
          }
        }

        await stream.completed;
        send({ type: 'done', history: stream.history });
      } catch (err) {
        console.error('[api/agent] error:', err);
        send({ type: 'error', message: userFacingGuardrailErrorMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  // We return a Response with the ReadableStream as the body. The response has headers that indicate it is an SSE stream, with no caching and a keep-alive connection. This allows the client to receive events in real-time as they are sent by the agent.
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

