import 'server-only';
import { NextRequest } from 'next/server';
import {
  Agent,
  MCPServerStreamableHttp,
  run,
  type AgentInputItem,
} from '@openai/agents';

export const runtime = 'nodejs';
// This route is a streaming endpoint, so we force dynamic to avoid caching issues
export const dynamic = 'force-dynamic';
// We set a generous timeout for the agent to complete its work, since it may need to call multiple tools and wait for their responses. Units are seconds.
export const maxDuration = 120;

// ───────────────────────────────────────────────
// MCP singletons (persisted across requests via globalThis)
// ───────────────────────────────────────────────

// We define a type for the MCP server bundle, which includes the travel and weather MCP servers. This allows us to type the global variable that will hold the initialized MCP server instances.
type McpBundle = { mcpTravel: MCPServerStreamableHttp; mcpWeather: MCPServerStreamableHttp };

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
        process.env.APP_BASE ??
        `http://localhost:${process.env.PORT ?? 3000}`;
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
// Agent factory (fresh instructions per request; today's date can shift)
// ───────────────────────────────────────────────

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// We define a function that computes the next four Fridays (or fewer if less than 4 Fridays in the next 28 days) from a given anchor date. This is used to validate user input for check-in dates. The function returns an array of strings in the format YYYY-MM-DD representing the upcoming Fridays.
function upcomingFridaysFrom(anchor: Date, count = 4): string[] {
  const fridays: string[] = [];
  for (let offset = 0; offset < 28 && fridays.length < count; offset++) {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() + offset);
    if (d.getUTCDay() === 5) fridays.push(d.toISOString().slice(0, 10));
  }
  return fridays;
}

// The weather specialist. Narrow scope: current conditions and short-term
// forecasts for the five demo cities. Triage will hand off to it for pure
// weather questions; anything mixing travel returns to the Travel specialist.
function buildWeatherAgent(mcpWeather: MCPServerStreamableHttp, today: string, todayWeekday: string) {
  return new Agent({
    name: 'WeatherAgent',
    model: 'gpt-4o-mini',
    instructions: [
      `You are the Weather specialist. Today is ${today} (${todayWeekday}).`,
      'Tools:',
      '- `get_weather(city)` returns current conditions for a city.',
      '- `get_forecast(city, days?)` returns a 1–7 day forecast for a city.',
      'Cities available: Athens, Berlin, London, Tokyo, New York. If the user asks about a different city, tell them only these five are supported.',
      'Answer only weather / forecast questions. If the user shifts to flights, hotels, budgets, or trip planning, tell them a trip-planning specialist will handle it and stop — do not attempt to plan the trip yourself.',
      'Be concise: city, temperature in °C, conditions. For forecasts, include the date range and per-day highlights.',
    ].join(' '),
    mcpServers: [mcpWeather],
  });
}

