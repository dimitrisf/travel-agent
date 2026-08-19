import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { BookingService } from './BookingService';
import type {
  BookingRepository,
  BookingWithRelations,
} from '../repositories/BookingRepository';

// NOTE (Phase 2 scope):
// BookingService.proposeBooking / confirmBooking / cancelBooking use
// `this.prisma.$transaction(...)` directly and read/write many Prisma
// tables inside the callback. Mocking that safely is more brittle than
// it's worth; they need a real Prisma test DB to exercise properly.
// Deferred to Phase 2b (repo/integration tests). This file covers only
// the read methods (getBooking, getBookingByReference) which depend
// solely on this.repo — cleanly mockable.

function mockRepo(
  overrides: Partial<BookingRepository> = {},
): BookingRepository {
  return {
    findById: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    findByReference: vi.fn(),
    ...overrides,
  } as unknown as BookingRepository;
}

// Only the fields getBooking/getBookingByReference read from the
// booking row are populated; unused nested Prisma types cast through
// unknown.
function booking(
  overrides: Partial<BookingWithRelations> = {},
): BookingWithRelations {
  return {
    id: 1,
    userId: null,
    reference: 'BKG-2026-ABC123',
    status: 'PROPOSED',
    totalPriceEUR: 500,
    currency: 'EUR',
    ...overrides,
  } as unknown as BookingWithRelations;
}

// PrismaClient is never touched by the read methods, but the
// constructor requires it. Empty stub is fine.
const stubPrisma = {} as PrismaClient;

// ─── getBooking ────────────────────────────────────────────────────

