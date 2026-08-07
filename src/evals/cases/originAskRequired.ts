import type { Case } from '../types';
import {
  finalMessageMatches,
  noErrorsOrGuardrails,
  toolNotCalled,
} from '../assertions';

// Regression check for the origin-guessing drift we hit repeatedly during
// Stage 9. When the user names a destination + dates but omits an origin,
// the agent must ASK for it — not silently pick an origin from context
// (e.g. an earlier turn, a default airport, or the destination's obvious
// counterpart). Prompt is intentionally destination + dates only, no
// traveller history and no origin hints. If a flight search fires anyway,
// the model invented an origin — that's the specific failure we're guarding.
export const originAskRequired: Case = {
  name: 'origin-ask-required',
  description:
    'No origin given — agent must ask for it instead of guessing and searching.',
  user: 'Find me flights to Barcelona for the weekend of July 18-19, 2026.',
  expect: (out) => [
    noErrorsOrGuardrails(out),
    // Load-bearing: any search_flights call here means the model invented
    // an origin instead of asking the user. The tool-call block at the
    // end of the eval output shows the args if this fires — no need for
    // custom detail formatting here.
    toolNotCalled(out, 'search_flights'),
    // Any question mark in the message is a decent proxy for "the agent
    // is asking". Loosened Stage 19 from strict end-of-message `\?\s*$`
    // to bare `\?` — the model often asks the question and then adds a
    // helpful follow-up ("Where are you flying from? I can help you
    // find flights if you provide your departure city."), which is
    // still asking, just not on the terminal token. The paired
    // "mentions origin" assertion below keeps the check specific enough.
    finalMessageMatches(
      out,
      /\?/,
      'final message contains a question (asking for missing info)',
    ),
    // Signals that the specific missing piece being asked about is origin.
    // If the agent asks about something else (dates, passengers, cabin)
    // instead of noticing the missing origin, that's still a bug.
    // E.g., when the user omits an origin, the agent should ask for it —
    // which means its reply will contain something like:
    //   "Where will you be flying from?"
    //   "What's your origin airport?"
    //   "Which city are you departing from?"
    //   "From where would you like to fly?"
    finalMessageMatches(
      out,
      /\borigin\b|\bdepart(?:ing|ure)?\b|\bleaving\b|\bfrom (?:where|which|what)\b|\bwhere.*from\b/i,
      'final message mentions origin / departure / from-where',
    ),
  ],
};
