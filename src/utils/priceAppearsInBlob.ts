// Check whether a price appears in a raw JSON tool-output blob under any
// common numeric formatting. Tool outputs serialize prices as raw JSON
// number literals (`120.5`, not `"120.50"`), but the model may render
// them as `€120.50`, `€120.5`, or `€120`. Compare across trimmed/padded
// decimal forms so cosmetic reformatting doesn't count as hallucination.
//
// E.g., if the agent quoted "€120.50/night" in its summary, there must be
// a raw number 120.5 somewhere in the search_hotels output. The agent may
// quote prices with markdown emphasis, but the tool outputs raw JSON
// numbers, so we normalize both to a canonical form for comparison.
//
// Word-boundary anchoring `(?<!\d)…(?!\d)` avoids matching `120.5` as a
// substring of `1120.5` — critical because random hotel/flight IDs could
// otherwise coincidentally collide with a claimed price.
export function priceAppearsInBlob(priceStr: string, blob: string): boolean {
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
}
