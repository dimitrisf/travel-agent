import type { Case } from '../types';
import { noErrorsOrGuardrails, toolCalled } from '../assertions';

// Regression check for the off-topic guardrail over-triggering on short
// follow-up turns. During Stage 9 we saw the classifier flag inputs like
// "book it" or "yes" as off-topic when read in isolation — even though
// the surrounding conversation was clearly about travel. This case
// establishes a hotel-search context in turn 1, then sends a two-word
// follow-up in turn 2 and asserts the guardrail lets it through.
//
// If this case starts failing with `noErrorsOrGuardrails` reporting a
// guardrail trip, the classifier is being asked to judge the current
// input in isolation instead of with context (or the prompt has drifted
// to reject short inputs by default).
export const onTopicFollowUpAllowed: Case = {
  name: 'on-topic-follow-up-allowed',
  description:
    'Multi-turn: establish a travel context, then send a short follow-up — guardrail must let it through.',
  turns: [
    'Find me hotels in Berlin for July 17 to July 19, 2026, 2 guests.',
    'Book the first one.',
  ],
  expect: (out) => [
    // Load-bearing: this fires with a guardrail trip if the off-topic
    // classifier misjudged the follow-up. The description makes it clear
    // in the log which failure mode this case is guarding against.
    noErrorsOrGuardrails(out),
    // Turn 1 should still have exercised the hotel search normally — if
    // this fails, the case setup broke, not the follow-up behaviour.
    toolCalled(out, 'search_hotels'),
  ],
};
