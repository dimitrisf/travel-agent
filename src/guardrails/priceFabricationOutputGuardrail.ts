import type { OutputGuardrail } from '@openai/agents';
import type { AgentRunContext, ToolCallRecord } from '@/agents/agentRunContext';
import { priceAppearsInBlob } from '@/utils/priceAppearsInBlob';

// Stage 14 — deterministic guardrail against fabricated prices.
// Sixth output-side check on `TravelAgent`. Catches drift where the
// agent quotes a per-night hotel price or a flight per-leg price that
// no `search_hotels` / `search_flights` result actually returned.
//
// Structurally identical to Stage 13's search-result-fabrication guardrail
// — extract candidate tokens with context-aware patterns, verify each
// against the collector's tool blob, trip on the first miss. Uses the
// existing `priceAppearsInBlob` util (already proven at eval time in
// `verbatimHotelPrices.ts` and `verbatimPriceAcrossTurns.ts`) so
// cent-rounding differences ("€120" vs "€120.00" vs `120.5`) don't cause
// spurious trips.
//
// Deliberately narrow: extracts prices ONLY when they appear in per-night
// or per-leg CONTEXT. Standalone `€NNN` figures (trip totals from agent
// arithmetic, user budget echoes, transient "€600 budget" references)
// are not touched. Same reason: totals are agent-computed sums, not
// tool-sourced — checking them here would false-positive on legitimate
// arithmetic. Stage 11 Phase 3 check (b) covers booking totals separately.
//
// Fails OPEN if the collector isn't threaded through (same policy as
// the other collector-reading guardrails). No LLM to fail.
export const priceFabricationOutputGuardrail: OutputGuardrail = {
  name: 'price_fabrication_output',
  async execute({ agentOutput, context }) {
    const text = typeof agentOutput === 'string' ? agentOutput : '';
    if (!text) return { tripwireTriggered: false, outputInfo: null };

    const ctx = context.context as AgentRunContext | undefined;
    if (!ctx?.toolCallCollector) {
      console.warn(
        '[guardrail:price_fabrication] no tool-call collector in context; skipping',
      );
      return { tripwireTriggered: false, outputInfo: { skipped: true } };
    }

    // Strip markdown emphasis so "**€120.50**/night" reads as "€120.50/night"
    // for the pattern matches. Same normalization the eval-time verbatim
    // extractors use.
    const stripped = text.replace(/[*_`]/g, '');

    // E.g., if ctx.toolCallCollector = [
    //   { name: 'search_flights', result: 'A3 824 for €138\nA3 825 for €145' },
    //   { name: 'search_hotels', result: 'Price per Night: €120\nPrice per Night: €150' },
    // ]
    // then flightBlob = "A3 824 for €138\nA3 825 for €145"
    // and hotelBlob = "Price per Night: €120\nPrice per Night: €150"
    const flightBlob = collectBlob(ctx.toolCallCollector, 'search_flights');
    const hotelBlob = collectBlob(ctx.toolCallCollector, 'search_hotels');

    // Check (a) — fabricated per-night hotel price. First match trips.
    const fabricatedHotelPrice = findFabricatedPerNightPrice(
      stripped,
      hotelBlob,
    );
    if (fabricatedHotelPrice) {
      return trip(
        'fabricated-per-night-price',
        `€${fabricatedHotelPrice}`,
        `A per-night hotel price I quoted (€${fabricatedHotelPrice}) doesn't match any real price from search_hotels. Please refer to the actual search results.`,
      );
    }

    // Check (b) — fabricated flight per-leg price. First match trips.
    const fabricatedFlightPrice = findFabricatedFlightPrice(
      stripped,
      flightBlob,
    );
    if (fabricatedFlightPrice) {
      return trip(
        'fabricated-flight-price',
        `€${fabricatedFlightPrice}`,
        `A flight price I quoted (€${fabricatedFlightPrice}) doesn't match any real price from search_flights. Please refer to the actual search results.`,
      );
    }

    return { tripwireTriggered: false, outputInfo: null };
  },
};

// Per-night hotel price extraction. Two shapes covered:
//   inline:   "€120/night", "€120 per night"
//   labelled: "Price per Night: €120", "nightly rate: €120",
//             "per night for the Standard Room is €120"
// Identical patterns to the ones in `verbatimHotelPrices.ts` — reusing
// them keeps the runtime guardrail and the eval-time assertion aligned.
// Totals like "€282 for 2 nights" or "€282 total" don't match because
// they lack the "per night" / "nightly" trigger phrase.
const PER_NIGHT_HOTEL_PATTERNS = [
  /€\s*(\d+(?:[.,]\d+)?)\s*(?:\/|per\s+)nights?\b/gi,
  /(?:price\s+per\s+night|per\s+night|nightly(?:\s+rate)?)[^€\n]{0,60}?€\s*(\d+(?:[.,]\d+)?)/gi,
];

