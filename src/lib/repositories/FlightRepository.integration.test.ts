import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestPrisma, resetDb } from '@/lib/testing/prismaTestClient';
import { seedAirport, seedAirline } from '@/lib/testing/seedFixtures';
import { FlightRepository } from './FlightRepository';
import type { LlmFlightSource } from '../llm/LlmFlightSource';
import type { FlightGenerationResponse } from '../llm/flightGenerationSchema';

// Phase 2b — integration tests for FlightRepository.findInstances,
// the cache-first repo introduced in Stage 23. Covers the DB-only
// path (cache hit + filter push-down), the pre-Stage-23 "no
// llmSource" behavior, and the LLM fallback (with a mocked
// LlmFlightSource — zero OpenAI tokens per run, see README section
// "Deferred to Phase 2b" for the rationale on why integration
// tests stay hermetic).
//
// The interesting edge case at the end (test #6) is the cross-route
// flightNumber collision in upsertOffer: FlightDefinition is @unique
// on (airlineId, flightNumber) — NOT on route — so an LLM offer that
// picks a flightNumber matching a seeded row on a different route
// would misfile the FlightInstance under the wrong route without
// the guard.

// Small typed stub in place of a real LlmFlightSource. Returns a
// canned response — never calls OpenAI, so integration tests remain
// zero-token. Cast via `unknown` because LlmFlightSource is a class
// with private fields; structural typing rejects the plain object.
function mockLlmFlightSource(
  response: FlightGenerationResponse | null,
): LlmFlightSource {
  return {
    generateFlightsForRoute: vi.fn(async () => response),
  } as unknown as LlmFlightSource;
}

