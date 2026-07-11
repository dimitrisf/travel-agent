'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentInputItem } from '@openai/agents';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Divider from '@mui/material/Divider';
import SendIcon from '@mui/icons-material/Send';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import BuildIcon from '@mui/icons-material/Build';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import FlightIcon from '@mui/icons-material/Flight';
import HotelIcon from '@mui/icons-material/Hotel';
import { types } from 'util';

type ToolCall = {
  callId?: string;
  name: string;
  args: string;
  output?: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  text: string;
  toolCalls: ToolCall[];
  handoffs: string[]; // agent names emitted by the SDK as it walks handoffs
  pending: boolean;
};

// StreamEvent represents the different types of events that can be received from the agent API via Server-Sent Events (SSE). Each event type has a specific payload structure, which is used to update the chat UI in real-time as the agent processes the user's input and interacts with tools.
// Booking tool names — used to switch rendering from generic accordion to
// a rich BookingCard with Confirm/Cancel buttons.
const BOOKING_TOOL_NAMES = new Set<string>([
  'propose_booking',
  'get_booking',
  'cancel_booking',
]);

type BookingStatus = 'PROPOSED' | 'CONFIRMED' | 'PAID' | 'CANCELLED' | 'FAILED';

// BookingLike is a simplified representation of a booking object returned by the travel agent's booking tools. It includes the booking ID, reference, status, customer information, total price, and arrays of flight and hotel bookings associated with the booking. Each flight booking includes details about the flight instance, cabin class, number of travelers, and total price. Each hotel booking includes details about the check-in/check-out dates, number of nights, guests, rooms, total price, and room type information.
// It's a structural type matching the API's fully-populated Booking JSON (flight + hotel line items with nested airline/airport/city and hotel/city).
type BookingLike = {
  id: number;
  reference: string;
  status: BookingStatus;
  customerName: string;
  customerEmail: string;
  totalPriceEUR: number;
  currency: string;
  cancellationReason: string | null;
  flightBookings: Array<{
    id: number;
    cabinClass: string;
    adults: number;
    children: number;
    seats: number;
    totalPriceEUR: number;
    flightInstance: {
      id: number;
      departureDatetime: string;
      arrivalDatetime: string;
      flightDefinition: {
        flightNumber: string;
        airline: { iataCode: string; name: string };
        originAirport: {
          iataCode: string;
          name: string;
          city: { name: string };
        };
        destinationAirport: {
          iataCode: string;
          name: string;
          city: { name: string };
        };
      };
    };
  }>;
  hotelBookings: Array<{
    id: number;
    checkinDate: string;
    checkoutDate: string;
    nights: number;
    guests: number;
    rooms: number;
    totalPriceEUR: number;
    roomType: {
      name: string;
      hotel: {
        name: string;
        address: string;
        stars: number;
        city: { name: string };
      };
    };
  }>;
};

type StreamEvent =
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

const SAMPLE_PROMPTS = [
  'Find me a flight from Athens to Berlin on July 3rd.',
  'I want a sunny weekend in Berlin under €600 total.',
  'Compare weather and cheapest hotels for Athens, Berlin, and London next weekend.',
];

