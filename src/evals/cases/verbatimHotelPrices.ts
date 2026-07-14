import type { Case } from '../types';

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
  user: 'Find me hotels in Berlin for July 17 to July 19, 2026, 2 guests.',
  expect: (out) => {
    // E.g., if the agent quoted "€120.50/night" in its summary, there must be
    // a raw number 120.5 somewhere in the search_hotels output. The agent may
    // quote prices with markdown emphasis, but the tool outputs raw JSON
    // numbers, so we normalize both to a canonical form for comparison.
    const priceAppearsInBlob = (priceStr: string, blob: string): boolean => {
      const n = Number(priceStr);

      if (!Number.isFinite(n)) return false;

      // Candidate string forms of the same number, so `120.50` matches `120.5`
      // and vice versa. Word-boundary anchoring avoids matching `120.5` inside
      // `1120.5` — critical because random hotel IDs could otherwise collide.
      const candidates = new Set<string>([
        priceStr,
        String(n),
        n.toFixed(0),
        n.toFixed(1),
        n.toFixed(2),
      ]);

      for (const c of candidates) {
        // Escape decimal points for regex, then check word-boundary containment.
        const escaped = c.replace(/\./g, '\\.');
        if (new RegExp(`(?<!\\d)${escaped}(?!\\d)`).test(blob)) return true;
      }
      return false;
    };

    // E.g., hotelCalls = [ { name: 'search_hotels', output: '{"price_per_night":120.5}' }, ... ]
    const hotelCalls = out.toolCalls.filter((t) => t.name === 'search_hotels');

    // Concatenate all raw tool outputs into one blob. `output` is the raw
    // string returned by the tool (JSON with price_per_night as a number
    // literal), so substring matching against normalized number forms is
    // enough to check "does this number appear".

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
    //   labelled: "Price per Night: €120", "nightly rate: €120"
    // Bulleted markdown summaries lean heavily on the labelled shape — the
    // inline-only pattern missed them and produced a vacuous pass.
    const perNightPatterns = [
      /€\s*(\d+(?:[.,]\d+)?)\s*(?:\/|per\s+)nights?\b/gi,
      /(?:price\s+per\s+night|per\s+night|nightly(?:\s+rate)?)\s*[:\-–]?\s*€\s*(\d+(?:[.,]\d+)?)/gi,
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
      {
        description: 'no unexpected errors or guardrail trips',
        passed: !out.errored && !out.guardrailTripped,
        details: out.errored ?? out.guardrailTripped,
      },
      {
        description: 'called search_hotels at least once',
        passed: hotelCalls.length > 0,
        details: `search_hotels calls: ${hotelCalls.length}`,
      },
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

// Pull a handful of price-like numbers out of the tool blob for the
// failure details, so debugging doesn't require re-running the case.
// E.g., if blob = '{"price_per_night":120.5}\n{"price_per_night":150}', then returns ["120.5", "150"]
function samplePricesFromBlob(blob: string): string[] {
  const matches = [...blob.matchAll(/"price_per_night"\s*:\s*(\d+(?:\.\d+)?)/g)]
    .map((m) => m[1])
    .slice(0, 8);
  return matches;
}
