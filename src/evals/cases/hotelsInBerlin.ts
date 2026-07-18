import type { Case } from '../types';
import {
  finalAgent,
  finalMessageMatches,
  noErrorsOrGuardrails,
  toolArgsMatch,
  toolCalled,
  toolNotCalled,
} from '../assertions';

// Hotel-only case — the flights/weather equivalent of `weatherInBerlin`.
// Explicit dates so no origin-ask happens (flights aren't in scope for this
// query at all). Verifies:
//   - triage routes to TravelAgent (hotels are travel domain, not weather)
//   - search_hotels was invoked with sensible args
//   - the summary actually surfaces hotel details (price + a "night"/"star"
//     hint), not just flight prose
export const hotelsInBerlin: Case = {
  name: 'hotels-in-berlin',
  description:
    'Hotel-only search — TravelAgent handoff, search_hotels called, hotel details in summary.',
  user: 'Find me a hotel in Berlin for next weekend, 2 guests.',
  expect: (out) => [
    noErrorsOrGuardrails(out),
    finalAgent(out, 'TravelAgent'),
    toolCalled(out, 'search_hotels'),
    toolArgsMatch(
      out,
      'search_hotels',
      (args) => /berlin/i.test(String((args as { city?: unknown })?.city ?? '')),
      'city=Berlin',
    ),
    toolNotCalled(out, 'search_flights'),
    finalMessageMatches(out, /€/, 'final message references at least one price (€)'),
    // Weak-but-useful structural check: some word from the hotel domain
    // must appear in the summary. If we only see flight vocabulary the
    // model probably answered the wrong question.
    finalMessageMatches(
      out,
      /night|star|hotel/i,
      'final message includes hotel context (night / star / hotel word)',
    ),
  ],
};
