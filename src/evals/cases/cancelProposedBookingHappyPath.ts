import type { Case } from '../types';
import {
  finalMessageMatches,
  noErrorsOrGuardrails,
  toolCalled,
} from '../assertions';

// Cancellation happy path — end-to-end round trip through the booking arc
// (search → propose → cancel). Verifies:
//   - propose_booking runs on turn 2 (the setup)
//   - cancel_booking runs on turn 3 or 4 (the actual test)
//   - the final message truthfully acknowledges the cancellation
//
// Uses 4 turns because the agent's prompt says "confirm the user's intent
// in prose first, then call cancel_booking" — so we plan for a
// confirmation question in turn 3 and a user confirmation in turn 4. If
// the model reads turn 3's intent as clear enough and calls the tool
// immediately, that's also fine — the assertion is aggregated across
// all turns, so cancel_booking landing in either turn 3 OR turn 4 passes.
//
// The final-message check is a light truthfulness signal: the reply
// should mention "cancel" (past-tense, "cancelled", "canceled") to
// indicate the action happened. Doesn't guarantee correctness — that's
// what the Stage 11/13 guardrails do at runtime — but flags dodges
// where the agent claims to cancel without following through.
export const cancelProposedBookingHappyPath: Case = {
  name: 'cancel-proposed-booking-happy-path',
  description:
    'Multi-turn: search hotel → propose booking → cancel → confirm cancel. cancel_booking must be called and the final message must acknowledge the cancellation.',
  turns: [
    'Find me hotels in Berlin for next weekend, 2 guests.',
    'Book the first one for John Doe, john@example.com.',
    "I've changed my mind. Please cancel that booking.",
    'Yes, I confirm — please cancel it.',
  ],
  expect: (out) => [
    noErrorsOrGuardrails(out),
    // Setup step: propose_booking must have fired on turn 2 so there's
    // actually a booking to cancel. Without this the case is testing
    // something else (an agent that dodged the booking flow entirely).
    toolCalled(out, 'propose_booking'),
    // The actual test: cancel_booking must fire somewhere in turns 3-4.
    toolCalled(out, 'cancel_booking'),
    // Final-turn text must acknowledge the cancellation happened — no
    // dodges, no "would you like me to cancel?" (the tool already ran).
    finalMessageMatches(
      out,
      /\bcancel(?:led|ed|lation)\b/i,
      'final message mentions the cancellation',
    ),
  ],
};
