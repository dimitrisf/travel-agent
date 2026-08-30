import type { CabinClass } from '@/lib/pricing';

// Turns the flights search form's state into the GET /api/flights URL.
// Only includes params that differ from the API's defaults so the curl
// command the user copies stays as short and readable as possible.
//
// Options-object arg (not positional) — nine fields is far past the
// point where argument order becomes a hazard, and it keeps callers
// self-documenting at the call site.

export type FlightsQueryInput = {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  cabinClass: CabinClass;
  adults: number;
  children: number;
  nonstopOnly: boolean;
  maxPrice: number | undefined;
};

export function buildFlightsQuery(input: FlightsQueryInput): string {
  const params = new URLSearchParams();
  if (input.origin) params.set('origin', input.origin);
  if (input.destination) params.set('destination', input.destination);
  if (input.departureDate) params.set('departure_date', input.departureDate);
  if (input.returnDate) params.set('return_date', input.returnDate);
  if (input.cabinClass !== 'economy')
    params.set('cabin_class', input.cabinClass);
  if (input.adults !== 1) params.set('adults', String(input.adults));
  if (input.children > 0) params.set('children', String(input.children));
  if (input.nonstopOnly) params.set('nonstop_only', 'true');
  if (input.maxPrice !== undefined)
    params.set('max_price', String(input.maxPrice));
  return `/api/flights?${params.toString()}`;
}
