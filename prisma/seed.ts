import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONDITIONS = [
  'sunny',
  'overcast with light rain',
  'humid, partly cloudy',
  'clear',
  'clear, windy',
] as const;

const CITY_SEED: Record<
  string,
  { tempC: number; conditions: (typeof CONDITIONS)[number] }
> = {
  Athens: { tempC: 32, conditions: 'sunny' },
  London: { tempC: 18, conditions: 'overcast with light rain' },
  Tokyo: { tempC: 26, conditions: 'humid, partly cloudy' },
  'New York': { tempC: 21, conditions: 'clear' },
};

const FORECAST_DAYS = 7;

async function main() {
  console.log('Seeding conditions…');
  const conditionsByDescription = new Map<string, number>();
  for (const description of CONDITIONS) {
    const row = await prisma.conditions.upsert({
      where: { description },
      update: {},
      create: { description },
    });
    conditionsByDescription.set(description, row.id);
  }

  console.log('Seeding cities, current weather, and forecasts…');
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const [cityName, { tempC, conditions }] of Object.entries(CITY_SEED)) {
    const city = await prisma.city.upsert({
      where: { name: cityName },
      update: {},
      create: { name: cityName },
    });

    const conditionsId = conditionsByDescription.get(conditions)!;

    await prisma.currentWeather.upsert({
      where: { cityId: city.id },
      update: { tempC, conditionsId },
      create: { cityId: city.id, tempC, conditionsId },
    });

    for (let i = 0; i < FORECAST_DAYS; i++) {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() + i);
      const jitter = (i * 1.7) % 5;
      const dailyCondition =
        i % 3 === 2 ? pickRotatingCondition(i) : conditions;

      await prisma.forecast.upsert({
        where: { cityId_date: { cityId: city.id, date } },
        update: {
          tempCMin: round1(tempC - 4 - jitter),
          tempCMax: round1(tempC + 2 + jitter),
          conditionsId: conditionsByDescription.get(dailyCondition)!,
        },
        create: {
          cityId: city.id,
          date,
          tempCMin: round1(tempC - 4 - jitter),
          tempCMax: round1(tempC + 2 + jitter),
          conditionsId: conditionsByDescription.get(dailyCondition)!,
        },
      });
    }
  }

  console.log('Done.');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pickRotatingCondition(i: number): (typeof CONDITIONS)[number] {
  return CONDITIONS[i % CONDITIONS.length]!;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
