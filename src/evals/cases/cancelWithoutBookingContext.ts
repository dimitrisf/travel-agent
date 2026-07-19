import type { Case } from '../types';
import {
  finalMessageMatches,
  noErrorsOrGuardrails,
  toolNotCalled,
} from '../assertions';

// Cancellation with no prior booking in the conversation. User asks to
// cancel out of the blue — the agent has no numeric booking id to pass
// to `cancel_booking`, so it must ask for clarification (booking id, or
// details to find the booking). It must NOT call cancel_booking with a
// guessed id or hallucinate a target booking.
//
// The TravelAgent prompt already covers this: "If the user asks about a
// prior booking ('what's the status of BKG-…', 'did my booking go
// through'), use `get_booking` with the numeric id (the reference is
// human-facing; if you only have the reference, ask for the numeric id)."
// This case regression-checks that guidance for the cancel path — the
// same rule applies whether the user is looking up a booking or
// cancelling one.
//
// Single-turn: the whole scenario fits in one user prompt.
export const cancelWithoutBookingContext: Case = {
  name: 'cancel-without-booking-context',
  description:
    'Single-turn: user asks to cancel a booking with no prior booking context and no numeric id. Agent must NOT call cancel_booking; must ask for the booking id.',
  user: 'Cancel my booking, please.',
  expect: (out) => [
    noErrorsOrGuardrails(out),
    // No numeric id has been given, so cancel_booking must not fire —
    // firing it with a guessed id would be a real drift (cancels the
    // wrong booking or errors out with 404).
    toolNotCalled(out, 'cancel_booking'),
    // Final message should ask for identifying info — id, reference, or
    // enough details to locate the booking. Loose regex to survive
    // phrasing variance.
    finalMessageMatches(
      out,
      /\b(?:id|reference|number|which\s+booking|booking\s+number|booking\s+id|which\s+one)\b/i,
      'final message asks for the booking id or reference',
    ),
  ],
};
