import 'dotenv/config';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  createHotelService,
  isTravelServiceError,
  isZodValidationError,
  parseBool,
  type SearchHotelsInput,
} from './lib';

const app = express();
const PORT = Number(process.env.HOTEL_API_PORT ?? 3002);
const hotelService = createHotelService();

app.get('/hotels', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = parseSearchHotelsQuery(req);
    const result = await hotelService.searchHotels(input);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────
// Error handling middleware
// ───────────────────────────────────────────────
app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (isZodValidationError(err)) {
      res.status(400).json({
        error: 'Invalid request parameters.',
        issues: err.issues,
      });
      return;
    }
    if (isTravelServiceError(err)) {
      const status =
        err.code === 'CITY_NOT_FOUND'
          ? 404
          : err.code === 'INVALID_DATE_RANGE'
            ? 400
            : 500;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    console.error('[hotel-api] unexpected error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  },
);

app.listen(PORT, () => {
  console.log(`Hotel API listening on http://localhost:${PORT}`);
  console.log(
    `  GET /hotels?city=Berlin&checkin=2026-07-03&checkout=2026-07-06`,
  );
});

// ───────────────────────────────────────────────
// Query-string parsing
// ───────────────────────────────────────────────

function parseSearchHotelsQuery(req: Request): SearchHotelsInput {
  const q = req.query;
  return {
    city: String(q.city ?? ''),
    checkin: String(q.checkin ?? ''),
    checkout: String(q.checkout ?? ''),
    guests: q.guests != null ? Number(q.guests) : undefined,
    rooms: q.rooms != null ? Number(q.rooms) : undefined,
    min_stars: q.min_stars != null ? Number(q.min_stars) : undefined,
    max_price: q.max_price != null ? Number(q.max_price) : undefined,
    currency: q.currency != null ? String(q.currency) : undefined,
    breakfast_required: parseBool(q.breakfast_required),
    free_cancellation: parseBool(q.free_cancellation),
    pet_friendly: parseBool(q.pet_friendly),
  };
}

