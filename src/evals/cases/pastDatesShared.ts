// Shared between the hotel and flight past-date cases. Matches any
// coherent refusal by the agent when the user asks for a search on a
// past date — either the direct "past/future" reason, or a valid
// "can't do that" phrasing (the agent sometimes cites the search
// window rather than the past date; both are honest refusals).
export const PAST_DATE_REFUSAL_PATTERN =
  /\b(past|future|earlier|already passed|no longer|different\s+date|another\s+date|unable|cannot|can'?t|not\s+(?:able|available|possible|within)|outside|beyond|search\s+(?:range|window))\b/i;

// Assertion label used with PAST_DATE_REFUSAL_PATTERN so the failure
// line reads the same in either case's output.
export const PAST_DATE_REFUSAL_DESCRIPTION =
  'final message coherently refuses (names the date issue OR the search window)';
