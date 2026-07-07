# OpenAI Responses — Learning Journey

A progression from a single streaming Responses API call to a production-shaped architecture (Postgres → service layer → REST API → MCP server → OpenAI Agent). Each step builds on the last; nothing is throwaway.

## Setup

```bash
npm install
cp .env.example .env   # then add OPENAI_API_KEY and DATABASE_URL
```

Requires Node 18+ (uses global `fetch`), a valid OpenAI API key, and (for the Week 2 extension) a Postgres database (e.g. Neon).

For the Week 2 extension you'll also need to provision the schema and seed data:

```bash
npm run db:generate          # generate the Prisma client
npm run db:migrate -- --name init   # create tables (first time)
npm run db:seed              # populate cities, conditions, forecasts
```

## Map of the project

| Day / Week | File(s) | Concept |
|---|---|---|
| 1 | `src/index.ts` | Streaming Responses API, token usage, response ID |
| 3 | `src/weather.ts` | Manual tool-call loop, `previous_response_id`, REPL |
| 5 | `src/books.ts` | Structured outputs with Zod / JSON Schema |
| 6 | `src/research.ts` | OpenAI Agents SDK — `Agent`, `Tool`, `Runner` |
| 7 | `src/mcp-server.ts` | MCP server (single source of truth for the library tools) |
| Week 2 | `openapi.yaml`, `src/weather-api.ts`, `src/weather-mcp.ts`, `src/weather-agent.ts` | REST API → MCP wrapper → Agent |
| Week 2 (extension) | `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/*`, updated `src/weather-api.ts` | Service layer + Postgres (Neon) via Prisma behind the REST API |

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
- `src/weather-mcp.ts` — *MCP wrapper*: an MCP server whose handlers translate each tool call into an HTTP request to the REST API. Owns no data of its own.
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
| HTTP client | `src/weather-mcp.ts` | REST API | Implicit (Node global `fetch`) |
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

`parseBool` and `parseList` live in [src/lib/queryParsing.ts](src/lib/queryParsing.ts) and are re-exported from `src/lib/index.ts`. Both API files import them rather than redeclaring.

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

[src/travel-mcp.ts](src/travel-mcp.ts) is the MCP surface for both travel APIs — one server, two tools, two HTTP backends.

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

**Simple flight query:**
```
You: Find me a flight from Athens to Berlin on July 3rd.
```
One `search_flights` call → A3 824 nonstop + LH 1753 (1 stop).

**Relative dates:**
```
You: I want to go from Athens to Berlin next Friday for three days. Show me flights and hotels.
```
Model resolves "next Friday" against the injected date, picks return three days later, issues `search_flights` + `search_hotels` in parallel.

**Budget orchestration:**
```
You: I want to spend under €600 total for a three-day trip to Berlin next Friday.
```
Agent decomposes into flights + hotels, sums the cheapest round-trip (~€283), computes the remaining hotel budget (~€317 / 3 nights ≈ €105/night), narrows hotels to that ceiling, and reports the cheapest viable combo.

**Multi-turn memory:**
```
You: Recommend flights from Athens to Berlin on July 3rd.
Agent: [lists A3 824, LH 1753]
You: Which is the cheapest?
Agent: [answers from history — no new tool call]
You: What hotels are available in Berlin from that day for 3 nights, under €150/night?
Agent: [one search_hotels call]
```

**Weather-aware trip planning:**
```
You: I want a sunny weekend in Berlin under €600 total.
```
Agent calls `get_forecast("Berlin")`, checks each upcoming Friday against the injected list, picks the sunniest weekend within the flight window, then calls `search_flights` + `search_hotels` for that Fri→Sun.

**Cross-city comparison:**
```
You: I'm choosing between Athens, Berlin, and London for a July weekend. Show me temperatures and cheapest 3-night hotels for each.
```
Six tool calls in parallel: three `get_forecast` + three `search_hotels`.

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

#### How to debug when the agent surprises you

When the agent does something you don't expect, the fastest path to a diagnosis is a **tool-call trace**. Add this after each `run(...)` in the REPL loop:

