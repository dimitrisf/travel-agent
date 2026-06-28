import express, { type Request, type Response } from 'express';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

type Conditions = { tempC: number; conditions: string };

const cities: Record<string, Conditions> = {
  Athens: { tempC: 32, conditions: 'sunny' },
  London: { tempC: 18, conditions: 'overcast with light rain' },
  Tokyo: { tempC: 26, conditions: 'humid, partly cloudy' },
  'New York': { tempC: 21, conditions: 'clear' },
};

app.get('/weather', (req: Request, res: Response) => {
  const city = String(req.query.city ?? '').trim();
  if (!city) {
    return res
      .status(400)
      .json({ error: 'Query parameter "city" is required.' });
  }
  const w = cities[city];
  if (!w) {
    return res.status(404).json({ error: `City "${city}" not found.` });
  }
  return res.json({ city, ...w, units: 'celsius' });
});

app.get('/forecast', (req: Request, res: Response) => {
  const city = String(req.query.city ?? '').trim();
  const daysRaw = Number(req.query.days ?? 3);
  if (!city) {
    return res
      .status(400)
      .json({ error: 'Query parameter "city" is required.' });
  }
  if (!Number.isInteger(daysRaw) || daysRaw < 1 || daysRaw > 7) {
    return res
      .status(400)
      .json({ error: '"days" must be an integer between 1 and 7.' });
  }
  const base = cities[city];
  if (!base) {
    return res.status(404).json({ error: `City "${city}" not found.` });
  }

  const today = new Date();
  const days = Array.from({ length: daysRaw }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + i);
    // Add some jitter to min/max temperatures for variety
    const jitter = (i * 1.7) % 5;
    return {
      // Return date in YYYY-MM-DD format
      date: d.toISOString().slice(0, 10),
      // Return min/max temperatures with some jitter
      tempCMin: round1(base.tempC - 4 - jitter),
      // Return max temperature with some jitter
      tempCMax: round1(base.tempC + 2 + jitter),
      conditions: base.conditions,
    };
  });

  return res.json({ city, units: 'celsius', days });
});

function round1(n: number): number {
  // Round to 1 decimal place
  return Math.round(n * 10) / 10;
}

app.listen(PORT, () => {
  console.log(`Weather REST API listening on http://localhost:${PORT}`);
  console.log(`  GET /weather?city=Athens`);
  console.log(`  GET /forecast?city=Athens&days=3`);
});
