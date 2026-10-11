import type { SelectedFlight, SelectedHotel } from '@/context/SelectionContext';
import type { BookingLike, BookingStatus } from '@/types/booking';
import { formatDate } from './format';

// Booking tool names — used to switch rendering from generic accordion to a
// rich BookingCard with Confirm / Cancel buttons.
export const BOOKING_TOOL_NAMES = new Set<string>([
  'propose_booking',
  'get_booking',
  'cancel_booking',
]);

// Try to parse a tool output as a Booking. Returns null if the output isn't
// a booking-shaped JSON object (or isn't JSON at all).
export function tryParseBooking(
  output: string | undefined,
): BookingLike | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { id?: unknown }).id === 'number' &&
      typeof (parsed as { reference?: unknown }).reference === 'string' &&
      typeof (parsed as { status?: unknown }).status === 'string'
    ) {
      return parsed as BookingLike;
    }
  } catch {
    // not JSON — not a booking
  }
  return null;
}

// statusChipColor returns the MUI color for a booking status. E.g., 'PROPOSED' → 'warning', 'CONFIRMED' → 'success', 'CANCELLED' → 'error'.
export function statusChipColor(
  status: BookingStatus,
): 'default' | 'success' | 'error' | 'warning' {
  switch (status) {
    case 'PROPOSED':
      return 'warning';
    case 'CONFIRMED':
    case 'PAID':
      return 'success';
    case 'CANCELLED':
    case 'FAILED':
      return 'error';
    default:
      return 'default';
  }
}

// Full booking window: min(start of every leg + stay) → max(end of
// every leg + stay). Gives a booking a "when is this trip?" summary
// without unpacking the individual line items. Returns null for a
// booking with no flights AND no hotels (shouldn't happen in
// practice — proposeBooking rejects empty inputs — but the guard
// keeps callers from rendering "Invalid Date" if we ever seed one).
export function computeBookingDateRange(
  booking: BookingLike,
): { start: string; end: string } | null {
  const starts: string[] = [];
  const ends: string[] = [];

  for (const leg of booking.flightBookings) {
    starts.push(leg.flightInstance.departureDatetime);
    ends.push(leg.flightInstance.arrivalDatetime);
  }

  for (const stay of booking.hotelBookings) {
    starts.push(stay.checkinDate);
    ends.push(stay.checkoutDate);
  }

  if (starts.length === 0) return null;

  // Lexical sort of ISO datetimes coincides with chronological order,
  // so no Date-parsing needed — cheaper and doesn't drift on TZ.
  starts.sort();
  ends.sort();

  return { start: starts[0], end: ends[ends.length - 1] };
}

// "Mon, 12 Sep" when start and end fall on the same day (one-way
// same-day flight or single-night stay); "Mon, 12 Sep → Thu, 15 Sep"
// otherwise. Reuses formatDate for consistency with the rest of the
// app's date rendering (UTC-anchored so flight datetimes don't
// drift by local offset).
export function formatBookingDateRange(start: string, end: string): string {
  const startLabel = formatDate(start);
  const endLabel = formatDate(end);
  return startLabel === endLabel ? startLabel : `${startLabel} → ${endLabel}`;
}

// "1 night" / "3 nights" — small plural-aware helper so hotel labels
// in SelectionBar + CartSummary stay consistent without each call site
// re-doing the singular/plural check.
export function formatNights(n: number): string {
  return `${n} ${n === 1 ? 'night' : 'nights'}`;
}

// Composes a flight's display label from the raw fields stored on
// SelectedFlight. Called by SelectionBar, CartSummary, and FlightRow's
// aria-labels — never by the row-click handler, so the stored payload
// stays pure data. Date segment uses formatDate for consistency with
// the hotel label; the time segment is sliced from the ISO datetime so
// a locale change doesn't shift the departure clock.
export function formatFlightLabel(f: SelectedFlight): string {
  const date = f.departure.slice(0, 10);
  const depTime = f.departure.slice(11, 16);
  return `${f.airline} ${f.flight_number} · ${f.origin_iata} → ${f.destination_iata} · ${formatDate(date)} ${depTime}`;
}

// Composes a hotel's display label — base label (hotel name · room
// type, snapshotted at selection) + stay dates + night count. Mirrors
// formatFlightLabel so SelectionBar and CartSummary call a single
// helper per cart row type instead of hand-rolling the hotel template
// at each site. The date segment and night count are composed from
// raw fields, so format changes propagate to existing cart entries.
export function formatHotelLabel(h: SelectedHotel): string {
  return `${h.label} · ${formatBookingDateRange(h.checkin, h.checkout)} (${formatNights(h.nights)})`;
}
