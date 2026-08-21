import { z } from 'zod';

// Canonical ISO-date primitive shared by every service that takes a
// YYYY-MM-DD string on the wire (FlightService.searchFlights,
// HotelService.searchHotels, BookingService.proposeBooking). Extracted
// so tightening the check (e.g. swapping to z.string().date() from
// zod ≥3.23 to reject '9999-99-99' / '0000-00-00') or aligning error
// messages happens in one place instead of three.
//
// Deliberately does NOT do calendar-validity or timezone parsing here:
// callers turn the string into a Date themselves (usually as
// `new Date(`${s}T00:00:00.000Z`)`) once the shape is known-safe.
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format');
