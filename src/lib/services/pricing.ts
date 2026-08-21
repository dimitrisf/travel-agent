import { z } from 'zod';

// Cabin class enum, shared by FlightService's search path and
// BookingService's propose path so the same string set is validated
// on both sides. Adding or renaming a cabin here forces every caller
// (via the exhaustive Record<CabinClass, number> below) to update in
// lockstep — no more silent divergence between the price quoted at
// search time and the price charged at booking time.
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
