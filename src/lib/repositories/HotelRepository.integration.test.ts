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
import { seedCity } from '@/lib/testing/seedFixtures';
import { HotelRepository } from './HotelRepository';
import type { LlmHotelSource } from '../llm/LlmHotelSource';
import type { HotelGenerationResponse } from '../llm/hotelGenerationSchema';

// Phase 2b — integration tests for HotelRepository.findAvailable,
// the cache-first repo introduced in Stage 23. Sister file to
// FlightRepository.integration.test.ts; same structure — DB-only
// cache path, Scope B guard, LLM fallback (mocked, zero tokens),
// plus one hotel-specific test (#7) for the defaultRoomsAvailable +
// basePrice anchoring that prevents LLM drift across separate
// generations for the same RoomType.

// Same pattern as mockLlmFlightSource — returns a canned response
// so integration tests remain zero-token. Cast via `unknown` because
// LlmHotelSource is a class with private fields; structural typing
// rejects a plain object.
function mockLlmHotelSource(
  response: HotelGenerationResponse | null,
): {
  source: LlmHotelSource;
  fn: ReturnType<typeof vi.fn>;
} {
  const fn = vi.fn(async () => response);
  return {
    source: { generateHotelsForCity: fn } as unknown as LlmHotelSource,
    fn,
  };
}

// Shared realistic date range across all tests. Two nights so
// per-night vs total-price assertions are non-trivial.
const CHECKIN = '2026-09-10';
const CHECKOUT = '2026-09-12';
const NIGHTS = 2;

