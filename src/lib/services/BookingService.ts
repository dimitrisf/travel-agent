import { randomBytes } from 'node:crypto';
import type {
  Prisma,
  PrismaClient,
  RoomType,
  Availability,
} from '@prisma/client';
import { z } from 'zod';
import {
  bookingInclude,
  type BookingRepository,
  type BookingWithRelations,
} from '../repositories/BookingRepository';
import { BookingServiceError } from './BookingServiceError';
import { internalErrorFactory } from './CodedServiceError';
import { CabinClass, CABIN_MULTIPLIER } from './pricing';
import { IsoDate } from '../zodDates';

// ───────────────────────────────────────────────
// Input schemas
// ───────────────────────────────────────────────

// Flight leg: one-way from origin to destination on a specific flight instance.
// It refers to a FlightBooking, which is a specific FlightInstance. The FlightInstance is a specific flight on a specific date, and the FlightDefinition defines the route, airline, and base price.
const FlightLegInput = z.object({
  flight_instance_id: z.number().int().positive(),
  cabin_class: CabinClass.default('economy'),
  adults: z.number().int().min(1).default(1),
  children: z.number().int().min(0).default(0),
});

// Hotel stay: one or more nights in a specific room type.
// It refers to a HotelBooking, which is a specific RoomType. The RoomType defines the hotel, room type name, and base price per night.
const HotelStayInput = z.object({
  room_type_id: z.number().int().positive(),
  checkin: IsoDate,
  checkout: IsoDate,
  guests: z.number().int().min(1).default(2),
  rooms: z.number().int().min(1).default(1),
});

// Booking proposal: flights + hotels + optional ownership context. At least
// one flight or hotel is required.
//
// Ownership context (Stage 17 Phase 2) is populated by the route handler
// from the authenticated session — the agent no longer supplies customer
// info via tool args. Anonymous callers omit these; the row gets an owner
// only when someone signs in and clicks Confirm.
const ProposeBookingInput = z
  .object({
    // Idempotency key: unique per booking attempt. If a booking with the same key already exists, it will be returned instead of creating a new one.
    idempotency_key: z.string().min(1),
    // Session-derived. Route handler fills these from the current user (if
    // signed in). Never trust these from the agent — the tool spec doesn't
    // expose them.
    user_id: z.string().optional(),
    customer_name: z.string().trim().min(1).optional(),
    customer_email: z.string().trim().email().optional(),
    flights: z.array(FlightLegInput).default([]),
    hotels: z.array(HotelStayInput).default([]),
  })
  .refine((v) => v.flights.length + v.hotels.length > 0, {
    message: 'At least one flight or hotel is required.',
  })
  // Reject duplicate flight_instance_id across legs. Confirm's
  // per-leg updateMany would otherwise decrement seatsAvailable on the
  // same FlightInstance twice for one booking, over-reserving
  // inventory and charging the customer for a 2× phantom leg. A real
  // caller with two segments on the same flight is nonsensical (a
  // physical flight is a single ATH→FRA at a specific time — you can't
  // fly it twice on one journey); an agent or malformed client
  // producing this shape is a bug we want surfaced, not silently
  // deduped downstream.
  .refine(
    (v) => {
      const ids = v.flights.map((f) => f.flight_instance_id);

      // Check if the number of unique flight_instance_id is equal to the total number of flight_instance_id. If they are not equal, it means there are duplicates. We use a Set to get the unique values and compare its size to the original array length.
      return new Set(ids).size === ids.length;
    },
    {
      message:
        'Duplicate flight_instance_id across legs — each flight leg must reference a distinct FlightInstance.',
      path: ['flights'],
    },
  );

export type ProposeBookingInput = z.input<typeof ProposeBookingInput>;

type ParsedFlight = z.infer<typeof FlightLegInput>;
type ParsedHotel = z.infer<typeof HotelStayInput>;
type HotelRange = {
  stay: ParsedHotel;
  checkin: Date;
  checkout: Date;
  nights: number;
};
type FlightInstanceWithDef = Prisma.FlightInstanceGetPayload<{
  include: { flightDefinition: true };
}>;

// cancellationPolicy is needed to enforce non-refundable hotels. If any hotel leg is non-refundable, the whole cancel fails. cancellationPolicy is not included in bookingInclude because it's nested under roomType.hotel, so we override that path here.
const cancelBookingInclude = {
  ...bookingInclude,
  hotelBookings: {
    include: {
      roomType: {
        include: {
          hotel: {
            include: { city: true, cancellationPolicy: true },
          },
        },
      },
    },
  },
} as const satisfies Prisma.BookingInclude;

type BookingForCancel = Prisma.BookingGetPayload<{
  include: typeof cancelBookingInclude;
}>;

// ───────────────────────────────────────────────
// Service
// ───────────────────────────────────────────────

