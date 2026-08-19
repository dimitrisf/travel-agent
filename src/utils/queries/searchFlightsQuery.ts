import type { NextRequest } from 'next/server';
import type { SearchFlightsInput } from '@/lib';
import { parseBool, parseList } from '@/utils/parsers';

// Helper function to parse the query parameters from the request URL and return a SearchFlightsInput object. This function handles optional parameters and converts them to the appropriate types (e.g., number, boolean, array).
export function parseSearchFlightsQuery(req: NextRequest): SearchFlightsInput {
  const q = req.nextUrl.searchParams;
  return {
    origin: String(q.get('origin') ?? ''),
    destination: String(q.get('destination') ?? ''),
    departure_date: String(q.get('departure_date') ?? ''),
    return_date: q.get('return_date') ?? undefined,
    adults: q.get('adults') !== null ? Number(q.get('adults')) : undefined,
    children:
      q.get('children') !== null ? Number(q.get('children')) : undefined,
    cabin_class:
      q.get('cabin_class') !== null
        ? (String(q.get('cabin_class')) as SearchFlightsInput['cabin_class'])
        : undefined,
    nonstop_only: parseBool(q.get('nonstop_only')),
    max_price:
      q.get('max_price') !== null ? Number(q.get('max_price')) : undefined,
    preferred_airlines: parseList(q.get('preferred_airlines')),
    // Cast to the input type — Zod at the FlightService boundary
    // validates the literal ('EUR' only) and rejects other values.
    currency:
      q.get('currency') !== null
        ? (String(q.get('currency')) as SearchFlightsInput['currency'])
        : undefined,
  };
}
