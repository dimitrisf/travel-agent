import type { PrismaClient } from '@prisma/client';
import type { LlmFlightSource } from '../llm/LlmFlightSource';
import type { FlightOffer } from '../llm/flightGenerationSchema';

export interface FlightSearchOptions {
  // e.g. "ATH" for Athens, "LHR" for London Heathrow, etc.
  originIata: string;
  destinationIata: string;
  departureDate: string; // YYYY-MM-DD, interpreted as UTC calendar day

  // Optional filters

  // If true, only return flights with no stops. If false or undefined, return all flights.
  nonstopOnly?: boolean;
  // If provided, only return flights operated by airlines with IATA codes in this list. If undefined or empty, return all flights.
  airlineCodes?: string[]; // IATA codes to whitelist
}

// Represents a single flight instance (i.e. a single flight on a specific date/time) returned by the FlightRepository.
export interface FlightSearchRow {
  flightInstanceId: number; // FlightInstance.id — needed by the booking flow
  flightNumber: string; // e.g. "A3 824"
  airlineName: string;
  airlineIata: string;
  basePriceEUR: number;
  stops: number;
  // Duration of the flight in minutes, including any stops
  durationMinutes: number;
  departureDatetime: Date;
  arrivalDatetime: Date;
  origin: { iata: string; name: string; city: string };
  destination: { iata: string; name: string; city: string };
}

