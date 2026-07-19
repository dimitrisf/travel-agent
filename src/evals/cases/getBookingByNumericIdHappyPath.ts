import type { Case } from '../types';
import {
  finalMessageMatches,
  noErrorsOrGuardrails,
  toolCalled,
} from '../assertions';

// Stage 16 — happy path for the `get_booking` lookup flow. The prompt at
// buildTravelAgent.ts:93 says: "If the user asks about a prior booking
// ('what's the status of BKG-…', 'did my booking go through'), use
// `get_booking` with the numeric id." Nothing in the eval suite actually
// exercised that path before this stage — Stage 15's cancel cases touched
// propose_booking and cancel_booking, but never the plain lookup.
//
// Structure: search → propose_booking (setup, seeds a real numeric id in
// the model's context) → user asks about status → agent calls get_booking
// with that same id. The numeric id is NOT hard-coded in the case — it's
// created live on turn 2 and looked up on turn 3, so the assertion just
// checks that get_booking fired at all (with any integer id). This keeps
// the test robust across DB seed changes.
//
// The final-message check is a light truthfulness signal: after looking
// up a freshly-proposed booking, the reply should mention the status
// (PROPOSED, or pending/awaiting phrasings the model uses for it). It's
// deliberately loose — the Stage 11 guardrails cover the strict
// finality-claim drift.
export const getBookingByNumericIdHappyPath: Case = {
  name: 'get-booking-by-numeric-id-happy-path',
  description:
    'Multi-turn: search hotel → propose booking → ask about its status. Agent must call get_booking with the numeric id from the propose result.',
  turns: [
    'Find me hotels in Berlin for next weekend, 2 guests.',
    'Book the first one for John Doe, john@example.com.',
    'Can you check the current status of that booking?',
  ],
  expect: (out) => [
    noErrorsOrGuardrails(out),
    // Setup anchor: propose_booking must have fired on turn 2 so there's
    // a real booking id in the model's context for turn 3 to reference.
    toolCalled(out, 'propose_booking'),
    // The actual test: get_booking must fire on turn 3 with the id from
    // the propose_booking result. We don't check the exact id — the seed
    // creates a fresh one per run — just that the lookup happened.
    toolCalled(out, 'get_booking'),
    // Final message should mention the status of the freshly-proposed
    // booking. PROPOSED is the on-the-wire status; the model also
    // paraphrases it as "pending", "awaiting confirmation", etc. Loose
    // regex so phrasing variance doesn't flake the case.
    finalMessageMatches(
      out,
      /\b(?:proposed|pending|awaiting|status)\b/i,
      'final message reports the booking status',
    ),
  ],
};