// The travel/concierge specialist. Owns both MCPs so it can factor weather
// into trip decisions ("sunny weekend in Berlin under €600 total"). Inherits
// the full instruction block that lived on the pre-handoff single agent.
function buildTravelAgent(
  mcpTravel: MCPServerStreamableHttp,
  mcpWeather: MCPServerStreamableHttp,
  today: string,
  todayWeekday: string,
  upcomingFridays: string[],
) {
  return new Agent({
    name: 'TravelAgent',
    model: 'gpt-4o-mini',
    instructions: [
      `You are the Travel specialist and trip planner. Today is ${today} (${todayWeekday}). Upcoming Fridays: ${upcomingFridays.join(', ')}.`,
      'When the user asks for a "weekend", default to Fri check-in → Sun check-out (2 nights). If the user says "long weekend" or "3-day weekend", use Fri → Mon (3 nights). Always verify the check-in date is a Friday from the list above and the check-out is the Sunday or Monday that follows.',
      'Origin: never guess the user\'s departure city. If the user has not stated an origin (in this turn or earlier in the conversation), ask them for it before calling `search_flights`. A destination alone ("weekend in Berlin", "trip to Tokyo") does NOT imply an origin.',
      'Round-trip vs one-way: a "weekend", "trip", or any multi-night stay is a round trip — you MUST call `search_flights` with BOTH `departure_date` and `return_date`, and you MUST include BOTH the outbound and return leg IDs when you eventually propose a booking. Only skip the return if the user explicitly says "one-way".',
      'Tools:',
      '- `search_flights(origin, destination, departure_date, return_date?, ...)` returns `{ outbound: [...], inbound: [...] }` of matching flights. Requires 3-letter IATA airport codes. Each result carries a `flight_instance_id` — you will need it for booking.',
      '- `search_hotels(city, checkin, checkout, ...)` returns hotels with available rooms, sorted cheapest first. Each result carries a `room_type_id` — you will need it for booking.',
      '- `propose_booking(idempotency_key, customer_name, customer_email, flights[], hotels[])` creates a PROPOSED booking. See the "Bookings" rules below.',
      '- `get_booking(id)` looks up a booking by numeric id. Use when the user references a prior booking.',
      '- `cancel_booking(id, reason?)` cancels a booking. Only call after the user explicitly asks to cancel.',
      '- `get_weather(city)` returns current weather for a city.',
      '- `get_forecast(city, days?)` returns a 1–7 day forecast for a city.',
      'IATA codes for cities in the demo library: Athens=ATH, Berlin=BER, London=LHR, Tokyo=HND, New York=JFK. Weather is available for the same five cities. Never guess codes for other cities; if the user names a city not in this list, tell them the library only covers those five.',
      'When the user mentions a relative date ("next Friday", "in three days"), resolve it to YYYY-MM-DD yourself based on today\'s date given above.',
      'For multi-part questions (e.g. flight + hotel within a budget, or "find a sunny weekend in Berlin"), plan the tool calls yourself and combine the results. Do arithmetic (totals, budget remaining, cheapest combination) in your head — do not ask a tool to do it.',
      'Demo data windows: forecast covers the next 7 days, flight schedules the next 14 days, hotel availability the next 21 days. Only pick check-in dates within the flight window.',
      'For a trip-planning request (any question that combines a destination and dates), you MUST call BOTH `search_flights` AND `search_hotels`. Presenting only one is an incomplete answer. If the user gave a budget, sum flights + hotels and confirm it fits.',
      'When the user cares about conditions at the destination ("sunny", "avoid rain", "warm"), call `get_forecast` for the destination city and factor the result into your recommendation. If the forecast horizon doesn\'t reach the candidate weekend, still return the best-available flights + hotels for that weekend and note that the forecast doesn\'t extend that far. If no candidate weekend in the forecast has the requested condition, pick the closest match (e.g. treat "clear" as broadly sunny) and note the compromise.',
      'Reuse prior tool results within the same conversation. Before calling a tool, check whether the answer is already derivable from earlier tool outputs in this thread. Never repeat a call with the same arguments.',
      'The demo API only supports EUR. If the user asks in another currency, state this limitation and continue in EUR.',
      'Bookings:',
      '- When the user says "book", "reserve", "yes, go ahead", or otherwise commits, call `propose_booking`. This creates a PROPOSED booking; the USER then clicks a "Confirm" button in the chat UI to actually reserve inventory and pay.',
      '- Do NOT call any `confirm_booking` tool. There is no such tool. Confirmation is a user action, not an agent action. After `propose_booking` returns, tell the user their booking is ready to confirm and to click the Confirm button in the card — do not say the booking is "confirmed", "successful", or "reserved".',
      '- Before calling `propose_booking`, summarize the trip in prose (dates, flights, hotel, total price, cancellation policy) and get a clear go-ahead if you don\'t already have one.',
      '- Idempotency: generate a fresh UUIDv4 for `idempotency_key` per new booking intent. Reuse the same key ONLY if you are retrying the exact same booking after a transient failure — never reuse across separate bookings.',
      '- Customer info: `customer_name` and `customer_email` are required. If the user hasn\'t provided them, ask before proposing.',
      '- Flight legs: pass `flight_instance_id` from a `search_flights` result. For round-trip, `flights` has TWO entries — the outbound `flight_instance_id` from `outbound[]` and the return `flight_instance_id` from `inbound[]`. For one-way, `flights` has ONE entry. `cabin_class`, `adults`, and `children` must match across legs.',
      '- Hotel stays: pass `room_type_id` from a `search_hotels` result, plus `checkin`, `checkout`, `guests`, `rooms`.',
      '- If the user asks about a prior booking ("what\'s the status of BKG-…", "did my booking go through"), use `get_booking` with the numeric id (the reference is human-facing; if you only have the reference, ask for the numeric id).',
      '- To cancel, confirm the user\'s intent in prose first, then call `cancel_booking`. Non-refundable hotels will reject cancellation — surface the reason from the error.',
      'Be concise. For flights include: flight number, times, price, stops. For hotels include: name, stars, room type, avg price/night, total for the stay, one line of key amenities. For weather include: city, temperature, conditions (and dates if forecast).',
    ].join(' '),
    mcpServers: [mcpTravel, mcpWeather],
  });
}

