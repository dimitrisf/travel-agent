import type { Case, CaseOutput } from '../types';
import {
  finalAgent,
  noErrorsOrGuardrails,
  toolArgsMatch,
  toolCalled,
} from '../assertions';

// Full trip-planning case with the origin already provided (so it's a
// single-turn ask — multi-turn cases arrive in Phase 4). Verifies the
// agent calls all three of get_forecast + search_flights (round-trip)
// + search_hotels before answering, and that the summary includes at
// least four € figures (both flight legs × 1 hotel, at minimum).
//
// A failure of "search_flights with return_date" is exactly the
// round-trip drift we hit in Stage 9 — this is the regression check.
export const sunnyWeekendFromAthens: Case = {
  name: 'sunny-weekend-from-athens',
  description:
    'Trip planning with explicit origin — expect all three search tools, round-trip flight query, and a summary with multiple prices.',
  user: 'I want a sunny weekend in Berlin from Athens under €600 total.',
  expect: (out) => [
    noErrorsOrGuardrails(out),
    finalAgent(out, 'TravelAgent'),
    toolArgsMatch(
      out,
      'search_flights',
      (args) => !!(args as { return_date?: unknown })?.return_date,
      'has return_date (round-trip)',
    ),
    toolCalled(out, 'search_hotels'),
    toolCalled(out, 'get_forecast'),
    euroCountCheck(out),
    // This is the actual regression check we spent all of Stage 9
    // chasing: does every "trip total" the model wrote equal outbound
    // + return + some hotel total from the tool results? Cross-checks
    // against real tool output — not just internal consistency.
    tripTotalArithmeticCheck(out),
  ],
};

// Count the € symbols in the final summary and require the appropriate
// threshold based on what search_flights returned. Two modes so the
// check stays tight when flights are present but doesn't false-fail
// when they aren't:
//
//   - Any round-trip search_flights call returned outbound OR inbound
//     results → require ≥4 € figures. Rationale: outbound price +
//     return price + hotel total + trip total = 4 minimum. Anything
//     less means the arithmetic collapsed to one-way or a piece got
//     dropped from the summary.
//   - All round-trip calls returned both arrays empty (mode C —
//     see tripTotalArithmeticCheck header) → require ≥1 € figure.
//     Only hotel totals to report; no flight prices, no trip total
//     to write. A single hotel total is enough proof the search
//     went through.
function euroCountCheck(out: CaseOutput): {
  description: string;
  passed: boolean;
  details: string;
} {
  const count = (out.finalText.match(/€/g) ?? []).length;
  const flightsPresent = anyRoundTripFlightHasResults(out);
  const threshold = flightsPresent ? 4 : 1;
  return {
    description: 'final summary references € figures (≥4 with flights, ≥1 hotel-only)',
    passed: count >= threshold,
    details: `€ count: ${count} (${flightsPresent ? 'flights present → need ≥4' : 'no flights → need ≥1'})`,
  };
}

// True iff any round-trip search_flights call in this case's tool trace
// returned at least one outbound OR inbound flight. Used by euroCountCheck
// to pick the right threshold; matches the mode A/B vs mode C split in
// tripTotalArithmeticCheck without duplicating that function's inner
// state (which is scoped to its own combo-building loop).
function anyRoundTripFlightHasResults(out: CaseOutput): boolean {
  return out.toolCalls.some((t) => {
    if (t.name !== 'search_flights') return false;
    if (!(t.args as { return_date?: unknown })?.return_date) return false;
    if (typeof t.parsedOutput !== 'object' || t.parsedOutput === null) {
      return false;
    }
    const parsed = t.parsedOutput as { outbound?: unknown; inbound?: unknown };
    const outboundHasResults =
      Array.isArray(parsed.outbound) && parsed.outbound.length > 0;
    const inboundHasResults =
      Array.isArray(parsed.inbound) && parsed.inbound.length > 0;
    return outboundHasResults || inboundHasResults;
  });
}

