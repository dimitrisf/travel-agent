import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { WeatherService } from './WeatherService';
import { WeatherServiceError } from './WeatherServiceError';
import type {
  CurrentWeatherRow,
  ForecastRow,
  WeatherRepository,
} from '../repositories/WeatherRepository';

// ─── Mock repository helper ─────────────────────────────────────────

function mockRepo(
  overrides: Partial<WeatherRepository> = {},
): WeatherRepository {
  return {
    findCurrentWeatherByCity: vi.fn(),
    findForecastByCity: vi.fn(),
    ...overrides,
  };
}

// ─── getCurrentWeather ──────────────────────────────────────────────

describe('WeatherService.getCurrentWeather', () => {
  it('returns { ...row, units: "celsius" } on success', async () => {
    const row: CurrentWeatherRow = {
      city: 'Athens',
      tempC: 33.7,
      conditions: 'clear sky',
    };
    const repo = mockRepo({
      findCurrentWeatherByCity: vi.fn().mockResolvedValue(row),
    });
    const service = new WeatherService(repo);

    const result = await service.getCurrentWeather({ city: 'Athens' });

    expect(result).toEqual({ ...row, units: 'celsius' });
    expect(repo.findCurrentWeatherByCity).toHaveBeenCalledWith('Athens');
  });

  it('throws ZodError for empty city input (validation)', async () => {
    const service = new WeatherService(mockRepo());
    await expect(
      service.getCurrentWeather({ city: '' }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it('trims whitespace from city input', async () => {
    const repo = mockRepo({
      findCurrentWeatherByCity: vi.fn().mockResolvedValue({
        city: 'Berlin',
        tempC: 20,
        conditions: 'clear sky',
      }),
    });
    const service = new WeatherService(repo);
    await service.getCurrentWeather({ city: '  Berlin  ' });
    expect(repo.findCurrentWeatherByCity).toHaveBeenCalledWith('Berlin');
  });

  it('throws WeatherServiceError CITY_NOT_FOUND when repo returns null', async () => {
    const repo = mockRepo({
      findCurrentWeatherByCity: vi.fn().mockResolvedValue(null),
    });
    const service = new WeatherService(repo);

    await expect(
      service.getCurrentWeather({ city: 'Atlantis' }),
    ).rejects.toMatchObject({
      name: 'WeatherServiceError',
      code: 'CITY_NOT_FOUND',
      message: 'City "Atlantis" not found.',
    });
  });

  it('wraps repo throws as INTERNAL_ERROR with cause preserved', async () => {
    const rootCause = new Error('OWM 500');
    const repo = mockRepo({
      findCurrentWeatherByCity: vi.fn().mockRejectedValue(rootCause),
    });
    const service = new WeatherService(repo);

    let caught: unknown;
    try {
      await service.getCurrentWeather({ city: 'Athens' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(WeatherServiceError);
    expect((caught as WeatherServiceError).code).toBe('INTERNAL_ERROR');
    expect((caught as WeatherServiceError).message).toBe(
      'Failed to fetch current weather.',
    );
    expect((caught as WeatherServiceError).cause).toBe(rootCause);
  });
});

// ─── getForecast ────────────────────────────────────────────────────

describe('WeatherService.getForecast', () => {
  const validRow: ForecastRow = {
    city: 'Berlin',
    days: [
      { date: '2026-08-08', tempCMin: 18, tempCMax: 26, conditions: 'clear' },
      { date: '2026-08-09', tempCMin: 17, tempCMax: 25, conditions: 'clear' },
      { date: '2026-08-10', tempCMin: 19, tempCMax: 27, conditions: 'clear' },
    ],
  };

  it('returns { ...row, units, requestedDays, providedDays } on success', async () => {
    const repo = mockRepo({
      findForecastByCity: vi.fn().mockResolvedValue(validRow),
    });
    const service = new WeatherService(repo);

    const result = await service.getForecast({ city: 'Berlin', days: 3 });

    expect(result).toEqual({
      ...validRow,
      units: 'celsius',
      requestedDays: 3,
      providedDays: 3,
    });
    expect(repo.findForecastByCity).toHaveBeenCalledWith('Berlin', 3);
  });

  it('defaults days to 3 when omitted', async () => {
    const repo = mockRepo({
      findForecastByCity: vi.fn().mockResolvedValue(validRow),
    });
    const service = new WeatherService(repo);

    await service.getForecast({ city: 'Berlin' });

    expect(repo.findForecastByCity).toHaveBeenCalledWith('Berlin', 3);
  });

  it('providedDays reflects row.days.length (shortfall case)', async () => {
    // Caller asked for 7, repo (e.g. live mode) capped at 5. Service
    // reports both so the agent can honestly acknowledge.
    const shortRow: ForecastRow = {
      city: 'Tokyo',
      days: validRow.days.concat([
        { date: '2026-08-11', tempCMin: 20, tempCMax: 28, conditions: 'rain' },
        { date: '2026-08-12', tempCMin: 21, tempCMax: 29, conditions: 'rain' },
      ]),
    };
    const repo = mockRepo({
      findForecastByCity: vi.fn().mockResolvedValue(shortRow),
    });
    const service = new WeatherService(repo);

    const result = await service.getForecast({ city: 'Tokyo', days: 7 });

    expect(result.requestedDays).toBe(7);
    expect(result.providedDays).toBe(5);
  });

  it('throws ZodError for days outside 1-7', async () => {
    const service = new WeatherService(mockRepo());
    await expect(
      service.getForecast({ city: 'Berlin', days: 0 }),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      service.getForecast({ city: 'Berlin', days: 8 }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it('throws ZodError for non-integer days', async () => {
    const service = new WeatherService(mockRepo());
    await expect(
      service.getForecast({ city: 'Berlin', days: 3.5 }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it('throws CITY_NOT_FOUND when repo returns null', async () => {
    const repo = mockRepo({
      findForecastByCity: vi.fn().mockResolvedValue(null),
    });
    const service = new WeatherService(repo);

    await expect(
      service.getForecast({ city: 'Atlantis' }),
    ).rejects.toMatchObject({
      code: 'CITY_NOT_FOUND',
      message: 'City "Atlantis" not found.',
    });
  });

  it('throws NO_FORECAST_AVAILABLE when repo returns row with empty days', async () => {
    const repo = mockRepo({
      findForecastByCity: vi
        .fn()
        .mockResolvedValue({ city: 'Berlin', days: [] }),
    });
    const service = new WeatherService(repo);

    await expect(service.getForecast({ city: 'Berlin' })).rejects.toMatchObject(
      {
        code: 'NO_FORECAST_AVAILABLE',
        message: 'No forecast available for "Berlin".',
      },
    );
  });

  it('wraps repo throws as INTERNAL_ERROR with cause preserved', async () => {
    const rootCause = new Error('OWM timeout');
    const repo = mockRepo({
      findForecastByCity: vi.fn().mockRejectedValue(rootCause),
    });
    const service = new WeatherService(repo);

    let caught: unknown;
    try {
      await service.getForecast({ city: 'Berlin' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(WeatherServiceError);
    expect((caught as WeatherServiceError).code).toBe('INTERNAL_ERROR');
    expect((caught as WeatherServiceError).cause).toBe(rootCause);
  });
});
