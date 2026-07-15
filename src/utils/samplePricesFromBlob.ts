// Pull a handful of per-night price numbers out of a raw search_hotels
// tool-output blob for use in assertion failure details. Keeps eval
// error messages self-diagnostic without requiring a re-run — you see
// what the tool actually returned alongside what the model claimed.
//
// Currently scoped to `"price_per_night": N` matches; extend the regex
// (or add sibling helpers) if a caller needs other price fields.
export function samplePricesFromBlob(blob: string): string[] {
  return [...blob.matchAll(/"price_per_night"\s*:\s*(\d+(?:\.\d+)?)/g)]
    .map((m) => m[1])
    .slice(0, 8);
}
