import type { NextRequest } from 'next/server';
import type { SearchHotelsInput } from '@/lib';
import { parseBool } from '@/utils/parsers';

// Helper function to parse the query parameters from the request URL and return a SearchHotelsInput object. This function handles optional parameters and converts them to the appropriate types (e.g., number, boolean).
export function parseSearchHotelsQuery(req: NextRequest): SearchHotelsInput {
  const q = req.nextUrl.searchParams;
  return {
    city: String(q.get('city') ?? ''),
    checkin: String(q.get('checkin') ?? ''),
    checkout: String(q.get('checkout') ?? ''),
    guests: q.get('guests') !== null ? Number(q.get('guests')) : undefined,
    rooms: q.get('rooms') !== null ? Number(q.get('rooms')) : undefined,
    min_stars:
      q.get('min_stars') !== null ? Number(q.get('min_stars')) : undefined,
    max_price:
      q.get('max_price') !== null ? Number(q.get('max_price')) : undefined,
    currency: q.get('currency') ?? undefined,
    breakfast_required: parseBool(q.get('breakfast_required')),
    free_cancellation: parseBool(q.get('free_cancellation')),
    pet_friendly: parseBool(q.get('pet_friendly')),
  };
}
