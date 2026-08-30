import { z } from 'zod';

// Single source of truth for the cabin classes the demo supports.
// Everything that names them — validators, JSON-schema tool specs,
// UI dropdowns, the price multiplier below — reads from here. Adding
// or renaming a cabin is a one-file change; the exhaustive
// Record<CabinClass, number> below forces the multiplier update, and
// consumers that iterate `CabinClass.options` pick up new values
// automatically.
//
// Consumers today:
//   - src/lib/services/FlightService.ts             (CabinClass in SearchFlightsInput)
//   - src/lib/services/BookingService.ts            (CabinClass in ProposeBookingInput)
//   - src/mcp/tools/travel/searchFlightsToolSpec.ts (CabinClass.options in JSON schema enum)
//   - src/mcp/tools/travel/proposeBookingToolSpec.ts (CabinClass.options in JSON schema enum)
//   - app/explorer/flights/page.tsx                  (CabinClass.options in the cabin dropdown)
export const CabinClass = z.enum([
  'economy',
  'premium_economy',
  'business',
  'first',
]);
export type CabinClass = z.infer<typeof CabinClass>;

// Multipliers applied to FlightDefinition.basePriceEUR to derive the
// per-seat price for a given cabin. Rough industry-typical estimates —
// real airlines vary these by route, day-of-week, load, and elite
// status; we don't. What matters here is that FlightService.searchFlights
// (the quote the user sees) and BookingService.proposeBooking (the
// price the user is charged) BOTH read from THIS map — any divergence
// would produce a stealth price bump between quote and booking.
//
// Typed as Record<CabinClass, number> (not `as const`) so a new cabin
// added to the CabinClass enum above forces a compile-time error here
// until the multiplier is filled in.
export const CABIN_MULTIPLIER: Record<CabinClass, number> = {
  economy: 1,
  premium_economy: 1.5,
  business: 3,
  first: 6,
};
