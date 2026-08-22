import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestPrisma, resetDb } from '@/lib/testing/prismaTestClient';
import {
  seedProposeBookingFixture,
  seedUser,
} from '@/lib/testing/seedFixtures';
import { BookingService } from './BookingService';
import { BookingRepository } from '../repositories/BookingRepository';

// Phase 2b — first integration test for the transactional write path.
// Exercises BookingService.proposeBooking against a real Postgres
// (docker-compose postgres-test) rather than a mocked repo.
//
// Why this needs a real DB (rather than joining the mocked suite in
// BookingService.test.ts): proposeBooking runs inside prisma.$transaction
// and executes 3 batched findManys + a create-with-nested-writes. A
// faithful mock would need to also mock every method the tx callback
// uses; the maintenance cost is higher than just booting Postgres.
// See README section "Deferred to Phase 2b (and beyond)" for the
// broader rationale.

describe('BookingService.proposeBooking (integration)', () => {
  let prisma: PrismaClient;
  let service: BookingService;

  beforeAll(() => {
    prisma = createTestPrisma();
    service = new BookingService(prisma, new BookingRepository(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('creates a PROPOSED booking with the correct nested flight + hotel rows and total', async () => {
    const fx = await seedProposeBookingFixture(prisma);

    const booking = await service.proposeBooking({
      idempotency_key: 'test-key-1',
      flights: [
        {
          flight_instance_id: fx.flightInstanceId,
          cabin_class: 'economy',
          adults: 2,
          children: 1,
        },
      ],
      hotels: [
        {
          room_type_id: fx.roomTypeId,
          checkin: fx.checkin,
          checkout: fx.checkout,
          guests: 2,
          rooms: 1,
        },
      ],
    });

    expect(booking.status).toBe('PROPOSED');
    // BKG-YYYY-<12 hex chars>. See generateReference in BookingService.ts.
    expect(booking.reference).toMatch(/^BKG-\d{4}-[A-F0-9]{12}$/);
    // Anonymous propose → userId stays null until Confirm.
    expect(booking.userId).toBeNull();
    expect(booking.customerName).toBeNull();
    expect(booking.customerEmail).toBeNull();

    // Flight: economy multiplier = 1, so €120/seat × (2 adults + 1 child)
    // = €360 for the leg.
    expect(booking.flightBookings).toHaveLength(1);
    const leg = booking.flightBookings[0];
    expect(leg.seats).toBe(3);
    expect(leg.pricePerSeatEUR).toBe(120);
    expect(leg.totalPriceEUR).toBe(360);
    expect(leg.cabinClass).toBe('economy');

    // Hotel: 2 nights × €150 × 1 room = €300.
    expect(booking.hotelBookings).toHaveLength(1);
    const stay = booking.hotelBookings[0];
    expect(stay.nights).toBe(2);
    expect(stay.rooms).toBe(1);
    expect(stay.totalPriceEUR).toBe(300);

    // Trip total = 360 + 300 = 660. Confirms round1(flightTotal + hotelTotal)
    // rolls up correctly across the two subsystems.
    expect(booking.totalPriceEUR).toBe(660);
  });

  it('returns the existing row on retry with the same idempotency_key', async () => {
    const fx = await seedProposeBookingFixture(prisma);
    const input = {
      idempotency_key: 'test-key-idempotent',
      flights: [
        {
          flight_instance_id: fx.flightInstanceId,
          cabin_class: 'economy' as const,
          adults: 1,
          children: 0,
        },
      ],
      hotels: [],
    };

    const first = await service.proposeBooking(input);
    const second = await service.proposeBooking(input);

    expect(second.id).toBe(first.id);
    expect(second.reference).toBe(first.reference);
    // Idempotency short-circuits BEFORE the $transaction. Sanity-check
    // that only one row hit the DB (a second create would have thrown
    // on the reference @unique constraint).
    const count = await prisma.booking.count();
    expect(count).toBe(1);
  });
});

// Confirm requires the transactional write path a mocked repo can't
// exercise — inventory CAS decrement (updateMany with `seatsAvailable
// { gte: N }`), Payment row creation, status transition, ownership
// claim. The concurrent-CAS test at the end is the specific thing
// that pushed us into Phase 2b in the first place: two racing confirms
// where mocking couldn't reproduce the READ COMMITTED snapshot both
// callers see, only for one to lose at the updateMany.
describe('BookingService.confirmBooking (integration)', () => {
  let prisma: PrismaClient;
  let service: BookingService;

  beforeAll(() => {
    prisma = createTestPrisma();
    service = new BookingService(prisma, new BookingRepository(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  // Propose a canonical 3-seat + 2-night booking against the shared
  // fixture and return the row. All confirm tests below start from a
  // PROPOSED booking; centralising avoids duplicating 20 lines per test.
  //
  // `userId` optional so we can exercise both anonymous propose
  // (userId=null, ownership claimed at confirm) and signed-in propose
  // (userId already set, confirm is idempotent on ownership fields).
  async function seedProposedBooking(opts?: { userId?: string }) {
    const fx = await seedProposeBookingFixture(prisma);
    const booking = await service.proposeBooking({
      idempotency_key: `test-key-${Math.random()}`,
      user_id: opts?.userId,
      flights: [
        {
          flight_instance_id: fx.flightInstanceId,
          cabin_class: 'economy',
          adults: 2,
          children: 1,
        },
      ],
      hotels: [
        {
          room_type_id: fx.roomTypeId,
          checkin: fx.checkin,
          checkout: fx.checkout,
          guests: 2,
          rooms: 1,
        },
      ],
    });
    return { fx, booking };
  }

  it('transitions PROPOSED → PAID, decrements inventory, creates SUCCEEDED Payment, claims ownership', async () => {
    const { fx, booking } = await seedProposedBooking();
    const alice = await seedUser(prisma, {
      id: 'alice',
      name: 'Alice Anderson',
      email: 'alice@example.com',
    });

    const confirmed = await service.confirmBooking(booking.id, alice);

    // Status + timestamp.
    expect(confirmed.status).toBe('PAID');
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);

    // Ownership claimed from currentUser (was null on the PROPOSED row).
    expect(confirmed.userId).toBe(alice.id);
    expect(confirmed.customerName).toBe(alice.name);
    expect(confirmed.customerEmail).toBe(alice.email);

    // Inventory decremented exactly once (flight had 100 seats, booking is 3).
    const flightInstance = await prisma.flightInstance.findUnique({
      where: { id: fx.flightInstanceId },
    });
    expect(flightInstance?.seatsAvailable).toBe(97);

    // Availability decremented per-night (fixture had 5/night, booking is 1 room).
    const availability = await prisma.availability.findMany({
      where: { roomTypeId: fx.roomTypeId },
      orderBy: { date: 'asc' },
    });
    expect(availability).toHaveLength(2);
    expect(availability.every((a) => a.roomsAvailable === 4)).toBe(true);

    // Payment row created with the propose-time frozen total.
    const payments = await prisma.payment.findMany({
      where: { bookingId: booking.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('SUCCEEDED');
    expect(payments[0].provider).toBe('stub');
    expect(payments[0].amount).toBe(booking.totalPriceEUR);
    expect(payments[0].completedAt).toBeInstanceOf(Date);
  });

  it('claims ownership on anon-propose → signed-in-confirm (userId, name, email all filled from currentUser)', async () => {
    // Explicit userId=undefined = anon propose (default already, but
    // the assertion below only makes sense against that starting shape).
    const { booking } = await seedProposedBooking();
    expect(booking.userId).toBeNull();
    expect(booking.customerName).toBeNull();
    expect(booking.customerEmail).toBeNull();

    const alice = await seedUser(prisma, {
      id: 'alice',
      name: 'Alice A.',
      email: 'alice@example.com',
    });

    const confirmed = await service.confirmBooking(booking.id, alice);

    expect(confirmed.userId).toBe(alice.id);
    expect(confirmed.customerName).toBe(alice.name);
    expect(confirmed.customerEmail).toBe(alice.email);
  });

  it('throws INSUFFICIENT_SEATS and rolls back the transaction when the flight has fewer seats than the booking', async () => {
    const { fx, booking } = await seedProposedBooking();
    const alice = await seedUser(prisma, { id: 'alice' });

    // Booking asks for 3 seats; leave only 2 available so the CAS
    // updateMany's `seatsAvailable >= 3` predicate misses.
    await prisma.flightInstance.update({
      where: { id: fx.flightInstanceId },
      data: { seatsAvailable: 2 },
    });

    await expect(service.confirmBooking(booking.id, alice)).rejects.toMatchObject({
      name: 'BookingServiceError',
      code: 'INSUFFICIENT_SEATS',
    });

    // Rollback proof: nothing touched. Status still PROPOSED, no Payment,
    // Availability untouched (2 nights × 5 rooms), flight seats unchanged (2).
    const after = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(after?.status).toBe('PROPOSED');
    expect(after?.confirmedAt).toBeNull();
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(0);
    const flightAfter = await prisma.flightInstance.findUnique({
      where: { id: fx.flightInstanceId },
    });
    expect(flightAfter?.seatsAvailable).toBe(2);
    const avail = await prisma.availability.findMany({
      where: { roomTypeId: fx.roomTypeId },
    });
    expect(avail.every((a) => a.roomsAvailable === 5)).toBe(true);
  });

  it('throws INSUFFICIENT_ROOMS and rolls back when a single night is short', async () => {
    const { fx, booking } = await seedProposedBooking();
    const alice = await seedUser(prisma, { id: 'alice' });

    // Zero out just ONE night — the `updated.count !== stay.nights` guard
    // must fire on the partial match, not on the whole stay being empty.
    await prisma.availability.updateMany({
      where: {
        roomTypeId: fx.roomTypeId,
        date: new Date('2026-08-26T00:00:00.000Z'),
      },
      data: { roomsAvailable: 0 },
    });

    await expect(service.confirmBooking(booking.id, alice)).rejects.toMatchObject({
      name: 'BookingServiceError',
      code: 'INSUFFICIENT_ROOMS',
    });

    // Rollback proof: Booking still PROPOSED, no Payment, the flight
    // seats were NOT decremented (hotel loop runs after flight loop, so
    // the flight update would have happened and then been undone).
    const after = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(after?.status).toBe('PROPOSED');
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(0);
    const flightAfter = await prisma.flightInstance.findUnique({
      where: { id: fx.flightInstanceId },
    });
    expect(flightAfter?.seatsAvailable).toBe(100);
  });

  it('throws BOOKING_NOT_FOUND when a different user tries to confirm someone else\'s owned booking (cross-tenant guard, 404 not 403)', async () => {
    const alice = await seedUser(prisma, { id: 'alice' });
    const bob = await seedUser(prisma, { id: 'bob' });

    // Alice proposes with her session — row has userId=alice.
    const { booking } = await seedProposedBooking({ userId: alice.id });
    expect(booking.userId).toBe(alice.id);

    await expect(service.confirmBooking(booking.id, bob)).rejects.toMatchObject({
      name: 'BookingServiceError',
      // BOOKING_NOT_FOUND, not FORBIDDEN — same shape as truly-missing so
      // Bob can't enumerate Alice's booking ids by probing responses.
      code: 'BOOKING_NOT_FOUND',
    });

    // Rollback proof: Alice's booking is untouched.
    const after = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(after?.status).toBe('PROPOSED');
    expect(after?.userId).toBe(alice.id);
  });

  it('throws INVALID_STATE when confirming an already-PAID booking; no duplicate Payment row', async () => {
    const { booking } = await seedProposedBooking();
    const alice = await seedUser(prisma, { id: 'alice' });

    // First confirm succeeds.
    await service.confirmBooking(booking.id, alice);

    // Second confirm on the same PAID row must be rejected.
    await expect(service.confirmBooking(booking.id, alice)).rejects.toMatchObject({
      name: 'BookingServiceError',
      code: 'INVALID_STATE',
    });

    // Exactly one Payment (Payment has no unique key on bookingId — the
    // guard is the loadBookingForConfirm status check + the markPaidAndClaim
    // CAS updateMany, both of which must reject the second call).
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it('CAS race: two simultaneous confirms → exactly one wins, other throws INVALID_STATE, no double Payment or double inventory decrement', async () => {
    const { fx, booking } = await seedProposedBooking();
    const alice = await seedUser(prisma, { id: 'alice' });

    // Second Prisma client so the two confirms use independent
    // connection pools — otherwise they'd get serialized on the same
    // client and never actually race. This is the setup that lets us
    // reproduce the READ COMMITTED snapshot both callers see, only
    // for one to lose at the markPaidAndClaim CAS updateMany.
    const prisma2 = createTestPrisma();
    const service2 = new BookingService(prisma2, new BookingRepository(prisma2));

    try {
      const results = await Promise.allSettled([
        service.confirmBooking(booking.id, alice),
        service2.confirmBooking(booking.id, alice),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // The loser: could throw from any of three CAS points depending on
      // which side is further along when the winner commits — the seats
      // updateMany, the rooms updateMany, or the markPaidAndClaim status
      // CAS. All three produce a BookingServiceError. What matters for
      // this test is that state stayed consistent (asserted below), not
      // which specific throw fired.
      const loser = rejected[0] as PromiseRejectedResult;
      expect(loser.reason).toMatchObject({ name: 'BookingServiceError' });
      expect([
        'INVALID_STATE',
        'INSUFFICIENT_SEATS',
        'INSUFFICIENT_ROOMS',
      ]).toContain(
        (loser.reason as { code: string }).code,
      );

      // Final state: booking PAID once.
      const final = await prisma.booking.findUnique({
        where: { id: booking.id },
      });
      expect(final?.status).toBe('PAID');
      expect(final?.userId).toBe(alice.id);

      // Exactly one Payment row.
      expect(
        await prisma.payment.count({ where: { bookingId: booking.id } }),
      ).toBe(1);

      // Seats decremented exactly once: 100 - 3 = 97. Double-decrement
      // would leave 94, which is the specific corruption the CAS pattern
      // exists to prevent.
      const flightInstance = await prisma.flightInstance.findUnique({
        where: { id: fx.flightInstanceId },
      });
      expect(flightInstance?.seatsAvailable).toBe(97);

      // Availability decremented exactly once per night: 5 - 1 = 4.
      const availability = await prisma.availability.findMany({
        where: { roomTypeId: fx.roomTypeId },
      });
      expect(availability.every((a) => a.roomsAvailable === 4)).toBe(true);
    } finally {
      await prisma2.$disconnect();
    }
  });
});
