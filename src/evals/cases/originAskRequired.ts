import type { Case } from '../types';

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
    {
      description: 'no unexpected errors or guardrail trips',
      passed: !out.errored && !out.guardrailTripped,
      details: out.errored ?? out.guardrailTripped,
    },
    {
      description:
        'did NOT call search_flights (should have asked, not searched)',
      // The load-bearing assertion: any search_flights call here means the
      // model invented an origin instead of asking the user.
      passed: !out.toolCalls.some((t) => t.name === 'search_flights'),
      details: describeFlightCalls(out),
    },
    {
      description:
        'final message ends with a question (asking for missing info)',
      // Trailing question mark is a decent proxy for "the agent is asking".
      // Trim trailing whitespace so markdown/newlines don't fool the check.
      passed: /\?\s*$/.test(out.finalText.trim()),
      // We include a snippet of the final message in the details so we can
      // see what the agent actually said. If it didn't end with a question,
      // we want to see what it did say so we can debug why it didn't ask.
      // -160 means we get the last 160 chars of the final message, which is enough to
      // see the question if it exists, and if not, we get a snippet of the
      // last part of the message for debugging.
      details: out.finalText.slice(-160),
    },
    {
      description: 'final message mentions origin / departure / from-where',
      // Signals that the specific missing piece being asked about is origin.
      // If the agent asks about something else (dates, passengers, cabin)
      // instead of noticing the missing origin, that's still a bug.
      // E.g., when the user omits an origin, the agent should ask for it — which means its reply will contain something like:
      // "Where will you be flying from?"
      // "What's your origin airport?"
      // "Which city are you departing from?"
      // "From where would you like to fly?"
      passed:
        /\borigin\b|\bdepart(?:ing|ure)?\b|\bleaving\b|\bfrom (?:where|which|what)\b|\bwhere.*from\b/i.test(
          out.finalText,
        ),
      details: out.finalText.slice(0, 240),
    },
  ],
};

// Helper to summarize any search_flights calls in the output for assertion
// details. If the agent called search_flights, we want to see what it
// passed for origin/destination/dates so we can debug why it didn't ask.
// If no search_flights calls, we return a short "none" message.
function describeFlightCalls(out: {
  toolCalls: Array<{ name: string; args: unknown }>;
}): string {
  const calls = out.toolCalls.filter((t) => t.name === 'search_flights');

  if (calls.length === 0) return 'no search_flights calls (correct)';

  // Summarize each call with its args, truncating long args for readability.
  return calls
    .map((c) => `search_flights(${JSON.stringify(c.args).slice(0, 160)})`)
    .join('; ');
}