// Flight per-leg price extraction. Three shapes covered:
//   flight-number-anchored, forward:  "A3 824 for €138", "A3 824 (€138)"
//   flight-number-anchored, reverse:  "€138 for A3 824", "€138 (A3 824)"
//   leg-label anchored:               "Outbound: €138", "Return €145",
//                                      "Inbound leg: €145"
//
// All three include a NEGATIVE LOOKAHEAD for "total" between the anchor
// and the €, so trip-total phrasings like "Flight A3 824 total: €283"
// or "Outbound total: €283" don't extract the computed sum. Totals are
// agent arithmetic and out of scope for this guardrail.
const FLIGHT_PRICE_PATTERNS = [
  /\b[A-Z][A-Z0-9]\s?\d{3,4}\b(?![^€\n]{0,80}\btotal\b)[^€\n]{0,80}?€\s*(\d+(?:[.,]\d+)?)/g,
  /€\s*(\d+(?:[.,]\d+)?)[^€\n]{0,30}\b[A-Z][A-Z0-9]\s?\d{3,4}\b/g,
  /\b(?:outbound|return|inbound|one-way)\b(?![^\n]{0,20}\btotal\b)[^€\n]{0,40}?€\s*(\d+(?:[.,]\d+)?)/gi,
];

// Concatenate all `result` strings from records matching the given tool
// name. Empty string if the tool was never called — callers treat that
// as "every claimed price is fabricated".
function collectBlob(collector: ToolCallRecord[], toolName: string): string {
  return collector
    .filter((r) => r.name === toolName)
    .map((r) => r.result ?? '')
    .join('\n');
}

// Returns the first per-night hotel price mentioned in `text` that
// doesn't appear in `blob`. Returns null if all mentioned per-night
// prices appear, or if no per-night prices were mentioned. Uses the
// shared `priceAppearsInBlob` util for the comparison — handles
// integer/decimal formatting variance.
// E.g., if text = "The hotel is €120/night" and blob = "Price per Night: €120\nPrice per Night: €150"
// then findFabricatedPerNightPrice(text, blob) returns null (all-clear).
// If text = "The hotel is €120/night" and blob = "Price per Night: €150"
// then findFabricatedPerNightPrice(text, blob) returns "120" (fabricated).
function findFabricatedPerNightPrice(
  text: string,
  blob: string,
): string | null {
  // E.g, if text = "The hotel is €120/night" then extractPrices(text, [...]) returns ["120"] (one entry, not two).

  const claimed = extractPrices(text, PER_NIGHT_HOTEL_PATTERNS);
  return firstNotInBlob(claimed, blob);
}

// Returns the first flight per-leg price mentioned in `text` that
// doesn't appear in `blob`. Returns null on all-clear or no-mentions.
function findFabricatedFlightPrice(text: string, blob: string): string | null {
  const claimed = extractPrices(text, FLIGHT_PRICE_PATTERNS);
  return firstNotInBlob(claimed, blob);
}

// Run each pattern over `text`, collect the first capture group from
// each match (that's the price digits). De-duplicates across patterns
// so the same price isn't checked twice when multiple patterns fire.
// E.g, if text = "The hotel is €120/night and the flight is €120 for A3 824"
// then extractPrices(text, [...]) returns ["120"] (one entry, not two).
function extractPrices(text: string, patterns: RegExp[]): string[] {
  const collected = patterns.flatMap((p) =>
    [...text.matchAll(p)].map((m) => m[1].replace(',', '.')),
  );
  return [...new Set(collected)];
}

// Returns the first entry from `claimed` that doesn't appear in `blob`
// via `priceAppearsInBlob`. Empty blob is treated as "nothing to
// compare against" — every claim is fabricated by definition.
// E.g., if claimed = ["120", "150"] and blob = "Price per Night: €120\nPrice per Night: €150"
// then firstNotInBlob(claimed, blob) returns null (all-clear).
// If claimed = ["120", "150"] and blob = "Price per Night: €150"
// then firstNotInBlob(claimed, blob) returns "120" (fabricated).
function firstNotInBlob(claimed: string[], blob: string): string | null {
  if (claimed.length === 0) return null;
  if (blob.length === 0) return claimed[0];
  return claimed.find((c) => !priceAppearsInBlob(c, blob)) ?? null;
}

// Tripwire helper — same shape as the other cross-reference guardrails.
function trip(
  patternName: string,
  matchedText: string,
  message: string,
): {
  tripwireTriggered: true;
  outputInfo: { message: string; patternName: string; matchedText: string };
} {
  return {
    tripwireTriggered: true,
    outputInfo: { message, patternName, matchedText },
  };
}