// Stage 23 — FlightRepository is cache-first with an optional
// on-demand LLM fallback:
//   1. Query local DB for matching FlightInstances (existing behavior).
//   2. If no rows AND an `llmSource` was injected AND both airports
//      are seeded (Scope B guardrail), ask LlmFlightSource to
//      generate offers, upsert them into the DB, then re-query.
//   3. Otherwise return the (possibly empty) DB result unchanged.
//
// `llmSource` is undefined by default (createFlightService wires it
// only when USE_LLM_GENERATION=1). With no llmSource, behavior is
// identical to before Stage 23 — evals and unit tests are unaffected.
export class FlightRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly llmSource?: LlmFlightSource,
  ) {}

  async airportExists(iata: string): Promise<boolean> {
    const a = await this.prisma.airport.findUnique({
      where: { iataCode: iata },
      select: { id: true },
    });
    return a !== null;
  }

  // E.g, opts = {
  //   originIata: 'ATH',
  //   destinationIata: 'FRA',
  //   departureDate: '2024-07-01',
  //   nonstopOnly: true,
  //   airlineCodes: ['A3', 'LH'],
  // }
  async findInstances(opts: FlightSearchOptions): Promise<FlightSearchRow[]> {
    // Query the DB — the pre-Stage-23 behavior.
    const dbRows = await this.queryDb(opts);
    if (dbRows.length > 0 || !this.llmSource) return dbRows;

    // DB miss + LLM fallback wired. Only proceed if BOTH airports
    // are seeded — Scope B constrains generation to routes between
    // existing airports (LLM must not invent airports / cities).
    const [origin, destination] = await Promise.all([
      this.prisma.airport.findUnique({
        where: { iataCode: opts.originIata },
        include: { city: true },
      }),
      this.prisma.airport.findUnique({
        where: { iataCode: opts.destinationIata },
        include: { city: true },
      }),
    ]);
    if (!origin || !destination) return dbRows;

    // Fetch all seeded airlines. The LLM's airlineIata field is
    // z.enum'd on this list via flightGenerationSchema, so structured
    // outputs guarantees every returned offer references an existing
    // airline — no post-hoc "did the LLM invent this?" check needed.
    const airlines = await this.prisma.airline.findMany({
      select: { id: true, iataCode: true, name: true },
    });
    if (airlines.length === 0) return dbRows;

    // Ask the LLM to generate 3-6 flight offers for this route/date. The
    // LLM is constrained to the seeded airline list via the z.enum in
    // flightGenerationSchema, so it cannot invent an airline code.
    const result = await this.llmSource.generateFlightsForRoute({
      originAirport: {
        iataCode: origin.iataCode,
        cityName: origin.city.name,
      },
      destinationAirport: {
        iataCode: destination.iataCode,
        cityName: destination.city.name,
      },
      departureDate: opts.departureDate,
      allowedAirlines: airlines.map((a) => ({
        iataCode: a.iataCode,
        name: a.name,
      })),
    });
    if (!result) return dbRows;

    // At this point, result = { flights: FlightOffer[] } and every FlightOffer.airlineIata is guaranteed to be in the seeded airline list. No further validation is needed here.
    // E.g., for the ATH→FRA input above (assuming the DB seed
    // includes airlines A3, LH, BA, TK, KL), result might be:
    //   {
    //     flights: [
    //       { airlineIata: 'A3', flightNumber: '824',  departureTimeHHMM: '07:15', durationMinutes: 165, basePriceEUR: 145, stops: 0, aircraft: 'A320', seatsAvailable: 42 },
    //       { airlineIata: 'LH', flightNumber: '1281', departureTimeHHMM: '10:20', durationMinutes: 170, basePriceEUR: 189, stops: 0, aircraft: 'A321', seatsAvailable: 28 },
    //       { airlineIata: 'LH', flightNumber: '3391', departureTimeHHMM: '14:45', durationMinutes: 200, basePriceEUR: 165, stops: 1, aircraft: 'A320', seatsAvailable: 55 },
    //       { airlineIata: 'BA', flightNumber: '632',  departureTimeHHMM: '16:10', durationMinutes: 210, basePriceEUR: 220, stops: 1, aircraft: 'A320', seatsAvailable: 34 },
    //       { airlineIata: 'LH', flightNumber: '1287', departureTimeHHMM: '20:55', durationMinutes: 175, basePriceEUR: 155, stops: 0, aircraft: 'A321', seatsAvailable: 38 },
    //     ],
    //   }
    // Note the BA offer: the LLM can pick from ALL seeded airlines
    // (not just opts.airlineCodes) — the airlineCodes filter is only
    // applied on the re-query below. So the BA offer will be upserted
    // to DB but filtered out of THIS caller's return.
    //
    // Upsert LLM output. `upsert with update: {}` = find-or-create —
    // if the row already exists (e.g. LLM invented a flightNumber
    // that collides with a seeded FlightDefinition), reuse it without
    // overwriting anything (which would corrupt existing state).

    // Airline lookup uses a Map after fetch. We already fetched all airlines for the Zod z.enum that constrains the LLM's airlineIata field; we look up each offer's airline by IATA in O(1) via airlineByIata.get(offer.airlineIata)! — the ! is safe because structured outputs guaranteed the value is in the enum we passed in.
    // E.g, airlineByIata = Map { 'A3' => { id: 1, iataCode: 'A3', name: 'Aegean Airlines' }, 'LH' => { id: 2, iataCode: 'LH', name: 'Lufthansa' }, 'BA' => { id: 3, iataCode: 'BA', name: 'British Airways' }, ... }
    const airlineByIata = new Map(airlines.map((a) => [a.iataCode, a]));

    for (const offer of result.flights) {
      // E.g., offer = { airlineIata: 'A3', flightNumber: '824',  departureTimeHHMM: '07:15', durationMinutes: 165, basePriceEUR: 145, stops: 0, aircraft: 'A320', seatsAvailable: 42 }
      await this.upsertOffer({
        offer,
        airlineId: airlineByIata.get(offer.airlineIata)!.id,
        originAirportId: origin.id,
        destinationAirportId: destination.id,
        departureDate: opts.departureDate,
      });
    }

    // Re-query so the newly-upserted rows join any prior dbRows rows,
    // and so the return shape (JOIN-projected FlightSearchRow) is
    // built the same way as the cache-hit path.
    // Re-query after upsert. Instead of transforming the just-upserted rows into FlightSearchRow[] ourselves, we re-run queryDb(opts). Two benefits:
    // 1. The projection logic (JOIN airline + origin + destination, apply filters) stays in one place.
    // 2. Newly upserted rows join any pre-existing cached rows in a single query — the user sees a coherent result.
    // Cost: one extra DB round-trip. Trivial at demo scale.
    return this.queryDb(opts);
  }

  // Existing DB query — unchanged behavior. Extracted so findInstances
  // can call it in both the initial-lookup and post-upsert re-query
  // paths.
  // E.g., opts = {
  //   originIata: 'ATH',
  //   destinationIata: 'FRA',
  //   departureDate: '2024-07-01',
  //   nonstopOnly: true,
  //   airlineCodes: ['A3', 'LH'],
  // }
  private async queryDb(opts: FlightSearchOptions): Promise<FlightSearchRow[]> {
    const dayStart = new Date(`${opts.departureDate}T00:00:00.000Z`);
    // The end of the day is exclusive, so add 24 hours to the start.
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const rows = await this.prisma.flightInstance.findMany({
      where: {
        departureDatetime: { gte: dayStart, lt: dayEnd },
        flightDefinition: {
          originAirport: { iataCode: opts.originIata },
          destinationAirport: { iataCode: opts.destinationIata },
          ...(opts.nonstopOnly ? { stops: 0 } : {}),
          ...(opts.airlineCodes && opts.airlineCodes.length > 0
            ? { airline: { iataCode: { in: opts.airlineCodes } } }
            : {}),
        },
      },
      include: {
        flightDefinition: {
          include: {
            airline: true,
            originAirport: { include: { city: true } },
            destinationAirport: { include: { city: true } },
          },
        },
      },
      orderBy: { departureDatetime: 'asc' },
    });

    // At this point, rows = [
    //   {
    //     id: 123,
    //     departureDatetime: 2024-07-01T08:00:00.000Z,
    //     arrivalDatetime: 2024-07-01T10:30:00.000Z,
    //     flightDefinition: {
    //       airline: { iataCode: 'A3', name: 'Aegean Airlines' },
    //       flightNumber: '824',
    //       basePriceEUR: 150,
    //       stops: 0,
    //       durationMinutes: 150,
    //       originAirport: { iataCode: 'ATH', name: 'Athens International', city: { name: 'Athens' } },
    //       destinationAirport: { iataCode: 'FRA', name: 'Frankfurt Airport', city: { name: 'Frankfurt' } },
    //     }
    //   },
    //   ...
    // ]

    // As per above example, the returned value = [
    //   {
    //     flightInstanceId: 123,
    //     flightNumber: 'A3 824',
    //     airlineName: 'Aegean Airlines',
    //     airlineIata: 'A3',
    //     basePriceEUR: 150,
    //     stops: 0,
    //     durationMinutes: 150,
    //     departureDatetime: 2024-07-01T08:00:00.000Z,
    //     arrivalDatetime: 2024-07-01T10:30:00.000Z,
    //     origin: { iata: 'ATH', name: 'Athens International', city: 'Athens' },
    //     destination: { iata: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt' },
    //   },
    //   ...
    // ]
    return rows.map((r) => ({
      flightInstanceId: r.id,
      flightNumber: `${r.flightDefinition.airline.iataCode} ${r.flightDefinition.flightNumber}`,
      airlineName: r.flightDefinition.airline.name,
      airlineIata: r.flightDefinition.airline.iataCode,
      basePriceEUR: r.flightDefinition.basePriceEUR,
      stops: r.flightDefinition.stops,
      durationMinutes: r.flightDefinition.durationMinutes,
      departureDatetime: r.departureDatetime,
      arrivalDatetime: r.arrivalDatetime,
      origin: {
        iata: r.flightDefinition.originAirport.iataCode,
        name: r.flightDefinition.originAirport.name,
        city: r.flightDefinition.originAirport.city.name,
      },
      destination: {
        iata: r.flightDefinition.destinationAirport.iataCode,
        name: r.flightDefinition.destinationAirport.name,
        city: r.flightDefinition.destinationAirport.city.name,
      },
    }));
  }

  // Upsert one LLM-generated offer. Both FlightDefinition and
  // FlightInstance use `upsert with update: {}` (find-or-create) so
  // any collision with existing rows is a no-op — never overwrite
  // seeded data or prior LLM output.
  private async upsertOffer(params: {
    offer: FlightOffer;
    airlineId: number;
    originAirportId: number;
    destinationAirportId: number;
    departureDate: string; // YYYY-MM-DD
  }): Promise<void> {
    const {
      offer,
      airlineId,
      originAirportId,
      destinationAirportId,
      departureDate,
    } = params;

    // Combine input departureDate (YYYY-MM-DD, UTC) with the LLM's
    // HH:MM time-of-day to build the full UTC datetime. Arrival =
    // departure + durationMinutes; computed in code so the LLM can't
    // produce arrival-before-departure or off-by-day errors.
    const departureDatetime = new Date(
      `${departureDate}T${offer.departureTimeHHMM}:00.000Z`,
    );
    const arrivalDatetime = new Date(
      departureDatetime.getTime() + offer.durationMinutes * 60_000,
    );
    const generatedAt = new Date();

    const flightDefinition = await this.prisma.flightDefinition.upsert({
      where: {
        airlineId_flightNumber: { airlineId, flightNumber: offer.flightNumber },
      },
      create: {
        airlineId,
        flightNumber: offer.flightNumber,
        originAirportId,
        destinationAirportId,
        basePriceEUR: offer.basePriceEUR,
        durationMinutes: offer.durationMinutes,
        stops: offer.stops,
        externalSource: 'llm',
        generatedAt,
      },
      update: {}, // find-or-create; never overwrite existing.
    });

    // FlightDefinition is uniquely keyed on (airlineId, flightNumber) —
    // route is NOT part of the key. If a pre-existing row (seed or prior
    // LLM output) has the same airline+flightNumber but a different
    // route, the upsert above reused it. Attaching a new FlightInstance
    // would misfile it under the wrong route: the immediate re-query
    // would miss it, and a future search on the OTHER route would surface
    // this fabricated instance as if it were a real flight there. Skip.
    if (
      flightDefinition.originAirportId !== originAirportId ||
      flightDefinition.destinationAirportId !== destinationAirportId
    ) {
      return;
    }

    await this.prisma.flightInstance.upsert({
      where: {
        flightDefinitionId_departureDatetime: {
          flightDefinitionId: flightDefinition.id,
          departureDatetime,
        },
      },
      create: {
        flightDefinitionId: flightDefinition.id,
        departureDatetime,
        arrivalDatetime,
        aircraft: offer.aircraft,
        seatsAvailable: offer.seatsAvailable,
        externalSource: 'llm',
        generatedAt,
      },
      update: {}, // find-or-create; preserve any decremented seat counts, i.e, an existing row might have a decremented seatsAvailable from a booking; we must not overwrite it.
    });
  }
}
