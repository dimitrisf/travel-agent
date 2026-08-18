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

  it('calls LLM with correct args on cache miss + upserts + re-queries', async () => {
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateFlightsForRoute } = makeMockLlmSource();
    // First cache lookup: empty. Second (re-query after upsert): returns
    // the newly-generated rows.
    mocks.flightInstance.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([SAMPLE_FLIGHT_ROW]);
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
    mocks.flightDefinition.upsert.mockResolvedValue({ id: 999 });
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
});
