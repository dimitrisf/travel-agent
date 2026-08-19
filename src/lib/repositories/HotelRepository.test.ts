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
      count: vi.fn(),
    },
    amenity: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    hotelAmenity: {
      upsert: vi.fn(),
    },
    cancellationPolicy: {
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
      amenities: ['Breakfast', 'Free WiFi', 'Gym', 'Air Conditioning'],
      cancellationPolicy: {
        freeCancellation: true,
        description: 'Free cancellation up to 24 hours before check-in.',
      },
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
      amenities: ['Free WiFi', 'Pet Friendly'],
      cancellationPolicy: {
        freeCancellation: false,
        description: 'Non-refundable — cancellations forfeit the full stay cost.',
      },
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
      amenities: ['Free WiFi', 'Spa', 'Swimming Pool', 'Breakfast'],
      cancellationPolicy: {
        freeCancellation: true,
        description: 'Free cancellation up to 48 hours before check-in.',
      },
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
    mocks.availability.count.mockResolvedValueOnce(0); // no cache coverage → falls through to Scope B
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
    mocks.availability.count.mockResolvedValueOnce(0);
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
    mocks.availability.count.mockResolvedValueOnce(0);
    mocks.city.findUnique.mockResolvedValueOnce({ id: 1 });
    generateHotelsForCity.mockResolvedValueOnce(VALID_LLM_OUTPUT);
    mocks.hotel.upsert.mockResolvedValue({ id: 999 });
    mocks.roomType.upsert.mockResolvedValue({
      id: 888,
      defaultRoomsAvailable: 20,
      basePrice: 145,
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
    // One CancellationPolicy per LLM hotel, so the freeCancellation
    // filter and projection on the post-upsert re-query has data.
    expect(mocks.cancellationPolicy.upsert).toHaveBeenCalledTimes(3);

    // Return is the re-query result.
    expect(rows).toHaveLength(1);
    expect(rows[0].hotelName).toBe('Existing Athens Hotel');
  });

  it('does not call LLM when (city, dateRange, guests) is already cached but the user filters excluded every row', async () => {
    // Regression: dbRows is post-filter. A prior LLM call may have
    // populated Athens 2026-08-20..22 with 3-star hotels only; a
    // follow-up query with minStars=5 would filter all of them out.
    // Without a filter-independent coverage check, that miss would
    // re-fire the LLM on every distinct filter combination.
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateHotelsForCity } = makeMockLlmSource();
    mocks.hotel.findMany.mockResolvedValueOnce([]); // filtered miss
    mocks.availability.count.mockResolvedValueOnce(6); // city+range IS populated
    const repo = new HotelRepository(prisma, source);

    const rows = await repo.findAvailable({
      ...VALID_OPTS,
      minStars: 5,
      maxPricePerNight: 100,
      requiredAmenities: ['Spa'],
      freeCancellationRequired: true,
    });

    expect(rows).toEqual([]);
    expect(generateHotelsForCity).not.toHaveBeenCalled();
    expect(mocks.city.findUnique).not.toHaveBeenCalled();
  });

  it('fails open on isolated per-hotel persistence errors — logs and continues, returns the re-query result', async () => {
    // Regression: an isolated Prisma failure inside one hotel's nested
    // upsert chain must not sink the whole search. LlmHotelSource fails
    // open on every error; the repository extends that contract to
    // persistence. Surviving hotels still land; the caller gets the
    // re-query result instead of INTERNAL_ERROR.
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateHotelsForCity } = makeMockLlmSource();
    mocks.hotel.findMany
      .mockResolvedValueOnce([]) // cache lookup
      .mockResolvedValueOnce([]) // existing-names
      .mockResolvedValueOnce([SAMPLE_HOTEL_ROW]); // re-query
    mocks.availability.count.mockResolvedValueOnce(0);
    mocks.city.findUnique.mockResolvedValueOnce({ id: 1 });
    generateHotelsForCity.mockResolvedValueOnce(VALID_LLM_OUTPUT);
    // Hotel #1 succeeds. Hotel #2's outer Hotel.upsert throws. Hotel #3 succeeds.
    mocks.hotel.upsert
      .mockResolvedValueOnce({ id: 101 })
      .mockRejectedValueOnce(new Error('Postgres statement timeout'))
      .mockResolvedValueOnce({ id: 103 });
    mocks.roomType.upsert.mockResolvedValue({
      id: 888,
      defaultRoomsAvailable: 20,
      basePrice: 145,
    });
    mocks.availability.upsert.mockResolvedValue({ id: 777 });
    const repo = new HotelRepository(prisma, source);

    const rows = await repo.findAvailable(VALID_OPTS);

    // Search survived: got the re-query rows, not an exception.
    expect(rows).toHaveLength(1);
    // Both surviving hotels ran their nested chain to completion:
    //   2 hotels × 1 RoomType each = 2 roomType.upsert calls
    //   2 hotels × 1 RoomType × 2 nights = 4 availability.upsert calls
    expect(mocks.roomType.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.availability.upsert).toHaveBeenCalledTimes(4);
    // Re-query still happened.
    expect(mocks.hotel.findMany).toHaveBeenCalledTimes(3);
  });

  it('anchors Availability.price to RoomType.basePrice, not the LLM re-fabricated basePriceEUR', async () => {
    // Regression: without the anchor, a second LLM call that reuses an
    // existing RoomType (hotelId_name collision) would write new
    // Availability rows priced at the LLM's fresh value, diverging from
    // the canonical RoomType.basePrice set on first create. This
    // mirrors the roomsAvailable anchor pattern already in place.
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateHotelsForCity } = makeMockLlmSource();
    mocks.hotel.findMany
      .mockResolvedValueOnce([]) // cache lookup
      .mockResolvedValueOnce([]) // existing-names for avoid list
      .mockResolvedValueOnce([]); // re-query
    mocks.availability.count.mockResolvedValueOnce(0);
    mocks.city.findUnique.mockResolvedValueOnce({ id: 1 });
    // Single hotel, single room type, single night — keeps the assertion tight.
    generateHotelsForCity.mockResolvedValueOnce({
      hotels: [
        {
          name: 'Syntagma Grand',
          address: 'Vasilissis Amalias 15, 10557 Athens',
          stars: 4,
          rating: 8.7,
          latitude: 37.9756,
          longitude: 23.7348,
          amenities: [],
          cancellationPolicy: { freeCancellation: true, description: '24h' },
          roomTypes: [
            {
              name: 'Standard Double',
              maxGuests: 2,
              beds: 1,
              basePriceEUR: 150, // LLM's fresh value on this call
              roomsAvailable: 15,
            },
          ],
        },
      ],
    });
    mocks.hotel.upsert.mockResolvedValue({ id: 999 });
    // Existing RoomType anchor: basePrice was set to 120 on a prior LLM
    // call. This upsert (find-or-create) returns the pre-existing row
    // unchanged — NOT the LLM's fresh 150.
    mocks.roomType.upsert.mockResolvedValue({
      id: 888,
      defaultRoomsAvailable: 20,
      basePrice: 120,
    });
    mocks.availability.upsert.mockResolvedValue({ id: 777 });
    const repo = new HotelRepository(prisma, source);

    await repo.findAvailable({
      ...VALID_OPTS,
      checkinDate: '2026-08-25',
      checkoutDate: '2026-08-26',
    });

    expect(mocks.availability.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.availability.upsert.mock.calls[0][0] as {
      create: { price: number; roomsAvailable: number };
    };
    expect(call.create.price).toBe(120); // anchor, not 150
    expect(call.create.roomsAvailable).toBe(20); // symmetric anchor
  });

  it('persists CancellationPolicy + HotelAmenity rows for each LLM hotel', async () => {
    // Guards the bug where upsertHotels used to only write Hotel /
    // RoomType / Availability and skip amenities + cancellation —
    // which made the freeCancellationRequired and requiredAmenities
    // filters on the post-upsert re-query filter out every LLM hotel.
    const { prisma, mocks } = makeMockPrisma();
    const { source, generateHotelsForCity } = makeMockLlmSource();
    mocks.hotel.findMany
      .mockResolvedValueOnce([]) // cache lookup
      .mockResolvedValueOnce([]) // existing-names for avoid list
      .mockResolvedValueOnce([SAMPLE_HOTEL_ROW]); // re-query
    mocks.availability.count.mockResolvedValueOnce(0);
    mocks.city.findUnique.mockResolvedValueOnce({ id: 1 });
    generateHotelsForCity.mockResolvedValueOnce(VALID_LLM_OUTPUT);
    // Return a distinct hotel id per upsert call so we can verify the
    // join rows carry the right hotelId.
    mocks.hotel.upsert
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 })
      .mockResolvedValueOnce({ id: 103 });
    mocks.roomType.upsert.mockResolvedValue({
      id: 888,
      defaultRoomsAvailable: 20,
      basePrice: 145,
    });
    mocks.availability.upsert.mockResolvedValue({ id: 777 });
    // Amenity.findMany resolves the LLM's names to the corresponding
    // Amenity rows in the DB — one row per unique name in the offer.
    mocks.amenity.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])
      .mockResolvedValueOnce([{ id: 2 }, { id: 5 }])
      .mockResolvedValueOnce([{ id: 2 }, { id: 6 }, { id: 7 }, { id: 1 }]);
    const repo = new HotelRepository(prisma, source);

    await repo.findAvailable(VALID_OPTS);

    // 3 hotels → 3 cancellation policies with the LLM's booleans/descriptions.
    expect(mocks.cancellationPolicy.upsert).toHaveBeenCalledTimes(3);
    const policyCalls = mocks.cancellationPolicy.upsert.mock.calls.map(
      (c: unknown[]) => c[0] as { where: { hotelId: number }; create: { freeCancellation: boolean; description: string } },
    );
    expect(policyCalls[0].where.hotelId).toBe(101);
    expect(policyCalls[0].create.freeCancellation).toBe(true);
    expect(policyCalls[1].where.hotelId).toBe(102);
    expect(policyCalls[1].create.freeCancellation).toBe(false);
    expect(policyCalls[2].where.hotelId).toBe(103);
    expect(policyCalls[2].create.freeCancellation).toBe(true);

    // HotelAmenity join rows: 4 + 2 + 4 = 10 (matches Amenity.findMany results).
    expect(mocks.amenity.findMany).toHaveBeenCalledTimes(3);
    expect(mocks.hotelAmenity.upsert).toHaveBeenCalledTimes(10);
    // Amenity.findMany is called with the LLM's amenity names for each hotel.
    const amenityLookups = mocks.amenity.findMany.mock.calls.map(
      (c: unknown[]) => c[0] as { where: { name: { in: string[] } } },
    );
    expect(amenityLookups[0].where.name.in).toEqual([
      'Breakfast',
      'Free WiFi',
      'Gym',
      'Air Conditioning',
    ]);
    expect(amenityLookups[1].where.name.in).toEqual([
      'Free WiFi',
      'Pet Friendly',
    ]);
  });
});