export class BookingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: BookingRepository,
  ) {}

  // Propose: create a PROPOSED booking with all line items priced. Does NOT
  // reserve inventory — that happens on confirm. Idempotent on
  // `idempotency_key`: a retry with the same key returns the existing row.
  // Its input is a ProposeBookingInput, which includes customer info, flights, and hotels. The output is a BookingWithRelations, which includes all line items and related data.
  async proposeBooking(
    input: ProposeBookingInput,
  ): Promise<BookingWithRelations> {
    // E.g., parsed = { idempotency_key: 'abc123', customer_name: 'John Doe', customer_email: 'john.doe@example.com', flights: [...], hotels: [...] }
    const parsed = ProposeBookingInput.parse(input);

    let existing: BookingWithRelations | null;
    try {
      // Check if a booking with the same idempotency key already exists. If it does, return it instead of creating a new one. This ensures that retries do not create duplicate bookings.
      existing = await this.repo.findByIdempotencyKey(parsed.idempotency_key);
    } catch (err) {
      throw internal('Database error during idempotency lookup.', err);
    }
    // If a booking with the same idempotency key already exists, return it instead of creating a new one. This ensures that retries do not create duplicate bookings.
    if (existing) return existing;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // The scenario
        //A traveler proposes: Athens → Berlin → London → Athens with two hotels along the way.
        //
        // Input:
        //{
        //  "flights": [
        //    { "flight_instance_id": 137, ... },  // ATH → BER
        //    { "flight_instance_id": 189, ... },  // BER → LHR
        //    { "flight_instance_id": 202, ... }   // LHR → ATH
        //  ],
        //  "hotels": [
        //    { "room_type_id": 12, "checkin": "2026-07-10", "checkout": "2026-07-13", ... },  // Berlin
        //    { "room_type_id": 27, "checkin": "2026-07-13", "checkout": "2026-07-15", ... }   // London
        //  ]
        //}
        // Before the change — 8 sequential round-trips inside the tx

        // -- Flight loop:
        // 1. SELECT * FROM FlightInstance WHERE id = 137;
        // 2. SELECT * FROM FlightInstance WHERE id = 189;
        // 3. SELECT * FROM FlightInstance WHERE id = 202;

        // -- Hotel loop, iteration 1 (Berlin):
        // 4. SELECT * FROM RoomType WHERE id = 12;
        // 5. SELECT * FROM Availability WHERE roomTypeId = 12 AND date >= '2026-07-10' AND date < '2026-07-13';

        // -- Hotel loop, iteration 2 (London):
        // 6. SELECT * FROM RoomType WHERE id = 27;
        // 7. SELECT * FROM Availability WHERE roomTypeId = 27 AND date >= '2026-07-13' AND date < '2026-07-15';

        // -- Finally:
        // 8. INSERT INTO Booking (...) — with nested FlightBooking + HotelBooking rows.
        // Each numbered line = one round-trip. The transaction sits open across all 8; the Prisma connection is held; row locks (whatever the reads acquire) are held.
        // At ~15ms per round-trip: ~120ms of tx wall-time — most of it spent waiting on the wire.
        //
        // After the change — 4 sequential round-trips inside the tx
        // -- Batch #1: all flight instances in one shot
        // 1. SELECT * FROM FlightInstance WHERE id IN (137, 189, 202);

        // -- Batch #2: all room types in one shot
        // 2. SELECT * FROM RoomType WHERE id IN (12, 27);

        // -- Batch #3: all availability nights in one shot, using an OR-per-stay filter
        // 3. SELECT * FROM Availability
        //    WHERE (roomTypeId = 12 AND date >= '2026-07-10' AND date < '2026-07-13')
        //       OR (roomTypeId = 27 AND date >= '2026-07-13' AND date < '2026-07-15');
        //
        // -- Finally:
        // 4. INSERT INTO Booking (...) — same as before.
        //
        // At ~15ms per round-trip: ~60ms of tx wall-time. Halved.
        const hotelRanges = this.computeHotelRanges(parsed.hotels);

        // ── Batch fetches. One round-trip per entity type instead of
        //    one per leg/stay: FlightInstance, RoomType, Availability.
        //    The old per-leg findUnique / per-stay findUnique+findMany
        //    pattern held the tx open across 2N+M round-trips for
        //    N flights and M hotels; the batched pattern is a fixed
        //    3 round-trips regardless of leg/stay count.
        //
        //    proposeBooking's zod refine rejects duplicate
        //    flight_instance_id per booking, so `id: { in: [...] }`
        //    can't smuggle duplicates through. RoomType has no such
        //    guarantee — two stays MAY share a roomTypeId (same room,
        //    different dates) — but `in` handles that correctly since
        //    lookup is by unique id.
        const flightById = await this.fetchFlightsById(tx, parsed.flights);
        const roomTypeById = await this.fetchRoomTypesById(tx, parsed.hotels);
        const availability = await this.fetchAvailability(tx, hotelRanges);

        const { rows: flightRows, total: flightTotal } = this.buildFlightRows(
          parsed.flights,
          flightById,
        );
        const { rows: hotelRows, total: hotelTotal } = this.buildHotelRows(
          hotelRanges,
          roomTypeById,
          availability,
        );

        const totalPriceEUR = round1(flightTotal + hotelTotal);

        // Now that we have all the flight and hotel rows and the total price, we can create the Booking row. userId + customerName/Email are OPTIONAL — anon PROPOSED rows carry null values and get filled when someone signs in and confirms.
        const created = await tx.booking.create({
          data: {
            // Human-readable booking id (BKG-YYYY-XXXXXXXXXXXX). See
            // generateReference for the entropy rationale — 12 hex
            // chars keep P2002 collisions vanishingly unlikely.
            reference: generateReference(),
            idempotencyKey: parsed.idempotency_key,
            userId: parsed.user_id ?? null,
            customerName: parsed.customer_name ?? null,
            customerEmail: parsed.customer_email ?? null,
            totalPriceEUR,
            currency: 'EUR',
            // As part of this transaction, we create the FlightBooking and HotelBooking rows for the booking. These rows will be linked to the Booking we are creating here. The FlightBooking and HotelBooking rows will have foreign keys to the FlightInstance and RoomType, respectively.
            flightBookings: { create: flightRows },
            hotelBookings: { create: hotelRows },
          },
          // Include all related data in the returned BookingWithRelations. This includes the FlightBookings and HotelBookings, as well as the related FlightInstance, FlightDefinition, RoomType, and Hotel data. This allows the caller to have all the information about the booking in one object.
          include: bookingInclude,
        });

        return created;
      });
    } catch (err) {
      if (err instanceof BookingServiceError) throw err;
      throw internal('Failed to propose booking.', err);
    }
  }

  // ── Pre-compute hotel date ranges. Lifted out of the build loop
  //    so the batched Availability fetch below can hand each
  //    stay's { checkin, checkout } to its own OR arm. Also
  //    validates checkin < checkout up front — no point issuing
  //    the DB fetch if the input is malformed.
  //
  //    For our current agent flow, propose_booking is typically:
  //    - one-way:   flights.length === 1
  //    - round-trip (default for weekend queries): flights.length === 2
  //      (outbound + return instance ids from search_flights). The
  //      TravelAgent has already validated that both legs share
  //      the same route / cabin / party size.
  //
  //    E.g., parsed.flights = [
  //      { flight_instance_id: 123, cabin_class: 'economy', adults: 2, children: 1 },  // outbound
  //      { flight_instance_id: 456, cabin_class: 'economy', adults: 2, children: 1 },  // return
  //    ]
  //
  //    Why hotels-in-a-booking:
  //      One Booking = one journey; each stay is its own HotelBooking row.
  //      - One hotel (typical): 3-night stay in Berlin.
  //      - Two hotels (multi-city): Athens → Berlin (3 nights) → London (2 nights) → Athens.
  //      - Two hotels (same city): change hotels mid-stay.

  // E.g., given
  //   parsed.hotels = [
  //     { room_type_id: 12, checkin: '2026-07-10', checkout: '2026-07-13', guests: 2, rooms: 1 },
  //     { room_type_id: 27, checkin: '2026-07-13', checkout: '2026-07-15', guests: 2, rooms: 1 },
  //   ]
  // becomes
  //   hotelRanges = [
  //     {
  //       stay:     { room_type_id: 12, checkin: '2026-07-10', checkout: '2026-07-13', guests: 2, rooms: 1 },
  //       checkin:  Date('2026-07-10T00:00:00.000Z'),
  //       checkout: Date('2026-07-13T00:00:00.000Z'),
  //       nights:   3,
  //     },
  //     {
  //       stay:     { room_type_id: 27, checkin: '2026-07-13', checkout: '2026-07-15', guests: 2, rooms: 1 },
  //       checkin:  Date('2026-07-13T00:00:00.000Z'),
  //       checkout: Date('2026-07-15T00:00:00.000Z'),
  //       nights:   2,
  //     },
  //   ]
  private computeHotelRanges(hotels: ParsedHotel[]): HotelRange[] {
    return hotels.map((stay) => {
      const checkin = new Date(`${stay.checkin}T00:00:00.000Z`);
      const checkout = new Date(`${stay.checkout}T00:00:00.000Z`);

      if (checkout <= checkin) {
        throw new BookingServiceError(
          'Hotel stay: checkout must be after checkin.',
          'INVALID_STATE',
        );
      }

      const nights = Math.round(
        (checkout.getTime() - checkin.getTime()) / 86_400_000,
      );

      return { stay, checkin, checkout, nights };
    });
  }

  // E.g., given
  //   parsed.flights = [
  //     { flight_instance_id: 137, cabin_class: 'economy', adults: 2, children: 1 },  // ATH → BER
  //     { flight_instance_id: 189, cabin_class: 'economy', adults: 2, children: 1 },  // BER → LHR
  //     { flight_instance_id: 202, cabin_class: 'economy', adults: 2, children: 1 },  // LHR → ATH
  //   ]
  // one round-trip returns
  //   flightInstances = [
  //     {
  //       id: 137, flightDefinitionId: 55, date: Date('2026-07-10'), seatsAvailable: 48,
  //       flightDefinition: { id: 55, airline: 'A3', flightNumber: '824', origin: 'ATH', destination: 'BER', basePriceEUR: 120 },
  //     },
  //     {
  //       id: 189, flightDefinitionId: 71, date: Date('2026-07-13'), seatsAvailable: 92,
  //       flightDefinition: { id: 71, airline: 'LH', flightNumber: '992', origin: 'BER', destination: 'LHR', basePriceEUR: 90 },
  //     },
  //     {
  //       id: 202, flightDefinitionId: 88, date: Date('2026-07-15'), seatsAvailable: 30,
  //       flightDefinition: { id: 88, airline: 'BA', flightNumber: '635', origin: 'LHR', destination: 'ATH', basePriceEUR: 140 },
  //     },
  //   ]
  //
  // Index by id for O(1) lookup in the build loop below — cheaper
  // than Array.prototype.find per leg and, more importantly, lets
  // us detect a missing FlightInstance with a `.get()` miss (see
  // FLIGHT_INSTANCE_NOT_FOUND throw).
  //
  // E.g., from the flightInstances above,
  //   flightById = Map {
  //     137 => { id: 137, ..., flightDefinition: { airline: 'A3', flightNumber: '824', ... } },
  //     189 => { id: 189, ..., flightDefinition: { airline: 'LH', flightNumber: '992', ... } },
  //     202 => { id: 202, ..., flightDefinition: { airline: 'BA', flightNumber: '635', ... } },
  //   }
  private async fetchFlightsById(
    tx: Prisma.TransactionClient,
    flights: ParsedFlight[],
  ): Promise<Map<number, FlightInstanceWithDef>> {
    const flightInstances =
      flights.length > 0
        ? await tx.flightInstance.findMany({
            where: {
              id: {
                in: flights.map((f) => f.flight_instance_id),
              },
            },
            include: { flightDefinition: true },
          })
        : [];

    return new Map(flightInstances.map((fi) => [fi.id, fi]));
  }

  // E.g., given
  //   parsed.hotels = [
  //     { room_type_id: 12, ... },  // Berlin — Deluxe Suite
  //     { room_type_id: 27, ... },  // London — Standard Double
  //   ]
  // one round-trip returns
  //   roomTypes = [
  //     { id: 12, hotelId: 5,  name: 'Deluxe Suite',    basePriceEUR: 200 },
  //     { id: 27, hotelId: 18, name: 'Standard Double', basePriceEUR: 130 },
  //   ]
  //
  // Index by id — same rationale as flightById above (O(1) lookup
  // in the build loop, `.get()` miss surfaces ROOM_TYPE_NOT_FOUND).
  //
  // E.g., from the roomTypes above,
  //   roomTypeById = Map {
  //     12 => { id: 12, hotelId: 5,  name: 'Deluxe Suite',    basePriceEUR: 200 },
  //     27 => { id: 27, hotelId: 18, name: 'Standard Double', basePriceEUR: 130 },
  //   }
  private async fetchRoomTypesById(
    tx: Prisma.TransactionClient,
    hotels: ParsedHotel[],
  ): Promise<Map<number, RoomType>> {
    const roomTypes =
      hotels.length > 0
        ? await tx.roomType.findMany({
            where: {
              id: {
                in: hotels.map((h) => h.room_type_id),
              },
            },
          })
        : [];

    return new Map(roomTypes.map((rt) => [rt.id, rt]));
  }

  // Availability fetch: one OR arm per stay so the SQL matches
  // exactly the (roomTypeId, date-range) pairs we need — no
  // over-fetch, no under-fetch. Rows matching multiple arms
  // (overlapping stays on the same RoomType) come back once
  // by SQL DISTINCT semantics; the per-stay filter below then
  // partitions them.
  //
  // E.g., from the hotelRanges above, the WHERE clause becomes
  //   OR: [
  //     { roomTypeId: 12, date: { gte: Date('2026-07-10'), lt: Date('2026-07-13') } },  // Berlin, 3 nights
  //     { roomTypeId: 27, date: { gte: Date('2026-07-13'), lt: Date('2026-07-15') } },  // London, 2 nights
  //   ]
  // and one round-trip returns
  //   availability = [
  //     { roomTypeId: 12, date: Date('2026-07-10'), price: 200, roomsAvailable: 5 },
  //     { roomTypeId: 12, date: Date('2026-07-11'), price: 200, roomsAvailable: 5 },
  //     { roomTypeId: 12, date: Date('2026-07-12'), price: 220, roomsAvailable: 4 },
  //     { roomTypeId: 27, date: Date('2026-07-13'), price: 130, roomsAvailable: 8 },
  //     { roomTypeId: 27, date: Date('2026-07-14'), price: 130, roomsAvailable: 8 },
  //   ]
  // — flat 5-row list, mixed roomTypeIds; the build loop below
  //   partitions per-stay by re-applying the same predicate.
  private async fetchAvailability(
    tx: Prisma.TransactionClient,
    hotelRanges: HotelRange[],
  ): Promise<Availability[]> {
    return hotelRanges.length > 0
      ? await tx.availability.findMany({
          where: {
            OR: hotelRanges.map((r) => ({
              roomTypeId: r.stay.room_type_id,
              date: { gte: r.checkin, lt: r.checkout },
            })),
          },
        })
      : [];
  }

  // ── Build flight rows from the fetched map.
  // FlightBookingCreateWithoutBookingInput is the input type for
  // creating a FlightBooking without specifying the Booking (since
  // we create the Booking in this transaction later). Includes
  // flightInstanceId, cabinClass, adults, children, seats,
  // pricePerSeatEUR, and totalPriceEUR — defined in the Prisma
  // schema and generated by Prisma Client.
  private buildFlightRows(
    flights: ParsedFlight[],
    flightById: Map<number, FlightInstanceWithDef>,
  ): {
    rows: Prisma.FlightBookingCreateWithoutBookingInput[];
    total: number;
  } {
    const rows: Prisma.FlightBookingCreateWithoutBookingInput[] = [];

    let total = 0;

    // Reminder — parsed.flights for the Athens → Berlin → London → Athens trip:
    //   [
    //     { flight_instance_id: 137, cabin_class: 'economy', adults: 2, children: 1 },  // ATH → BER
    //     { flight_instance_id: 189, cabin_class: 'economy', adults: 2, children: 1 },  // BER → LHR
    //     { flight_instance_id: 202, cabin_class: 'economy', adults: 2, children: 1 },  // LHR → ATH
    //   ]
    // and the flightById map built from the batched fetch above:
    //   Map {
    //     137 => { id: 137, ..., flightDefinition: { airline: 'A3', flightNumber: '824', ... } },
    //     189 => { id: 189, ..., flightDefinition: { airline: 'LH', flightNumber: '992', ... } },
    //     202 => { id: 202, ..., flightDefinition: { airline: 'BA', flightNumber: '635', ... } },
    //   }
    for (const leg of flights) {
      // E.g., leg = { flight_instance_id: 137, cabin_class: 'economy', adults: 2, children: 1 }

      // E.g., for leg.flight_instance_id === 137,
      //   flightInstance = {
      //     id: 137, flightDefinitionId: 55, date: Date('2026-07-10'), seatsAvailable: 48,
      //     flightDefinition: { id: 55, airline: 'A3', flightNumber: '824', origin: 'ATH', destination: 'BER', basePriceEUR: 120 },
      //   }
      const flightInstance = flightById.get(leg.flight_instance_id);

      if (!flightInstance) {
        throw new BookingServiceError(
          `Flight instance ${leg.flight_instance_id} not found.`,
          'FLIGHT_INSTANCE_NOT_FOUND',
        );
      }

      // Price per seat = FlightDefinition.basePriceEUR × cabin
      // multiplier, rounded. Children pay adult fare in this model.
      // Total for this leg = pricePerSeat × (adults + children).
      const multiplier = CABIN_MULTIPLIER[leg.cabin_class];
      const pricePerSeatEUR = Math.round(
        flightInstance.flightDefinition.basePriceEUR * multiplier,
      );
      const seats = leg.adults + leg.children;
      const totalPriceEUR = pricePerSeatEUR * seats;

      total += totalPriceEUR;
      rows.push({
        flightInstance: { connect: { id: leg.flight_instance_id } },
        cabinClass: leg.cabin_class,
        adults: leg.adults,
        children: leg.children,
        seats,
        pricePerSeatEUR,
        totalPriceEUR,
      });
    }

    return { rows, total };
  }

  // ── Build hotel rows from the fetched maps + partitioned availability.
  private buildHotelRows(
    hotelRanges: HotelRange[],
    roomTypeById: Map<number, RoomType>,
    availability: Availability[],
  ): {
    rows: Prisma.HotelBookingCreateWithoutBookingInput[];
    total: number;
  } {
    const rows: Prisma.HotelBookingCreateWithoutBookingInput[] = [];
    let total = 0;
    for (const { stay, checkin, checkout, nights } of hotelRanges) {
      const roomType = roomTypeById.get(stay.room_type_id);
      if (!roomType) {
        throw new BookingServiceError(
          `Room type ${stay.room_type_id} not found.`,
          'ROOM_TYPE_NOT_FOUND',
        );
      }

      // Partition the batched availability array to just this
      // stay's rows. Same predicate as the OR arm above — anything
      // returned by the batched fetch that also matches
      // (roomTypeId, [checkin, checkout)) belongs to this stay.
      const stayAvailability = availability.filter(
        (a) =>
          a.roomTypeId === stay.room_type_id &&
          a.date >= checkin &&
          a.date < checkout,
      );
      if (stayAvailability.length !== nights) {
        throw new BookingServiceError(
          `Hotel stay: availability not defined for all ${nights} night(s).`,
          'INSUFFICIENT_ROOMS',
        );
      }

      const nightlyTotal = stayAvailability.reduce(
        (sum, a) => sum + a.price,
        0,
      );
      const totalPriceEUR = round1(nightlyTotal * stay.rooms);

      total += totalPriceEUR;
      rows.push({
        roomType: { connect: { id: stay.room_type_id } },
        checkinDate: checkin,
        checkoutDate: checkout,
        nights,
        guests: stay.guests,
        rooms: stay.rooms,
        totalPriceEUR,
      });
    }

    return { rows, total };
  }

  // Confirm: reserve inventory and mark PAID. Wrapped in one transaction so
  // any failure (insufficient seats, insufficient rooms) rolls back and leaves
  // the booking in its original PROPOSED state.
  //
  // Ownership (Stage 17 Phase 2): the caller MUST pass the authenticated
  // user — Confirm is the point at which anon proposals get claimed. If the
  // booking already has an owner and it isn't this user, we 404 (same shape
  // as "doesn't exist") to avoid leaking existence to other tenants.
  // Otherwise the transaction fills `userId`, `customerName`, and
  // `customerEmail` from the session identity.
  // The input is the booking ID and the current user object, which includes the user ID, name, and email. The current user comes from the session. The output is the updated BookingWithRelations, which includes all related data.
  //
  // Pricing model — deliberately simplified (same posture as the stub
  // payment below):
  //   - `booking.totalPriceEUR` (and the per-leg / per-stay totals) are
  //     frozen at propose time. Confirm charges that exact amount with
  //     NO re-price, NO expiration on PROPOSED, and NO invalidation if
  //     FlightDefinition.basePriceEUR or Availability.price moves in
  //     between. A proposal held for weeks pays yesterday's price on
  //     today's inventory.
  //   - This is the airline "held quote" shape (Kayak / carrier PSS)
  //     but WITHOUT the usual short expiration window that makes held
  //     quotes safe for the operator. Booking.com-style hotel behaviour
  //     (re-quote at confirm, no held quote) is the alternative model.
  //   - Real production code would pick one — expiration + reject on
  //     stale, or re-price + reject on drift — and would carry an audit
  //     trail of the delta. This project intentionally does neither,
  //     matching the stub-payment simplification: propose→confirm is
  //     modelled as a single trusted step, not a multi-day quote hold.
  //   - If a future change adds either mechanism, this comment should
  //     go with it.
  async confirmBooking(
    id: number,
    currentUser: { id: string; name: string | null; email: string },
  ): Promise<BookingWithRelations> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await this.loadBookingForConfirm(tx, id, currentUser);
        await this.reserveFlightSeats(tx, booking.flightBookings);
        await this.reserveHotelRooms(tx, booking.hotelBookings);
        return await this.markPaidAndClaim(tx, booking, currentUser);
      });
    } catch (err) {
      if (err instanceof BookingServiceError) throw err;
      throw internal('Failed to confirm booking.', err);
    }
  }

  // Fetch the booking by id, including all related data. If the booking does not exist, throw a BookingServiceError with code 'BOOKING_NOT_FOUND'. If the booking is not in PROPOSED state, throw a BookingServiceError with code 'INVALID_STATE'. This ensures that only PROPOSED bookings can be confirmed.
  private async loadBookingForConfirm(
    tx: Prisma.TransactionClient,
    id: number,
    currentUser: { id: string },
  ): Promise<BookingWithRelations> {
    const booking = await tx.booking.findUnique({
      where: { id },
      include: bookingInclude,
    });
    if (!booking) {
      throw new BookingServiceError(
        `Booking ${id} not found.`,
        'BOOKING_NOT_FOUND',
      );
    }

    // Cross-tenant guard. 404 (not 403) so a scan of ids can't discover
    // which ones exist under another user's account.
    // If the booking has a userId and it does not match the current user's ID, throw a BookingServiceError with code 'BOOKING_NOT_FOUND'. This prevents users from confirming bookings that belong to other users.
    // A booking may have a non-null userId if it was proposed while the user was signed in. In that case, only the owner can confirm it. If the booking has a null userId, it means it was proposed anonymously, and any user can confirm it.
    if (booking.userId && booking.userId !== currentUser.id) {
      throw new BookingServiceError(
        `Booking ${id} not found.`,
        'BOOKING_NOT_FOUND',
      );
    }

    // Check that the booking is in PROPOSED state. If it is not, throw a BookingServiceError with code 'INVALID_STATE'. This ensures that only PROPOSED bookings can be confirmed. A booking may be in PAID or CONFIRMED state if it has already been confirmed, or in CANCELLED state if it has been cancelled. In any of those cases, we do not allow confirming the booking again.
    if (booking.status !== 'PROPOSED') {
      throw new BookingServiceError(
        `Booking ${id} is in state ${booking.status}; only PROPOSED bookings can be confirmed.`,
        'INVALID_STATE',
      );
    }

    return booking;
  }

  // Reserve flight seats.
  private async reserveFlightSeats(
    tx: Prisma.TransactionClient,
    flightBookings: BookingWithRelations['flightBookings'],
  ): Promise<void> {
    for (const leg of flightBookings) {
      // Update the FlightInstance to decrement the seatsAvailable by the number of seats in this leg. If the update affects 0 rows, it means there are insufficient seats available, and we throw a BookingServiceError with code 'INSUFFICIENT_SEATS'. This ensures that we do not overbook the flight.

      // updateMany is used instead of update to avoid a race condition where two concurrent transactions could read the same seatsAvailable and both succeed. By using updateMany with a where clause that checks seatsAvailable >= leg.seats, we ensure that only one transaction can succeed if there are limited seats available.
      // More specifically:
      // Two subtly different APIs (update vs updateMany). The important difference isn't "one row vs many rows" — it's that update requires a unique where clause, while updateMany accepts any predicate. That lets us combine two conditions atomically.
      //
      // The conditional we need
      //
      // "Decrement seatsAvailable by N — but only if it's currently ≥ N."
      // That's a compound predicate: id = X AND seatsAvailable >= N. update won't accept that shape — its where must resolve to a unique row (typically id: X alone). Prisma would reject:
      // await tx.flightInstance.update({
      //   where: { id: leg.flightInstanceId, seatsAvailable: { gte: leg.seats } }, // ❌
      //   data: { seatsAvailable: { decrement: leg.seats } },
      // });
      // updateMany accepts arbitrary predicates because it doesn't guarantee "exactly one row" — its guarantee is just "returns a count of matching rows updated."
      //
      // What this buys us — race safety
      //
      // The SQL that updateMany generates is one atomic statement:
      //
      // UPDATE "FlightInstance"
      //   SET "seatsAvailable" = "seatsAvailable" - $seats
      // WHERE "id" = $id
      //   AND "seatsAvailable" >= $seats
      //
      // Postgres checks the predicate and performs the decrement in one operation. No other transaction can slip between "check" and "update" because there is no gap — they're the same SQL statement.
      // If the row is there and has enough seats → the WHERE clause matches → the UPDATE happens → count === 1.
      // If the row is there but someone else already took the seats → the WHERE clause doesn't match → the UPDATE affects 0 rows → count === 0 → we throw INSUFFICIENT_SEATS.
      //
      // What the update alternative would look like
      //
      // You'd have to do it in three steps:
      //
      // const instance = await tx.flightInstance.findUnique({ where: { id } });  // 1. read
      // if (!instance || instance.seatsAvailable < leg.seats) throw ...;         // 2. check in code
      // await tx.flightInstance.update({                                          // 3. write
      //   where: { id },
      //   data: { seatsAvailable: { decrement: leg.seats } },
      // });
      //
      // Two round trips instead of one, and — more importantly — there's a gap between steps 1 and 3 where another transaction could decrement the counter. Even inside a Prisma $transaction, without explicit row-level locks (SELECT ... FOR UPDATE), that race is real. Two agents confirming simultaneously could both see 5 seats available, both decrement by 3, and end up at −1.
      // You can avoid this with SELECT ... FOR UPDATE, but Prisma doesn't expose that cleanly, and now you're maintaining two SQL statements per check instead of one.
      // The pattern has a name: conditional update / compare-and-swap.
      const updated = await tx.flightInstance.updateMany({
        where: {
          id: leg.flightInstanceId,
          seatsAvailable: { gte: leg.seats },
        },
        data: { seatsAvailable: { decrement: leg.seats } },
      });
      if (updated.count === 0) {
        throw new BookingServiceError(
          `Insufficient seats on flight instance ${leg.flightInstanceId}.`,
          'INSUFFICIENT_SEATS',
        );
      }
    }
  }

  // Reserve hotel rooms night-by-night.
  private async reserveHotelRooms(
    tx: Prisma.TransactionClient,
    hotelBookings: BookingWithRelations['hotelBookings'],
  ): Promise<void> {
    for (const stay of hotelBookings) {
      // Update the Availability to decrement the roomsAvailable by the number of rooms in this stay. If the update affects fewer rows than the number of nights, it means there are insufficient rooms available, and we throw a BookingServiceError with code 'INSUFFICIENT_ROOMS'. This ensures that we do not overbook the hotel.
      //
      // We use the same pattern for hotel rooms:
      // Same idea, but the where clause matches a range of rows (one per night). We expect exactly stay.nights rows to update — if fewer match (because at least one night went short), we know to throw and roll back.
      const updated = await tx.availability.updateMany({
        where: {
          roomTypeId: stay.roomTypeId,
          date: { gte: stay.checkinDate, lt: stay.checkoutDate },
          roomsAvailable: { gte: stay.rooms },
        },
        data: { roomsAvailable: { decrement: stay.rooms } },
      });
      // If the number of rows updated is not equal to the number of nights, it means that at least one night did not have enough rooms available. In that case, we throw a BookingServiceError with code 'INSUFFICIENT_ROOMS'. This will cause the transaction to roll back, leaving the booking in its original PROPOSED state.
      if (updated.count !== stay.nights) {
        throw new BookingServiceError(
          `Insufficient rooms for hotel stay ${stay.id} across ${stay.nights} night(s).`,
          'INSUFFICIENT_ROOMS',
        );
      }
    }
  }

  private async markPaidAndClaim(
    tx: Prisma.TransactionClient,
    booking: BookingWithRelations,
    currentUser: { id: string; name: string | null; email: string },
  ): Promise<BookingWithRelations> {
    // Stub payment — always succeeds instantly.
    // In a real system, this would be where you integrate with a payment provider (e.g., Stripe, PayPal) to charge the customer's card. If the payment fails, you would throw a BookingServiceError with code 'PAYMENT_FAILED' and roll back the transaction. For this stub implementation, we simply create a Payment row with status 'SUCCEEDED' and completedAt set to the current date.
    //
    // `amount` is the propose-time frozen total — see the
    // "Pricing model — deliberately simplified" note in
    // confirmBooking's docstring for why we don't re-price here.
    await tx.payment.create({
      data: {
        bookingId: booking.id,
        amount: booking.totalPriceEUR,
        currency: booking.currency,
        status: 'SUCCEEDED',
        provider: 'stub',
        completedAt: new Date(),
      },
    });

    // Finally, mark the booking as PAID and set confirmedAt. Also claim
    // ownership (Stage 17 Phase 2): fill in userId + customerName/Email
    // from the session identity. If the booking was already owned by
    // this user (they proposed while signed in), the assignments are
    // idempotent. If any of these were already set on the row (e.g.,
    // signed-in propose), we don't overwrite — nullish-coalesce from
    // the existing value.
    //
    // Same compare-and-swap pattern used above for inventory —
    // updateMany lets us combine `id: X` with `status: 'PROPOSED'`
    // atomically. Under Postgres READ COMMITTED (Prisma's default),
    // two concurrent confirms on the same booking both pass the
    // status check at line 324 (they read the same snapshot at the
    // top of the transaction). Without a CAS here the losing side
    // would still: create a duplicate Payment (no unique key on
    // bookingId), double-decrement inventory, and re-flip the row.
    // updateMany blocks on the row lock, then re-evaluates its
    // WHERE against the post-commit state: if the winner already
    // flipped status to PAID, count===0 → we throw INVALID_STATE
    // and the whole transaction (inventory decrements + Payment
    // insert) rolls back.
    const claimed = await tx.booking.updateMany({
      where: { id: booking.id, status: 'PROPOSED' },
      data: {
        status: 'PAID',
        confirmedAt: new Date(),
        // Claim ownership: if the booking already has a userId, we don't overwrite it. If it is null, we set it to the current user's ID. The same applies to customerName and customerEmail. This ensures that the booking is associated with the correct user and that we have the necessary contact information for the customer.
        userId: booking.userId ?? currentUser.id,
        customerName:
          booking.customerName ?? currentUser.name ?? currentUser.email,
        customerEmail: booking.customerEmail ?? currentUser.email,
      },
    });
    if (claimed.count === 0) {
      throw new BookingServiceError(
        `Booking ${booking.id} was concurrently confirmed by another request.`,
        'INVALID_STATE',
      );
    }
    // updateMany doesn't take `include`; re-read the row with
    // relations so the caller gets the same BookingWithRelations
    // shape they used to.
    const confirmed = await tx.booking.findUnique({
      where: { id: booking.id },
      include: bookingInclude,
    });
    // Non-null: we just CAS-updated this row inside the same
    // transaction, so it must be visible.
    return confirmed!;
  }

  // Cancel: restore inventory (if any was reserved) and mark CANCELLED. Enforces
  // per-hotel CancellationPolicy for PAID bookings — if any hotel leg is
  // non-refundable, the whole cancel fails.
  //
  // Ownership (Stage 17 Phase 2): `currentUserId` is null for anon callers;
  // set for signed-in ones. Rules:
  //   - booking.userId IS NULL → allowed for any caller (anon PROPOSED discard)
  //   - booking.userId === currentUserId → allowed for owner
  //   - otherwise → 404 (cross-tenant, treat as not-found)
  async cancelBooking(
    id: number,
    opts?: { currentUserId?: string | null; reason?: string },
  ): Promise<BookingWithRelations> {
    const currentUserId = opts?.currentUserId ?? null;
    const reason = opts?.reason;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await this.loadBookingForCancel(tx, id, currentUserId);

        // Refund policy applies only after inventory has been reserved.
        // The BookingStatus enum also declares CONFIRMED, but no write
        // path in this service produces it — confirmBooking goes
        // PROPOSED→PAID directly. If a future two-phase confirm/pay flow
        // adds a real CONFIRMED transition, it needs to re-enter both
        // the allowed-states check above and this wasReserved rule with
        // whatever inventory/payment semantics it defines; treating
        // CONFIRMED as reserved here today would fire the hotel
        // non-refundability guard against a booking with no SUCCEEDED
        // Payment (payment.updateMany silently matches 0 rows).
        const wasReserved = booking.status === 'PAID';

        if (wasReserved) {
          this.enforceRefundPolicy(booking.hotelBookings);

          // Restore inventory for flights and hotels. For each flight leg, we
          // increment seatsAvailable by the leg's seats. For each hotel stay,
          // we increment roomsAvailable by that stay's rooms across all nights.
          // Note: we assume here that flight bookings are always refundable,
          // and that hotel bookings are refundable only if the cancellation
          // policy allows it. In a real system, you would need to check the
          // cancellation policy for flights as well.
          await this.restoreFlightSeats(tx, booking.flightBookings);
          await this.restoreHotelRooms(tx, booking.hotelBookings);

          // Refund payments for the booking. We update all payments with status 'SUCCEEDED' to 'REFUNDED'. This ensures that the customer is reimbursed for the cancelled booking.
          await tx.payment.updateMany({
            where: { bookingId: booking.id, status: 'SUCCEEDED' },
            data: { status: 'REFUNDED' },
          });
        }

        return await this.markCancelled(tx, booking, reason);
      });
    } catch (err) {
      if (err instanceof BookingServiceError) throw err;
      throw internal('Failed to cancel booking.', err);
    }
  }

  private async loadBookingForCancel(
    tx: Prisma.TransactionClient,
    id: number,
    currentUserId: string | null,
  ): Promise<BookingForCancel> {
    const booking = await tx.booking.findUnique({
      where: { id },
      include: cancelBookingInclude,
    });
    if (!booking) {
      throw new BookingServiceError(
        `Booking ${id} not found.`,
        'BOOKING_NOT_FOUND',
      );
    }
    // Cross-tenant guard. 404 (not 403) so id-scanning can't enumerate.
    if (booking.userId && booking.userId !== currentUserId) {
      throw new BookingServiceError(
        `Booking ${id} not found.`,
        'BOOKING_NOT_FOUND',
      );
    }
    if (booking.status !== 'PROPOSED' && booking.status !== 'PAID') {
      throw new BookingServiceError(
        `Booking ${id} is in state ${booking.status}; only PROPOSED or PAID bookings can be cancelled.`,
        'INVALID_STATE',
      );
    }
    return booking;
  }

  // Enforce per-hotel CancellationPolicy for PAID bookings — if any hotel leg is non-refundable, the whole cancel fails. cancellationPolicy is nested under roomType.hotel, so we need to access it through that path.
  private enforceRefundPolicy(
    hotelBookings: BookingForCancel['hotelBookings'],
  ): void {
    for (const stay of hotelBookings) {
      const policy = stay.roomType.hotel.cancellationPolicy;
      if (policy && !policy.freeCancellation) {
        throw new BookingServiceError(
          `Hotel "${stay.roomType.hotel.name}" is non-refundable: ${policy.description}`,
          'NON_REFUNDABLE',
        );
      }
    }
  }

  // Group legs by seat count and issue one updateMany per unique
  // count instead of N individual updates. Common cases (1-leg,
  // 2-leg same-party round-trip) collapse to a single statement.
  // Worst case (every leg a different party size) matches the
  // old per-leg round-trip cost. proposeBooking's refine
  // guarantees each flightInstanceId appears at most once per
  // booking (see the schema-level check above), so `id: { in: ids }`
  // can't double-increment a shared FlightInstance within a group.
  //
  // The scenario
  // A family (2 adults + 1 child = 3 seats per leg) books a multi-city trip:
  // Athens → Berlin → London → Athens. Three flight legs, three different FlightInstances.
  // Later they cancel.
  // Before the change
  // The for loop issues three separate UPDATE statements, one per leg, sequentially awaited:
  // -- Round-trip 1
  // UPDATE "FlightInstance" SET "seatsAvailable" = "seatsAvailable" + 3 WHERE "id" = 101;
  // -- Round-trip 2
  // UPDATE "FlightInstance" SET "seatsAvailable" = "seatsAvailable" + 3 WHERE "id" = 202;
  // -- Round-trip 3
  // UPDATE "FlightInstance" SET "seatsAvailable" = "seatsAvailable" + 3 WHERE "id" = 303;
  // 3 network round-trips. If each takes ~15ms, that's ~45ms of transaction time just for the flight restore. The transaction is holding row locks on all three FlightInstance rows the whole time — any concurrent confirm/cancel touching those flights has to wait.

  // After the change
  // Group legs by seat count first — the map becomes { 3: [101, 202, 303] } — then one UPDATE per group:
  // -- Round-trip 1 (only)
  // UPDATE "FlightInstance" SET "seatsAvailable" = "seatsAvailable" + 3 WHERE "id" IN (101, 202, 303);
  // 1 network round-trip. ~15ms instead of ~45ms.
  //
  // When the grouping matters less
  // Mixed party sizes across legs — say leg 2 was a solo business detour (1 seat):

  // Legs: {101, 3}, {202, 1}, {303, 3}
  // Grouped: { 3: [101, 303], 1: [202] }
  // 2 UPDATEs instead of 3.
  // Degenerate case (still no worse)
  // All three legs a different party size:

  // Grouped: { 3: [101], 2: [202], 1: [303] }
  // 3 UPDATEs — same as before, no regression.
  // Why the report called this a bug even though it's not incorrect
  // The old code always paid N round-trips regardless of shape. The typical booking (1-leg one-way, 2-leg matched-party round-trip) collapses to 1 round-trip after the fix. The hotel loop two lines below was already using updateMany — the flight loop was doing it the slow way for no reason.
  private async restoreFlightSeats(
    tx: Prisma.TransactionClient,
    flightBookings: BookingForCancel['flightBookings'],
  ): Promise<void> {
    const legsBySeatCount = new Map<number, number[]>();

    for (const leg of flightBookings) {
      const ids = legsBySeatCount.get(leg.seats) ?? [];
      ids.push(leg.flightInstanceId);
      legsBySeatCount.set(leg.seats, ids);
    }

    for (const [seats, ids] of legsBySeatCount) {
      await tx.flightInstance.updateMany({
        where: { id: { in: ids } },
        data: { seatsAvailable: { increment: seats } },
      });
    }
  }

  private async restoreHotelRooms(
    tx: Prisma.TransactionClient,
    hotelBookings: BookingForCancel['hotelBookings'],
  ): Promise<void> {
    for (const stay of hotelBookings) {
      // Restore hotel inventory by incrementing roomsAvailable for each night of the stay. We use updateMany to update all Availability rows for the RoomType across the requested nights. This ensures that the inventory is restored to its original state before the booking was confirmed.
      await tx.availability.updateMany({
        where: {
          roomTypeId: stay.roomTypeId,
          date: { gte: stay.checkinDate, lt: stay.checkoutDate },
        },
        data: { roomsAvailable: { increment: stay.rooms } },
      });
    }
  }

  // Finally, mark the booking as CANCELLED and set cancelledAt to
  // the current date. Same compare-and-swap pattern as
  // confirmBooking's final transition, but keyed on the status we
  // observed at the top of the transaction — `booking.status`.
  // Under Postgres READ COMMITTED (Prisma's default), our snapshot
  // of `booking.status` can go stale before we commit:
  //  - Confirm-vs-cancel race: we read PROPOSED and branched
  //    wasReserved=false (skipping refund + inventory restore),
  //    but a concurrent confirm slipped in and flipped the row to
  //    PAID. Without a status guard, we'd overwrite PAID→CANCELLED
  //    while leaving the SUCCEEDED Payment live and the seats
  //    reserved.
  //  - Cancel-vs-cancel race on a PAID booking: both readers see
  //    PAID, both restore inventory, both refund. Inventory would
  //    double-increment (Payment refund is idempotent on the
  //    SUCCEEDED filter, but inventory writes are not).
  // Guarding on `id` AND the observed `booking.status` forces the
  // losing side to count===0 → throw INVALID_STATE → rollback of
  // its inventory / refund writes.
  private async markCancelled(
    tx: Prisma.TransactionClient,
    booking: BookingForCancel,
    reason: string | undefined,
  ): Promise<BookingWithRelations> {
    const claimed = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason?.trim() || null,
      },
    });
    if (claimed.count === 0) {
      throw new BookingServiceError(
        `Booking ${booking.id} was concurrently modified by another request.`,
        'INVALID_STATE',
      );
    }
    // updateMany doesn't accept `include`; re-read for the return
    // shape. Non-null: we just CAS-updated this row inside the same
    // transaction, so it is visible.
    const cancelled = await tx.booking.findUnique({
      where: { id: booking.id },
      include: bookingInclude,
    });
    return cancelled!;
  }

  // Ownership rules match cancelBooking: anon proposals are readable by
  // anyone with the id; owned rows are only readable by the owner. Cross-
  // tenant reads return not-found (same shape as truly missing).
  async getBooking(
    id: number,
    opts?: { currentUserId?: string | null },
  ): Promise<BookingWithRelations> {
    const currentUserId = opts?.currentUserId ?? null;
    let booking: BookingWithRelations | null;

    try {
      booking = await this.repo.findById(id);
    } catch (err) {
      throw internal('Database error while fetching booking.', err);
    }

    // Cross-tenant guard. 404 (not 403) so a scan of ids can't enumerate.
    // If the booking has a userId and it does not match the current user's ID, throw a BookingServiceError with code 'BOOKING_NOT_FOUND'. This prevents users from accessing bookings that belong to other users. A booking may have a non-null userId if it was proposed while the user was signed in. In that case, only the owner can access it. If the booking has a null userId, it means it was proposed anonymously, and any user can access it.
    if (!booking || (booking.userId && booking.userId !== currentUserId)) {
      throw new BookingServiceError(
        `Booking ${id} not found.`,
        'BOOKING_NOT_FOUND',
      );
    }

    return booking;
  }

  // Ownership rules match getBooking: anon proposals are readable by
  // anyone with the reference; owned rows are only readable by the owner. Cross-
  // tenant reads return not-found (same shape as truly missing).
  async getBookingByReference(
    reference: string,
    opts?: { currentUserId?: string | null },
  ): Promise<BookingWithRelations> {
    const currentUserId = opts?.currentUserId ?? null;
    let booking: BookingWithRelations | null;

    try {
      booking = await this.repo.findByReference(reference);
    } catch (err) {
      throw internal('Database error while fetching booking.', err);
    }

    // Cross-tenant guard. 404 (not 403) so a scan of references can't enumerate.
    // If the booking has a userId and it does not match the current user's ID, throw a BookingServiceError with code 'BOOKING_NOT_FOUND'. This prevents users from accessing bookings that belong to other users. A booking may have a non-null userId if it was proposed while the user was signed in. In that case, only the owner can access it. If the booking has a null userId, it means it was proposed anonymously, and any user can access it.
    if (!booking || (booking.userId && booking.userId !== currentUserId)) {
      throw new BookingServiceError(
        `Booking with reference "${reference}" not found.`,
        'BOOKING_NOT_FOUND',
      );
    }
    return booking;
  }
}

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

