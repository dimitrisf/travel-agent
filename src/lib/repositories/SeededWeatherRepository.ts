import type { PrismaClient } from '@prisma/client';
import type { WeatherRepository } from './WeatherRepository';
import type { CurrentWeatherRow, ForecastRow } from '@/types/weather';

// Seeded adapter for WeatherRepository (Stage 20). Reads from the Neon
// Prisma-backed tables that the demo library populates. This is what
// the eval suite runs against so results stay deterministic.
//
// Paired with LiveWeatherRepository (OpenWeatherMap) — createWeatherService
// picks between them based on the USE_SEEDED_WEATHER env var. Interface
// contract lives in WeatherRepository.ts; both files implement it.
export class SeededWeatherRepository implements WeatherRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findCurrentWeatherByCity(
    cityName: string,
  ): Promise<CurrentWeatherRow | null> {
    const row = await this.prisma.currentWeather.findFirst({
      where: { city: { name: cityName } },
      include: { city: true, conditions: true },
    });
    if (!row) return null;
    return {
      city: row.city.name,
      tempC: row.tempC,
      conditions: row.conditions.description,
    };
  }

  async findForecastByCity(
    cityName: string,
    days: number,
  ): Promise<ForecastRow | null> {
    const city = await this.prisma.city.findUnique({
      where: { name: cityName },
    });
    if (!city) return null;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const rows = await this.prisma.forecast.findMany({
      where: {
        cityId: city.id,
        date: { gte: today },
      },
      include: { conditions: true },
      orderBy: { date: 'asc' },
      take: days,
    });

    return {
      city: city.name,
      days: rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        tempCMin: r.tempCMin,
        tempCMax: r.tempCMax,
        conditions: r.conditions.description,
      })),
    };
  }
}
