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
import { seedProposeBookingFixture } from '@/lib/testing/seedFixtures';
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
