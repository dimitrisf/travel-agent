import type { FlightResult } from '@/lib/services/FlightService';

// Client-side sort applied per leg (outbound and return each hold their
// own SortSpec). Departure time is always the tie-breaker in ascending
// order — so a price-desc sort still groups same-price flights by
// earliest departure first, which is the sensible reading.

export type SortMode = 'departure' | 'duration' | 'price';
export type SortDir = 'asc' | 'desc';
export type SortSpec = { mode: SortMode; direction: SortDir };

export const DEFAULT_SORT: SortSpec = { mode: 'price', direction: 'asc' };

// Grid template shared by the sortable header row and every flight row
// so the column headers line up exactly over the values below them.
// Trailing `auto` column is reserved for the per-row "Add to booking"
// toggle (the header renders an empty slot there).
export const FLIGHT_ROW_GRID = '90px 130px 90px 1fr auto auto';

export function compareFlights(
  sort: SortSpec,
  a: FlightResult,
  b: FlightResult,
): number {
  let primary: number;

  switch (sort.mode) {
    case 'departure':
      primary = a.departure.localeCompare(b.departure);
      break;
    case 'duration':
      primary = a.duration_minutes - b.duration_minutes;
      break;
    case 'price':
      primary = a.price - b.price;
      break;
  }

  if (primary !== 0) return sort.direction === 'desc' ? -primary : primary;

  // Tie-breaker: always use departure time ascending.
  return sort.mode === 'departure' ? 0 : a.departure.localeCompare(b.departure);
}

// Click cycle: inactive → asc; active-asc → desc; active-desc → asc.
// No "off" state — every leg is always sorted by something.
export function toggleSort(current: SortSpec, mode: SortMode): SortSpec {
  if (current.mode !== mode) return { mode, direction: 'asc' };
  return { mode, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}
