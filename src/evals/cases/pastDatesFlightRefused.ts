import type { Case } from '../types';
import {
  finalMessageDoesNotMatch,
  finalMessageMatches,
} from '../assertions';
import {
  PAST_DATE_REFUSAL_DESCRIPTION,
  PAST_DATE_REFUSAL_PATTERN,
} from './pastDatesShared';

// Flights sibling of `past-dates-refused`. Same shape, different tool
// path — proves the DATE_IN_PAST guard on /api/flights actually flows
// through the agent's search_flights call and produces a coherent
// recovery message, independent of whatever the hotels path does.
//
// Origin + destination are given explicitly so the case doesn't trip
// the origin-ask behavior — the point here is date-validation, not
// discovery flow.
//
// Two acceptable agent shapes:
//   1. Ideal — recognize the date is past and refuse without any tool
//      call, asking for a future date.
//   2. Acceptable — call `search_flights` once, receive the API's
//      `DATE_IN_PAST` error, and surface a graceful "that date is in
//      the past" message rather than retrying or fabricating results.
export const pastDatesFlightRefused: Case = {
  name: 'past-dates-flight-refused',
  description:
    'User asks for a flight on a hard-past date. Agent must refuse or recover from the DATE_IN_PAST error without fabricating results.',
  user: 'Find me a flight from Athens to Berlin on 2024-06-15.',
  expect: (out) => {
    // See the hotels sibling for why we hand-roll the errored check
    // instead of using `noErrorsOrGuardrails`: the tool error IS the
    // expected recovery path here.
    const errored = out.errored ?? '';
    const isOnlyExpectedError =
      errored === '' || /^tool errors:.*DATE_IN_PAST/.test(errored);
    return [
      {
        description:
          'no unexpected errors (DATE_IN_PAST from the search tool is allowed and expected)',
        passed: isOnlyExpectedError && !out.guardrailTripped,
        details: errored || out.guardrailTripped || '',
      },
      finalMessageMatches(
        out,
        PAST_DATE_REFUSAL_PATTERN,
        PAST_DATE_REFUSAL_DESCRIPTION,
      ),
      // No prices, no currency mentions — catches invented result sets
      // by their most reliable tell.
      finalMessageDoesNotMatch(
        out,
        /€|\$|\bUSD\b|\bEUR\b/i,
        'final message does not include invented prices',
      ),
      // Flight-number pattern check kept case-sensitive so "on 2024" (2
      // lowercase letters + 4 digits) doesn't false-positive — real
      // flight numbers in the seeded data are always uppercase like
      // "LH 1753" / "A3 824".
      finalMessageDoesNotMatch(
        out,
        /\b[A-Z]{2,3}\s?\d{2,4}\b/,
        'final message does not include an invented flight number',
      ),
    ];
  },
};