export default function Home() {
  // messages is the chat history displayed in the UI. Each message has an id, role (user or agent), text content, an array of tool calls (if any), and a pending flag indicating if the message is still being processed.
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // history is the conversation history sent to the agent for context; in other words, it is the transcript the agent needs on the next turn. It includes both user and agent messages, but does not include the tool call details.
  // It is updated when the agent sends a 'done' event, which includes the full history of the conversation so far.
  // The difference between messages and history is that messages are for display in the UI, while history is for sending to the agent to maintain context across turns.
  const [history, setHistory] = useState<AgentInputItem[]>([]);

  // input is the current text input from the user.
  const [input, setInput] = useState('');

  // pending indicates if a request to the agent is currently in progress.
  // It locks the send button and input field to prevent multiple simultaneous requests, i.e., while a turn is in flight.
  const [pending, setPending] = useState(false);

  // bottomRef is a ref to an empty div at the bottom of the chat, used to scroll into view when new messages are added.
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to the bottom of the chat whenever messages change, so the latest message is visible.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    setInput('');
    setPending(true);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The request body includes the current conversation history and the new user input. The agent API will use this to generate a response, potentially calling tools as needed.
        body: JSON.stringify({ history, userInput }),
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
      // E.g., payload = { type: 'done', history: [...] }
      setHistory(payload.history);
    } else if (payload.type === 'error') {
      // Replace agent message with an error
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, text: `Error: ${payload.message}`, pending: false }
            : m,
        ),
      );
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <Container
      maxWidth="md"
      sx={{
        py: 4,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Typography variant="h4" gutterBottom>
        Travel Assistant
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Chat with a travel-planning agent backed by OpenAI + MCP.
      </Typography>

      <Paper
        elevation={0}
        variant="outlined"
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
          mt: 2,
          mb: 2,
          bgcolor: 'background.default',
        }}
      >
        {messages.length === 0 ? (
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, py: 2 }}
          >
            <Typography color="text.secondary" gutterBottom>
              Try one of these:
            </Typography>
            {SAMPLE_PROMPTS.map((p) => (
              <Chip
                key={p}
                label={p}
                onClick={() => send(p)}
                clickable
                disabled={pending}
                sx={{
                  height: 'auto',
                  py: 1,
                  '& .MuiChip-label': { whiteSpace: 'normal' },
                }}
              />
            ))}
          </Box>
        ) : (
          <Stack spacing={2}>
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            <div ref={bottomRef} />
          </Stack>
        )}
      </Paper>

      <Box
        component="form"
        onSubmit={onSubmit}
        sx={{ display: 'flex', gap: 1 }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder="Ask about flights, hotels, or weather…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending}
        />
        <IconButton
          type="submit"
          color="primary"
          disabled={pending || !input.trim()}
        >
          {pending ? <CircularProgress size={20} /> : <SendIcon />}
        </IconButton>
      </Box>
    </Container>
  );
}

