import 'server-only';
import { NextRequest } from 'next/server';
import {
  InputGuardrailTripwireTriggered,
  MCPServerStreamableHttp,
  OutputGuardrailTripwireTriggered,
  run,
  type AgentInputItem,
} from '@openai/agents';
import { buildAgentGraph } from '@/agents/buildAgentGraph';
import { rebuildCollectorFromHistory } from '@/agents/agentRunContext';
import type { AgentRunContext } from '@/agents/agentRunContext';
import { getCurrentUser } from '@/lib/auth/session';
import { ConversationServiceError, createConversationService } from '@/lib';
import { buildGuardrailBlockedItems } from '@/utils/buildGuardrailBlockedItems';
import { getDefaultAppBase } from '@/utils/appBase';
import { stripGuardrailNoticesFromHistory } from '@/utils/guardrailNotice';
import { toSseFrame } from '@/utils/toSseFrame';
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
      const appBase = process.env.APP_BASE ?? getDefaultAppBase();
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
  // We accept userInput, history, and optionally conversationId. The
  // conversationId is present on follow-up turns to an existing
  // conversation (either loaded from /c/[id] or created on a prior turn
  // and returned via the `done` event's conversationId field). Absent for
  // the very first turn of a fresh conversation and for anonymous turns.
  const body = (await req.json()) as {
    // history is the AgentInputItem[] the client is sending as this
    // turn's prior context. Item shapes we actually see (per the SDK):
    //   { role: 'user', content: string }
    //   { role: 'assistant', content: [...] }  ← content is an array of parts
    //   { type: 'function_call', callId, name, arguments }
    //   { type: 'function_call_result', callId, output: { type: 'text', text } }
    // See hydrateChatMessages.ts and rebuildCollectorFromHistory for
    // consumers that walk this shape.
    history: AgentInputItem[];
    userInput: string;
    conversationId?: string;
  };

  // We destructure the body to get the history, userInput, and conversationId. We provide a default value of an empty array for history in case it is not provided. The conversationId is optional and may be undefined for the first turn of a new conversation or for anonymous requests.
  // history is the conversation history up to this point, which may include user messages, assistant messages, tool calls, and tool call results. userInput is the new message from the user that we want the agent to respond to. conversationId is undefined for the very first turn of a fresh conversation and for all anonymous turns.
  const { history = [], userInput } = body;
  let conversationId = body.conversationId;

  // We validate that userInput is a non-empty string. If it is not, we return a 400 Bad Request response with an error message. This ensures that the agent has a valid input to process.
  if (!userInput || typeof userInput !== 'string') {
    return new Response(JSON.stringify({ error: 'userInput is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Persistence (Stage 17 Phase 3) — signed-in users only. If a session
  // exists, we either verify ownership of the incoming conversationId or
  // create a fresh Conversation seeded with this turn's user message.
  // Anonymous requests skip persistence entirely and preserve the
  // pre-Phase-3 tab-scoped behavior.

  // We get the current user from the session. If there is a user, we create a ConversationService instance to handle conversation persistence. If there is no user, we skip persistence and allow anonymous requests.
  const user = await getCurrentUser();
  const conversationService = user ? createConversationService() : null;

  if (user && conversationService) {
    if (conversationId) {
      // Follow-up turn to an existing conversation -- in this case, conversationId is provided, so we verify that the user owns it.
      try {
        await conversationService.assertOwnership({
          id: conversationId,
          userId: user.id,
        });
      } catch (err) {
        if (err instanceof ConversationServiceError) {
          return new Response(
            JSON.stringify({ error: err.message, code: err.code }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }

        // Unexpected error — let the stream fail and log it, but don't return a 500 to the client. The client will see the stream close and can retry. We rethrow the error so it gets logged by Next.js.
        throw err;
      }
    } else {
      // First turn of a fresh conversation. conversationId is not provided, so we create a new conversation. Seed the title from the current
      // user message so the header dropdown gets a meaningful label right
      // away — deriveTitle (called in conversationService.create) reads the first user turn in the titleSource array.
      // Note: titleSource is title-derivation only. The turn's messages
      // are persisted separately via appendTurn once the agent finishes
      // (create + append can't be atomized here because they're separated
      // by the whole agent turn — the id is returned to the client
      // mid-stream, before turn output is ready).
      const created = await conversationService.create({
        userId: user.id,
        titleSource: [
          ...history,
          { role: 'user', content: userInput } as AgentInputItem,
        ],
      });
      conversationId = created.id;
    }
  }

  const { mcpTravel, mcpWeather } = await getOrInitMcps();
  // Start at the triage agent; the Runner follows handoffs into the specialists.
  const agent = buildAgentGraph(mcpTravel, mcpWeather);

  // Rebuild the tool-call collector from the client-sent history so this
  // turn's guardrails can see what happened on prior turns (Stage 11).
  // The collector then accumulates as new tools fire during this turn via
  // the `agent_tool_end` hook attached inside `buildTravelAgent`.
  const runCtx: AgentRunContext = {
    // rebuildCollectorFromHistory only picks up paired function_call +
    // function_call_result items — plain user/assistant messages are
    // skipped. E.g., if history contains:
    //   { role: 'user', content: 'Book that hotel' },
    //   { type: 'function_call', callId: 'call_1',
    //     name: 'propose_booking',
    //     arguments: '{"customer_name":"Dimitris",...}' },
    //   { type: 'function_call_result', callId: 'call_1',
    //     output: { type: 'text',
    //       text: '{"reference":"BKG-2026-A9F3K2","totalPriceEUR":471.6,...}' } }
    // then the returned collector is:
    //   [{
    //     name: 'propose_booking',
    //     args: { customer_name: 'Dimitris', ... },
    //     result: '{"reference":"BKG-2026-A9F3K2","totalPriceEUR":471.6,...}',
    //     parsedResult: { reference: 'BKG-2026-A9F3K2', totalPriceEUR: 471.6, ... }
    //   }]
    // A message-only history yields [] — nothing to cross-reference against.
    toolCallCollector: rebuildCollectorFromHistory(history),
  };

  // We run the agent with the user's input and the conversation history. We pass the stream: true option to enable streaming of the agent's output. The agent will process the input, call tools as needed, and generate a response in real-time.
  //
  // This agent (actually the triage agent) will hand off to the appropriate specialist (WeatherAgent or TravelAgent) based on the user's input. The agent's output is streamed back to the client as SSE events, allowing the client to display the response in real-time as it is generated.
  // We call the agent passed to the run() function the "entry agent" because it is the first agent that receives the user's input. The entry agent is responsible for routing the input to the appropriate specialist agent based on the user's intent. The entry agent's input guardrails are applied to the user's input before it is passed to the specialist agents.
  // We pass the conversation history to the run() function so that the agent can maintain context across turns. The history is an array of AgentInputItem objects, which represent the messages exchanged between the user and the agent. The agent can use this history to generate more relevant responses based on the previous conversation.
  // We also pass the runCtx object to the run() function, which contains the toolCallCollector. This collector is used to track the tools that have been called during the current turn, allowing the agent to enforce output guardrails based on the tools that have been used.
  // Context note: the runCtx is not persisted across turns — it is only valid for the current turn. The toolCallCollector is rebuilt from the history at the start of each turn, and it accumulates new tool calls as they occur during the turn. This allows the agent to enforce output guardrails based on the tools that have been called during the current turn.
  // More specifically, the toolCallCollector is used by the bookingCrossReferenceOutputGuardrail to check for booking-related claims in the agent's output. The guardrail uses the collector to determine if the agent has called the propose_booking tool and to cross-reference any booking references mentioned in the output against the actual results returned by the tool.
  // Strip our custom `guardrail_notice` items (Stage 22 backlog #2a)
  // from client-supplied history before handing to the SDK — the SDK
  // doesn't know about that shape and may reject the whole turn.
  // See src/utils/guardrailNotice.ts for the invariant.
  const sdkHistory = stripGuardrailNoticesFromHistory(history);
  const stream = await run(
    agent,
    [...sdkHistory, { role: 'user', content: userInput }],
    { stream: true, context: runCtx },
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
        // The agent's output is streamed in real-time. Each SDK event
        // is translated into zero or more wire-format SSE frames by the
        // pure `toSseFrame` helper — see src/utils/toSseFrame.ts for
        // the per-event branch logic (agent_updated_stream_event,
        // raw_model_stream_event, run_item_stream_event → tool_call /
        // tool_output). The loop here is just the side-effect wrapper
        // that enqueues those frames on the SSE controller.
        //
        // The for await (const event of stream) block does essentially
        // what the CLI REPL did — but instead of console.log-ing tool
        // calls and streaming to stdout, it sends SSE frames to the
        // browser.
        for await (const event of stream) {
          const frame = toSseFrame(event);
          if (frame) send(frame);
        }

        await stream.completed;

        // Phase 3 persistence — append the items produced by this turn
        // (user message + any function_call / function_call_result /
        // assistant items the agent generated). Only for signed-in users
        // with a resolved conversationId. Best-effort: a persistence
        // failure gets logged but doesn't corrupt the stream — the user
        // still sees the turn complete and can retry later.
        if (conversationService && conversationId) {
          // newItems is the slice of stream.history that was added by this turn. It includes the user's message and any items generated by the agent during this turn. We append these new items to the conversation in the database.
          // history holds the conversation history before this turn, and stream.history holds the full conversation history including this turn. We slice stream.history from history.length to get only the new items added during this turn.
          const newItems = stream.history.slice(history.length);

          // We call appendTurn to persist the new items to the conversation in the database. This allows us to maintain a complete record of the conversation across turns. If an error occurs during persistence, we log it but do not interrupt the stream, allowing the user to continue interacting with the agent.
          try {
            await conversationService.appendTurn({
              conversationId,
              newItems,
            });
          } catch (err) {
            console.error('[api/agent] persistence failed:', err);
          }
        }

        // conversationId is echoed back to the client so /page.tsx can
        // swap the URL to /c/[id] on the first-turn case (auto-create
        // flow) and the follow-up turns can pass it back to us.
        send({ type: 'done', history: stream.history, conversationId });
      } catch (err) {
        // Split guardrail trips from actual errors so the UI can render
        // them as a policy notice (soft styling, no "Error:" prefix)
        // instead of a red failure. userFacingGuardrailErrorMessage
        // handles both cases — same friendly text, just a different
        // frame type carrying it.
        if (
          err instanceof InputGuardrailTripwireTriggered ||
          err instanceof OutputGuardrailTripwireTriggered
        ) {
          const kind =
            err instanceof InputGuardrailTripwireTriggered ? 'input' : 'output';
          const message = userFacingGuardrailErrorMessage(err);

          // Backlog #2 — persist the turn so refresh doesn't lose it.
          // Without this, the whole turn (user msg + assistant reply)
          // disappears from history because the throw jumps past the
          // appendTurn call in the success path. Item construction —
          // user message + tool items that ran before the trip +
          // synthetic assistant notice — lives in the pure helper
          // `buildGuardrailBlockedItems`; see that file for the
          // rationale (why the offending assistant text is dropped,
          // etc.). Refresh renders this with the soft "policy notice"
          // styling: `buildGuardrailBlockedItems` now emits a custom
          // `guardrail_notice` item (Stage 22 backlog #2a), and the
          // hydrator recognizes it to restore `blockedBy` on the
          // bubble.
          //
          // Constructed unconditionally (not just for signed-in users)
          // because we also send it to the client in the SSE frame
          // below so `setHistory` can capture the blocked turn. That
          // matters for the anon-to-signed-in bridge: without it, the
          // client's history state stays at pre-turn and the
          // sessionStorage auto-save skips the guardrail turn, so
          // OAuth wipes it.
          const persistedItems = buildGuardrailBlockedItems({
            userInput,
            streamHistory: stream.history ?? [],
            priorHistoryLength: history.length,
            message,
            kind,
          });

          // Best-effort DB persist: only for signed-in users with a
          // resolved conversationId. A failure gets logged, not
          // surfaced, so the user still sees the guardrail_blocked
          // frame land in the UI.
          if (conversationService && conversationId) {
            try {
              await conversationService.appendTurn({
                conversationId,
                newItems: persistedItems,
              });
            } catch (persistErr) {
              console.error(
                '[api/agent] guardrail-blocked persistence failed:',
                persistErr,
              );
            }
          }

          // We send a "guardrail_blocked" event to the client with the kind of guardrail (input or output) and the user-facing message. The client can use this to display a policy notice to the user, indicating that their input or the agent's output was blocked by a guardrail.
          // Include conversationId (Stage 22 backlog #2b): on a
          // first-turn guardrail trip the fresh Conversation was
          // created above (pre-run block) and its id needs to reach
          // the client so the URL can swap from `/` to `/c/[id]` —
          // otherwise a refresh loses the whole conversation from the
          // user's view (it's still in the DB, just not linked).
          // Mirrors what the `done` frame carries in the success path.
          // Include the updated history too — same shape the DB would
          // hold after appendTurn — so the client can update its own
          // history state (needed for the anon-to-signed-in bridge to
          // carry the blocked turn across OAuth via sessionStorage).
          send({
            type: 'guardrail_blocked',
            kind,
            message,
            conversationId,
            history: [...history, ...persistedItems],
          });
        } else {
          // Unexpected error — let the stream fail and log it, but don't return a 500 to the client. The client will see the stream close and can retry. We rethrow the error so it gets logged by Next.js.
          console.error('[api/agent] error:', err);
          send({
            type: 'error',
            message: userFacingGuardrailErrorMessage(err),
          });
        }
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