// Verify that every "trip total"-flavoured number in the final summary
// equals a real combination of tool-returned prices. Three modes
// depending on what search_flights returned (Stage 19 added mode C
// after CI + a same-day local run both surfaced the both-empty variant):
//
//   A. Both outbound and inbound present → validCombo = outbound + return
//      + hotel_total. Catches the classic Stage 9 drift where the agent
//      skipped the return leg's cost in the total.
//   B. Outbound present, inbound empty  → validCombo = outbound + hotel_total.
//      Stage 17.5's THIN TOOL DATA rule: when search_flights returns zero
//      inbound flights, the agent must NOT invent a return leg, so the
//      honest trip total is one-way + hotel.
//   C. Both outbound and inbound empty  → NO validCombo possible; no
//      trip total is expected in the response at all. Assertion passes
//      IF the response openly acknowledges that no flights were found
//      (matched by HONEST_THIN_DATA_PHRASING), without inventing a
//      flight number or fake trip total. Added Stage 19 after "next
//      weekend" resolved to a date range with no seeded flights,
//      producing legit-but-thin agent output that mode B couldn't accept.
//
// Modes A vs B are branched, not unioned: if we added the one-way combo
// when inbound IS available, the old skip-the-return drift would sneak
// through as "valid" arithmetic. Mode C is a separate escape (no combo
// built at all), gated on a distinct flag.
function tripTotalArithmeticCheck(out: CaseOutput): {
  description: string;
  passed: boolean;
  details: string;
} {
  const description =
    'every "trip total" in the summary matches outbound + return + a hotel total';

  // Only round-trip search_flights calls contribute meaningful data — a
  // call without `return_date` returned only one direction of flights, and
  // unioning its `outbound` with a real round-trip's `inbound` would
  // produce cross-direction combinations that never existed as a real trip.
  // We assert the round-trip pattern separately (see assertion 3); here we
  // just filter to the calls that match it.
  // E.g., if the agent calls search_flights twice, once with return_date and once without, we only consider the one with return_date for valid combinations.
  const roundTripFlightCalls = out.toolCalls.filter(
    (t) =>
      t.name === 'search_flights' &&
      t.parsedOutput !== undefined &&
      // The `return_date` property is expected to be present in the arguments of the search_flights tool call for a round-trip flight. This assertion checks that at least one of the tool calls to search_flights includes a return_date, indicating that the agent correctly handled the round-trip request.
      !!(t.args as { return_date?: unknown })?.return_date,
  );

  // At this point, roundTripFlightCalls could be, e.g.,:
  // [
  //   {
  //     name: 'search_flights',
  //     args: { origin: 'Athens', destination: 'Berlin', return_date: '2026-07-19' },
  //     agent: 'TravelAgent',
  //     parsedOutput: {
  //       outbound: [{ price: 100 }, { price: 150 }],
  //       inbound: [{ price: 80 }, { price: 120 }]
  //     }
  //   }
  // ]
  // outbound here are the flights from Athens to Berlin, and inbound are the flights from Berlin back to Athens. Each flight has a price, and we will use these prices to calculate valid trip totals in combination with hotel prices.
  // The parsedOutput is expected to have the shape of SearchFlightsResult, which has outbound and inbound arrays of FlightResult objects. Each FlightResult object has a price property that we will use to calculate valid trip totals.
  // The outbound and inbound arrays come here from two flight instances, e.g., Aegean at €100 vs Lufthansa at €150 for outbound, and Lufthansa at €80 vs Aegean at €120 for inbound. We will consider all combinations of these prices when calculating valid trip totals.

  // Only hotel calls with parseable output contribute to the arithmetic check.
  const hotelCalls = out.toolCalls.filter(
    (t) => t.name === 'search_hotels' && t.parsedOutput !== undefined,
  );

  // If we don't have at least one round-trip flight call and one hotel call, we can't check the arithmetic at all — fail the assertion with a clear message.
  if (roundTripFlightCalls.length === 0 || hotelCalls.length === 0) {
    return {
      description,
      passed: false,
      details:
        'no round-trip search_flights call or no search_hotels call with parseable output — cannot check arithmetic',
    };
  }

  // Compute the set of valid trip totals as: for each round-trip flight
  // call, form (outbound × inbound) using only that call's own arrays
  // (keeps directions bound together), then combine with any hotel total.
  // validCombos keeps the unique sums of (outbound + return + hotel_total) rounded to two decimal places. This ensures that we have a comprehensive set of all possible trip totals based on the tool outputs.
  // E.g., if we have two round-trip flight calls with outbound prices [100, 150] (meaning that the outbound flight has two options, i.e, two competing flights on the same leg — e.g. Aegean at €100 vs Lufthansa at €150) and inbound prices [80, 120] (with also two options), and one hotel call with total prices [200, 300], then validCombos will include:
  // 100 + 80 + 200 = 380
  // 100 + 80 + 300 = 480
  // 100 + 120 + 200 = 420
  // 100 + 120 + 300 = 520
  // 150 + 80 + 200 = 430
  // 150 + 80 + 300 = 530
  // 150 + 120 + 200 = 470
  // 150 + 120 + 300 = 570
  // i.e., validCombos = {380, 420, 430, 470, 480, 520, 530, 570}.
  const validCombos = new Set<number>();
  // Set to true if at least one round-trip flight call returned an
  // empty `inbound` array (with outbound still present). Used later to
  // decide whether an "honest thin-data" prose response (subtotals only,
  // no grand total) counts as a pass — the model correctly refusing to
  // write a possibly-misleading trip total when the tool couldn't
  // confirm a return leg. This is mode B in the header comment.
  let sawEmptyInbound = false;
  // Set to true if EVERY round-trip flight call returned both outbound
  // and inbound empty — no flights at all. Distinct from sawEmptyInbound
  // because a legit response in this case has no flight numbers, no
  // flight prices, no trip totals at all — the escape criteria differ
  // (only the "no flights" phrasing needs to be present; no per-leg
  // arithmetic to validate). This is mode C in the header comment.
  let allFlightsEmpty = roundTripFlightCalls.length > 0;

  for (const fc of roundTripFlightCalls) {
    // we expect the parsed output to be an object with `outbound` and `inbound` arrays, each containing objects with a `price` property. If the structure is different, we skip this flight call.
    if (
      typeof fc.parsedOutput !== 'object' ||
      fc.parsedOutput === null ||
      !('outbound' in fc.parsedOutput) ||
      !('inbound' in fc.parsedOutput)
    ) {
      continue;
    }

    // Extract the outbound and inbound prices from the flight call's parsed output. If either is missing or not an array, we skip this flight call.
    // See SearchFlightsResult interface in FlightService.ts for the expected structure.
    const flightsResult = fc.parsedOutput as {
      outbound?: Array<{ price?: number }>;
      inbound?: Array<{ price?: number }>;
    };

    if (
      !Array.isArray(flightsResult.outbound) ||
      !Array.isArray(flightsResult.inbound)
    ) {
      continue;
    }

    // Extract prices. Outbound is required (no outbound = the flight
    // call returned nothing usable). Inbound may be empty — that's the
    // THIN TOOL DATA case where the tool couldn't find return flights
    // in the current window; we still want to validate one-way + hotel
    // arithmetic against real prices.
    const outboundPrices = pricesFrom(flightsResult.outbound);
    const inboundPrices = pricesFrom(flightsResult.inbound);

    if (outboundPrices.length === 0) continue;

    // This flight call had outbound results — the "all flights empty"
    // escape (mode C) no longer applies.
    allFlightsEmpty = false;

    for (const hc of hotelCalls) {
      // E.g., imagine the agent runs this one call:
      // search_hotels({
      //   "city": "Berlin",
      //   "checkin": "2026-07-17",
      //   "checkout": "2026-07-19",
      //   "guests": 2
      // });
      // The tool searches the database and returns all three matching hotels in one response:
      // [
      //   {
      //     "hotel": "City Budget Inn",
      //     "stars": 3,
      //     "price_per_night": 94.30,
      //     "total_price": 188.60
      //   },
      //   {
      //     "hotel": "Hotel Berlin Central",
      //     "stars": 4,
      //     "price_per_night": 148.40,
      //     "total_price": 296.80
      //   },
      //   {
      //     "hotel": "Grand Berlin Plaza",
      //     "stars": 5,
      //     "price_per_night": 281.80,
      //     "total_price": 563.60
      //   }
      // ]
      // That JSON array is what our code sees as hc.parsedOutput (aliased to hotelsResult). One search_hotels call, three hotel options.
      // So in this particular case, hotelsResult would be:
      // [
      //   { total_price: 188.60 },
      //   { total_price: 296.80 },
      //   { total_price: 563.60 }
      // ]
      const hotelsResult = hc.parsedOutput as Array<{ total_price?: number }>;

      if (!Array.isArray(hotelsResult)) continue;

      for (const h of hotelsResult) {
        // E.g., if h = { total_price: 188.60 }, then h.total_price is 188.60. If h.total_price is not a number (e.g., undefined or null), we skip this hotel option.
        if (typeof h.total_price !== 'number') continue;

        // Branch on inbound availability:
        //   - Inbound present → require outbound + return + hotel
        //     (round-trip case, strict).
        //   - Inbound empty   → accept outbound + hotel (thin-data case,
        //     the model must not have invented a return leg).
        if (inboundPrices.length > 0) {
          // For each combination of outbound price, inbound price, and hotel total price, calculate the total trip cost and add it to the validCombos set. Round to two decimal places to avoid floating-point precision issues.
          for (const o of outboundPrices)
            for (const i of inboundPrices)
              validCombos.add(Math.round((o + i + h.total_price) * 100) / 100);
        } else {
          // Inbound empty → only outbound + hotel is valid. For each outbound price and hotel total price, calculate the total trip cost and add it to the validCombos set. Round to two decimal places to avoid floating-point precision issues.
          sawEmptyInbound = true;
          for (const o of outboundPrices)
            validCombos.add(Math.round((o + h.total_price) * 100) / 100);
        }
      }
    }
  }

  // If we didn't find any valid combinations, split on why:
  //
  //   - Mode C escape: every round-trip flight call returned both arrays
  //     empty. There are no flights to build a combo from. The response
  //     is legit iff it (a) doesn't invent a trip total and (b) openly
  //     acknowledges the missing flights via HONEST_THIN_DATA_PHRASING.
  //     A response that quotes a hotel-only total is fine — hotel totals
  //     aren't trip totals, and the lenient candidate check below never
  //     confuses the two once we short-circuit here.
  //   - Otherwise (no hotels, or some other sparsity): hard fail with
  //     the original message. That signals a real problem with the
  //     tool results the eval should surface.
  if (validCombos.size === 0) {
    if (allFlightsEmpty && HONEST_THIN_DATA_PHRASING.test(out.finalText)) {
      return {
        description,
        passed: true,
        details:
          'thin-data escape (both outbound and inbound empty): response acknowledged missing flights without inventing a trip total',
      };
    }
    return {
      description,
      passed: false,
      details:
        'no valid (outbound [+ return] + hotel) combination could be built from tool results',
    };
  }

  // Collect candidate "trip total" values from two sources in the summary:
  //   (a) Every "= €X" occurrence — equations of any kind (flight
  //       subtotals, per-hotel totals, per-option grand totals).
  //   (b) Every "<trip-total-phrase>: €X" occurrence — labelled totals
  //       without an equation.
  //
  // The check is LENIENT: we require that AT LEAST ONE candidate matches
  // a valid combo. Rationale: flight sub-totals and per-hotel totals
  // legitimately appear as "= €X" but aren't trip totals — expecting
  // every match to validate produces false failures. The bug we're
  // actually hunting (one-leg arithmetic, hallucinated per-night prices,
  // etc.) shows up as NO valid combo appearing anywhere in the summary.
  const candidates: number[] = [];
  const contextByCandidate = new Map<number, string[]>();

  function push(value: number, matchStart: number, matchLength: number) {
    candidates.push(value);
    const start = Math.max(0, matchStart - 20);
    const end = Math.min(out.finalText.length, matchStart + matchLength + 20);
    const context = out.finalText.slice(start, end).replace(/\s+/g, ' ').trim();
    const list = contextByCandidate.get(value) ?? [];
    list.push(`"…${context}…"`);
    contextByCandidate.set(value, list);
  }

  // (a) "= €X" — RHS of any equation. The between-part allows short
  // non-digit noise so we still match markdown-decorated totals like
  // "= **€471.60**" or hedged phrasing like "= approximately €471.60".
  const eqPattern = /=[^€\d\n]{0,20}€\s*([\d,]+(?:\.\d+)?)/g;
  let em: RegExpExecArray | null;
  while ((em = eqPattern.exec(out.finalText)) !== null) {
    const n = parseFloat(em[1].replace(/,/g, ''));
    if (!Number.isNaN(n)) push(n, em.index, em[0].length);
  }

  // (b) Phrase followed by € number (no equation required). Narrow phrase
  // list — extend when a new variant shows up in the tail-of-summary dump.
  const phrasePattern =
    /(?:trip\s+total|total\s+trip\s+cost|total\s+trip|grand\s+total|overall\s+total|total\s+estimated\s+cost|total\s+cost|total\s+estimate|estimated\s+total|trip\s+cost|overall\s+cost)[^€]{0,30}€\s*([\d,]+(?:\.\d+)?)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = phrasePattern.exec(out.finalText)) !== null) {
    const n = parseFloat(pm[1].replace(/,/g, ''));
    if (!Number.isNaN(n)) push(n, pm.index, pm[0].length);
  }

  // (c) Plain "Total: €X" label. The model sometimes just writes "Total:"
  // as the last line of a per-option summary block instead of a longer
  // phrase like "Trip Total". This picks up subtotal labels too (e.g.
  // "Hotel Total: €188.60") but the lenient check tolerates that —
  // subtotals fail to match a valid combo and get ignored, while real
  // trip totals do match. Only harm is a slightly noisier candidate list
  // on failure.
  const plainTotalPattern = /\bTotal\s*:[^€\d\n]{0,20}€\s*([\d,]+(?:\.\d+)?)/gi;
  let tm: RegExpExecArray | null;
  while ((tm = plainTotalPattern.exec(out.finalText)) !== null) {
    const n = parseFloat(tm[1].replace(/,/g, ''));
    if (!Number.isNaN(n)) push(n, tm.index, tm[0].length);
  }

  if (candidates.length === 0) {
    // No candidates found at all — the summary doesn't contain any "= €X"
    // equations or trip-total phrases. Dump the tail so we can see what
    // the model actually wrote and extend the patterns if needed.
    const tail = out.finalText.slice(-500).replace(/\s+/g, ' ').trim();
    return {
      description,
      passed: false,
      details: `no "= €X" or trip-total phrase found in summary. Tail:\n        "…${tail}"`,
    };
  }

  // Lenient: if ANY candidate matches a valid combo (exact, or ±€1 slack
  // for rounding noise), the arithmetic is fine. Sub-totals and per-hotel
  // totals will fail to match but that's harmless — we only fail if NONE
  // of the candidates matches, which is the actual arithmetic-bug signal.
  const matchedCandidate = candidates.find((t) => {
    const rounded = Math.round(t * 100) / 100;
    if (validCombos.has(rounded)) return true;
    for (const v of validCombos) if (Math.abs(v - rounded) < 1) return true;
    return false;
  });

  if (matchedCandidate === undefined) {
    // Thin-data escape: when inbound was empty for at least one flight
    // call AND no candidate matched, check whether the response prose is
    // openly honest about the missing return leg. If the model wrote
    // "no return flights available" / "only outbound" / "cannot confirm
    // the full trip" style phrasing, it deliberately chose NOT to write
    // a grand total rather than invent one — that's the desired Stage
    // 17.5 THIN TOOL DATA behavior. Accept it as a pass.
    if (sawEmptyInbound && HONEST_THIN_DATA_PHRASING.test(out.finalText)) {
      return {
        description,
        passed: true,
        details:
          'thin-data escape: response acknowledged missing return leg without writing a fabricated trip total',
      };
    }
    // Failure: show every candidate we did find with its context so we
    // can see whether the check missed a real total or the model actually
    // wrote wrong numbers.
    const uniqueCandidates = Array.from(new Set(candidates));
    const candidateLines = uniqueCandidates.map((n) => {
      const ctxs = contextByCandidate.get(n) ?? ['(no context)'];
      return `€${n} @ ${ctxs.join(' / ')}`;
    });
    const sortedCombos = Array.from(validCombos).sort((a, b) => a - b);
    const sample = sortedCombos.slice(0, 6).map((n) => '€' + n);
    const sampleSuffix = sortedCombos.length > 6 ? ', …' : '';
    return {
      description,
      passed: false,
      details:
        `no candidate total matched any valid combo. Candidates:\n        ${candidateLines.join('\n        ')}\n` +
        `        checked against ${validCombos.size} valid combo(s); sample: ${sample.join(', ')}${sampleSuffix}`,
    };
  }

  return {
    description,
    passed: true,
    details: `€${matchedCandidate} matched (out of ${candidates.length} candidate(s) against ${validCombos.size} valid combo(s))`,
  };
}