// The triage agent. No MCPs, no tools of its own — its only capability is to
// hand off to WeatherAgent or TravelAgent via the SDK's `handoffs` array.
function buildTriageAgent(weatherAgent: Agent, travelAgent: Agent) {
  return new Agent({
    name: 'TriageAgent',
    model: 'gpt-4o-mini',
    instructions: [
      'You are a routing triage agent. You do NOT answer questions yourself.',
      'You have two specialists:',
      '- WeatherAgent — answers pure current weather / forecast questions.',
      '- TravelAgent — plans trips, searches flights and hotels, and can factor in weather for trip decisions.',
      'Rules:',
      '- If the user is asking only about weather (current conditions, forecast, "is it sunny", "will it rain"), with no travel intent, hand off to WeatherAgent.',
      '- Otherwise — flights, hotels, budgets, "sunny weekend in Berlin", trip planning, or anything mixing weather with travel — hand off to TravelAgent.',
      'Hand off immediately. Do not narrate the decision. Do not attempt to answer.',
    ].join(' '),
    handoffs: [weatherAgent, travelAgent],
  });
}

// Wire the three agents together for one turn. Returns the triage as the entry
// point; the Runner walks handoffs as they happen.
function buildAgentGraph(
  mcpTravel: MCPServerStreamableHttp,
  mcpWeather: MCPServerStreamableHttp,
) {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const today = now.toISOString().slice(0, 10);
  const todayWeekday = WEEKDAY_NAMES[now.getUTCDay()];
  const upcomingFridays = upcomingFridaysFrom(now);

  const weatherAgent = buildWeatherAgent(mcpWeather, today, todayWeekday);
  const travelAgent = buildTravelAgent(
    mcpTravel,
    mcpWeather,
    today,
    todayWeekday,
    upcomingFridays,
  );
  return buildTriageAgent(weatherAgent, travelAgent);
}

// ───────────────────────────────────────────────
// SSE encoding helper
// ───────────────────────────────────────────────

// We define a helper function that unwraps the output of a tool call into a string. The output can be a string, an object with a text property, or an object with a content array. We handle each case and return a string representation of the output. This allows us to send the tool output to the client in a consistent format.
function unwrapToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const asObj = output as { text?: unknown; content?: unknown };
    if (typeof asObj.text === 'string') return asObj.text;
    if (Array.isArray(asObj.content) && asObj.content.length > 0) {
      return asObj.content
        .map((c) => {
          if (
            c &&
            typeof c === 'object' &&
            'text' in c &&
            typeof (c as { text: unknown }).text === 'string'
          ) {
            return (c as { text: string }).text;
          }
          return JSON.stringify(c);
        })
        .join('\n');
    }
    return JSON.stringify(output);
  }
  return String(output ?? '');
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
        send({ type: 'error', message: (err as Error).message ?? String(err) });
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
