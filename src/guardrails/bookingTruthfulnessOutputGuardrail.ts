import type { OutputGuardrail } from '@openai/agents';

// Output guardrail enforcing the "agent proposes, user confirms" split
// baked into the `propose_booking` tool spec:
//
//   "The booking is NOT paid or confirmed by this call — the user must
//    click Confirm in the chat UI to actually reserve inventory."
//
// The agent's instruction block already says the same thing ("do not say
// the booking is 'confirmed', 'successful', or 'reserved'"), but a prompt
// rule is a soft ask — this guardrail is the hard belt on the suspenders.
// If the agent ever asserts booking finality in its final message, this
// trips the tripwire and the SDK short-circuits the response.
//
// Scope note: this is a text-only heuristic. The Agents SDK's output
// guardrail context doesn't expose tool-call history, so we can't
// cross-reference a claimed booking reference against what
// `propose_booking` actually returned. That's a bigger design change
// (thread tool outputs through `RunContext`) deferred beyond Phase 3.
// The finality-claim check catches the specific Stage-9 drift we saw.
export const bookingTruthfulnessOutputGuardrail: OutputGuardrail = {
  name: 'booking_truthfulness_output',
  async execute({ agentOutput }) {
    // agentOutput is `ResolvedAgentOutput<TOutput>` — for our text agents,
    // that's the final string. Guard against non-string shapes just in
    // case an agent is ever configured with a structured output type.
    const text = typeof agentOutput === 'string' ? agentOutput : '';
    if (!text) return { tripwireTriggered: false, outputInfo: null };

    const hit = detectFinalityClaim(text);
    if (!hit) return { tripwireTriggered: false, outputInfo: null };

    return {
      tripwireTriggered: true,
      // `message` is what the user sees, via userFacingGuardrailErrorMessage.
      // Explain the actual constraint (Confirm is a UI action) so the user
      // knows what to do next, rather than getting a bare "blocked" error.
      outputInfo: {
        message:
          "I can't confirm bookings on your behalf — reserving inventory happens when you click the Confirm button in the booking card. Take another look at the proposal and confirm there if it looks right.",
        matchedPhrase: hit.matchedText,
        matchedPattern: hit.patternName,
      },
    };
  },
};

// Named finality-claim patterns — each intended to catch a specific
// phrasing family. New drift phrasings should get their own entry so
// failures name which pattern fired.
const FINALITY_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    // "your booking is confirmed", "the reservation has been processed",
    // "your trip is finalized" — subject + is/was/has-been + finality verb.
    name: 'subject-is-final',
    pattern:
      /\b(?:your|the|our)\s+(?:booking|reservation|trip|itinerary|flight|hotel|room)s?\s+(?:is|are|was|were|has\s+been|have\s+been)\s+(?:successfully\s+)?(?:confirmed|complete[d]?|processed|finalized|paid|charged|reserved|booked)\b/i,
  },
  {
    // "successfully booked", "successfully reserved" — adverbial success
    // claim without qualification. Catches confidence-projection drift.
    name: 'successfully-<verb>',
    pattern:
      /\bsuccessfully\s+(?:booked|reserved|confirmed|charged|paid|processed)\b/i,
  },
  {
    // "I've booked your trip", "I have reserved the flight" — first-person
    // action verbs. The agent MUST NOT claim to have performed a booking
    // action on the user's behalf.
    name: 'first-person-booked',
    pattern:
      /\bi(?:'ve|\s+have)\s+(?:booked|reserved|confirmed|charged|paid)\s+(?:you|your|the|a|an)\b/i,
  },
];

// Detects a finality-claim pattern in the given text, returning the first
// match found, or null if none. The returned object includes the pattern
// name and the matched text for reporting in the tripwire outputInfo.
function detectFinalityClaim(
  text: string,
): { patternName: string; matchedText: string } | null {
  for (const { name, pattern } of FINALITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { patternName: name, matchedText: match[0] };
  }
  return null;
}