// MessageBubble displays a single chat message, either from the user or the agent. It shows the message text, and if the message is from the agent and has tool calls, it displays each tool call in an accordion that can be expanded to show the arguments and output.
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <Box sx={{ maxWidth: '85%' }}>
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            bgcolor: isUser ? 'primary.main' : 'background.paper',
            color: isUser ? 'primary.contrastText' : 'text.primary',
            border: isUser ? 'none' : '1px solid',
            borderColor: 'divider',
            whiteSpace: 'pre-wrap',
          }}
        >
          {/* The following line displays the message text or a loading indicator if the message is pending and has no tool calls. */}
          {message.text ||
            (message.pending && message.toolCalls.length === 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="body2" color="text.secondary">
                  thinking…
                </Typography>
              </Box>
            ) : null)}
        </Paper>
        {/* Handoff chips — one per agent switch during the turn (Triage → Weather / Travel). */}
        {!isUser && message.handoffs.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}
          >
            {message.handoffs.map((agentName, i) => (
              <Chip
                key={`${i}-${agentName}`}
                label={`→ ${agentName}`}
                size="small"
                variant="outlined"
                color="secondary"
              />
            ))}
          </Stack>
        )}
        {/* The following line displays the tool calls if the message is from the agent and has tool calls. */}
        {!isUser && message.toolCalls.length > 0 && (
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {message.toolCalls.map((tc, i) => (
              <ToolCallView key={i} toolCall={tc} />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

// ToolCallView displays a single tool call in an accordion. The accordion shows the tool name and truncated arguments, and can be expanded to show the full arguments and output. If the tool call is still pending (no output yet), it shows a loading indicator.
function ToolCallView({ toolCall }: { toolCall: ToolCall }) {
  // If this is one of the booking tools AND the output has parsed cleanly into
  // a Booking-shaped object, render the rich BookingCard with Confirm/Cancel
  // buttons instead of the generic accordion.
  const booking = BOOKING_TOOL_NAMES.has(toolCall.name)
    ? tryParseBooking(toolCall.output)
    : null;
  if (booking) return <BookingCard initialBooking={booking} />;

  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        '&:before': { display: 'none' },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          minHeight: 36,
          '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center' },
        }}
      >
        {/* The following line displays the tool name and truncated arguments. E.g., get_weather({"city":"Athens"}) */}
        <BuildIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {toolCall.name}({truncate(toolCall.args, 60)})
        </Typography>
        {/* The following line displays a loading indicator if the tool call is still pending (no output yet). */}
        {toolCall.output === undefined && (
          <CircularProgress size={14} sx={{ ml: 1 }} />
        )}
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          args
        </Typography>
        <Box
          component="pre"
          sx={{
            fontSize: 12,
            m: 0,
            mb: 1,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {toolCall.args}
        </Box>
        <Typography variant="caption" color="text.secondary" display="block">
          output
        </Typography>
        <Box
          component="pre"
          sx={{
            fontSize: 12,
            m: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          {toolCall.output ?? '(pending)'}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

// Try to parse a tool output as a Booking. Returns null if the output isn't a
// booking-shaped JSON object (or isn't JSON at all).
function tryParseBooking(output: string | undefined): BookingLike | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { id?: unknown }).id === 'number' &&
      typeof (parsed as { reference?: unknown }).reference === 'string' &&
      typeof (parsed as { status?: unknown }).status === 'string'
    ) {
      return parsed as BookingLike;
    }
  } catch {
    // not JSON — not a booking
  }
  return null;
}

// A booking rendered as a rich MUI Card with flights, hotels, total, and
// action buttons. The card owns its own state for the current booking snapshot
// so Confirm / Cancel actions update it in place without touching the
// surrounding chat message.
function BookingCard({ initialBooking }: { initialBooking: BookingLike }) {
  // booking is the current snapshot of the booking, which may be updated by Confirm or Cancel actions. We initialize it with the initialBooking prop, which is the booking data parsed from the tool output. The card owns its own state for the current booking snapshot so Confirm / Cancel actions update it in place without touching the surrounding chat message.
  const [booking, setBooking] = useState<BookingLike>(initialBooking);

  // The busy state tracks whether a Confirm or Cancel action is currently in progress. It can be 'confirm', 'cancel', or null (no action in progress). This state is used to disable the buttons and show a loading indicator while the action is being processed.
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callBookingAction(action: 'confirm' | 'cancel') {
    setBusy(action);
    setError(null);
    try {
      // We call the booking action API endpoint with the booking id and action (confirm or cancel). The API returns the updated booking data, which we use to update the booking state. If the API returns an error, we throw an error to be caught in the catch block.
      const res = await fetch(`/api/booking/${booking.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await res.json()) as BookingLike & {
        // The API may return an error message in the body if the action fails. We check for this and throw an error if present. The error message is displayed in the card below the total price.
        error?: string;
        // code is an optional field that may be returned by the API to indicate a specific error code. We don't use it in the UI, but it may be useful for debugging or logging purposes.
        code?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setBooking(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const isProposed = booking.status === 'PROPOSED';
  const isPaid = booking.status === 'PAID';
  const isCancelled = booking.status === 'CANCELLED';

  return (
    <Card variant="outlined" sx={{ mt: 0.5 }}>
      <CardHeader
        title={
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {booking.reference}
            </Typography>
            <Chip
              label={booking.status}
              size="small"
              color={statusChipColor(booking.status)}
              variant={isProposed ? 'outlined' : 'filled'}
            />
          </Stack>
        }
        subheader={`${booking.customerName} · ${booking.customerEmail}`}
        sx={{ pb: 1 }}
      />
      <CardContent sx={{ pt: 0, pb: 1 }}>
        {booking.flightBookings.length > 0 && (
          <Box sx={{ mb: booking.hotelBookings.length > 0 ? 1.5 : 0 }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.5}
              sx={{ mb: 0.5 }}
            >
              <FlightIcon fontSize="small" color="action" />
              <Typography variant="subtitle2">Flights</Typography>
            </Stack>
            <Stack spacing={1}>
              {booking.flightBookings.map((fb) => (
                <FlightLegRow key={fb.id} leg={fb} />
              ))}
            </Stack>
          </Box>
        )}

        {booking.hotelBookings.length > 0 && (
          <Box>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.5}
              sx={{ mb: 0.5 }}
            >
              <HotelIcon fontSize="small" color="action" />
              <Typography variant="subtitle2">Hotels</Typography>
            </Stack>
            <Stack spacing={1}>
              {booking.hotelBookings.map((hb) => (
                <HotelStayRow key={hb.id} stay={hb} />
              ))}
            </Stack>
          </Box>
        )}

        <Divider sx={{ my: 1 }} />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="subtitle2">Total</Typography>
          <Typography variant="subtitle2">
            {formatEUR(booking.totalPriceEUR)}
          </Typography>
        </Stack>

        {booking.cancellationReason && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 1, display: 'block' }}
          >
            Cancellation reason: {booking.cancellationReason}
          </Typography>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </CardContent>
      {(isProposed || isPaid) && (
        <CardActions sx={{ pt: 0, pb: 1, px: 2 }}>
          {isProposed && (
            <Button
              variant="contained"
              size="small"
              startIcon={
                busy === 'confirm' ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <CheckCircleIcon />
                )
              }
              disabled={busy !== null}
              onClick={() => callBookingAction('confirm')}
            >
              Confirm
            </Button>
          )}
          <Button
            variant="outlined"
            size="small"
            color={isPaid ? 'warning' : 'primary'}
            startIcon={
              busy === 'cancel' ? (
                <CircularProgress size={14} />
              ) : (
                <CancelIcon />
              )
            }
            disabled={busy !== null}
            onClick={() => callBookingAction('cancel')}
          >
            {isProposed ? 'Cancel' : 'Cancel booking'}
          </Button>
        </CardActions>
      )}
      {isCancelled && (
        <CardActions sx={{ pt: 0, pb: 1, px: 2 }}>
          <Chip
            icon={<CancelIcon fontSize="small" />}
            label="Cancelled"
            size="small"
            variant="outlined"
          />
        </CardActions>
      )}
    </Card>
  );
}

// each leg is a flight instance + cabin class + seats + price, so we can render it in a single row.
// E.g., "Aegean · A3 123 — ATH → BER, Fri 1 Sep 14:30 → Fri 1 Sep 16:15, Economy, 2 seats, €350.00"
// The FlightLegRow component takes a flight booking leg as a prop and renders it in a Box with two Typography elements: one for the flight details and one for the timing, cabin class, seats, and price.
// The type BookingLike['flightBookings'][number] means that the leg prop is one of the elements of the flightBookings array in a BookingLike object. This allows us to access the flightInstance, cabinClass, seats, and totalPriceEUR properties of the leg.
function FlightLegRow({ leg }: { leg: BookingLike['flightBookings'][number] }) {
  // We use the flight definition to get the airline, flight number, origin and destination airports, and the flight instance to get the departure and arrival datetimes. We also display the cabin class, number of seats, and total price in EUR.
  const fi = leg.flightInstance;
  const fd = fi.flightDefinition;
  return (
    <Box>
      <Typography variant="body2">
        {fd.airline.name} · {fd.airline.iataCode} {fd.flightNumber} —{' '}
        {fd.originAirport.iataCode} → {fd.destinationAirport.iataCode}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatDT(fi.departureDatetime)} → {formatDT(fi.arrivalDatetime)} ·{' '}
        {leg.cabinClass} · {leg.seats} seat{leg.seats > 1 ? 's' : ''} ·{' '}
        {formatEUR(leg.totalPriceEUR)}
      </Typography>
    </Box>
  );
}

// each stay is a hotel + room type + checkin/checkout + nights + guests + rooms + price, so we can render it in a single row.
function HotelStayRow({
  stay,
}: {
  stay: BookingLike['hotelBookings'][number];
}) {
  const rt = stay.roomType;
  const hotel = rt.hotel;
  return (
    <Box>
      <Typography variant="body2">
        {hotel.name} · {rt.name} · {hotel.city.name}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatDate(stay.checkinDate)} → {formatDate(stay.checkoutDate)} ·{' '}
        {stay.nights} night{stay.nights > 1 ? 's' : ''} · {stay.guests} guest
        {stay.guests > 1 ? 's' : ''}, {stay.rooms} room
        {stay.rooms > 1 ? 's' : ''} · {formatEUR(stay.totalPriceEUR)}
      </Typography>
    </Box>
  );
}

// statusChipColor returns the MUI color for a booking status. E.g., 'PROPOSED' → 'warning', 'CONFIRMED' → 'success', 'CANCELLED' → 'error'.
function statusChipColor(
  status: BookingStatus,
): 'default' | 'success' | 'error' | 'warning' {
  switch (status) {
    case 'PROPOSED':
      return 'warning';
    case 'CONFIRMED':
    case 'PAID':
      return 'success';
    case 'CANCELLED':
    case 'FAILED':
      return 'error';
    default:
      return 'default';
  }
}

// formatEUR formats a number into a Euro currency string. E.g., 1234.56 → "€1,234.56"
function formatEUR(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(n);
}

// Flight/hotel datetimes are stored as UTC wall-clock — i.e. the ISO "09:40Z"
// means "09:40 at the airport", not a real UTC instant — so we render with
// timeZone: 'UTC' to keep the display consistent with what the agent (and the
// search results) show, regardless of the browser's local offset.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function formatDT(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })} ${d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
