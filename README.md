# OpenAI Responses — Learning Journey

A progression from a single streaming Responses API call to a production-shaped architecture (REST API → MCP server → OpenAI Agent). Each step builds on the last; nothing is throwaway.

## Setup

```bash
npm install
cp .env.example .env   # then add your OPENAI_API_KEY
```

Requires Node 18+ (uses global `fetch`) and a valid OpenAI API key.

## Map of the project

| Day / Week | File(s) | Concept |
|---|---|---|
| 1 | `src/index.ts` | Streaming Responses API, token usage, response ID |
| 3 | `src/weather.ts` | Manual tool-call loop, `previous_response_id`, REPL |
| 5 | `src/books.ts` | Structured outputs with Zod / JSON Schema |
| 6 | `src/research.ts` | OpenAI Agents SDK — `Agent`, `Tool`, `Runner` |
| 7 | `src/mcp-server.ts` | MCP server (single source of truth for the library tools) |
| Week 2 | `openapi.yaml`, `src/rest-server.ts`, `src/weather-mcp.ts`, `src/weather-agent.ts` | REST API → MCP wrapper → Agent |

---

## Day 1 — Streaming response

Goal: call the Responses API, stream tokens to the console, print the response ID and token usage at the end.

```bash
npm start                          # default question
npm start -- "What is recursion?"  # custom question
```

Key shapes:

- `client.responses.create({ ..., stream: true })` returns an async iterator of events.
- Events of type `response.output_text.delta` carry incremental tokens — write to stdout.
- One terminal `response.completed` event carries the final `response.id` and `usage`.

That's why `usage` and `responseId` aren't overwritten in the `for await` loop — they're only set inside the single `completed` branch.

---

## Day 3 — Tool calling, no framework

A get_weather tool implemented as a TypeScript function, plus the manual round-trip:

```
User ─▶ Model ─▶ function_call ─▶ TS handler ─▶ function_call_output ─▶ Model ─▶ message
```

Run it:

```bash
npm run weather                         # interactive REPL
```

### The tool-call lifecycle

1. **Register** — describe the tool to the model (`tools: [...]` on the request).
2. **Decide** — model reads the user input and decides whether to call a tool.
3. **Emit** — model returns a `function_call` item with `call_id`, `name`, `arguments` (JSON **string**).
4. **Execute** — your code parses `arguments` and runs the actual function.
5. **Return** — feed the result back as a `function_call_output` input item, paired by `call_id`.
6. **Synthesize** — model either produces a final `message` or emits another `function_call` (the loop iterates).

`previous_response_id` is what gives the conversation memory: instead of resending the whole history, you point at the prior response and the server holds it for you.

### Conversation memory

The REPL maintains a `previousId` between user turns:

```ts
let previousId: string | undefined;
while (true) {
  const response = await client.responses.create({
    previous_response_id: previousId,   // ← chain
    input: userInput,
    tools,
  });
  // ... handle tool calls ...
  previousId = response.id;             // ← remember
}
```

That's why "My name is Dimitris" → "What is my name?" works in the same REPL session.

---

## Day 5 — Structured outputs

Goal: instead of free-form text, get JSON validated against a schema.

```bash
npm run books
```

```ts
const Book = z.object({
  title: z.string(),
  author: z.string(),
  year: z.number().int(),
});

const BookList = z.object({ books: z.array(Book) });

const response = await client.responses.parse({
  model: 'gpt-4o-mini',
  input: 'Recommend three books on the Russian Revolution.',
  text: { format: zodTextFormat(BookList, 'book_list') },
});

response.output_parsed.books  // typed: { title; author; year }[]
```

Key constraints of OpenAI's structured outputs:

- Top-level must be an **object**, not an array — wrap with `{ books: [...] }`.
- All properties are implicitly required. For "optional" use `z.union([..., z.null()])` (nullable, not optional).
- `additionalProperties: false` is forced.
- `client.responses.parse(...)` validates the model's JSON against your Zod schema and exposes the typed result on `output_parsed`.

---

## Day 6 — OpenAI Agents SDK

The same loop you wrote by hand on Day 3 — but wrapped by a Runner.

```bash
npm run research
```

The four concepts:

