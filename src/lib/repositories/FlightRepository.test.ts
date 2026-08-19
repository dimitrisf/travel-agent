import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { FlightRepository, type FlightSearchOptions } from './FlightRepository';
import type { LlmFlightSource } from '../llm/LlmFlightSource';
import type { FlightGenerationResponse } from '../llm/flightGenerationSchema';

// Stage 23 integration tests for FlightRepository — focused on the
// cache-first orchestration + LLM fallback. Upsert semantics (Prisma
// SQL emission, unique-constraint behavior) are Prisma's job and not
// exercised here; we only assert that upsert was invoked when
// expected and that the LLM was called with the right args.

const VALID_OPTS: FlightSearchOptions = {
  originIata: 'ATH',
  destinationIata: 'BER',
  departureDate: '2026-08-20',
};

// Minimal shape-partial mocks — only the Prisma surface FlightRepository
// touches. Cast through unknown so TypeScript accepts the partial as
// a full PrismaClient.
function makeMockPrisma() {
  const prisma = {
    flightInstance: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    airport: {
      findUnique: vi.fn(),
    },
    airline: {
      findMany: vi.fn(),
    },
    flightDefinition: {
      upsert: vi.fn(),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, mocks: prisma };
}

function makeMockLlmSource() {
  const generateFlightsForRoute = vi.fn();
  const source = { generateFlightsForRoute } as unknown as LlmFlightSource;
  return { source, generateFlightsForRoute };
}

const VALID_LLM_OUTPUT: FlightGenerationResponse = {
  flights: [
    {
      airlineIata: 'LH',
      flightNumber: '1234',
      departureTimeHHMM: '08:00',
      durationMinutes: 175,
      basePriceEUR: 187.5,
      stops: 0,
      aircraft: 'A320',
      seatsAvailable: 42,
    },
    {
      airlineIata: 'A3',
      flightNumber: '824',
      departureTimeHHMM: '13:40',
      durationMinutes: 180,
      basePriceEUR: 156,
      stops: 0,
      aircraft: 'A321',
      seatsAvailable: 78,
    },
    {
      airlineIata: 'LH',
      flightNumber: '2211',
      departureTimeHHMM: '19:15',
      durationMinutes: 190,
      basePriceEUR: 214,
      stops: 1,
      aircraft: null,
      seatsAvailable: 12,
    },
  ],
};

const SAMPLE_FLIGHT_ROW = {
  id: 100,
  departureDatetime: new Date('2026-08-20T08:00:00Z'),
  arrivalDatetime: new Date('2026-08-20T10:55:00Z'),
  flightDefinition: {
    airline: { iataCode: 'LH', name: 'Lufthansa' },
    flightNumber: '1234',
    basePriceEUR: 187.5,
    stops: 0,
    durationMinutes: 175,
    originAirport: {
      iataCode: 'ATH',
      name: 'Athens International',
      city: { name: 'Athens' },
    },
    destinationAirport: {
      iataCode: 'BER',
      name: 'Berlin Brandenburg',
      city: { name: 'Berlin' },
    },
  },
};

describe('FlightRepository.findInstances', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns DB rows and skips LLM when no llmSource is injected', async () => {
    const { prisma, mocks } = makeMockPrisma();
    mocks.flightInstance.findMany.mockResolvedValueOnce([SAMPLE_FLIGHT_ROW]);
    const repo = new FlightRepository(prisma);

    const rows = await repo.findInstances(VALID_OPTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].airlineIata).toBe('LH');
    expect(mocks.airport.findUnique).not.toHaveBeenCalled();
  });

  it('returns empty when DB has no matches and no llmSource is wired', async () => {
    const { prisma, mocks } = makeMockPrisma();
    mocks.flightInstance.findMany.mockResolvedValueOnce([]);
    const repo = new FlightRepository(prisma);

    const rows = await repo.findInstances(VALID_OPTS);

    expect(rows).toEqual([]);
    expect(mocks.airport.findUnique).not.toHaveBeenCalled();
  });

  it('cache hit with llmSource does not invoke the LLM', async () => {
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateFlightsForRoute } = makeMockLlmSource();
    mocks.flightInstance.findMany.mockResolvedValueOnce([SAMPLE_FLIGHT_ROW]);
    const repo = new FlightRepository(prisma, source);

    await repo.findInstances(VALID_OPTS);

    expect(generateFlightsForRoute).not.toHaveBeenCalled();
    expect(mocks.airport.findUnique).not.toHaveBeenCalled();
  });

  it('returns empty (no LLM call) when an airport does not exist — Scope B guard', async () => {
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateFlightsForRoute } = makeMockLlmSource();
    mocks.flightInstance.findMany.mockResolvedValueOnce([]);
    mocks.flightInstance.count.mockResolvedValueOnce(0); // no cache coverage → LLM path
    // Origin missing.
    mocks.airport.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 2, iataCode: 'BER', city: { name: 'Berlin' } });
    const repo = new FlightRepository(prisma, source);

    const rows = await repo.findInstances(VALID_OPTS);

    expect(rows).toEqual([]);
    expect(generateFlightsForRoute).not.toHaveBeenCalled();
  });

  it('returns empty when LLM returns null (fail-open)', async () => {
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateFlightsForRoute } = makeMockLlmSource();
    mocks.flightInstance.findMany.mockResolvedValueOnce([]);
    mocks.flightInstance.count.mockResolvedValueOnce(0);
    mocks.airport.findUnique
      .mockResolvedValueOnce({
        id: 1,
        iataCode: 'ATH',
        city: { name: 'Athens' },
      })
      .mockResolvedValueOnce({
        id: 2,
        iataCode: 'BER',
        city: { name: 'Berlin' },
      });
    mocks.airline.findMany.mockResolvedValueOnce([
      { id: 10, iataCode: 'LH', name: 'Lufthansa' },
    ]);
    generateFlightsForRoute.mockResolvedValueOnce(null);
    const repo = new FlightRepository(prisma, source);

    const rows = await repo.findInstances(VALID_OPTS);

    expect(rows).toEqual([]);
    expect(generateFlightsForRoute).toHaveBeenCalledTimes(1);
    expect(mocks.flightDefinition.upsert).not.toHaveBeenCalled();
  });

  it('does not call LLM when (route, date) is already cached but the user filters excluded every row', async () => {
    // Regression: dbRows is post-filter. A prior LLM call may have
    // populated ATH→BER on 2026-08-20 with only stops=1 offers; a
    // follow-up query with nonstopOnly=true would filter all of them
    // out. Without a filter-independent coverage check, that miss
    // would re-fire the LLM on every distinct filter combination.
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateFlightsForRoute } = makeMockLlmSource();
    mocks.flightInstance.findMany.mockResolvedValueOnce([]); // filtered miss
    mocks.flightInstance.count.mockResolvedValueOnce(4); // route/date IS populated
    const repo = new FlightRepository(prisma, source);

    const rows = await repo.findInstances({
      ...VALID_OPTS,
      nonstopOnly: true,
      airlineCodes: ['A3'],
    });

    expect(rows).toEqual([]);
    expect(generateFlightsForRoute).not.toHaveBeenCalled();
    expect(mocks.airport.findUnique).not.toHaveBeenCalled();
  });

  it('fails open on isolated persistence errors — logs the offending offer and returns the re-query result', async () => {
    // Regression: an isolated Prisma failure on one offer must not
    // sink the whole search. LlmFlightSource fails open on every
    // error (see its header); the repository extends that contract to
    // persistence. Surviving offers still land; the caller gets the
    // re-query result instead of INTERNAL_ERROR.
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateFlightsForRoute } = makeMockLlmSource();
    mocks.flightInstance.findMany
      .mockResolvedValueOnce([]) // initial cache lookup
      .mockResolvedValueOnce([SAMPLE_FLIGHT_ROW]); // re-query after upsert
    mocks.flightInstance.count.mockResolvedValueOnce(0);
    mocks.airport.findUnique
      .mockResolvedValueOnce({ id: 1, iataCode: 'ATH', city: { name: 'Athens' } })
      .mockResolvedValueOnce({ id: 2, iataCode: 'BER', city: { name: 'Berlin' } });
    mocks.airline.findMany.mockResolvedValueOnce([
      { id: 10, iataCode: 'LH', name: 'Lufthansa' },
      { id: 11, iataCode: 'A3', name: 'Aegean Airlines' },
    ]);
    generateFlightsForRoute.mockResolvedValueOnce(VALID_LLM_OUTPUT);
    // Offer #1 succeeds. Offer #2 throws. Offer #3 succeeds.
    mocks.flightDefinition.upsert
      .mockResolvedValueOnce({ id: 100, originAirportId: 1, destinationAirportId: 2 })
      .mockRejectedValueOnce(new Error('Postgres connection blip'))
      .mockResolvedValueOnce({ id: 102, originAirportId: 1, destinationAirportId: 2 });
    mocks.flightInstance.upsert.mockResolvedValue({ id: 1000 });
    const repo = new FlightRepository(prisma, source);

    const rows = await repo.findInstances(VALID_OPTS);

    // Search survived: got the re-query rows, not an exception.
    expect(rows).toHaveLength(1);
    // Two successful FlightInstance upserts (offer #1 and #3); offer #2's
    // flightDefinition.upsert rejected before the flightInstance step.
    expect(mocks.flightInstance.upsert).toHaveBeenCalledTimes(2);
    // Re-query still happened.
    expect(mocks.flightInstance.findMany).toHaveBeenCalledTimes(2);
  });

  it('skips FlightInstance upsert when an existing FlightDefinition on that (airline, flightNumber) is for a different route', async () => {
    // Regression: FlightDefinition.@@unique is (airlineId, flightNumber) —
    // route is NOT part of the key. If seed (or a prior LLM call) has
    // LH 1234 as ATH→FRA and the LLM now emits LH 1234 for ATH→BER, the
    // find-or-create upsert returns the ATH→FRA row. We must NOT then
    // create a FlightInstance under that mismatched definition — doing
    // so would surface the fabricated instance under the wrong route on
    // later queries.
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateFlightsForRoute } = makeMockLlmSource();
    mocks.flightInstance.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.flightInstance.count.mockResolvedValueOnce(0);
    mocks.airport.findUnique
      .mockResolvedValueOnce({
        id: 1,
        iataCode: 'ATH',
        city: { name: 'Athens' },
      })
      .mockResolvedValueOnce({
        id: 2,
        iataCode: 'BER',
        city: { name: 'Berlin' },
      });
    mocks.airline.findMany.mockResolvedValueOnce([
      { id: 10, iataCode: 'LH', name: 'Lufthansa' },
    ]);
    generateFlightsForRoute.mockResolvedValueOnce({
      flights: [
        {
          airlineIata: 'LH',
          flightNumber: '1234',
          departureTimeHHMM: '08:00',
          durationMinutes: 175,
          basePriceEUR: 187.5,
          stops: 0,
          aircraft: 'A320',
          seatsAvailable: 42,
        },
      ],
    });
    // Pre-existing definition is ATH(1)→FRA(3), NOT the requested
    // ATH(1)→BER(2). Upsert returns the collision row unchanged.
    mocks.flightDefinition.upsert.mockResolvedValueOnce({
      id: 555,
      airlineId: 10,
      flightNumber: '1234',
      originAirportId: 1,
      destinationAirportId: 3,
    });
    const repo = new FlightRepository(prisma, source);

    await repo.findInstances({ ...VALID_OPTS });

    expect(mocks.flightDefinition.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.flightInstance.upsert).not.toHaveBeenCalled();
  });

  it('calls LLM with correct args on cache miss + upserts + re-queries', async () => {
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateFlightsForRoute } = makeMockLlmSource();
    // First cache lookup: empty. Second (re-query after upsert): returns
    // the newly-generated rows.
    mocks.flightInstance.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([SAMPLE_FLIGHT_ROW]);
    mocks.flightInstance.count.mockResolvedValueOnce(0);
    mocks.airport.findUnique
      .mockResolvedValueOnce({
        id: 1,
        iataCode: 'ATH',
        city: { name: 'Athens' },
      })
      .mockResolvedValueOnce({
        id: 2,
        iataCode: 'BER',
        city: { name: 'Berlin' },
      });
    mocks.airline.findMany.mockResolvedValueOnce([
      { id: 10, iataCode: 'LH', name: 'Lufthansa' },
      { id: 11, iataCode: 'A3', name: 'Aegean Airlines' },
    ]);
    generateFlightsForRoute.mockResolvedValueOnce(VALID_LLM_OUTPUT);
    // Return matches the requested route (ATH id=1 → BER id=2) so the
    // route-mismatch guard in upsertOffer does not skip the FlightInstance
    // step.
    mocks.flightDefinition.upsert.mockResolvedValue({
      id: 999,
      originAirportId: 1,
      destinationAirportId: 2,
    });
    mocks.flightInstance.upsert.mockResolvedValue({ id: 1000 });
    const repo = new FlightRepository(prisma, source);

    const rows = await repo.findInstances(VALID_OPTS);

    // LLM received the resolved airport + airline context.
    expect(generateFlightsForRoute).toHaveBeenCalledTimes(1);
    const llmArgs = generateFlightsForRoute.mock.calls[0][0];
    expect(llmArgs.originAirport.iataCode).toBe('ATH');
    expect(llmArgs.destinationAirport.iataCode).toBe('BER');
    expect(llmArgs.departureDate).toBe('2026-08-20');
    expect(llmArgs.allowedAirlines).toEqual([
      { iataCode: 'LH', name: 'Lufthansa' },
      { iataCode: 'A3', name: 'Aegean Airlines' },
    ]);

    // Upserts fired once per offer (3 in VALID_LLM_OUTPUT).
    expect(mocks.flightDefinition.upsert).toHaveBeenCalledTimes(3);
    expect(mocks.flightInstance.upsert).toHaveBeenCalledTimes(3);

    // Return is the re-query result.
    expect(rows).toHaveLength(1);
    expect(mocks.flightInstance.findMany).toHaveBeenCalledTimes(2);
  });

  it('threads caller filters (nonstopOnly + airlineCodes) into LLM callerPreferences', async () => {
    // Regression: without these hints the LLM has no visibility into
    // the caller's filters and can produce offers the queryDb filter
    // throws away — burning tokens for no visible UX.
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateFlightsForRoute } = makeMockLlmSource();
    mocks.flightInstance.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.flightInstance.count.mockResolvedValueOnce(0);
    mocks.airport.findUnique
      .mockResolvedValueOnce({ id: 1, iataCode: 'ATH', city: { name: 'Athens' } })
      .mockResolvedValueOnce({ id: 2, iataCode: 'BER', city: { name: 'Berlin' } });
    mocks.airline.findMany.mockResolvedValueOnce([
      { id: 10, iataCode: 'LH', name: 'Lufthansa' },
      { id: 11, iataCode: 'A3', name: 'Aegean Airlines' },
    ]);
    generateFlightsForRoute.mockResolvedValueOnce({ flights: [] });
    const repo = new FlightRepository(prisma, source);

    await repo.findInstances({
      ...VALID_OPTS,
      nonstopOnly: true,
      airlineCodes: ['A3'],
    });

    const llmArgs = generateFlightsForRoute.mock.calls[0][0];
    expect(llmArgs.callerPreferences).toEqual({
      nonstopOnly: true,
      preferredAirlineCodes: ['A3'],
    });
  });
});
