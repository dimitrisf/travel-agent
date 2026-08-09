import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { HotelService } from './HotelService';
import { TravelServiceError } from './TravelServiceError';
import type {
  HotelRepository,
  HotelSearchOptions,
  HotelSearchRow,
} from '../repositories/HotelRepository';

function mockRepo(overrides: Partial<HotelRepository> = {}): HotelRepository {
  return {
    cityExists: vi.fn(),
    findAvailable: vi.fn(),
    ...overrides,
  } as unknown as HotelRepository;
}

function row(overrides: Partial<HotelSearchRow> = {}): HotelSearchRow {
  return {
    hotelId: 1,
    roomTypeId: 10,
    hotelName: 'Test Hotel',
    address: '1 Test St',
    city: 'Berlin',
    stars: 4,
    rating: 8.5,
    roomTypeName: 'Deluxe',
    totalPrice: 300,
    avgPricePerNight: 100,
    nights: 3,
    currency: 'EUR',
    amenities: ['Wifi', 'Breakfast'],
    freeCancellation: true,
    cancellationDescription: 'Free cancellation up to 24h before check-in.',
    ...overrides,
  };
}

describe('HotelService.searchHotels', () => {
  it('returns mapped HotelResult[] on success', async () => {
    const repo = mockRepo({
      cityExists: vi.fn().mockResolvedValue(true),
      findAvailable: vi.fn().mockResolvedValue([row()]),
    });
    const service = new HotelService(repo);

    const result = await service.searchHotels({
      city: 'Berlin',
      checkin: '2026-07-10',
      checkout: '2026-07-13',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      hotel_id: 1,
      room_type_id: 10,
      hotel: 'Test Hotel',
      price_per_night: 100,
      total_price: 300,
      nights: 3,
    });
  });

  it('throws INVALID_DATE_RANGE when checkout <= checkin', async () => {
    const service = new HotelService(mockRepo());
    await expect(
      service.searchHotels({
        city: 'Berlin',
        checkin: '2026-07-13',
        checkout: '2026-07-10',
      }),
    ).rejects.toMatchObject({
      name: 'TravelServiceError',
      code: 'INVALID_DATE_RANGE',
    });
  });

  it('throws CITY_NOT_FOUND when repo.cityExists returns false', async () => {
    const repo = mockRepo({
      cityExists: vi.fn().mockResolvedValue(false),
    });
    const service = new HotelService(repo);
    await expect(
      service.searchHotels({
        city: 'Atlantis',
        checkin: '2026-07-10',
        checkout: '2026-07-13',
      }),
    ).rejects.toMatchObject({
      code: 'CITY_NOT_FOUND',
      message: 'City "Atlantis" not found.',
    });
  });

  it('wraps cityExists throws as INTERNAL_ERROR with cause', async () => {
    const rootCause = new Error('DB down');
    const repo = mockRepo({
      cityExists: vi.fn().mockRejectedValue(rootCause),
    });
    const service = new HotelService(repo);

    let caught: unknown;
    try {
      await service.searchHotels({
        city: 'Berlin',
        checkin: '2026-07-10',
        checkout: '2026-07-13',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TravelServiceError);
    expect((caught as TravelServiceError).code).toBe('INTERNAL_ERROR');
    expect((caught as TravelServiceError).cause).toBe(rootCause);
  });

  it('wraps findAvailable throws as INTERNAL_ERROR with cause', async () => {
    const rootCause = new Error('SQL error');
    const repo = mockRepo({
      cityExists: vi.fn().mockResolvedValue(true),
      findAvailable: vi.fn().mockRejectedValue(rootCause),
    });
    const service = new HotelService(repo);

    let caught: unknown;
    try {
      await service.searchHotels({
        city: 'Berlin',
        checkin: '2026-07-10',
        checkout: '2026-07-13',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TravelServiceError);
    expect((caught as TravelServiceError).code).toBe('INTERNAL_ERROR');
    expect((caught as TravelServiceError).cause).toBe(rootCause);
  });

  it('passes requiredAmenities computed from breakfast_required + pet_friendly flags', async () => {
    const findAvailable = vi.fn().mockResolvedValue([]);
    const repo = mockRepo({
      cityExists: vi.fn().mockResolvedValue(true),
      findAvailable,
    });
    const service = new HotelService(repo);

    await service.searchHotels({
      city: 'Berlin',
      checkin: '2026-07-10',
      checkout: '2026-07-13',
      breakfast_required: true,
      pet_friendly: true,
    });

    const callArg = findAvailable.mock.calls[0][0] as HotelSearchOptions;
    expect(callArg.requiredAmenities).toEqual(['Breakfast', 'Pet Friendly']);
  });

  it('passes empty requiredAmenities when neither flag is set', async () => {
    const findAvailable = vi.fn().mockResolvedValue([]);
    const repo = mockRepo({
      cityExists: vi.fn().mockResolvedValue(true),
      findAvailable,
    });
    const service = new HotelService(repo);

    await service.searchHotels({
      city: 'Berlin',
      checkin: '2026-07-10',
      checkout: '2026-07-13',
    });

    const callArg = findAvailable.mock.calls[0][0] as HotelSearchOptions;
    expect(callArg.requiredAmenities).toEqual([]);
  });

  it('throws ZodError for empty city', async () => {
    const service = new HotelService(mockRepo());
    await expect(
      service.searchHotels({
        city: '',
        checkin: '2026-07-10',
        checkout: '2026-07-13',
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it('throws ZodError for malformed checkin/checkout dates', async () => {
    const service = new HotelService(mockRepo());
    await expect(
      service.searchHotels({
        city: 'Berlin',
        checkin: '07/10/2026',
        checkout: '2026-07-13',
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});
