import type { Case } from '../types';
import { noErrorsOrGuardrails, toolCalled } from '../assertions';
import { priceAppearsInBlob } from '@/utils/priceAppearsInBlob';
import { samplePricesFromBlob } from '@/utils/samplePricesFromBlob';

// Regression check for hotel-price hallucination — during Stage 9 the agent
// once quoted "€452.2/night" for a hotel that had no such price in the tool
// output. This case verifies that every per-night price the agent quotes in
// its summary can be traced back to a raw number in some search_hotels
// tool output. Totals (e.g. "€480 for 2 nights") are computed by the agent
// from per-night × nights, so we deliberately don't check those — only the
// per-night prices, which should come verbatim from the tool.
export const verbatimHotelPrices: Case = {
  name: 'verbatim-hotel-prices',
  description:
    'Hotel per-night prices in the summary must appear in search_hotels output — no hallucinated prices.',
  user: 'Find me hotels in Berlin for next weekend, 2 guests.',
  expect: (out) => {
    // Comments on the shared verifier live in @/utils/priceAppearsInBlob.

    // E.g., hotelCalls = [ { name: 'search_hotels', output: '{"price_per_night":120.5}' }, ... ]
    const hotelCalls = out.toolCalls.filter((t) => t.name === 'search_hotels');

    // Concatenate all raw tool outputs into one blob. `output` is the raw
    // string returned by the tool (JSON with price_per_night as a number
    // literal), so substring matching against normalized number forms is
    // enough to check "does this number appear".
    //
    // E.g., if hotelCalls = [ { name: 'search_hotels', output: '{"price_per_night":120.5}' }, { name: 'search_hotels', output: '{"price_per_night":150}' } ]
    // then toolBlob = '{"price_per_night":120.5}\n{"price_per_night":150}'
    const toolBlob = hotelCalls.map((t) => t.output ?? '').join('\n');

    // Strip markdown emphasis markers so "**€120.50**/night" reads as
    // "€120.50/night" for the regex.
    const stripped = out.finalText.replace(/[*_`]/g, '');

    // Match per-night prices only. Total-style phrases ("€282 for 2 nights",
    // "Total: €282") are agent arithmetic and out of scope for this check.
    // The model uses two shapes for per-night prices:
    //   inline:   "€120/night", "€120 per night"
    //   labelled: "Price per Night: €120", "nightly rate: €120",
    //             "Price/Night: €120" (slash form — no "per"),
    //             "per night for the Standard Room at City Budget Inn is €94.30"
    // Bulleted markdown summaries lean heavily on the labelled shape — the
    // inline-only pattern missed them and produced a vacuous pass. The
    // labelled pattern allows up to 60 non-€ chars between "per night" and
    // the price, so prose-interlaced phrasings ("... is €X", "... at €X",
    // "... amounts to €X") are picked up too.
    // The pattern was designed for tight labelled phrasings — "Price per Night: €120", "nightly rate: €120". But the model sometimes writes prose in between the label and the price — "per night for the Standard Room at City Budget Inn is €94.30" — and the pattern silently missed it. Result: the extractor counted 0 prices in a reply that clearly quoted one, and the "at least one per-night price quoted" assertion failed vacuously. Not an agent bug, an eval-harness fragility.
    const perNightPatterns = [
      /€\s*(\d+(?:[.,]\d+)?)\s*(?:\/|per\s+)nights?\b/gi,
      /(?:price\s+per\s+night|per\s+night|nightly(?:\s+rate)?|price\s*\/\s*night)[^€\n]{0,60}?€\s*(\d+(?:[.,]\d+)?)/gi,
    ];

    // E.g, if stripped = "Price per Night: €120.50 and €150.00 per night",
    // then claimed = ["150.00", "120.50"]. Duplicates across the two patterns
    // are harmless — each entry gets verified independently.
    const claimed = perNightPatterns.flatMap((p) =>
      [...stripped.matchAll(p)].map((m) => m[1].replace(',', '.')),
    );

    // E.g, if claimed = ["120.50", "150.00"] and toolBlob = '{"price_per_night":120.5}\n{"price_per_night":150}', then unverified = []
    const unverified = claimed.filter(
      (priceStr) => !priceAppearsInBlob(priceStr, toolBlob),
    );

    return [
      noErrorsOrGuardrails(out),
      toolCalled(out, 'search_hotels'),
      {
        description: 'summary quotes at least one per-night price',
        // If the model didn't quote any per-night price, the verbatim check
        // above is vacuously true. Guard against that by requiring at least
        // one price to be quoted — otherwise the case isn't testing anything.
        passed: claimed.length > 0,
        details: `per-night prices found in summary: ${claimed.length} (${claimed.join(', ') || 'none'})`,
      },
      {
        description:
          'every per-night price in summary appears in a search_hotels output (no hallucination)',
        passed: unverified.length === 0,
        details:
          unverified.length === 0
            ? `all ${claimed.length} per-night prices verified against tool output`
            : `unverified prices: ${unverified.map((p) => `€${p}`).join(', ')}. Tool output prices sample: ${samplePricesFromBlob(toolBlob).join(', ') || '(none)'}`,
      },
    ];
  },
};
