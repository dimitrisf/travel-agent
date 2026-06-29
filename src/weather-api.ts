import 'dotenv/config';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  createWeatherService,
  isWeatherServiceError,
  isZodValidationError,
} from './lib';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const weatherService = createWeatherService();

app.get('/weather', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await weatherService.getCurrentWeather({
      city: String(req.query.city ?? ''),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get(
  '/forecast',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await weatherService.getForecast({
        city: String(req.query.city ?? ''),
        days: req.query.days !== undefined ? Number(req.query.days) : undefined,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Error handling middleware
app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (isZodValidationError(err)) {
      res.status(400).json({
        error: 'Invalid request parameters.',
        issues: err.issues,
      });
      return;
    }
    if (isWeatherServiceError(err)) {
      const status =
        err.code === 'CITY_NOT_FOUND' || err.code === 'NO_FORECAST_AVAILABLE'
          ? 404
          : 500;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    console.error('[weather-api] unexpected error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  },
);

app.listen(PORT, () => {
  console.log(`Weather REST API listening on http://localhost:${PORT}`);
  console.log(`  GET /weather?city=Athens`);
  console.log(`  GET /forecast?city=Athens&days=3`);
});
