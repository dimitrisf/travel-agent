import type { Case } from '../types';

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
  user: 'Find me a hotel in Berlin for July 17 to July 19, 2026, 2 guests.',
  expect: (out) => [
    {
      description: 'no unexpected errors or guardrail trips',
      passed: !out.errored && !out.guardrailTripped,
      details: out.errored ?? out.guardrailTripped,
    },
    {
      description: 'final agent was TravelAgent',
      passed: out.lastAgent === 'TravelAgent',
      details: `last agent: ${out.lastAgent}`,
    },
    {
      description: 'called search_hotels',
      passed: out.toolCalls.some((t) => t.name === 'search_hotels'),
      details: `tools called: ${
        out.toolCalls.map((t) => t.name).join(', ') || '(none)'
      }`,
    },
    {
      description: 'search_hotels args include the requested city',
      passed: out.toolCalls.some(
        (t) =>
          t.name === 'search_hotels' &&
          /berlin/i.test(String((t.args as { city?: unknown })?.city ?? '')),
      ),
      details: describeSearchHotelsArgs(out),
    },
    {
      description: 'did NOT call search_flights (flights not requested)',
      passed: !out.toolCalls.some((t) => t.name === 'search_flights'),
      details: `flight tool calls: ${
        out.toolCalls.filter((t) => t.name === 'search_flights').length
      }`,
    },
    {
      description: 'final message references at least one price (€)',
      passed: /€/.test(out.finalText),
      details: `€ count: ${(out.finalText.match(/€/g) ?? []).length}`,
    },
    {
      description: 'final message includes hotel context (night / star / hotel word)',
      // Weak-but-useful structural check: some word from the hotel domain
      // must appear in the summary. If we only see a flight vocabulary the
      // model probably answered the wrong question.
      passed: /night|star|hotel/i.test(out.finalText),
      details: out.finalText.slice(0, 160),
    },
  ],
};

function describeSearchHotelsArgs(out: {
  toolCalls: Array<{ name: string; args: unknown }>;
}): string {
  const call = out.toolCalls.find((t) => t.name === 'search_hotels');
  if (!call) return '(not called)';
  const args = call.args as Record<string, unknown>;
  return `city=${args.city}, checkin=${args.checkin}, checkout=${args.checkout}`;
}
