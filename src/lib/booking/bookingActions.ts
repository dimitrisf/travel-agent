import type { BookingLike } from '@/types/booking';

// One canonical implementation of the "POST /api/booking/<id>/<action>
// and unpack the response" round-trip, shared across every caller
// that flips a booking's status via the two action endpoints:
//
//   - confirm: AnonChatResumeHandler's parallel POST arm,
//              BookingPanel's OAuth-return effect,
//              BookingCard's Confirm button click.
//   - cancel:  BookingCard's Cancel button click (also used from
//              PAID → CANCELLED via the same button in a different
//              state).
//
// Both endpoints share exactly the same contract — POST with a JSON
// content-type, response body is a BookingLike on 2xx or `{ error }`
// on non-2xx — so `confirmBooking` and `cancelBooking` are thin
// wrappers around `postBookingAction`. Any future change to the
// contract (error field name, headers, success payload, retry
// policy, timing metrics) happens in one place instead of drifting
// across the four call sites.
//
// Contract for the exported helpers: return the fresh BookingLike on
// success; throw an Error with the server-provided message (or
// `HTTP <status>` if the server didn't include one) on non-2xx.
// Never return null — call sites that want best-effort semantics
// wrap with .catch or try/catch.

export async function confirmBooking(bookingId: number): Promise<BookingLike> {
  return postBookingAction(bookingId, 'confirm');
}

export async function cancelBooking(bookingId: number): Promise<BookingLike> {
  return postBookingAction(bookingId, 'cancel');
}

async function postBookingAction(
  bookingId: number,
  action: 'confirm' | 'cancel',
): Promise<BookingLike> {
  const res = await fetch(`/api/booking/${bookingId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const body = (await res.json()) as BookingLike & { error?: string };

  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return body;
}
