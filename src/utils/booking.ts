import type { BookingLike, BookingStatus } from '@/types/booking';

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
