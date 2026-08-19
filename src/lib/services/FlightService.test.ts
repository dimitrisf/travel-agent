import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { FlightService } from './FlightService';
import { TravelServiceError } from './TravelServiceError';
import type {
  FlightRepository,
  FlightSearchRow,
} from '../repositories/FlightRepository';

// ─── Mock repository helper ─────────────────────────────────────────

// FlightRepository is a class; casting a plain object with vi.fn() stubs
// is the standard escape hatch (TS structural typing accepts anything
// with the same shape).
function mockRepo(overrides: Partial<FlightRepository> = {}): FlightRepository {
  return {
    airportExists: vi.fn(),
    findInstances: vi.fn(),
    ...overrides,
  } as unknown as FlightRepository;
}

// Factory for a well-shaped FlightSearchRow — tests override only the
// fields they care about.
function row(overrides: Partial<FlightSearchRow> = {}): FlightSearchRow {
  return {
    flightInstanceId: 1,
    flightNumber: 'A3 824',
    airlineName: 'Aegean',
    airlineIata: 'A3',
    basePriceEUR: 100,
    stops: 0,
    durationMinutes: 180,
    departureDatetime: new Date('2026-07-10T09:00:00.000Z'),
    arrivalDatetime: new Date('2026-07-10T12:00:00.000Z'),
    origin: { iata: 'ATH', name: 'Athens Intl', city: 'Athens' },
    destination: { iata: 'BER', name: 'Berlin Brandenburg', city: 'Berlin' },
    ...overrides,
  };
}

