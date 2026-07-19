# OpenAI Responses — Learning Journey

A progression from a single streaming Responses API call to a **production-shaped Next.js app**: Postgres → service layer → Next.js Route Handlers → MCP servers → OpenAI Agent → MUI chat UI. Each step builds on the last; the historical Day-by-day exploration is preserved in `legacy/` for reference.

## Quick start

```bash
npm install
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
| **API Route Handlers** | `app/api/weather/*`, `app/api/flights/route.ts`, `app/api/hotels/route.ts`, `app/api/booking/*` (Stage 8), `app/api/agent/route.ts` | Replace the three Express `*-api.ts` servers. `/api/agent` streams the agent's turn as SSE. The `/api/booking/*` set is a booking state machine with idempotency and CAS-based inventory reservation. |
| **MCP servers** | `app/api/mcp/travel/route.ts`, `app/api/mcp/weather/route.ts` | Route Handlers using `createMcpHttpHandler` (Stage 7 — Streamable HTTP). Tool specs live under `src/mcp/tools/{travel,weather}/` (restructure). |
| **Agent graph** | `src/agents/build{Weather,Travel,Triage,Agent}Agent.ts`, `src/agents/buildAgentGraph.ts` | One file per agent's instructions + a wire-up (restructure). |
| **Domain layer** | `src/lib/services/*`, `src/lib/repositories/*`, `src/lib/index.ts` | Services + typed errors + Prisma-backed repositories + barrel with factory helpers (post-Stage-8 subfolder split). |
| **Utils / config / types** | `src/utils/*` (`apiErrorResponse`, `parsers`, `dates`, `toolOutput`, `queries/`), `src/config/samplePrompts.ts`, `src/types/*` (`chat`, `booking`, `stream`) | Stateless helpers, editable constants, shared types (restructure). |
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
| `confirmBooking(id)` | `PROPOSED` → `PAID` | reserves seats + rooms via CAS | Creates a `Payment` row. Fails with `INSUFFICIENT_SEATS` / `INSUFFICIENT_ROOMS` if inventory has been eaten since propose. |
| `cancelBooking(id, reason?)` | `PROPOSED` \| `PAID` → `CANCELLED` | restores if previously reserved | Enforces per-hotel `CancellationPolicy` for `PAID` bookings (non-refundable hotels throw `NON_REFUNDABLE`). |
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

> **Note on the historical Stage narratives above:** file paths in Stages 1–7 reflect the layout at the time each stage was written. Where those don't match the current file tree, the [file index](#file-index) at the bottom of this doc is authoritative.

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
│  └─ api/
│     ├─ agent/route.ts                                   (SSE stream of the agent's turn)
│     ├─ weather/{current,forecast}/route.ts              (weather REST)
│     ├─ flights/route.ts, hotels/route.ts                (travel REST)
│     ├─ booking/{propose,[id],[id]/confirm,[id]/cancel}/route.ts  (booking REST, Stage 8)
│     └─ mcp/{travel,weather}/route.ts                    (MCP as Streamable HTTP Route Handlers, Stage 7)
├─ src/
│  ├─ agents/         (build{Weather,Travel,Triage}Agent, buildAgentGraph)
│  ├─ components/     (UI: MessageBubble(s), ToolCallView, BookingCard, FlightLegRow(s), HotelStayRow(s), SamplePrompts)
│  ├─ config/         (samplePrompts.ts)
│  ├─ hooks/          (useAgentChat)
│  ├─ lib/
│  │  ├─ index.ts     (barrel + factory helpers + PrismaClient singleton)
│  │  ├─ repositories/ (Booking, Flight, Hotel, WeatherRepository)
│  │  └─ services/    (Booking, Flight, Hotel, WeatherService + typed error classes)
│  ├─ mcp/
│  │  ├─ mcpHttpHandler.ts, mcpApiClient.ts
│  │  └─ tools/{travel,weather}/                          (one tool spec factory per file)
│  ├─ types/          (chat, booking, stream)
│  └─ utils/
│     ├─ apiErrorResponse.ts, parsers.ts, dates.ts, toolOutput.ts
│     └─ queries/     (search{Flights,Hotels}Query)
├─ prisma/            (schema + seed; Booking / FlightBooking / HotelBooking / Payment added Stage 8)
├─ legacy/            (Day 1–7 + CLI REPLs, historical)
├─ openapi.yaml       (contract for the REST endpoints)
├─ next.config.mjs, next-env.d.ts, tsconfig.json
└─ package.json       (Next.js + MUI + Prisma + OpenAI Agents)
```
