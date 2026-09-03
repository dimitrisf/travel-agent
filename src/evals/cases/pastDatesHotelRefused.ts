import type { Case } from '../types';
import {
  finalMessageDoesNotMatch,
  finalMessageMatches,
} from '../assertions';
import {
  PAST_DATE_REFUSAL_DESCRIPTION,
  PAST_DATE_REFUSAL_PATTERN,
} from './pastDatesShared';

// User explicitly asks for hotels on dates that are clearly in the past
// (2024 — well before any conceivable "today" the eval could run against).
//
// Two acceptable agent shapes:
//   1. Ideal — recognize the dates are past and refuse without any tool
//      call, asking for future dates.
//   2. Acceptable — call `search_hotels` once, receive the API's
//      `DATE_IN_PAST` error, and surface a graceful "those dates are in
//      the past" message rather than retrying blindly or fabricating a
//      result set.
//
// Both paths must end with:
//   - No framework errors, no guardrail trips.
//   - A final message that names the date issue (mentions "past" or
//     acknowledges the dates need to be in the future) — proves the agent
//     understood what went wrong rather than falling back to a generic
//     "no results found."
//   - No fabricated success: no € prices, no hotel-detail vocabulary.
//     If the agent invented a result set, this catches it.
//
// Deliberately not asserting `toolNotCalled('search_hotels')` — the
// ideal path skips the call, but the acceptable-recovery path invokes
// it once. Either passes.
export const pastDatesHotelRefused: Case = {
  name: 'past-dates-hotel-refused',
  description:
    'User asks for hotels on hard-past dates. Agent must refuse or recover from the DATE_IN_PAST error without fabricating results.',
  user: 'Find me a hotel in Berlin from 2024-06-15 to 2024-06-20, 2 guests.',
  expect: (out) => {
    // The standard `noErrorsOrGuardrails` helper folds the `{error, code}`
    // tool envelope into `out.errored` so cases don't pass vacuously when
    // a search silently returned an error. Here the tool error IS the
    // expected recovery path, so we hand-roll the check: accept `errored`
    // iff it names DATE_IN_PAST (and only that), still reject a real
    // runtime exception (network/MCP/model).
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
      // Hotel-detail vocabulary should not appear — if it does, the agent
      // likely invented results. Combined with the money-symbol check,
      // this catches both prose-only and numeric fabrications.
      finalMessageDoesNotMatch(
        out,
        /€|\$|\bUSD\b|\bEUR\b|per\s*night|\bstars?\b/i,
        'final message does not include invented hotel prices or star ratings',
      ),
    ];
  },
};
