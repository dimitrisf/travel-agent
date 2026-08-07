import type { Case } from '../types';
import {
  noErrorsOrGuardrails,
  toolArgsMatch,
  toolCalled,
} from '../assertions';

// Regression check for the options-count drift — during Stage 9 the agent
// sometimes returned more (or fewer) options than the user explicitly
// requested, ignoring the "show me N" constraint and just dumping whatever
// the tool returned. This case says "show me 3" and expects exactly 3
// numbered items in the summary. If the tool returned 5, the model must
// filter down; if 2, it should say so, but definitely not pad with
// hallucinated options — this asserts on the visible count.
//
// One-way is chosen to keep the number of tool calls small (single
// search_flights) and to double-check direction handling: the user said
// "one way", so no return_date should be passed either.
export const optionsCountMatchesRequest: Case = {
  name: 'options-count-matches-request',
  description:
    'User asks for exactly N options — summary must list exactly N numbered items, not more, not fewer.',
  user: 'Show me 3 flight options from Athens (ATH) to London (LHR) departing on July 17, 2026, one way.',
  expect: (out) => {
    const requestedCount = 3;
    const flightCalls = out.toolCalls.filter(
      (t) => t.name === 'search_flights',
    );

    // Count option enumerations at the start of a line. The model uses
    // three common shapes interchangeably:
    //   (a) Markdown numbered list: `1. **AirlineName**\n   - detail...`
    //   (b) "Option N" heading/label: `### Option 1`, `**Option 1**`,
    //       `Option 1:`.
    //   (c) Top-level bullet with the option name in bold (used mostly
    //       when there's only one option — Stage 19 addition): `- **Aegean
    //       Airlines Flight A3 600**` at column 0, with indented sub-items
    //       for the details underneath.
    // Any of the three communicates the same count to the user, so the
    // assertion accepts whichever the model picked.
    //
    // Bullet detection is anchored to column 0 (no leading whitespace) so
    // indented sub-items inside a bulleted option don't double-count.
    // Numbered- and bullet-shaped enumerations don't overlap textually,
    // so taking the max across the two counts is safe — a response uses
    // one style or the other, not both. If the model ever mixed them in
    // a real case (5 numbered + 1 bullet), the max would still return
    // the intended count within one styling family.
    const numberedItemPattern =
      /^\s*(?:#+\s+|[*_]+\s*)?(?:\d+\.\s|Option\s+\d+\b)/gim;
    const numberedCount = (out.finalText.match(numberedItemPattern) ?? [])
      .length;
    const topLevelBulletPattern = /^[-*+]\s+/gm;
    const bulletCount = (out.finalText.match(topLevelBulletPattern) ?? [])
      .length;
    const optionCount = Math.max(numberedCount, bulletCount);

    // Supply cap: the model can't show more flights than the tool actually
    // returned. If the seed only has 1 outbound flight for ATH→LHR on that
    // date, "show me 3" resolves to "show me the 1 you found" — that's not
    // a drift, so the assertion has to account for it. We take the max
    // outbound length across all search_flights calls as a conservative
    // pool size (a call that returned 5 established supply of 5).
    const availableOutbound = flightCalls.reduce((max, c) => {
      const parsed = c.parsedOutput as { outbound?: unknown[] } | undefined;
      const n = Array.isArray(parsed?.outbound) ? parsed.outbound.length : 0;
      return Math.max(max, n);
    }, 0);
    const expectedNumbered = Math.min(requestedCount, availableOutbound);

    return [
      noErrorsOrGuardrails(out),
      toolCalled(out, 'search_flights'),
      // If the model treated this as round-trip anyway, direction handling
      // is off — a related but distinct drift from the count check.
      toolArgsMatch(
        out,
        'search_flights',
        (args) => !(args as { return_date?: unknown })?.return_date,
        'no return_date (one-way per user request)',
      ),
      {
        description:
          'option count equals min(requested, available) — catches over- and under-listing',
        // The load-bearing check. `expectedNumbered` collapses to `requestedCount`
        // when supply is plentiful (the normal drift-detection case) and to
        // `availableOutbound` when the seed is thin (avoids false positives
        // from data limits).
        passed: optionCount === expectedNumbered,
        details: `option count: ${optionCount} (numbered=${numberedCount}, bullet=${bulletCount}), expected ${expectedNumbered} (requested ${requestedCount}, tool returned ${availableOutbound})`,
      },
    ];
  },
};