function generateReference(): string {
  // Booking.reference is @unique, so a collision surfaces as Prisma
  // P2002 (unique-constraint violation) inside tx.booking.create and
  // gets re-wrapped as an opaque INTERNAL_ERROR — no automatic
  // retry-with-new-reference, and re-calling proposeBooking with the
  // same idempotency_key doesn't help (the failed create rolled back,
  // so findByIdempotencyKey still returns null). At 3 bytes / 6 hex
  // chars (~16.7M values) birthday-collision probability crossed 50%
  // at ~4.8K bookings/year — too tight. 6 bytes / 12 hex chars gives
  // ~281 trillion values (birthday-50% at ~20M/year), so the collision
  // path stays vanishingly unlikely at any realistic scale and we
  // don't need to add retry-loop machinery. The guardrail's reference
  // regex already accepts 4+ suffix chars, so this length bump is
  // backward-compatible with existing references.
  const year = new Date().getUTCFullYear();
  const suffix = randomBytes(6).toString('hex').toUpperCase();
  return `BKG-${year}-${suffix}`;
}

// Round a number to 1 decimal place. This is used for pricing calculations to ensure that we do not have more than 1 decimal place in the total price. For example, if the total price is 123.456, it will be rounded to 123.5.
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Wraps unexpected errors (typically Prisma failures inside a $transaction
// callback) as BookingServiceError('INTERNAL_ERROR'). See
// internalErrorFactory in CodedServiceError.ts for the shared shape.
const internal = internalErrorFactory(BookingServiceError);
