import type { Case } from '../types';
import {
  finalMessageMatches,
  noErrorsOrGuardrails,
  toolNotCalled,
} from '../assertions';

// Regression check for the too-eager booking flow drift — during Stage 9
// the agent sometimes invoked propose_booking (or started collecting
// booking prerequisites like passport info) in response to an ambiguous
// "yes" from the user, before any concrete options had been shown.
// propose_booking requires a specific flight_instance_id or room_type_id;
// asking for those before there's anything to select from is drift.
//
// Turn 1 is deliberately underspecified — no destination, no dates,
// no origin, nothing that could produce concrete options. Turn 2 says
// "yes, book it" (unambiguously affirmative but content-free). The
// correct behaviour is to ask for clarification, not to call
// propose_booking or start gathering prereqs.
export const noBookingPrereqsBeforeOptions: Case = {
  name: 'no-booking-prereqs-before-options',
  description:
    'Multi-turn: vague turn 1 + affirmative-but-empty turn 2 — agent must ask for details, not attempt to book.',
  turns: [
    "I'm thinking about a weekend trip.",
    'Yes, book it.',
  ],
  expect: (out) => [
    noErrorsOrGuardrails(out),
    // Load-bearing: no specific option was ever surfaced, so calling
    // propose_booking would necessarily involve either invented IDs or
    // premature prereq-gathering. Either way, drift.
    toolNotCalled(out, 'propose_booking'),
    // Final message should ask for the missing pieces (destination,
    // dates, origin, passenger count). Regex covers the common phrasings
    // — if the agent takes yet a different route ("Sure, booking your
    // trip now"), it likely fails here too, which is the correct signal.
    finalMessageMatches(
      out,
      /\bwhere\b|\bwhich\b|\bdestination\b|\borigin\b|\bdepart(?:ing|ure)?\b|\bfrom\b|\bwhen\b|\bdate\b|\bhow many\b|\?/i,
      'final message asks for missing trip details (destination / dates / origin / passengers)',
    ),
  ],
};