```ts
for (const item of result.newItems) {
  if (item.type === 'tool_call_item') {
    console.log(`  → ${item.rawItem.name}(${JSON.stringify(item.rawItem.arguments)})`);
  }
}
```

Now every turn prints the tools the model actually called. Skipped `search_flights`? Called `get_weather` twice? You'll see it. Almost every "the model behaved weirdly" investigation resolves against this log within a minute.

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
| `npm run weather:api` | Week 2 — Express weather REST API on `:3000` |
| `npm run weather:mcp:inspect` | Inspect `weather-mcp.ts` (needs weather:api running) |
| `npm run weather:agent` | Week 2 — agent → MCP → REST → answer |
| `npm run flight:api` | Travel Stage 3 — Express flight REST API on `:3001` |
| `npm run hotel:api` | Travel Stage 3 — Express hotel REST API on `:3002` |
| `npm run travel:mcp:inspect` | Travel Stage 4 — inspect `travel-mcp.ts` (needs flight:api + hotel:api running) |
| `npm run travel:agent` | Travel Stage 5 — REPL agent orchestrating flights + hotels (needs flight:api + hotel:api running) |
| `npm run db:generate` | Generate the Prisma client from `schema.prisma` |
| `npm run db:migrate` | Create / apply a new dev migration (use `-- --name <name>`) |
| `npm run db:deploy` | Apply existing migrations (production) |
| `npm run db:seed` | Populate the database (idempotent) |
| `npm run db:reset` | Drop the DB, re-apply migrations, run seed |
| `npm run db:studio` | Open Prisma Studio (browser UI) |

## File index

```
day-1/
├─ openapi.yaml             ← API contract (Week 2)
├─ package.json
├─ tsconfig.json
├─ .env                     ← OPENAI_API_KEY, DATABASE_URL (gitignored)
├─ .env.example
├─ prisma/
│  ├─ schema.prisma         ← weather + travel models (Week 2 ext + Travel Stage 1)
│  └─ seed.ts               ← idempotent seed for all domains
└─ src/
   ├─ index.ts              ← Day 1
   ├─ explore.ts            ← raw JSON of Response items
   ├─ weather.ts            ← Day 3 (manual tool loop, REPL)
   ├─ books.ts              ← Day 5 (structured outputs)
   ├─ research.ts           ← Day 6/7 (agent + MCP library)
   ├─ mcp-server.ts         ← Day 7 (library MCP server)
   ├─ weather-api.ts        ← Week 2 (REST API, now backed by service layer)
   ├─ weather-mcp.ts        ← Week 2 (MCP wrapper over REST)
   ├─ weather-agent.ts      ← Week 2 (REPL agent)
   ├─ flight-api.ts         ← Travel Stage 3 (REST API on :3001)
   ├─ hotel-api.ts          ← Travel Stage 3 (REST API on :3002)
   ├─ travel-mcp.ts         ← Travel Stage 4 (MCP wrapper over flight + hotel APIs)
   ├─ travel-agent.ts       ← Travel Stage 5 (REPL agent mounting travel + weather MCPs)
   └─ lib/                  ← business logic + data access (Week 2 ext + Travel Stage 2)
      ├─ WeatherService.ts        ← Zod-validated entry points
      ├─ WeatherRepository.ts     ← Prisma queries
      ├─ WeatherServiceError.ts   ← custom error with `code`
      ├─ FlightService.ts         ← Travel Stage 2 (Zod + cabin multipliers)
      ├─ FlightRepository.ts      ← Travel Stage 2 (FlightInstance joins)
      ├─ HotelService.ts          ← Travel Stage 2 (Zod + amenity filters)
      ├─ HotelRepository.ts       ← Travel Stage 2 (Hotel/RoomType/Availability joins)
      ├─ TravelServiceError.ts    ← shared error for flights + hotels
      ├─ queryParsing.ts          ← Travel Stage 3 (parseBool, parseList)
      └─ index.ts                 ← createWeatherService/FlightService/HotelService, helpers
```
