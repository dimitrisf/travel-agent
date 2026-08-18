import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { HotelRepository, type HotelSearchOptions } from './HotelRepository';
import type { LlmHotelSource } from '../llm/LlmHotelSource';
import type { HotelGenerationResponse } from '../llm/hotelGenerationSchema';

// Stage 23 integration tests for HotelRepository — cache-first
// orchestration + LLM fallback. Same shape as FlightRepository tests;
// see that file for the shared rationale.

const VALID_OPTS: HotelSearchOptions = {
  cityName: 'Athens',
  checkinDate: '2026-08-20',
  checkoutDate: '2026-08-22',
  guests: 2,
  rooms: 1,
};

function makeMockPrisma() {
  const prisma = {
    hotel: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    city: {
      findUnique: vi.fn(),
    },
    roomType: {
      upsert: vi.fn(),
    },
    availability: {
      upsert: vi.fn(),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, mocks: prisma };
}

function makeMockLlmSource() {
  const generateHotelsForCity = vi.fn();
  const source = { generateHotelsForCity } as unknown as LlmHotelSource;
  return { source, generateHotelsForCity };
}

const VALID_LLM_OUTPUT: HotelGenerationResponse = {
  hotels: [
    {
      name: 'Syntagma Grand',
      address: 'Vasilissis Amalias 15, 10557 Athens',
      stars: 4,
      rating: 8.7,
      latitude: 37.9756,
      longitude: 23.7348,
      roomTypes: [
        {
          name: 'Standard Double',
          maxGuests: 2,
          beds: 1,
          basePriceEUR: 145,
          roomsAvailable: 20,
        },
      ],
    },
    {
      name: 'Monastiraki Boutique',
      address: 'Athinas 21, 10554 Athens',
      stars: 3,
      rating: 8.2,
      latitude: 37.976,
      longitude: 23.726,
      roomTypes: [
        {
          name: 'Standard Double',
          maxGuests: 2,
          beds: 1,
          basePriceEUR: 95,
          roomsAvailable: 15,
        },
      ],
    },
    {
      name: 'Kolonaki Suites',
      address: 'Skoufa 55, 10673 Athens',
      stars: 5,
      rating: 9.1,
      latitude: 37.9791,
      longitude: 23.7418,
      roomTypes: [
        {
          name: 'Executive King',
          maxGuests: 2,
          beds: 1,
          basePriceEUR: 320,
          roomsAvailable: 5,
        },
      ],
    },
  ],
};

// A pared-down Hotel row shaped the way HotelRepository.queryDb
// expects — enough to make the projection loop yield one matching
// HotelSearchRow for the requested 2-night stay.
const SAMPLE_HOTEL_ROW = {
  id: 100,
  name: 'Existing Athens Hotel',
  address: 'Adrianou 80, 10556 Athens',
  stars: 4,
  rating: 8.5,
  city: { name: 'Athens' },
  cancellationPolicy: { freeCancellation: true, description: '24h free' },
  hotelAmenities: [],
  roomTypes: [
    {
      id: 200,
      name: 'Standard Double',
      maxGuests: 2,
      availability: [
        {
          date: new Date('2026-08-20T00:00:00Z'),
          roomsAvailable: 3,
          price: 120,
        },
        {
          date: new Date('2026-08-21T00:00:00Z'),
          roomsAvailable: 3,
          price: 120,
        },
      ],
    },
  ],
};

describe('HotelRepository.findAvailable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns DB rows and skips LLM when no llmSource is injected', async () => {
    const { prisma, mocks } = makeMockPrisma();
    mocks.hotel.findMany.mockResolvedValueOnce([SAMPLE_HOTEL_ROW]);
    const repo = new HotelRepository(prisma);

    const rows = await repo.findAvailable(VALID_OPTS);

    expect(rows).toHaveLength(1);
    expect(rows[0].hotelName).toBe('Existing Athens Hotel');
    expect(mocks.city.findUnique).not.toHaveBeenCalled();
  });

  it('returns empty when DB has no matches and no llmSource is wired', async () => {
    const { prisma, mocks } = makeMockPrisma();
    mocks.hotel.findMany.mockResolvedValueOnce([]);
    const repo = new HotelRepository(prisma);

    const rows = await repo.findAvailable(VALID_OPTS);

    expect(rows).toEqual([]);
    expect(mocks.city.findUnique).not.toHaveBeenCalled();
  });

  it('cache hit with llmSource does not invoke the LLM', async () => {
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateHotelsForCity } = makeMockLlmSource();
    mocks.hotel.findMany.mockResolvedValueOnce([SAMPLE_HOTEL_ROW]);
    const repo = new HotelRepository(prisma, source);

    await repo.findAvailable(VALID_OPTS);

    expect(generateHotelsForCity).not.toHaveBeenCalled();
    expect(mocks.city.findUnique).not.toHaveBeenCalled();
  });

  it('returns empty (no LLM call) when city is not in the demo library — Scope B guard', async () => {
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateHotelsForCity } = makeMockLlmSource();
    mocks.hotel.findMany.mockResolvedValueOnce([]);
    const repo = new HotelRepository(prisma, source);

    const rows = await repo.findAvailable({
      ...VALID_OPTS,
      cityName: 'Reykjavik', // not in CITIES map
    });

    expect(rows).toEqual([]);
    expect(generateHotelsForCity).not.toHaveBeenCalled();
    // Scope B rejection short-circuits before any city DB lookup.
    expect(mocks.city.findUnique).not.toHaveBeenCalled();
  });

  it('returns empty when LLM returns null (fail-open)', async () => {
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateHotelsForCity } = makeMockLlmSource();
    mocks.hotel.findMany.mockResolvedValueOnce([]);
    mocks.city.findUnique.mockResolvedValueOnce({ id: 1 });
    mocks.hotel.findMany.mockResolvedValueOnce([]); // existing-names query
    generateHotelsForCity.mockResolvedValueOnce(null);
    const repo = new HotelRepository(prisma, source);

    const rows = await repo.findAvailable(VALID_OPTS);

    expect(rows).toEqual([]);
    expect(generateHotelsForCity).toHaveBeenCalledTimes(1);
    expect(mocks.hotel.upsert).not.toHaveBeenCalled();
  });

  it('calls LLM with correct args on cache miss + upserts + re-queries', async () => {
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateHotelsForCity } = makeMockLlmSource();
    // First cache lookup: empty. existing-names query: empty. Re-query
    // after upsert: returns the newly-generated hotel row.
    mocks.hotel.findMany
      .mockResolvedValueOnce([]) // cache lookup
      .mockResolvedValueOnce([]) // existing-names for avoid list
      .mockResolvedValueOnce([SAMPLE_HOTEL_ROW]); // re-query
    mocks.city.findUnique.mockResolvedValueOnce({ id: 1 });
    generateHotelsForCity.mockResolvedValueOnce(VALID_LLM_OUTPUT);
    mocks.hotel.upsert.mockResolvedValue({ id: 999 });
    mocks.roomType.upsert.mockResolvedValue({
      id: 888,
      defaultRoomsAvailable: 20,
    });
    mocks.availability.upsert.mockResolvedValue({ id: 777 });
    const repo = new HotelRepository(prisma, source);

    const rows = await repo.findAvailable(VALID_OPTS);

    // LLM received the resolved city + center + guest count + avoid list.
    expect(generateHotelsForCity).toHaveBeenCalledTimes(1);
    const llmArgs = generateHotelsForCity.mock.calls[0][0];
    expect(llmArgs.cityName).toBe('Athens');
    expect(llmArgs.cityId).toBe(1);
    expect(llmArgs.checkinDate).toBe('2026-08-20');
    expect(llmArgs.checkoutDate).toBe('2026-08-22');
    expect(llmArgs.guests).toBe(2);
    expect(llmArgs.existingHotelNames).toEqual([]);
    expect(llmArgs.cityCenter).toEqual({
      latitude: 37.9838,
      longitude: 23.7275,
    });

    // Upserts: 3 hotels, 3 room types (one each), 2 nights per room type = 6 Availability.
    expect(mocks.hotel.upsert).toHaveBeenCalledTimes(3);
    expect(mocks.roomType.upsert).toHaveBeenCalledTimes(3);
    expect(mocks.availability.upsert).toHaveBeenCalledTimes(6);

    // Return is the re-query result.
    expect(rows).toHaveLength(1);
    expect(rows[0].hotelName).toBe('Existing Athens Hotel');
  });
});
