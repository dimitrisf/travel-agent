import type { PrismaClient } from '@prisma/client';

export interface CurrentWeatherRow {
  city: string;
  tempC: number;
  conditions: string;
}

export interface ForecastDayRow {
  date: string;
  tempCMin: number;
  tempCMax: number;
  conditions: string;
}

export interface ForecastRow {
  city: string;
  days: ForecastDayRow[];
}

export class WeatherRepository {
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
