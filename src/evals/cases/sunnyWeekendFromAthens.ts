import type { Case, CaseOutput } from '../types';

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
    {
      description: 'no unexpected errors or guardrail trips',
      passed: !out.errored && !out.guardrailTripped,
      details: out.errored ?? out.guardrailTripped,
    },
    {
      description: 'final agent was TravelAgent',
      passed: out.lastAgent === 'TravelAgent',
      details: `last agent: ${out.lastAgent}`,
    },
    {
      description: 'called search_flights with return_date (round-trip)',
      passed: out.toolCalls.some(
        (t) =>
          t.name === 'search_flights' &&
          // The `return_date` property is expected to be present in the arguments of the search_flights tool call for a round-trip flight. This assertion checks that at least one of the tool calls to search_flights includes a return_date, indicating that the agent correctly handled the round-trip request.
          !!(t.args as { return_date?: unknown })?.return_date,
      ),
      details: describeToolCalls(out, 'search_flights'),
    },
    {
      description: 'called search_hotels',
      passed: out.toolCalls.some((t) => t.name === 'search_hotels'),
      details: describeToolCalls(out, 'search_hotels'),
    },
    {
      description: 'called get_forecast (weather-relevant query)',
      passed: out.toolCalls.some((t) => t.name === 'get_forecast'),
      details: describeToolCalls(out, 'get_forecast'),
    },
    {
      description: 'final summary references at least four € figures',
      // A round-trip + one hotel option = outbound price + return price +
      // hotel total + trip total = 4 minimum. Anything less and either
      // the arithmetic collapsed to one-way or an option got dropped.
      passed: (out.finalText.match(/€/g) ?? []).length >= 4,
      details: `€ count: ${(out.finalText.match(/€/g) ?? []).length}`,
    },
    // This is the actual regression check we spent all of Stage 9
    // chasing: does every "trip total" the model wrote equal outbound
    // + return + some hotel total from the tool results? Cross-checks
    // against real tool output — not just internal consistency.
    tripTotalArithmeticCheck(out),
  ],
};

// Verify that every "trip total"-flavoured number in the final summary
// equals `outbound_price + return_price + hotel_total_price` for some
// combination present in the tool outputs. Catches:
//   - one-leg arithmetic (skipping the return flight)
//   - hallucinated prices that don't match any real result
//   - dropped hotel figures
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

    // flightsResult.outbound and flightsResult.inbound are arrays of objects that may or may not have a `price` property. We extract the prices into arrays of numbers, filtering out any undefined values. If either array is empty, we skip this flight call.
    // E.g., if flightsResult.outbound = [{price: 100}, {price: 150}], then outboundPrices = [100, 150].
    // Similarly, if flightsResult.inbound = [{price: 80}, {price: 120}], then inboundPrices = [80, 120].
    // outbound and inbound are arrays because there may be multiple flights for each leg (outbound and inbound), and we want to consider all combinations of outbound and inbound prices when calculating valid trip totals.
    const outboundPrices = pricesFrom(flightsResult.outbound);
    const inboundPrices = pricesFrom(flightsResult.inbound);

    if (outboundPrices.length === 0 || inboundPrices.length === 0) continue;

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

        // For each combination of outbound price, inbound price, and hotel total price, we compute the sum and round it to two decimal places. We add this rounded sum to the set of valid combinations. This ensures that we have a comprehensive set of all possible trip totals based on the tool outputs.
        // E.g., if outboundPrices = [100, 150], inboundPrices = [80, 120], and hotel total_price = 200, then validCombos will include:
        // 100 + 80 + 200 = 380
        // 100 + 120 + 200 = 420
        // 150 + 80 + 200 = 430
        // 150 + 120 + 200 = 470
        for (const o of outboundPrices)
          for (const i of inboundPrices)
            validCombos.add(Math.round((o + i + h.total_price) * 100) / 100);
      }
    }
  }

  // If we didn't find any valid combinations, we fail the assertion with a clear message. This indicates that there were no complete (outbound, return, hotel) combinations found in any of the tool results, which is a critical failure for the trip planning case.
  if (validCombos.size === 0) {
    return {
      description,
      passed: false,
      details:
        'no complete (outbound, return, hotel) combination found in any tool result',
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
    const context = out.finalText
      .slice(start, end)
      .replace(/\s+/g, ' ')
      .trim();
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

// Helper to summarize how many times a tool was called and what all the calls were.
// E.g., if out has toolCalls = [{name: 'search_flights'}, {name: 'get_forecast'}, {name: 'search_hotels'}], then describeToolCalls(out, 'search_flights') returns:
// "search_flights called 1× | all: search_flights, get_forecast, search_hotels"
function describeToolCalls(
  out: { toolCalls: Array<{ name: string }> },
  name: string,
): string {
  // Count how many times the specified tool was called and list all tool calls.
  const count = out.toolCalls.filter((t) => t.name === name).length;
  const all = out.toolCalls.map((t) => t.name).join(', ') || '(none)';

  // Return a string like "search_flights called 2× | all: search_flights, get_forecast, search_hotels"
  return `${name} called ${count}× | all: ${all}`;
}