- **Agent** — bundle of identity, model, instructions, and tools.
- **Tool** — `tool({ name, description, parameters, execute })`. The Zod shape auto-converts to JSON Schema; the handler runs locally.
- **Runner** — `run(agent, input)`. Drives the model → tool → model loop and returns `{ finalOutput, history, ... }`.
- **Handoff** — agent-to-agent delegation. Intentionally ignored at this stage.

### Why we use `result.history` between turns

```ts
const result = await run(agent, [...history, { role: 'user', content: input }]);
history = result.history;
```

The Agents SDK doesn't expose `previous_response_id` the way the raw API does. Instead, `result.history` is the full transcript (user + tool calls + tool outputs + assistant message). Pass it back on the next turn and the model has full context.

### Reusing prior tool outputs

By default, the model will sometimes re-call a tool with the same arguments it already used — for safety, not because memory failed. The fix is in the agent's instructions, not the code:

> *Reuse prior tool results within the same conversation. Before calling a tool, check whether the answer is already derivable from earlier tool outputs in this thread — if so, reason from that data instead of calling the tool again. Never repeat a call with the same arguments.*

This is a strong hint, not a contract. If you need a hard guarantee, cache at the application layer keyed by `tool_name + args`.

### ISBN as the join key

`search_books` returns books with ISBN; `search_bookstores` takes an ISBN. The model carries ISBNs from one tool call into the next — the same way a relational DB join works:

```
search_books(topic) ─▶ books[].isbn ─▶ search_bookstores(isbn) ─▶ {store, price, copies}[]
```

---

## Day 7 — MCP server

Move the `search_books` / `search_bookstores` tools out of the agent and into an MCP server (`src/mcp-server.ts`). The agent talks to the server over stdio JSON-RPC instead of calling local functions.

```bash
npm run mcp:inspect      # browser UI for hand-testing the MCP server
npm run research         # the agent now consumes it
```

Three roles:

| Role | Where it lives | What it is |
|---|---|---|
| MCP server | `mcp-server.ts` (child process) | `McpServer` + `StdioServerTransport` |
| MCP client | inside `MCPServerStdio` (parent process) | Wrapped `Client` + `StdioClientTransport` from the MCP SDK |
| Agent integration | `@openai/agents` | Discovers tools via `tools/list`, invokes via `tools/call` |

`MCPServerStdio` is **misleadingly named** — it's the client side. `mcpServers: [mcpLibrary]` reads naturally as "this agent connects to the library server," so the SDK uses server-flavored vocabulary even though the client lives inside. Inside the code we call it `mcpLibrary` (capability-based naming) rather than `mcpClient` (protocol-role naming).

stdout in an MCP server is reserved for JSON-RPC traffic — use `console.error` for logs.

---

## Week 2 — REST + OpenAPI + MCP + Agent

A production-shaped stack:

```
┌──────────────┐    AgentInputItem[]    ┌──────────────────┐
│ weather-     │ ─────────────────────▶ │ OpenAI Responses │
│ agent.ts     │ ◀───────────────────── │ API (model)      │
└──────┬───────┘    function_calls       └──────────────────┘
       │  mcpServers: [mcpWeather]
       ▼
┌──────────────┐    JSON-RPC (stdio)    ┌──────────────────┐
│ MCP client   │ ─────────────────────▶ │ weather-mcp.ts   │
│ (inside SDK) │ ◀───────────────────── │ (MCP server,     │
└──────────────┘                         │  child process)  │
                                        └────────┬─────────┘
                                                 │  HTTP
                                                 ▼
                                        ┌──────────────────┐
                                        │ rest-server.ts   │
                                        │ (Express :3000)  │
                                        └──────────────────┘
```

### Pieces

- `openapi.yaml` — the contract for `GET /weather` and `GET /forecast`. Includes request parameters, success responses, and 400/404 errors.
- `src/rest-server.ts` — Express implementation of the spec on port 3000.
- `src/weather-mcp.ts` — *MCP wrapper*: an MCP server whose handlers translate each tool call into an HTTP request to the REST API. Owns no data of its own.
- `src/weather-agent.ts` — REPL agent that consumes the MCP server.

### Run order

Two terminals:

**Terminal A:**
```bash
npm run rest
```

**Terminal B:**
```bash
npm run weather:agent
```

Then in the agent REPL:
```
You: What's the weather in Athens and what's the forecast for the next 5 days?
```

### Three processes

The stack is three OS processes running at the same time:

| # | Process | Started by | Role |
|---|---|---|---|
| 1 | `rest-server.ts` (Express on `:3000`) | You — `npm run rest` in Terminal A | The actual REST API. Owns the weather data. |
| 2 | `weather-agent.ts` (REPL + Agents SDK) | You — `npm run weather:agent` in Terminal B | Parent process. Runs the REPL and the agent runner. |
| 3 | `weather-mcp.ts` (MCP server) | Automatically spawned as a **child** of process #2 by `MCPServerStdio({ fullCommand: 'tsx src/weather-mcp.ts' })` | The MCP wrapper. Translates each tool call into an HTTP request to process #1. |

You only manually start two (#1 and #2). Process #3 is launched and managed by the Agents SDK on your behalf — its lifetime is tied to `mcpWeather.connect()` / `mcpWeather.close()`.

```
process #2  ──(JSON-RPC over stdio)──▶  process #3  ──(HTTP)──▶  process #1
 agent                                    MCP server               REST API
```

If you kill any one of the three, the chain breaks: no REST → MCP returns errors; no MCP → agent has no tools; no agent → no one to ask anything.

### OpenAPI vocabulary

- **`in: query`** — parameter lives in the URL query string (`?city=Athens`). Alternatives: `path` (template var like `/users/{id}`), `header`, `cookie`.
- **`enum: [celsius]`** — the field is a string but must be exactly `"celsius"`. Even with one value, it's useful: clients know it's a discriminator, and code generators turn it into a typed union instead of `string`.

### "MCP wrapper" vs "MCP server"

Same thing — both are MCP servers in the protocol sense. *"Wrapper"* describes the pattern (translates MCP calls into another service), as opposed to a *native* server like `mcp-server.ts` that owns its own data. The MCP role is identical; only the implementation differs.

### Why three layers

- **REST API** is reusable from anywhere — browser, mobile, batch jobs, or an MCP wrapper. The model has no special access; it's just another HTTP client.
- **MCP** is the contract the agent speaks. Swap the REST backend for a different vendor's API and the agent never knows.
- **Agent** depends only on tool names and shapes — not on transport, deployment, or where the data lives.

Each layer can be tested in isolation: `curl` the REST endpoint, `mcp:inspect` to poke the MCP server, REPL to talk to the agent.

---

## Command index

| Command | Purpose |
|---|---|
| `npm start` | Day 1 — streaming Responses API call |
| `npm run weather` | Day 3 — manual tool-call REPL (no framework, no MCP) |
| `npm run books` | Day 5 — structured outputs |
| `npm run explore` | Print raw JSON of a plain and a tool-using response |
| `npm run research` | Day 6/7 — research agent backed by `mcp-server.ts` |
| `npm run mcp:inspect` | Inspect `mcp-server.ts` interactively |
| `npm run rest` | Week 2 — Express REST API on `:3000` |
| `npm run weather:mcp:inspect` | Inspect `weather-mcp.ts` (needs REST API running) |
| `npm run weather:agent` | Week 2 — agent → MCP → REST → answer |

## File index

```
day-1/
├─ openapi.yaml             ← API contract (Week 2)
├─ package.json
├─ tsconfig.json
├─ .env                     ← OPENAI_API_KEY (gitignored)
├─ .env.example
└─ src/
   ├─ index.ts              ← Day 1
   ├─ explore.ts            ← raw JSON of Response items
   ├─ weather.ts            ← Day 3 (manual tool loop, REPL)
   ├─ books.ts              ← Day 5 (structured outputs)
   ├─ research.ts           ← Day 6/7 (agent + MCP library)
   ├─ mcp-server.ts         ← Day 7 (library MCP server)
   ├─ rest-server.ts        ← Week 2 (REST API)
   ├─ weather-mcp.ts        ← Week 2 (MCP wrapper over REST)
   └─ weather-agent.ts      ← Week 2 (REPL agent)
```