// Helper to extract the `price` numbers from an array of objects that may or may not have a `price` property. Filters out undefined values and returns an array of numbers. If the input is undefined, returns an empty array.
function pricesFrom(entries: Array<{ price?: number }> | undefined): number[] {
  return (entries ?? [])
    .map((e) => e.price)
    .filter((n): n is number => typeof n === 'number');
}

// Matches prose phrasings the model uses when honestly acknowledging that
// search_flights returned no flights (either just the return leg, or
// both directions). Used by the thin-data escape in
// tripTotalArithmeticCheck: if the response contains any of these AND
// no candidate matched a real combo AND the appropriate emptiness flag
// is set, we count it as a pass (the model correctly refused to invent).
//
// Deliberately permissive: three matching strategies OR'd together —
//   (a) "return" + one of a small set of missing-data verbs within 60
//       characters (handles "return flights for this period weren't
//       found", "return leg isn't available", "return flight was not
//       found", "round-trip calculation isn't possible", etc.). Mode B.
//   (b) Standalone flag phrases like "no return flights", "only
//       outbound", "no inbound", "couldn't find a return". Mode B.
//   (c) Stage 19 additions for mode C (both outbound and inbound empty):
//       "no (available|remaining) flights", "no flights (were|are|.*)
//       found/available", "no flights ... in the (current|search) window",
//       "no flights ... within (the|your) budget". Covers phrasings from
//       real failing runs: "No flights were found for your selected
//       weekend from Athens to Berlin within the specified budget" and
//       "No available flights from Athens to Berlin ... were found in
//       the current search window".
// False-positive risk is low for this specific case — a `sunny weekend`
// response mentioning "return" or "no flights" for unrelated reasons
// doesn't happen in practice.
const HONEST_THIN_DATA_PHRASING =
  /return\s+(?:flights?|leg|direction|trip|calculation)[\s\S]{0,60}?(?:not\s+(?:available|found|possible)|unavailable|(?:weren'?t|wasn'?t|isn'?t|aren'?t)\s+(?:found|available|possible)|couldn'?t\s+(?:find|be\s+found)|missing|no\s+longer\s+available)|round-?trip\s+(?:calculation|total|cost|price)[\s\S]{0,30}?(?:not\s+possible|isn'?t\s+possible|cannot\s+be\s+(?:calculated|confirmed))|no\s+return\s+flights?|only\s+outbound|no\s+inbound|couldn'?t\s+find\s+(?:a\s+|any\s+)?return|cannot\s+confirm\s+the\s+full|no\s+(?:available\s+|remaining\s+)?flights?\b[\s\S]{0,120}?(?:were\s+found|are\s+available|(?:in|within)\s+(?:the|your|this)?\s*(?:current\s+|search\s+)?(?:search\s+window|window|budget|range))|no\s+(?:available\s+|remaining\s+)?flights?\s+(?:were|are|could\s+be)\s+found|unable\s+to\s+find\s+(?:any\s+|available\s+)?flights?|no\s+flights?\s+found/i;
