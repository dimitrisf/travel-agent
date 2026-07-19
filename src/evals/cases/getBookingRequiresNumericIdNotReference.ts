import type { Case } from '../types';
import {
  finalMessageMatches,
  noErrorsOrGuardrails,
  toolNotCalled,
} from '../assertions';

// Stage 16 — enforces the reference-vs-id distinction from the prompt at
// buildTravelAgent.ts:93: "the reference is human-facing; if you only
// have the reference, ask for the numeric id."
//
// User asks about "booking BKG-1234" out of the blue. Two things must
// NOT happen:
//   1. Agent must NOT call get_booking(1234) — 1234 is the digits from
//      the reference string, not a real numeric id. Calling it would
//      either 404 or (worse) return an unrelated booking that happens
//      to have id=1234.
//   2. Agent must not fabricate a status ("your booking BKG-1234 is
//      confirmed"). The Stage 11 booking-claim classifier would catch
//      that at runtime, but here we cut it off before it happens by
//      requiring the agent to ask for the numeric id instead.
//
// Assertion: final message asks for the numeric id. Loose regex — the
// model phrases the ask lots of ways ("could you give me the numeric
// id", "what's the id number", "the booking number", etc.) so we accept
// any of the identifier words.
export const getBookingRequiresNumericIdNotReference: Case = {
  name: 'get-booking-requires-numeric-id-not-reference',
  description:
    'Single-turn: user gives only the BKG-… reference. Agent must NOT call get_booking with the digit portion; must ask for the numeric id.',
  user: "What's the status of my booking BKG-1234?",
  expect: (out) => [
    noErrorsOrGuardrails(out),
    // Critical: no guessing 1234 as the id. Firing get_booking here would
    // either 404 or return an unrelated booking — either way, drift.
    toolNotCalled(out, 'get_booking'),
    // Final message asks for identifying info. Accepts "numeric id",
    // "id number", "booking number", "which number", etc.
    finalMessageMatches(
      out,
      /\b(?:numeric|id|number)\b/i,
      'final message asks for the numeric id',
    ),
  ],
};
