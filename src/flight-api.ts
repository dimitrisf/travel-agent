import 'dotenv/config';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  createFlightService,
  isTravelServiceError,
  isZodValidationError,
  parseBool,
  parseList,
  type SearchFlightsInput,
} from './lib';

const app = express();
const PORT = Number(process.env.FLIGHT_API_PORT ?? 3001);
const flightService = createFlightService();

app.get('/flights', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = parseSearchFlightsQuery(req);
    const result = await flightService.searchFlights(input);
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
        err.code === 'AIRPORT_NOT_FOUND'
          ? 404
          : err.code === 'INVALID_DATE_RANGE'
            ? 400
            : 500;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    console.error('[flight-api] unexpected error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  },
);

app.listen(PORT, () => {
  console.log(`Flight API listening on http://localhost:${PORT}`);
  console.log(
    `  GET /flights?origin=ATH&destination=BER&departure_date=2026-07-03`,
  );
});

// ───────────────────────────────────────────────
// Query-string parsing
// ───────────────────────────────────────────────

// Why do we need the transformation implemented by the parseSearchFlightsQuery() function, since the q fields are identical to the returned object fields?The transformation implemented by the `parseSearchFlightsQuery()` function is necessary for several reasons, even though the query string fields (`q`) are identical to the returned object fields in terms of names. Here are the key reasons:
// 1. **Type Conversion**: Query string parameters are always received as strings. The `parseSearchFlightsQuery()` function converts these string values into the appropriate types expected by the `SearchFlightsInput` interface. For example, it converts `adults` and `children` to numbers, and `nonstop_only` to a boolean.
// 2. **Optional Parameters**: The function handles optional parameters by checking if they are present in the query string. If a parameter is not provided, it assigns `undefined` to the corresponding field in the returned object, which is important for the service to understand that the parameter was not specified.
// 3. **Default Values**: The function can provide default values for certain parameters if they are not present in the query string, ensuring that the service receives a complete and valid input object.
// 4. **Validation and Sanitization**: The function can perform basic validation and sanitization of the input values, such as trimming whitespace or filtering out empty strings from lists, which helps prevent errors and ensures that the service receives clean data.
// 5. **Consistency**: By centralizing the parsing logic in one function, it ensures that all requests to the `/flights` endpoint are processed consistently, reducing the risk of bugs and making it easier to maintain the code.
function parseSearchFlightsQuery(req: Request): SearchFlightsInput {
  const q = req.query;
  return {
    origin: String(q.origin ?? ''),
    destination: String(q.destination ?? ''),
    departure_date: String(q.departure_date ?? ''),
    return_date: q.return_date != null ? String(q.return_date) : undefined,
    adults: q.adults != null ? Number(q.adults) : undefined,
    children: q.children != null ? Number(q.children) : undefined,
    cabin_class:
      q.cabin_class != null
        ? (String(q.cabin_class) as SearchFlightsInput['cabin_class'])
        : undefined,
    nonstop_only: parseBool(q.nonstop_only),
    max_price: q.max_price != null ? Number(q.max_price) : undefined,
    preferred_airlines: parseList(q.preferred_airlines),
    currency: q.currency != null ? String(q.currency) : undefined,
  };
}