describe('FlightService.searchFlights', () => {
  it('returns { outbound, inbound } for a valid round-trip search', async () => {
    const repo = mockRepo({
      airportExists: vi.fn().mockResolvedValue(true),
      findInstances: vi
        .fn()
        // Outbound
        .mockResolvedValueOnce([row({ flightInstanceId: 1 })])
        // Inbound
        .mockResolvedValueOnce([row({ flightInstanceId: 2 })]),
    });
    const service = new FlightService(repo);

    const result = await service.searchFlights({
      origin: 'ATH',
      destination: 'BER',
      departure_date: '2026-07-10',
      return_date: '2026-07-13',
    });

    expect(result.outbound).toHaveLength(1);
    expect(result.inbound).toHaveLength(1);
    expect(result.outbound[0].flight_instance_id).toBe(1);
    expect(result.inbound[0].flight_instance_id).toBe(2);
  });

  it('returns inbound: [] for a one-way search (no return_date)', async () => {
    const repo = mockRepo({
      airportExists: vi.fn().mockResolvedValue(true),
      findInstances: vi.fn().mockResolvedValueOnce([row()]),
    });
    const service = new FlightService(repo);

    const result = await service.searchFlights({
      origin: 'ATH',
      destination: 'BER',
      departure_date: '2026-07-10',
    });

    expect(result.outbound).toHaveLength(1);
    expect(result.inbound).toEqual([]);
    // Only one repo.findInstances call (no return-leg query).
    expect(repo.findInstances).toHaveBeenCalledTimes(1);
  });

  it('rejects non-EUR currency at parse time (demo is EUR-only)', async () => {
    // Regression: prices are computed as basePriceEUR * cabin multiplier
    // and returned unconverted. A caller passing currency:'USD' with
    // max_price:150 would previously get EUR-valued numbers labeled
    // 'USD' and a max-price filter compared against EUR while the caller
    // thinks it's in USD — silent mispricing on both axes. Now the
    // literal-schema rejects non-EUR before any repo call.
    const repo = mockRepo();
    const service = new FlightService(repo);

    let caught: unknown;
    try {
      await service.searchFlights({
        origin: 'ATH',
        destination: 'BER',
        departure_date: '2026-07-10',
        currency: 'USD' as 'EUR', // bypass TS to simulate a runtime caller
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as { name?: string }).name).toBe('ZodError');
    // Parse threw before any repo touch.
    expect(repo.airportExists).not.toHaveBeenCalled();
  });

  it('throws INVALID_DATE_RANGE when return_date <= departure_date', async () => {
    const service = new FlightService(mockRepo());
    await expect(
      service.searchFlights({
        origin: 'ATH',
        destination: 'BER',
        departure_date: '2026-07-13',
        return_date: '2026-07-10',
      }),
    ).rejects.toMatchObject({
      name: 'TravelServiceError',
      code: 'INVALID_DATE_RANGE',
    });
  });

  it('throws AIRPORT_NOT_FOUND for missing origin', async () => {
    const repo = mockRepo({
      airportExists: vi
        .fn()
        // origin
        .mockResolvedValueOnce(false)
        // destination
        .mockResolvedValueOnce(true),
    });
    const service = new FlightService(repo);
    await expect(
      service.searchFlights({
        origin: 'XXX',
        destination: 'BER',
        departure_date: '2026-07-10',
      }),
    ).rejects.toMatchObject({
      code: 'AIRPORT_NOT_FOUND',
      message: expect.stringContaining('Origin airport "XXX"'),
    });
  });

  it('throws AIRPORT_NOT_FOUND for missing destination', async () => {
    const repo = mockRepo({
      airportExists: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });
    const service = new FlightService(repo);
    await expect(
      service.searchFlights({
        origin: 'ATH',
        destination: 'XXX',
        departure_date: '2026-07-10',
      }),
    ).rejects.toMatchObject({
      code: 'AIRPORT_NOT_FOUND',
      message: expect.stringContaining('Destination airport "XXX"'),
    });
  });

  it('wraps airportExists throws as INTERNAL_ERROR with cause', async () => {
    const rootCause = new Error('DB down');
    const repo = mockRepo({
      airportExists: vi.fn().mockRejectedValue(rootCause),
    });
    const service = new FlightService(repo);

    let caught: unknown;
    try {
      await service.searchFlights({
        origin: 'ATH',
        destination: 'BER',
        departure_date: '2026-07-10',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TravelServiceError);
    expect((caught as TravelServiceError).code).toBe('INTERNAL_ERROR');
    expect((caught as TravelServiceError).cause).toBe(rootCause);
  });

  it('wraps findInstances throws as INTERNAL_ERROR with cause', async () => {
    const rootCause = new Error('SQL error');
    const repo = mockRepo({
      airportExists: vi.fn().mockResolvedValue(true),
      findInstances: vi.fn().mockRejectedValue(rootCause),
    });
    const service = new FlightService(repo);

    let caught: unknown;
    try {
      await service.searchFlights({
        origin: 'ATH',
        destination: 'BER',
        departure_date: '2026-07-10',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TravelServiceError);
    expect((caught as TravelServiceError).code).toBe('INTERNAL_ERROR');
    expect((caught as TravelServiceError).cause).toBe(rootCause);
  });

  it('applies cabin multiplier (business = 3x base price)', async () => {
    const repo = mockRepo({
      airportExists: vi.fn().mockResolvedValue(true),
      findInstances: vi.fn().mockResolvedValueOnce([row({ basePriceEUR: 100 })]),
    });
    const service = new FlightService(repo);

    const result = await service.searchFlights({
      origin: 'ATH',
      destination: 'BER',
      departure_date: '2026-07-10',
      cabin_class: 'business',
    });

    expect(result.outbound[0].price).toBe(300);
  });

  it('applies max_price filter after cabin multiplier is applied', async () => {
    const repo = mockRepo({
      airportExists: vi.fn().mockResolvedValue(true),
      findInstances: vi.fn().mockResolvedValueOnce([
        row({ flightInstanceId: 1, basePriceEUR: 100 }), // premium_economy=150
        row({ flightInstanceId: 2, basePriceEUR: 200 }), // premium_economy=300
      ]),
    });
    const service = new FlightService(repo);

    const result = await service.searchFlights({
      origin: 'ATH',
      destination: 'BER',
      departure_date: '2026-07-10',
      cabin_class: 'premium_economy',
      max_price: 200,
    });

    // Only flight 1 (price 150) passes; flight 2 (price 300) filtered out.
    expect(result.outbound).toHaveLength(1);
    expect(result.outbound[0].flight_instance_id).toBe(1);
  });

  it('normalizes IATA codes to uppercase before repo lookup', async () => {
    const repo = mockRepo({
      airportExists: vi.fn().mockResolvedValue(true),
      findInstances: vi.fn().mockResolvedValueOnce([]),
    });
    const service = new FlightService(repo);

    await service.searchFlights({
      origin: 'ath',
      destination: 'ber',
      departure_date: '2026-07-10',
    });

    expect(repo.airportExists).toHaveBeenCalledWith('ATH');
    expect(repo.airportExists).toHaveBeenCalledWith('BER');
  });

  it('throws ZodError for invalid IATA length', async () => {
    const service = new FlightService(mockRepo());
    await expect(
      service.searchFlights({
        origin: 'ATHENS', // 6 chars — not 3
        destination: 'BER',
        departure_date: '2026-07-10',
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it('throws ZodError for malformed departure_date', async () => {
    const service = new FlightService(mockRepo());
    await expect(
      service.searchFlights({
        origin: 'ATH',
        destination: 'BER',
        departure_date: '10-07-2026', // wrong format
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});
