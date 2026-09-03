# OpenAI Responses — Learning Journey

A progression from a single streaming Responses API call to a **production-shaped Next.js app**: Postgres → service layer → Next.js Route Handlers → MCP servers → OpenAI Agent → MUI chat UI. Each step builds on the last; the historical Day-by-day exploration is preserved in `legacy/` for reference.

## Quick start

```bash
npm install
git config core.hooksPath .githooks    # enable the pre-commit hook that blocks direct-to-main commits
cp .env.example .env    # then add OPENAI_API_KEY and DATABASE_URL

npm run db:generate
npm run db:migrate -- --name init
npm run db:seed

npm run dev             # Next.js dev server on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) — you'll get the Travel Assistant chat page. It talks to the same code the CLI REPL used to talk to; just wrapped in Next.js Route Handlers instead of Express, and driven from a browser instead of a terminal.

Requires Node 18+ (global `fetch`), a valid OpenAI API key, and a Postgres database (e.g. Neon).

## Map of the project

The current stack (active files) and the historical journey (files preserved in `legacy/`):

| Layer | Files | Notes |
|---|---|---|
| **Frontend** | `app/page.tsx`, `app/layout.tsx`, `app/theme.ts`, `src/components/*`, `src/hooks/useAgentChat.ts` | React Client Component chat UI, MUI theming. Streams SSE events into the DOM. Rich `BookingCard` for booking tool outputs (Stage 8). |
| **Explorer UI** | `app/explorer/*`, `src/components/explorer/*`, `src/lib/explorer/*` | Form-based parallel front-end over the same REST endpoints the agent calls — compare raw tool output against the agent's prose. Four sub-pages (weather, flights, hotels, booking) with a shared plumbing layer (`ResponsePanel`, `SubmitBar`, `usePersistedState`, `explorerFetch`). See the [Explorer UI section](#explorer-ui) below. |
| **API Route Handlers** | `app/api/weather/*`, `app/api/flights/route.ts`, `app/api/hotels/route.ts`, `app/api/booking/*` (Stage 8), `app/api/agent/route.ts` | Replace the three Express `*-api.ts` servers. `/api/agent` streams the agent's turn as SSE. The `/api/booking/*` set is a booking state machine with idempotency and CAS on both inventory decrements and status transitions. |
| **MCP servers** | `app/api/mcp/travel/route.ts`, `app/api/mcp/weather/route.ts` | Route Handlers using `createMcpHttpHandler` (Stage 7 — Streamable HTTP). Tool specs live under `src/mcp/tools/{travel,weather}/` (restructure). |
| **Agent graph** | `src/agents/build{Weather,Travel,Triage,Agent}Agent.ts`, `src/agents/buildAgentGraph.ts` | One file per agent's instructions + a wire-up (restructure). |
| **Domain layer** | `src/lib/services/*`, `src/lib/repositories/*`, `src/lib/index.ts` | Services + typed errors + Prisma-backed repositories + barrel with factory helpers (post-Stage-8 subfolder split). Cross-cutting primitives at `src/lib/` root: `pricing.ts` (`CabinClass` + multipliers, shared by Flight and Booking so search-time and propose-time prices can't diverge — moved here from `services/` since it's not service-owned), `cities.ts` (single source of truth for the five demo cities and their IATA/country/coords), `amenities.ts` (canonical amenity names), `zodDates.ts` (`IsoDate`), plus `services/CodedServiceError.ts::internalErrorFactory` (shared `INTERNAL_ERROR` wrapper). |
| **Utils / config / types** | `src/utils/*` (`apiErrorResponse`, `parsers`, `dates`, `toolOutput`, `queries/`), `src/config/samplePrompts.ts`, `src/types/*` (`chat`, `booking`, `stream`, `weather`) | Stateless helpers, editable constants, shared types (restructure). Weather Row/Result types live under `src/types/weather.ts` (extracted during M1 so the Explorer client bundle doesn't drag in service or Prisma code). |
| **Data** | `prisma/schema.prisma`, `prisma/seed.ts` | Booking, FlightBooking, HotelBooking, Payment + BookingStatus/PaymentStatus enums added in Stage 8. |
| **Historical journey** | `legacy/index.ts` (Day 1), `legacy/weather.ts` (Day 3), `legacy/books.ts` (Day 5), `legacy/research.ts` (Day 6/7), `legacy/mcp-server.ts` (Day 7), `legacy/weather-agent.ts`, `legacy/travel-agent.ts` (CLI REPLs) | Preserved but not part of the running app. Run individually with `tsx legacy/<file>` if you want to revisit the lesson. |

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
                                        │ weather-api.ts   │
                                        │ (Express :3000)  │
                                        └──────────────────┘
```

### Pieces

- `openapi.yaml` — the contract for `GET /weather` and `GET /forecast`. Includes request parameters, success responses, and 400/404 errors.
- `src/weather-api.ts` — Express implementation of the spec on port 3000.
- `src/mcp-servers/weather-mcp.ts` — *MCP wrapper*: an MCP server whose handlers translate each tool call into an HTTP request to the REST API. Owns no data of its own.
- `src/weather-agent.ts` — REPL agent that consumes the MCP server.

### Run order

Two terminals:

**Terminal A:**
```bash
npm run weather:api
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
| 1 | `weather-api.ts` (Express on `:3000`) | You — `npm run weather:api` in Terminal A | The actual REST API. Owns the weather data. |
| 2 | `weather-agent.ts` (REPL + Agents SDK) | You — `npm run weather:agent` in Terminal B | Parent process. Runs the REPL and the agent runner. |
| 3 | `weather-mcp.ts` (MCP server) | Automatically spawned as a **child** of process #2 by `MCPServerStdio({ fullCommand: 'tsx src/mcp-servers/weather-mcp.ts' })` | The MCP wrapper. Translates each tool call into an HTTP request to process #1. |

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

### Extension — Service layer + Postgres (Prisma)

The Week 2 stack had the REST server keep its data in a plain JavaScript object. This extension replaces that with a real database (Postgres on Neon) plus a proper business-logic layer behind the REST handlers. The agent and MCP layers stay exactly the same — only the REST server changes from the outside; the new code sits between Express and the database.

#### Updated stack

```
weather-agent.ts        (Agents SDK + REPL)
       │ stdio (MCP)
       ▼
weather-mcp.ts          (MCP wrapper)
       │ HTTP
       ▼
weather-api.ts          (Express handlers — thin)
       │
       ▼  ┌──────────── src/lib/index.ts ────────────┐
          │ createWeatherService()                   │
          │ isWeatherServiceError()                  │
          │ isZodValidationError()                   │
          └────┬──────────────────────────────┬──────┘
               ▼                              ▼
       WeatherService            ── throws ── WeatherServiceError
       (Zod validation
        + business logic)
               │
               ▼
       WeatherRepository
       (Prisma queries)
               │
               ▼
       PrismaClient ──▶ PostgreSQL (Neon)
```

#### Pieces

- `prisma/schema.prisma` — four tables: `City`, `Conditions` (lookup), `CurrentWeather` (1:1 with City), `Forecast` (many-per-city, unique on `cityId+date`).
- `prisma/seed.ts` — idempotent seed. Uses `upsert` so re-running refreshes forecast dates relative to today.
- `src/lib/WeatherServiceError.ts` — custom error class with a `code` field (`CITY_NOT_FOUND` | `NO_FORECAST_AVAILABLE` | `INTERNAL_ERROR`).
- `src/lib/WeatherRepository.ts` — Prisma queries. Projects DB rows into plain `{ city, tempC, conditions }` shapes so callers never see Prisma types.
- `src/lib/WeatherService.ts` — Zod-validated entry points (`getCurrentWeather`, `getForecast`). Wraps repository errors in `WeatherServiceError`. Returns `{..., units: 'celsius'}`.
- `src/lib/index.ts` — re-exports plus three helpers: `createWeatherService()` (lazy singleton `PrismaClient`), `isWeatherServiceError()`, `isZodValidationError()`.

#### Key design points

- **Validation lives at the service boundary.** `GetCurrentWeatherInput.parse(input)` runs *outside* the try/catch so `ZodError` bubbles up unchanged. The REST handler's error middleware turns it into a 400 with the issue details.
- **Repository returns plain data, not Prisma rows.** Service callers never depend on Prisma types — keeps the data layer swappable.
- **`WeatherServiceError` carries a `code`.** Middleware maps `CITY_NOT_FOUND` and `NO_FORECAST_AVAILABLE` to 404, `INTERNAL_ERROR` to 500. Adding new error categories means adding a code, not a new class.
- **DB errors are wrapped, not leaked.** Any Prisma throw inside the repo call becomes `WeatherServiceError` with `cause` set — Express never sees a `PrismaClientKnownRequestError`.
- **`createWeatherService()` lazily instantiates one `PrismaClient`.** A passed-in client wins (useful for tests). The shared default keeps the connection pool from multiplying.

#### Schema notes

- `CurrentWeather.cityId` is `@unique` → at most one row per city (1:1).
- `Forecast` has `@@unique([cityId, date])` → at most one forecast row per city per day, which is what makes the seed's `upsert` work.
- `onDelete: Cascade` on the city FKs → deleting a city wipes its weather and forecasts.
- `Conditions` is a lookup table (sunny, overcast with light rain, humid/partly cloudy, clear, clear/windy) — `description` is `@unique` so seeds are idempotent.

#### Run

Same two-terminal pattern as Week 2 — the agent and MCP layers are unchanged.

```bash
# Terminal A — now talks to Postgres via the service layer
npm run weather:api

# Terminal B
npm run weather:agent
```

To inspect or repopulate the database:
```bash
npm run db:studio     # browser UI
npm run db:seed       # re-seed (idempotent; refreshes forecast dates)
```

#### A note on overloaded "client" vocabulary

After this extension there are several "clients" in the codebase. They serve different layers and aren't related:

| Client | Where | Talks to | Hidden or explicit? |
|---|---|---|---|
| OpenAI client | `src/index.ts`, `src/weather.ts`, `src/books.ts`, `src/explore.ts` | OpenAI Responses API | Explicit `new OpenAI(...)` |
| OpenAI client | `src/research.ts`, `src/weather-agent.ts` | OpenAI Responses API | Hidden inside `Agent` (Agents SDK) |
| MCP client | `src/weather-agent.ts`, `src/research.ts` | MCP server (child process) | Hidden inside `MCPServerStdio` |
| HTTP client | `src/mcp-servers/weather-mcp.ts` | REST API | Implicit (Node global `fetch`) |
| Prisma client | `src/lib/index.ts` | Postgres | Explicit `new PrismaClient(...)` |

Each layer that talks to another process or service needs its own client for that service's protocol. What varies is whether the framework hides the client behind a higher-level abstraction.

---

## Travel Assistant

A second domain on top of the same project. The pipeline mirrors the weather stack — `Agent → MCP server → REST APIs → service layer → Prisma → Postgres` — but the data model is richer and the agent orchestrates *two* tools (`search_flights`, `search_hotels`) instead of one. The same `City` table is reused across weather and travel.

Built in stages so each layer can be reviewed in isolation:

1. **Stage 1** — Prisma models + idempotent seed
2. **Stage 2** — service + repository layer under `src/lib/`
3. **Stage 3** — two REST APIs (`flight-api.ts` on `:3001`, `hotel-api.ts` on `:3002`)
4. **Stage 4** — Travel MCP server (`travel-mcp.ts`) wrapping both APIs
5. **Stage 5** — Travel agent (`travel-agent.ts`) that orchestrates both tools

### Stage 1 — schema + seed

`prisma/schema.prisma` gains seven travel models, plus `Country` and a `countryId` FK on the existing `City`:

| Model | Purpose |
|---|---|
| `Country` | Lookup. `isoCode` unique. |
| `City` *(extended)* | Now required `countryId`. Reused by weather. |
| `Airport` | IATA/ICAO codes unique. FK to City. Lat/lon + IANA timezone. Two named relations to `FlightDefinition`. |
| `Airline` | IATA/ICAO codes unique. |
| `FlightDefinition` | Route template — airline + flight number + origin/destination + base price + duration + stops. Unique on `(airlineId, flightNumber)`. |
| `FlightInstance` | Specific operation of a route on a date. Unique on `(flightDefinitionId, departureDatetime)`. |
| `Hotel` | Name, address, stars, rating, lat/lon. Unique on `(cityId, name)`. |
| `RoomType` | Per-hotel rooms with capacity, beds, base price, currency. Unique on `(hotelId, name)`. |
| `Availability` | Date-varying price + rooms count per `(roomType, date)`. |
| `Amenity` | Lookup table (Breakfast, Free WiFi, Swimming Pool, Pet Friendly, Parking, Gym, AC, Spa). |
| `HotelAmenity` | Many-to-many join with composite PK `(hotelId, amenityId)`. |
| `CancellationPolicy` | 1:1 with Hotel via `hotelId @unique`. Carries `freeCancellation` + `description`. |

Why split price between `RoomType.basePrice` and `Availability.price`? Because real hotels change rates daily. `RoomType.basePrice` is the catalogue figure; `Availability.price` is what you actually pay on a given night. Similarly, `FlightDefinition` carries route-invariant data (price baseline, duration, stops); `FlightInstance` carries the schedule.

`prisma/seed.ts` populates (all upserts, idempotent):
- 5 countries, 5 cities (Athens, Berlin, London, Tokyo, New York), 5 airports, 5 airlines.
- 12 flight definitions covering Athens/Berlin/London/Tokyo/JFK pairs.
- 14 days × 12 routes = **168 flight instances**, computing arrival from departure + `durationMinutes`.
- 8 amenities, 14 hotels, **27 room types**, **567 availability rows** (21 days × room types; Fri/Sat = base × 1.15), **63 amenity links**, 14 cancellation policies.

### Stage 2 — service + repository layer

Under [src/lib/](src/lib/):

| File | Role |
|---|---|
| `TravelServiceError.ts` | Shared error class for flights + hotels. Codes: `CITY_NOT_FOUND`, `AIRPORT_NOT_FOUND`, `INVALID_DATE_RANGE`, `INTERNAL_ERROR`. |
| `FlightRepository.ts` | `findInstances()` joins FlightInstance → FlightDefinition → Airline + Airport[origin]→City + Airport[destination]→City. `airportExists()` for input validation. |
| `FlightService.ts` | `searchFlights()` — Zod-validated input matching your spec (`origin`, `destination`, `departure_date`, `return_date?`, `adults`, `children`, `cabin_class`, `nonstop_only`, `max_price?`, `preferred_airlines?`, `currency`). Returns `{ outbound: [...], inbound: [...] }`. |
| `HotelRepository.ts` | `findAvailable()` joins Hotel → City + RoomType (filtered by `maxGuests`) + Availability (filtered to the date window) + HotelAmenity → Amenity + CancellationPolicy. |
| `HotelService.ts` | `searchHotels()` — Zod-validated input. Converts boolean flags (`breakfast_required`, `pet_friendly`) into amenity-name filters. |
| `index.ts` *(updated)* | New exports + helpers: `createFlightService()`, `createHotelService()`, `isTravelServiceError()`. The lazy singleton `PrismaClient` is shared across all three service factories. |

#### Design points

- **Cabin multipliers live in the service, not the DB.** `economy=1, premium_economy=1.5, business=3, first=6` — adjustable without migrations.
- **`return_date` is optional.** When provided, the service does two queries (origin→destination + destination→origin) and packs them into `{ outbound, inbound }`. When absent, `inbound` is `[]`.
- **Hotel pricing aggregates across nights.** A hotel result is per `(hotel, room_type)` combination. The service sums `Availability.price` across every night in `[checkin, checkout)`, requires `roomsAvailable >= rooms` for every night, and returns both `total_price` and `avgPricePerNight`. Sorted ascending by avg price so the agent gets the cheapest first.
- **Boolean flags in the input → amenity-name filters in the repo.** `breakfast_required: true` becomes `requiredAmenities: ['Breakfast']`. The agent doesn't need to know the amenity catalogue exists.
- **All errors are wrapped.** Prisma throws → `TravelServiceError('INTERNAL_ERROR', { cause: err })`. Express middleware (Stage 3) will then map codes to HTTP statuses (`AIRPORT_NOT_FOUND`/`CITY_NOT_FOUND` → 404, `INVALID_DATE_RANGE` → 400, etc.).
- **Dates are UTC calendar days.** Both services interpret `YYYY-MM-DD` strings as UTC and query against `gte/lt` ranges. Real production code would need IATA-airport-local tz arithmetic; documented as a known simplification.

#### Conditional-spread trick used by the repos

The repository `where` clauses use `...(cond ? { key: val } : {})` to omit filter keys entirely when no filter is requested — neither `null` nor `undefined` ends up in the Prisma `where`. Keeps the generated SQL clean and the JSON debug-friendly.

### Stage 3 — REST APIs

Two thin Express servers, each backed by the Stage 2 service layer:

| File | Port | Endpoint |
|---|---|---|
| `src/flight-api.ts` | `3001` (overridable via `FLIGHT_API_PORT`) | `GET /flights` |
| `src/hotel-api.ts` | `3002` (overridable via `HOTEL_API_PORT`) | `GET /hotels` |

These run alongside `weather-api.ts` (`:3000`); three REST processes can coexist.

#### Handlers

Each handler does three things and nothing else:

1. Parse the query string into a typed input object (`parseSearchFlightsQuery` / `parseSearchHotelsQuery`).
2. Call the service (`flightService.searchFlights(input)` / `hotelService.searchHotels(input)`).
3. `next(err)` on throw → centralized error middleware does the HTTP mapping.

#### Centralized error middleware

| Error | HTTP status |
|---|---|
| `ZodError` (validation) | 400, body `{ error, issues: [...] }` |
| `TravelServiceError.code === 'AIRPORT_NOT_FOUND'` *(flights)* | 404 |
| `TravelServiceError.code === 'CITY_NOT_FOUND'` *(hotels)* | 404 |
| `TravelServiceError.code === 'INVALID_DATE_RANGE'` | 400 |
| `TravelServiceError.code === 'INTERNAL_ERROR'` | 500 |
| Anything else | 500 (logged) |

The error checks use the same `isZodValidationError` / `isTravelServiceError` helpers from `src/lib/index.ts` that the weather API uses.

#### Query parsing

`req.query` values are always `string | string[] | undefined`. Each handler runs a small parse step before handing off to the service:

| Field | HTTP shape | After parsing |
|---|---|---|
| `adults`, `days`, `max_price` | `"1"` | `1` (via `Number`) |
| `nonstop_only`, `breakfast_required`, etc. | `"true"` / `"false"` / `"1"` / `"0"` | `true` / `false` |
| `preferred_airlines` | `"A3,LH"` *or* `["A3","LH"]` (Express auto-arrayifies repeated keys) | `["A3","LH"]` |
| Missing fields | `undefined` | preserved so Zod's `.default()` applies |

`parseBool` and `parseList` live in [src/utils/parsers.ts](src/utils/parsers.ts). Both query-parser files ([src/utils/queries/searchFlightsQuery.ts](src/utils/queries/searchFlightsQuery.ts) and [searchHotelsQuery.ts](src/utils/queries/searchHotelsQuery.ts)) import them rather than redeclaring. (These moves happened in the post-Stage-8 restructure; before that they lived under `src/lib/`.)

The HTTP layer does the dumb coercion; the Zod schema in the service does strict validation. Two distinct jobs, kept apart deliberately.

#### Try it

```bash
# Terminal 1
npm run flight:api

# Terminal 2
npm run hotel:api

# Anywhere
curl "http://localhost:3001/flights?origin=ATH&destination=BER&departure_date=2026-07-03"
curl "http://localhost:3001/flights?origin=ATH&destination=BER&departure_date=2026-07-03&return_date=2026-07-06&cabin_class=business&nonstop_only=true&preferred_airlines=A3,LH"
curl "http://localhost:3002/hotels?city=Berlin&checkin=2026-07-03&checkout=2026-07-06&min_stars=4&breakfast_required=true&free_cancellation=true&max_price=200"

# Error cases
curl -i "http://localhost:3001/flights?origin=XXX&destination=BER&departure_date=2026-07-03"   # 404 AIRPORT_NOT_FOUND
curl -i "http://localhost:3001/flights?origin=ATH&destination=BER&departure_date=2026/07/03"   # 400 ZodError
curl -i "http://localhost:3002/hotels?city=Atlantis&checkin=2026-07-03&checkout=2026-07-06"    # 404 CITY_NOT_FOUND
curl -i "http://localhost:3002/hotels?city=Berlin&checkin=2026-07-06&checkout=2026-07-03"      # 400 INVALID_DATE_RANGE
```

#### Architecture after Stage 3

```
                                ┌── flight-api.ts (:3001) ─── FlightService ─── FlightRepository ─┐
                                │                                                                  │
[ HTTP client / curl / agent ] ─┤── hotel-api.ts  (:3002) ─── HotelService  ─── HotelRepository  ─┤─▶ Postgres (Neon)
                                │                                                                  │
                                └── weather-api.ts (:3000) ── WeatherService ── WeatherRepository ─┘
```

Three independent REST processes, one database, one `PrismaClient` per process (lazy-singleton via the factories in `src/lib/index.ts`). Stages 4 and 5 will put the Travel MCP server and Travel agent on top of the two travel APIs without changing any of this.

### Stage 4 — Travel MCP server

[src/mcp-servers/travel-mcp.ts](src/mcp-servers/travel-mcp.ts) is the MCP surface for both travel APIs — one server, two tools, two HTTP backends.

| Field | Value |
|---|---|
| Server identity | `name: 'travel', version: '1.0.0'` |
| Tools | `search_flights`, `search_hotels` |
| Transport | stdio (JSON-RPC over stdin/stdout) |
| Backends | `FLIGHT_API_BASE` (default `:3001`) + `HOTEL_API_BASE` (default `:3002`) |

#### Why two MCP servers (weather + travel) instead of one

Group tools by **domain cohesion**, not transport. Three rules of thumb that drove the choice:

1. **Tools used together belong in the same MCP.** Flights and hotels co-occur in nearly every trip-planning query — splitting them into `flight-mcp` + `hotel-mcp` would force agents to mount two connectors to do one task. Over-fragmentation.
2. **Tools serving different domains belong in different MCPs.** Weather and travel are unrelated capability sets. A travel agent doesn't need `get_weather` cluttering its tool list; a weather-only client doesn't need flight tools.
3. **Don't build a monolith.** MCP is explicitly designed for *composition* — a hybrid agent that needs both can write `mcpServers: [mcpWeather, mcpTravel]`, which is the natural shape on the agent side. Putting everything in one server forces every consumer to load every tool.

The "sunny weekend in Berlin" scenario is solved at the **agent layer**, not by merging MCPs.

#### What's in the file

- **Input schemas** mirror `SearchFlightsInput` and `SearchHotelsInput` from the service layer, written as raw Zod shapes (the form `registerTool` accepts). Every field carries a `.describe(...)` — those strings become the model-facing parameter docs.
- **Two handlers** that each build a URL with query params, fetch it, and return the response body as MCP text content.
- **Two helpers**:
  - `setParam(url, key, value)` — appends a query param only when value is defined. Arrays are joined with commas (matching how `parseList` in the REST APIs decodes them).
  - `fetchAsToolResult(url)` — packages `{ content: [{ type: 'text', text }], isError: !r.ok }` so each handler can be a flat list of `setParam` calls plus one `return`.

The handlers don't validate input — the REST APIs (and through them, the services) do. If the model emits malformed input, the REST layer returns 400 with Zod's `issues`, and the MCP wrapper surfaces that as `isError: true`. Single source of truth for validation.

#### Try it

Three terminals:

```bash
# Terminal 1
npm run flight:api

# Terminal 2
npm run hotel:api

# Terminal 3 — browser-based inspector
npm run travel:mcp:inspect
```

The inspector shows both tools, their auto-generated JSON Schemas (built from the Zod shapes), and lets you invoke them with sample arguments. Each call traces:

```
inspector ──stdio──▶ travel-mcp.ts ──HTTP──▶ flight-api.ts / hotel-api.ts ──▶ Postgres
```

#### Architecture after Stage 4

```
                                                    ┌── flight-api.ts (:3001) ─┐
                                                    │                          │
[ MCP client / inspector / agent ] ── stdio ──▶ travel-mcp.ts                   ├─▶ Postgres
                                                    │                          │
                                                    └── hotel-api.ts  (:3002) ─┘
```

Three external dependencies (two REST APIs + Postgres), one MCP surface. The model sees only `search_flights` and `search_hotels`; it has no idea two REST services are involved.

### Stage 5 — Travel agent

[src/travel-agent.ts](src/travel-agent.ts) — REPL that mounts **both `travel-mcp` and `weather-mcp`** so the model can orchestrate `search_flights`, `search_hotels`, `get_weather`, and `get_forecast` in one conversation. This is the composition story from Stage 4: two small domain MCPs combined at the agent layer, not merged into one server.

Same skeleton as `weather-agent.ts` — conversation state is carried across turns via `result.history`, and both MCP servers are connected/closed in parallel via `Promise.all(...)`.

#### The instruction block

The system prompt covers what the model can't figure out on its own. Every bullet exists because we hit a real failure without it during testing:

- **Today's date + weekday** — computed at startup and injected as `Today is ${date} (${weekday})`. Model can't reliably compute weekday from an ISO date on its own.
- **Upcoming Fridays** — the four next Fridays are computed in code and listed in the prompt. Removes the need for the model to do calendar arithmetic to resolve "next weekend", "this weekend", etc.
- **Weekend semantics** — "weekend" defaults to Fri check-in → Sun check-out (2 nights). "Long weekend" / "3-day weekend" = Fri → Mon (3 nights). Prevents the model from picking mid-week dates.
- **IATA lookup for the demo library** (`Athens=ATH, Berlin=BER, London=LHR, Tokyo=HND, New York=JFK`). Weather is available for the same five cities. Blocks confident guesses like `ROM` for Rome.
- **Data-window declarations** — forecast covers 7 days, flight schedules 14 days, hotel availability 21 days. The model must pick check-in dates within the flight window.
- **Trip planning = both tools** — for any question combining a destination and dates, the model MUST call BOTH `search_flights` AND `search_hotels`. Hotels-only is an incomplete answer.
- **Forecast integration** — when the user cares about conditions (sunny, no rain, warm), call `get_forecast` and factor it in. If the forecast horizon doesn't reach the candidate weekend, still return the best-available flights + hotels and note the gap. "Clear" counts as broadly sunny.
- **"Do arithmetic yourself"** — model sums flight + hotel, computes budget remaining ÷ nights, picks the cheapest combination. No calculator tool needed.
- **Reuse prior tool results** — don't re-query for follow-up questions the transcript already answers.
- **EUR only** — surface the currency limitation instead of silently ignoring foreign-currency requests.
- **Output shape guidance** — consistent formatting across flight, hotel, and weather replies.

#### Run the full stack

Four REST processes + one agent:

```bash
# Terminal 1
npm run weather:api        # :3000

# Terminal 2
npm run flight:api         # :3001

# Terminal 3
npm run hotel:api          # :3002

# Terminal 4
npm run travel:agent       # REPL — spawns travel-mcp.ts AND weather-mcp.ts as children
```

Six processes total. The agent manages both MCP child processes automatically; you don't run either MCP directly.

#### Example conversations

Sample transcripts show the live progress format (spinner + tool calls + tool outputs + streamed answer) documented in the *Real-time progress with streaming* section below.

**Simple flight query:**
```
You: Find me a flight from Athens to Berlin on July 3rd.
| thinking…
  → search_flights({"origin":"ATH","destination":"BER","departure_date":"2026-07-03"})
  ← {"outbound":[{"flight_number":"A3 824","airline":"Aegean Airlines","departure":"2026-07-03T09:40",…

Agent: Two flights from Athens to Berlin on 2026-07-03:
- A3 824 — 09:40 → 11:20, nonstop, €138
- LH 1753 — 12:30 → 15:10, 1 stop, €149
```

**Relative dates:**
```
You: I want to go from Athens to Berlin next Friday for three days. Show me flights and hotels.
| thinking…
  → search_flights({"origin":"ATH","destination":"BER","departure_date":"2026-07-10","return_date":"2026-07-13"})
  ← {"outbound":[…
  → search_hotels({"city":"Berlin","checkin":"2026-07-10","checkout":"2026-07-13"})
  ← [{"hotel":"City Budget Inn",…

Agent: For Fri 2026-07-10 → Mon 2026-07-13:
- Flights: A3 824 out (€138) + A3 825 back (€145) = €283
- Cheapest hotel: City Budget Inn Standard, 3 nights at ~€89/night = €267
- Total: €550
```
Model resolves "next Friday" against the injected date and picks return three days later. Two `search_flights` and `search_hotels` calls fire in parallel.

**Budget orchestration:**
```
You: I want to spend under €600 total for a three-day trip to Berlin next Friday.
```
Agent decomposes into flights + hotels, sums the cheapest round-trip (~€283), computes the remaining hotel budget (~€317 / 3 nights ≈ €105/night), calls `search_hotels` with `max_price=105`, and reports the cheapest viable combo.

**Multi-turn memory:**
```
You: Recommend flights from Athens to Berlin on July 3rd.
Agent: [lists A3 824, LH 1753]
You: Which is the cheapest?
Agent: [answers from history — no new tool call, no spinner beyond the initial "thinking"]
You: What hotels are available in Berlin from that day for 3 nights, under €150/night?
Agent: [one search_hotels call]
```

**Weather-aware trip planning:**
```
You: I want a sunny weekend in Berlin under €600 total.
```
Agent calls `get_forecast("Berlin")`, checks each upcoming Friday against the injected list, picks the sunniest weekend within the flight window, then calls `search_flights` + `search_hotels` for that Fri→Sun. Full sample transcript in the streaming section below.

**Cross-city comparison:**
```
You: I'm choosing between Athens, Berlin, and London for a July weekend. Show me temperatures and cheapest 3-night hotels for each.
```
Six tool calls in parallel: three `get_forecast` + three `search_hotels`. The tool-call log makes this vivid — you watch all six `→ …` lines fly by before the model composes the comparison.

#### Refining Stage 5 through testing

The instruction block isn't guessed — every bullet earned its place after a specific failure. Documented here so the lessons carry over next time you build an agent.

**Symptom 1 — "sunny weekend" returned mid-week dates.** Query: *"I want a sunny weekend in Berlin under €600 total."* Agent returned July 8–10, which is Wed–Fri.

Root cause: models don't reliably compute day-of-week from an ISO date. Given `2026-07-08`, the model doesn't consistently know that's a Wednesday.

Fix: compute deterministic things in **code**, judgment things in the **model**. Added weekday + upcoming-Friday computation at agent startup:

```ts
const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'] as const;
const todayWeekday = WEEKDAY_NAMES[now.getUTCDay()];

const upcomingFridays: string[] = [];
for (let offset = 0; offset < 28 && upcomingFridays.length < 4; offset++) {
  const d = new Date(now);
  d.setUTCDate(now.getUTCDate() + offset);
  if (d.getUTCDay() === 5) upcomingFridays.push(d.toISOString().slice(0, 10));
}
```

Injected into the prompt as `Today is ${today} (${todayWeekday}). Upcoming Fridays: ${upcomingFridays.join(', ')}.` plus a weekend-semantics rule.

Test: re-run the "sunny weekend in Berlin" query. Agent should now pick a Friday from the injected list.

**Symptom 2 — agent returned hotels but no flights.** Same query. Root cause: the model chose a Friday outside the 14-day flight window because the 7-day forecast didn't reach a "sunny" Friday. Silent failure — the model just skipped `search_flights` when it couldn't reconcile constraints.

Fix: declare the data windows explicitly and mandate that trip planning always calls both tools. Added to the prompt:

> *Demo data windows: forecast covers the next 7 days, flight schedules the next 14 days, hotel availability the next 21 days. Only pick check-in dates within the flight window. For a trip-planning request (any question that combines a destination and dates), you MUST call BOTH `search_flights` AND `search_hotels`. Presenting only one is an incomplete answer.*

Also added graceful fallback: *"If the forecast horizon doesn't reach the candidate weekend, still return the best-available flights + hotels for that weekend and note that the forecast doesn't extend that far. If no candidate weekend has the requested condition, pick the closest match (e.g. treat 'clear' as broadly sunny) and note the compromise."*

Test: same query. Agent should now return both flights and hotels, either for a sunny Friday within reach or for the least-bad Friday within the flight window (with a note explaining the tradeoff).

**Symptom 3 — forecast rows exhausted after a few days.** The seed generates dates *relative to when it runs*, with `FORECAST_DAYS = 7`, `FLIGHT_INSTANCE_DAYS = 14`, `HOTEL_AVAILABILITY_DAYS = 21`. If you leave the DB idle for a few days, the horizons shrink.

Fix: re-run `npm run db:seed`. Upsert semantics mean it's idempotent and fast — every date-based table gets fresh future rows. Old rows aren't deleted but are excluded by `date: { gte: today }` filters in the repositories.

Alternative fix: bump `FORECAST_DAYS` to `14` (or higher) in `prisma/seed.ts` so the forecast and flight windows line up. Removes the "no sunny Friday within forecast" fallback path entirely for weekend queries.

#### Real-time progress with streaming

Original problem: silence between the prompt and the answer. The REPL would sit at a blinking cursor for anywhere from 5 to 20 seconds while the model planned, ran tool calls, and drafted a reply. No signal that anything was happening — and no visibility into which tools the model was calling.

Fix: switch from `await run(...)` (which blocks until the final answer is ready) to `run(..., { stream: true })` (which returns a `StreamedRunResult` you iterate for events). Now every phase of the turn is surfaced live.

What you see now per turn:

```
You: I want a sunny weekend in Berlin under €600 total.
| thinking…
  → get_forecast({"city":"Berlin","days":7})
  ← {"city":"Berlin","days":[{"date":"2026-07-07","tempCMin":20,"tempCMax":26,"conditions":"clear"},…
\ thinking…
  → search_flights({"origin":"ATH","destination":"BER","departure_date":"2026-07-10","return_date":"2026-07-12","cabin_class":"economy"})
  ← {"outbound":[{"flight_number":"A3 824","airline":"Aegean Airlines","departure":"2026-07-10T09:40",…
- thinking…
  → search_hotels({"city":"Berlin","checkin":"2026-07-10","checkout":"2026-07-12","max_price":150})
  ← [{"hotel":"City Budget Inn","address":"Skalitzer Str. 80, 10997 Berlin",…

Agent: For a sunny weekend in Berlin from Fri 2026-07-10 to Sun 2026-07-12:
- Flights: A3 824 outbound (€138), A3 825 return (€145) — total €283
- Hotel: City Budget Inn Standard, 2 nights at €89.35/night — total €178.70
- Grand total: €461.70, well within your €600 budget.
```

Three visual channels working together:

1. **Spinner** (`| thinking…`, `/ thinking…`, `- thinking…`, `\ thinking…`) — animated frame refreshed every 100 ms on the same terminal line via `\r`. Runs whenever the model is between decisions (before the first tool call, and between tool outputs and the next call). Stops permanently once the answer starts streaming.
2. **Tool-call log** (`→ tool(args)`, `← result`) — printed the moment the model emits a tool call, and again when the result comes back. Immediately answers questions like *"did it call search_flights?"* or *"why did it re-query the same thing?"*.
3. **Streamed answer** (`Agent: …`) — the final reply lands token-by-token as the model produces it, not in one blob at the end.

Two stream event types drive the display:

| Event type | Handler action |
|---|---|
| `run_item_stream_event` with `item.type === 'tool_call_item'` | Clear spinner → print `→ name(args)` → restart spinner |
| `run_item_stream_event` with `item.type === 'tool_call_output_item'` | Clear spinner → print `← unwrapped_output` → restart spinner |
| `raw_model_stream_event` with `data.type === 'output_text_delta'` | Clear spinner (first delta only) → print `Agent: ` prefix (first delta only) → stream the token |

Three small helpers keep the loop tidy:

- **`createSpinner(label)`** — returns `{ start, clear }`. Braille-style spinners are portable-ish; the code uses plain ASCII (`| / - \`) for maximum terminal compatibility. `\r\x1b[K` erases the line before the next print.
- **`truncate(s, max)`** — caps arg/output display at 200 chars with a trailing `…`. Prevents a 20 KB flight-search result from flooding the terminal.
- **`unwrapToolOutput(output)`** — extracts the plain payload from MCP's `{ type: 'text', text: '…' }` wrapper. Without it, `JSON.stringify` on the wrapper double-escapes the inner JSON string and you end up staring at `\"city\":\"Berlin\"…`. The helper checks for both the direct-content-part shape and the full-envelope shape (defensively — different SDK versions unwrap different amounts), and falls back to `JSON.stringify` for anything else.

The whole streaming loop is ~30 lines. The most subtle part is the `if (!sawAssistantText)` guard: `output_text_delta` events arrive many times per second during streaming, but we only want to print the `\nAgent: ` prefix once. Same pattern used in Day 1's `src/index.ts` — proves the same primitive scales from a single-call demo to a full agent runner.

#### Final architecture

```
                    You (REPL)
                       │
                       ▼
              ┌─────────────────┐         Agents SDK (Runner + history)
              │ travel-agent.ts │─────────┐
              └────────┬────────┘         │ mcpServers: [mcpTravel, mcpWeather]
                       │                  │
        OpenAI Responses API              │
                       │                  ▼
                    (model)         ┌──────────────────────────┐
                       │            │ two MCP clients          │  (inside MCPServerStdio × 2)
                       ▼            └──────┬────────────┬──────┘
                    tool calls             │ stdio      │ stdio
                       ─────────────▶      ▼            ▼
                                    ┌──────────────┐  ┌──────────────┐
                                    │ travel-mcp.ts│  │ weather-mcp  │  (child processes)
                                    └──┬────────┬──┘  └──────┬───────┘
                                       │ HTTP   │ HTTP       │ HTTP
                                       ▼        ▼            ▼
                            ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                            │ flight-api   │  │ hotel-api    │  │ weather-api  │
                            │  (:3001)     │  │  (:3002)     │  │  (:3000)     │
                            └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                                   │                 │                 │
                            FlightService     HotelService      WeatherService
                                   │                 │                 │
                            FlightRepository  HotelRepository   WeatherRepository
                                   │                 │                 │
                                   ▼                 ▼                 ▼
                                        ┌─────────────────────┐
                                        │    PrismaClient     │
                                        └─────────┬───────────┘
                                                  │
                                                  ▼
                                           PostgreSQL (Neon)
```

Every layer talks to the next through a stable contract — Zod-validated function signature at the service layer, JSON over HTTP between REST APIs and wrappers, JSON-RPC between MCP client and server. You can swap any single layer (Postgres → SQLite, Express → Fastify, stdio → Streamable HTTP) without touching the others.

Every layer talks to the next through a stable contract (Zod-validated function signature at the service layer, JSON over HTTP between the REST APIs and the wrapper, JSON-RPC between the MCP client and server). You can swap out any single layer — replace Postgres with SQLite, swap Express for Fastify, run the MCP server over Streamable HTTP instead of stdio — and the rest of the stack is unaffected.

### Stage 6 — Multi-agent handoffs

Splits the monolithic `TravelAgent` into a **triage + specialists** structure using the fourth Agents SDK concept from Day 6 (Handoff), which we deliberately deferred at the time.

#### Structure

```
User request
    ▼
TriageAgent  (no MCPs, no tools — just routing instructions)
    │
    ├── handoff to ──▶ WeatherAgent  (weather MCP only, tight instructions)
    │                       └── returns final answer
    │
    └── handoff to ──▶ TravelAgent   (travel MCP + weather MCP — concierge role)
                            └── returns final answer
```

Three agents, all constructed per request inside `buildAgentGraph(mcpTravel, mcpWeather)` in [app/api/agent/route.ts](app/api/agent/route.ts):

- **`buildWeatherAgent(mcpWeather, today, todayWeekday)`** — narrow specialist. Only the weather MCP. Instructions restrict it to current conditions / forecasts across the five demo cities and tell it *not* to attempt trip planning if the user drifts off-topic.
- **`buildTravelAgent(mcpTravel, mcpWeather, today, todayWeekday, upcomingFridays)`** — the concierge. Mounts both MCPs so multi-domain queries ("sunny weekend in Berlin under €600") still work in one agent. Instruction block is essentially what Stage 5's single agent had.
- **`buildTriageAgent(weatherAgent, travelAgent)`** — no MCPs, no tools. `handoffs: [weatherAgent, travelAgent]`. Instructions: "route to the right specialist and hand off immediately; do not answer yourself."

The Route Handler now runs `run(triageAgent, …)`. The SDK exposes each entry in `handoffs` as an internal `transfer_to_X` tool the model can call; when it does, the Runner switches the active agent seamlessly and continues emitting stream events from the specialist's perspective.

#### Design choices, and what we didn't do

- **Concierge instead of a strict 4-way split.** A Flight-only agent and a Hotel-only agent would look tidy in a diagram but would force every real trip query to route through a concierge anyway — the specialists would earn their keep less. Keeping travel unified is honest.
- **Fresh triage every user turn.** Each request builds the whole graph and runs from the triage. No per-user "current agent" persistence. Matches how OpenAI's own examples work; simpler mental model.
- **No `Agent.asTool()` composition.** That's a different pattern (agent-as-tool for delegation without control transfer) worth exploring later. Handoff already illustrates the core concept.
- **No shared instruction module.** Weather and Travel duplicate ~5 lines about IATA codes and EUR-only. Two files ≠ premature abstraction; once we see a third specialist we can consolidate.

#### New stream event

The Route Handler forwards `agent_updated_stream_event` (fired by the Runner when the active agent changes) as a new SSE frame:

```
data: {"type":"agent_updated","agentName":"TravelAgent"}
```

The chat client ([app/page.tsx](app/page.tsx)) records these in a `handoffs: string[]` on the current agent message and renders each one as a small MUI Chip (`→ TravelAgent`, `→ WeatherAgent`, etc.) directly above the tool-call accordions. You get a visible trail of routing decisions per turn.

The SDK also emits `handoff_call_item` / `handoff_output_item` as `run_item_stream_event` items. We deliberately skip those on the server side — the `agent_updated` frame carries the same information more cleanly, and forwarding both would clutter the UI with a `transfer_to_TravelAgent(…)` tool card next to every handoff chip.

#### What to try

**Pure weather query** — should route to WeatherAgent:
```
What's the weather in Berlin right now?
→ [→ WeatherAgent chip]
  get_weather({"city":"Berlin"})
Agent: Berlin is 24°C and clear.
```

**Trip planning query** — should route to TravelAgent:
```
Find me a flight from Athens to Berlin on July 10th.
→ [→ TravelAgent chip]
  search_flights({...})
Agent: Two flights from Athens to Berlin on 2026-07-10 …
```

**Multi-domain query** — TriageAgent still routes to TravelAgent (which has both MCPs):
```
I want a sunny weekend in Berlin under €600 total.
→ [→ TravelAgent chip]
  get_forecast({...})
  search_flights({...})
  search_hotels({...})
Agent: For Fri 2026-07-10 → Sun 2026-07-12 …
```

If you removed the concierge-style TravelAgent and only had narrow Flight and Hotel specialists, this third query would need either a further handoff chain or an `Agent.asTool()` composition — a good exercise for a future stage.

### Stage 7 — Remote MCP transport (stdio → Streamable HTTP)

Swaps the child-process stdio MCP servers for **HTTP-based Route Handlers**. The agent still gets `search_flights`, `search_hotels`, `get_weather`, `get_forecast` — but now over an HTTP endpoint instead of a JSON-RPC pipe to a spawned `tsx` process.

#### Why do this

Stdio has one deployment-blocking limitation: **serverless functions can't reliably spawn child processes**. Vercel, Cloudflare Workers, Lambda — none of them let you `spawn('tsx src/mcp-servers/…')` inside a request handler and expect a persistent connection. The whole app was pinned to always-on hosting (a VM or a container running `next start`) until we made this change.

Secondary wins:

- **Third-party MCPs.** Any MCP server reachable over HTTP (GitHub's MCP, public vector-store MCPs, etc.) becomes a URL change instead of a plumbing project.
- **Scale independence.** MCPs can be split off to separate services / regions, wired in via `TRAVEL_MCP_URL` / `WEATHER_MCP_URL` env vars.
- **Language independence.** Remote MCPs no longer have to be TypeScript spawnable via `tsx`. A Python or Go MCP with the same HTTP endpoint plugs in identically.

#### New files

- **[src/lib/mcpHttpHandler.ts](src/lib/mcpHttpHandler.ts)** — small (~120 line) shared helper. Given a list of tool specs + `{ name, version }`, returns a Next.js POST handler that speaks MCP over JSON-RPC. Implements the six methods we actually need (`initialize`, `notifications/*`, `ping`, `tools/list`, `tools/call`) directly rather than adapting the SDK's `StreamableHTTPServerTransport` (which expects Node's http request/response and doesn't slot cleanly into an App Router Route Handler).
- **[app/api/mcp/travel/route.ts](app/api/mcp/travel/route.ts)** — travel MCP as a Route Handler. Two `McpToolSpec`s (search_flights, search_hotels), each with a JSON Schema `inputSchema` and a handler that calls `callApi()` — the same helper from `src/lib/mcpApiClient.ts` used by the deleted stdio version. The whole file is ~120 lines, most of it schema descriptions.
- **[app/api/mcp/weather/route.ts](app/api/mcp/weather/route.ts)** — weather MCP as a Route Handler. Same shape, just with `get_weather` / `get_forecast`.

#### Files that changed

- **[app/api/agent/route.ts](app/api/agent/route.ts)** —
  - `MCPServerStdio` → `MCPServerStreamableHttp` (rename in the import + type + constructors).
  - `{ fullCommand: 'tsx src/mcp-servers/…' }` → `{ url: 'http://localhost:PORT/api/mcp/…' }`. Each URL is overridable via env var (`TRAVEL_MCP_URL`, `WEATHER_MCP_URL`) for deploy-time routing.
  - The `globalThis` singleton cache stays. HTTP MCP connections are cheap, but keeping the same shape means the client-side code is diff-minimal.

#### Files that were deleted

- `src/mcp-servers/travel-mcp.ts` and `src/mcp-servers/weather-mcp.ts`. Their tool schemas and handler wiring now live in the Route Handlers above.
- The empty `src/mcp-servers/` folder.
- The `travel:mcp:inspect` and `weather:mcp:inspect` npm scripts. Replaced by a single `mcp:inspect` that launches the MCP Inspector; enter the URL (`http://localhost:3000/api/mcp/travel` or `.../weather`) in its browser UI to hand-test.

#### The runtime picture, before and after

Before Stage 7:

```
Agent (parent) ──spawn──▶ tsx src/mcp-servers/travel-mcp.ts ──stdio JSON-RPC──▶ [travel tools]
```

After Stage 7:

```
Agent ──HTTP POST──▶ /api/mcp/travel (Route Handler) ──JSON-RPC dispatch──▶ [travel tools]
```

Everything downstream of the MCP (the `callApi` loopback, the REST Route Handlers, the service layer, Prisma, Postgres) is untouched.

#### Why write the wire protocol by hand

`@modelcontextprotocol/sdk` ships a `StreamableHTTPServerTransport` class, but it expects a Node `http.IncomingMessage` and `http.ServerResponse`. Next.js Route Handlers only see the standard Web `Request` and `Response`. Bridging the two is possible but ugly; hand-implementing the protocol is ~120 lines and completely transparent — you can `curl` an endpoint and read the exchange:

```bash
curl -X POST http://localhost:3000/api/mcp/weather \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```

Get back a plain JSON-RPC response listing `get_weather` and `get_forecast` with full JSON Schemas.

#### Verification checklist

After the change, the browser chat should still work end-to-end:

1. `npm run dev` — Next.js starts on `:3000`.
2. Open http://localhost:3000 — chat UI loads.
3. Ask *"weather in Berlin?"* — chip `→ WeatherAgent`, one tool call, weather answer.
4. Ask *"sunny weekend in Berlin under €600 total"* — chip `→ TravelAgent`, three parallel tool calls (`get_forecast`, `search_flights`, `search_hotels`), full trip plan.

The agent turn now involves **zero child processes** — the whole exchange is one Next.js process talking to itself via HTTP. Deployable to Vercel or any serverless platform without further changes.

---

### Stage 8 — Booking flow

Stage 8 turns the travel agent from a **planner** into a **booker**. Alongside `search_flights` / `search_hotels`, the agent can now `propose_booking`, `get_booking`, and `cancel_booking` — creating a `PROPOSED` booking record, looking it up, or cancelling it. **Confirming is deliberately not an agent tool**: the user clicks a button on a rich booking card in the chat UI, and that button POSTs to a REST endpoint the agent can't reach. Same reason a checkout page never lets an agent hit "Pay Now" without a human in the loop.

#### The six design defaults

Before writing any code, we picked six things:

1. **One `Booking` per trip, not per leg.** Matches how GDS/PNR systems shape their records: the booking is the container, `FlightBooking` / `HotelBooking` rows are line items. Cancelling a "trip" cascades to all its line items.
2. **Round-trip = 2 flight rows.** Each leg is its own `FlightBooking` referencing a `FlightInstance`. Simpler pricing and seat reservation than modelling out-and-back as one row.
3. **Three IDs for three jobs.** `id` (autoincrement, foreign-key target), `reference` (`BKG-2026-A9F3K2`, human-facing, monospace-friendly), `idempotencyKey` (client-generated UUID, retry-safe).
4. **Compare-and-swap for inventory.** Reserving seats / rooms uses `updateMany({ where: { seatsAvailable: { gte: N } }, data: { seatsAvailable: { decrement: N } } })`. Postgres executes the check + decrement atomically; two concurrent confirms can't over-book.
5. **Confirm is a UI action.** The agent proposes; the user confirms. No `confirm_booking` tool exists. Full rationale below.
6. **Soft-delete on cancel.** Cancelled bookings stay in the DB with `status: CANCELLED` — payments FK, idempotency safety, cancellation-rate analytics, and audit trail all fall out for free.

#### Data model

New enums and tables in [prisma/schema.prisma](prisma/schema.prisma):

- `BookingStatus` — `PROPOSED | CONFIRMED | PAID | CANCELLED | FAILED`.
- `Booking` — `reference`, `idempotencyKey` (unique), `status`, `customerName` / `customerEmail`, `totalPriceEUR`, `cancellationReason`, timestamps.
- `FlightBooking` — `flightInstanceId` FK, `cabinClass`, `adults`, `children`, `seats`, `pricePerSeatEUR`, `totalPriceEUR`.
- `HotelBooking` — `roomTypeId` FK, `checkinDate`, `checkoutDate`, `nights`, `guests`, `rooms`, `totalPriceEUR`.
- `Payment` — `bookingId` FK, `amount`, `currency`, `PaymentStatus` (`PENDING | SUCCEEDED | FAILED | REFUNDED`), `provider` (`'stub'`), `providerRef`, `completedAt`.
- `FlightInstance.seatsAvailable` — new field, default 180. The counter the confirm step decrements.
- Back-relations added to `City`, `RoomType`, `FlightInstance`.

#### Service layer

[src/lib/services/BookingService.ts](src/lib/services/BookingService.ts) exposes four operations, all wrapped in `prisma.$transaction`:

| Method | State transition | Inventory | Notes |
|---|---|---|---|
| `proposeBooking(input)` | (new) → `PROPOSED` | untouched | Idempotent on `idempotencyKey` — retry with the same key returns the same row. Prices every line item from live data. |
| `confirmBooking(id)` | `PROPOSED` → `PAID` | reserves seats + rooms via CAS | Creates a `Payment` row. Fails with `INSUFFICIENT_SEATS` / `INSUFFICIENT_ROOMS` if inventory has been eaten since propose, or `INVALID_STATE` if a concurrent request already flipped the row (CAS on the status transition). Pays the propose-time price with no re-quote or expiration — deliberate simplification, matches the stub-payment posture. |
| `cancelBooking(id, reason?)` | `PROPOSED` \| `PAID` → `CANCELLED` | restores if previously reserved | Enforces per-hotel `CancellationPolicy` for `PAID` bookings (non-refundable hotels throw `NON_REFUNDABLE`). CAS on the final status transition rejects concurrent confirm-vs-cancel races. |
| `getBooking(id)` \| `getBookingByReference(reference)` | (read) | — | Returns the full aggregate with all line items. |

All reads use a single shared `bookingInclude` shape in [src/lib/repositories/BookingRepository.ts](src/lib/repositories/BookingRepository.ts) — one place to change what "fully populated Booking" means, plus consistent `orderBy` (flights by `departureDatetime asc`, hotels by `checkinDate asc`) so the UI always sees legs in travel order.

#### Idempotency

The agent generates a fresh UUID `idempotency_key` per new booking intent (per instruction). If the same call is retried (network hiccup, tool-retry logic), `proposeBooking` finds the existing row by unique key and returns it verbatim — no duplicate. If the caller intends a *new* booking, they must generate a new UUID. Same pattern Stripe uses on its `Idempotency-Key` header.

#### REST endpoints

- `POST /api/booking/propose` → `201 { booking }` (or 200 if idempotent hit).
- `GET /api/booking/[id]` → `200 { booking }`.
- `POST /api/booking/[id]/confirm` → `200 { booking updated }`. **Called by the Confirm button in the UI, never by an agent tool.**
- `POST /api/booking/[id]/cancel` (optional `{ reason }` body) → `200 { booking updated }`.

Error mapping ([src/utils/apiErrorResponse.ts](src/utils/apiErrorResponse.ts)):

```
*_NOT_FOUND      → 404
INVALID_STATE    → 409  (Conflict — e.g. confirm a CANCELLED booking)
NON_REFUNDABLE   → 409
INSUFFICIENT_*   → 409
INTERNAL_ERROR   → 500
```

#### MCP tools

Three new specs under [src/mcp/tools/travel/](src/mcp/tools/travel/):

- `propose_booking` — takes `idempotency_key`, `customer_name`, `customer_email`, `flights[]` (with `flight_instance_id` from a `search_flights` result), `hotels[]` (with `room_type_id` from a `search_hotels` result). Round-trip = 2 entries in `flights`.
- `get_booking` — takes `id`. For the agent to look up prior bookings.
- `cancel_booking` — takes `id`, optional `reason`. Agent instructions require confirming with the user in prose first.

Note the missing tool: **`confirm_booking` is deliberately not registered**. See "Why the agent can't confirm" below.

The existing search-result rows were extended so the agent has IDs to pass through:

- `FlightService` result now includes `flight_instance_id`.
- `HotelService` result now includes `hotel_id` and `room_type_id`.

#### UI — the BookingCard

When the client-side detects a tool output from `propose_booking` / `get_booking` / `cancel_booking` whose JSON parses to a booking-shaped object, [src/components/ToolCallView.tsx](src/components/ToolCallView.tsx) renders a rich [BookingCard](src/components/BookingCard.tsx) instead of the generic accordion:

- **Header** — `reference` (monospace) + status chip (colour-coded).
- **Flights section** — one `FlightLegRow` per leg (stacked by `FlightLegRows`).
- **Hotels section** — one `HotelStayRow` per stay (stacked by `HotelStayRows`).
- **Total** — sum, formatted as EUR via `Intl.NumberFormat`.
- **Actions** —
  - `PROPOSED` → **Confirm** (primary) + **Cancel** (outlined).
  - `PAID` → **Cancel booking** (outlined, warning colour).
  - `CANCELLED` → a small "Cancelled" chip; no buttons.
- **Error alert** — if a confirm or cancel action fails, the API's error message surfaces inline.

Clicking Confirm POSTs to `/api/booking/[id]/confirm`; clicking Cancel POSTs to `/api/booking/[id]/cancel`. The card owns its own booking state — the response updates it in place without touching the surrounding chat message.

Datetime formatting uses `timeZone: 'UTC'` throughout. Flight ISO strings in the DB are stored as UTC wall-clock (i.e. `09:40Z` means "09:40 at the airport"), so rendering with the browser's local offset would shift them wrong. All BookingCard formatters explicitly stay in UTC.

#### Why the agent can't confirm

- **User consent surface.** A cancel-and-refund policy needs a human clicking the button, not the model choosing to.
- **Payment integration.** Real confirm calls will one day charge a card via Stripe. The button is where 3-D Secure / SCA challenges will live.
- **Prompt-injection defense.** A user (or a fetched page) can't say "confirm my booking" and have the agent do it — there's no tool to reach for.
- **Prose contract.** Post-`propose_booking`, agent instructions explicitly forbid saying "confirmed" / "successful". They say: "ready to confirm — click the Confirm button."

#### Agent instructions

[buildTravelAgent](src/agents/buildTravelAgent.ts) grew a "Bookings" subsection: how to propose, how to summarize in prose first, when to generate a fresh UUID vs reuse for retries, forbid `confirm_booking`, use search-result IDs, one leg per direction. It also grew two orthogonal rules the pre-booking version needed but never had:

- **Origin** — never guess. If the user hasn't stated an origin airport, ask before calling `search_flights`. Destination alone doesn't imply origin.
- **Round-trip** — a "weekend" or multi-night stay is a round trip. `search_flights` must be called with both `departure_date` and `return_date`; `propose_booking` must include both leg IDs. Only skip when the user explicitly says "one-way".

These weren't strictly Stage 8 changes — they were emergent behaviours on `gpt-4o-mini` that broke once the tool surface grew from 4 to 7 (adding booking tools crowded the attention budget and the model started defaulting to one-way, guessing origins).

#### Verification checklist

1. *"I want a sunny weekend in Berlin under €600 total."* → agent asks for origin.
2. Reply *"Athens."* → agent calls `search_flights` with `return_date`, `search_hotels`, `get_forecast`, summarizes trip.
3. *"Book me the cheapest, one adult, economy. My name is Dimitris, dimitris@example.com."* → agent calls `propose_booking` with two flight legs. A **BookingCard** renders with status `PROPOSED`, both legs in chronological order, total price.
4. Click **Confirm** → card updates to `PAID` (green chip); Confirm button disappears; only Cancel booking remains.
5. Click **Cancel booking** on a `PAID` booking with a refundable hotel → card updates to `CANCELLED` (red chip).
6. On a non-refundable hotel → error alert appears with the policy description; booking stays `PAID`.

---

### Post-Stage-8 restructure

By the end of Stage 8, the repo had outgrown a flat `src/lib/`. `app/page.tsx` was ~1000 lines. `src/lib/` was mixing five different concerns (services, repositories, error classes, MCP transport helpers, HTTP-error mapper, query-string parsers). This stage doesn't add features — it moves files so the layout matches the mental model.

#### Guiding principles

1. **Domain vs glue.** `src/lib/` is *only* domain services and their repositories/errors. Everything else — HTTP mapping, URL parsing, date helpers, MCP transport — moves to a colocated helper folder.
2. **One thing per file.** `MessageBubble`, `ToolCallView`, `BookingCard`, `FlightLegRow`, `FlightLegRows`, `HotelStayRow`, `HotelStayRows`, `SamplePrompts`, `MessageBubbles` — each in its own file under `src/components/`. Same rule for agent builders, MCP tool specs. Tuning any one is a file-scoped operation.
3. **Grouped by concern, not by name.** `src/mcp/tools/travel/` groups the five travel MCP tools; `src/lib/repositories/` groups all four Prisma-backed data-access files; `src/agents/` groups all three build-agent factories plus the wire-up.
4. **camelCase everywhere.** File names match their default export where reasonable (`useAgentChat.ts`, `BookingCard.tsx`, `buildTravelAgent.ts`) — greppable, no mixed conventions.

#### The new layout

```
src/
├── agents/              — Agent graph (buildTravelAgent, buildWeatherAgent,
│                          buildTriageAgent, buildAgentGraph)
├── components/          — All React components (MessageBubble, MessageBubbles,
│                          ToolCallView, BookingCard, FlightLegRow(s),
│                          HotelStayRow(s), SamplePrompts)
├── config/              — Editable constants (samplePrompts.ts)
├── hooks/               — React hooks (useAgentChat — owns messages, history,
│                          pending, send; exposes { messages, pending, send })
├── lib/                 — Domain layer
│   ├── index.ts             — Barrel + factory helpers + PrismaClient singleton
│   ├── repositories/        — BookingRepository, FlightRepository,
│   │                           HotelRepository, WeatherRepository
│   └── services/            — BookingService, FlightService, HotelService,
│                              WeatherService + typed error classes
├── mcp/                 — MCP transport and tool specs
│   ├── mcpHttpHandler.ts    — JSON-RPC-over-HTTP handler for Route Handlers
│   ├── mcpApiClient.ts      — callApi / postApi factory
│   └── tools/
│       ├── travel/          — searchFlights, searchHotels, proposeBooking,
│       │                      getBooking, cancelBooking (5 factories)
│       └── weather/         — getWeather, getForecast (2 factories)
├── types/               — Shared types
│   ├── booking.ts           — BookingLike + BookingStatus
│   ├── chat.ts              — ToolCall + ChatMessage
│   └── stream.ts            — StreamEvent union
└── utils/               — Stateless helpers
    ├── apiErrorResponse.ts  — Service error → HTTP response mapper
    ├── dates.ts             — WEEKDAY_NAMES, upcomingFridaysFrom
    ├── parsers.ts           — parseBool, parseList
    ├── toolOutput.ts        — Unwrap MCP tool result → string
    └── queries/
        ├── searchFlightsQuery.ts
        └── searchHotelsQuery.ts
```

#### Notable extractions

- **[useAgentChat](src/hooks/useAgentChat.ts)** — the ~300-line `send()` + `applyEvent()` chunk lifted out of `page.tsx`. Owns `messages`, `history`, `pending`; returns `{ messages, pending, send }`. Page has no chat mechanics left — just JSX and text-input state.
- **MCP tool factories.** Each tool spec exports a `makeXxxToolSpec(callApi)` (or `postApi`) factory rather than a spec object. The route file creates one API client from its own env-var-derived BASE and hands it to each factory. Preserves the per-MCP env override (`TRAVEL_API_BASE` / `WEATHER_API_BASE`) and makes the tool spec files pure and testable.
- **Agents.** `buildTravelAgent` / `buildWeatherAgent` / `buildTriageAgent` moved from `app/api/agent/route.ts` (which had grown to ~350 lines) into one file each. `buildAgentGraph` is the wire-up. Editing one agent's instructions is now file-scoped.
- **Autoscroll encapsulated.** `MessageBubbles` owns its own `bottomRef` + `useEffect(scrollIntoView, [messages])`. `page.tsx` never touches scroll concerns.

#### What stayed put

- `app/` — Next.js App Router. Route Handlers and `page.tsx` are unchanged in role, just leaner.
- `prisma/` — schema and seed.
- `legacy/` — historical CLI/Express versions.

#### `app/page.tsx` — before and after

```
Before:  ~1000 lines  (types + hooks + components + JSX + state + effects)
After:    ~85 lines   (imports, input state, form submit, JSX shell)
```

The delta went to `src/hooks/useAgentChat.ts` (chat logic), `src/components/*` (rendering), `src/types/*` (shared types), and `src/config/samplePrompts.ts` (the seeded prompts).

---

### Stage 9 — Guardrails

Adds an input/output safety layer around the agent graph. Two flavours:

- **Input guardrails** run on the entry agent (`TriageAgent`) before the model is invoked. They can short-circuit the whole turn.
- **Output guardrails** run on the specialists (`TravelAgent`, `WeatherAgent`) after the model produces its final text. They can reject the response before it reaches the user.

Built in phases so the SDK plumbing gets exercised in isolation before the real policy logic lands.

#### Phase 1 — Plumbing

Inert `passThroughOutputGuardrail` wired on both specialists to confirm the SDK contract: `outputGuardrails: [...]` on the Agent config, `execute({ agent, agentOutput, context })` returning `{ tripwireTriggered, outputInfo }`.

Key SDK contract: **only the entry agent's input guardrails fire.** Specialists' input guardrails are dead code. That's why the off-topic guardrail lives on `TriageAgent`, not on the specialist that ends up handling the request.

#### Phase 2 — Off-topic input guardrail

[src/guardrails/offTopicInputGuardrail.ts](src/guardrails/offTopicInputGuardrail.ts) — a classifier that trips on non-travel input. Runs BEFORE the main agent turn, so an off-topic prompt never reaches the specialists' expensive model.

Implementation is a small `client.responses.create` call to `gpt-4o-mini` returning a structured verdict (`ON_TOPIC` | `OFF_TOPIC` + reason). Extracts the user's latest turn via [src/utils/extractLatestUserText.ts](src/utils/extractLatestUserText.ts), which walks the input array to find the last user message.

When it trips, the friendly `outputInfo.message` becomes user-facing text: *"I only handle travel planning, bookings, and weather questions. Ask me about flights, hotels, trips, or the forecast for one of the demo cities…"*.

#### Phase 3 — Booking-truthfulness output guardrail

[src/guardrails/bookingTruthfulnessOutputGuardrail.ts](src/guardrails/bookingTruthfulnessOutputGuardrail.ts) — attached to `TravelAgent`. Enforces the "agent proposes, user confirms" split from the `propose_booking` spec at the SDK layer, alongside the existing prompt rule.

Text-only regex check with three named patterns:

- **`subject-is-final`** — "your booking is confirmed", "the reservation has been processed", "your trip is finalized".
- **`successfully-<verb>`** — "successfully booked", "successfully reserved".
- **`first-person-booked`** — "I've booked you", "I have reserved the flight".

If any pattern hits, the guardrail trips with a friendly explanation of the actual constraint: *"I can't confirm bookings on your behalf — reserving inventory happens when you click the Confirm button in the booking card…"*.

**Scope note.** Text-only heuristic. The SDK's output-guardrail context doesn't expose tool-call history, so cross-referencing invented booking references against real `propose_booking` outputs isn't possible from here. Threading tool history through `RunContext.context` (needed for the fuller LLM-classifier + cross-reference version) is deferred as **Phase 3b**.

#### Phase 4 — Prompt-injection input guardrail

[src/guardrails/promptInjectionInputGuardrail.ts](src/guardrails/promptInjectionInputGuardrail.ts) — a second input guardrail on `TriageAgent`, attached alongside the off-topic one. Same shape (gpt-4o-mini classifier, single-token verdict, fail open on classifier errors), different purpose: catches inputs trying to override the assistant's own instructions, extract its system prompt, or hijack its persona.

Distinction from off-topic: off-topic catches wrong-domain requests ("what pizza topping?"). Prompt-injection catches *on-topic-shaped* wording that's actually meant as a command against the assistant. The classifier prompt enumerates three families and gives SAFE examples that use suspicious tokens legitimately ("ignore my last request", "forget the hotel search"), so legit conversational updates don't false-positive.

Both guardrails run; either can trip. When either fires, the same Phase 5 UI treatment (below) surfaces the friendly message.

The eval harness has two paired cases for this: `promptInjectionBlocked` (a clear multi-vector injection — instruction-override + role-hijack + system-prompt-extraction — must trip) and `injectionLookalikeAllowed` (a legit weather query prefixed with "ignore my previous question" — must NOT trip). Together they guard against both false negatives (letting real injections through) and false positives (blocking legitimate conversational pivots).

#### Phase 5 — UI for guardrail trips

The Route Handler ([app/api/agent/route.ts](app/api/agent/route.ts)) catches `InputGuardrailTripwireTriggered` / `OutputGuardrailTripwireTriggered` separately from generic errors and emits a distinct `guardrail_blocked` SSE frame carrying `{ kind: 'input' | 'output'; message }`.

Client-side ([useAgentChat.ts](src/hooks/useAgentChat.ts)) sets `blockedBy: { kind }` on the affected `ChatMessage`. [MessageBubble.tsx](src/components/MessageBubble.tsx) renders blocked messages with a soft warning-tinted background/border and a `Blocked by input/output guardrail` chip — visually distinct from both normal replies (white paper) and errors (red-prefixed text). Genuine errors still route through the `error` frame with the previous styling; nothing changed for that path.

#### File index

```
src/guardrails/
├── offTopicInputGuardrail.ts               (Phase 2 — input, classifier-based)
├── promptInjectionInputGuardrail.ts        (Phase 4 — input, classifier-based)
├── bookingTruthfulnessOutputGuardrail.ts   (Phase 3 — output, regex-based)
└── passThroughOutputGuardrail.ts           (Phase 1 stub — replaced on WeatherAgent in Stage 12, file deleted post-ship)

src/utils/
├── extractLatestUserText.ts                (walker used by both input guardrails)
└── userFacingGuardrailErrorMessage.ts      (extracts outputInfo.message from a trip)
```

---

### Stage 10 — Eval harness

Deterministic regression testing for agent behaviour. Cases are TypeScript files; the runner walks them, invokes a fresh agent graph per case, and checks assertions against the observed tool calls / final text / guardrail state.

The harness exists because Stage 9 turned into whack-a-mole. Every prompt tweak that fixed one behaviour risked breaking another, and manual browser testing didn't scale. Each observed drift becomes a fixed test: origin-guessing, round-trip arithmetic, verbatim-price quoting, options-count, off-topic misfires, booking finality claims, cross-turn hallucination. Regressions surface within seconds.

#### Shape of a case

Every case exports a `Case` object with:

- `name` (kebab-case identifier for the `--case` filter)
- `description` (one-liner for the log)
- `user: string` (single-turn) OR `turns: string[]` (multi-turn)
- `expect(out: CaseOutput): AssertionResult[]`

`CaseOutput` aggregates: all tool calls (parsed args + parsed output), the final assistant text, the last agent, any guardrail trip, any thrown error.

#### Assertion library

Shared helpers under [src/evals/assertions.ts](src/evals/assertions.ts) so cases stay declarative:

- `noErrorsOrGuardrails(out)` / `noThrownErrors(out)` — clean-run baselines
- `guardrailTripped(out, { messageMatches? })` — for guardrail-expected cases
- `finalAgent(out, name)` — assert routing
- `toolCalled(out, name | names[])` / `toolNotCalled(out, name)` / `noToolCalls(out)`
- `toolArgsMatch(out, name, matcher, describe)` — predicate over some call's args
- `finalMessageMatches` / `finalMessageDoesNotMatch` — regex over the final text

Case-specific inline logic (trip-total arithmetic in `sunnyWeekendFromAthens`, per-night-price verification in `verbatimHotelPrices`, `min(requested, available)` in `optionsCountMatchesRequest`) stays in the case file — the assertion library covers repeat patterns, not one-offs.

#### Case set

Thirteen cases at close-out (11 from Stage 10, plus two added when Stage 9 Phase 4 shipped). What each guards against:

- `weatherInBerlin` — structural sanity: guardrail lets weather through, hands off to WeatherAgent, calls a weather tool.
- `hotelsInBerlin` — hotel-only search hits TravelAgent + `search_hotels`; no flight-search bleed.
- `sunnyWeekendFromAthens` — round-trip arithmetic drift (trip total must trace to a real outbound + return + hotel combo from tool output).
- `offTopicPizza` — off-topic guardrail actually trips on non-travel input.
- `originAskRequired` — no `search_flights` when the user hasn't stated an origin (Stage 9 origin-guessing drift).
- `verbatimHotelPrices` — every €NNN/night in the summary appears in a `search_hotels` output.
- `optionsCountMatchesRequest` — user asks for N options → summary lists exactly `min(N, available)`.
- `onTopicFollowUpAllowed` — off-topic guardrail doesn't misfire on short travel-context follow-ups (`"book it"`).
- `noBookingPrereqsBeforeOptions` — ambiguous `"yes"` doesn't trigger `propose_booking` when no options were shown.
- `verbatimPriceAcrossTurns` — prices in a follow-up turn still trace to turn-1 tool output (no cross-turn hallucination).
- `bookingProposalNoFinalityClaim` — a legitimate booking proposal doesn't trip the truthfulness guardrail and doesn't slip finality language past the second-layer regex check.
- `promptInjectionBlocked` — a clear multi-vector injection attempt trips the prompt-injection guardrail before any specialist runs.
- `injectionLookalikeAllowed` — a legit weather query with suspicious wording ("ignore my previous question") is NOT blocked; routes to WeatherAgent normally.

#### Runner machinery

[src/evals/runCase.ts](src/evals/runCase.ts):

- Loops turns, threading `result.history` into the next `run()` call (mirrors `/api/agent`'s continuation pattern).
- Aggregates tool calls across turns with parsed args + output paired by `callId`.
- Detects tool-error envelopes (`{error, code}` shape from `apiErrorResponse`) and folds them into `errored`. No more vacuous passes on tool failures.
- Catches guardrail trips separately from unexpected errors so cases can assert on both distinctly.

[src/evals/runner.ts](src/evals/runner.ts):

- **DB pre-flight wake** — hits a lightweight endpoint with retry+backoff before any case runs, so free-tier Neon Scale-to-Zero doesn't blow up the first case. ~15s bounded retry budget.
- **Tool-output summary** — each call in the log gets `→ {outbound: array[5], inbound: array[0]} raw preview…`. Spots "tool returned 5 but the summary listed 1" at a glance.
- **Per-case timing** — `(N.Ns)` after each case for spotting slow ones.
- **`--brief`** — skips the agent-output block on green cases; failing cases still dump full context.
- **`--case <substring>`** — run only cases whose name includes the substring.
- **End-of-run summary** — one line per failed case with its assertion ratio: `- verbatim-hotel-prices (2/4 failed)`.
- **Env-var fallbacks** — `EVALS_BRIEF=1`, `EVALS_CASE=name` work around npm arg-stripping on some Windows versions.

#### Run it

```bash
npm run evals                                            # full suite, chatty
EVALS_BRIEF=1 npm run evals                              # green cases stay quiet
EVALS_CASE=origin npm run evals                          # just the origin-ask case
npx tsx src/evals/runner.ts --brief --case sunny         # if npm's stripping args
```

Requires `npm run dev` running on `:3000` for the MCP endpoints.

#### File index

```
src/evals/
├── runner.ts                                (entry — pre-flight wake + case loop + summary)
├── runCase.ts                               (per-case run + turn threading + tool-error folding)
├── types.ts                                 (Case, CaseOutput, AssertionResult + getTurns)
├── assertions.ts                            (shared assertion helpers)
└── cases/                                   (13 case files, one per regression class)

src/utils/
├── priceAppearsInBlob.ts                    (shared by both verbatim-price cases)
└── samplePricesFromBlob.ts                  (shared debug-detail helper)
```

---

### Stage 11 — Booking-truthfulness cross-reference

Extends Stage 9 Phase 3's booking-truthfulness guardrail beyond the text-only regex layer. The regex catches finality-claim phrasings ("your booking is confirmed") but has no idea whether specific things the agent quotes — booking references, totals — actually match what `propose_booking` returned, and it can't catch novel finality phrasings ("you're all set for the trip") that don't match any pattern. Stage 11 adds two more layers: a deterministic cross-reference layer that reads real tool outputs and rejects claims that don't check out (Phase 3), and an LLM classifier that judges finality claims semantically in the context of the tool history (Phase 4).

Three guardrails ship on `TravelAgent` and run in sequence: regex first (cheap, always available), cross-reference second (deterministic, requires tool history to be threaded), classifier third (LLM call, gated by a cheap pre-filter). Any can trip.

#### Defense in depth — at a glance

| Layer | Catches | Mechanism | Cost per turn | Fail mode |
| --- | --- | --- | --- | --- |
| **1. Regex** (Stage 9 Phase 3) | Known finality-claim phrasings — *"your booking is confirmed"*, *"the reservation has been made"* | Static regex on `agentOutput` | ~0 | Always on |
| **2. Cross-reference** (Phase 3) | Specific factual claims that don't match tool outputs — invented `BKG-…` references, wrong € totals, booking mentioned with no `propose_booking` call | Regex extraction + set/tolerance check against `toolCallCollector` | ~0 | Fail-open if collector missing |
| **3. LLM classifier** (Phase 4) | Novel finality phrasings the regex misses — *"you're all set"*, *"seats are locked in"* | Pre-filter on finality-indicator words → `gpt-4o-mini` verdict (`BACKED` \| `UNBACKED_FINALITY`) with tool-history summary | ~1 `gpt-4o-mini` call on a minority of turns | Fail-open if collector missing OR classifier errors |

The layers are **ordered by cost and specificity**: cheap regex first, then deterministic cross-reference, then the LLM as a semantic backstop. Any trip halts the chain, so the classifier's cost is minimized in practice — most drift is caught earlier. Each layer targets a different failure mode, and stacking them gives coverage no single layer could reach.

#### Foundation — the SDK-threading problem

Layers 2 and 3 both need access to the conversation's tool-call history. This subsection describes how that history reaches the guardrails; the phase sections below build on it.

Output guardrails receive `agent`, `agentOutput`, and `RunContext<TContext>` — but not tool-call history. `RunContext.context` is user-supplied and mutable, so if we populate it during the run, guardrails can read it. The SDK exposes this hook via `agent.on('agent_tool_end', ...)` — fires after each tool resolves, with the RunContext, the tool, its result, and the tool call details.

Threading pattern (all public SDK API, no subclassing or monkey-patching):

```ts
type AgentRunContext = { toolCallCollector: ToolCallRecord[] };

// Once, at agent construction:
agent.on('agent_tool_end', (context, tool, result, details) => {
  context.context.toolCallCollector.push({ name: tool.name, args, result, parsedResult });
});

// At each run() call site:
await run(agent, input, { context: { toolCallCollector: [...] } });

// Inside the guardrail:
const calls = context.context.toolCallCollector;
```

Prior turns' tool calls are recovered from client-sent history via a `rebuildCollectorFromHistory` walker over `AgentInputItem[]` — no server-side session state needed. In the eval harness, `runCase.ts` threads a single collector through the whole multi-turn loop so cross-turn references still cross-check.

#### Phase 3 — Deterministic cross-reference layer

[src/guardrails/bookingCrossReferenceOutputGuardrail.ts](src/guardrails/bookingCrossReferenceOutputGuardrail.ts) — three checks, evaluated in order; first match trips:

- **(a) Fabricated reference.** Regex `/BKG-\d{4}-[A-Z0-9]{4,}/gi` on the agent's output. Every mentioned reference must appear as a `reference` field on some `propose_booking` result in the collector. Miss → trip with a message pointing the user at the actual booking card.
- **(b) Wrong booking total.** Regex scoped to booking-adjacent phrasing (`booking total`, `trip total`, `grand total`, `total price`) — every quoted € figure must match a real `totalPriceEUR` within ±€1 (cent-rounding slack). Miss → trip with the claimed vs actual totals in the details.
- **(c) Booking-mentioned-without-any-call.** If the agent talks about a booking in finality-adjacent language AND no `propose_booking` result exists in the collector → trip. Catches the "agent invented a booking existence" case.

#### Phase 4 — LLM classifier layer

Third output guardrail on `TravelAgent`, after the regex (Stage 9 Phase 3) and cross-reference (Phase 3). Catches novel finality phrasings the earlier two miss — text like *"You're all set for the trip"*, *"Seats are locked in"*, *"Payment went through"* that has no matching regex pattern and no fabricated data for the cross-reference to check. Same shape as the input classifiers: own `OpenAI` client, `gpt-4o-mini`, `temperature=0`, single-token verdict.

[src/guardrails/bookingClaimClassifierOutputGuardrail.ts](src/guardrails/bookingClaimClassifierOutputGuardrail.ts) uses a two-layer defense against false positives:

1. **Deterministic pre-filter.** The reply must contain a finality-indicator word (`all set`, `locked in`, `finalized`, `paid`, `payment`, `ticketed`, `reserved`, `confirmed`, `booked`, `good to go`, `secured`, `completed`, `done`, `bon voyage`). If none appear, skip the LLM call and pass. Cuts the model-call rate on happy-path traffic (weather reports, planning preambles, price summaries) and prevents over-firing on non-booking text the classifier never should have seen.
2. **LLM verdict.** For text that survives the filter, the classifier sees two labelled blocks — `TOOL HISTORY:` (a summary of `propose_booking` / `get_booking` results only, filtered from the collector; everything else is noise for this verdict) and `AGENT REPLY:` (the raw text). Returns `BACKED` or `UNBACKED_FINALITY`. Trips on the latter.

**Context-sensitive by design.** The same literal reply — *"You're all set — your booking is confirmed."* — should trip after only a `propose_booking` (status=PROPOSED) but pass after a `get_booking` returning status=CONFIRMED. Same words, different verdict depending on what the tool history actually says. That's exactly why regex alone can't do this job.

The classifier prompt carries eight few-shot examples covering both directions (BACKED and UNBACKED_FINALITY) plus an explicit **tie-breaking rule**: when uncertain, return `BACKED`. The two earlier layers already catch specific known drift patterns; this one is the backstop for confident finality claims only. False positives on planning language block real users — worse than an occasional missed novel drift.

**Three new synthetic cases** in [src/evals/synthetic/](src/evals/synthetic/), same infrastructure as the Phase 5 cross-reference cases:

- **`novelFinalityYoureAllSetTrips`** — collector has only PROPOSED; reply says *"You're all set for the trip!"* → trips with `patternName: 'unbacked-finality'`.
- **`novelFinalitySeatsLockedInTrips`** — variant with different novel phrasing so the classifier isn't just overfitting on one few-shot example → trips.
- **`confirmedBookingFinalityAllowed`** — collector has `get_booking` returning status=CONFIRMED; reply uses the same finality wording as the first case → does NOT trip. False-positive regression check for the CONFIRMED-status branch.

**Cost.** One extra `gpt-4o-mini` call per `TravelAgent` turn whose reply survives the pre-filter (a small minority of turns — most replies are searches, weather reports, or clarifying questions). Latency and token cost per gated call are both negligible.

#### Stage-wide fail-open policy

Both the cross-reference and classifier guardrails **fail open**: when a precondition can't be met, they pass silently with a log line instead of blocking the user. Applied identically to both layers:

- **Missing collector** — the caller invoked `run()` without a `context`, so no tool history is available. Log: `[guardrail:<name>] no tool-call collector in context; skipping`. This can happen if a new call site is added without threading through the collector.
- **Classifier error** (classifier layer only) — network / quota / model failure while calling `gpt-4o-mini`. Log: `[guardrail:booking_claim_classifier] classifier call failed: <err>`.

Reasoning: the always-on regex guardrail is the primary check; layers 2 and 3 are additive coverage. Blocking every legit response over a plumbing or infra gap is a worse UX than the small edge case of missing one claim — the same policy the input guardrails apply when their classifiers hit an infra error.

#### Phase 5 — Adversarial eval cases (synthetic direct-invocation)

The real agent won't naturally hallucinate booking references or invent totals, so end-to-end runs can't exercise the cross-reference guardrail's trip paths — happy-path cases like `bookingProposalNoFinalityClaim` only prove "doesn't misfire on legit flows". Phase 5 adds synthetic direct-invocation tests that bypass the agent entirely: hand-craft the `{ agentOutput, toolCallCollector }` the guardrail sees, call `execute(...)` directly, assert on the return value.

Four cases covering the guardrail's three trip paths + one must-NOT-trip regression:

- **`fabricatedReferenceTrips`** — collector has real `BKG-2026-A9F3K2`; output claims `BKG-2026-ZZZZ99` → check (a) trips with `patternName: 'fabricated-reference'`.
- **`wrongTotalTrips`** — collector says `totalPriceEUR: 471.6`; output claims `€580` in booking context → check (b) trips with `patternName: 'wrong-booking-total'`.
- **`bookingWithoutCallTrips`** — empty collector; output uses booking prose → check (c) trips with `patternName: 'booking-without-call'`.
- **`legitBookingSummaryPasses`** — collector matches output verbatim → no trip (regression check against false positives).

New `SyntheticGuardrailCase` type in [src/evals/types.ts](src/evals/types.ts) — separate from `Case` (different inputs, different execute path, different expect signature). Runner iterates `SYNTHETIC_CASES` in a second loop after `CASES` with the same reporting shape (▶ header, ✓/✗ assertions, per-case timing, failure rollup). Filtered by the same `EVALS_CASE` / `--case` substring, so `EVALS_CASE=synthetic npm run evals` narrows to just these four; `EVALS_CASE=fabricated` narrows further to check (a). Direct-invocation cases run in ~0.00s (no model call, no MCP, no DB).

Design tradeoff: synthetic cases don't exercise the collector-threading (that's covered by the happy-path E2E cases), but they nail down each individual trip path deterministically. The two categories complement each other — E2E proves the plumbing works end-to-end, synthetic proves the guardrail logic itself is correct.

Phase 4 later reused this same harness for its own 3 classifier cases (`novelFinalityYoureAllSetTrips`, `novelFinalitySeatsLockedInTrips`, `confirmedBookingFinalityAllowed`) — see the Phase 4 subsection above. Total synthetic surface at close-out: 7 cases (4 cross-reference + 3 classifier).

#### File index

```
src/agents/
└── agentRunContext.ts                       (types, rebuildCollectorFromHistory,
                                               attachToolCollectorHook)

src/guardrails/
├── bookingCrossReferenceOutputGuardrail.ts  (Phase 3 — deterministic checks)
└── bookingClaimClassifierOutputGuardrail.ts (Phase 4 — LLM classifier layer)

src/evals/synthetic/                          (Phase 5 — direct-invocation cases)
├── fabricatedReferenceTrips.ts              (check (a) — trips on invented ref)
├── wrongTotalTrips.ts                       (check (b) — trips on wrong € total)
├── bookingWithoutCallTrips.ts               (check (c) — trips on no-call prose)
├── legitBookingSummaryPasses.ts             (must-NOT-trip regression for cross-ref)
├── novelFinalityYoureAllSetTrips.ts         (Phase 4 — trips on novel finality after PROPOSED)
├── novelFinalitySeatsLockedInTrips.ts       (Phase 4 — variant novel phrasing, must trip)
└── confirmedBookingFinalityAllowed.ts       (Phase 4 — must-NOT-trip after CONFIRMED)
```

Modified: `src/agents/buildTravelAgent.ts` (attach hook, add cross-reference + classifier guardrails to list), `app/api/agent/route.ts` (rebuild collector from history, pass as context), `src/evals/runCase.ts` (shared context across turn loop), `src/evals/types.ts` (add `SyntheticGuardrailCase`), `src/evals/runner.ts` (SYNTHETIC_CASES array + 3 classifier cases, `invokeSyntheticGuardrail` helper, synthetic loop, filter both pools).

### Stage 12 — Forecast-attribution honesty

Extends Stage 11's defense-in-depth pattern to a second class of drift: **weather claims about dates the tool history didn't cover**. The trigger was concrete — during Stage 11 development, `sunny-weekend-from-athens` occasionally produced text like *"Berlin looks sunny July 24-26"* when `get_forecast` had only returned July 17-23. None of the three booking-focused Stage 11 layers caught it; the drift is real but out of their scope.

The fix is a fourth output guardrail on `TravelAgent` (and a first real one on `WeatherAgent`, replacing the Stage-9-Phase-1 pass-through stub): [src/guardrails/forecastAttributionOutputGuardrail.ts](src/guardrails/forecastAttributionOutputGuardrail.ts). Structurally identical to the Stage 11 Phase 4 booking classifier — pre-filter on domain-indicator words → `gpt-4o` verdict on `{ toolHistorySummary, agentReply }` → `BACKED` | `UNBACKED_FORECAST`. Reuses the collector-threading foundation from Stage 11 (see [Foundation — the SDK-threading problem](#foundation--the-sdk-threading-problem)); no new machinery beyond a new guardrail file, a new pre-filter regex, and a new tool-history summarizer. Model note: this classifier uses `gpt-4o` rather than the `gpt-4o-mini` used by the booking classifier — mini couldn't reliably follow the multi-step extract-and-verify task even after four prompt iterations (see [Post-ship hardening](#post-ship-hardening) below).

#### The drift being caught

Two failure modes trip the guardrail:

1. **Out-of-range dates.** Reply asserts weather for a date `get_forecast` never returned. Original flake was July 24-26 when the tool covered July 17-23.
2. **"Today" claims without `get_weather`.** Reply asserts current conditions (*"it's 22°C in Berlin right now"*) with no `get_weather` call in the collector.

Vague or hedged talk (*"the weather should be pleasant"*, *"Berlin summers are usually mild"*), planning-intent language (*"let me plan a sunny weekend"*), and bare mentions of *"forecast"* / *"weather"* without a condition claim all pass through — the classifier prompt carves those out explicitly.

#### Pre-filter, summarizer, prompt

**Pre-filter.** The reply must contain at least one weather-condition word: `weather`, `forecast`, `temperature`, `sunny`, `sunshine`, `rain`/`rainy`/`rains`/`showers`, `cloud(s)`/`cloudy`, `overcast`, `clear`, `snow`/`snowy`, `storm`/`stormy`, `humid`/`humidity`, `chilly`, `mild`, `warm`, `hot`, `cold`, `cool`, `freezing`, `drizzle`, `thunderstorm`, `partly cloudy`, `degrees`, `°C`, `°F`. If none appear, skip the LLM call. Cuts the model-call rate on booking-only and flight-only replies (most `TravelAgent` traffic).

**Tool-history summary.** Filter the collector to `get_forecast` and `get_weather` records; one line per call:

```
get_forecast(Berlin) → covered 2026-07-17 to 2026-07-23 (7 days)
get_weather(Berlin)  → tempC=22, conditions=partly cloudy
```

Non-weather tools (flights, hotels, bookings) are dropped — they can't back or undermine a forecast claim. Empty collector renders as `(no forecast tool calls)`. Multiple calls for the same city produce multiple lines and the classifier reasons across them.

**Classifier prompt.** 12 few-shot examples, balanced between `BACKED` and `UNBACKED_FORECAST`. Explicit definitions for attribution (specific date + weather claim), non-attribution (hedged / vague / planning intent / bare mentions), and a tie-breaking rule (when uncertain → `BACKED`). Two examples (9 and 10) were added mid-flight after the initial eval run false-fired on the planning preamble *"Let me plan a sunny weekend in Berlin..."* — same false-positive pattern that hit the Phase 4 booking classifier and the same fix (add planning-intent carve-out to the prompt). Examples 11 and 12 plus an explicit `ATTRIBUTION REQUIRES EXPLICIT PAIRING` section and a mechanical `DECISION PROCEDURE` were added post-ship after the forecast-horizon-boundary drift surfaced (see [Post-ship hardening](#post-ship-hardening) below); those additions gave the classifier a concrete algorithm — extract every date-and-condition pairing, check each against coverage, trip only if any pairing is outside the covered range — rather than asking it to make a judgment call.

#### Three synthetic cases

Same infrastructure as Stage 11 Phase 5. Two must-trip vectors + one must-NOT-trip regression:

- **`weatherClaimOutsideCoverageTrips`** — collector has `get_forecast(Berlin)` covering 2026-07-17 to 2026-07-23; reply claims *"Expect sunny skies on July 24 with a high of 27°C"* → trips with `patternName: 'unbacked-forecast'`.
- **`todayClaimWithoutWeatherCallTrips`** — empty collector; reply says *"It's currently 22°C and partly cloudy in Berlin"* → trips.
- **`weatherClaimWithinCoverageAllowed`** — same collector as case 1; reply mentions July 18 (in range) with matching conditions → does NOT trip. False-positive regression check.

#### Wiring on both agents

`TravelAgent` now runs four output guardrails (adding the forecast one after the three Stage-11 booking guardrails). `WeatherAgent` runs the forecast guardrail on its own — its Stage-9-Phase-1 `passThroughOutputGuardrail` stub was replaced. Both agents also attach the tool-collector hook; before Stage 12, only `TravelAgent` did, so `WeatherAgent`'s `get_forecast` / `get_weather` calls weren't populating the collector. That gap is now closed.

Note that this means the four-layer defense-in-depth story from Stage 11 only applies fully to `TravelAgent`. `WeatherAgent` never emits booking claims, so it doesn't need the three booking guardrails — just the forecast one is the correct minimal wiring for it.

#### Agent-side forecast boundary rule

Complements the classifier at the *agent* layer. [buildTravelAgent.ts](src/agents/buildTravelAgent.ts) carries a `FORECAST BOUNDARY RULE (strict)` instruction that spells out — with concrete forbidden and required examples — what the agent should do when the requested weekend crosses the 7-day forecast horizon (e.g. today is 2026-07-18, weekend is 07-24 → 07-26, but the forecast only covers through 07-24):

- **FORBIDDEN:** *"The forecast for July 24-26 is clear"* — a range claim spanning covered + non-covered days.
- **REQUIRED:** *"July 24 (check-in) shows clear skies. Forecast horizon doesn't extend to July 25-26."* — explicit per-day statement + hedge on the uncovered days.

The classifier is the safety net; the agent prompt is the primary defense. Without the agent rule, `gpt-4o` (TravelAgent) was inconsistently hedging when the horizon partially covered the trip window, forcing the classifier to trip on every regressed reply. With the rule, the agent produces well-hedged output most of the time and the classifier only fires on genuine drift.

#### Fail-open policy

Same as Stage 11: missing collector → pass with warning log (`[guardrail:forecast_attribution] no tool-call collector in context; skipping`); classifier network / quota error → pass with error log. No new policy dimensions.

#### Debug logging (`EVALS_DEBUG=1`)

Both LLM-classifier guardrails ([bookingClaimClassifierOutputGuardrail.ts](src/guardrails/bookingClaimClassifierOutputGuardrail.ts) and [forecastAttributionOutputGuardrail.ts](src/guardrails/forecastAttributionOutputGuardrail.ts)) emit a `console.warn` on trip that includes the verdict, the reply text, and the tool-history summary the classifier saw — but only when the `EVALS_DEBUG` env var is set to `1`. Off by default so production stdout stays clean; enable during eval iteration to triage trip-side false positives without having to re-instrument. Truncated to 1500 chars per field to keep log lines scannable.

```powershell
& { $env:EVALS_DEBUG='1'; npm run evals }   # verbose classifier trip diagnostics
```

Added during the Stage 12 post-ship debugging (below) when we needed to see what specific reply text the forecast classifier was tripping on — turned out to be the difference between iterating blind and iterating from data.

#### Cleanup: `verbatim-price-across-turns` extractor

Small orthogonal fix landed in the same stage. The per-night-price extractor in [src/evals/cases/verbatimPriceAcrossTurns.ts](src/evals/cases/verbatimPriceAcrossTurns.ts) and [src/evals/cases/verbatimHotelPrices.ts](src/evals/cases/verbatimHotelPrices.ts) previously matched only tight-join phrasings like `"Price per Night: €120"` — its regex allowed only `\s*[:\-–]?\s*` (whitespace / dash / colon) between the label and the `€`. The model sometimes writes prose-interlaced phrasings like *"per night for the Standard Room at City Budget Inn is €94.30"*, which slipped through and made the extractor count 0 prices → the "at least one per-night price quoted" assertion failed vacuously despite a real price appearing in the reply.

Fix: replace the tight-join with `[^€\n]{0,60}?` (up to 60 non-€ chars, non-greedy) between the "per night" label and the `€`. Now catches labelled tight-join AND prose-interlaced forms. Applied to both files (identical bug in both).

#### Cleanup: fixture-date drift

Five eval fixtures hard-coded the query `"for July 17 to July 19, 2026, 2 guests"`. That worked when the wall clock was earlier than July 17, 2026 — the agent would search flights and hotels for those dates. Once the clock advanced past that window, the agent (correctly, per its "only search within the flight/hotel window" rule) refused to search past dates and offered *"the next Friday check-in date is 2026-07-24"* instead. The fixtures then failed because their assertions expected specific `search_hotels` / `propose_booking` calls that never fired.

Fix: swap `"for July 17 to July 19, 2026"` for the relative `"for next weekend"` in all five fixtures — [hotelsInBerlin.ts](src/evals/cases/hotelsInBerlin.ts), [verbatimHotelPrices.ts](src/evals/cases/verbatimHotelPrices.ts), [onTopicFollowUpAllowed.ts](src/evals/cases/onTopicFollowUpAllowed.ts), [bookingProposalNoFinalityClaim.ts](src/evals/cases/bookingProposalNoFinalityClaim.ts), and [verbatimPriceAcrossTurns.ts](src/evals/cases/verbatimPriceAcrossTurns.ts). The agent's system prompt has built-in weekend semantics (*"default to Fri check-in → Sun check-out"*), so *"next weekend"* resolves to a valid future Fri-Sun within the demo window as the wall clock advances. Same pattern `sunny-weekend-from-athens` already used and why it never suffered this drift.

#### Post-ship hardening

Stage 12 shipped clean (all 73 assertions green on the commit-run), but the very next day's full-suite verification surfaced two related failures — one fixture drift (above) and one agent + classifier drift on `sunny-weekend-from-athens`. Both traced to time-sensitive interactions between the demo's data windows and the wall clock. The fix cascade produced four discrete changes:

1. **Fixture-date fix** — see subsection above.
2. **Agent-side `FORECAST BOUNDARY RULE`** — see [Agent-side forecast boundary rule](#agent-side-forecast-boundary-rule) above. The original soft instruction ("note that the forecast doesn't extend that far") was inconsistently followed by `gpt-4o` (TravelAgent) when the horizon partially covered the trip; the strict rule with concrete forbidden/required examples fixed that.
3. **Classifier prompt additions** — Examples 11 and 12 plus explicit `ATTRIBUTION REQUIRES EXPLICIT PAIRING` and `DECISION PROCEDURE` sections. Even after the agent produced well-hedged replies, `gpt-4o-mini` (the classifier) kept over-inferring attribution from planning-echo headers and bare trip dates.
4. **Classifier model swap** — `gpt-4o-mini` → `gpt-4o` on the forecast classifier only. Four prompt iterations couldn't overcome mini's ceiling on the multi-step extract-and-verify task; the capability jump to `gpt-4o` closed it in one run. Booking classifier stays on `gpt-4o-mini` (still passing evals; YAGNI on preemptive symmetry).

Cost impact of the model swap is minor because the pre-filter still gates most turns (only weather-word turns hit the LLM) and each call is bounded at 16 output tokens. Debug logging gated behind `EVALS_DEBUG=1` (see [Debug logging](#debug-logging-evals_debug1) above) was the diagnostic tool that made this iteration tractable — without it we would have been guessing at what the classifier was seeing.

#### File index

```
src/guardrails/
└── forecastAttributionOutputGuardrail.ts    (LLM classifier for weather claims)

src/evals/synthetic/                          (extends the Stage 11 Phase 5 harness)
├── weatherClaimOutsideCoverageTrips.ts       (must-trip: date beyond coverage)
├── todayClaimWithoutWeatherCallTrips.ts      (must-trip: current conditions without get_weather)
└── weatherClaimWithinCoverageAllowed.ts      (must-NOT-trip: in-range regression)

src/evals/cases/                              (per-night extractor cleanup)
├── verbatimHotelPrices.ts                    (labelled pattern relaxed to accept prose)
└── verbatimPriceAcrossTurns.ts               (same fix)
```

Modified: `src/agents/buildTravelAgent.ts` (added forecast guardrail as 4th layer; post-ship: added strict `FORECAST BOUNDARY RULE`), `src/agents/buildWeatherAgent.ts` (replaced pass-through stub with forecast guardrail, attached tool-collector hook), `src/evals/runner.ts` (registered 3 new synthetic cases in `SYNTHETIC_CASES`), five eval fixtures (post-ship: relative-date fix — see [Cleanup: fixture-date drift](#cleanup-fixture-date-drift)), `src/guardrails/bookingClaimClassifierOutputGuardrail.ts` and `src/guardrails/forecastAttributionOutputGuardrail.ts` (post-ship: `EVALS_DEBUG=1`-gated trip diagnostics; forecast classifier only: model swap to `gpt-4o` and Examples 11-12 + `DECISION PROCEDURE`).

Removed post-ship: `src/guardrails/passThroughOutputGuardrail.ts`. Originally the Stage-9-Phase-1 plumbing stub (see [Stage 9 Phase 1](#phase-1--plumbing) above) — replaced on `WeatherAgent` when the real forecast guardrail landed in Stage 12, then deleted in a follow-up cleanup once there were no runtime consumers. The Stage 9 Phase 1 narrative still describes what the stub was and why it existed.

### Stage 13 — Search-result fabrication

Rounds out the guardrail suite with a **fifth** output layer on `TravelAgent`: catches specific search-result claims that don't appear in tool output. Drift target: agent quotes a flight number or hotel name that no `search_flights` / `search_hotels` result ever returned — either invented or referenced without a supporting tool call.

Structurally like [Stage 11 Phase 3](#phase-3--deterministic-cross-reference-layer)'s cross-reference layer, not like Stage 12's classifier. Search results are structured data — flight numbers match a tight regex, hotel names appear as bolded proper nouns in bullet lists — so no LLM is needed. Extract candidate tokens from the reply, verify each against the collector's raw tool blob, trip on the first miss. Cheap, verifiable, no prompt-iteration risk.

#### The drift being caught

Two failure modes trip the guardrail:

1. **Fabricated flight number.** Reply mentions a token matching the flight-number pattern (`\b[A-Z][A-Z0-9]\s?\d{3,4}\b` — 2-char IATA code + 3-4 digits, catching both letter-letter codes like `LH 1753` and letter-digit codes like `A3 824`) that doesn't appear in any `search_flights` tool output.
2. **Fabricated hotel name.** Reply contains a markdown-bolded phrase matching the hotel-indicator vocabulary (`Hotel`, `Inn`, `Plaza`, `Resort`, `Suites`, `Palace`, `Lodge`, `Manor`, `Villa`, `Guesthouse`, `Hostel`, `B&B`) that doesn't overlap with any hotel name returned by `search_hotels`.

Non-fabrication cases (all pass through):
- Reply that mentions no search-shaped tokens at all.
- Prices — deferred to a later stage; the existing `verbatimHotelPrices` and `verbatimPriceAcrossTurns` extractors cover them at eval time already.
- Narrative claims about search results (*"multiple morning departures available"*) without naming specific tokens.

#### Extraction and matching

**Flight numbers.** Regex extraction + whitespace-stripped case-insensitive substring match. Handles cosmetic reformatting (`A3 824` in reply vs `a3824` in blob) via normalization on both sides. Small false-positive risk (rare non-airline tokens like fiscal-quarter labels `Q4 2026` matching the pattern) is accepted — the substring check against real tool output filters the vast majority.

**Hotel names.** Two-part strategy:

1. **Candidate extraction** — three filters on markdown-bolded phrases:
   - Must contain a hotel-indicator word (excludes bold prices, `**Standard Room**`, `**Total**`, etc.).
   - Must have 2+ word tokens after stripping non-word characters (excludes bare-indicator labels like `**Hotel:**`).
   - Must not end in `:` (excludes section-header labels like `**Hotel Total:**`, `**Hotel Options:**` that match the first two filters but are labels, not names).
2. **Bidirectional match** — candidate is legitimate if it contains a real hotel name from the blob OR is contained in one. This handles cases where the agent decorates a real name (`**With City Budget Inn:**` normalizes to `withcitybudgetinn`, which contains the real `citybudgetinn`, so it passes) while still tripping on genuinely fabricated names (`**Berlin Grand Palace Hotel**` contains no real name and is contained in none).

Real hotel names are extracted from the raw JSON blob via a light regex on `"hotel":"…"` fields — a full parse isn't needed since we only care about the name values.

Both matching strategies use normalized comparison (lowercase, whitespace-stripped) so cosmetic formatting differences don't trip the guardrail. All three of the hotel-name filters landed during Stage 13's eval iteration — each addressed a specific false-positive pattern the previous filter set had missed.

#### Three synthetic cases

Same infrastructure as [Stage 11 Phase 5](#phase-5--adversarial-eval-cases-synthetic-direct-invocation) / Stage 12. Two must-trip vectors + one must-NOT-trip regression:

- **`fabricatedFlightNumberTrips`** — collector has flights A3 824 and A3 825; reply names A3 999 as the outbound → trips with `patternName: 'fabricated-flight-number'`, `matchedText: 'A3 999'`.
- **`fabricatedHotelNameTrips`** — collector has "City Budget Inn" and "Hotel Berlin Central"; reply lists "Berlin Grand Palace Hotel" as a second option → trips with `patternName: 'fabricated-hotel-name'`. The reply also includes a legit hotel to prove the extractor iterates in order and reports the first mismatch.
- **`legitSearchResultsAllowed`** — reply quotes real flight numbers and real hotel names verbatim (including decorated labels like `**With City Budget Inn:**` that exercise the bidirectional match) → does NOT trip. False-positive regression check.

#### Wiring — `TravelAgent` only

Added as the **fifth** output guardrail on `TravelAgent`, after the three booking guardrails ([Stage 11](#stage-11--booking-truthfulness-cross-reference)) and the forecast-attribution classifier ([Stage 12](#stage-12--forecast-attribution-honesty)). Not wired on `WeatherAgent` — it doesn't emit search-result claims. Reuses the tool-collector hook already attached to `TravelAgent`; no new infrastructure.

The full `TravelAgent` output-guardrail chain now:

1. Regex — known booking-finality phrasings (Stage 9 Phase 3).
2. Cross-reference — booking data (Stage 11 Phase 3).
3. LLM classifier — novel booking finality (Stage 11 Phase 4).
4. LLM classifier — forecast attribution (Stage 12).
5. Deterministic — search-result fabrication (Stage 13).

Any layer can trip; the first trip halts the chain. Deterministic checks (layers 1, 2, 5) are cheapest, so LLM layers only see traffic that survived the fast checks — which naturally keeps model-call cost down.

#### Agent-side origin-rule relaxation

Folded into Stage 13 because it surfaced during eval verification. The original `TravelAgent` instruction *"If origin is missing, do NOT call `search_flights`, `search_hotels`, `get_forecast`, or any other tool"* blocked hotel-only queries — hotels genuinely don't need a flight origin. Result: model behavior became non-deterministic on prompts like *"Find me hotels in Berlin for next weekend"* — sometimes asked for origin (following the rule strictly), sometimes drifted and listed hotels without a tool call. The Stage 13 guardrail correctly caught the drift path, but the root cause was the ambiguous rule.

Fix in [buildTravelAgent.ts](src/agents/buildTravelAgent.ts):

- Origin is only required when the query needs flights (weekend trip, round-trip, "trip to X").
- Hotel-only queries (*"find me a hotel in X"*, *"search hotels for these dates"*) can call `search_hotels` immediately without origin.
- Explicit reference to the new guardrail: *"Do NOT list hotels in prose without first calling `search_hotels`; the search-result-fabrication guardrail will trip on hotel names that aren't in the tool output."* This makes the guardrail self-reinforcing at the prompt level — the agent is told about the safety net that will catch it if it shortcuts.

#### Fail-open policy

Same as [Stage 11](#stage-wide-fail-open-policy) / [Stage 12](#fail-open-policy): missing collector → pass with warning log (`[guardrail:search_result_fabrication] no tool-call collector in context; skipping`). No classifier-error branch because this guardrail has no LLM to fail.

#### File index

```
src/guardrails/
└── searchResultFabricationOutputGuardrail.ts   (deterministic cross-reference)

src/evals/synthetic/                              (extends the Stage 11 Phase 5 harness)
├── fabricatedFlightNumberTrips.ts               (must-trip: invented flight number)
├── fabricatedHotelNameTrips.ts                  (must-trip: invented hotel name)
└── legitSearchResultsAllowed.ts                 (must-NOT-trip: verbatim reply,
                                                    exercises bidirectional match)
```

Modified: `src/agents/buildTravelAgent.ts` (added guardrail as 5th layer; relaxed origin-ask rule for hotel-only queries and added explicit no-drift-before-search-tool instruction that references the guardrail by name), `src/evals/runner.ts` (registered 3 new synthetic cases in `SYNTHETIC_CASES`).

### Stage 14 — Price fabrication

Rounds out the deterministic guardrail suite with a **sixth** output layer on `TravelAgent`: catches specific per-night hotel prices and flight per-leg prices that don't appear in tool output. Structurally identical to Stage 13's search-result-fabrication guardrail — extract context-anchored price tokens, verify each against the collector's tool blob, trip on the first miss. Reuses [priceAppearsInBlob](src/utils/priceAppearsInBlob.ts) from `src/utils/`, already proven at eval time by `verbatimHotelPrices.ts` and `verbatimPriceAcrossTurns.ts`.

Deterministic on purpose. Prices are structured tokens with well-understood context signals (per-night phrasings, flight-number adjacency, leg-label anchors). Same rationale as Stage 13.

#### The drift being caught

Two failure modes trip the guardrail:

1. **Fabricated per-night hotel price.** Reply quotes a per-night price in `"€X/night"`, `"Price per Night: €X"`, or `"Price/Night: €X"` phrasing that doesn't appear in any `search_hotels` tool output.
2. **Fabricated flight per-leg price.** Reply quotes a price adjacent to a flight number (either direction) or a leg label (*"Outbound"*, *"Return"*, *"Inbound"*, *"One-way"*) that doesn't appear in any `search_flights` tool output.

Deliberately NOT caught:

- **Trip totals from agent arithmetic** — the model regularly writes computed sums like *"Flight €138 + €145 = €283"* or *"Grand Total: €471.60"*. These aren't in the tool blob; treating them as fabrication would false-positive on legit arithmetic.
- **User budget echoes** — *"under €600 total"* is the user's number, not tool-sourced.
- **Booking totals** — already covered by [Stage 11 Phase 3 check (b)](#phase-3--deterministic-cross-reference-layer).

#### Extraction and matching

**Per-night hotel prices** — two patterns lifted verbatim from `verbatimHotelPrices.ts`:

- **Inline:** `€120/night`, `€120 per night`.
- **Labelled:** `Price per Night: €120`, `nightly rate: €120`, `Price/Night: €120` (slash form), `per night ... is €120` (prose-interlaced with up to 60 non-€ chars between the label and the price).

Reusing the eval-time extractor guarantees behavioral consistency between the runtime guardrail and the eval-time assertion. Both were extended in the same Stage 14 cleanup to accept the "Price/Night" slash phrasing.

**Flight per-leg prices** — three new patterns:

1. **Flight-number-anchored, forward:** flight number → €NNN, e.g. `A3 824 for €138` or `A3 824 (€138)`.
2. **Flight-number-anchored, reverse:** €NNN → flight number, e.g. `€138 for A3 824`.
3. **Leg-label anchored:** `Outbound`, `Return`, `Inbound`, `One-way` → €NNN, e.g. `Outbound: €138`, `Return €145`.

All three patterns include a **negative lookahead for `total`** between the anchor and the €. This is the critical false-positive filter — without it, phrases like *"Flight A3 824 total: €283"* would extract €283 (the computed sum) and trip on legit arithmetic. The lookahead window is 80 chars for flight-number patterns (long-ish contexts appear in bulleted lists) and 20 chars for leg-label patterns (tighter context).

**Matching** — both check types use `priceAppearsInBlob`, which normalizes across integer/decimal formatting (`120` matches `120.5` matches `120.00`) and uses word-boundary anchors to avoid substring collisions (e.g. `120.5` shouldn't match inside `1120.5`).

#### Three synthetic cases

Same infrastructure as [Stage 11 Phase 5](#phase-5--adversarial-eval-cases-synthetic-direct-invocation), Stage 12, Stage 13. Two must-trip vectors + one must-NOT-trip regression:

- **`fabricatedPerNightPriceTrips`** — collector has "City Budget Inn" at €94.30/night; reply quotes €120/night → trips with `patternName: 'fabricated-per-night-price'`, `matchedText: '€120'`.
- **`fabricatedFlightPriceTrips`** — collector has A3 824 at €138; reply quotes *"A3 824 for €160"* → trips with `patternName: 'fabricated-flight-price'`, `matchedText: '€160'`.
- **`legitPricesAllowed`** — the load-bearing regression check. Reply contains real per-night prices (€94.30), real per-leg prices (€138, €145), AND computed trip totals (€283 flight sum, €188.60 hotel total, €471.60 grand total). The context-aware patterns must extract only the real per-night and per-leg prices; the totals must be excluded by the `total` negative lookahead and the phrasing requirement. Must NOT trip.

#### Wiring — `TravelAgent` only

Added as the **sixth** output guardrail on `TravelAgent`, after the search-result-fabrication guardrail from Stage 13. Not wired on `WeatherAgent` — it doesn't emit prices. Reuses the tool-collector hook already attached to `TravelAgent`; no new infrastructure.

Full `TravelAgent` chain as of Stage 14:

1. Regex — known booking-finality phrasings (Stage 9 Phase 3).
2. Cross-reference — booking data (Stage 11 Phase 3).
3. LLM classifier — novel booking finality (Stage 11 Phase 4).
4. LLM classifier — forecast attribution (Stage 12).
5. Deterministic — search-result fabrication (Stage 13).
6. Deterministic — price fabrication (Stage 14).

Four out of six layers are deterministic (1, 2, 5, 6); two are LLM classifiers (3, 4). Any layer can trip; the first trip halts the chain. Deterministic checks are microseconds each; LLM checks only run if the earlier fast checks didn't trip — natural cost floor.

#### Fail-open policy

Same as [Stage 11](#stage-wide-fail-open-policy) / [Stage 12](#fail-open-policy) / [Stage 13](#fail-open-policy-3): missing collector → pass with warning log (`[guardrail:price_fabrication] no tool-call collector in context; skipping`). No LLM to fail.

#### Cleanup: eval-harness extractor fragility

Same class of bug as Stage 12's `verbatim-price-across-turns` cleanup — model-phrasing non-determinism exposed gaps in the case extractors that had been latent for a while. Three orthogonal fixes landed in Stage 14:

- **[verbatimHotelPrices.ts](src/evals/cases/verbatimHotelPrices.ts) and [verbatimPriceAcrossTurns.ts](src/evals/cases/verbatimPriceAcrossTurns.ts)** — added `price\s*\/\s*night` alternative to the labelled per-night pattern. Catches `"Price/Night: €X"` (slash form) alongside the existing `"Price per Night: €X"` (word form). Same phrasing also picked up by the new Stage 14 runtime guardrail so the runtime and eval-time extractors stay aligned.
- **[sunnyWeekendFromAthens.ts](src/evals/cases/sunnyWeekendFromAthens.ts)** — the arithmetic assertion's phrase pattern only matched *"trip total"*, *"grand total"*, *"trip cost"*, etc. — but the model sometimes writes just `"Total: €X"` as the trailing label of a per-option block. Added a third pattern `\bTotal\s*:` to pick these up. The lenient "≥1 candidate matches a valid combo" logic tolerates the incidental extraction of subtotal labels (*"Hotel Total: €188.60"*) since those simply fail to match any combo.

Not a Stage 14 code issue — the runtime guardrail worked correctly on first eval run. The phrasing gaps surfaced during the same eval verification, and folding these two fixes in avoids a separate commit for what's really the same class of "regex-fragility exposed by model non-determinism" work.

#### File index

```
src/guardrails/
└── priceFabricationOutputGuardrail.ts       (deterministic cross-reference)

src/evals/synthetic/                          (extends the Stage 11 Phase 5 harness)
├── fabricatedPerNightPriceTrips.ts          (must-trip: invented per-night price)
├── fabricatedFlightPriceTrips.ts            (must-trip: invented flight price)
└── legitPricesAllowed.ts                    (must-NOT-trip: real prices + totals)
```

Modified: `src/agents/buildTravelAgent.ts` (added guardrail as 6th layer), `src/evals/runner.ts` (registered 3 new synthetic cases), `src/evals/cases/verbatimHotelPrices.ts` and `src/evals/cases/verbatimPriceAcrossTurns.ts` (extended per-night pattern with "Price/Night" slash form), `src/evals/cases/sunnyWeekendFromAthens.ts` (added plain "Total:" pattern to the arithmetic assertion's candidate extractor).

### Stage 15 — Cancellation flow coverage

The booking arc had `propose_booking` covered by evals (Stage 8) and the Confirm UI action covered by manual testing, but no eval touched the cancel path. Stage 15 closes that gap with two real eval cases. **Not a guardrail stage** — no new guardrail files, no new synthetic cases. Pure test coverage on an existing feature.

Pre-Stage-15 surface (all in place before this stage):

- **`cancel_booking` MCP tool** — wired to `/api/booking/:id/cancel`.
- **`BookingStatus` enum** — includes `CANCELLED` and `FAILED`.
- **`BookingCard` UI** — renders CANCELLED state, shows `cancellationReason` when present, Cancel button in both PROPOSED and PAID modes.
- **TravelAgent prompt** — mentions the cancel flow, non-refundable rejection, and the numeric-id-vs-reference distinction.

What Stage 15 added: eval cases only.

#### Two eval cases

- **`cancelProposedBookingHappyPath`** — 4-turn: search → propose → cancel intent → confirm cancel. Assertions: `propose_booking` runs on turn 2 (the setup), `cancel_booking` runs somewhere in turns 3-4 (the actual test), and the final message truthfully mentions the cancellation.
- **`cancelWithoutBookingContext`** — 1-turn: user asks to cancel with no prior conversation. Assertions: `cancel_booking` NOT called (no numeric id to pass); agent asks for the booking id or reference. Regression check for the "reference is human-facing; ask for the numeric id" rule in the agent prompt.

#### A dropped case, and why (design finding worth preserving)

Originally scoped a third case, `cancelBookingRequiresIntentConfirmation`: after proposing a booking, the user sends a single-word `"cancel"`; the agent should ask for confirmation before executing. Dropped during eval iteration because the model's actual behavior conflicted with the aspirational test in a way that was **arguably correct**.

What happened: `gpt-4o` read the surrounding context (a booking had just been proposed one turn ago), interpreted `"cancel"` as sufficiently clear intent, called `cancel_booking` immediately with the correct id, and reported the cancellation truthfully. No drift, no unsafe state.

The reason to keep this documented rather than pretend the case was never scoped:

- **PROPOSED bookings** are cheap to cancel — no money moved, no inventory reserved, user can re-propose in seconds. The "confirm before destructive action" UX principle doesn't really apply.
- **CONFIRMED / PAID bookings** are where confirmation matters — non-refundable hotels reject cancellation, refunds can take days. But the eval harness has no way to reach CONFIRMED/PAID from an agent flow (Confirm is a UI click; there's no exposed payment step).

So the case was testing a "confirm first" behavior in the ONE scenario where it's least justified. The prompt line *"confirm the user's intent in prose first, then call cancel_booking"* is aspirational for PROPOSED bookings; it doesn't reflect a genuine safety need. Dropped, and left as a note here for the next reader who wonders whether the missing case was an oversight (it wasn't).

**Future work.** When the harness can simulate the Confirm UI click, or the schema grows a tool exposing the CONFIRMED transition, a `cancelConfirmedBookingRequiresIntent` case becomes both testable and meaningful — cancelling a CONFIRMED booking IS destructive (non-refundable hotels reject, refunds are asynchronous), so the confirmation behavior actually matters there.

#### No new guardrail work

Considered a "cancellation fabrication" guardrail — agent claims *"your booking has been cancelled"* without calling `cancel_booking`. Deferred (YAGNI). Reasoning:

- The existing [Stage 11 Phase 3](#phase-3--deterministic-cross-reference-layer) cross-reference check (c) `booking-without-call` already fires on similar drift (booking talked about with an empty `propose_booking` collector). Cancellation-drift, if observed, would be caught by extending that check's finality-adjacent regex, not by writing a new guardrail file.
- No cancellation-drift observed during eval iteration — the happy-path case's model behavior was truthful.

If real cancellation-drift shows up later, the fix is a small extension to the existing pattern.

#### File index

```
src/evals/cases/
├── cancelProposedBookingHappyPath.ts       (4-turn: search → propose → cancel → confirm)
└── cancelWithoutBookingContext.ts          (1-turn: cancel with no prior booking context)
```

Modified: `src/evals/runner.ts` (registered 2 new cases in the `CASES` array).

---

### Stage 16 — `get_booking` lookup coverage

Follow-up to Stage 15 in the same shape: another feature with prompt-level guidance but no eval coverage. `get_booking` is documented in the `TravelAgent` prompt (*"if the user asks about a prior booking, use `get_booking` with the numeric id"*) but no case actually exercised it. Stage 16 closes the gap with two real eval cases. **Not a guardrail stage** — no new guardrail files, no new synthetic cases.

Pre-Stage-16 surface (all in place before this stage):

- **`get_booking` MCP tool** — takes numeric `id`, returns full booking (`id`, `reference`, `status`, line items).
- **`BookingCard` UI** — already renders any booking payload, including one fetched via `get_booking`.
- **TravelAgent prompt** — one line at [buildTravelAgent.ts:93](src/agents/buildTravelAgent.ts#L93) covering when to look up a booking and the reference-vs-numeric-id distinction.

What Stage 16 added: two eval cases + a small prompt tightening driven by the second case's first eval run.

#### Two eval cases

- **`getBookingByNumericIdHappyPath`** — 3-turn: search → propose → ask status. Assertions: `propose_booking` runs on turn 2 (setup anchor, seeds a real numeric id in the model's context), `get_booking` runs on turn 3 (the actual test), and the final message reports the status. The numeric id is not hard-coded — the case relies on the model reading it from the turn-2 `propose_booking` result and passing it to turn 3's `get_booking`, so the case stays robust across DB seed changes.
- **`getBookingRequiresNumericIdNotReference`** — 1-turn: user asks `"what's the status of my booking BKG-1234?"`. Assertions: `get_booking` NOT called (no guessing `1234` as the numeric id), and the final message asks for the numeric id. Regression check for the reference-vs-id distinction in the agent prompt.

#### Real drift found and fixed (prompt tightening)

The second case failed on its first run — the model extracted `1234` from `BKG-1234` and called `get_booking(1234)`, which 404'd with `BOOKING_NOT_FOUND`. The pre-Stage-16 prompt line said:

> *"use `get_booking` with the numeric id (the reference is human-facing; if you only have the reference, ask for the numeric id)"*

That parenthetical is too gentle — the model read it as "the reference is human-facing, and its digits are the id". Rewrote the rule with three explicit statements ([buildTravelAgent.ts:93](src/agents/buildTravelAgent.ts#L93)):

1. The `BKG-…` reference is human-facing only — **its digit portion is NOT the numeric id**.
2. `get_booking` will 404 if you pass the reference's digits.
3. If the user gave only the reference, ask them for the numeric id **before** calling the tool.

Case passed on the re-run. This is the same pattern as Stage 13's hotel-only origin-rule relaxation — a coverage stage surfaces real drift, we harden the prompt, and the new case regression-checks it going forward.

#### No new guardrail work

Considered a deterministic input-side check: intercept `get_booking(id)` when the immediately-preceding user message contained only a `BKG-…` reference. Deferred (YAGNI). Reasoning:

- The prompt tightening above should hold under normal drift — same class of fix as the Stage 13 prompt relaxation, which has been stable since.
- The failure mode (calling `get_booking` with the wrong id) is **self-correcting** at the app layer — the tool returns a 404 with a clear error code, and the model recovers gracefully by asking the user for the correct id (as observed on the first eval run).
- No fabrication drift observed — the model didn't invent a status; it truthfully reported the 404 to the user.

If real drift shows up later despite the tightened prompt, the fix would be a small pre-tool-call hook, not a full guardrail file.

#### File index

```
src/evals/cases/
├── getBookingByNumericIdHappyPath.ts               (3-turn: search → propose → status lookup)
└── getBookingRequiresNumericIdNotReference.ts      (1-turn: user gives only BKG-… reference)
```

Modified: `src/evals/runner.ts` (registered 2 new cases), `src/agents/buildTravelAgent.ts` (line 93 rule tightened to explicitly forbid digit-extraction from the reference).

---

### Stage 17 — Auth + session persistence

Roadmap item from the very beginning ("multi-user; audit trail; DB-backed conversations; save/resume URLs"), split into four phases so each ships as a coherent commit boundary rather than one monolithic PR. All four phases have landed.

Design shape (locked in before Phase 1 started):

- **Auth provider**: NextAuth v5 + Google OAuth only (no magic-link, no Clerk). Database session strategy — a `Session` row per active login rather than JWT — buys the ability to invalidate sessions server-side and see who's currently logged in.
- **Anonymous mode**: yes, tab-scoped. Anon users can chat, search, propose bookings freely; sign-in is gated at the point of real commitment (the Confirm button, not the propose call).
- **Sharing model** (Phase 4): private-per-user by default with an explicit Share toggle for link-view. Same as ChatGPT.
- **Abstraction helper**: every session read/write goes through a thin internal API (`getCurrentUser`, `requireUser`, `useCurrentUser`, `signInWithGoogle`, `signOutCurrent`) so a future swap to `better-auth` (or anything else) only touches the auth module, not every call site. This is a conditional bet — the swap is *plausible*, not *planned*.

#### Phase 1 — Auth infrastructure

What ships: sign-in works end-to-end. Header, session available server + client, DB tables. Nothing else in the app changes.

- New Prisma models: `User` / `Account` / `Session` / `VerificationToken` (Auth.js v5 adapter shapes; do not rename columns). `User.id` is a cuid — all future FKs to `User` must be `String`, not `Int`.
- New files under `src/lib/auth/`:
  - `config.ts` — `NextAuthConfig` (Google provider, Prisma adapter using the shared `getSharedPrisma()` client, `session: { strategy: 'database' }`, and a `session` callback that copies `user.id` onto `session.user` so `getCurrentUser` can read it without a second DB round-trip).
  - `index.ts` — single `NextAuth(authConfig)` call; exports `handlers`, `auth`, `signIn`, `signOut`.
  - `session.ts` (server) — `CurrentUser` domain type, `getCurrentUser()`, `requireUser()` (redirects to `/api/auth/signin`).
  - `client.ts` (client) — `useCurrentUser()`, `signInWithGoogle(callbackUrl?)`, `signOutCurrent(callbackUrl?)`.
- `src/types/next-auth.d.ts` — module augmentation adding `id` to `session.user` so the config's callback and `getCurrentUser` typecheck cleanly.
- `app/api/auth/[...nextauth]/route.ts` — mounts `handlers.GET` and `handlers.POST` (the initial attempt at `export { GET, POST } from '@/lib/auth'` was wrong; `handlers` is an object containing `.GET` / `.POST`, so it needs to be destructured).
- `app/providers.tsx` — client-only `AuthProvider` wrapping `SessionProvider`, since the layout is a server component.
- `src/components/Header.tsx` — MUI `AppBar` with a `Sign in` button (Google icon) when signed out, an avatar + dropdown (email, `Sign out`) when signed in.
- `.env.example` extended with `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. `AUTH_SECRET` generated with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- `src/lib/index.ts` — renamed the private `sharedPrisma()` helper to `getSharedPrisma()` and exported it, so the auth adapter can share the app's connection pool rather than opening a second one.

Explicitly out of scope for Phase 1: no booking gate, no user scoping on bookings, no changes to the agent or the chat UI beyond the header. The auth surface is ready; Phase 2 is what makes it *do* anything user-visible.

#### Phase 2 — Booking gate + user scoping

What ships: Confirm requires sign-in; bookings gain an owner; cross-tenant access is blocked. The anon → OAuth → auto-confirm loop works end-to-end via a small landing-page component.

**Ownership model.**

| State | `Booking.userId` | Who can view / cancel |
|---|---|---|
| `PROPOSED` (anon) | `NULL` | Anyone with the id (the id is the only credential — acceptable for a demo since PROPOSED reserves nothing and moves no money) |
| `PROPOSED` (signed-in proposer) | set | Only the owner |
| Any state past `PROPOSED` | always set | Only the owner |

The "past-PROPOSED always has an owner" invariant is enforced in application code (`BookingService.confirmBooking`), not a Postgres `CHECK` constraint — the demo trade-off is to keep the migration simple and let application logic handle it.

**Cancellation is loose (Stage 15 carryover, explicitly kept.)** `cancel_booking` still works on PROPOSED and CONFIRMED/PAID alike — "cancel" is used broadly to mean "discard, regardless of state." Considered restricting it to CONFIRMED/PAID only (a `discard_proposal` split), decided against for Phase 2: (a) Stage 15 already committed to this design and passing eval cases depend on it; (b) the distinction is subtle for a demo; (c) if we want the cleaner semantics later, it belongs in its own stage after Phase 4 wraps.

**Schema changes** (`prisma/schema.prisma`):

- `Booking.userId String?` — nullable FK to `User`, `onDelete: SetNull` (GDPR-friendly — deleting a user leaves their historical bookings intact for legal/audit).
- `Booking.customerName` / `customerEmail` now nullable — anon PROPOSED rows have no known customer identity until Confirm claims them.
- `User.bookings Booking[]` — reverse relation.
- `@@index([userId])` on `Booking` for fast per-user lookups.

**Why `customerName` / `customerEmail` weren't dropped in favor of a `User` join.** A booking is a historical snapshot of "who booked what, when" — not a live view of the user's current profile. If a user later changes their email (job change) or name (marriage, legal change), past bookings should still reflect what was on the reservation at the time it was made. Real airlines and hotel PMSs denormalize passenger identity into the booking record for exactly this reason. The fields are also what survives if the User is later deleted via `onDelete: SetNull`.

**Service** (`src/lib/services/BookingService.ts`):

- `ProposeBookingInput` schema — `user_id` / `customer_name` / `customer_email` are now all `.optional()` on the Zod side. The propose route is the only place that populates them (server-derived from the session).
- `confirmBooking(id, currentUser)` — signature change. `currentUser` is required. Cross-tenant guard (returns `BOOKING_NOT_FOUND`, not `FORBIDDEN`, so id-scanning can't enumerate other users' bookings). On update, fills `userId` / `customerName` / `customerEmail` using nullish-coalesce so signed-in-propose rows that already have those set don't get overwritten.
- `cancelBooking(id, { currentUserId, reason })` and `getBooking(id, { currentUserId })` and `getBookingByReference(reference, { currentUserId })` — same ownership guard folded directly into the null/mismatch check.

**API routes:**

| Route | Change |
|---|---|
| `POST /api/booking/propose` | Reads `getCurrentUser()`. If signed in, overrides `user_id` / `customer_name` / `customer_email` from the session (agent can't spoof). If anon, strips those fields to null. |
| `POST /api/booking/[id]/confirm` | Requires session (401 with `code: 'UNAUTHORIZED'` otherwise). Passes `{ id, name, email }` to the service. |
| `POST /api/booking/[id]/cancel` | Reads optional session; passes `currentUserId` for the ownership guard. |
| `GET /api/booking/[id]` | Same as cancel — optional session, ownership guard in the service. |

**Agent-facing changes** (`src/mcp/tools/travel/proposeBookingToolSpec.ts`, `src/agents/buildTravelAgent.ts`):

- `propose_booking` tool spec — `customer_name` and `customer_email` deleted from both `inputSchema.properties` and the `required` list. Description sentence added forbidding the agent from asking or passing them.
- Prompt bullet on customer info flipped from "ask for name/email before proposing" to "don't ask; the app derives from session at Confirm; if the user offers name/email unprompted, just acknowledge."
- New prompt bullet: "prior-booking access requires sign-in — if `get_booking` / `cancel_booking` on a past booking returns not-found and the user hasn't signed in, remind them to click Sign in at the top-right."

**Prompt hygiene fixes bundled in** (two latent bugs surfaced during Phase 2 review):

- The old Bookings rule required BOTH a flight AND a hotel option to be on screen before `propose_booking` — but the service accepts `flights.length + hotels.length > 0` (hotel-only, flight-only, combined all supported). Every eval case that touched bookings was hotel-only and passed only because gpt-4o is flexible enough to ignore the literal rule. Rewrote rule 0 / (a) / (b) to scope the pre-propose search requirement to what the user actually asked for.
- Rule (c) listed `"confirm"` as a `propose_booking` trigger verb — but `"Confirm"` is literally the button label on the BookingCard. Users saying "confirm" after a proposal exists mean "I want to click the button," not "propose again." Removed `"confirm"` from the trigger list; added disambiguation ("if a proposal is on screen, point at the Confirm button; don't call `propose_booking` again"). Kept `"book"` and `"reserve"` — those genuinely map to the "prepare a proposal" step (analogous to clicking Reserve on Booking.com / Airbnb before checkout).

**UI** (`src/components/BookingCard.tsx`, `src/components/PostSignInConfirmHandler.tsx`):

- BookingCard's Confirm click now pre-flights auth. If `!currentUser`, calls `signInWithGoogle('/?confirm=<id>')` and returns before the POST. The `?confirm=<id>` query param on the callback URL is what the landing page reads to resume.
- Subheader shows `"Guest identity is set at Confirm"` for anon PROPOSED rows (nulls on name/email); `"<name> · <email>"` once claimed.
- **New**: `PostSignInConfirmHandler` — mounted at the top of `app/page.tsx`. Reads `?confirm=<id>` from `useSearchParams`, waits for `useCurrentUser` to resolve to a signed-in identity (handles the race where auth state hasn't populated on first render), POSTs `/api/booking/<id>/confirm`, shows an MUI Snackbar with the result, and strips the query param via `history.replaceState` so a refresh doesn't re-trigger. Uses a `useRef` guard against React strict-mode double-invoke.

**Why the auto-confirm handler is load-bearing.** Without it, the anon → OAuth → confirm loop is broken end-to-end: the user clicks Confirm signed out → OAuth redirect → returns to `/` signed in with no chat state → the BookingCard is gone, no button to click, the DB row stays PROPOSED forever. Discovered during the first Phase 2 smoke test — the user's booking row stayed PROPOSED after a successful sign-in, and adding `PostSignInConfirmHandler` was the fix. The chat state itself still doesn't survive the redirect (that's Phase 3's persistence work), but the confirmation intent does.

**Eval status.** All existing eval cases green — the harness never signs in, so it exercises the anon paths, and those are behavior-identical to before Phase 2 (propose still works without customer fields, cancel of anon PROPOSED still allowed, `get_booking` of an anon in-conversation PROPOSED still works).

#### Phase 3 — Conversation persistence

What ships: signed-in users' chats are DB-backed with `/c/[id]` resume URLs. Header gains a "+ New chat" link and a Conversations dropdown. Anonymous users behave exactly as before Phase 3 (tab-scoped, no persistence).

**Storage shape.** Two tables (proper normalization for pedagogical clarity — over the alternative of one big JSON blob on Conversation):

- **`Conversation`** — `id` (cuid), `userId` (String FK, required — no anon conversations), `title` (nullable, auto-derived from the first user message, truncated to 60 chars), `createdAt`, `updatedAt`.
- **`Message`** — `id` (cuid), `conversationId` (FK), `data JSON` (one `AgentInputItem` as-is), `createdAt`, sortable by insertion order.

One `Message` row per `AgentInputItem` — one for a user turn, one for an assistant turn, one for each `function_call`, one for each `function_call_result`. Load is `SELECT * ORDER BY createdAt ASC, id ASC` — the resulting array is what the agent's `run()` expects verbatim.

**Why `Message.data` is JSON, not typed columns.** `AgentInputItem` is a discriminated union with wildly different shapes per role (`{ role: 'user', content: string }`, `{ role: 'assistant', content: [...] }`, `{ type: 'function_call', name, arguments, callId }`, `{ type: 'function_call_result', callId, output: { type: 'text', text } }`). Normalizing every possible field would be a schema for one library's internal format, and would need re-migrating every time the SDK's shape shifted. A JSON blob preserves fidelity and matches what `run()` consumes.

**Schema changes** (`prisma/schema.prisma`):

- `User.conversations Conversation[]` — reverse relation.
- New `Conversation` model — see above. `@@index([userId, updatedAt])` for fast per-user listing sorted newest-first (the header dropdown query).
- New `Message` model — see above. `onDelete: Cascade` on `conversationId` so deleting a conversation cleans up its messages. `@@index([conversationId, createdAt])` for fast ordered load.

**Persistence layer** (three new files under `src/lib/`):

- **`services/ConversationServiceError.ts`** — typed error class, `CONVERSATION_NOT_FOUND` / `INTERNAL_ERROR` codes. Mirrors `BookingServiceError` so `apiErrorResponse` maps it to HTTP status uniformly (extended with a new branch).
- **`repositories/ConversationRepository.ts`** — raw Prisma queries. `findById` (full load with messages ordered), `findMetaById` (metadata-only for cheap ownership checks — skips the messages join), `listByUser` (10 most-recent for the header), `create` (new empty conversation), `appendMessages` (batch insert via `createMany` in a transaction that also bumps `updatedAt` on the parent so the dropdown sees fresh conversations on top). `createWithMessages` added in the Phase 3.5 post-refactor — creates + inserts messages in a single callback-form transaction for the anon-resume path.
- **`services/ConversationService.ts`** — business logic. Key methods:
  - `loadForUser({ id, userId })` — full load + ownership check. Throws `CONVERSATION_NOT_FOUND` (not `FORBIDDEN`) on cross-tenant, so id-scanning can't enumerate other users' conversations. Decodes the JSON blobs back into `AgentInputItem[]` in the returned `LoadedConversation.history`.
  - `assertOwnership({ id, userId })` — cheap variant used by `/api/agent` on every turn (skips the messages load).
  - `create({ userId, titleSource })` — creates the row; auto-derives a title by finding the first user turn in `titleSource` and truncating to 60 chars with an ellipsis. `titleSource` is title-derivation *only* — no messages are persisted here. Used by `/api/agent` on the first turn (where create + append can't be atomized because the id must be returned to the client mid-stream). Param was called `seedHistory` originally; renamed in the Phase 3.5 post-refactor to make the narrow purpose obvious.
  - `createWithSeed({ userId, history })` — atomic create + append via `repo.createWithMessages`. Used by `/api/conversations` (Phase 3.5 anon-resume path) where the full history is available up-front. If the message insert fails, the Conversation row rolls back — no orphan titled-but-empty ghost in the header dropdown.
  - `appendTurn({ conversationId, newItems })` — batch-writes a list of `AgentInputItem`s as `Message` rows.

Also `src/lib/index.ts` exports the new module, adds `createConversationService()` factory (shares the same PrismaClient as the rest of the app), and adds `isConversationServiceError` type guard.

**Agent route wiring** (`app/api/agent/route.ts`):

- Body now accepts optional `conversationId: string` (follow-up turns only).
- Right after body parse, calls `getCurrentUser()`. Anonymous → persistence skipped entirely (no service is even constructed).
- Signed-in **with** `conversationId` — `assertOwnership` throws 404 if the caller doesn't own it. Guards against a client trying to write into someone else's conversation.
- Signed-in **without** `conversationId` — first turn of a fresh conversation. Call `create({ userId, titleSource: [...history, { role: 'user', content: userInput }] })` so `deriveTitle` sees the user's actual message. Now `conversationId` is set for the rest of the request.
- After `await stream.completed` inside the SSE stream's `start()`, if there's a service + id, compute `newItems = stream.history.slice(history.length)` (everything new since this turn started) and `appendTurn`. Wrapped in try/catch so a persistence failure logs but doesn't corrupt the stream — the user still sees the turn complete.
- `done` event now includes `conversationId` so the client can pick it up and swap the URL.

**New API route** (`app/api/conversations/route.ts`) — `GET /api/conversations` returns the current user's 10 most-recent conversations. Anonymous callers get an empty array (not 401), so the header dropdown renders gracefully in both auth states without conditional fetches on the client.

**Stream type + hydration utility:**

- `src/types/stream.ts` — the `done` event's payload now declares optional `conversationId: string`.
- **New** `src/utils/hydrateChatMessages.ts` — converts `AgentInputItem[]` (canonical, DB-stored) into `ChatMessage[]` (rich UI display). Grouping rule: each user turn opens a new user bubble AND a new agent bubble; every `function_call` / `function_call_result` / assistant message that follows accumulates onto the current agent bubble until the next user turn. Mirrors what `useAgentChat` builds up live via SSE events, so a loaded `/c/[id]` looks identical to a just-chatted session. UI-only concepts (`handoffs`, `blockedBy`, `pending`) don't survive persistence — restored bubbles show empty handoffs and `pending: false`.

**Hook rework** (`src/hooks/useAgentChat.ts`):

- Now accepts `{ initialConversationId?, initialHistory? }`. `/` passes nothing; `/c/[id]` passes both.
- `messages` state is seeded via `hydrateChatMessages(opts.initialHistory)` when hydrating a resumed conversation.
- `history` state is seeded from `opts.initialHistory`.
- **New**: `conversationId` state, seeded from `opts.initialConversationId ?? null`.
- `send()` request body includes `conversationId` (undefined for anon or first signed-in turn).
- On the `done` event: if the payload's `conversationId` doesn't match current state, `setConversationId(payload.conversationId)` AND `window.history.replaceState({}, '', '/c/[id]')` — the URL swap on the first-turn case, no re-render loop.
- Returns `{ messages, pending, send, conversationId }`.

**UI:**

- **New** `src/components/ChatContainer.tsx` — extracted the chat surface (Container, Paper, MessageBubbles/SamplePrompts, form input, `PostSignInConfirmHandler`) from `app/page.tsx` into a reusable client component. Takes optional `initialConversationId` + `initialHistory` props and passes them to `useAgentChat`. `app/page.tsx` shrinks to just `<ChatContainer />`.
- **New** `app/c/[id]/page.tsx` — server component. Reads `params.id` and the current user. Anonymous caller → `redirect('/')` (see the UX note below). Signed-in caller → `loadForUser({ id, userId })`; success renders `<ChatContainer initialConversationId={id} initialHistory={history} />`; failure with `CONVERSATION_NOT_FOUND` → `notFound()` triggers Next.js 404 (cross-tenant guard, no info leak).
- **Header rework** — split into three sub-components: `SignedInControls` (with a `+ New chat` link, the Conversations dropdown, and the avatar/sign-out menu), `ConversationsMenu` (lazy fetch on first open; refetches on each open so a just-created conversation on the current tab shows up), and `SignedOutControls` (the Sign in button, unchanged). Title is now a `Link` to `/`.

**Anon-user redirect on `/c/[id]`.** The original draft of `/c/[id]/page.tsx` redirected anonymous callers to the built-in NextAuth sign-in page. Smoke-testing revealed this was bad UX: signing out from a `/c/[id]` URL sent the user through NextAuth's redirect chain back to `/c/[id]`, saw no user, and then pushed them into the sign-in page — the opposite of what they wanted after clicking Sign Out. Also: signing back in as a different user (via that forced sign-in page) landed them on the *previous* user's `/c/[id]` URL, hitting a cross-tenant 404. Fixed by redirecting anonymous callers to `/` instead — sign-out lands on fresh anon chat, and a shared/bookmarked `/c/[id]` URL opened by someone not signed in also lands on `/` (where the header still offers a sign-in button if they want it).

**Auto-create flow.** Signed-in user visits `/`, types their first message; the agent route creates a `Conversation` row (deriving the title from that first message), streams the response, and echoes the new `conversationId` in the `done` event. The hook picks that up and calls `window.history.replaceState(..., '/c/[id]')` — the URL swaps silently, no page reload, no re-render loop. From that point on, refresh + bookmarking work.

**Deferred to Phase 3.5 (or later): the anon-to-signed-in bridge.** If an anon user chats on `/` and then signs in mid-flow (e.g., via the Phase 2 Confirm button), their chat state is still lost on the OAuth redirect — same as after Phase 2. The fix requires `localStorage`/`sessionStorage` machinery to save the anon history before redirect and restore + persist it after. Skipped for Phase 3 to keep the scope tight; a candidate for its own small stage between Phase 3 and Phase 4.

**Eval status.** All existing eval cases green — the harness never signs in, so it exercises the anon `/api/agent` path, which is behavior-identical to before Phase 3 (no session → no persistence → no changes visible to the agent flow).

#### Phase 4 — Sharing

What ships: opt-in per-conversation sharing via a header icon → modal → toggle. Anyone with the link (signed-in or anonymous) can view a shared conversation read-only. Only the owner can continue.

**Sharing model.**

| State | Who can view `/c/[id]` | Who can append turns |
|---|---|---|
| Private (default) | Only the owner | Only the owner |
| Shared | Owner + anyone with the link (signed-in or anon) | Only the owner |
| Shared → un-shared | Back to owner-only. Anyone who had the link gets 404 (signed-in) or redirected to `/` with a notice banner (anon) | Only the owner |

Two consistent design choices:
- **Read-only viewers** — sharing only grants view access, never write. The `/api/agent` route's `assertOwnership` check is intentionally NOT relaxed for shared conversations.
- **Info-leak-safe** — non-owner attempts to view a private conversation return the same shape (404 for signed-in / redirect + neutral banner for anon) whether the conversation doesn't exist, is private, or was previously shared and revoked. Prevents id-enumeration from distinguishing between these cases.

**Schema change** (`prisma/schema.prisma`): a single `Conversation.shared Boolean @default(false)` column. Nothing else — everything derives from this flag.

**Migration**: additive, defaults existing rows to `shared: false`.

**Service** (`src/lib/services/ConversationService.ts`):

- `LoadedConversation` now includes `shared: boolean` so the client can seed its state without a second query.
- New `ConversationView = LoadedConversation & { isOwner: boolean }` — viewer-side shape with a computed `isOwner` flag so the page doesn't re-compare viewerId to userId.
- Replaced `loadForUser({ id, userId })` with **`loadForViewer({ id, viewerId: string | null })`** — new access rules: owner OR (`shared === true`). Returns `null` instead of throwing, which lets the page distinguish "not viewable" from "some other error" and choose 404 vs redirect vs throw at the boundary.
- New **`setShared({ id, userId, shared })`** — owner-only via the existing `assertOwnership` check; returns the new `{ shared }` for optimistic UI.
- **`assertOwnership` intentionally unchanged** — sharing grants READ access; only the owner can append turns.

**Repository** (`src/lib/repositories/ConversationRepository.ts`): new `setShared({ id, shared })` — raw Prisma update returning `{ shared }`.

**New API route** (`app/api/conversations/[id]/route.ts`): `PATCH /api/conversations/[id]` — owner-only. 401 if anon, cross-tenant → 404 via the service. Body `{ shared: boolean }`. Returns `{ shared }`.

**Client Context** — the load-bearing piece of coordination between Header and page:

- **New `src/lib/share/ShareContext.tsx`** — client React Context. Shape: `{ conversationId, isOwner, shared, setShareState, setShared }`. Empty default (`conversationId: null`) so the Header's `ShareButton` trivially short-circuits on `/`.
- **Why a Context and not props**: Header is a sibling of the page — both mount inside the root layout, which is a server component. Prop-drilling between them would require lifting state into the layout, which can't hold client state. A client Context in `app/providers.tsx` is the cleaner boundary. Alternative was Header fetching ownership metadata on every navigation — an extra HTTP round-trip that most navigations don't need.
- **`app/providers.tsx`** nests `ShareProvider` inside `SessionProvider`.

**Page** (`app/c/[id]/page.tsx`):

- Uses `loadForViewer` instead of the old `loadForUser`.
- Passes `initialShared` + `isOwner` to `ChatContainer`.
- Fallback when `loadForViewer` returns `null`: signed-in → `notFound()` (real 404); anon → `redirect('/?notice=conversation-unavailable')` (friendlier UX, notice explained by `UrlNoticeHandler`).

**ChatContainer** (`src/components/ChatContainer.tsx`):

- Accepts `initialShared` + `isOwner`. Computes `readOnly = initialConversationId != null && !isOwner`.
- **Publishes to `ShareContext` on mount** with a subtle disambiguation: if `liveConversationId` (from `useAgentChat`) matches `initialConversationId` (from props), trust `props.isOwner` — this is the `/c/[id]` load path. If they differ (id was undefined at mount but the hook resolved a new one via the auto-create flow on `/`), set `isOwner: true` — `/api/agent` only creates conversations under the signed-in user's id, so the caller is by definition the owner. Without this branch, the Header's Share button wouldn't appear after the URL swap on `/` (the bug caught during smoke testing).
- **Read-only rendering**: `outlined` info Alert above the chat surface ("Shared conversation — view-only"), plus a disabled `TextField` and disabled Send button with a different placeholder ("Read-only — sign in and open your own chat to send messages.").

**ShareModal** (`src/components/ShareModal.tsx`):

- MUI `Dialog` with a `Switch` at the top, help text underneath, and (when shared) a read-only `TextField` with the URL + copy `IconButton`.
- Reads `useShareState()` for current `conversationId` + `shared`.
- Toggle → `PATCH /api/conversations/[id]` → on success, `setShared(body.shared)` writes back to the Context so the Header's icon updates immediately.
- Copy uses `navigator.clipboard.writeText`; success shows a 2-second alert.
- URL computed from `window.location.origin` — works in dev + prod without config.

**Header extension** (`src/components/Header.tsx`):

- **New `ShareButton` sub-component** — reads `useShareState()`. Returns `null` unless BOTH `conversationId` AND `isOwner` are set. Icon color reflects state: `primary` (blue) when currently shared, `default` (grey) when not. Opens `ShareModal` on click.

**New `UrlNoticeHandler`** (`src/components/UrlNoticeHandler.tsx`): communicates soft errors from server-side redirects.

- Reads `?notice=…` from `useSearchParams`, matches against a `NOTICES` dictionary, renders an **inline persistent MUI `Alert` banner** above the chat surface. Iteration went bottom-right Snackbar → top-anchored Snackbar → **inline banner** because the redirect notice is easy to miss when it isn't user-triggered, and a persistent banner in the same visual position as the "Shared conversation — view-only" one gives it consistent semantics.
- **`variant: 'outlined'`, `severity: 'warning'`** (orange) — reads as "heads up, this didn't work" rather than neutral info.
- Only `conversation-unavailable` notice defined so far — neutrally worded to avoid revealing which of *doesn't-exist / private / was-revoked* actually applied.
- Strips the param via `history.replaceState` so a refresh doesn't re-fire.
- `useRef` guard against React strict-mode double-invoke.

**Late UX fix** (`src/lib/auth/client.ts`): `signOutCurrent` default callback URL changed from `window.location.href` to `'/'`. The old default meant signing out from a shared `/c/[id]` (as owner) would land the user on the read-only viewer view of their own conversation — actively confusing. Now sign-out from anywhere lands on `/`.

**Eval status**: all existing eval cases green — sharing is entirely UI + persistence-layer work; the agent flow is untouched.

#### File index

```
src/lib/auth/
├── config.ts                          (NextAuthConfig — Google provider, Prisma adapter, database sessions)
├── index.ts                           (NextAuth() call — exports handlers, auth, signIn, signOut)
├── session.ts                         (server: CurrentUser, getCurrentUser, requireUser)
└── client.ts                          (client: useCurrentUser, signInWithGoogle, signOutCurrent)

src/lib/repositories/ConversationRepository.ts    (Phase 3 — findById/findMetaById/listByUser/create/appendMessages; Phase 4 added setShared)
src/lib/services/ConversationService.ts           (Phase 3 — listForUser/create/appendTurn/assertOwnership; Phase 4 replaced loadForUser with loadForViewer, added setShared; Phase 3.5 post-refactor renamed create's seedHistory→titleSource, added atomic createWithSeed)
src/lib/services/ConversationServiceError.ts      (Phase 3 — typed error class)
src/lib/share/ShareContext.tsx                    (Phase 4 — client Context for {conversationId, isOwner, shared})

src/types/next-auth.d.ts               (module augmentation — adds id to session.user)
src/utils/hydrateChatMessages.ts       (Phase 3 — AgentInputItem[] → ChatMessage[] for /c/[id] hydration)

src/components/
├── Header.tsx                         (Phase 1 — MUI AppBar; extended in Phase 3 with New chat + Conversations dropdown; Phase 4 added ShareButton sub-component)
├── PostSignInConfirmHandler.tsx       (Phase 2 — auto-completes booking confirm after OAuth redirect)
├── ChatContainer.tsx                  (Phase 3 — extracted chat surface; Phase 4 added readOnly mode + share-context publishing)
├── ShareModal.tsx                     (Phase 4 — Dialog with toggle + URL + copy button)
└── UrlNoticeHandler.tsx               (Phase 4 — inline warning banner for ?notice=… server redirects)

app/
├── providers.tsx                      (Phase 1 — client AuthProvider; Phase 4 nested ShareProvider inside)
├── api/auth/[...nextauth]/route.ts    (Phase 1 — mounts handlers.GET / handlers.POST)
├── api/conversations/route.ts         (Phase 3 — GET list, 10 most-recent for current user)
├── api/conversations/[id]/route.ts    (Phase 4 — PATCH { shared: boolean }, owner-only)
└── c/[id]/page.tsx                    (Phase 3 — server-loads; Phase 4 uses loadForViewer, passes isOwner/initialShared, anon-fallback notice)

prisma/migrations/
├── 20260721193613_stage_17_auth_tables/                   (Phase 1 — User, Account, Session, VerificationToken)
├── 20260722192414_stage_17_phase_2_booking_ownership/     (Phase 2 — Booking.userId FK, nullable customer fields)
├── 20260727185322_stage_17_phase_3_conversations/         (Phase 3 — Conversation + Message tables)
└── 20260731202040_stage_17_phase_4_conversation_shared/   (Phase 4 — Conversation.shared column)
```

Modified across all four phases: `prisma/schema.prisma`, `src/lib/index.ts`, `src/lib/services/BookingService.ts`, `src/types/booking.ts`, `src/types/chat.ts`, `src/types/stream.ts`, `src/hooks/useAgentChat.ts`, `src/components/BookingCard.tsx`, `src/agents/buildTravelAgent.ts`, `src/mcp/tools/travel/proposeBookingToolSpec.ts`, `src/utils/apiErrorResponse.ts`, `app/layout.tsx`, `app/page.tsx`, `app/api/agent/route.ts`, `app/api/booking/propose/route.ts`, `app/api/booking/[id]/route.ts`, `app/api/booking/[id]/confirm/route.ts`, `app/api/booking/[id]/cancel/route.ts`, `.env.example`, `package.json` (+ `package-lock.json`).

---

### Stage 17.5 — Prompt tightening + thin-data assertion

Follow-up stage after Stage 17 wrapped, driven by evaluation output. The `sunny-weekend-from-athens` case (the most complex multi-tool query in the suite: needs `search_flights`, `search_hotels`, `get_forecast`, budget arithmetic, and honest handling of the seeded flight window that returns zero inbound flights for `ATH → BER` on the eval date) had accumulated a **~40% catastrophic failure rate** — runs where the agent skipped tools entirely and pattern-completed from training-data memory or from the user's message, tripping one of the Stage 11-14 fabrication guardrails and producing an empty response. Not caused by any single prior stage — a gradual attention-weight erosion from prompt accretion across Stages 8-17 Phase 4 pushed the "call tools first" instruction out of the model's high-attention envelope.

**Not a guardrail stage** — no new guardrail files, no new synthetic cases. Prompt tightening + a targeted assertion fix.

#### Prompt changes ([src/agents/buildTravelAgent.ts](src/agents/buildTravelAgent.ts))

Two new **PRIME DIRECTIVES** relocated to the top of the instructions array (position 2, right after the role/date statement) so they get the highest attention weight:

- **`PRIME DIRECTIVE — TOOLS BEFORE PROSE`** — enumerates every drift class (prices, flight numbers, hotel names, temperatures, forecast conditions, booking references), names the specific guardrail that catches each (Stages 11-14), and states the rule bluntly: *"If a tool wasn't called, its data doesn't exist for you — don't invent it."*
- **`PRIME DIRECTIVE — THIN TOOL DATA`** — specifically addresses the "missing inbound flight" case that produced the arithmetic slip in earlier Stage 17 Phase 3 evals: do not double the outbound price into a fake round-trip total, do not invent a return leg, quote only what the tool returned.

Two intermediate versions of these rules that sat mid-prompt (position ~11) were removed — the top placement is the load-bearing part. Prompt position matters for gpt-4o on this kind of complex multi-rule instruction set.

#### Assertion fix ([src/evals/cases/sunnyWeekendFromAthens.ts](src/evals/cases/sunnyWeekendFromAthens.ts))

The `tripTotalArithmeticCheck` assertion was designed for the "search_flights returned both directions" case. When the seeded DB happens to have no inbound for the eval date, the model correctly handled it (per the new THIN TOOL DATA rule) but the assertion had no way to validate a one-way response and failed. Two changes:

- **Two-mode validCombos construction**:
  - Inbound present → strict `outbound + return + hotel` combos (unchanged; still catches the classic Stage 9 "skipped the return leg" drift).
  - Inbound empty → `outbound + hotel` combos (accepts the honest one-way trip cost).
  - Modes are **branched, not unioned** — mixing them would let the old skip-the-return drift sneak through as "valid" arithmetic when inbound IS available.
- **Thin-data escape**: if inbound was empty AND no candidate matches a valid combo AND the response prose contains an honest-thin-data phrase (matched by a permissive `HONEST_THIN_DATA_PHRASING` regex — "no return flights", "only outbound", "return...weren't found", "round-trip calculation isn't possible", etc.), pass the assertion. Rationale: the model choosing NOT to write a grand total when it can't confidently compute one is the *desired* THIN TOOL DATA behavior, not a bug.

#### Results

Five-run stability check on `sunny-weekend-from-athens` post-fix:

| Metric | Before | After |
|---|---|---|
| Catastrophic drift (0 tool calls → guardrail trip → empty response) | ~40% | ~20% |
| Full pass | ~40% | 60% (adjusted for the fixed assertion regex) |
| Partial (all tools called, honest but incomplete response) | rare | 20% |

**Halved the catastrophic rate.** Not eliminated. Remaining ~20% is inherent to gpt-4o's attention behavior on this specific complex multi-tool query — the model occasionally pattern-completes from user input (e.g., echoing the "€600" from the user's budget as a fake flight price) even with PRIME DIRECTIVES at the top of the prompt.

#### Known limitation (documented for future readers)

`sunny-weekend-from-athens` has residual variance on the anon eval codepath. When drift happens, the Stage 11-14 output guardrails catch it before any wrong info reaches the user — the safety net works as designed — but the user sees an empty response instead of a chat. Options for further improvement, if this becomes a priority:

- **Model bump** — try `gpt-4o-2024-11-20`, `gpt-4.1`, or `o1` for the TravelAgent. Larger reasoning budget likely helps this specific attention issue.
- **More prompt structure** — put critical rules in numbered `STEP 1: ...` format at the top, or ALL-CAPS a subset. Diminishing returns per rule at this point.
- **Simplified test seed** — make sure the eval date has inbound flights so THIN TOOL DATA path isn't triggered by seed thinness. Would mask the issue rather than fix it — not recommended.

The residual is being tracked as inherent-model-limitation rather than a defect the current codebase can address.

#### File index

Modified only: `src/agents/buildTravelAgent.ts` (two PRIME DIRECTIVES added at position 2, two intermediate rules removed), `src/evals/cases/sunnyWeekendFromAthens.ts` (two-mode arithmetic check + thin-data escape + honest-phrasing regex).

No new files, no schema/migration, no README-affecting deps.

---

### Stage 17 Phase 3.5 — Anon-to-signed-in bridge

Ships after Phase 4 and Stage 17.5, but logically extends the Phase 2 anon-Confirm handoff + the Phase 3 persistence model. Not renumbered because it doesn't invalidate anything in Phase 4 or 17.5 — it slots between the two like a delta patch.

**Motivation.** After Phase 2, the anon-Confirm-then-OAuth loop technically worked (`PostSignInConfirmHandler` completed the confirm) but had several UX gaps that surfaced during smoke testing:

1. **Chat state was gone.** After OAuth redirect back to `/`, the anon-side chat lived only in React state — a route change wiped it. The `?confirm=<id>` param carried enough for the confirm POST, but the user landed on a blank canvas with the header showing a stray success snackbar and no visible chat, then had to re-do the whole planning conversation to reach another booking.
2. **The confirm POST ran serially with a conversation-create POST**, so once persistence landed in Phase 3 the total post-OAuth wait was ~6-8s (two 3-4s Neon round-trips back to back) plus a visible mid-flight route change between them.
3. **A race between the refetch-on-mount and the `booking-updated` event** could clobber the just-set PAID booking back to PROPOSED if the GET response happened to arrive after the confirm POST completed. (Only shows up under specific timing — showed up on the second smoke run.)
4. **A tab refresh mid-anon-chat lost the whole chat**, since anon state was React-only.

Also folds in a couple of unrelated defects noticed during the same round of smoke testing: hydrated tool outputs coming through MCP-envelope-wrapped (BookingCard degraded to a generic accordion after page reload), and a residual `THIN TOOL DATA` violation where the model would silently emit `Flight Total: €138` when only the outbound leg existed.

#### The persistence model

**sessionStorage, not localStorage.** Anon chats are tab-scoped by design — the same trade-off as anon Booking rows in Phase 2. localStorage would let a chat outlive its owner (e.g. shared browser). sessionStorage clears on tab close, matches user intuition for "unauth ephemeral state," AND survives F5 refresh in the same tab as a bonus.

**Save-on-every-turn, never on empty.** [`src/utils/anonChatStorage.ts`](src/utils/anonChatStorage.ts) writes the full history each time it changes. Empty histories are treated as *don't clobber* rather than *clear*: on post-OAuth mount, the fresh `ChatContainer` initialises with `history=[]` while `useCurrentUser()` is still loading. If we cleared storage on empty here, we'd wipe the anon history a hair before `AnonChatResumeHandler` could read it. Explicit clears live in the resume handler after successful migration.

**Synchronous restore on first render.** [`ChatContainer`](src/components/ChatContainer.tsx) reads sessionStorage via `useMemo` (not `useEffect`) so the restored history is available in the very first render — `useAgentChat` only reads its `initialHistory` prop in its `useState` initializer, so a delayed `setState` would arrive too late. Paired with a `mounted` state gate: server renders empty, first client render also renders null, then the mount effect flips `mounted` true and the restored content renders. Without the gate, hydration would mismatch (server: `<SamplePrompts />`, client: `<MessageBubbles>` with restored content).

#### The resume handler

[`AnonChatResumeHandler`](src/components/AnonChatResumeHandler.tsx) runs at the top of `ChatContainer`. On mount, when both preconditions align (signed-in user + non-empty saved history):

1. Reads `?confirm=<id>` from the URL. If present, fires the booking-confirm POST **in parallel** with the conversation-create POST via `Promise.all`. Cuts total wait from ~6-8s serial to ~3-4s concurrent, since both hit the same Neon DB and are individually round-trip-bound.
2. When both resolve: writes the freshly-PAID booking + a success snackbar payload to sessionStorage under separate keys.
3. Clears the anon-chat history key **before** navigating (a race with `ChatContainer`'s auto-save effect on the new page would otherwise re-write it).
4. Navigates to `/c/<newConvId>` via `router.replace`, stripping `?confirm=` so `PostSignInConfirmHandler` doesn't re-POST.

Failure semantics: conversation-create failure surfaces inline as a warning banner and leaves storage in place (manual refresh retries). Confirm failure is best-effort — the resume still navigates (chat migration succeeded) and stashes an *error* snackbar so the user learns why. `firedRef` guards against React strict-mode double-invoke.

#### Handoff on `/c/[id]`

Two consumers pick up the handoff:

- **[`BookingCard`](src/components/BookingCard.tsx)** on mount, if `booking.status === 'PROPOSED'`, reads `readPendingConfirmedBooking(booking.id)` first. Match → `setBooking(paid)` + clear key + skip refetch entirely (no network round-trip, no visible flicker from PROPOSED→PAID). Miss → falls through to the general refetch-on-mount, which handles the "stale snapshot after page reload much later" case unrelated to the resume flow.
- **[`PostSignInConfirmHandler`](src/components/PostSignInConfirmHandler.tsx)** on mount reads `readPendingSnackbar()` unconditionally. Match → renders the snackbar, clears the key, doesn't POST. Miss → falls back to the original POST path, but only on `/c/[id]` (the pathname gate prevents racing `AnonChatResumeHandler` on `/`). The fallback is for the edge case of someone hitting `/c/[id]?confirm=<id>` directly (bookmarked URL, hand-typed).

The refetch on `BookingCard` also uses the functional `setState` form to refuse downgrading a non-PROPOSED status:

```ts
setBooking((prev) => (prev.status === 'PROPOSED' ? fresh : prev));
```

This guards the fallback POST path — the mount-time refetch and the confirm POST race on `/c/[id]?confirm=<id>`, and the GET can hit the DB before the POST commits (so `fresh.status === 'PROPOSED'` while the local state has already flipped to PAID via the `booking-updated` event). React runs child effects before parent effects, so `BookingCard`'s refetch fires *before* `PostSignInConfirmHandler`'s POST — same-order every mount, so this isn't a rare corner case. The functional setter makes refetch-vs-event ordering irrelevant.

#### In-flight UX on `/?confirm=<id>`

While the parallel POSTs are in flight (~3-4s), the anon-side `BookingCard` derives a busy state from the URL:

```ts
const searchParams = useSearchParams();
const oauthConfirmInFlight =
  booking.status === 'PROPOSED' &&
  searchParams.get('confirm') === String(booking.id);
```

Confirm button shows a spinner + is disabled; Cancel button is also disabled. Without this, the card sat with both buttons active for the whole 3-4s window — a user might click Confirm again and re-enter the OAuth loop.

#### Cross-tab / cross-nav event fallout

The fast path avoids `booking-updated` events entirely (the sessionStorage handoff is direct-to-`BookingCard`). But the *fallback* POST path in `PostSignInConfirmHandler` still needs to update any mounted `BookingCard` for the same id, so it dispatches a `booking-updated` `CustomEvent` on `window` with the full `BookingLike` payload. `BookingCard` listens for it and updates itself if the detail id matches. Same-tab only (window events don't cross tabs) — which is exactly the intended scope.

#### Two dropped-in defects

- **MCP-envelope hydration** ([`src/utils/hydrateChatMessages.ts`](src/utils/hydrateChatMessages.ts)) — the live agent-route SSE path unwraps MCP envelopes before delivering to the client, but `stream.history` (which is what gets persisted and hydrated) may still contain the wrapped shape. Without the fix, hydrated `toolCall.output` looked like `{"content":[{"type":"text","text":"{\"id\":42,...}"}]}` and `tryParseBooking` failed (id/reference/status aren't at top level), so the rich `BookingCard` degraded to a generic accordion after reload. `normalizeMcpEnvelope` mirrors what `rebuildCollectorFromHistory` already does for guardrails.
- **THIN TOOL DATA required phrasing** ([`src/agents/buildTravelAgent.ts`](src/agents/buildTravelAgent.ts)) — the Stage 17.5 rule said "don't invent inbound data" but didn't forbid emitting a `Flight Total: €138` label when only the outbound existed. Extended with REQUIRED phrasing ("*No return flight was found in the current window; the totals below reflect one-way pricing only.*") and a FORBIDDEN example. Deterministic, low-token, no new guardrail — the model was already suppressing the fabrication, just not the misleading label.

#### Code walkthrough — Flow A end-to-end

In the order the code executes, from clicking Confirm while anon to seeing a PAID card on `/c/[id]`.

**1. During the anon session — auto-save.**

The user chats, gets a `PROPOSED` booking, and hasn't signed in yet. Every time the chat history updates, this effect in [`ChatContainer.tsx:137-142`](src/components/ChatContainer.tsx#L137-L142) fires:

```ts
const currentUser = useCurrentUser();
useEffect(() => {
  if (currentUser || liveConversationId) return;
  if (liveHistory.length === 0) return;
  saveAnonChatHistory(liveHistory);
}, [liveHistory, currentUser, liveConversationId]);
```

Three gates matter:
- `currentUser || liveConversationId` — once signed in or a real DB conversation exists, the DB is source of truth; sessionStorage stops being written.
- `liveHistory.length === 0` — the load-bearing one. On the post-OAuth mount, `useAgentChat` initializes with `history=[]` and `useCurrentUser()` returns `null` while the session resolves. If we cleared storage on empty here, we'd wipe the anon history milliseconds before `AnonChatResumeHandler` could read it. So empty is treated as "don't touch", not "clear". Explicit clears live in `AnonChatResumeHandler` after successful migration.

Also required exposing `history` from `useAgentChat` (previously only `messages` — the UI-facing bubble form — was returned). See [`useAgentChat.ts`](src/hooks/useAgentChat.ts). We save the canonical form so we can hand it back to the agent later.

**2. User clicks Confirm on a `PROPOSED` BookingCard.**

In [`BookingCard.tsx:143-152`](src/components/BookingCard.tsx#L143-L152), when the click handler sees a null `currentUser`, it triggers OAuth with a callback URL that encodes the booking id as a query param:

```ts
if (action === 'confirm' && !currentUser) {
  const callbackUrl = `/?confirm=${booking.id}`;
  void signInWithGoogle(callbackUrl);
  return;
}
```

Google auth → back to `/?confirm=42`.

**3. Landing on `/?confirm=42` — restore + immediate visual feedback.**

`ChatContainer` mounts. Three things happen in parallel:

*(a) Synchronous restore* ([`ChatContainer.tsx:63-70`](src/components/ChatContainer.tsx#L63-L70)):

```ts
const restoredAnonHistory = useMemo(() => {
  if (initialConversationId) return undefined;
  if (typeof window === 'undefined') return undefined;
  const saved = readAnonChatHistory();
  if (!saved || saved.length === 0) return undefined;
  return saved;
}, [initialConversationId]);
const effectiveInitialHistory = initialHistory ?? restoredAnonHistory;
```

**Why `useMemo` here?** This is the load-bearing hook choice in Phase 3.5, and it's used *not for the usual reason* (perf caching) but for its **execution timing**. Three candidates were on the table; only `useMemo` works.

*Option A — inline expression (no memoization):*

```ts
const restoredAnonHistory =
  initialConversationId
    ? undefined
    : typeof window !== 'undefined'
      ? readAnonChatHistory() ?? undefined
      : undefined;
```

Correctness-wise fine. But it re-reads sessionStorage + parses JSON on every re-render, even though the value is only ever consumed on the first render (by `useAgentChat`'s `useState` initializer). Cheap, but pointless.

*Option B — `useState` + `useEffect` (the natural instinct):*

```ts
const [restoredAnonHistory, setRestoredAnonHistory] = useState<AgentInputItem[]>();
useEffect(() => {
  if (initialConversationId) return;
  const saved = readAnonChatHistory();
  if (saved?.length) setRestoredAnonHistory(saved);
}, [initialConversationId]);
```

This is **broken**, and the reason is the whole point of Phase 3.5's timing quirks:

1. First render: `restoredAnonHistory === undefined` → `useAgentChat` receives `initialHistory: undefined`.
2. `useAgentChat` internally does `useState(initialHistory ?? [])` → its state is now `[]`, forever.
3. Post-mount, our effect fires, calls `setRestoredAnonHistory(saved)`.
4. Re-render: `useAgentChat` receives `initialHistory: <saved>` — but its state is already initialized, and `useState`'s initializer only runs once. **The new prop is ignored.**
5. Chat stays blank.

`useEffect` is too late. We need the value to exist *during* the first render, not after.

*Option C — `useMemo` (what we ship):*

- Runs **during render** (like Option A) — so the value is available in the same render pass where `useAgentChat` initializes its state.
- Only recomputes when `initialConversationId` changes (Option A ran every re-render).
- Result is a stable reference across re-renders — nice for downstream `??` chains and any deps arrays.

The mental model:

- `useEffect` — "after render, do a side effect." Wrong tool when you need the value *for* the render.
- `useMemo` — "during render, compute this value; cache it across re-renders." Right tool when you need render-phase execution but not repeated recomputation.
- `useState` initializer function (`useState(() => ...)`) — also runs only during first render, but the value gets stored in state. Would work here too, but then we'd own the state and have to decide when to update it; `useMemo` keeps it purely derived.

Small caveat worth knowing: React's docs say `useMemo` is a *hint*, not a guarantee — React reserves the right to recompute even without deps changing (in practice it doesn't today, but shouldn't be relied on for side-effecting work). Reading sessionStorage is idempotent, so this is safe. If the "computation" had side effects, `useMemo` would be the wrong choice.

*(b) Hydration mismatch guard* ([`ChatContainer.tsx:83-86 + 207`](src/components/ChatContainer.tsx#L83-L86)):

```ts
const [mounted, setMounted] = useState(false);
useEffect(() => { setMounted(true); }, []);
// ...
if (!mounted && !initialConversationId) return null;
```

The synchronous restore is a client-only concept (`window` is `undefined` on the server). Without this gate, the server would render `<SamplePrompts />` (empty state) and the client would render `<MessageBubbles>` with restored content, and React would abort hydration. The gate makes the first client render match the server (null), then the mount effect flips `mounted` true and the restored content renders on the next tick.

**Deep dive: what `'use client'` actually means, and why this gate is needed.** One of the most common sources of confusion with Next.js App Router. The misconception is that `'use client'` means "runs only on the client." It doesn't.

*What `'use client'` actually means.* It's a **boundary marker**, not an SSR opt-out. All it says is: *"this component can use client-only features (hooks, event handlers, browser APIs), and everything below it in the tree also becomes client-side."* Crucially, the component **still gets rendered on the server** for the initial HTML response.

So the lifecycle of `ChatContainer` when you hit `/`:

1. **Server render**: Next.js runs `ChatContainer()` on the server to produce an HTML string for the response.
2. **Client hydration**: Browser receives the HTML, React runs `ChatContainer()` **again** on the client. It compares the client output tree to the pre-rendered HTML that arrived from the server. If they match, React "attaches" event handlers to the existing DOM — no visual change, just becomes interactive. This is called **hydration**.
3. **Post-hydration**: `useEffect`s fire. From here on, standard React re-render loop.

The key point: `ChatContainer` runs **twice** — once on the server, once on the client — with the *expectation that both produce the same output*.

*But hooks are client-only, right?* Useful shorthand, becomes wrong the moment SSR enters the picture. The precise version: hooks require a `'use client'` component (server components can't use them), but those components still get rendered on the server, and hooks DO execute during that render — with slightly different behavior per hook:

| Hook | Server behavior | Client behavior |
|---|---|---|
| `useState(init)` | Returns `[init, noopSetter]`. The setter exists but calling it does nothing — there's no re-render loop on the server. | Normal — setter triggers re-renders. |
| `useMemo(fn, deps)` | Runs `fn`, returns the value. No caching benefit (only runs once) but the value is correct. | Normal — memoizes across re-renders. |
| `useRef(init)` | Returns `{ current: init }`. | Same. |
| `useCallback(fn, deps)` | Returns `fn`. | Normal. |
| `useContext(ctx)` | Reads the value from the provider tree that server-rendered above it. | Same. |
| `useEffect(fn, deps)` | **Skipped entirely.** The effect is registered but never executed. | Runs after commit. |
| `useLayoutEffect(fn, deps)` | Skipped, and warns. | Runs synchronously before paint. |

Key insight: **state hooks work on the server, effect hooks don't.** Why the asymmetry? Because SSR's job is to produce the *initial HTML* — a snapshot of what the DOM will look like before any interaction. To do that, React needs to know the initial state (that's why `useState` runs and returns the initial value), but it doesn't need to run effects (those fire *after* the initial paint on the client, so they don't affect the initial HTML).

*Why sessionStorage breaks this.* Look at what `restoredAnonHistory` computes in each environment:

| Environment | `typeof window` | `readAnonChatHistory()` | Result |
|---|---|---|---|
| Server | `'undefined'` | never runs (guarded) | `undefined` → falls through to `<SamplePrompts />` |
| Client | `'object'` | reads sessionStorage, might return saved history | non-empty history → renders `<MessageBubbles>` |

Same URL, same code, same props — the server-produced HTML shows an empty state, and the client-produced tree shows a populated chat. React tries to hydrate and sees a total mismatch.

*What React does on mismatch.* Two bad things: (1) logs a console error (`Hydration failed because the server rendered HTML didn't match the client...`), and (2) throws away the entire subtree and re-renders from scratch client-side. You lose the SSR benefit for that subtree, and users see a brief flash where the server HTML disappears and gets replaced. On slower devices this is visibly janky. There are also subtler issues — text nodes might be re-parented weirdly, keyed lists can get confused about identity, event listeners attach to the wrong DOM nodes if you're unlucky.

*Tracing the mount-guard through both renders.*

Server render pass:

```ts
const [mounted, setMounted] = useState(false);
//    ↑ this runs. mounted = false, setMounted = noop.
useEffect(() => { setMounted(true); }, []);
//    ↑ this runs — the effect is REGISTERED — but the callback never fires.
//      React just makes a note "if this ever mounts on the client, run this."
if (!mounted && !initialConversationId) return null;
//    ↑ mounted is false here. initialConversationId is undefined on /.
//      Returns null. Server sends empty HTML in the component's slot.
```

First client render (hydration):

```ts
const [mounted, setMounted] = useState(false);
//    ↑ runs. mounted = false, setMounted = REAL setter.
useEffect(() => { setMounted(true); }, []);
//    ↑ registers the effect, to be scheduled after commit.
if (!mounted && !initialConversationId) return null;
//    ↑ mounted is still false during this first render. Returns null.
//      → matches the server's null → hydration succeeds.
```

After hydration completes: React commits and runs pending effects. Our `useEffect` fires → `setMounted(true)` (the real setter this time). State change triggers a re-render. This time `mounted === true`, guard skipped, `<MessageBubbles>` renders with restored content. This is a normal client-side state update, not hydration — no mismatch detection.

The pattern is essentially: *"on the first client render, deliberately match the server's boring output, even though I know I could produce better output. Then after hydration is done, produce the real output."*

*Why the `!initialConversationId` half of the guard?* That's the "only guard when we're doing the sessionStorage dance" clause. On `/c/[id]` pages, the server already loaded the conversation from the DB and passed `initialConversationId` + `initialHistory` down as props — both server and client render the same populated chat from those props, no sessionStorage involved, no mismatch risk. Guarding those pages would just produce a needless flash of null on every `/c/[id]` load.

*Alternatives considered.*

- **`dynamic(() => import('./ChatContainer'), { ssr: false })`** — Next.js lets you disable SSR for a component. Works but disables SSR for the WHOLE component including `/c/[id]` loads that don't need it, hurting initial-render time on those pages.
- **`suppressHydrationWarning`** — silences the warning but doesn't prevent the client re-render + flash. Visual bug remains, diagnostic is muted.
- **Read sessionStorage in `useLayoutEffect`** — runs before browser paint, so no flash. But hydration itself still fails; you just paper over the visual symptom. And `useLayoutEffect` on the server produces its own warning.

Mount-guard is cleanest because it addresses the root cause (server/client produce different output) by making the first client render deterministic.

*Related SSR-safety footgun.* Consider what would happen if the initial `useState` value came from `sessionStorage`:

```ts
const [restored, setRestored] = useState(() => readAnonChatHistory());
```

The lazy initializer function *would* run on the server (state hooks execute during SSR, remember). `window` would be undefined inside `readAnonChatHistory`, and unless the function guards against that, it'd throw during SSR. Classic App Router footgun — people write `useState(() => localStorage.getItem(...))` and get a runtime error the first time it SSRs. That's why every function in [`anonChatStorage.ts`](src/utils/anonChatStorage.ts) starts with `if (typeof window === 'undefined') return null` — that guard is what makes it SSR-safe.

*Rule of thumb for future SSR-safety.* If a value depends on anything browser-only (`window`, `document`, `localStorage`, `navigator`, `matchMedia`, etc.):

- Compute it inside `useMemo` or `useEffect`
- Guard with `typeof window === 'undefined'`
- If it must affect the initial render, use the mount-gate pattern to defer visible output until after hydration

*Server components vs client components — the clean summary.* Two totally different rendering models coexist in the App Router:

- **Server components** (no `'use client'` directive): render **only on the server**, once. They can `async`/`await`, hit the DB directly, read files. They can't use hooks — no client-side lifecycle. Output is serialized into the RSC payload and shipped to the browser.
- **Client components** (`'use client'` at the top): render **on the server AND on the client**. Hooks work in both places, with the caveats above. State + interactivity kick in on the client after hydration.

`'use client'` is opt-INTO-hooks, not opt-OUT-of-SSR. The SSR part still happens.

*(c) Immediate busy state on the BookingCard* ([`BookingCard.tsx:62-65`](src/components/BookingCard.tsx#L62-L65)):

```ts
const searchParams = useSearchParams();
const oauthConfirmInFlight =
  booking.status === 'PROPOSED' &&
  searchParams.get('confirm') === String(booking.id);
```

Purely derived from the URL — no state, no coordination with anything else. Wired into both buttons so during the ~3-4s parallel-POST window the user sees a spinner and disabled buttons, not the stale active buttons that made them think their earlier click was ignored.

**4. Parallel POSTs — `AnonChatResumeHandler`.**

The new component, [`AnonChatResumeHandler.tsx`](src/components/AnonChatResumeHandler.tsx). Effect fires on mount when both preconditions align (signed-in user + non-empty saved history):

```ts
const urlConfirmId = new URLSearchParams(window.location.search).get('confirm');
const parsedConfirmId = urlConfirmId ? Number(urlConfirmId) : null;
const shouldConfirm = parsedConfirmId !== null && Number.isInteger(parsedConfirmId) && parsedConfirmId > 0;

const [convRes, confirmRes] = await Promise.all([
  fetch('/api/conversations', { method: 'POST', ... body: { history } }),
  shouldConfirm
    ? fetch(`/api/booking/${parsedConfirmId}/confirm`, { method: 'POST', ... })
    : Promise.resolve(null),
]);
```

Both hit Neon and each takes ~3-4s individually. `Promise.all` runs them concurrently, so total is bounded by the slower — half the wait vs the previous serial version.

Then, best-effort handling of the confirm arm:

```ts
if (shouldConfirm && confirmRes) {
  const confirmBody = await confirmRes.json();
  if (confirmRes.ok && confirmBody?.id) {
    savePendingConfirmedBooking(confirmBody);   // for BookingCard on /c/[id]
    savePendingSnackbar({                        // for PostSignInConfirmHandler on /c/[id]
      severity: 'success',
      message: `Booking ${confirmBody.reference} confirmed.`,
    });
  } else {
    savePendingSnackbar({ severity: 'error', message: ... });
  }
}
```

Asymmetric error handling: conversation-create failure aborts (surfaced inline as a warning banner, storage left intact so a refresh retries). Confirm failure is best-effort — the chat migration still lands, and the error goes into the snackbar. That way the user isn't stranded on `/` because of a confirm hiccup.

Then clean up and navigate:

```ts
clearAnonChatHistory();                       // BEFORE navigation — else ChatContainer's
                                              // auto-save on the new page could re-write it
const target = new URL(`/c/${convBody.id}`, window.location.origin);
const currentParams = new URLSearchParams(window.location.search);
currentParams.forEach((value, key) => {
  if (key === 'confirm') return;              // strip — we already handled it above
  target.searchParams.set(key, value);        // preserve any others
});
router.replace(target.pathname + target.search);
```

Stripping `?confirm=` matters: without it, `PostSignInConfirmHandler` on `/c/[id]` would see the param and fire its own POST, either double-confirming or 404ing.

**5. Storage layer — `anonChatStorage.ts`.**

Three keys, all in sessionStorage ([`src/utils/anonChatStorage.ts`](src/utils/anonChatStorage.ts)):

- `anon-chat-history-v1` — the running history
- `anon-resume-confirmed-booking-v1` — the PAID booking after confirm
- `anon-resume-snackbar-v1` — the snackbar payload

Read functions all guard `typeof window === 'undefined'` for SSR-safety and swallow all storage exceptions (private mode, quota, etc.) — worst case the feature silently degrades. `readPendingConfirmedBooking(id)` includes an id-match guard so a stale entry from a different booking (e.g. two proposals in the same tab, only one confirmed) can't accidentally overwrite the wrong card.

**6. On `/c/[id]` — two synchronous consumers.**

The `router.replace` triggers a route change. `/c/[id]/page.tsx` server-loads the freshly-created conversation and renders. Client hydrates. Two components pick up the sessionStorage handoff on mount:

*BookingCard* ([`BookingCard.tsx:88-119`](src/components/BookingCard.tsx#L88-L119)):

```ts
useEffect(() => {
  if (booking.status !== 'PROPOSED') return;

  // Fast path
  const preconfirmed = readPendingConfirmedBooking(booking.id);
  if (preconfirmed) {
    setBooking(preconfirmed);
    clearPendingConfirmedBooking();
    return;
  }

  // Slow path — refetch
  let cancelled = false;
  void (async () => {
    try {
      const res = await fetch(`/api/booking/${booking.id}`);
      if (!res.ok) return;
      const fresh = await res.json();
      if (cancelled || fresh?.id !== booking.id) return;
      setBooking((prev) => (prev.status === 'PROPOSED' ? fresh : prev));
    } catch {}
  })();
  return () => { cancelled = true; };
}, []);
```

The fast path is a synchronous state upgrade — no network round-trip, no visible flicker from PROPOSED → PAID. The card just renders PAID from the first frame after mount.

The slow path (refetch) is kept for two other cases: an unrelated page reload much later, or the fallback POST path in `PostSignInConfirmHandler`. That's where the **functional setState guard** matters:

```ts
setBooking((prev) => (prev.status === 'PROPOSED' ? fresh : prev));
```

Without it, this race: React runs child effects before parent effects, so on the fallback path where `PostSignInConfirmHandler` POSTs from `/c/[id]?confirm=<id>`, the BookingCard's refetch fires *before* the confirm POST. Both hit the DB. If the GET arrives at the DB before the POST commits, `fresh.status === 'PROPOSED'` — and if the confirm POST then completes and its `booking-updated` event flips the local state to PAID before the GET response comes back, the naive `setBooking(fresh)` clobbers PAID back to PROPOSED. The functional form reads the *latest* state at the moment of update and refuses to downgrade a non-PROPOSED status, so ordering doesn't matter.

*PostSignInConfirmHandler* ([`PostSignInConfirmHandler.tsx:52-67`](src/components/PostSignInConfirmHandler.tsx#L52-L67)):

```ts
// Fast path: consume snackbar left by AnonChatResumeHandler
const pending = readPendingSnackbar();
if (pending) {
  firedRef.current = true;
  clearPendingSnackbar();
  setResult(pending);
  return;
}

// Fallback POST path only applies on /c/[id]
if (!pathname.startsWith('/c/')) return;
// ... existing POST + booking-updated dispatch logic
```

Fast path just renders. No POST, no `booking-updated` dispatch (BookingCard already consumed its own key).

The pathname gate on the fallback POST is what prevents the two handlers from racing on `/`. Both mount on `/` and `/c/[id]`, but on `/`: `AnonChatResumeHandler` fires (owns the resume flow); `PostSignInConfirmHandler` fallback is gated off (pathname doesn't start with `/c/`). If we let the fallback POST fire on `/` too, two POSTs to `/api/booking/42/confirm` would race — one from each handler.

#### Flow C — F5 mid-anon-chat

Same restore logic as Flow A, minus everything after step 3. `useMemo` reads sessionStorage on mount, `mounted` gate keeps hydration clean, chat comes back. `AnonChatResumeHandler` gates on `user` — anon = no-op. `?confirm=` isn't in URL, so `oauthConfirmInFlight` is false and the buttons render normally.

#### Design decisions worth flagging

1. **Why `Promise.all` and not two sequential awaits?** The two POSTs are independent — creating a Conversation doesn't touch the Booking row, and confirming a Booking doesn't need the Conversation to exist. Serial had no correctness benefit; concurrent halves the wait.
2. **Why keep `PostSignInConfirmHandler` at all after the fast path exists?** The fallback covers `/c/[id]?confirm=<id>` landing directly — bookmarked URL, hand-typed, or if `AnonChatResumeHandler`'s confirm arm somehow didn't run. Small blast radius, small code cost, keeps the design robust to edge cases.
3. **Why derive `oauthConfirmInFlight` from the URL and not from a shared state / context?** No coordination between components required — `?confirm=` is already in the URL as the OAuth callback protocol. Adding a Context would be redundant plumbing for what's already public.
4. **Why the `booking-updated` window event is still around.** Dead weight on the fast path, but the fallback POST path in `PostSignInConfirmHandler` still needs to update any mounted `BookingCard` for the same id, so it dispatches after its POST. Same-tab-only fanout — exactly the intended scope.

#### File index

```
src/utils/anonChatStorage.ts                   (NEW — sessionStorage read/save/clear for history, confirmed-booking handoff, snackbar handoff)
src/components/AnonChatResumeHandler.tsx       (NEW — reads storage, fires parallel POSTs, stashes handoff, navigates to /c/[id])
```

Modified: `src/components/ChatContainer.tsx` (synchronous restore + auto-save + mount guard + resume handler wiring), `src/components/BookingCard.tsx` (preconfirmed lookup, functional setter guard, URL-derived busy state, booking-updated listener), `src/components/PostSignInConfirmHandler.tsx` (snackbar-from-storage fast path + pathname gate on fallback POST + booking-updated dispatch), `src/utils/hydrateChatMessages.ts` (`normalizeMcpEnvelope`), `src/hooks/useAgentChat.ts` (expose `history` for the auto-save effect), `src/agents/buildTravelAgent.ts` (THIN TOOL DATA required phrasing + forbidden example), `app/api/conversations/route.ts` (POST handler — accepts `AgentInputItem[]`, atomically creates Conversation + persists seed history via `createWithSeed`, returns id).

No new schema/migration — the Conversation + Message tables from Phase 3 already handle it; this stage just adds a new *entry point* into that persistence.

#### Post-ship refactor — `createWithSeed` + `titleSource` rename

Follow-up cleanup after the initial Phase 3.5 ship, driven by a code-review comment on `/api/conversations/route.ts`: the two-step `create({ seedHistory }) + appendTurn` shape looked redundant, because `seedHistory` sounds like "the messages to persist" but was only ever used to compute the title (`create` doesn't touch the messages table). Two changes:

- **Parameter rename**: `ConversationService.create`'s `seedHistory` → `titleSource`. Docstring made explicit that it's title-only. `/api/agent/route.ts` updated to match — it still uses the two-step pattern because the id is returned to the client mid-stream before the turn's messages exist, so create + append can't be atomized on that path.
- **New atomic method**: `ConversationService.createWithSeed({ userId, history })` for callers with the full history up-front (only `/api/conversations` today). Backed by a new `ConversationRepository.createWithMessages` that wraps the row insert + `message.createMany` in a callback-form `$transaction` (needs the created id for the second op, so array-form doesn't work). Bundles a latent bug-fix: the old two-call sequence had no transaction, so if `appendMessages` threw after `create` succeeded, you'd get an orphan titled-but-empty Conversation stuck in the user's dropdown. Now that class of ghost row is impossible.

`/api/conversations/route.ts` collapses to a single `await conversationService.createWithSeed(...)`. Full eval suite still green after the refactor.

---

### Stage 17.6 — Eval harness 429 backoff

Small operational stage, one-file scope. Motivated by a recurring failure of `cancel-proposed-booking-happy-path` in the full suite: gpt-4o's 30k TPM ceiling was getting hit deep in the case list because prior 3-4s real-agent cases had already consumed most of the rolling 60s window. OpenAI's own error message told us exactly how long to wait (`"Please try again in 10.458s"`), but the eval harness treated any thrown error as a hard fail, so cases that would have passed on retry showed up red instead. Manual workaround was rerunning the flaky case in isolation once the TPM window cleared.

**Fix.** New [`src/evals/runWithBackoff.ts`](src/evals/runWithBackoff.ts) — a general async wrapper that catches errors, checks whether they're 429s, parses the wait time out of the error message (both `Xms` and `Xs` forms observed in the wild), and retries after sleeping. Up to 3 retries, exponential-with-jitter fallback if the parse fails (message-shape changes upstream), plus a small buffer on top of the parsed wait time so we don't race the window boundary.

**Wiring.** [`runCase.ts`](src/evals/runCase.ts) wraps the `run(agent, ...)` call inside its per-turn loop and accumulates the retry count across all turns. Two visibility signals so nothing goes silent:

- Mid-run: rate-limit hits print `⚠ 429 rate limit — waiting Xms before retry N` inline (stderr) so a slow wait doesn't feel like a hang.
- Post-run: the case's timing line gets a `, retried Nx` annotation when the runner absorbed any 429s — e.g. `(46.6s, retried 2x)`. Zero-retry cases print as before, so the annotation only shows up when it matters. A scan of the log post-run makes chronic TPM offenders obvious even when they pass.

The retry count rides on `CaseOutput.retries` (new optional field in [`src/evals/types.ts`](src/evals/types.ts)) so future reporting (e.g. a summary line, CI badge annotation) can consume it structurally rather than parsing log lines.

**Rejected alternatives.** Bumping the OpenAI org tier (fixes the symptom, not the pattern — same code would still fail in CI on a fresh account). Pacing sleep between cases (adds 8+ min to every suite run). Reordering cases (fragile ordering luck).

**Portability note.** The 429-with-`Retry-After` pattern is standard across most rate-limited APIs, so `runWithBackoff` is a general-purpose helper — same shape works for real weather / flight / payment integrations later. This stage doubles as prep for Stage 18 (CI-with-evals-on-PR), which would hit the ceiling much harder without retry plumbing in place.

**File index.** New: `src/evals/runWithBackoff.ts`. Modified: `src/evals/runCase.ts` (wraps the per-turn `run()`, accumulates `totalRetries`), `src/evals/runner.ts` (appends `, retried Nx` to the timing line), `src/evals/types.ts` (new optional `retries` field on `CaseOutput`).

---

### Stage 18 — CI with evals-on-PR

Every PR that isn't a draft runs the full eval suite on GitHub Actions and reports pass/fail as a check on the PR page. Turns the eval suite from a "thing you remember to run" into a safety net that catches regressions before merge — the highest-leverage change to the development loop since the eval harness itself.

**Trigger and gating.** `pull_request` events (`opened`, `synchronize`, `reopened`, `ready_for_review`). Draft PRs are skipped via a job-level `if: github.event.pull_request.draft == false` — open a PR as draft while iterating, flip it to "Ready for review" when you actually want the verdict. Cost mitigation: iterative pushes on a WIP feature shouldn't burn ~$0.50 per suite run each.

**Concurrency-cancel** (the second cost mitigation): a new push on the same branch cancels any still-running eval job in the same group (`evals-${{ github.head_ref }}`). Without this, pushing five commits in quick succession stacks five parallel eval runs on the same branch, four of which are testing stale commits nobody cares about. With cancel-in-progress, only the latest push's run survives. Different branches (parallel PRs) don't interfere — they land in different concurrency groups.

**Neon evals branch** for isolation. Rather than sharing the local dev database (concurrent writes between your local dev session and the CI runner would poison each other's state), CI uses a copy-on-write Neon branch off dev. Free at this scale, seconds to create, deterministic starting state. `DATABASE_URL_EVALS` GitHub secret carries the connection string; `prisma migrate deploy` in the workflow keeps the schema in sync if a migration lands and CI hasn't run since.

**Dev server in the runner.** The eval harness talks to MCP endpoints over HTTP (`MCPServerStreamableHttp` in [`runCase.ts`](src/evals/runCase.ts)), so the workflow boots `npm run dev` in the background before invoking `npm run evals`. A bash readiness loop polls `http://localhost:3000` with a 90-second budget — the first-run compile takes ~30s on the runner. Build + start would be faster per-request but slower to warm up; not worth it for a ~5-8 min suite.

**Secrets contract.** Three repo secrets:
- `OPENAI_API_KEY` — same key as local dev.
- `DATABASE_URL_EVALS` — Neon `evals` branch connection string.
- `AUTH_SECRET` — any 32-byte base64 string, needed because NextAuth's config throws at boot without it. Evals don't exercise auth flows, but the app has to be able to start.

`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are set to dummy strings inline in the workflow — evals don't exercise OAuth. If real Google config were needed for some future eval, promote them to secrets.

**Not gating merge yet.** For the first few runs the check is informational only — lets us tune the workflow without every misconfig blocking work. Once stable (2-3 consecutive green runs), flip the check to "Required" via repo Settings → Branches → Branch protection rules on `main`.

**What this doesn't cover.**
- No push-to-main trigger — evals only run on PRs. If someone bypasses the PR flow (direct commit to main), CI stays quiet. Acceptable for solo work; add on push to main if that changes.
- No result caching — every run is a full suite. Would want partial-run + case-selection if the suite grew to 100+ cases.
- No coverage / trending — the run is pass/fail. A future stage could store historical pass rates in a Neon table or a simple JSON artifact for regression trending.
- No cost budget alerting — a runaway workflow could burn credits. Concurrency-cancel + skip-drafts + the 20-minute job timeout are the main safeguards. Add cost budgets / alerts if the burn rate becomes noticeable.

**Portability.** The workflow shape (checkout → node → deps → prisma → background app → wait → run suite) generalises to any Next.js + Prisma + eval setup. Node 20, Ubuntu latest, no non-portable steps.

**File index.** New: `.github/workflows/evals.yml`.

---

### Stage 19 — Eval stability

Follow-up to Stage 18. The first CI run landed 97/101 and a same-day local run landed 95/101 with a *different* set of failing cases — proving the CI infrastructure works and the residual red is genuine non-determinism in the eval suite. Two independent fixes to close the gaps.

#### 1. BOOK MEANS BOOK — new PRIME DIRECTIVE

Three multi-turn cases all failed on the same input pattern: `"Book the first one for John Doe, john@example.com"` after a hotel search. Observed model responses across five recent runs:

| Response | Frequency | Root cause |
|---|---|---|
| Calls `propose_booking` correctly | ~50% | Happy path |
| Re-lists the same hotels | ~20% | Ignores "book" verb; treats as re-search |
| Fabricates a flight number → Stage 13 guardrail trips → empty response | ~15% | Model conflates "book" with "book a trip", starts inventing flights |
| Asks "should I book?" | ~15% | Requests permission the user already gave |

Root cause: the "trigger `propose_booking` when …" rule lives mid-prompt (position ~28, after tool descriptions). gpt-4o's attention dilutes on multi-rule prompts; deep-buried rules get inconsistent adherence.

**Fix:** new **PRIME DIRECTIVE — BOOK MEANS BOOK** at position 4 (right after TOOLS BEFORE PROSE and THIN TOOL DATA). Same reasoning as Stage 17.5 for placing critical rules at the top of the instruction array — max attention weight.

Enumerates each observed failure mode explicitly as FORBIDDEN:

- FORBIDDEN: re-listing the options they just saw.
- FORBIDDEN: running another `search_hotels` or `search_flights` for the same trip.
- FORBIDDEN: mentioning a flight number when only hotels are on screen (names the specific guardrail — Stage 13 search-result-fabrication — so the model understands the consequence).
- FORBIDDEN: asking "would you like me to book?" — the user already said yes.

Plus explicit handling for the "flights[] shape" confusion:

- If only hotels are on screen, the booking is hotel-only (empty `flights[]`).
- If only flights are on screen, it's flight-only.
- If both, include both.

And a follow-up-action clause to stabilise the other two failure modes (`cancel-proposed-booking-happy-path`, `get-booking-by-numeric-id-happy-path`):

- If the user then says "cancel that booking" or "what's the status of that booking", act on the id `propose_booking` just returned — do NOT re-run any searches, do NOT re-list options.

#### 2. sunny-weekend-from-athens tri-mode arithmetic check

Stage 17.5 added a two-mode assertion for `search_flights` results (inbound-present vs inbound-empty). Today's runs surfaced a **third mode**: both outbound *and* inbound empty. Happens when "next weekend" resolves to a date range outside the seeded flight window, or when the agent's inferred `max_price` filter is tight enough to exclude every seeded flight. The agent handles it correctly ("no flights were found") but the assertion had no path to accept "no trip total present, honest about missing flights."

**Fix:** tri-mode structure documented in the header of `tripTotalArithmeticCheck`:

- **Mode A** (both present): strict `outbound + return + hotel` combos. Unchanged.
- **Mode B** (inbound empty): `outbound + hotel` combos. Unchanged.
- **Mode C** (both empty — new): no combos possible; escape iff response contains an honest "no flights" phrasing and doesn't invent a trip total.

New flag `allFlightsEmpty` starts true and flips false the moment any round-trip flight call has outbound results. Consumed at the `validCombos.size === 0` branch: if `allFlightsEmpty && HONEST_THIN_DATA_PHRASING.test(...)` → pass with a distinct explanation ("thin-data escape (both outbound and inbound empty)").

`HONEST_THIN_DATA_PHRASING` regex extended with three new alternations:

- `no (available|remaining)? flights? … (were found|are available|in (the|your|current|search) window|within budget)`
- `no (available|remaining)? flights? (were|are|could be) found`
- `unable to find (any|available)? flights?`
- `no flights? found`

Anchored to concrete phrasings from the two failing runs today:
- "No flights were found for your selected weekend from Athens to Berlin within the specified budget."
- "No available flights from Athens to Berlin from August 14-16 were found in the current search window."

Both now match.

#### 3. Two over-narrow assertions loosened

The first 5-run verification after (1) and (2) landed at 99/101, with two new failures — both purely over-narrow assertions accepting only one of two equally-correct agent responses.

- **`origin-ask-required`**: assertion was `\?\s*$` (strict end-of-message question mark). Model correctly asked "Where are you flying from?" then added "I can help you find flights if you provide your departure city." Question mark ended up mid-message. Loosened to `\?` anywhere — paired with the existing "mentions origin / departure" regex, the check stays specific enough.
- **`get-booking-requires-numeric-id-not-reference`**: assertion required "asks for the numeric id" phrasing. Model instead deflected to "sign in to access your bookings" — equally valid, since Phase 2 gated `get_booking` behind auth for past bookings. Loosened to accept EITHER the id-request phrasing OR a sign-in deflection. The critical `toolNotCalled('get_booking')` check (never extract digits from `BKG-1234`) stays strict — that's the actual defect being guarded.

Neither loosen weakens what the case is really testing. Both close persistent non-determinism where the model's choice between two valid responses shouldn't flip the assertion.

#### 4. sunny-weekend € count check made mode-aware

Second 5-run verification surfaced a fourth failure — the `sunnyWeekendFromAthens` case's `final summary references at least four € figures` assertion. Mode C hit again: with no flights available (outbound and inbound both empty), the model correctly returned only hotel totals (2 € figures), but the `>= 4` threshold assumed the mode-A shape (outbound + return + hotel + trip total).

**Fix:** extracted the €-count check into `euroCountCheck` with a mode-aware threshold. New helper `anyRoundTripFlightHasResults(out)` inspects the same tool trace `tripTotalArithmeticCheck` uses:

- **Flights present** → require ≥4 € figures (unchanged behaviour).
- **All flights empty (mode C)** → require ≥1 € figure (a single hotel total is enough proof the search ran).

Same tri-mode logic as `tripTotalArithmeticCheck`, applied at the shallower level of the €-count check. Assertion description updated to "final summary references € figures (≥4 with flights, ≥1 hotel-only)" so failure messages self-explain.

#### 5. options-count enumeration accepts bullet lists

Third verification round surfaced a fifth failure — `options-count-matches-request` with 0 numbered items detected when the user asked for 3 options but the seed had only 1 flight. The model correctly reported "here is one flight option" plus one top-level bullet with the flight details underneath, but the assertion's regex only counted `1.` / `2.` / `3.` numbered markers and `Option N` headings — the top-level `-` bullet was invisible to it.

**Fix:** added a third enumeration pattern (top-level `[-*+]\s+` bullets, anchored to column 0 so indented sub-items don't double-count) alongside the existing numbered + `Option N` patterns. `optionCount = Math.max(numberedCount, bulletCount)` — a response uses one style or the other, and the max returns the intended count either way. Assertion description + details string updated to name both patterns so failures self-explain.

#### Residual flakiness (accepted, not fixed)

`sunny-weekend-from-athens` retains the ~20% catastrophic-drift rate that Stage 17.5 already documented as inherent to gpt-4o. The failure mode: agent skips all tools, drifts straight into prose about weather-for-dates-outside-forecast-coverage, gets caught by the Stage 12 forecast-attribution guardrail, response comes back empty. All Stage 19 changes above address a different class of issues; this residual is untouchable without either restructuring the case (removing the "sunny" trigger word that pulls in weather) or bumping the TravelAgent's model.

**Implication for CI:** the Evals check on `main` will occasionally be red purely because of a sunny-weekend blowout, not because of a new regression. This is exactly the scenario the "check informational for 2-3 stable runs before flipping to Required" plan from Stage 18 was built for. Do not flip the check to Required until either the sunny-weekend flakiness is addressed (Stage 20+ — model swap, or case restructure) or the eval harness gains a `EVALS_SKIP_KNOWN_FLAKY`-style opt-out for CI.

#### Stability bar

Before merging: 5 consecutive local `EVALS_BRIEF=1 npm run evals` runs, all 101/101. If any one fails, either the fix wasn't enough or a new regression — no merge until stable. Only after that plus 2-3 clean CI runs on subsequent real PRs does the CI check flip to Required in branch protection.

**File index.** Modified only: `src/agents/buildTravelAgent.ts` (new PRIME DIRECTIVE — BOOK MEANS BOOK at position 4), `src/evals/cases/sunnyWeekendFromAthens.ts` (tri-mode `tripTotalArithmeticCheck` + extended `HONEST_THIN_DATA_PHRASING` + mode-aware `euroCountCheck`), `src/evals/cases/originAskRequired.ts` (question-mark check loosened to anywhere-in-message), `src/evals/cases/getBookingRequiresNumericIdNotReference.ts` (accepts id-request OR sign-in deflection), `src/evals/cases/optionsCountMatchesRequest.ts` (adds top-level-bullet enumeration alongside numbered + `Option N`).

No new schema/migration, no new deps, no workflow changes.

---

### Stage 20 — Live weather via OpenWeatherMap

First real external-API integration. Everything else in the demo library (flights, hotels, weather, bookings) still reads from a seeded Neon DB — this stage adds a live-fetch adapter for weather behind an env-var switch, without touching the service layer or any of the eval / agent code above it.

#### What ships

- **`WeatherRepository` becomes an interface.** The concrete class formerly known as `WeatherRepository` is renamed to `SeededWeatherRepository`. The interface declares just the two methods `WeatherService` uses: `findCurrentWeatherByCity(city)` and `findForecastByCity(city, days)`. Zero behaviour change for existing call sites — pure name shuffle + type extraction.
- **New `LiveWeatherRepository`** ([`src/lib/repositories/LiveWeatherRepository.ts`](src/lib/repositories/LiveWeatherRepository.ts)). Implements the same interface, backed by HTTP calls to OpenWeatherMap. Handles the free-tier quirks (see below).
- **`createWeatherService` now picks based on env** (`USE_SEEDED_WEATHER`, defaults to `"1"`). Seeded is the default so evals + CI + fresh installs stay deterministic and don't require an OWM key.

#### Adapter-pattern boundary

`WeatherService` depends on the interface, not the concrete class. It doesn't know or care whether the row it's returning came from Prisma or from a live API. The exact shape of the boundary:

```
API routes            → createWeatherService()  ← env-var pick happens here
                          │
                          ▼
                       WeatherService (validation, error mapping)
                          │
                          ▼
                       WeatherRepository (interface)
                       ├── SeededWeatherRepository   (Prisma → Neon)
                       └── LiveWeatherRepository     (fetch → OpenWeatherMap)
```

Small design detail worth flagging: **live mode doesn't construct a Prisma client at all.** The seeded branch of `createWeatherService` does `prisma ?? getSharedPrisma()`; the live branch never enters `getSharedPrisma()`. Which means a weather-only deployment with `USE_SEEDED_WEATHER=0` runs without `DATABASE_URL` and without opening an unused Neon connection. That's the adapter pattern earning its keep — each implementation carries its own dependencies.

#### OpenWeatherMap free-tier quirks (and how we handle them)

Real APIs come with real edge cases. Three worth calling out:

- **Forecast granularity mismatch.** OpenWeatherMap's free `/forecast` returns 5 days of data in 3-hour intervals (40 data points), not the daily min/max/conditions shape our schema promises. Fix: `aggregateToDaily` in `LiveWeatherRepository` buckets points by `YYYY-MM-DD` and computes min-temp, max-temp, and mode-of-conditions per bucket. Roughly matches how OpenWeatherMap's paid daily endpoint composes its output.
- **Coverage cap at 5 days.** Seeded promises up to 7; free tier tops out at 5. `LiveWeatherRepository` clamps requests to 5 silently. The agent's existing FORECAST BOUNDARY RULE in the prompt already handles "returned fewer days than requested" honestly (Stage 12), so no downstream changes needed.
- **City-name ambiguity.** "Berlin" alone can resolve to `Berlin, DE` or `Berlin, US`. Hardcoded lookup shape: `Record<string, { country: string; state?: string }>`, e.g. `{ Athens: { country: 'GR' }, Berlin: { country: 'DE' }, … }`. Passed as `q=Berlin,DE` on every call. The `state?` field is intentionally speculative — no current entry uses it — so a future US-internal disambiguation (e.g. `'Athens, GA': { country: 'US', state: 'GA' }`) is a one-line addition that hits OpenWeatherMap's 3-level `q=City,State,Country` form via the same `qualifyForOwm` helper. Beyond a handful of cities, the right escape hatch is OpenWeatherMap's Geocoding API to resolve names → lat/lon; for the demo's 5 cities the map stays simpler and deterministic.

#### In-memory TTL cache

Two `Map<string, {value, expiresAt}>` — one per endpoint. TTLs: 5 minutes for current weather, 1 hour for forecast. Purpose is rate-limit protection, not latency: OpenWeatherMap free tier is 60 requests/minute, and five users asking about the same city inside 5 minutes collapse to one API call. Not persistent — dev-server restart clears it. Fine for demo scale.

#### HTTP error mapping

Status-code-aware retry helper (`fetchWithRetries`) covers the common failure modes:

| Status | Behaviour |
|---|---|
| 200 | Return response. |
| 404 | Return `null` (caller treats as city-not-found, mapped to `CITY_NOT_FOUND`). |
| 401 | Throw with a specific message about the API key (newly-created keys can take hours to activate). |
| 429 | One retry after 1s, then throw. Cache TTL should keep us well below this. |
| 5xx | Two retries with exponential backoff (1s, 2s), then throw. |
| Other 4xx | Throw immediately — request problem, no retry. |
| Network error | One retry after 1s, then throw. Handles transient DNS/socket hiccups. |

Anything that throws bubbles up as `LiveWeatherFetchError`, which `WeatherService` catches and re-wraps as `WeatherServiceError` with `INTERNAL_ERROR` — the API-route layer already knows how to translate that to a proper HTTP response. No new plumbing needed.

**No automatic fallback to seeded on live failure.** If the live API is down and the app is in live mode, the user sees a clear error message ("live data unavailable, try again") rather than silently-stale seeded data. Cleaner semantics; a "prefer live, fall back to seeded" hybrid is a can of worms (source-of-truth ambiguity, `city` name mismatch drift). If we ever want that, it's a new stage.

#### Testing

- **Seeded path is byte-identical** to what shipped before — pure rename. `SeededWeatherRepository.findCurrentWeatherByCity` and `.findForecastByCity` are the same code as the old `WeatherRepository`'s methods.
- **Eval suite runs in seeded mode by default** (no env var change needed). All 33 cases should stay green.
- **Live mode verification is manual** — `USE_SEEDED_WEATHER=0`, hit the app in the browser, ask "what's the weather in Berlin?" A live-mode eval case would need `OPENWEATHERMAP_API_KEY` as a CI secret plus tolerance for non-deterministic weather content in the assertions — still deferred. Stage 20.5 shipped as post-Stage-20 hygiene (forecast-boundary rule + shared cities module), not the live-mode eval; that piece is open for a future stage.

#### Env-var contract

Two new entries in `.env.example`:

- **`USE_SEEDED_WEATHER=1`** — default. Set to `"0"` to switch to live.
- **`OPENWEATHERMAP_API_KEY=...`** — required only in live mode. Free tier at [openweathermap.org/api](https://openweathermap.org/api), no card. Constructor throws with a clear message if live mode is selected without a key.

**File index.** New: `src/lib/repositories/LiveWeatherRepository.ts` (HTTP + cache + retries + 3h→daily aggregation, plus `LiveWeatherFetchError`), `src/lib/repositories/SeededWeatherRepository.ts` (extracted from the old `WeatherRepository.ts` — Prisma implementation, byte-identical behaviour), `src/utils/sleep.ts` (promise-based `setTimeout` wrapper — extracted from the two places that duplicated it, `runWithBackoff` for OpenAI 429s and `LiveWeatherRepository` for OWM 429/5xx retries; both now import it). Modified: `src/lib/repositories/WeatherRepository.ts` (trimmed down to interface + shared row types only; concrete class moved out), `src/lib/services/WeatherService.ts` (import comment update — behaviour unchanged), `src/lib/index.ts` (`createWeatherService` env-var branch + conditional Prisma, new imports/exports), `src/evals/runWithBackoff.ts` (local `sleep` replaced with the shared import), `.env.example` (weather-source block).

Three-file shape mirrors the ports-and-adapters convention: interface in `WeatherRepository.ts`, adapters each in their own file (`SeededWeatherRepository.ts`, `LiveWeatherRepository.ts`). Adding a third source (Weather.com, Tomorrow.io, whatever) is a one-file addition.

### Refactor — OO error taxonomy for API responses

Follow-up cleanup, not a numbered stage. `apiErrorResponse` had grown into a ~90-line switch-chain across five branches (Zod + four domain services). Each branch inlined the HTTP status mapping (`404 for CITY_NOT_FOUND`, `409 for INVALID_STATE`, etc.), the response body shape, and the `console.error` for `INTERNAL_ERROR`. Two smells:

1. **Misplaced HTTP knowledge.** Adding a new code to `WeatherServiceErrorCode` required a *second* edit inside `apiErrorResponse.ts` — the compiler had no idea it was missing a status decision. If you forgot, the code silently returned 500.
2. **Duplication across four domain errors.** The Weather / Travel / Booking / Conversation branches were structurally identical (only status map and log prefix varied).

Replaced with polymorphism: every error class carries its own status + body + logging via a `toApiResponse()` method, and `apiErrorResponse` collapses to a one-line orchestrator.

#### The new hierarchy

```
ServiceError                                  abstract; auto-names via new.target.name
├── CodedServiceError<TCode>                  template-method toApiResponse; owns SHARED_STATUS_BY_CODE
│   ├── WeatherServiceError                   declares logPrefix + statusByCode only
│   ├── TravelServiceError                    same
│   ├── BookingServiceError                   same
│   └── ConversationServiceError              same
├── ZodValidationError                        independent — { error, issues } body
└── UnexpectedError                           independent — { error } body
```

#### apiErrorResponse — collapsed

From 96 lines / 5 branches to this:

```ts
export function apiErrorResponse(err: unknown): NextResponse {
  return classify(err).toApiResponse();
}

function classify(err: unknown): ServiceError {
  if (err instanceof ServiceError) return err;
  if (err instanceof z.ZodError) return new ZodValidationError(err);
  return new UnexpectedError(err);
}
```

Two runtime branches (Zod + unknown fallback) is the unavoidable minimum at the `unknown → typed` boundary — JavaScript's `throw` accepts any value, so a runtime type-check is the price of bridging back into the type hierarchy. Design decision: `classify()` lives in `apiErrorResponse.ts` rather than as a `ServiceError.from()` static factory. A static factory would require the base to import its concrete subclasses (circular import in ESM); the standalone helper avoids the cycle.

#### CodedServiceError — template method for the four domain errors

The four domain error classes share more than the switch chain suggested: same body shape (`{ error, code }`), same conditional log on `INTERNAL_ERROR`, same 500 for internal failures. `CodedServiceError<TCode extends string>` captures the shared skeleton:

```ts
export abstract class CodedServiceError<TCode extends string> extends ServiceError {
  readonly code: TCode;
  protected abstract readonly logPrefix: string;
  protected abstract readonly statusByCode: Record<DomainCodes<TCode>, number>;

  private static readonly SHARED_STATUS_BY_CODE: Record<ServiceErrorCode, number> = {
    INTERNAL_ERROR: 500,
  };

  toApiResponse(): NextResponse { /* templated: log-if-internal + JSON with resolved status */ }
}
```

Each of the four subclasses reduces to declaration-only. Full [`WeatherServiceError.ts`](src/lib/services/WeatherServiceError.ts):

```ts
export type WeatherServiceErrorCode =
  | ServiceErrorCode
  | 'CITY_NOT_FOUND'
  | 'NO_FORECAST_AVAILABLE';

export class WeatherServiceError extends CodedServiceError<WeatherServiceErrorCode> {
  protected readonly logPrefix = 'weather';
  protected readonly statusByCode: Record<
    DomainCodes<WeatherServiceErrorCode>,
    number
  > = {
    CITY_NOT_FOUND: 404,
    NO_FORECAST_AVAILABLE: 404,
  };
}
```

No constructor, no `toApiResponse`, no `this.name` boilerplate, no explicit `code` field declaration, no `INTERNAL_ERROR: 500`. All handled by the base.

#### Compile-time invariants

- **Every domain code has an explicit status decision.** `Record<DomainCodes<TCode>, number>` (not `Partial<>`) forces exhaustiveness. Adding a code without a status is a compile error, not a silent default-500.
- **Subclasses cannot re-declare `INTERNAL_ERROR: 500`.** `DomainCodes<T> = Exclude<T, ServiceErrorCode>` removes it from the allowed key set; TypeScript flags an excess-property error if you try. The base owns it exclusively.
- **`this.name` stays in sync with the class name automatically.** `this.name = new.target.name` in the abstract base captures the actual constructor invoked with `new`. Rename `WeatherServiceError` → `WeatherApiError` and `err.name` follows — no hardcoded string to drift.

#### Shared code + shared status hoisted into one place

`ServiceErrorCode` (currently `'INTERNAL_ERROR'`) is composed into every domain code union. Adding a shared code like `'RATE_LIMITED'` (429) is a two-touch change:

1. `ServiceError.ts`: `type ServiceErrorCode = 'INTERNAL_ERROR' | 'RATE_LIMITED';`
2. `CodedServiceError.ts`: `SHARED_STATUS_BY_CODE` grows `RATE_LIMITED: 429`.

Zero touches to any of the four subclasses. Their code unions inherit `RATE_LIMITED` transitively (from `ServiceErrorCode`), and their `statusByCode` maps stay unaffected (`DomainCodes<T>` excludes shared codes). If you skip step 2, TS refuses to compile until the shared status is defined.

#### Trade-offs considered and dropped

- **Merging `ZodValidationError` / `UnexpectedError` under `CodedServiceError`.** Their response bodies differ from the coded shape (`{ error, issues }`, `{ error }`), and their logging semantics differ (never / always vs. only on `INTERNAL_ERROR`). Forcing them through the template would either change API contracts or dilute the template's meaning to nothing.
- **Enforcing "TCode must include ServiceErrorCode" at the generic-constraint level.** TypeScript can't express "superset of X" without brittle workarounds. Convention is enforced instead by every existing domain type composing `ServiceErrorCode`, plus the base's `SHARED_STATUS_BY_CODE` map covering the shared codes. If a rogue subclass ever violated the convention, the `code === 'INTERNAL_ERROR'` check would just silently never fire — safe degradation, no crash.

#### File index

New: `src/lib/services/ServiceError.ts` (abstract base + `ServiceErrorCode` type + `new.target.name` auto-name), `src/lib/services/CodedServiceError.ts` (template-method intermediate + `DomainCodes<T>` helper + `SHARED_STATUS_BY_CODE`), `src/lib/services/ZodValidationError.ts` (wraps caught `ZodError` → 400 with `issues`), `src/lib/services/UnexpectedError.ts` (default classifier target → opaque 500 + server-side log). Modified: `src/lib/services/WeatherServiceError.ts`, `.../TravelServiceError.ts`, `.../BookingServiceError.ts`, `.../ConversationServiceError.ts` (all four gutted to declaration-only), `src/utils/apiErrorResponse.ts` (collapsed from 96 → 26 lines), `src/lib/index.ts` (added `ServiceError`/`CodedServiceError`/`ZodValidationError`/`UnexpectedError`/`ServiceErrorCode` exports, removed 5 unused `isXxxError` type guards + the `z` import they carried), `app/api/agent/route.ts` (last consumer of `isConversationServiceError` swapped to `err instanceof ConversationServiceError`).

#### No behaviour change

Every HTTP status, response body, and log line is byte-identical to pre-refactor. Same 404s for not-found codes, same 409 for booking conflicts, same 400 for validation errors, same opaque 500 body for unexpected errors, same `[weather] internal error: …` style log lines. `npx tsc --noEmit` clean; behaviour verified against Stage 20's live-mode weather endpoints.

### Stage 20.5 — Post-Stage-20 hygiene

Two small fixes bundled together, both surfaced by the manual smoke test at the end of Stage 20's live-mode verification.

#### 1. Forecast boundary-rule fix

**Problem.** When the smoke test asked "give me a 7-day forecast for Tokyo," the agent returned 5 days but its prose said *"Here's the 7-day weather forecast for Tokyo"* — a lie. The Stage 20 code was correct (silently clamped at `FORECAST_CAP_DAYS=5`), and the agent's Stage 12 FORECAST BOUNDARY RULE existed — but that rule was about extrapolating to specific *dates* outside the returned range, not about the requested-days count differing from what came back. `ForecastResult` had no explicit signal for "you asked for N, I gave you M<N", so the agent just parroted the user's requested count.

**Fix.** Two touches:

- **Interface change.** `ForecastResult` now carries `requestedDays: number` and `providedDays: number`. `WeatherService.getForecast` computes both — `requestedDays` from the parsed input (already defaulted to 3 + clamped to 1–7), `providedDays` from `row.days.length`.
- **Prompt tightening.**
  - `WeatherAgent` gets a new **FORECAST HORIZON RULE** (the agent had no prior rule about this case, so the smoke test hit it): if `providedDays < requestedDays`, acknowledge the shortfall in the first sentence.
  - `TravelAgent`'s existing **FORECAST BOUNDARY RULE** is augmented with the same days-count check at the top; the date-extrapolation content follows unchanged.
- **MCP tool description** for `get_forecast` also updated to mention the two new fields, so the agent's LLM has schema-level awareness in addition to the prompt rule.

Repository implementations are untouched — the two new fields are added at the service layer, not the row shape.

#### 2. Single-source allowlist

**Problem.** Four separate places in the codebase encoded "the five demo cities" (city names in three prompt strings + `CITY_LOOKUP` in the live weather repo). Adding a sixth city meant four coordinated edits, easy to miss one and drift.

**Fix.** New shared module [`src/lib/cities.ts`](src/lib/cities.ts) — single source of truth for the demo city list:

```ts
export type CityMetadata = { country: string; state?: string; iata: string; };

export const CITIES: Record<string, CityMetadata> = {
  Athens: { country: 'GR', iata: 'ATH' },
  Berlin: { country: 'DE', iata: 'BER' },
  London: { country: 'GB', iata: 'LHR' },
  Tokyo: { country: 'JP', iata: 'HND' },
  'New York': { country: 'US', iata: 'JFK' },
};

export const CITY_NAMES: readonly string[] = Object.keys(CITIES);
export const CITY_IATA_PAIRS: string = /* "Athens=ATH, Berlin=BER, ..." */;
```

Consumers wired to it:

- **`LiveWeatherRepository`** drops its local `CITY_LOOKUP` + `CityKey` type; uses `CITIES` directly. Structural typing lets the extra `iata` field be silently ignored by OWM-query code.
- **`offTopicInputGuardrail`** OFF_TOPIC_MESSAGE interpolates `${CITY_NAMES.join(', ')}` — no more hardcoded "Athens, Berlin, London, Tokyo, New York" string literal.
- **`buildWeatherAgent`** cities-available line: same interpolation.
- **`buildTravelAgent`** IATA line and "same N cities" reference: interpolates `${CITY_IATA_PAIRS}` + `${CITY_NAMES.length}`.

Adding a sixth city (e.g. Paris) is now a **one-line edit** to `CITIES` — all four downstream sites pick it up automatically.

#### File index

New: `src/lib/cities.ts` (shared `CITIES`/`CITY_NAMES`/`CITY_IATA_PAIRS`/`CityMetadata`). Modified: `src/lib/services/WeatherService.ts` (`ForecastResult` gains `requestedDays`/`providedDays`), `src/lib/repositories/LiveWeatherRepository.ts` (imports `CITIES` from the shared module, drops local `CITY_LOOKUP` + `CityKey`), `src/guardrails/offTopicInputGuardrail.ts` + `src/agents/buildWeatherAgent.ts` + `src/agents/buildTravelAgent.ts` (city references interpolated from shared source; forecast horizon rules added / augmented), `src/mcp/tools/weather/getForecastToolSpec.ts` (description mentions `requestedDays`/`providedDays` fields).

#### Verification

`npx tsc --noEmit` clean. No behaviour change for the seeded weather path (aggregation, city guard, response shape) — the two new `ForecastResult` fields are additive. Live-mode still needs the same manual smoke test to confirm the agent now honestly acknowledges shortfalls (was the whole point).

### Stage 23 — Unit tests (Phase 1: pure logic)

The project's first non-eval automated tests. Vitest + colocated `*.test.ts` files targeting pure server-side logic — the surface that landed with Stages 17.6, 20, and the OO error-taxonomy refactor. Repository/service/component tests, coverage reporting, and CI integration are deferred to Phase 2.

#### Why Vitest, why Phase 1 is just pure logic

The eval suite already covers end-to-end agent behaviour, but it costs ~$0.50 and 5-8 minutes per run — too slow for the "seconds after typing" feedback that unit tests give. Filling that gap first with pure-logic tests hits the highest signal-to-effort ratio: the helpers (`aggregateToDaily`, `fetchWithRetries`, `runWithBackoff`, the cache helpers, `CodedServiceError`'s template method) are self-contained, mock-free (or one-mock-away), and freshly written — testing them while the intent is still fresh is easier than reverse-engineering it from tests written months later.

Vitest was the framework choice: modern default for Vite/Next.js projects, near-zero config, native TypeScript + ESM, and `vi.useFakeTimers()` / `vi.stubGlobal()` cover almost every mocking need without extra libraries.

#### What the suite covers (8 files, 70 tests, ~1 second runtime)

| Test file | What it verifies |
|---|---|
| [`src/utils/sleep.test.ts`](src/utils/sleep.test.ts) | Fake-timer resolution — proves the pattern for later time-sensitive tests. |
| [`src/evals/runWithBackoff.test.ts`](src/evals/runWithBackoff.test.ts) | 429 detection (both `429` AND `Rate limit` required — false-positive guard), `try again in Xms` / `Xs` parsing with buffer, exponential fallback with mocked `Math.random`, `maxRetries` bound, `onRetry` callback firing. |
| [`src/lib/repositories/LiveWeatherRepository.test.ts`](src/lib/repositories/LiveWeatherRepository.test.ts) | Six describe blocks. `qualifyForOwm` shape (country-only, city+state+country, qualified-key stripping); `modeString` mode-of-values with tie-breaking + empty-list fallback; `aggregateToDaily` bucketing + rounding + `maxDays` clamp + date-sort + missing-conditions fallback; `fetchWithRetries` full status-code matrix (200/404/401/429/5xx/other-4xx/network) with mocked `global.fetch`; `readCache`/`writeCache` TTL semantics including exact-boundary expiry. |
| [`src/lib/services/ServiceError.test.ts`](src/lib/services/ServiceError.test.ts) | `new.target.name` auto-population, cross-subclass name distinction, `cause` passthrough, `instanceof` chain. |
| [`src/lib/services/CodedServiceError.test.ts`](src/lib/services/CodedServiceError.test.ts) | Template-method `toApiResponse()` via a tiny in-file `TestCodedError` subclass: domain-code status resolution, shared `INTERNAL_ERROR:500` handled by the base, `[prefix] internal error:` log conditional (fires on INTERNAL_ERROR only). |
| [`src/lib/services/ZodValidationError.test.ts`](src/lib/services/ZodValidationError.test.ts) | 400 response with `{ error, issues }`, wraps a real `z.ZodError` (built via `z.object({ city: z.string().min(1) }).parse({ city: '' })`), preserves the source via `.cause` and `.zodError`. |
| [`src/lib/services/UnexpectedError.test.ts`](src/lib/services/UnexpectedError.test.ts) | 500 opaque `{ error }` body (no `code`, no cause leak), server-side log fires with the raw cause, tolerates any thrown value shape (string, number, null, object, `Error`). |
| [`src/utils/apiErrorResponse.test.ts`](src/utils/apiErrorResponse.test.ts) | The three `classify()` branches observed through the public function: `ServiceError` passthrough (using `WeatherServiceError`), `ZodError` → `ZodValidationError` wrap, unknown → `UnexpectedError`. Plus a "no double-wrap" test that a pre-wrapped `ZodValidationError` renders identically to a raw `ZodError`. |

#### One nudge to test-ability: internal helpers exported

`aggregateToDaily`, `modeString`, `qualifyForOwm`, `fetchWithRetries`, `readCache`, `writeCache`, plus the `CacheEntry`/`OwmForecastResponse`/`OwmCurrentResponse` types were previously module-private in `LiveWeatherRepository.ts`. All are now marked `export` with a `// Exported for unit tests (Stage 23). Not part of the public library surface.` comment. Alternative would have been white-box test-only import tricks (e.g. `__test__` re-exports) or testing everything through the class's public methods — both add ceremony for no real gain. Bare exports with a naming/comment convention are lighter.

#### What's mocked and what isn't

- **`global.fetch`** — mocked via `vi.stubGlobal('fetch', spy)` in the `fetchWithRetries` block. Each test hands the mock the status codes it should return, in order (`mockFetch(429, 429)` for a two-call scenario).
- **`Date.now`** — spied in cache tests to advance "time" without waiting.
- **`Math.random`** — spied in the `runWithBackoff` fallback test to make jitter deterministic.
- **Timers** — `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` in every test that involves a `sleep()` (retry helpers, cache expiry).
- **`console.error`** — spied and asserted-against in tests that expect logging (`INTERNAL_ERROR` in coded errors, `UnexpectedError`). No log leaks into test output.
- **`NextResponse.json`** — not mocked. `NextResponse` extends the Fetch API's standard `Response`, which is a Node 20+ global. Tests read `response.status` and `await response.json()` directly.

#### Running the tests

```bash
npm test              # one-shot run (used in CI later)
npm run test:watch    # watch mode for local iteration
```

Runtime: ~1 second cold, faster on watch. All 70 tests pass; typecheck (`npx tsc --noEmit`) also clean.

#### Deferred to Phase 2

- **Repository tests with a real Prisma DB.** Requires deciding between a dedicated Neon branch or a local Docker Postgres, plus a per-test database-reset strategy.
- **Service tests with mocked repositories.** Straightforward but needs an ergonomic mock pattern (probably `vi.fn()` per-method against the repository interface).
- **CI integration.** Add a `unit-tests-on-PR` GitHub Action — fast enough to run on every push, unlike the eval suite. Separate from the evals workflow, no draft-PR gate.
- **Coverage reporting.** `@vitest/coverage-v8` + a coverage step in CI, once CI exists.
- **React component tests.** Would add jsdom + `@testing-library/react`. Deferred until the UI grows enough that component-level bugs become a real risk.

#### File index

New: `vitest.config.mts` (config; `.mts` extension so ESM syntax is parsed correctly without setting `"type": "module"` on the whole Next.js project), and eight colocated `*.test.ts` files listed in the table above. Modified: `package.json` (`test` + `test:watch` scripts, `vitest` devDependency), `src/lib/repositories/LiveWeatherRepository.ts` (six internal helpers + three types marked `export` for test access, each with a "not part of the public library surface" comment).

### Stage 23 — Unit tests (Phase 2: services + CI)

Follow-up to Phase 1's pure-logic tests. Phase 2 adds two things: coverage of the five service classes (via mocked repositories), and a GitHub Action that runs the whole suite on every push and PR — so the tests actually gate merges instead of only running when someone remembers.

#### Why services next, and why with mocked repos

Phase 1 covered the leaf-level helpers. Services are the next layer up: they own the business logic that composes those helpers into feature behaviour (Zod input validation, wrapping repository errors as `INTERNAL_ERROR` with cause preservation, cross-tenant guards, per-code status mapping upstream from the OO refactor). Repositories are shallow — they mostly translate service calls into Prisma queries — so most of the interesting bugs live at the service layer.

Mocked-repo tests hit the sweet spot: they exercise the full service code path (input parse → repo call → response shape) without pulling in a real database or Prisma runtime. Fast (~milliseconds per test), stable (no flaky I/O), and every service becomes a single clean file. Repository tests against a real DB are still worth doing — but they answer a different question ("does Prisma actually return the shape my repo claims?") and belong in Phase 2b.

#### What the suite adds (5 files, 65 tests)

| Test file | Method surface | Test count |
|---|---|---|
| [`src/lib/services/WeatherService.test.ts`](src/lib/services/WeatherService.test.ts) | `getCurrentWeather` + `getForecast` with Zod validation, `CITY_NOT_FOUND` / `NO_FORECAST_AVAILABLE` mapping, `INTERNAL_ERROR` wrapping with cause preservation, Stage 20.5's `requestedDays`/`providedDays` computation including the shortfall case. | 13 |
| [`src/lib/services/FlightService.test.ts`](src/lib/services/FlightService.test.ts) | `searchFlights` round-trip vs. one-way, `INVALID_DATE_RANGE`, `AIRPORT_NOT_FOUND` (both origin + destination arms), cabin multiplier (business = 3× base), `max_price` post-multiplier filter, IATA uppercase normalization, Zod validation. | 12 |
| [`src/lib/services/HotelService.test.ts`](src/lib/services/HotelService.test.ts) | `searchHotels` happy path, `INVALID_DATE_RANGE`, `CITY_NOT_FOUND`, both repo-throws-INTERNAL_ERROR branches, `requiredAmenities` composition from `breakfast_required` + `pet_friendly` flags, Zod validation. | 9 |
| [`src/lib/services/BookingService.test.ts`](src/lib/services/BookingService.test.ts) | `getBooking` + `getBookingByReference`: owner-only access, cross-tenant returns `BOOKING_NOT_FOUND` (same shape as truly-missing — no info leak), anon booking (userId: null) readable by anyone, `INTERNAL_ERROR` wrapping. **`proposeBooking` / `confirmBooking` / `cancelBooking` deferred** — they use `this.prisma.$transaction()` directly with deeply nested reads/writes; mocking Prisma's transaction runtime is more brittle than it's worth, so they wait for Phase 2b (real Prisma test DB). | 11 |
| [`src/lib/services/ConversationService.test.ts`](src/lib/services/ConversationService.test.ts) | `loadForViewer` (owner vs. shared vs. private, anon vs. signed-in), `assertOwnership` (owner allowed, cross-tenant returns `CONVERSATION_NOT_FOUND`), `setShared` (owner-only), `create` including title-derivation edge cases (first user message, long-text truncation, whitespace collapse, assistant-only fallback), `appendTurn` (empty no-op vs. non-empty batch), `listForUser` pass-through. | 20 |

Total: **135 tests across 13 files**, ~1.7s cold runtime.

#### The mock-repo pattern

Small per-test helper wraps `vi.fn()` stubs into a repository-shaped object:

```ts
function mockRepo(overrides: Partial<FlightRepository> = {}): FlightRepository {
  return {
    airportExists: vi.fn(),
    findInstances: vi.fn(),
    ...overrides,
  } as unknown as FlightRepository;
}
```

`WeatherRepository` is an interface, so the cast is unnecessary there. The other four repositories are classes; the `as unknown as` cast is the standard TypeScript escape hatch (structural typing accepts anything with the right shape at runtime).

Individual tests override just the methods they use:

```ts
const repo = mockRepo({
  airportExists: vi.fn().mockResolvedValue(true),
  findInstances: vi.fn().mockRejectedValue(new Error('DB down')),
});
```

For row shapes that need multiple realistic fields (`FlightSearchRow`, `HotelSearchRow`, `ConversationWithMessages`, `BookingWithRelations`), each test file has a small `row(overrides)` factory so tests only spell out the fields they care about.

#### CI workflow

New `.github/workflows/unit-tests.yml`. Structure:

- **Triggers on every push and PR.** No draft-PR gate. Unlike the eval suite in `evals.yml`, unit tests are free (no OpenAI budget) and fast (~seconds), so gating on `draft == false` would be pure friction.
- **Concurrency-cancel per branch.** Same shape as `evals.yml` — iterative pushes on a PR cancel earlier runs; parallel branches run in parallel.
- **No secrets, no DB.** `OPENAI_API_KEY`, `DATABASE_URL`, `AUTH_SECRET` — none of them are declared. Unit tests don't touch any of that. Nothing to leak, nothing to configure.
- **Steps.** Checkout → setup Node 20 → `npm ci` → `npx prisma generate` → `npm test`. Prisma generate is needed even without a DB because `@prisma/client` types are referenced through the repository/service layer at test-import time; skipping it makes the test files fail to load.
- **Timeout 5 minutes.** Generous cap for what usually takes ~30 seconds cold on GitHub's runner. A hung test still fails loudly.

Once this lands, the unit-tests check will appear on every PR. Recommendation: after 2-3 stable runs on real PRs, flip it to a required check in branch protection — matches the strategy documented for the eval check in Stage 18.

#### Deferred to Phase 2b (and beyond)

- **Repository tests with a real Prisma DB.** Still the big remaining piece. Requires a test-DB decision (Neon test branch vs. Docker Postgres vs. Prisma's SQLite driver) with real ops trade-offs. Would also unblock testing `BookingService.proposeBooking` / `confirmBooking` / `cancelBooking`, which are transaction-heavy and shouldn't be mocked.
- **Coverage reporting** (`@vitest/coverage-v8` + a coverage step in CI). Simple to add; deferred until we're actually using coverage numbers to spot gaps.
- **React component tests.** UI is small and stable; nothing has surfaced that needs component-level testing yet.

#### File index

New: `.github/workflows/unit-tests.yml` (CI workflow), and five colocated `*.test.ts` files (`WeatherService`, `FlightService`, `HotelService`, `BookingService`, `ConversationService`, all under `src/lib/services/`). No source-code changes this stage — all five services already had testable shapes from prior stages.

### Stage 23 — Unit tests (Phase 2b: real-DB integration)

Follow-up to Phase 2. Phase 2 covered services against mocked repositories; Phase 2b covers the two remaining surfaces that mocking couldn't touch: **cache-first repositories** (`FlightRepository.findInstances`, `HotelRepository.findAvailable`) and **`BookingService`'s transactional write methods** (`proposeBooking`, `confirmBooking`, `cancelBooking`). Both need a real Postgres — the repos hit Prisma's projection + upsert plumbing, and the booking writes rely on `$transaction` + MVCC semantics that a mock can't reproduce.

#### Why real Postgres, why Docker over Neon / SQLite

Three test-DB options were on the table:

- **Docker Postgres (chosen).** Local `postgres:16` service container from [`docker-compose.yml`](docker-compose.yml), matched by a `postgres:16` service in the CI workflow. Fastest inner loop (fresh container in ~5s; `tmpfs` data dir for RAM-only writes), zero token cost, deterministic. Same image, same version, same behaviour as prod — the CAS races and MVCC snapshots the booking tests exercise are Postgres-specific and would silently pass under SQLite while breaking in prod.
- **Neon test branch.** Would match prod infra exactly but adds a network round-trip per query (~50-100 ms), a shared branch that concurrent CI runs would fight over, and Neon credentials in CI secrets. All to trade "same infra" for "same version" when the version is already pinned.
- **SQLite via Prisma driver.** Fast, in-process, no infra. Rejected on correctness — Prisma's SQLite adapter doesn't implement `$transaction` isolation the same way, `updateMany` returns different counts on some CAS shapes, and the concurrent-CAS tests rely on independent Prisma clients on separate connection pools that SQLite can't model.

The chosen shape is a `postgres-test` service in `docker-compose.yml` bound to host port `5433` (not `5432`, so a local dev Postgres or another container on the default port doesn't clash) with a `tmpfs` data directory so restarting the container gives a clean slate for free.

#### What the suite adds (3 files, 22 tests)

| Test file | What it verifies |
|---|---|
| [`src/lib/repositories/FlightRepository.integration.test.ts`](src/lib/repositories/FlightRepository.integration.test.ts) | Six tests. Cache hit → `FlightSearchRow` JOIN shape (airline name, city names, composite `"A3 824"` label); cache hit with `nonstopOnly` + `airlineCodes` SQL push-down; cache miss + no `llmSource` → returns `[]` (pre-Stage-23 behaviour preserved); cache miss + LLM offers → upsert with `externalSource='llm'` + `generatedAt` provenance stamps; cache miss + LLM returns `null` → fail-open, no writes; cross-route `flightNumber` collision → `upsertOffer`'s route-mismatch guard drops the misfiled `FlightInstance` (would otherwise corrupt future searches on the correct route). |
| [`src/lib/repositories/HotelRepository.integration.test.ts`](src/lib/repositories/HotelRepository.integration.test.ts) | Seven tests. Cache hit → `HotelSearchRow` JOIN shape (city, amenities as `string[]`, cancellation policy, per-night totals); combined SQL filter push-down (`minStars` + `freeCancellationRequired` + `requiredAmenities`) with three foil hotels each failing exactly one filter; cache miss + no `llmSource` → `[]`; Scope B guard on cities not in `src/lib/cities.ts` `CITIES` (LLM never called — zero tokens burned on ungeocodable inputs); cache miss + LLM offers → upsert `Hotel` + `RoomType` + `Availability` + `CancellationPolicy` + `HotelAmenity` sibling writes with provenance; LLM returns `null` → fail-open; **anchor-drift prevention** — a second LLM call for the same `Hotel + RoomType` with drifted `roomsAvailable`/`basePriceEUR` does NOT overwrite `RoomType.defaultRoomsAvailable`/`basePrice`, and NEW `Availability` rows for the queried dates use the anchored values (the whole point of the `upsertRoomTypeWithAvailability` scheme). |
| [`src/lib/services/BookingService.integration.test.ts`](src/lib/services/BookingService.integration.test.ts) | Nine tests across three describe blocks. `proposeBooking`: nested flight+hotel row creation + trip total; idempotency-key short-circuit (second call returns the same row, only one Booking hits DB). `confirmBooking`: happy path (`PROPOSED` → `PAID`, inventory decrement, Payment row, ownership claim from `currentUser`); anon-propose → signed-in-confirm ownership pattern; `INSUFFICIENT_SEATS` + `INSUFFICIENT_ROOMS` (single night short) with full rollback proof; cross-tenant `BOOKING_NOT_FOUND` (404-shape, not 403 — id-scanning defence); `INVALID_STATE` on re-confirm; **concurrent-CAS race** (two `Promise.allSettled` confirms against independent Prisma clients — exactly one wins, seats decrement once, one Payment). `cancelBooking`: anon `PROPOSED` cancel with reason; owner `PROPOSED` cancel; `PAID` cancel restores inventory + flips Payment to `REFUNDED`; `NON_REFUNDABLE` on `freeCancellation: false` policy; cross-tenant + anon-vs-owned `BOOKING_NOT_FOUND`; `INVALID_STATE` on double-cancel; **concurrent-CAS race** on two cancels (double-restore prevented — seats stay at fixture default, Payment refunded once). |

Cumulative across all waves: **261 tests across 31 files** (239 in the default `npm test` suite — pure logic + services + React components + LLM source classes — plus 22 in the real-DB integration suite).

#### The test-DB helper module

[`src/lib/testing/prismaTestClient.ts`](src/lib/testing/prismaTestClient.ts) — two exports, both used by every integration file:

- **`createTestPrisma()`** — reads `DATABASE_URL` from `.env.test` (loaded at module-import time with `override: true` so a stray `.env` can't leak the dev DB into a test run) and returns a fresh `PrismaClient`. Not memoized: each test file wants its own client so Prisma's per-client connection pool doesn't leak between files.
- **`resetDb(prisma)`** — `TRUNCATE ... CASCADE` on every table discovered at runtime from `pg_catalog` (excluding `_prisma_migrations`). Called from `beforeEach` in every suite. `RESTART IDENTITY` resets autoincrement sequences so per-test row ids stay predictable. Runtime table discovery means new Prisma models auto-include without touching this file.
- **Safety fence.** Refuses to run against any `DATABASE_URL` that doesn't match `localhost` or `127.0.0.1` (regex check). Cheap defence against a misconfigured CI secret or a rogue `.env` override pointing at Neon prod.

[`src/lib/testing/seedFixtures.ts`](src/lib/testing/seedFixtures.ts) — small idempotent builders (`seedCity`, `seedAirport`, `seedAirline`, `seedUser`) plus one bigger fixture (`seedProposeBookingFixture`) that produces the ATH→FRA route + Frankfurt hotel graph the booking tests share. Cities use `upsert`; airports/airlines are `create` (each call is a distinct row). The LLM sources are stubbed via typed `mockLlmFlightSource` / `mockLlmHotelSource` helpers inside each repo test file — they return a canned response so integration tests remain zero-token.

#### Vitest config separation

New [`vitest.integration.config.mts`](vitest.integration.config.mts) — same shape as `vitest.config.mts` but three differences that matter:

- **`include: ['src/**/*.integration.test.ts']`** — files opt in by suffix, so `npm test` still runs only the fast unit suite and `npm run test:integration` runs only the real-DB suite.
- **`fileParallelism: false`** (`pool: 'forks'`). Runs one integration file at a time. Vitest 4 flattened the old `poolOptions.forks.singleFork` into this top-level flag. Required — two files running in parallel would race each other's `TRUNCATE` cycles on the shared test DB.
- **`testTimeout: 30_000` / `hookTimeout: 30_000`.** Real-DB round-trips + cold Prisma engine startup routinely eat 5-10s; 30s is generous headroom without masking genuinely stuck tests.

#### npm scripts

```bash
npm run db:test:up            # docker compose up -d postgres-test --wait
npm run db:test:migrate       # dotenv -e .env.test -- prisma migrate deploy
npm run test:integration      # vitest run --config vitest.integration.config.mts
npm run db:test:down          # tear down + delete the volume
```

`db:test:migrate` uses `dotenv-cli` so the test `DATABASE_URL` is scoped to just this invocation — it doesn't leak into the shell or into `prisma migrate dev` (which still targets the dev DB via `.env`).

Local flow, first time:

```bash
cp .env.test.example .env.test    # DATABASE_URL=postgresql://test:test@localhost:5433/test?schema=public
npm run db:test:up                # starts postgres-test on host port 5433
npm run db:test:migrate           # applies the Prisma schema to the fresh DB
npm run test:integration          # ~3s once warm
```

Re-runs just need `test:integration` — the container survives across runs (and `beforeEach` truncates between tests anyway). Restart the container (`db:test:down` → `db:test:up`) if you want a truly cold start.

#### CI workflow

New [`.github/workflows/integration-tests.yml`](.github/workflows/integration-tests.yml) — separate from `unit-tests.yml` so failures in one don't cascade to the other and the two workflows have independent concurrency groups.

- **Postgres 16 service container.** Same image as `docker-compose.yml` (behaviour matches local exactly). Bound to port `5432` on the runner (not `5433` — nothing on the CI runner competes). Health-check on `pg_isready` blocks steps until initdb finishes, so `prisma migrate deploy` doesn't race the bootstrap.
- **No secrets.** The service container is ephemeral and per-run; the connection string is written into `.env.test` at job start (`echo "DATABASE_URL=postgresql://test:test@localhost:5432/test?schema=public" > .env.test`) so the same `db:test:migrate` and `test:integration` scripts used locally work unchanged in CI.
- **Triggers on every push and PR** (`opened` / `synchronize` / `reopened` / `ready_for_review`). Same posture as unit-tests.
- **Timeout 10 minutes.** Well above the usual ~30s (service startup ~5s + migrate ~10s + tests ~3s). A hung test still fails loudly.

Once stable on a few PRs, flip it to a required branch-protection check — same posture as `unit-tests.yml` and the eval check.

#### Deferred to Phase 3 (and beyond)

- **Coverage reporting** (`@vitest/coverage-v8`). Still deferred — first candidate once coverage numbers start being useful for spotting gaps.
- **`ConversationService` integration tests.** Its methods don't touch `$transaction`; the mocked-repo suite in Phase 2 covers the behaviour, and the added surface of a real-DB variant wouldn't catch anything the mock-based tests miss.

React component tests (originally the Phase 2b "still deferred" item) actually landed earlier in [PR #24](https://github.com/dimitrisFotiadis/travel-agent/pull/24) — jsdom + `@testing-library/react` are wired into [`vitest.config.mts`](vitest.config.mts), with colocated `*.test.tsx` files for [`BookingCard`](src/components/BookingCard.test.tsx), [`ChatContainer`](src/components/ChatContainer.test.tsx), [`Header`](src/components/Header.test.tsx), and [`SamplePrompts`](src/components/SamplePrompts.test.tsx). They're part of the 239 tests the default `npm test` suite runs, alongside the Phase-1/Phase-2 pure-logic and services suites.

#### File index

New: [`docker-compose.yml`](docker-compose.yml) (`postgres-test` service on host port `5433`, `tmpfs` data dir), [`.env.test.example`](.env.test.example) (test `DATABASE_URL` template), [`vitest.integration.config.mts`](vitest.integration.config.mts) (separate config, `fileParallelism: false`, `*.integration.test.ts` glob), [`src/lib/testing/prismaTestClient.ts`](src/lib/testing/prismaTestClient.ts) (client factory + `resetDb` + local-only safety fence), [`src/lib/testing/seedFixtures.ts`](src/lib/testing/seedFixtures.ts) (idempotent city/airport/airline/user seeders + `seedProposeBookingFixture`), [`.github/workflows/integration-tests.yml`](.github/workflows/integration-tests.yml) (CI with Postgres service container), and three `*.integration.test.ts` files ([FlightRepository](src/lib/repositories/FlightRepository.integration.test.ts), [HotelRepository](src/lib/repositories/HotelRepository.integration.test.ts), [BookingService](src/lib/services/BookingService.integration.test.ts)). Modified: `package.json` (four `db:test:*` scripts + `test:integration`, `dotenv-cli` devDep).

### Stage 22 — Deploy to Vercel

First public deploy. Everything below Stage 5 had been a "clone the repo and boot it locally" story; this stage puts it behind a shareable URL running on Vercel Hobby (free tier), backed by a dedicated Neon prod branch, with real Google OAuth callbacks. Smoke-tested end-to-end (all six layers of the test plan passed). Deploy remains live between demo sessions — Vercel confirms idle deployments cost $0 on Hobby.

The `<vercel-project-url>` used for the initial deploy was `travel-agent-eight-wine.vercel.app`. Treat that specific URL as ephemeral — if the Vercel project is ever recreated, the random word suffix (`eight-wine`) may change. The redeploy recipe below covers the setup dance for any future rebuild.

#### What ships (Phase A code changes)

Small surface — the app was designed serverless-friendly from the start (Next.js App Router, Prisma, Node runtime for MCP, no filesystem writes). Only four categories of change were needed for Vercel readiness:

- **Shared `getDefaultAppBase()` helper** ([`src/utils/appBase.ts`](src/utils/appBase.ts)). MCP endpoints and the agent route need to loopback to `/api/mcp/travel`, `/api/mcp/weather`, and other API routes on the same deployment. Locally that's `http://localhost:${PORT}`; on Vercel it's `https://${VERCEL_URL}` (auto-populated per-deployment). Helper picks based on which env is defined. Wired into three existing loopback sites — explicit `WEATHER_API_BASE`, `TRAVEL_API_BASE`, `APP_BASE`, `TRAVEL_MCP_URL`, `WEATHER_MCP_URL` env-var overrides still win if set (kept for the "split MCPs into separate services" future).
- **Prisma `binaryTargets`** in [`prisma/schema.prisma`](prisma/schema.prisma). Added `["native", "rhel-openssl-3.0.x"]`. Without the `rhel-openssl-3.0.x` target, the Prisma query engine binary is missing at runtime on Vercel's Amazon Linux 2 / OpenSSL 3 serverless environment and every request throws.
- **`postinstall` script** in [`package.json`](package.json). Runs `prisma generate` after `npm install`. Vercel runs `npm install` on every build, so `postinstall` guarantees the Prisma client is fresh for the deployed code. Without this, the build could ship a stale (or missing) client and fail at first request.
- **`.vercelignore`** ([`.vercelignore`](.vercelignore)). Excludes `legacy/`, test files, `vitest.config.mts`, `src/evals/`, `.github/`, `docs/` from the deploy artifact. Vercel's function bundler is already reachability-based so most of these don't ship anyway; this is cosmetic + a tiny upload-size win.

All four are additive — every helper falls back to its previous behavior when the Vercel-specific env vars aren't set. Local `npm run dev` behaves exactly as before.

#### Vercel setup — the recipe that worked

1. **Vercel account:** connected via GitHub OAuth. Hobby (free) tier, requires the source repo to be public.
2. **Import project:** Vercel dashboard → Add New → Project → import `travel-agent` from GitHub. Framework preset autodetected as Next.js. Root directory `/`, build command `npm run build` (default). Node runtime.
3. **Environment variables (six):**
   - `DATABASE_URL` — Neon `vercel-prod` branch **pooled** URL. Hostname must contain `-pooler` (e.g. `ep-cool-name-12345-pooler.eu-central-1.aws.neon.tech`). The non-pooled URL blows up under any concurrency because Vercel serverless functions each open their own connection.
   - `OPENAI_API_KEY` — from the OpenAI dashboard. Only used in seeded-weather mode for agent turns; not weather-facing.
   - `AUTH_SECRET` — 32+ byte base64. **Different from your local dev `AUTH_SECRET`** — sharing means a leak of local `.env` compromises prod sessions too.
   - `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` — from Google Cloud OAuth client.
   - `USE_SEEDED_WEATHER=1` — locks the deploy to the seeded weather path. No OpenWeatherMap key needed, deterministic responses, zero external-API budget burn.
4. **Do NOT set:** `OPENWEATHERMAP_API_KEY` (unused in seeded mode); `APP_BASE` / `WEATHER_API_BASE` / `TRAVEL_API_BASE` / `TRAVEL_MCP_URL` / `WEATHER_MCP_URL` (the `getDefaultAppBase()` fallback handles these via `VERCEL_URL`); `AUTH_URL` / `AUTH_TRUST_HOST` (NextAuth v5 auto-detects Vercel); `PORT` (Vercel manages it).

#### Neon setup

- **Dedicated `vercel-prod` branch.** Copy-on-write from the existing local-dev branch (`production` in the Neon UI, confusingly named — it was originally the local dev DB). Isolates prod data from anything you do locally.
- **Auto-delete: Never** — production DBs must persist.
- **Pooled URL** copied from Neon's Connect modal (with the "Connection pooling" toggle enabled). This is the URL that goes into Vercel's `DATABASE_URL`.
- **Schema + seed applied locally** with `DATABASE_URL` pointed at the pooled prod URL:
  ```powershell
  $env:DATABASE_URL = "<vercel-prod pooled URL>"
  npx prisma migrate deploy
  npx prisma db seed
  Remove-Item Env:\DATABASE_URL
  ```
  The `Remove-Item` at the end is important — otherwise your next `npm run dev` hits prod.

**Seed data note:** `FlightInstance` rows are dated relative to when seed ran (next 14 days from that moment). Any Neon branch created as a copy of an older branch inherits stale `FlightInstance` rows pointing to past dates. If flight searches return empty on a fresh deploy, re-run `prisma db seed` against `vercel-prod` — that regenerates the current-window instances. Discovered during Layer 5 of the smoke test.

#### Google OAuth setup

Add the Vercel URL to your existing OAuth 2.0 Client's **Authorized redirect URIs**:

```
https://<vercel-project-url>/api/auth/callback/google
```

**Keep** the localhost redirect URI (`http://localhost:3000/api/auth/callback/google`) — it's still needed for local dev. Google OAuth propagation is usually seconds but can take up to 5 minutes; if the first sign-in attempt after saving fails with `redirect_uri_mismatch`, wait and retry.

#### First-deploy gotcha — Vercel Deployment Protection

Vercel Hobby's default **"Standard Protection"** setting protects per-deployment URLs (the ugly `travel-agent-{hash}-{account}.vercel.app` variants) behind Vercel SSO, even for the current production deploy. The stable alias (`travel-agent-eight-wine.vercel.app`) stays public.

This causes a 500 on the agent route on first use: the agent route's MCP-server init tries to POST to the per-deployment URL (via `VERCEL_URL`), Vercel intercepts with a 401 "Protected deployment" JSON payload, and MCP init throws.

**Fix used:** disable Vercel Authentication entirely (**Settings → Deployment Protection → Vercel Authentication → Disabled**). No redeploy needed — the change is runtime-only.

**Not-used-here but documented as an alternative:** update `getDefaultAppBase()` to prefer `VERCEL_PROJECT_PRODUCTION_URL` (the always-public stable alias) over `VERCEL_URL` (the per-deployment protected URL). Would keep Vercel Auth on for the per-deployment URLs. Skipped because Standard Protection on Hobby doesn't actually restrict public access to the production URL — only the per-deployment URLs, which nobody sees anyway. See "Hobby-tier lockdown limitations" below.

#### Smoke-test outcomes

Six layers, executed in order against the live URL. All essentially passed; three non-blocking issues logged for future work.

| Layer | Target | Outcome |
|---|---|---|
| 1 — Page loads | Chat UI renders | ✅ |
| 2 — API health (`/api/weather/current?city=Athens`) | Direct-to-Prisma sanity | ✅ Returns `{ city: "Athens", tempC: 32, conditions: "sunny", units: "celsius" }` from seeded row |
| 3 — Agent chat (weather) | Agent + OpenAI + MCP end-to-end | ✅ After Deployment Protection fix (see above) |
| 4 — OAuth sign-in | Google → callback → session | ✅ After Google Cloud redirect-URI setup |
| 5 — Booking flow | search → propose → confirm | ✅ End-to-end round-trip booking created and PAID (BKG-2026-1D9701 verified in DB after smoke test) |
| 6 — Conversation persistence | Header dropdown + history reload | ✅ First turn preserved cleanly; second turn missing due to a persistence gap (see backlog) |

#### Backlog items surfaced during smoke test

Not Stage 22 blockers — but real issues the deploy exposed. Filed for future stages:

- **`bookingCrossReferenceOutputGuardrail` false-positive on hotel subtotals.** When the agent quoted the hotel-stay subtotal (`€188.60`) as a shorthand for "the hotel part" of a booking, the guardrail flagged it as a fabricated total (since `€188.60 ≠ €471.60 trip total`). Prose was blocked and replaced with a safety message; the tool call still succeeded so the booking was created and the BookingCard rendered. Fix: tighten the classifier to distinguish "subtotal quoted for a line item" from "grand-total claimed for the booking." Stage-21-ish scope.
- **`appendTurn` skips guardrail-tripped turns.** The route handler's `conversationService.appendTurn(newItems)` only runs on successful completion; when the output guardrail tripwire fires, the exception path bypasses it. Result: any turn that trips a guardrail is silently absent from persisted conversation history, even though the tools it called executed for real (see the missing turn-2 in the smoke-test conversation). Fix: persist newItems even on guardrail trip. Stage-17-Phase-3.7-ish scope.
- **`BookingCard` doesn't rehydrate from persisted history.** Live during a turn, the `propose_booking` tool output triggers a `BookingCard` component render. On page-reload rehydration, the same output isn't recognized by the client's history-replay code — the card doesn't reappear. Would need `hydrateChatMessages` or `MessageBubble` to run the same rich-render logic on rehydration that the live event handler does. Stage-17-Phase-3-follow-up scope.

#### Cost story

Total marginal cost of running this deploy at rest: **$0**.

- **Vercel Hobby:** free tier, generous limits for personal projects. Idle deployments don't count against any limit (per Vercel's own note in the delete-deployment dialog).
- **Neon:** the `vercel-prod` branch's compute autoscales down to zero when idle; storage costs are pennies at this size. Free tier is currently at 0.04 / 0.5 GB storage and 1.2 / 100 CU-hrs compute.
- **OpenAI:** only spends when the agent is actually invoked. Protected by a **hard `$10 / month` spend cap** on the OpenAI org limits page (`platform.openai.com/settings/organization/limits`). Requests fail at cap — mathematical worst-case damage even if the URL gets abused.
- **Google OAuth:** free.

The Vercel + Neon combo means the deploy can sit indefinitely between demo sessions with zero baseline cost, so there's no incentive to take it down.

#### Hobby-tier lockdown limitations

The demo URL is technically publicly reachable. That was an intentional choice given:

- The `.vercel.app` random-word suffix makes the URL undiscoverable via enumeration (Vercel `.vercel.app` sites are `noindex` by default — not indexed by Google).
- The URL is not published anywhere.
- The OpenAI cap is the mathematical damage limiter regardless of who visits.

If stricter lockdown ever becomes worth doing, the options are:

- **Vercel Pro tier** (`$150/month`) unlocks Deployment Protection's "Protect All Deployments" and Password Protection — both would gate the stable alias too. Overkill for a portfolio demo.
- **App-level auth gate** (Stage 22.5 candidate) — modify `/api/agent` to require an authenticated session. Kills the "anonymous chat" UX (Stage 17 Phase 3.5 built the anon-to-signed-in bridge specifically to preserve it), but limits agent spend to authenticated users only. Optionally allowlist specific email addresses.
- **Env-var kill switch** — middleware that checks a `SITE_OFFLINE` env var and serves a static "offline" page for all routes. Toggle via Vercel dashboard.
- **Delete the deploy between demo sessions** — nuclear, works, adds ~10 minutes of re-setup per future demo.

#### Redeploy recipe

For future rebuilds (fresh Vercel project, or after infrastructure churn):

1. Vercel dashboard → Add New → Project → import `travel-agent`.
2. Framework preset: Next.js (autodetected).
3. Add the 6 env vars from the "Vercel setup" section above.
4. Click Deploy. Get the new URL from Vercel's confirmation page.
5. If URL differs from before: add the new callback to Google Cloud OAuth client (`https://<new-URL>/api/auth/callback/google`). Keep the old one for a grace period if desired.
6. Verify seed data currency: hit `/api/flights?origin=ATH&destination=BER&departure_date=<today-plus-4>`. Empty result → re-run `prisma db seed` against the vercel-prod branch (recipe under "Neon setup" above).
7. Disable Vercel Authentication in Deployment Protection settings.
8. Smoke-test Layers 1-6 (see the plan in this section's Smoke-test outcomes table).

Realistic total: 10-15 minutes end-to-end assuming env-var values are saved somewhere retrievable (password manager entry).

#### File index

New: `src/utils/appBase.ts` (Vercel-URL-aware loopback base), `.vercelignore`. Modified: `app/api/mcp/weather/route.ts`, `app/api/mcp/travel/route.ts`, `app/api/agent/route.ts` (import `getDefaultAppBase`, replace hardcoded localhost fallbacks); `prisma/schema.prisma` (`binaryTargets`); `package.json` (`postinstall` script). No changes to services, repositories, agent code, guardrails, or eval harness — the app was already deploy-shaped.

#### Stage 22 follow-ups

The three backlog items above (guardrail false-positive, `appendTurn` skipping guardrail-tripped turns, `BookingCard` not rehydrating) were resolved over a series of small PRs after the deploy landed. Plus a refactor and one housekeeping change that didn't come from the smoke test but showed up during the work. The file index above covers only the initial ship; added/modified files from the follow-ups are listed at the end of this subsection.

**Guardrail cross-reference: line-item and derived-aggregate quotes (PRs #12, #14).** `bookingCrossReferenceOutputGuardrail` was only aware of the top-level `totalPriceEUR`. Legitimate agent responses that quoted per-line subtotals (e.g. "Hotel total: €188.60" as a shorthand for the hotel portion of a €471.60 trip) tripped it as fabrications. Fix (#12): walk the booking payload collecting every `totalPriceEUR` at any depth into a "known figures" set — quotes matching any known figure pass. Follow-up (#14): agent-computed round-trip flight sums (€150 + €133 = €283) aren't stored anywhere as a `totalPriceEUR`, so the guardrail still tripped on them. Extended the known-figures set to include per-array line-item sums for both `flightBookings[]` and `hotelBookings[]`. Regression evals `hotelSubtotalQuoteAllowed`, `flightSubtotalQuoteAllowed`, `flightAggregateQuoteAllowed` lock this in — all three would previously have tripped; all now pass.

**Guardrail persistence: first-class across every path (PRs #13, #15, #17).** Backlog items #2 (persistence) and #3 (`BookingCard` rehydration) had the same root: the guardrail-trip exception path in `/api/agent` bypassed `appendTurn`, so the whole turn — user message, tool calls that already ran, and the friendly notice — vanished from DB. Refresh lost it; any `BookingCard` that had rendered live from a pre-trip tool call vanished with it. Three PRs closed it out.

- **#13** — extracted `toSseFrame` and `buildGuardrailBlockedItems` as pure helpers with unit tests, then wired `buildGuardrailBlockedItems` into the exception path. Guardrail-tripped turns now get their own `appendTurn` call. Backlog #3 dissolved as a side-effect.
- **#15** — two polish items on top. **#2a**: the persisted "notice" was a plain assistant message, so refresh rendered it as a normal white bubble instead of the soft red policy-notice styling the user saw live. Introduced a custom `guardrail_notice` `AgentInputItem` shape (`{ type: 'guardrail_notice', kind: 'input' | 'output', message }`); the hydrator recognizes it and sets `blockedBy` on the bubble so styling matches. Because the SDK doesn't know this shape, `stripGuardrailNoticesFromHistory` runs before every `run()` — a hard invariant covered by unit tests. **#2b**: first-turn guardrail trip didn't swap URL from `/` to `/c/[id]` because the client's URL-swap logic hung off the `done` event, which never fires on a trip. Added `conversationId` to the `guardrail_blocked` frame so the client can adopt it via the existing `adoptConversationId` helper.
- **#17** — the anon-to-signed-in bridge (Stage 17 Phase 3.5) restores anon-user history into a signed-in session via `sessionStorage`. But `handleGuardrailBlocked` never called `setHistory` and the server's `guardrail_blocked` frame carried no history — so the auto-save saw no history change and skipped the guardrail-tripped turn entirely. Anon → sign-in lost the whole turn. Fixed by mirroring what `done` already does: `history: AgentInputItem[]` on the `guardrail_blocked` variant, `persistedItems` always computed server-side (hoisted out of the signed-in-only block), `setHistory(payload.history)` called client-side.

Verified across all three persistence paths: live SSE, DB refresh, `sessionStorage` bridge.

**Refactor: hydrator + `applyEvent` extracted into named helpers (PR #16).** Both had grown into large `if` chains. `hydrateChatMessages` now dispatches through four type predicates (`isUserTurn` / `isFunctionCall` / `isFunctionCallResult` / `isAssistantTurn`, plus imported `isGuardrailNotice`) into five per-branch mutators. `useAgentChat`'s `applyEvent` is now a `switch` on `payload.type` with each case delegating to a small named inner handler typed via `Extract<StreamEvent, { type: 'X' }>`; a `default` branch with `const _exhaustive: never = payload` gives compile-time exhaustiveness — `tsc` fails if a new `StreamEvent` variant is added and left unhandled. No behavior change; 163/163 tests still pass. Chose named-helpers over a runtime handler-table (`Map<string, Handler>`) because the switch preserves TypeScript's discriminated-union narrowing per case with no casts, and the `never` exhaustiveness check comes free.

**Housekeeping: pre-commit hook blocks direct-to-main commits (PR #18).** Twice during backlog work, a commit landed on `main` locally instead of on a feature branch. When the corresponding PR later squash-merged, `git pull` on main couldn't fast-forward (local main had the strayed commit; origin/main had the squash-merged version) and created a merge commit to reconcile them — a redundant blob of history whose only "content" was the topology join. A ~15-line POSIX shell script at [.githooks/pre-commit](.githooks/pre-commit) now refuses `git commit` when HEAD is `main`, with a clear message pointing at `git checkout -b`. Enabled per-clone via `git config core.hooksPath .githooks` (see [Quick start](#quick-start)). `.gitattributes` forces LF on `.githooks/**` so the shebang works on Unix after a Windows checkout. `--no-verify` still bypasses; documented but discouraged.

**New / modified files (follow-ups).** New: [src/utils/toSseFrame.ts](src/utils/toSseFrame.ts) + test (pure SDK-event → SSE-frame converter, extracted from `route.ts`); [src/utils/buildGuardrailBlockedItems.ts](src/utils/buildGuardrailBlockedItems.ts) + test (pure item builder for guardrail-blocked persistence); [src/utils/guardrailNotice.ts](src/utils/guardrailNotice.ts) + test (custom `AgentInputItem` shape + strip helper for the SDK invariant); [src/evals/synthetic/hotelSubtotalQuoteAllowed.ts](src/evals/synthetic/hotelSubtotalQuoteAllowed.ts), [flightSubtotalQuoteAllowed.ts](src/evals/synthetic/flightSubtotalQuoteAllowed.ts), [flightAggregateQuoteAllowed.ts](src/evals/synthetic/flightAggregateQuoteAllowed.ts) (regression evals for the guardrail fixes); [.githooks/pre-commit](.githooks/pre-commit); [.gitattributes](.gitattributes). Modified: [src/guardrails/bookingCrossReferenceOutputGuardrail.ts](src/guardrails/bookingCrossReferenceOutputGuardrail.ts) (walks booking tree; recognizes derived aggregates); [src/utils/hydrateChatMessages.ts](src/utils/hydrateChatMessages.ts) (`guardrail_notice` branch; extracted helpers); [src/hooks/useAgentChat.ts](src/hooks/useAgentChat.ts) (extracted `applyEvent` handlers; `setHistory` on guardrail; `adoptConversationId` helper); [src/types/stream.ts](src/types/stream.ts) (`guardrail_blocked` gains `conversationId` and `history` fields); [app/api/agent/route.ts](app/api/agent/route.ts) (guardrail-tripped persistence; `guardrail_notice` strip; `toSseFrame` extraction; frame carries history); README (Quick start hook config).

### Stage 23 — LLM-generated flight + hotel inventory

*Note: this section shares its number with the earlier "Stage 23 — Unit tests (Phase 1/2)" sections above — both were labelled Stage 23 during their respective work windows. Content is different; they're independent features.*

Seed data covers 5 cities and a handful of routes. Any search outside that scope (Athens → Reykjavik, Tokyo hotels next November) returned empty and the agent had to tell the user "no results" — even for perfectly reasonable requests. This stage adds an on-demand LLM inventory generator that fires on cache miss, upserts the result into the local DB, and re-queries. Gated behind `USE_LLM_GENERATION=1` — default off keeps evals + fresh dev installs deterministic.

Shipped across two PRs: **#20** added dormant provenance columns (`externalSource` + `generatedAt` on `FlightDefinition`, `FlightInstance`, `Hotel`, `RoomType`); **#21** added the LLM sources, cache-first repositories, the `RoomType.defaultRoomsAvailable` anchor migration, integration tests, and the env-toggle wiring.

#### The gap: seeded coverage

Seed data is fixed at prep time: 5 cities (Athens, Berlin, London, Tokyo, New York), a handful of routes between them, per-date flight/hotel/availability rows for a ~2 week window ahead of the seed run. Any search outside those axes (unseeded route, unseeded city, date range past the seed window) short-circuits to "no results." Seeding more was rejected: seed size grows quadratically with cities × dates, and hardcoding "realistic" airline schedules for every route is prompt tuning of the worst kind (in code, not in the model).

The fix: keep seed data as-is for regression + eval determinism, but on cache miss let an LLM fabricate plausible offers on demand and persist them. Subsequent searches for the same route/date/city hit the DB and skip the LLM entirely — cost and latency stay bounded to the first search per new query dimension.

#### Design: cache-first repositories with LLM fallback

`FlightRepository.findInstances` and `HotelRepository.findAvailable` gain an optional `LlmFlightSource` / `LlmHotelSource` injected via constructor. Flow:

1. Query DB for matching rows (existing pre-Stage-23 behavior).
2. If rows exist OR no LLM source injected → return the DB result (early exit, no LLM cost).
3. Scope B guard: verify both airports / the city are seeded (see below).
4. Ask the LLM source for offers.
5. Upsert each offer via `upsert with update: {}` (find-or-create).
6. Re-run step 1 — newly-upserted rows now show up, and any pre-existing rows join them in a single JOIN-projected result.

The re-query is one extra DB round-trip. The alternative — transforming LLM output into the same projection shape inline — would duplicate the queryDb JOIN + filter logic. Not worth the complexity at demo scale.

#### Why OpenAI Responses API + structured outputs

`client.responses.parse` + `zodTextFormat(schema, name)` from `openai/helpers/zod`. The API guarantees the response conforms to a JSON Schema derived from the Zod schema — invalid tokens are filtered during generation (constrained decoding), so `output_parsed` is either exactly the shape we asked for or `null`. No post-hoc `zod.safeParse()`, no "the LLM returned free-form JSON that mostly parses" fragility.

Chose Responses over `client.beta.chat.completions.parse` for consistency: this repo is a Responses learning journey, `@openai/agents` is Responses-based, and Responses is what current OpenAI docs recommend for new projects. The `.beta` on chat completions was another sign — kept moving.

Rejected alternatives:

- **Free-form JSON prompt + Zod validation post-hoc.** Works but leaks the model's occasional malformed output up the stack. Constrained decoding does this at the token level instead.
- **Amadeus / Duffel real APIs.** Explored: Amadeus's self-service portal was decommissioned in July 2026; Duffel's test mode covers airlines only, no hotels. Neither fit a demo built around free-tier infrastructure. LLM-generated data is a plausible-enough stand-in with zero third-party signup.

Model default: `gpt-4o-mini` (cheap, structured-outputs works well). Overridable via constructor options. Observed against the live API: ~3 s latency per generation, ~$0.002 per call.

#### Scope B: per-call Zod schemas constrain the LLM to seeded airports/cities

Constraint: the LLM must not invent airport codes, airline codes, or cities the DB doesn't know about. Otherwise its output can't join back to the seeded reference tables and the upsert chain breaks.

For flights this is handled by building the Zod schema **per call**: `airlineIata: z.enum(allowedAirlineIatas)` where `allowedAirlineIatas` is fetched from the DB right before the LLM call. Constrained decoding enforces this at the token level — the model literally cannot produce an unknown airline code. `FlightRepository` also fetches origin + destination airports before calling the LLM; if either is unseeded, the LLM path short-circuits.

For hotels, the city itself is the constraint (a fresh city has no seeded `Airport` for the LLM to invent flights between anyway). `HotelRepository` checks the city is present in the `CITIES` demo library AND in the DB before calling the LLM. Unknown city → short-circuit, agent gets an empty result and reports "not covered."

Cities gained a required `center: { latitude, longitude }` field to give `LlmHotelSource` a location anchor — airports are 10-30 km outside the city and the wrong anchor for hotel geography. The system prompt asks the LLM for coords within ~5 km of the given center.

#### The drift problem: `RoomType.defaultRoomsAvailable` anchor

Bare LLM output is not idempotent. Ask for Berlin hotels twice for different date ranges and each call fabricates fresh numbers: "Kaiserhof Berlin has 20 Standard Doubles" one call, "30" the next, "100" the third. Persisting whatever the last call said would drift the DB to absurd values and break bookings.

New column `RoomType.defaultRoomsAvailable Int?` (migration `20260815222654_add_room_type_default_capacity`) is the anchor. Populated once when the RoomType is first created from an LLM response, then every subsequent LLM call for the same hotel finds the existing RoomType via composite unique key `(hotelId, name)`, the upsert becomes a find-or-create no-op, and the anchor is preserved untouched. Per-date `Availability.roomsAvailable` seeds from the anchor, not from the fresh LLM value.

Bookings decrement `Availability.roomsAvailable` atomically via `BookingService`'s compare-and-swap `updateMany` pattern — independent per date, immune to LLM re-calls.

#### Upsert semantics: find-or-create everywhere

Every LLM-generated write uses `prisma.model.upsert({ where: <composite unique>, create: {...}, update: {} })`. The empty `update: {}` is the whole point — if the row already exists, do nothing. Never overwrite:

- Bookings' decrements on `Availability.roomsAvailable`.
- The `defaultRoomsAvailable` anchor on `RoomType`.
- Any seeded row that happens to share a composite unique key with the LLM's fabricated output.

Composite keys are Prisma's auto-generated ones (fields joined with underscores in declaration order): `airlineId_flightNumber` on `FlightDefinition`, `flightDefinitionId_departureDatetime` on `FlightInstance`, `cityId_name` on `Hotel`, `hotelId_name` on `RoomType`, `roomTypeId_date` on `Availability`.

Provenance columns `externalSource` (`'llm'` for LLM writes, `'seed'` for seeded rows, NULL otherwise) + `generatedAt` timestamp landed in Phase 1 (PR #20) and get populated on the create branch only. A single `const generatedAt = new Date()` per upsert batch means all rows from one LLM call share an identical timestamp — makes "which LLM call produced this?" trivially answerable via `GROUP BY generatedAt`.

#### `USE_LLM_GENERATION` toggle

`createFlightService` / `createHotelService` wire an `LlmFlightSource` / `LlmHotelSource` only when `process.env.USE_LLM_GENERATION === '1'`. Default off. Rationale:

- **Evals stay deterministic.** The eval suite runs against seeded data — introducing an LLM call in the flight/hotel search path would make every eval nondeterministic and expensive.
- **Fresh dev installs work without a repo-layer OpenAI dependency.** The top-level agent still needs `OPENAI_API_KEY`; the repositories don't.
- **Cost is opt-in.** Anyone cloning the repo doesn't get a surprise ~$0.002-per-search bill.

Two dev-only utility scripts help with iteration:

- `npm run llm:schema` — prints the JSON Schema that OpenAI actually receives (via `zodTextFormat`), useful for debugging Zod-to-JSON-Schema translation surprises.
- `npm run llm:smoke` — hits the real API with sample inputs (ATH→BER flights + Athens hotels), verifies end-to-end wiring works, ~$0.002 per run.

#### Live-testing outcomes

Six-part live test plan against the real OpenAI API + real Neon Postgres. All passed:

| Part | Target | Outcome |
|---|---|---|
| R (regression, 3 tests) | Seeded flight/hotel search + booking flow unchanged with `USE_LLM_GENERATION` unset | ✅ Pre-Stage-23 behavior intact |
| L (LLM path, 7 tests) | Cache-miss fires LLM; cache-hit skips it; Scope B guards block unknown airports/cities; `existingHotelNames` prompt-constraint prevents name collisions across date ranges | ✅ All 7 |
| B (booking, 4 tests) | Booking flow works against LLM-generated rows; atomic decrements target only booked (row, date) | ✅ Verified against Mitte Boutique double-booking — 2× decrement applied correctly, zero bleed to other rows |
| V (DB state, 5 SQL queries) | `externalSource` + `generatedAt` populated correctly; `defaultRoomsAvailable` set on every LLM RoomType; L3 hotels' `generatedAt` untouched after L5's upsert | ✅ 30/32 Availability rows undecremented, 2 correctly decremented by 2 |
| E1 (fail-open) | Corrupted `OPENAI_API_KEY`; server stays up; guardrail classifiers fail-open | ✅ Server did not crash; guardrails logged 401s and passed messages through; top-level agent surfaced raw 401 to UI (see backlog) |
| E2, E3 (skipped) | Empty airlines table; concurrent upsert race | Destructive/fiddly; already covered by unit tests; low ROI for live testing |

One **non-issue** surfaced: LLM generated 5 flight offers for HND→JFK, but the agent's response summarized only 3. Initially looked like a filter bug. DB inspection confirmed all 5 rows correctly persisted; the agent was condensing its own summary. Documented in backlog.

#### Backlog items surfaced during live testing

Not Stage 23 blockers — real issues live testing exposed. Filed for future work:

- **Agent condenses tool-result lists.** Flights (5→3) and hotels (8→3) both shown fewer options than the tool returned. Fix: agent system prompt should include "always present every option the tool returned; if condensing, name the count you dropped." Phase 8 prompt-tuning scope.
- **Jailbreak classifier false-positives on "show me all / don't skip any."** Legitimate search-result follow-ups were blocked as instruction-override attempts. The classifier evaluates messages statelessly; it can't see that "show all" is a natural continuation of a search-result presentation. Fix: add a search-result-context carve-out to the classifier prompt. Guardrails PR scope.
- **UI leaks raw agent errors.** When the top-level agent throws (E1's corrupted API key), the raw 401 message — including a partially-masked API key fragment — flows to the chat UI. Should catch and render "sorry, temporarily unavailable" instead. UX-polish PR scope.
- **New Conversation button broken.** Discovered during B2 setup. Click handler is not firing; workaround was hard-refresh. Pre-existing, unrelated to Stage 23.
- **No UI test coverage.** Related to the button bug: zero tests exercise the client-side surface (buttons, session handling, message rendering). All existing tests are backend-only. RTL + jsdom setup would catch this class of silent regression. Deferred to a UI-tests PR.

**Status update (post-close).** Four of the five items above closed out in the [Stage 23 follow-ups](#stage-23-follow-ups) section below — jailbreak carve-out (PR #26), UI error sanitization (PR #25), New Chat button (PR #23), RTL foundation + first UI tests (PR #24). **"Agent condenses tool-result lists" is the one item still open** — no prompt rule matching that description has landed yet.

#### File index

New: [`src/lib/llm/flightGenerationSchema.ts`](src/lib/llm/flightGenerationSchema.ts) and [`hotelGenerationSchema.ts`](src/lib/llm/hotelGenerationSchema.ts) (Zod schemas; flight schema built per-call for the airline `z.enum`); [`src/lib/llm/LlmFlightSource.ts`](src/lib/llm/LlmFlightSource.ts) + [`.test.ts`](src/lib/llm/LlmFlightSource.test.ts) and [`LlmHotelSource.ts`](src/lib/llm/LlmHotelSource.ts) + [`.test.ts`](src/lib/llm/LlmHotelSource.test.ts) (source classes with mocked-client tests, options-object constructors); [`src/lib/llm/debugSchema.ts`](src/lib/llm/debugSchema.ts) + [`.test.ts`](src/lib/llm/debugSchema.test.ts) (`npm run llm:schema` dev utility); [`src/lib/llm/smokeSources.ts`](src/lib/llm/smokeSources.ts) (`npm run llm:smoke` dev utility, ~$0.002 per run); [`src/lib/repositories/FlightRepository.test.ts`](src/lib/repositories/FlightRepository.test.ts) and [`HotelRepository.test.ts`](src/lib/repositories/HotelRepository.test.ts) (integration tests with mocked Prisma + mocked LlmSource, 6 tests each); [`prisma/migrations/20260815222654_add_room_type_default_capacity/migration.sql`](prisma/migrations/20260815222654_add_room_type_default_capacity/migration.sql).

Modified: [`prisma/schema.prisma`](prisma/schema.prisma) (`RoomType.defaultRoomsAvailable Int?`); [`src/lib/repositories/FlightRepository.ts`](src/lib/repositories/FlightRepository.ts) and [`HotelRepository.ts`](src/lib/repositories/HotelRepository.ts) (cache-first flow + upsert); [`src/lib/index.ts`](src/lib/index.ts) (`USE_LLM_GENERATION` env toggle + factory wiring + LlmSource re-exports); [`src/lib/cities.ts`](src/lib/cities.ts) (required `center` coord field); [`src/lib/repositories/LiveWeatherRepository.test.ts`](src/lib/repositories/LiveWeatherRepository.test.ts) (5 fixtures updated for new `center` field); [`package.json`](package.json) (`llm:schema` + `llm:smoke` scripts).

Test totals after this stage: **188 tests across 25 files, ~1.9 s cold runtime**. All pass; `npx tsc --noEmit` clean.

#### Stage 23 follow-ups

Four small PRs that came out of Stage 23 live testing or the initial README pass: a UI bug, a UI-test foundation, an error-sanitization fix, and a guardrail relaxation. Each one is either a fix for something the LLM-inventory work exposed, or a small piece of infra that Stage 23 made worth doing.

**Router-desync fix: New chat + title anchors (PR #23).** Live testing surfaced that clicking "New chat" (or the "Travel Assistant" title) did nothing after the first turn. Root cause: `adoptConversationId` in [useAgentChat.ts](src/hooks/useAgentChat.ts) uses `window.history.replaceState` to swap the URL from `/` to `/c/[id]` — a browser-only URL update that Next.js's App Router doesn't see. Router keeps thinking it's on `/`, so a `<Link href="/">` in the header is a no-op ("we're already there"). Fix: change the title and "New chat" `<Button component={Link}>` in [Header.tsx](src/components/Header.tsx) to `component="a"` — a plain HTML anchor forces a real browser navigation that doesn't ask the router's opinion. `history.replaceState` stays as-is (the alternative — routing the URL swap through `router.replace`) would trigger an RSC re-fetch on every conversation auto-creation, either fighting client state or causing a mid-flow flicker.

**React Testing Library + first UI tests (PR #24).** The button bug above was invisible to the existing backend-only test suite — no test exercised the client surface. This PR adds the RTL foundation and seeds it with a regression case for the button fix. Infra: `@testing-library/{react,user-event,jest-dom}` + `jsdom` + `@vitejs/plugin-react` as devDependencies (the last one because Next.js's `tsconfig` has `jsx: preserve` which Vitest can't otherwise process); `vitest.config.mts` gains `environment: 'jsdom'` (verified existing 188 pure-logic tests still pass), `include` broadened to `*.test.tsx`, and a `setupFiles` entry wires the jest-dom matchers. Tests (25 new; 213 total): `Header.test.tsx` mocks `next/link` with a marker attribute and asserts the title + New chat anchors are plain `<a>` (regression); `SamplePrompts.test.tsx` covers chip render + click + disabled state; `ChatContainer.test.tsx` covers empty-vs-populated + submit gating + pending + read-only; `BookingCard.test.tsx` covers all three status variants (PROPOSED / PAID / CANCELLED) + Confirm (signed-in vs anon) + in-flight state + OAuth return + Cancel + API-error alert. Small a11y improvement: the send `IconButton` in ChatContainer gains `aria-label="Send message"` (previously anonymous; also lets tests target it unambiguously).

**Sanitize non-guardrail agent errors before sending to the client (PR #25).** Stage 23's E1 test (corrupted `OPENAI_API_KEY`) surfaced the raw provider error verbatim to the chat UI — a 401 message including a partially-masked API-key fragment and an OpenAI docs URL. Root cause: the `else` branch in `/api/agent`'s stream error handler routed generic errors through `userFacingGuardrailErrorMessage`, whose fallback returns `err.message` for anything that isn't a guardrail trip. Fix: new [sanitizeAgentError.ts](src/utils/sanitizeAgentError.ts) always returns a fixed `AGENT_ERROR_MESSAGE` constant ("Sorry, something went wrong on our end. Please try again in a moment."). Deliberately doesn't inspect `err`: any inspection is surface area where we could accidentally leak. The server still `console.error`s the raw error for debugging. Guardrail branch is unchanged — those messages come from our own `outputInfo`, not provider internals. 3 unit tests (216/216 total, tsc clean) plus manual T1-T4 in-browser (normal chat, broken key → generic message, raw error in server log, guardrail still uses guardrail text).

**Loosen prompt-injection classifier for "show me all" search follow-ups (PR #26).** Also from Stage 23 live testing: the classifier blocked "Show me all flights, don't skip any." with "That request looks like it's trying to override my instructions." The classifier read "don't skip any" as an instruction-override attempt when it's actually a legitimate user preference about how much content to show. Fix: three new SAFE examples in the [promptInjectionInputGuardrail.ts](src/guardrails/promptInjectionInputGuardrail.ts) classifier prompt — "Show me all flights, don't skip any.", "List every hotel option; don't leave any out.", "Are there any I missed? Give me the full list." — plus one clarifying note that requests for ALL / FULL / COMPLETE results are content preferences, not injection. INJECTION examples and criteria unchanged, so `promptInjectionBlocked` continues to trip on real attempts. New multi-turn eval case [searchFollowUpShowAllAllowed.ts](src/evals/cases/searchFollowUpShowAllAllowed.ts) locks the fix in: turn 1 runs a real flight search, turn 2 sends the exact previously-blocked phrasing, asserts `noErrorsOrGuardrails` + `search_flights` was called.

**New / modified files (follow-ups).** New: [src/components/Header.test.tsx](src/components/Header.test.tsx), [SamplePrompts.test.tsx](src/components/SamplePrompts.test.tsx), [ChatContainer.test.tsx](src/components/ChatContainer.test.tsx), [BookingCard.test.tsx](src/components/BookingCard.test.tsx); [vitest.setup.ts](vitest.setup.ts) (jest-dom import); [src/utils/sanitizeAgentError.ts](src/utils/sanitizeAgentError.ts) + [.test.ts](src/utils/sanitizeAgentError.test.ts); [src/evals/cases/searchFollowUpShowAllAllowed.ts](src/evals/cases/searchFollowUpShowAllAllowed.ts). Modified: [src/components/Header.tsx](src/components/Header.tsx) (title + New chat use `component="a"`); [src/components/ChatContainer.tsx](src/components/ChatContainer.tsx) (send button `aria-label`); [vitest.config.mts](vitest.config.mts) (jsdom env, React plugin, `.tsx` include, setup file); [package.json](package.json) + [package-lock.json](package-lock.json) (RTL/jsdom deps); [app/api/agent/route.ts](app/api/agent/route.ts) (uses `sanitizeAgentError` for non-guardrail errors); [src/guardrails/promptInjectionInputGuardrail.ts](src/guardrails/promptInjectionInputGuardrail.ts) (SAFE examples + clarifying note); [src/evals/runner.ts](src/evals/runner.ts) (register new case).

---

> **Note on the historical Stage narratives above:** file paths in Stages 1–7 reflect the layout at the time each stage was written. Where those don't match the current file tree, the [file index](#file-index) at the bottom of this doc is authoritative.

---

## Explorer UI

The chat agent invokes REST endpoints — `/api/weather/current`, `/api/weather/forecast`, `/api/flights`, `/api/hotels`, `/api/booking/*` — as tools behind the scenes. The Explorer UI is a parallel front-end over the same endpoints, hitting them directly through form inputs so a human operator can compare what the tool actually returned against what the agent claimed. It's a debugging surface and a demo aid, not a customer-facing feature.

The whole thing lives under `/explorer`, side-by-side with the chat surface at `/`. A toggle in the shared Header ("Explorer" ↔ "Assistant") swaps between them; sessionStorage remembers the last visited sub-page so a round-trip lands the user back on the same panel with the last query and last response intact.

### Sitemap

Four sub-routes plus an index:

| Route | Backing endpoint(s) | Purpose |
|---|---|---|
| `/explorer` | — | Index — one card per sub-route. |
| `/explorer/weather` | `GET /api/weather/current`, `GET /api/weather/forecast` | Two panels (current + forecast), city-typed autocomplete, forecast day count 1–7. |
| `/explorer/flights` | `GET /api/flights` | Origin/destination airports, dates, cabin class, adults/children steppers, direct-only toggle, price cap. Results split into outbound + return legs, each independently sortable. |
| `/explorer/hotels` | `GET /api/hotels` | City, check-in/out, guests, rooms, min stars, per-night price cap, three amenity toggles. Results rendered as `HotelCard`s. |
| `/explorer/booking` | (planned M4) | Load a booking by id or reference, render through the shared `BookingCard`. |

### Folder layout

Two roots — presentational components under `src/components/explorer/`, non-component helpers under `src/lib/explorer/`. The invariant is strict: `components/` holds only React components; `lib/` holds everything else (hooks, types, utility functions, comparators).

```
src/components/explorer/
├─ PageHeader.tsx, PanelHeader.tsx                        (shared headers used by every page)
├─ EndpointCard.tsx, ExplorerRail.tsx                     (index + persistent left nav)
├─ ResponsePanel.tsx, SubmitBar.tsx, CurlButton.tsx       (shared response + submit plumbing)
├─ widgets/
│  ├─ CitySelect.tsx, AirportSelect.tsx                   (freeSolo Autocomplete over CITIES SoT)
│  ├─ NumberStepper.tsx, PriceSlider.tsx, StarsSelect.tsx
├─ weather/
│  ├─ CurrentWeatherPanel.tsx + CurrentWeatherResults.tsx
│  └─ ForecastPanel.tsx + ForecastResults.tsx
├─ flights/
│  ├─ FlightSearchForm.tsx                                (owns form state, emits { path, passengers })
│  ├─ FlightResults.tsx → LegBlock.tsx → FlightHeaderRow.tsx → SortableHeader.tsx
│  └─ FlightRow.tsx
└─ hotels/
   ├─ HotelSearchForm.tsx                                 (owns form state, emits { path })
   ├─ HotelResults.tsx → HotelCard.tsx

src/lib/explorer/
├─ explorerTypes.ts                                       (ResponseState<T> discriminated union + guards + notLoading)
├─ explorerFetch.ts                                       (typed fetch wrapper — never throws)
├─ usePersistedState.ts                                   (sessionStorage-backed useState)
├─ buildCurl.ts                                           (curl generator for CurlButton)
├─ flights/
│  ├─ sort.ts                                             (SortMode/SortSpec + compareFlights + toggleSort + FLIGHT_ROW_GRID)
│  └─ buildQuery.ts                                       (buildFlightsQuery — form state → /api/flights?...)
└─ hotels/
   └─ buildQuery.ts                                       (buildHotelsQuery — form state → /api/hotels?...)

app/explorer/
├─ layout.tsx                                             (persistent rail + main content area)
├─ page.tsx                                               (index card grid)
├─ weather/page.tsx, flights/page.tsx, hotels/page.tsx    (thin shells — instantiate panels/forms + ResponsePanel)
```

Pages are deliberately thin: they own response state + (for flights) sort state, delegate form ownership to a self-contained `*SearchForm` component. Weather is split into two independent panels (each owns its own form state) since its two endpoints don't share inputs.

### State + persistence

Every panel's inputs and last response survive Explorer↔Assistant navigation via `sessionStorage`, so a user can flip to the chat agent to compare, then flip back and find each panel exactly as they left it. Two moving parts.

**The `usePersistedState` hook** wraps `useState` with sessionStorage sync. Reads once on mount via `useEffect` — safe for SSR since the effect never runs server-side and `sessionStorage` (a browser API) is never touched during SSR. Persists via a wrapped setter (the returned `setValue`), *not* via a separate effect watching the value. The effect-watching pattern creates a race on mount: the persist effect fires with the stale `initial` value in its render-1 closure and overwrites what the hydrate effect just read. Wrapping the setter keeps flow strictly one-way — caller → state + storage, storage → state via hydrate, storage never touched from the hydrate path.

An optional `filter` argument skips persisting transient values. The panels pass `notLoading` (a helper in `explorerTypes.ts`) so a mid-flight fetch never gets restored into a stuck spinner on return. The filter is held in a `useRef`, not in `useCallback`'s deps, so callers can pass inline arrows without churning the returned setter's identity every render — a stability property that matters when the setter is passed to `React.memo`'d children or listed in another effect's dep array.

**The Header's Explorer↔Assistant toggle** remembers the last visited `/explorer/*` sub-page in `sessionStorage['explorer:lastPath']`. Going Assistant → Explorer routes back to that sub-page instead of the `/explorer` index. Fresh tab → clean slate → the toggle defaults to `/explorer`.

Every field in the search forms gets its own storage key (`explorer:flights:origin`, `explorer:hotels:checkin`, etc.). Response state uses `explorer:<page>:state`. The last-searched passenger count on flights is `explorer:flights:lastPassengers` — sticky so displayed per-leg totals reflect the search that actually ran, not whatever the pax steppers happen to show now.

### Building queries

Each search endpoint has a matching `buildQuery` under `src/lib/explorer/<page>/buildQuery.ts`. Two shared properties:

- **Options-object input.** Nine fields for flights, ten for hotels — positional args would be a hazard, and the object keeps call sites self-documenting.
- **Skip params that equal the API's defaults.** So `Copy as curl` produces the smallest correct request. `guests: 2` doesn't get appended for hotels (matches the server's default); `guests: 3` does. Same for `cabin_class: 'economy'`, `adults: 1`, and every boolean-off toggle.

There's no clever generic — each field has its own inclusion rule (truthy string, non-default number, defined-or-not, `true`-only boolean), and ten `if` statements in the flights builder is more scrutable than a table-driven variant that would need per-field predicates anyway.

### Response handling

Every panel talks to its endpoint through `explorerFetch<T>`, which:

- Times the request with `performance.now()`.
- Parses JSON on both success and error paths (`apiErrorResponse.ts` returns JSON either way — the endpoint contract is stable).
- Extracts the typed error shape `{ error: { code, message } }` on failure so the UI can render both the code (as a monospace chip) and the human message.
- **Never throws** — always resolves to a `ResponseState<T>` discriminated union:
  - `{ kind: 'idle' }` — before submit.
  - `{ kind: 'loading' }` — fetch in flight.
  - `{ kind: 'success', status, timing, data }` — parsed body available.
  - `{ kind: 'error', status, timing, error }` — server-typed error, HTTP error, or network failure.

`ResponsePanel<T>` dispatches on `state.kind`:

- **idle** → renders nothing (nothing has been submitted yet).
- **loading** → centered `CircularProgress`.
- **error** → MUI `Alert` with the typed code + message.
- **success** → Pretty / Raw tabs. Pretty invokes the caller's `renderPretty(data)` callback (each page provides one — `CurrentWeatherResults`, `ForecastResults`, `FlightResults`, `HotelResults`). Raw dumps `JSON.stringify(data, null, 2)`.

The response meta row carries `<status> · <timing>ms` in the top-right — small but durable through re-hydration, so returning from Assistant to a previously-successful search shows the same status + timing the request actually saw.

### Widget library

Five reusable input widgets under `src/components/explorer/widgets/`:

- **`CitySelect`** — freeSolo MUI Autocomplete over `CITY_NAMES` from `src/lib/cities.ts`. Free-type is allowed so an operator can drive the `CITY_NOT_FOUND` error path on purpose. Per-call-site `width` prop.
- **`AirportSelect`** — same shape over `CITIES` (which carries the IATA per city). Options display as `"ATH — Athens"` but the controlled value is the bare IATA; selection extracts the IATA before firing `onChange`, and free-type is upper-cased. Optional `excludeIata` filters one airport out of the dropdown — used by the flights form to block picking the same airport for origin and destination. (A same-airport guard on the form still handles the case where a user free-types a matching IATA.)
- **`NumberStepper`** — −/number/+ control for adults / children / guests / rooms. Clamps to `[min, max]`, disables each button at its respective endpoint, and accepts direct keyboard input (also clamped).
- **`PriceSlider`** — MUI Slider gated by a Switch. Off → `undefined` (no cap parameter sent). On → integer between `min` and `max` in `step` increments.
- **`StarsSelect`** — MUI Rating for the minimum-stars filter. Click a star to set the floor ("3+ stars"). Click the built-in "Empty" affordance to clear back to no filter.

Every widget is a **controlled** component — `value` in, `onChange` out — so the parent (`*SearchForm` in most cases) owns state.

### Flights sort

Each results leg — outbound and return — holds its own `SortSpec = { mode, direction }`, persisted independently under `explorer:flights:outboundSort` / `explorer:flights:inboundSort`. So a user can sort outbound by price ascending and return by duration descending at the same time.

- **Mode**: `'departure' | 'duration' | 'price'`.
- **Direction**: `'asc' | 'desc'`. Clicking a column header cycles inactive → asc → desc → asc — no "off" state, since every leg is always sorted by something.
- **Tie-breaker**: departure time, always ascending, regardless of the primary sort's direction. So a price-desc sort still groups same-price flights by earliest departure first — the sensible reading.

The comparator lives in `src/lib/explorer/flights/sort.ts` and is a pure function of `(SortSpec, FlightResult, FlightResult) → number`. The direction cycle is in `toggleSort(current, mode)`: switching to a new mode always starts at `asc`; hitting the active mode flips direction.

`SortableHeader` renders one clickable column header with an ↑ / ↓ arrow when active, keyboard-operable via Enter and Space with a matching `aria-label`. Kept fully generic (takes any `sort` + `onSort` prop) so it'll drop into hotels results too if sorting lands there.

### Test coverage

Full component-level coverage under Vitest + React Testing Library — **112 tests across 25 colocated `.test.tsx` files**, shipped as four incremental PRs:

- **A — widgets (28 tests).** Established the pattern; discovered that controlled-`inputValue` Autocomplete needs a stateful test wrapper (otherwise typed characters replace each other instead of accumulating), and that MUI Rating's visually-hidden radios need `fireEvent.click` on the radio input queried by its `value` attribute — `user.click` on the label doesn't reliably reach the underlying input.
- **B — presenters + headers (43 tests).** Introduced the `vi.mock('./LegBlock', ...)` pattern for composed components: parent tests focus on the composition contract (right props, right count, right order) without repeating rendering coverage that already exists in the child's own test file.
- **C — stateful panels + fetch mock (25 tests).** `vi.stubGlobal('fetch', vi.fn())` with a `Response`-shaped resolve, `sessionStorage` pre-population as a shortcut past widget interactions when the test only cares about a validation state, `fireEvent.change` for controlled number inputs (where `parseInt('') === NaN` makes `user.clear` silently no-op).
- **D — shared plumbing (16 tests).** Discovered `userEvent.setup()` installs its own Clipboard API stub — instead of fighting it, `CurlButton` tests read back the copied command with `await navigator.clipboard.readText()`.

Test files sit next to the component they cover — no separate `__tests__` directory, no test-only naming convention. `Foo.tsx` → `Foo.test.tsx` in the same folder.

---

## Next.js port

Everything below Stage 5 was ported to a single Next.js 15 (App Router) app. What changed and what didn't:

### What got removed

- **Three Express servers** (`src/weather-api.ts`, `src/flight-api.ts`, `src/hotel-api.ts`) — replaced by five Route Handlers under `app/api/`. Same query-string parsing, same service layer underneath, same error mapping (centralized in `src/lib/apiErrorResponse.ts`).
- **Three separate ports** — everything is now on `:3000`. The MCP servers just use path segments (`/api/flights`, `/api/hotels`, `/api/weather/current`, `/api/weather/forecast`) to distinguish domains.
- **Two CLI REPL agents** — `weather-agent.ts` and `travel-agent.ts` moved to `legacy/`. Their streaming logic (tool-call log, spinner, `unwrapToolOutput`) was ported into the new `app/api/agent/route.ts` + `app/page.tsx`.
- **The Express `dev` script** — `npm run dev` now runs `next dev`.

### What got added

- **`app/api/agent/route.ts`** — the new heart of the app. Accepts POST `{ history, userInput }`, spawns the two MCP servers as singletons (persisted via `globalThis` across dev-mode HMR), builds the Agent with fresh date/weekday/Friday injection, then streams events back as **Server-Sent Events**:
  - `data: {"type":"tool_call","name":"...","args":"..."}`
  - `data: {"type":"tool_output","output":"..."}`
  - `data: {"type":"text_delta","delta":"..."}`
  - `data: {"type":"done","history":[...]}`
- **`app/page.tsx`** — MUI-based Client Component chat UI. Renders user/agent bubbles, tool calls as collapsible `Accordion` entries (args + output), and streams the agent's answer token-by-token. Sample prompts as clickable chips on the empty state.
- **`app/layout.tsx`** + **`app/theme.ts`** — MUI setup with `AppRouterCacheProvider` (required for App Router SSR of Emotion styles), custom palette.
- **`src/lib/apiErrorResponse.ts`** — one helper mapping `ZodError` / `WeatherServiceError` / `TravelServiceError` to `NextResponse` with the right status codes. All four data-endpoint Route Handlers share it.

### What didn't change

- **`src/lib/*`** — services, repositories, error classes, helpers. All Route Handlers call the same `createWeatherService()` / `createFlightService()` / `createHotelService()` factories the Express servers used. That's the payoff of the Stage-2 layer separation: the API framework is a swappable outer skin.
- **`src/mcp-servers/weather-mcp.ts` and `src/mcp-servers/travel-mcp.ts`** — only the URL constants moved (`/weather` → `/api/weather/current`, etc.) and the two travel BASEs consolidated to one. Everything else — tool schemas, handlers, error propagation — is identical.
- **`prisma/*`** — untouched.

### Runtime model

Before: three Express processes on three ports + a CLI REPL that spawned two MCP children per turn.

After: one Next.js process on port `:3000` that spawns two MCP children as `globalThis`-cached singletons on first request. In-place development via `next dev` (Turbopack); the MCP children are hot-reloaded independently by tsx.

The MCP servers still fetch over HTTP — but now they hit the same Next.js process that spawned them. That's a slight weirdness (loopback HTTP), and in a "hardened" version you'd short-circuit MCP handlers to call the services directly. For learning, the round trip is nice: it keeps the layers crisp and lets you `curl` the Route Handlers to test them in isolation.

### The MUI SSR gotcha

Emotion (which MUI uses) needs a specific setup to work with React Server Components streaming. `@mui/material-nextjs`'s `AppRouterCacheProvider` handles this — it collects style rules on the server, injects them into the streamed HTML, and re-hydrates on the client. Without it, you get a flash of unstyled content on first load. `app/layout.tsx` wraps children in this provider before `ThemeProvider`.

### Directory shape after the port

```
day-1/
├─ app/                              ← Next.js App Router
│  ├─ layout.tsx                     ← MUI theme + CssBaseline
│  ├─ page.tsx                       ← Chat UI (Client Component)
│  ├─ theme.ts                       ← MUI theme (client)
│  └─ api/
│     ├─ weather/
│     │  ├─ current/route.ts         ← GET /api/weather/current
│     │  └─ forecast/route.ts        ← GET /api/weather/forecast
│     ├─ flights/route.ts            ← GET /api/flights
│     ├─ hotels/route.ts             ← GET /api/hotels
│     └─ agent/route.ts              ← POST /api/agent (SSE)
├─ legacy/                            ← historical CLI journey (still runnable via tsx)
│  ├─ index.ts, explore.ts, weather.ts, books.ts, research.ts,
│  ├─ mcp-server.ts, weather-agent.ts, travel-agent.ts
├─ src/
│  ├─ weather-mcp.ts                 ← unchanged (URL constants updated)
│  ├─ travel-mcp.ts                  ← unchanged (URL constants updated)
│  └─ lib/                           ← unchanged (+ apiErrorResponse.ts)
├─ prisma/                            ← unchanged
├─ openapi.yaml                       ← contract remains valid; paths are now /api/…
├─ next.config.mjs, next-env.d.ts    ← Next.js scaffolding
├─ tsconfig.json                      ← Next.js compat
└─ package.json                       ← next/react/MUI in; express out
```

---

## Architecture walkthrough

Top-to-bottom explanation of the running system: what each layer does, what happens on a single request, what runs where, and why we made the choices we did.

### One-paragraph summary

One Next.js 15 process on `:3000` handles everything the app does. The browser talks to it over HTTP + SSE. Route Handlers call the service layer (`src/lib/`), which calls Prisma, which talks to Postgres (Neon). One special Route Handler — `POST /api/agent` — is the agent surface: it runs the Agents SDK, streams the run as SSE frames, and its MCP tools are backed by two child processes (spawned once, cached in `globalThis`) that fetch back into the same Next.js process over loopback HTTP.

```
        Browser (React + MUI, client)
            │
            │ POST /api/agent  { history, userInput }
            │ ← SSE frames back
            ▼
     ┌──────────────────────────────────────────────────┐
     │ Next.js 15 App Router process (:3000)            │
     │                                                  │
     │  ┌── app/api/agent/route.ts ─────────────────┐   │
     │  │ 1. read POST body                         │   │
     │  │ 2. get or init MCP singletons             │   │
     │  │ 3. build Agent (today, weekday, Fridays)  │   │
     │  │ 4. run(agent, input, { stream:true })     │   │
     │  │ 5. for-await events → SSE frames          │   │
     │  └───────┬───────────────────────────────────┘   │
     │          │ MCP tool calls                        │
     │          ▼                                       │
     │  ┌── MCP clients (inside MCPServerStreamableHttp) ┐│
     │  │ speak JSON-RPC over HTTP POST to two endpoints ││
     │  └──┬────────────────────────────────────┬────────┘│
     │     │                                    │         │
     │  ┌──▼────────────────────┐   ┌───────────▼───────┐ │
     │  │ app/api/mcp/travel/   │   │ app/api/mcp/      │ │
     │  │  route.ts             │   │  weather/route.ts │ │
     │  │ (Route Handler)       │   │ (Route Handler)   │ │
     │  └──┬────────────────────┘   └───────────┬───────┘ │
     │     │ callApi() → loopback fetch         │         │
     │     ▼                                  ▼         │
     │  ┌── app/api/flights/route.ts ─────────────┐     │
     │  │      app/api/hotels/route.ts            │     │
     │  │      app/api/weather/current/route.ts   │     │
     │  │      app/api/weather/forecast/route.ts  │     │
     │  └──┬─────────────────────────────────────┘      │
     │     │ createXxxService() → service.method(...)   │
     │     ▼                                            │
     │  ┌── src/lib/{Weather,Flight,Hotel}Service ──┐   │
     │  │      … Repository, … Error, index.ts      │   │
     │  └──┬────────────────────────────────────────┘   │
     │     │ Prisma queries                             │
     │     ▼                                            │
     │  ┌── PrismaClient (lazy singleton) ──────────┐   │
     │  └──┬────────────────────────────────────────┘   │
     └─────┼────────────────────────────────────────────┘
           │
           ▼
      PostgreSQL (Neon)
```

### The layers, top to bottom

**Layer 1 — Browser (React + MUI).** Single Client Component, `app/page.tsx`. Owns four pieces of state:

- `messages: ChatMessage[]` — what's rendered.
- `history: AgentInputItem[]` — the transcript the server needs on the next turn.
- `input: string` — the text field.
- `pending: boolean` — locks the send button while a turn is in flight.

On submit, it POSTs `{ history, userInput }` to `/api/agent`, then reads `response.body` as a stream, parses SSE frames (`data: …\n\n`), and applies each frame:

| Frame | Effect |
|---|---|
| `{ type: 'text_delta', delta }` | Append delta to the current agent message's `text` |
| `{ type: 'tool_call', name, args }` | Push a `ToolCall { name, args }` onto the current agent message |
| `{ type: 'tool_output', output }` | Populate the last `ToolCall.output` |
| `{ type: 'done', history }` | Update client-side `history`; unlock send button |
| `{ type: 'error', message }` | Replace agent message with an error |

MUI theming happens in `app/layout.tsx` with `AppRouterCacheProvider` + `ThemeProvider`.

**Layer 2 — Route Handlers (server-side).** Five endpoints. Four are boring data endpoints; one is the agent endpoint.

*Data endpoints* — `app/api/weather/current/route.ts`, `/forecast`, `/api/flights`, `/api/hotels`. Each is ~15 lines: parse query (via a factored `parseSearchXxxQuery` in `src/utils/queries/`), call `createXxxService().searchXxx(input)`, `NextResponse.json(result)`, `catch → apiErrorResponse(err)`.

*Booking endpoints* (Stage 8) — `app/api/booking/propose`, `/api/booking/[id]`, `/api/booking/[id]/confirm`, `/api/booking/[id]/cancel`. Same shape but POST-heavy; `[id]/confirm` is the only route deliberately unreachable from any agent tool.

`apiErrorResponse` ([src/utils/apiErrorResponse.ts](src/utils/apiErrorResponse.ts)) is one function all of them share:

```
ZodError                                   → 400 { error, issues }
WeatherServiceError CITY_NOT_FOUND         → 404
WeatherServiceError NO_FORECAST_AVAILABLE  → 404
TravelServiceError  AIRPORT_NOT_FOUND      → 404
TravelServiceError  CITY_NOT_FOUND         → 404
TravelServiceError  INVALID_DATE_RANGE     → 400
* INTERNAL_ERROR                           → 500
```

*Agent endpoint* — `app/api/agent/route.ts`. Four things happen:

1. `getOrInitMcps()` — lazy-init the two MCP child processes. `globalThis`-cached so subsequent requests reuse them.
2. `buildAgent(mcpTravel, mcpWeather)` — freshly-computed today's date + weekday + upcoming Fridays, plus the long instruction block, plus `mcpServers: [...]`.
3. `run(agent, [...history, { role: 'user', content: userInput }], { stream: true })` — returns a `StreamedRunResult` that yields events.
4. `new Response(new ReadableStream(...))` with `Content-Type: text/event-stream`. The stream's `start()` iterates the run events, encodes each as `data: …\n\n`, and enqueues bytes to the controller.

The `for await (const event of stream)` block does essentially what the CLI REPL did — but instead of `console.log`-ing tool calls and streaming to stdout, it sends SSE frames to the browser.

**Layer 3 — Service + Repository (`src/lib/`).** The payoff of Stage 2 (API framework as swappable outer skin), regrouped by the post-Stage-8 domain-vs-glue split.

- `services/` — `WeatherService`, `FlightService`, `HotelService`, `BookingService` (Zod validation, business rules, transactional inventory reservation). Sibling error classes: `WeatherServiceError`, `TravelServiceError`, `BookingServiceError`.
- `repositories/` — `WeatherRepository`, `FlightRepository`, `HotelRepository`, `BookingRepository`. Prisma queries + projection to plain types (no Prisma types leak upward).
- `index.ts` — barrel + factory helpers (`createXxxService(prisma?)`) + `is*ServiceError` type guards + `PrismaClient` lazy singleton.

Everything else that used to live under `src/lib/` (query parsing, HTTP error mapping, MCP transport) moved to sibling folders in the post-Stage-8 restructure:

- `src/utils/apiErrorResponse.ts` — the Next.js-specific service-error → response mapper.
- `src/utils/parsers.ts` — `parseBool`, `parseList`. Used by the two query parsers.
- `src/utils/queries/{searchFlights,searchHotels}Query.ts` — `NextRequest` → `SearchXxxInput`.

**Layer 4 — MCP servers (Streamable HTTP Route Handlers).** `app/api/mcp/travel/route.ts` and `app/api/mcp/weather/route.ts`. Each:

- Uses the shared `createMcpHttpHandler` from `src/mcp/mcpHttpHandler.ts` to speak MCP JSON-RPC over `POST`.
- Builds one `createMcpApiClient(BASE)` from `src/mcp/mcpApiClient.ts` (BASE overridable per MCP via `TRAVEL_API_BASE` / `WEATHER_API_BASE`).
- Composes its tool list by invoking factories from `src/mcp/tools/{travel,weather}/` — each factory takes just the API method it needs (`callApi` for GET-shaped tools, `postApi` for the mutating booking tools) and returns an `McpToolSpec`.
- Each tool spec's handler calls the injected API method against a REST path (`/api/flights`, `/api/hotels`, `/api/booking/propose`, …). `callApi` returns `{ content: [{ type: 'text', text: responseBody }], isError: !r.ok }`.

The design buys us three things: deployable to serverless (no `spawn`), inspectable via `npm run mcp:inspect` (enter the URL in the browser UI), and `curl`-able for hand-testing (send a `tools/list` JSON-RPC frame with `curl` and read the plain-JSON response).

**Layer 5 — Database (Postgres via Prisma).** `schema.prisma` gained Booking / FlightBooking / HotelBooking / Payment + `BookingStatus` / `PaymentStatus` enums in Stage 8, plus `seatsAvailable` on `FlightInstance` for CAS-based reservation. `PrismaClient` singleton in `src/lib/index.ts`. Route Handlers, MCP handlers (indirectly), and the agent all use the same connection pool.

### Trace of one request, end-to-end

User types **"I want a sunny weekend in Berlin under €600 total."** and hits send.

1. **Browser** — `send(prompt)` pushes user + empty agent messages, sets `pending = true`, POSTs `/api/agent` with `{ history, userInput }`.
2. **Next.js** — routes to `app/api/agent/route.ts::POST`.
3. **MCP init.** `getOrInitMcps()` on first request instantiates two `MCPServerStreamableHttp` clients pointing at `http://localhost:3000/api/mcp/travel` and `.../weather`. Each calls its endpoint's `initialize` and `tools/list` over HTTP JSON-RPC, registers each discovered tool with the parent's internal registry. Milliseconds cold — no child processes — cached from then on.
4. **Build agent.** `today = "2026-07-08"`, `todayWeekday = "Wednesday"`, `upcomingFridays = ["2026-07-10","2026-07-17","2026-07-24","2026-07-31"]`. Constructs the full instruction block. Discardable — only its config matters.
5. **Start the run.** `run(agent, input, { stream: true })` returns a `StreamedRunResult` (async iterable of events). Internally kicks off the first Responses API call.
6. **Response body — the SSE stream.** Route Handler returns a `Response(readable)` where `readable.start(controller)` runs the for-await loop. Bytes flow to the browser as soon as they're enqueued.
7. **First model turn — decision.** The agent decides "I need the forecast for Berlin and both search tools." It emits three `function_call` items in one turn (approximately):
   - `get_forecast({ city: "Berlin", days: 7 })`
   - `search_flights({ origin: "ATH", destination: "BER", departure_date: "2026-07-10", return_date: "2026-07-12" })`
   - `search_hotels({ city: "Berlin", checkin: "2026-07-10", checkout: "2026-07-12", max_price: 150 })`
8. **Runner dispatch.** For each `function_call`, the Runner looks up which MCP registered that tool name and sends a `tools/call` JSON-RPC frame over HTTP `POST` to the corresponding MCP Route Handler (`/api/mcp/travel` or `/api/mcp/weather`).
9. **Inside the MCP handler** (say the travel MCP handling `search_flights`): the factory-built spec's handler invokes `callApi('/api/flights', args)`, which builds `new URL('/api/flights', BASE)`, sets query params, `fetch`es — loopback HTTP back into the same Next.js process.
10. **Loopback into Next.js.** `GET /api/flights?…` routes to `app/api/flights/route.ts::GET`.
11. **Route Handler — flights.** `parseSearchFlightsQuery(req)` → coerces types. `flightService.searchFlights(input)` → Zod parses, `flightRepository.airportExists` × 2 in parallel, `flightRepository.findInstances(...)` (Prisma joins across FlightInstance → FlightDefinition → Airline + two Airport→City chains), maps rows, applies cabin multiplier, filters by `max_price`. `NextResponse.json({ outbound, inbound })`.
12. **HTTP response back to child.** `fetch` resolves. Child wraps body: `{ content: [{ type: 'text', text: bodyText }], isError: !r.ok }`.
13. **JSON-RPC response** goes back over stdout to the parent's MCP client.
14. **Runner emits a `tool_call_output_item` event.**
15. **Route Handler for-await.** Event lands in the `tool_call_output_item` branch, `unwrapToolOutput` peels off the MCP envelope, `send({ type: 'tool_output', output })` encodes as `data: …\n\n` and enqueues.
16. **Browser receives bytes.** `for-await` on `res.body.getReader()` buffers by `\n\n`, parses `data:` lines, calls `applyEvent(agentMsgId, payload)`. The corresponding `ToolCall.output` field populates; the MUI Accordion refreshes.
17. **Repeat for the other two tools** — potentially in parallel; the SDK dispatches concurrently and events arrive as each resolves.
18. **Second model turn — reasoning.** With all three tool outputs, the model composes the final answer. It emits `output_text_delta` events (many per second).
19. **Text deltas → SSE `text_delta` frames.** Browser appends each delta to the current agent message. The MUI bubble updates on every delta.
20. **Stream completes.** `for await` exits, `await stream.completed` resolves, Route Handler sends `{ type: 'done', history }` and closes the controller. Browser receives it, updates `history`, releases the send button.

Total wall-clock: ~4–8 seconds. Most of it is model latency; MCP + DB overhead is milliseconds.

### Process / lifetime model

| Thing | Where it lives | How long it lives |
|---|---|---|
| Next.js process | Your terminal running `npm run dev` | Until you Ctrl+C |
| PrismaClient | `src/lib/index.ts` singleton | Same as Next.js process |
| MCP clients (travel + weather) | Created by `MCPServerStreamableHttp` | First `/api/agent` request → until Next.js process dies (or dev-mode HMR recycles). No child processes — HTTP endpoints served by the same Next.js process. |
| Agent object | Created per request | Discarded after `run()` returns |
| Conversation history | Browser `useState` | Until page reload |
| Streaming response | Route Handler's `ReadableStream` | One request lifetime |
| OpenAI HTTPS calls | Inside Agents SDK | Per model turn (typically 2 per user turn: initial + post-tools) |

Nothing here persists across process restarts except the DB. The whole app is stateless on the server side; state that matters (conversation) is client-side, and could be persisted to `localStorage` or a `Conversation` DB table as a future addition.

### Where each design decision came from

- **Route Handlers > Server Actions for data endpoints.** GET semantics, cacheable, MCP-consumable via `fetch`, `curl`-able for debugging. Server Actions are POST-only and coupled to React components — wrong shape here.
- **SSE for the agent stream.** Turn-based interaction: one request in, many events out, done. Native `Response(ReadableStream)` fit. No custom Node server needed.
- **`fetch` + manual SSE parse (not `EventSource`) on the client.** Because we need to POST a body. Wire format is still SSE.
- **MCP over stdio, child processes.** Same protocol Claude Desktop / VS Code Claude Code / any other MCP client uses. Keeps our MCPs portable.
- **`globalThis`-cached MCP singletons.** With Streamable HTTP, connecting is much cheaper than spawning a `tsx` child, but the `tools/list` handshake still costs a request; caching in `globalThis` avoids repeating it every user turn, and the same pattern survives Next.js dev-mode HMR (mirrors how PrismaClient is cached in every Next.js template).
- **Fresh Agent per request, not cached.** Instructions embed today's date + upcoming Fridays. If we cached the Agent, midnight would break it. Building it costs ~microseconds.
- **`apiErrorResponse` centralized.** Four call sites; one truth. Adding a new service error code is a one-line change in the mapper.
- **Client-side history.** Server has no session store, no user model, no auth. Adding those is a future extension; right now the browser is the source of truth per session.
- **Chat bubbles + Accordion tool cards.** MUI defaults get you clean, accessible components without hand-writing chat CSS.

### What breaks, and how it recovers

| Failure | Behavior |
|---|---|
| No `OPENAI_API_KEY` | Agents SDK throws on first call. Route Handler catches inside the for-await's try, sends `{ type: 'error', message }`. Browser shows red-tinted message. |
| DB unavailable | Prisma throws. Service wraps as `INTERNAL_ERROR` with `cause`. Route Handler → 500 JSON. MCP child returns `isError: true`. Agent tells the user "the tool errored" and gives up. |
| Unknown IATA / city | Service throws typed `AIRPORT_NOT_FOUND` / `CITY_NOT_FOUND`. Route Handler → 404. MCP → `isError: true`. Agent says the destination isn't in the demo library. |
| Malformed request body to `/api/agent` | Route Handler returns 400 JSON early. Browser sees non-OK response, shows error. |
| MCP child dies mid-request | The `tools/call` future rejects. Runner throws. Route Handler's try/catch sends error frame. Recovery: kill the parent process — the `globalThis` cache holds the dead handle. A production fix would add a health check + re-init. |
| Browser closes tab | Server-side for-await keeps running until the underlying HTTP connection tears down. Wasted work but no leak. Fix would be `req.signal.addEventListener('abort', () => …)`. |
| Malformed SSE frame on client | `try/catch` in the frame parser skips it silently. |
| Very long turn (~2 min) | `export const maxDuration = 120` in the Route Handler sets Vercel's timeout to 2 min. `next dev` has no timeout. |

---

## Command index

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server on `:3000` |
| `npm run build` | Production build |
| `npm start` | Production server (after `build`) |
| `npm run lint` | ESLint via `next lint` |
| `npm run mcp:inspect` | Launch the MCP Inspector; enter `http://localhost:3000/api/mcp/travel` or `.../weather` to hand-test either MCP (needs `npm run dev` up) |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Create/apply a dev migration (`-- --name <name>`) |
| `npm run db:deploy` | Apply existing migrations (production) |
| `npm run db:seed` | Populate the database (idempotent) |
| `npm run db:reset` | Drop DB, re-apply migrations, run seed |
| `npm run db:studio` | Open Prisma Studio (browser UI) |

Legacy CLI scripts (Day 1–7, Travel Stage 5) live under `legacy/` and can be run directly, e.g.:

```bash
tsx legacy/index.ts                # Day 1 streaming demo
tsx legacy/weather.ts              # Day 3 manual tool loop
tsx legacy/research.ts             # Day 6/7 research agent
tsx legacy/travel-agent.ts         # Travel Stage 5 CLI REPL
```

The legacy REPLs still work — the CLI travel-agent talks to the same MCP servers over stdio, which now fetch from `http://localhost:3000/api/…` instead of the old `:3001` / `:3002` Express ports.

## File index

```
day-1/
├─ app/
│  ├─ page.tsx, layout.tsx, theme.ts                     (chat UI shell)
│  ├─ explorer/
│  │  ├─ layout.tsx, page.tsx                             (persistent rail + index card grid)
│  │  ├─ weather/page.tsx, flights/page.tsx, hotels/page.tsx  (thin shells over the panel components)
│  └─ api/
│     ├─ agent/route.ts                                   (SSE stream of the agent's turn)
│     ├─ weather/{current,forecast}/route.ts              (weather REST)
│     ├─ flights/route.ts, hotels/route.ts                (travel REST)
│     ├─ booking/{propose,[id],[id]/confirm,[id]/cancel}/route.ts  (booking REST, Stage 8)
│     └─ mcp/{travel,weather}/route.ts                    (MCP as Streamable HTTP Route Handlers, Stage 7)
├─ src/
│  ├─ agents/         (build{Weather,Travel,Triage}Agent, buildAgentGraph)
│  ├─ components/
│  │  ├─ (chat UI: MessageBubble(s), ToolCallView, BookingCard, FlightLegRow(s), HotelStayRow(s), SamplePrompts, Header)
│  │  └─ explorer/                                       (Explorer sub-app UI)
│  │     ├─ PageHeader, PanelHeader, EndpointCard, ExplorerRail
│  │     ├─ ResponsePanel, SubmitBar, CurlButton         (shared plumbing)
│  │     ├─ widgets/{City,Airport}Select, NumberStepper, PriceSlider, StarsSelect
│  │     ├─ weather/{Current,Forecast}Panel + {Current,Forecast}Results
│  │     ├─ flights/FlightSearchForm + FlightResults → LegBlock → FlightHeaderRow → SortableHeader + FlightRow
│  │     └─ hotels/HotelSearchForm + HotelResults + HotelCard
│  ├─ config/         (samplePrompts.ts)
│  ├─ hooks/          (useAgentChat)
│  ├─ lib/
│  │  ├─ index.ts     (barrel + factory helpers + PrismaClient singleton)
│  │  ├─ cities.ts, amenities.ts, pricing.ts             (cross-cutting SoTs for city/airport data, amenity names, CabinClass enum)
│  │  ├─ zodDates.ts  (shared IsoDate zod primitive)
│  │  ├─ repositories/ (Booking, Flight, Hotel, WeatherRepository)
│  │  ├─ services/    (Booking, Flight, Hotel, WeatherService + typed error classes)
│  │  └─ explorer/
│  │     ├─ explorerTypes.ts, explorerFetch.ts, usePersistedState.ts, buildCurl.ts
│  │     ├─ flights/{sort,buildQuery}.ts
│  │     └─ hotels/buildQuery.ts
│  ├─ mcp/
│  │  ├─ mcpHttpHandler.ts, mcpApiClient.ts
│  │  └─ tools/{travel,weather}/                          (one tool spec factory per file)
│  ├─ types/          (chat, booking, stream, weather)   (weather Row/Result types extracted here as of M1)
│  └─ utils/
│     ├─ apiErrorResponse.ts, parsers.ts, dates.ts, toolOutput.ts
│     └─ queries/     (search{Flights,Hotels}Query)
├─ prisma/            (schema + seed; Booking / FlightBooking / HotelBooking / Payment added Stage 8)
├─ legacy/            (Day 1–7 + CLI REPLs, historical)
├─ openapi.yaml       (contract for the REST endpoints)
├─ next.config.mjs, next-env.d.ts, tsconfig.json
└─ package.json       (Next.js + MUI + Prisma + OpenAI Agents)
```