describe('BookingService.getBooking', () => {
  it('returns the booking for the owner', async () => {
    const row = booking({ userId: 'user-1' });
    const repo = mockRepo({ findById: vi.fn().mockResolvedValue(row) });
    const service = new BookingService(stubPrisma, repo);

    const result = await service.getBooking(1, { currentUserId: 'user-1' });
    expect(result).toBe(row);
  });

  it('returns an anon booking (userId: null) for any caller', async () => {
    const row = booking({ userId: null });
    const repo = mockRepo({ findById: vi.fn().mockResolvedValue(row) });
    const service = new BookingService(stubPrisma, repo);

    // Anon caller.
    expect(await service.getBooking(1, { currentUserId: null })).toBe(row);
    // Signed-in but not the owner (doesn't matter since userId is null).
    expect(await service.getBooking(1, { currentUserId: 'user-99' })).toBe(row);
  });

  it('throws BOOKING_NOT_FOUND when the booking does not exist', async () => {
    const repo = mockRepo({ findById: vi.fn().mockResolvedValue(null) });
    const service = new BookingService(stubPrisma, repo);

    await expect(service.getBooking(999)).rejects.toMatchObject({
      name: 'BookingServiceError',
      code: 'BOOKING_NOT_FOUND',
    });
  });

  it('throws BOOKING_NOT_FOUND (not 403) for a cross-tenant caller — no info leak', async () => {
    const row = booking({ userId: 'user-1' });
    const repo = mockRepo({ findById: vi.fn().mockResolvedValue(row) });
    const service = new BookingService(stubPrisma, repo);

    // Caller is user-2, booking belongs to user-1. Should get the same
    // shape of error as if the booking didn't exist — no way to
    // enumerate ids across tenants.
    await expect(
      service.getBooking(1, { currentUserId: 'user-2' }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });

  it('throws BOOKING_NOT_FOUND when caller is anon and booking has an owner', async () => {
    const row = booking({ userId: 'user-1' });
    const repo = mockRepo({ findById: vi.fn().mockResolvedValue(row) });
    const service = new BookingService(stubPrisma, repo);

    await expect(
      service.getBooking(1, { currentUserId: null }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });

  it('wraps repo throws as INTERNAL_ERROR with cause preserved', async () => {
    const rootCause = new Error('DB down');
    const repo = mockRepo({
      findById: vi.fn().mockRejectedValue(rootCause),
    });
    const service = new BookingService(stubPrisma, repo);

    let caught: unknown;
    try {
      await service.getBooking(1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({
      name: 'BookingServiceError',
      code: 'INTERNAL_ERROR',
    });
    expect((caught as { cause: unknown }).cause).toBe(rootCause);
  });
});

// ─── getBookingByReference ─────────────────────────────────────────

describe('BookingService.getBookingByReference', () => {
  it('returns the booking for the owner (looked up by reference)', async () => {
    const row = booking({ userId: 'user-1', reference: 'BKG-2026-XYZ789' });
    const repo = mockRepo({ findByReference: vi.fn().mockResolvedValue(row) });
    const service = new BookingService(stubPrisma, repo);

    const result = await service.getBookingByReference('BKG-2026-XYZ789', {
      currentUserId: 'user-1',
    });
    expect(result).toBe(row);
    expect(repo.findByReference).toHaveBeenCalledWith('BKG-2026-XYZ789');
  });

  it('throws BOOKING_NOT_FOUND when the reference does not exist', async () => {
    const repo = mockRepo({
      findByReference: vi.fn().mockResolvedValue(null),
    });
    const service = new BookingService(stubPrisma, repo);

    await expect(
      service.getBookingByReference('BKG-9999'),
    ).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
      message: expect.stringContaining('BKG-9999'),
    });
  });

  it('throws BOOKING_NOT_FOUND for cross-tenant reference lookup', async () => {
    const row = booking({ userId: 'user-1', reference: 'BKG-2026-XYZ789' });
    const repo = mockRepo({ findByReference: vi.fn().mockResolvedValue(row) });
    const service = new BookingService(stubPrisma, repo);

    await expect(
      service.getBookingByReference('BKG-2026-XYZ789', {
        currentUserId: 'user-2',
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });

  it('returns an anon booking regardless of currentUserId', async () => {
    const row = booking({ userId: null, reference: 'BKG-2026-ANON001' });
    const repo = mockRepo({ findByReference: vi.fn().mockResolvedValue(row) });
    const service = new BookingService(stubPrisma, repo);

    expect(
      await service.getBookingByReference('BKG-2026-ANON001', {
        currentUserId: null,
      }),
    ).toBe(row);
    expect(
      await service.getBookingByReference('BKG-2026-ANON001', {
        currentUserId: 'user-99',
      }),
    ).toBe(row);
  });

  it('wraps repo throws as INTERNAL_ERROR with cause preserved', async () => {
    const rootCause = new Error('DB timeout');
    const repo = mockRepo({
      findByReference: vi.fn().mockRejectedValue(rootCause),
    });
    const service = new BookingService(stubPrisma, repo);

    let caught: unknown;
    try {
      await service.getBookingByReference('BKG-anything');
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({
      name: 'BookingServiceError',
      code: 'INTERNAL_ERROR',
    });
    expect((caught as { cause: unknown }).cause).toBe(rootCause);
  });
});

// ─── proposeBooking (input validation only — Phase 2b covers the tx path) ──

describe('BookingService.proposeBooking input validation', () => {
  it('rejects duplicate flight_instance_id across legs before touching Prisma', async () => {
    // Regression: without the schema-level dedup guard, confirm's
    // per-leg updateMany would decrement seatsAvailable on the same
    // FlightInstance twice for one booking — over-reserving inventory
    // and charging the customer for a 2× phantom leg. The refinement
    // catches this at parse time, before any Prisma or repo call.
    const repo = mockRepo();
    const service = new BookingService(stubPrisma, repo);

    let caught: unknown;
    try {
      await service.proposeBooking({
        idempotency_key: 'abc-123',
        flights: [
          { flight_instance_id: 123, adults: 2 },
          { flight_instance_id: 123, adults: 2 },
        ],
      });
    } catch (err) {
      caught = err;
    }
    // ZodError shape (parse threw synchronously inside proposeBooking).
    expect((caught as { name?: string }).name).toBe('ZodError');
    expect(String(caught)).toContain('Duplicate flight_instance_id');
    // No repo call happened — refinement fired first.
    expect(repo.findByIdempotencyKey).not.toHaveBeenCalled();
  });
});
