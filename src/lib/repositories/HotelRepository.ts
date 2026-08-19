import type { PrismaClient } from '@prisma/client';
import { CITIES } from '../cities';
import type { LlmHotelSource } from '../llm/LlmHotelSource';
import type { HotelOffer } from '../llm/hotelGenerationSchema';

export interface HotelSearchOptions {
  cityName: string;
  checkinDate: string; // YYYY-MM-DD
  checkoutDate: string; // YYYY-MM-DD (exclusive)
  guests: number;
  rooms: number;
  minStars?: number;
  maxPricePerNight?: number;
  requiredAmenities?: string[]; // amenity names
  freeCancellationRequired?: boolean;
}

export interface HotelSearchRow {
  hotelId: number;
  roomTypeId: number; // required as `room_type_id` in propose_booking
  hotelName: string;
  address: string;
  city: string;
  stars: number;
  rating: number;
  roomTypeName: string;
  totalPrice: number;
  avgPricePerNight: number;
  nights: number;
  currency: string;
  amenities: string[];
  freeCancellation: boolean;
  cancellationDescription: string;
}

// Stage 23 — HotelRepository is cache-first with an optional
// on-demand LLM fallback. See FlightRepository for the shared
// rationale; hotel-specific notes below.
//
// Nested upsert chain: Hotel → RoomType → per-date Availability.
// All three use `upsert with update: {}` (find-or-create), so any
// row that already exists is reused unchanged. That's what preserves
// bookings' decrements on Availability.roomsAvailable and the
// canonical capacity anchor on RoomType.defaultRoomsAvailable across
// separate LLM calls — the LLM re-fabricates numbers per call, but
// once a RoomType exists we never let those fresh numbers overwrite
// the anchored ones (see the Zod schema comment on
// RoomTypeOffer.roomsAvailable for the full drift story).
export class HotelRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly llmSource?: LlmHotelSource,
  ) {}

  async cityExists(name: string): Promise<boolean> {
    const c = await this.prisma.city.findUnique({
      where: { name },
      select: { id: true },
    });
    return c !== null;
  }

  async findAvailable(opts: HotelSearchOptions): Promise<HotelSearchRow[]> {
    // Scope A: first try the DB. If we get results, return them. If not,
    // and we have an LLM source, fall back to the LLM. If the LLM
    // returns hotels, upsert them into the DB and re-query.
    const dbRows = await this.queryDb(opts);
    if (dbRows.length > 0 || !this.llmSource) return dbRows;

    // dbRows may be empty because the user's optional filters
    // (minStars, maxPricePerNight, requiredAmenities,
    // freeCancellationRequired) excluded every cached row — NOT because
    // this (city, dateRange, guests) has never been generated. Firing
    // the LLM again in that case burns tokens/latency on every filter
    // combination for a city+range that is already fully populated.
    // Check for any cached Availability that matches the LLM's own
    // generation tuple (city, date range, guests) first; if one exists,
    // return the filtered dbRows unchanged.
    if (await this.hasCityDateCoverage(opts)) return dbRows;

    // DB miss + LLM fallback wired. Scope B: only proceed if the
    // city is one of the demo library's known cities (we need center
    // coords to give the LLM a location anchor).
    const cityMeta = CITIES[opts.cityName];
    if (!cityMeta) return dbRows;

    // At this point, we have a DB miss, an LLM fallback, and a known city. Ask the LLM for hotels, upsert them into the DB, and re-query.

    // Fetch two independent things in parallel: (1) the city row (we
    // need city.id for the LLM input and the upsert path), and (2) the
    // avoid-list of existing hotel names in this city (soft prompt hint
    // — LlmHotelSource treats it as a hard rule in the system prompt,
    // so keep populating it even though upsert-with-update:{} would
    // silently absorb a collision). The hotel query keys off the city
    // relation (`city: { name }`) rather than city.id so it does not
    // depend on the city.findUnique result, letting Promise.all shave
    // one DB round-trip off the user-visible cache-miss path.
    const [city, existingHotels] = await Promise.all([
      this.prisma.city.findUnique({
        where: { name: opts.cityName },
        select: { id: true },
      }),
      this.prisma.hotel.findMany({
        where: { city: { name: opts.cityName } },
        select: { name: true },
      }),
    ]);
    if (!city) return dbRows;

    // Ask the LLM for hotels, upsert them into the DB, and re-query.
    const result = await this.llmSource.generateHotelsForCity({
      cityName: opts.cityName,
      cityId: city.id,
      checkinDate: opts.checkinDate,
      checkoutDate: opts.checkoutDate,
      guests: opts.guests,
      existingHotelNames: existingHotels.map((h) => h.name),
      cityCenter: cityMeta.center,
    });
    if (!result) return dbRows;

    // At this point, e.g., result = { hotels: [ { name: 'Athens Grand Hotel', address: '123 Main St, Athens', stars: 4, rating: 8.5, latitude: 37.9838, longitude: 23.7275, roomTypes: [ { name: 'Standard Double', maxGuests: 2, beds: 1, basePriceEUR: 120, roomsAvailable: 10 }, ... ] }, ... ] }
    // Upsert the LLM's hotels into the DB, then re-query to return the final results.
    await this.upsertHotels({
      hotels: result.hotels,
      cityId: city.id,
      checkinDate: opts.checkinDate,
      checkoutDate: opts.checkoutDate,
    });

    // Re-query the DB after the upsert to return the final results. This ensures that we return the canonical data from the DB, including any adjustments made during the upsert process (e.g., availability, pricing).
    return this.queryDb(opts);
  }

  // Cache-population probe: is there any Availability at all for a
  // RoomType with enough capacity for `opts.guests` in this city,
  // within the requested date range? Deliberately ignores minStars /
  // maxPricePerNight / requiredAmenities / freeCancellationRequired —
  // those are user-preference filters, not signals that the LLM has
  // yet to be called for the (city, dateRange, guests) tuple.
  private async hasCityDateCoverage(
    opts: HotelSearchOptions,
  ): Promise<boolean> {
    const checkin = new Date(`${opts.checkinDate}T00:00:00.000Z`);
    const checkout = new Date(`${opts.checkoutDate}T00:00:00.000Z`);

    const count = await this.prisma.availability.count({
      where: {
        date: { gte: checkin, lt: checkout },
        roomType: {
          maxGuests: { gte: opts.guests },
          hotel: { city: { name: opts.cityName } },
        },
      },
    });

    return count > 0;
  }

  // Existing DB query — unchanged behavior, extracted so findAvailable
  // can call it in both the initial-lookup and post-upsert re-query
  // paths.
  private async queryDb(opts: HotelSearchOptions): Promise<HotelSearchRow[]> {
    const checkin = new Date(`${opts.checkinDate}T00:00:00.000Z`);

    const checkout = new Date(`${opts.checkoutDate}T00:00:00.000Z`);

    const nights = Math.round(
      (checkout.getTime() - checkin.getTime()) / 86_400_000,
    );

    // Query hotels in the specified city, filtering by minStars, freeCancellationRequired, and requiredAmenities if provided. Include hotel amenities and room types with availability for the specified date range.
    const hotels = await this.prisma.hotel.findMany({
      where: {
        city: { name: opts.cityName },
        // Filter by minStars, freeCancellationRequired, and requiredAmenities if provided
        ...(opts.minStars != null ? { stars: { gte: opts.minStars } } : {}),
        ...(opts.freeCancellationRequired
          ? { cancellationPolicy: { freeCancellation: true } }
          : {}),
        ...(opts.requiredAmenities && opts.requiredAmenities.length > 0
          ? {
              // Filter hotels that have all the required amenities
              // This uses a nested query to ensure that the hotel has all the required amenities
              AND: opts.requiredAmenities.map((name) => ({
                hotelAmenities: { some: { amenity: { name } } },
              })),
            }
          : {}),
      },
      include: {
        city: true,
        cancellationPolicy: true,
        // Include hotel amenities and room types with availability for the specified date range
        hotelAmenities: { include: { amenity: true } },
        roomTypes: {
          // Filter room types by maxGuests and availability for the specified date range
          where: { maxGuests: { gte: opts.guests } },
          include: {
            availability: {
              where: { date: { gte: checkin, lt: checkout } },
              orderBy: { date: 'asc' },
            },
          },
        },
      },
    });

    const results: HotelSearchRow[] = [];

    for (const hotel of hotels) {
      // E.g., hotel = { id: 1, name: 'Athens Grand Hotel', address: '123 Main St, Athens', stars: 4, rating: 8.5, city: { name: 'Athens' }, cancellationPolicy: { freeCancellation: true, description: 'Free cancellation within 24 hours' }, hotelAmenities: [ { amenity: { name: 'Free Wi-Fi' } }, { amenity: { name: 'Swimming Pool' } } ], roomTypes: [ { id: 1, name: 'Standard Double', maxGuests: 2, availability: [ { date: 2024-07-01T00:00:00.000Z, roomsAvailable: 10, price: 120 }, ... ] }, ... ] }
      const amenities = hotel.hotelAmenities.map((ha) => ha.amenity.name);
      const policy = hotel.cancellationPolicy;

      for (const room of hotel.roomTypes) {
        if (room.availability.length !== nights) continue;
        if (!room.availability.every((a) => a.roomsAvailable >= opts.rooms))
          continue;

        const totalPrice = room.availability.reduce(
          (sum, a) => sum + a.price,
          0,
        );
        const avgPricePerNight = totalPrice / nights;

        if (
          opts.maxPricePerNight != null &&
          avgPricePerNight > opts.maxPricePerNight
        ) {
          continue;
        }

        results.push({
          hotelId: hotel.id,
          roomTypeId: room.id,
          hotelName: hotel.name,
          address: hotel.address,
          city: hotel.city.name,
          stars: hotel.stars,
          rating: hotel.rating,
          roomTypeName: room.name,
          totalPrice: round1(totalPrice),
          avgPricePerNight: round1(avgPricePerNight),
          nights,
          currency: 'EUR',
          amenities,
          freeCancellation: policy?.freeCancellation ?? false,
          cancellationDescription:
            policy?.description ?? 'No cancellation policy on record.',
        });
      }
    }

    // Sort primarily by avg nightly price ascending. Ties (common when
    // the LLM picks similar €145/night rooms) fall back to hotelId then
    // roomTypeId so the ordering is deterministic across identical
    // requests — Array.prototype.sort is stable, but the input order
    // reflects Prisma insertion order which drifts with re-seeding.
    results.sort((a, b) => {
      if (a.avgPricePerNight !== b.avgPricePerNight) {
        return a.avgPricePerNight - b.avgPricePerNight;
      }

      if (a.hotelId !== b.hotelId) return a.hotelId - b.hotelId;

      return a.roomTypeId - b.roomTypeId;
    });
    return results;
  }

  // Upsert one batch of LLM-generated hotels. Every upsert uses
  // `update: {}` (find-or-create) so collisions are no-ops — never
  // overwrite existing rows' state (bookings, canonical capacity).
  private async upsertHotels(params: {
    hotels: HotelOffer[];
    cityId: number;
    checkinDate: string; // YYYY-MM-DD
    checkoutDate: string; // YYYY-MM-DD (exclusive)
  }): Promise<void> {
    const { hotels, cityId, checkinDate, checkoutDate } = params;

    const dates = enumerateDatesUtc(checkinDate, checkoutDate);

    const generatedAt = new Date();

    // Fire per-hotel work in parallel — each hotel targets distinct
    // (cityId, name) rows and everything downstream is scoped by
    // hotel.id, so there is no cross-hotel contention. Runs inside a
    // user-visible cache-miss path where LLM latency already dominates;
    // the pre-parallel version was 3-level serial (hotels × rooms ×
    // dates), which added avoidable milliseconds per round-trip.
    // Per-hotel try/catch preserves the fail-open contract: an isolated
    // Prisma failure inside one hotel's chain must not sink the whole
    // search (queryDb filters partial hotels out — see per-hotel comment).
    await Promise.all(
      hotels.map(async (offer) => {
        // E.g., offer = { name: 'Athens Grand Hotel', address: '123 Main St, Athens', stars: 4, rating: 8.5, latitude: 37.9838, longitude: 23.7275, amenities: ['Free WiFi', 'Breakfast'], cancellationPolicy: { freeCancellation: true, description: 'Free cancellation up to 24 hours before check-in.' }, roomTypes: [ { name: 'Standard Double', maxGuests: 2, beds: 1, basePriceEUR: 120, roomsAvailable: 10 }, ... ] }
        try {
          // Hotel.upsert must land first — the sibling writes below all
          // key on hotel.id.
          const hotel = await this.prisma.hotel.upsert({
            where: { cityId_name: { cityId, name: offer.name } },
            create: {
              cityId,
              name: offer.name,
              address: offer.address,
              stars: offer.stars,
              rating: offer.rating,
              latitude: offer.latitude,
              longitude: offer.longitude,
              externalSource: 'llm',
              generatedAt,
            },
            update: {},
          });

          // After Hotel.upsert, three sibling groups are independent:
          // CancellationPolicy (1:1), HotelAmenity join rows, and the
          // per-RoomType Availability fan-out. Fire them concurrently.
          await Promise.all([
            // CancellationPolicy is 1:1 with Hotel (@unique on hotelId).
            // Find-or-create — never overwrite an existing policy, matching
            // the same "reuse pre-existing state" contract the rest of
            // upsertHotels follows for RoomType/Availability. Without this
            // write, queryDb's freeCancellationRequired filter and the
            // freeCancellation projection would silently exclude every LLM
            // hotel on the post-upsert re-query.
            this.prisma.cancellationPolicy.upsert({
              where: { hotelId: hotel.id },
              create: {
                hotelId: hotel.id,
                freeCancellation: offer.cancellationPolicy.freeCancellation,
                description: offer.cancellationPolicy.description,
              },
              update: {},
            }),
            // HotelAmenity join rows. Amenity names come from the fixed
            // AMENITY_NAMES enum (enforced by the schema), so every Amenity
            // row is guaranteed to exist in the DB from seed. Look them up
            // in a single findMany, then upsert every join row in parallel.
            // Missing Amenity rows are skipped defensively (would only
            // happen if the DB has been reseeded without the amenity list
            // in sync).
            (async () => {
              if (offer.amenities.length === 0) return;

              const amenityRows = await this.prisma.amenity.findMany({
                where: { name: { in: offer.amenities } },
                select: { id: true },
              });

              await Promise.all(
                amenityRows.map(({ id: amenityId }) =>
                  this.prisma.hotelAmenity.upsert({
                    where: {
                      hotelId_amenityId: { hotelId: hotel.id, amenityId },
                    },
                    create: { hotelId: hotel.id, amenityId },
                    update: {},
                  }),
                ),
              );
            })(),
            // Per-RoomType Availability fan-out. Each RoomType.upsert
            // must land before its Availability writes (they need the
            // returned id + the anchored basePrice / defaultRoomsAvailable),
            // but every RoomType is independent of the others, and once
            // a RoomType lands its per-date Availability rows are all
            // independent of each other too.
            Promise.all(
              offer.roomTypes.map(async (rt) => {
                // E.g., rt = { name: 'Standard Double', maxGuests: 2, beds: 1, basePriceEUR: 120, roomsAvailable: 10 }
                const roomType = await this.prisma.roomType.upsert({
                  where: { hotelId_name: { hotelId: hotel.id, name: rt.name } },
                  create: {
                    hotelId: hotel.id,
                    name: rt.name,
                    maxGuests: rt.maxGuests,
                    beds: rt.beds,
                    basePrice: rt.basePriceEUR,
                    defaultRoomsAvailable: rt.roomsAvailable,
                    externalSource: 'llm',
                    generatedAt,
                  },
                  update: {},
                });

                // Anchor for per-date Availability: canonical capacity on
                // RoomType if we have it (created either now or by a prior
                // LLM call), else the LLM's fresh value as a last resort
                // (only path where fallback fires: seeded RoomType with
                // no defaultRoomsAvailable — unlikely to appear here since
                // the LLM was called only after cache miss).
                //
                // So:
                // - If roomType was just created here → defaultRoomsAvailable = rt.roomsAvailable (the LLM's fresh value went into the create).
                // - If roomType already existed (e.g. from a prior LLM call) → defaultRoomsAvailable is the ORIGINAL anchor set on first create; we use that, NOT the LLM's re-fabricated fresh value.
                // - If existed and defaultRoomsAvailable is somehow NULL (seeded RoomType without one) → fall through to LLM's fresh value.
                const capacity =
                  roomType.defaultRoomsAvailable ?? rt.roomsAvailable;

                // Same anchoring rule for nightly price: RoomType.basePrice is
                // the canonical value set on first create; on later LLM calls
                // that reuse this RoomType (hotelId_name collision), the LLM
                // re-fabricates a fresh basePriceEUR — using that here would
                // let Availability.price drift across separate calls for the
                // same room (e.g. €120 on 08-20 and €150 on 08-25). basePrice
                // is non-nullable in the schema, so no fallback is needed —
                // unlike defaultRoomsAvailable above.
                const price = roomType.basePrice;

                // Availability rows for each date in the stay's range fire
                // in parallel — each row is find-or-create, so existing
                // bookings and decrements are preserved.
                await Promise.all(
                  dates.map((date) =>
                    this.prisma.availability.upsert({
                      where: {
                        roomTypeId_date: { roomTypeId: roomType.id, date },
                      },
                      create: {
                        roomTypeId: roomType.id,
                        date,
                        roomsAvailable: capacity,
                        price,
                      },
                      update: {},
                    }),
                  ),
                );
              }),
            ),
          ]);
        } catch (err) {
          console.error(
            `[HotelRepository] upsert failed for hotel "${offer.name}" (city ${cityId}, ${checkinDate}..${checkoutDate}):`,
            err,
          );
        }
      }),
    );
  }
}

// Enumerate UTC calendar days in [checkin, checkout) as Date objects
// pinned to 00:00:00 UTC. Used by upsertHotels to fan Availability
// rows across the stay's date range.
// E.g., checkinDate = '2024-07-01', checkoutDate = '2024-07-05' yields
// [ 2024-07-01T00:00:00.000Z, 2024-07-02T00:00:00.000Z, 2024-07-03T00:00:00.000Z, 2024-07-04T00:00:00.000Z ]
function enumerateDatesUtc(checkinDate: string, checkoutDate: string): Date[] {
  const startMs = new Date(`${checkinDate}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${checkoutDate}T00:00:00.000Z`).getTime();
  const dates: Date[] = [];
  for (let ms = startMs; ms < endMs; ms += 24 * 60 * 60_000) {
    dates.push(new Date(ms));
  }
  return dates;
}

// Round a number to 1 decimal place, e.g. 123.456 -> 123.5
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
