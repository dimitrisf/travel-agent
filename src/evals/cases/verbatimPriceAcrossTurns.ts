import type { Case } from '../types';
import { noErrorsOrGuardrails, toolCalled } from '../assertions';
import { priceAppearsInBlob } from '@/utils/priceAppearsInBlob';
import { samplePricesFromBlob } from '@/utils/samplePricesFromBlob';

// Regression check for the price-hallucination drift, extended across a
// multi-turn conversation. `verbatimHotelPrices` catches the single-turn
// version (search + summary in one shot). This case catches the follow-up
// version: the model searched in turn 1, then had to quote prices AGAIN
// in turn 2 (a confirmation, booking prompt, or clarification). Drift
// happens when the model paraphrases from its own turn-1 memory instead
// of from the still-in-context tool output — and gets numbers wrong.
//
// Because runCase aggregates tool calls across turns and uses the LAST
// turn's finalText, the check is identical in shape to the single-turn
// version: for every "€NNN per night" in the final message, verify it
// appears literally in one of the search_hotels tool outputs.
export const verbatimPriceAcrossTurns: Case = {
  name: 'verbatim-price-across-turns',
  description:
    'Multi-turn: hotel search then follow-up confirmation — per-night prices in the follow-up must match tool output.',
  turns: [
    'Find me hotels in Berlin for next weekend, 2 guests.',
    'Great, let me book the first one — how much per night was it?',
  ],
  expect: (out) => {
    // Aggregated tool calls across all turns — includes turn 1's search.
    const hotelCalls = out.toolCalls.filter((t) => t.name === 'search_hotels');
    const toolBlob = hotelCalls.map((t) => t.output ?? '').join('\n');

    // Same two-shape matching as verbatimHotelPrices — inline
    // ("€120/night") and labelled ("Price per Night: €120", "Price/Night:
    // €120" slash form, plus prose-interlaced "per night for the Standard
    // Room at City Budget Inn is €94.30"). The labelled pattern allows up
    // to 60 non-€ chars between "per night" and the price to pick up
    // follow-up phrasings.
    const stripped = out.finalText.replace(/[*_`]/g, '');
    const perNightPatterns = [
      /€\s*(\d+(?:[.,]\d+)?)\s*(?:\/|per\s+)nights?\b/gi,
      /(?:price\s+per\s+night|per\s+night|nightly(?:\s+rate)?|price\s*\/\s*night)[^€\n]{0,60}?€\s*(\d+(?:[.,]\d+)?)/gi,
    ];

    const claimed = perNightPatterns.flatMap((p) =>
      [...stripped.matchAll(p)].map((m) => m[1].replace(',', '.')),
    );

    const unverified = claimed.filter(
      (priceStr) => !priceAppearsInBlob(priceStr, toolBlob),
    );

    return [
      noErrorsOrGuardrails(out),
      toolCalled(out, 'search_hotels'),
      {
        description:
          'follow-up turn quotes at least one per-night price (otherwise the check is vacuous)',
        // Turn 2's prompt specifically asks about price, so the model
        // should quote at least one. If it dodges, the verbatim check
        // below passes trivially — this assertion catches that dodge.
        passed: claimed.length > 0,
        details: `per-night prices in final message: ${claimed.length} (${claimed.join(', ') || 'none'})`,
      },
      {
        description:
          'every per-night price in the follow-up traces to a search_hotels output (no cross-turn hallucination)',
        passed: unverified.length === 0,
        details:
          unverified.length === 0
            ? `all ${claimed.length} per-night prices verified against turn-1 tool output`
            : `unverified prices: ${unverified.map((p) => `€${p}`).join(', ')}. Tool output prices sample: ${samplePricesFromBlob(toolBlob).join(', ') || '(none)'}`,
      },
    ];
  },
};

