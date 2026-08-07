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
// Assertion: final message either asks for identifying info OR deflects
// to sign-in. Both are valid responses — the CRITICAL check is the
// no-tool-call above (never call get_booking with digits extracted from
// the BKG- reference). Prompt-level, the model gets two acceptable
// paths: (a) "give me the numeric id" (line ~93 of buildTravelAgent.ts),
// or (b) "get_booking is auth-gated for past bookings, sign in first"
// (line ~101 — the Phase 2 sign-in reminder). Both leave the user in a
// well-defined recoverable state.
//
// Loosened Stage 19 after CI + local runs showed the model choosing (b)
// non-deterministically. The failure was purely an over-narrow
// assertion, not an agent bug — attempting to force (a) via prompt
// hardening would over-constrain when (b) is equally correct.
export const getBookingRequiresNumericIdNotReference: Case = {
  name: 'get-booking-requires-numeric-id-not-reference',
  description:
    'Single-turn: user gives only the BKG-… reference. Agent must NOT call get_booking with the digit portion; must either ask for the numeric id or deflect to sign-in.',
  user: "What's the status of my booking BKG-1234?",
  expect: (out) => [
    noErrorsOrGuardrails(out),
    // Critical: no guessing 1234 as the id. Firing get_booking here would
    // either 404 or return an unrelated booking — either way, drift.
    toolNotCalled(out, 'get_booking'),
    // EITHER path is acceptable:
    //   (a) Ask for identifying info: "numeric id", "id number",
    //       "booking number", "which number", etc.
    //   (b) Deflect to sign-in: "sign in to access your bookings"
    //       (Phase 2's auth-gate on get_booking makes this a
    //       reasonable response too).
    finalMessageMatches(
      out,
      /\b(?:numeric|id|number)\b|\bsign\s*in\b|\bsigned?\s+in\b|\blog\s*in\b/i,
      'final message asks for the numeric id OR deflects to sign-in',
    ),
  ],
};