describe('HotelRepository.findAvailable (integration)', () => {
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

  it('cache hit: returns projected HotelSearchRow with correct JOIN shape (city, amenities, cancellation policy, room type, totals)', async () => {
    const berlin = await seedCity(prisma, 'Berlin');

    const wifi = await prisma.amenity.create({ data: { name: 'Free WiFi' } });
    const breakfast = await prisma.amenity.create({ data: { name: 'Breakfast' } });

    const hotel = await prisma.hotel.create({
      data: {
        name: 'Berlin Central Hotel',
        cityId: berlin.id,
        address: '1 Main St, Berlin',
        stars: 4,
        rating: 8.5,
        latitude: 52.52,
        longitude: 13.405,
      },
    });
    await prisma.cancellationPolicy.create({
      data: {
        hotelId: hotel.id,
        freeCancellation: true,
        description: 'Free cancellation up to 24 hours before check-in.',
      },
    });
    await prisma.hotelAmenity.createMany({
      data: [
        { hotelId: hotel.id, amenityId: wifi.id },
        { hotelId: hotel.id, amenityId: breakfast.id },
      ],
    });
    const room = await prisma.roomType.create({
      data: {
        hotelId: hotel.id,
        name: 'Standard Double',
        maxGuests: 2,
        beds: 1,
        basePrice: 150,
      },
    });
    // 2 nights of availability with per-night price 150.
    await prisma.availability.createMany({
      data: [
        {
          roomTypeId: room.id,
          date: new Date('2026-09-10T00:00:00.000Z'),
          roomsAvailable: 5,
          price: 150,
        },
        {
          roomTypeId: room.id,
          date: new Date('2026-09-11T00:00:00.000Z'),
          roomsAvailable: 5,
          price: 150,
        },
      ],
    });

    // No llmSource wired — DB-only path.
    const repo = new HotelRepository(prisma);
    const rows = await repo.findAvailable({
      cityName: 'Berlin',
      checkinDate: CHECKIN,
      checkoutDate: CHECKOUT,
      guests: 2,
      rooms: 1,
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.hotelName).toBe('Berlin Central Hotel');
    expect(row.city).toBe('Berlin');
    expect(row.stars).toBe(4);
    expect(row.rating).toBe(8.5);
    expect(row.roomTypeName).toBe('Standard Double');
    // 2 nights × €150 = €300 total, €150 avg. round1 rolls up cleanly.
    expect(row.nights).toBe(NIGHTS);
    expect(row.totalPrice).toBe(300);
    expect(row.avgPricePerNight).toBe(150);
    expect(row.currency).toBe('EUR');
    // Amenities projected as string[] via the HotelAmenity → Amenity join.
    expect(row.amenities.sort()).toEqual(['Breakfast', 'Free WiFi']);
    // Cancellation policy projection.
    expect(row.freeCancellation).toBe(true);
    expect(row.cancellationDescription).toBe(
      'Free cancellation up to 24 hours before check-in.',
    );
  });

  it('cache hit with combined SQL filters (minStars + freeCancellationRequired + requiredAmenities): only the matching hotel comes back', async () => {
    const berlin = await seedCity(prisma, 'Berlin');
    const wifi = await prisma.amenity.create({ data: { name: 'Free WiFi' } });

    // Small helper — every hotel in this test has 2 nights of
    // availability at €100 for 1 room type sleeping 2 guests. The
    // per-hotel variance is stars / policy / amenity presence only.
    async function seedTestHotel(opts: {
      name: string;
      stars: number;
      freeCancellation: boolean;
      withWifi: boolean;
    }) {
      const h = await prisma.hotel.create({
        data: {
          name: opts.name,
          cityId: berlin.id,
          address: `${opts.name} address`,
          stars: opts.stars,
          rating: 8.0,
          latitude: 52.52,
          longitude: 13.405,
        },
      });
      await prisma.cancellationPolicy.create({
        data: {
          hotelId: h.id,
          freeCancellation: opts.freeCancellation,
          description: opts.freeCancellation ? 'Free cancel.' : 'Non-refundable.',
        },
      });
      if (opts.withWifi) {
        await prisma.hotelAmenity.create({
          data: { hotelId: h.id, amenityId: wifi.id },
        });
      }
      const room = await prisma.roomType.create({
        data: {
          hotelId: h.id,
          name: 'Standard Double',
          maxGuests: 2,
          beds: 1,
          basePrice: 100,
        },
      });
      await prisma.availability.createMany({
        data: [CHECKIN, '2026-09-11'].map((d) => ({
          roomTypeId: room.id,
          date: new Date(`${d}T00:00:00.000Z`),
          roomsAvailable: 5,
          price: 100,
        })),
      });
      return h;
    }

    // Four hotels; each of h2/h3/h4 fails exactly ONE filter so the
    // "only h1 survives" assertion also proves each filter is doing
    // its job independently.
    const h1 = await seedTestHotel({ name: 'MATCH', stars: 5, freeCancellation: true, withWifi: true });
    await seedTestHotel({ name: 'FAIL_STARS', stars: 4, freeCancellation: true, withWifi: true });
    await seedTestHotel({ name: 'FAIL_POLICY', stars: 5, freeCancellation: false, withWifi: true });
    await seedTestHotel({ name: 'FAIL_AMENITY', stars: 5, freeCancellation: true, withWifi: false });

    const repo = new HotelRepository(prisma);
    const rows = await repo.findAvailable({
      cityName: 'Berlin',
      checkinDate: CHECKIN,
      checkoutDate: CHECKOUT,
      guests: 2,
      rooms: 1,
      minStars: 5,
      freeCancellationRequired: true,
      requiredAmenities: ['Free WiFi'],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hotelId).toBe(h1.id);
    expect(rows[0].hotelName).toBe('MATCH');
  });

  it('cache miss + no llmSource wired → returns empty (pre-Stage-23 behavior preserved)', async () => {
    // City seeded so it's in DB; just no hotels on it. If Scope B tripped
    // by virtue of the city being missing this test would false-pass.
    await seedCity(prisma, 'Berlin');

    const repo = new HotelRepository(prisma);
    const rows = await repo.findAvailable({
      cityName: 'Berlin',
      checkinDate: CHECKIN,
      checkoutDate: CHECKOUT,
      guests: 2,
      rooms: 1,
    });

    expect(rows).toEqual([]);
  });

  it('cache miss + city NOT in CITIES lookup → Scope B guard returns empty; LLM never called', async () => {
    // "Marrakesh" isn't in src/lib/cities.ts CITIES, so even though a
    // City row exists in DB the LlmHotelSource can't be invoked
    // (no center coords to anchor generation). Repository must
    // return empty without calling the LLM.
    await prisma.country.create({ data: { name: 'Morocco', isoCode: 'MA' } });
    await prisma.city.create({
      data: { name: 'Marrakesh', countryId: (await prisma.country.findFirst({ where: { isoCode: 'MA' } }))!.id },
    });

    const { source, fn } = mockLlmHotelSource({ hotels: [] });
    const repo = new HotelRepository(prisma, source);

    const rows = await repo.findAvailable({
      cityName: 'Marrakesh',
      checkinDate: CHECKIN,
      checkoutDate: CHECKOUT,
      guests: 2,
      rooms: 1,
    });

    expect(rows).toEqual([]);
    // The whole point of the Scope B guard: don't burn tokens on
    // cities the app can't render coordinates for.
    expect(fn).toHaveBeenCalledTimes(0);
  });

  it('cache miss + LLM offers → upserts Hotel + RoomType + Availability + CancellationPolicy + HotelAmenity, re-query returns them fully hydrated', async () => {
    await seedCity(prisma, 'Berlin');
    // Amenities must exist as rows for upsertHotelAmenities' findMany to
    // resolve them — the LLM only supplies names, HotelAmenity join rows
    // reference the Amenity id.
    await prisma.amenity.create({ data: { name: 'Free WiFi' } });
    await prisma.amenity.create({ data: { name: 'Breakfast' } });

    const { source } = mockLlmHotelSource({
      hotels: [
        {
          name: 'Kreuzberg Boutique',
          address: '42 Skalitzer Str., Berlin',
          stars: 4,
          rating: 8.4,
          latitude: 52.5,
          longitude: 13.42,
          amenities: ['Free WiFi', 'Breakfast'],
          cancellationPolicy: {
            freeCancellation: true,
            description: 'Free cancel up to check-in day.',
          },
          roomTypes: [
            {
              name: 'Standard Double',
              maxGuests: 2,
              beds: 1,
              basePriceEUR: 130,
              roomsAvailable: 10,
            },
          ],
        },
      ],
    });
    const repo = new HotelRepository(prisma, source);

    const rows = await repo.findAvailable({
      cityName: 'Berlin',
      checkinDate: CHECKIN,
      checkoutDate: CHECKOUT,
      guests: 2,
      rooms: 1,
    });

    // Re-query surfaced the LLM-upserted hotel.
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.hotelName).toBe('Kreuzberg Boutique');
    // 2 nights × €130 = €260 total; per-night price came from
    // RoomType.basePrice (Scope B — no per-date variation from LLM).
    expect(row.totalPrice).toBe(260);
    expect(row.avgPricePerNight).toBe(130);
    // Amenities + policy resolved through the sibling upserts.
    expect(row.amenities.sort()).toEqual(['Breakfast', 'Free WiFi']);
    expect(row.freeCancellation).toBe(true);

    // Provenance stamped on Hotel and RoomType so future ops can
    // distinguish LLM rows from seeded ones.
    const hotels = await prisma.hotel.findMany();
    expect(hotels).toHaveLength(1);
    expect(hotels[0].externalSource).toBe('llm');
    expect(hotels[0].generatedAt).not.toBeNull();

    const roomTypes = await prisma.roomType.findMany();
    expect(roomTypes).toHaveLength(1);
    expect(roomTypes[0].externalSource).toBe('llm');
    // defaultRoomsAvailable anchored from the first LLM value —
    // separately asserted in the anchor-drift test below.
    expect(roomTypes[0].defaultRoomsAvailable).toBe(10);
    expect(roomTypes[0].basePrice).toBe(130);

    // Per-night Availability, CancellationPolicy, HotelAmenity all
    // persisted by the upsertOneHotel sibling writes.
    expect(await prisma.availability.count()).toBe(NIGHTS);
    expect(await prisma.cancellationPolicy.count()).toBe(1);
    expect(await prisma.hotelAmenity.count()).toBe(2);
  });

  it('cache miss + LLM returns null → fail-open, returns empty without throwing', async () => {
    await seedCity(prisma, 'Berlin');

    const { source } = mockLlmHotelSource(null);
    const repo = new HotelRepository(prisma, source);

    const rows = await repo.findAvailable({
      cityName: 'Berlin',
      checkinDate: CHECKIN,
      checkoutDate: CHECKOUT,
      guests: 2,
      rooms: 1,
    });

    expect(rows).toEqual([]);
    // Nothing upserted on the null-return path.
    expect(await prisma.hotel.count()).toBe(0);
    expect(await prisma.roomType.count()).toBe(0);
    expect(await prisma.availability.count()).toBe(0);
  });

  it('anchor drift prevention: a second LLM call for the same Hotel+RoomType with different roomsAvailable/basePriceEUR does NOT overwrite RoomType.defaultRoomsAvailable / basePrice, and new Availability rows use the anchored values', async () => {
    // Setup: pre-existing Hotel + RoomType with anchored defaults
    // (defaultRoomsAvailable=10, basePrice=100). Availability seeded
    // for an earlier date range (Sep 5-7); the test query below asks
    // for a fresh window (Sep 10-12) so hasCityDateCoverage on the
    // NEW window returns 0 → LLM fires.
    const berlin = await seedCity(prisma, 'Berlin');
    const hotel = await prisma.hotel.create({
      data: {
        name: 'Anchor Hotel',
        cityId: berlin.id,
        address: '1 Anchor St, Berlin',
        stars: 4,
        rating: 8.0,
        latitude: 52.52,
        longitude: 13.405,
        externalSource: 'llm',
      },
    });
    const roomType = await prisma.roomType.create({
      data: {
        hotelId: hotel.id,
        name: 'Standard Double',
        maxGuests: 2,
        beds: 1,
        basePrice: 100,
        defaultRoomsAvailable: 10,
        externalSource: 'llm',
      },
    });
    // Availability for Sep 5-7 (an earlier stay) — irrelevant to the
    // query below but proves the pre-existing state.
    await prisma.availability.createMany({
      data: ['2026-09-05', '2026-09-06'].map((d) => ({
        roomTypeId: roomType.id,
        date: new Date(`${d}T00:00:00.000Z`),
        roomsAvailable: 10,
        price: 100,
      })),
    });

    // Second LLM call returns SAME hotel + room-type names (upsert
    // reuses via cityId_name + hotelId_name unique indexes) but with
    // DRIFTED numbers: roomsAvailable=30, basePriceEUR=200. These
    // must NOT overwrite the anchor.
    const { source } = mockLlmHotelSource({
      hotels: [
        {
          name: 'Anchor Hotel',
          address: '1 Anchor St, Berlin',
          stars: 4,
          rating: 8.0,
          latitude: 52.52,
          longitude: 13.405,
          amenities: [],
          cancellationPolicy: {
            freeCancellation: true,
            description: 'Free cancel.',
          },
          roomTypes: [
            {
              name: 'Standard Double',
              maxGuests: 2,
              beds: 1,
              basePriceEUR: 200,
              roomsAvailable: 30,
            },
          ],
        },
      ],
    });
    const repo = new HotelRepository(prisma, source);

    const rows = await repo.findAvailable({
      cityName: 'Berlin',
      checkinDate: CHECKIN,
      checkoutDate: CHECKOUT,
      guests: 2,
      rooms: 1,
    });

    expect(rows).toHaveLength(1);
    // The projected row's per-night price comes from Availability.price,
    // which was written from the anchored RoomType.basePrice, not the
    // LLM's fresh 200.
    expect(rows[0].avgPricePerNight).toBe(100);
    expect(rows[0].totalPrice).toBe(200);

    // RoomType row unchanged — upsert's update:{} means find-or-create,
    // and the anchor fields we set on the initial insert survive.
    const rtAfter = await prisma.roomType.findUnique({
      where: { id: roomType.id },
    });
    expect(rtAfter?.defaultRoomsAvailable).toBe(10);
    expect(rtAfter?.basePrice).toBe(100);

    // NEW Availability rows for the queried dates (Sep 10-11) landed
    // with the ANCHORED capacity (10) and ANCHORED price (100), NOT
    // the LLM's fresh 30 and 200. This is what the whole anchoring
    // scheme in upsertRoomTypeWithAvailability exists to protect.
    const newAvail = await prisma.availability.findMany({
      where: {
        roomTypeId: roomType.id,
        date: { gte: new Date('2026-09-10T00:00:00.000Z') },
      },
      orderBy: { date: 'asc' },
    });
    expect(newAvail).toHaveLength(NIGHTS);
    for (const a of newAvail) {
      expect(a.roomsAvailable).toBe(10);
      expect(a.price).toBe(100);
    }
  });
});