describe('FlightRepository.findInstances (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('cache hit: returns projected FlightSearchRow with correct JOIN shape (airline name, city names, "IATA number" flight label)', async () => {
    const ath = await seedAirport(prisma, 'ATH');
    const fra = await seedAirport(prisma, 'FRA');
    const aegean = await seedAirline(prisma, 'A3');

    const definition = await prisma.flightDefinition.create({
      data: {
        airlineId: aegean.id,
        flightNumber: '824',
        originAirportId: ath.id,
        destinationAirportId: fra.id,
        basePriceEUR: 120,
        durationMinutes: 200,
        stops: 0,
      },
    });
    await prisma.flightInstance.create({
      data: {
        flightDefinitionId: definition.id,
        departureDatetime: new Date('2026-08-25T08:00:00.000Z'),
        arrivalDatetime: new Date('2026-08-25T11:20:00.000Z'),
        seatsAvailable: 180,
      },
    });

    // No llmSource wired — this test only exercises the DB path.
    const repo = new FlightRepository(prisma);
    const rows = await repo.findInstances({
      originIata: 'ATH',
      destinationIata: 'FRA',
      departureDate: '2026-08-25',
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Composite "IATA number" label — the SEARCH tools return this
    // as the human-facing flight identifier.
    expect(row.flightNumber).toBe('A3 824');
    expect(row.airlineName).toBe('Aegean Airlines');
    expect(row.airlineIata).toBe('A3');
    expect(row.basePriceEUR).toBe(120);
    expect(row.stops).toBe(0);
    expect(row.durationMinutes).toBe(200);
    // City-name JOIN — projection reaches through airport → city.
    expect(row.origin).toEqual({
      iata: 'ATH',
      name: 'Athens International',
      city: 'Athens',
    });
    expect(row.destination).toEqual({
      iata: 'FRA',
      name: 'Frankfurt Airport',
      city: 'Frankfurt',
    });
  });

  it('cache hit with filters: nonstopOnly + airlineCodes push down to the SQL WHERE clause', async () => {
    const ath = await seedAirport(prisma, 'ATH');
    const fra = await seedAirport(prisma, 'FRA');
    const aegean = await seedAirline(prisma, 'A3');
    const lufthansa = await seedAirline(prisma, 'LH');

    // Three flight instances on the same route + date. Only the first
    // should survive `nonstopOnly: true` AND `airlineCodes: ['A3']`.
    const nonstopA3 = await prisma.flightDefinition.create({
      data: {
        airlineId: aegean.id,
        flightNumber: '824',
        originAirportId: ath.id,
        destinationAirportId: fra.id,
        basePriceEUR: 120,
        durationMinutes: 200,
        stops: 0,
      },
    });
    const oneStopA3 = await prisma.flightDefinition.create({
      data: {
        airlineId: aegean.id,
        flightNumber: '825',
        originAirportId: ath.id,
        destinationAirportId: fra.id,
        basePriceEUR: 90,
        durationMinutes: 320,
        stops: 1,
      },
    });
    const nonstopLH = await prisma.flightDefinition.create({
      data: {
        airlineId: lufthansa.id,
        flightNumber: '1281',
        originAirportId: ath.id,
        destinationAirportId: fra.id,
        basePriceEUR: 150,
        durationMinutes: 190,
        stops: 0,
      },
    });
    for (const def of [nonstopA3, oneStopA3, nonstopLH]) {
      await prisma.flightInstance.create({
        data: {
          flightDefinitionId: def.id,
          departureDatetime: new Date('2026-08-25T08:00:00.000Z'),
          arrivalDatetime: new Date('2026-08-25T11:20:00.000Z'),
          seatsAvailable: 180,
        },
      });
    }

    const repo = new FlightRepository(prisma);
    const rows = await repo.findInstances({
      originIata: 'ATH',
      destinationIata: 'FRA',
      departureDate: '2026-08-25',
      nonstopOnly: true,
      airlineCodes: ['A3'],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].flightNumber).toBe('A3 824');
  });

  it('cache miss + no llmSource wired → returns empty (pre-Stage-23 behavior preserved)', async () => {
    // Seed airports so we're testing "no flights on this date/route",
    // not "airports don't exist" (which would trip Scope B guard when
    // an llmSource IS wired).
    await seedAirport(prisma, 'ATH');
    await seedAirport(prisma, 'FRA');
    await seedAirline(prisma, 'A3');

    const repo = new FlightRepository(prisma);
    const rows = await repo.findInstances({
      originIata: 'ATH',
      destinationIata: 'FRA',
      departureDate: '2026-08-25',
    });

    expect(rows).toEqual([]);
  });

  it('cache miss + LLM returns offers → upserts to DB with externalSource=llm and re-queries', async () => {
    const ath = await seedAirport(prisma, 'ATH');
    const fra = await seedAirport(prisma, 'FRA');
    await seedAirline(prisma, 'A3');
    await seedAirline(prisma, 'LH');

    const llm = mockLlmFlightSource({
      flights: [
        {
          airlineIata: 'A3',
          flightNumber: '100',
          departureTimeHHMM: '08:00',
          durationMinutes: 200,
          basePriceEUR: 120,
          stops: 0,
          aircraft: 'A320',
          seatsAvailable: 180,
        },
        {
          airlineIata: 'LH',
          flightNumber: '200',
          departureTimeHHMM: '14:00',
          durationMinutes: 180,
          basePriceEUR: 150,
          stops: 0,
          aircraft: 'A321',
          seatsAvailable: 150,
        },
      ],
    });

    const repo = new FlightRepository(prisma, llm);
    const rows = await repo.findInstances({
      originIata: 'ATH',
      destinationIata: 'FRA',
      departureDate: '2026-08-25',
    });

    // Re-query returns both LLM-generated offers.
    expect(rows).toHaveLength(2);
    const numbers = rows.map((r) => r.flightNumber).sort();
    expect(numbers).toEqual(['A3 100', 'LH 200']);

    // Provenance stamped so future ops can tell LLM-vs-seed rows apart.
    const definitions = await prisma.flightDefinition.findMany({
      where: {
        originAirportId: ath.id,
        destinationAirportId: fra.id,
      },
    });
    expect(definitions).toHaveLength(2);
    expect(definitions.every((d) => d.externalSource === 'llm')).toBe(true);
    expect(definitions.every((d) => d.generatedAt !== null)).toBe(true);

    const instances = await prisma.flightInstance.findMany({
      where: {
        flightDefinition: {
          originAirportId: ath.id,
          destinationAirportId: fra.id,
        },
      },
    });
    expect(instances).toHaveLength(2);
    expect(instances.every((i) => i.externalSource === 'llm')).toBe(true);
  });

  it('cache miss + LLM returns null → fail-open, returns empty without throwing', async () => {
    await seedAirport(prisma, 'ATH');
    await seedAirport(prisma, 'FRA');
    await seedAirline(prisma, 'A3');

    const llm = mockLlmFlightSource(null);
    const repo = new FlightRepository(prisma, llm);

    const rows = await repo.findInstances({
      originIata: 'ATH',
      destinationIata: 'FRA',
      departureDate: '2026-08-25',
    });

    expect(rows).toEqual([]);
    // Nothing upserted on the null-return path.
    expect(await prisma.flightDefinition.count()).toBe(0);
    expect(await prisma.flightInstance.count()).toBe(0);
  });

  it('cross-route flightNumber collision: reuses the existing FlightDefinition (find-or-create) but SKIPS the mismatched FlightInstance', async () => {
    // A3 already flies 824 on ATH→FRA. Now ask for ATH→BER; the LLM
    // returns another A3-824 for that route. FlightDefinition is
    // @unique on (airlineId, flightNumber), so the upsert re-uses the
    // existing row — but the route mismatch guard in upsertOffer must
    // then skip the FlightInstance, otherwise a future ATH→FRA search
    // would surface this fabricated ATH→BER instance as if it were a
    // real flight on the wrong route.
    const ath = await seedAirport(prisma, 'ATH');
    const fra = await seedAirport(prisma, 'FRA');
    const ber = await seedAirport(prisma, 'BER');
    const aegean = await seedAirline(prisma, 'A3');

    const existingDefinition = await prisma.flightDefinition.create({
      data: {
        airlineId: aegean.id,
        flightNumber: '824',
        originAirportId: ath.id,
        destinationAirportId: fra.id,
        basePriceEUR: 120,
        durationMinutes: 200,
        stops: 0,
        externalSource: 'seed',
      },
    });

    // Mock LLM returns A3-824 as if it flies ATH→BER — the collision.
    const llm = mockLlmFlightSource({
      flights: [
        {
          airlineIata: 'A3',
          flightNumber: '824',
          departureTimeHHMM: '10:00',
          durationMinutes: 150,
          basePriceEUR: 200,
          stops: 0,
          aircraft: 'A320',
          seatsAvailable: 180,
        },
      ],
    });

    const repo = new FlightRepository(prisma, llm);
    const rows = await repo.findInstances({
      originIata: 'ATH',
      destinationIata: 'BER',
      departureDate: '2026-08-25',
    });

    // Re-query for ATH→BER: still no results, because the collision
    // guard prevented the wrong-route FlightInstance from landing.
    expect(rows).toEqual([]);

    // Pre-existing FlightDefinition unchanged — find-or-create means
    // update:{}, so the LLM's fresh basePrice/duration didn't overwrite
    // the seeded values.
    const definitions = await prisma.flightDefinition.findMany();
    expect(definitions).toHaveLength(1);
    const surviving = definitions[0];
    expect(surviving.id).toBe(existingDefinition.id);
    expect(surviving.originAirportId).toBe(ath.id);
    expect(surviving.destinationAirportId).toBe(fra.id);
    expect(surviving.basePriceEUR).toBe(120);
    expect(surviving.externalSource).toBe('seed');

    // No FlightInstance created for the mismatched route (BER). If the
    // guard were missing, one would exist here with departure = 2026-08-25
    // 10:00 UTC — and it would be misfiled under a FlightDefinition
    // pointing to FRA, silently corrupting future ATH→FRA searches.
    expect(await prisma.flightInstance.count()).toBe(0);
  });
});
