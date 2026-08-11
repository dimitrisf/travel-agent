import type { OutputGuardrail } from '@openai/agents';
import type { AgentRunContext, ToolCallRecord } from '@/agents/agentRunContext';

// Stage 11 — deterministic layer of the booking-truthfulness suite.
// Complements `bookingTruthfulnessOutputGuardrail` (text-only regex on
// finality phrasings). This one cross-references specific claims in the
// agent's output against what `propose_booking` actually returned during
// the conversation.
//
// Reads from `context.context.toolCallCollector` (populated by the
// `agent_tool_end` hook in `buildTravelAgent`; see `agentRunContext.ts`).
// Fails OPEN when the collector is missing — some call sites may not opt
// in yet, and blocking a legit user on our own plumbing gap is worse
// than the risk of missing a claim.
//
// Three independent checks, evaluated in order — first match trips:
//   (a) Fabricated reference     — agent quotes a `BKG-YYYY-XXXXXX`
//       token that no `propose_booking` output ever produced.
//   (b) Wrong booking total      — agent quotes a € figure in booking
//       context that doesn't match any real `totalPriceEUR` from a
//       `propose_booking` response — grand total OR any per-leg /
//       per-stay line-item total (±€1). The line-item widening (Stage
//       22 backlog) prevents the guardrail from misfiring on legitimate
//       subtotal quotes like "Hotel total: €188.60".
//   (c) Booking-without-call     — agent talks about a booking as if
//       it exists, but no `propose_booking` has ever succeeded in this
//       conversation.
export const bookingCrossReferenceOutputGuardrail: OutputGuardrail = {
  name: 'booking_cross_reference_output',
  async execute({ agentOutput, context }) {
    // E.g., agentOutput = "Your booking reference is BKG-2023-ABCD. The total for your booking is €138."

    const text = typeof agentOutput === 'string' ? agentOutput : '';
    // If the agent output is empty, we don't have anything to cross-reference.
    if (!text) return { tripwireTriggered: false, outputInfo: null };

    // Fail open if the collector isn't threaded through. Logged so a
    // regression (someone drops the context arg from `run()`) is visible.
    const ctx = context.context as AgentRunContext | undefined;
    if (!ctx?.toolCallCollector) {
      console.warn(
        '[guardrail:booking_cross_reference] no tool-call collector in context; skipping',
      );
      return {
        tripwireTriggered: false,
        // We don't trip the guardrail, but we do indicate that we skipped the check due to missing context.
        outputInfo: { skipped: true },
      };
    }

    // At this point, e.g., ctx.toolCallCollector = [
    //   { name: 'propose_booking', args: { ... }, result: '{"reference":"BKG-2023-ABCD","totalPriceEUR":138}', parsedResult: { reference: 'BKG-2023-ABCD', totalPriceEUR: 138 } },
    //   { name: 'propose_booking', args: { ... }, result: '{"reference":"BKG-2023-EFGH","totalPriceEUR":200}', parsedResult: { reference: 'BKG-2023-EFGH', totalPriceEUR: 200 } },
    //   ...
    // ]
    // then, proposeBookingResults = [
    //   { reference: 'BKG-2023-ABCD', totalPriceEUR: 138 },
    //   { reference: 'BKG-2023-EFGH', totalPriceEUR: 200 },
    //   ...
    // ]
    const proposeBookingResults = ctx.toolCallCollector
      .filter((r) => r.name === 'propose_booking')
      .map((r) => r.parsedResult as BookingLike | undefined)
      // Only keep well-formed objects that have the properties we care about. Malformed or missing parsedResults (e.g., due to SDK bugs) are skipped.
      .filter(
        (b): b is BookingLike =>
          // !!b means "b is truthy" (not null or undefined), and typeof b === 'object' ensures it's an object. This narrows the type to BookingLike.
          !!b && typeof b === 'object',
      );

    // (a) Fabricated reference

    // e.g, text = "Your booking reference is BKG-2023-XXXX. The total for your booking is €138."
    // proposeBookingResults = [{ reference: 'BKG-2023-ABCD', totalPriceEUR: 138 }]
    // fabricated = findFabricatedReference(text, proposeBookingResults) => "BKG-2023-XXXX"
    const fabricated = findFabricatedReference(text, proposeBookingResults);

    if (fabricated) {
      return trip(
        `The booking reference I mentioned (${fabricated}) doesn't match any real booking I've created. Please look at the actual booking card for the correct reference.`,
        'fabricated-reference',
        fabricated,
      );
    }

    // (b) Wrong booking total

    // Widened from just the booking's grand total to include every
    // `totalPriceEUR` in the propose_booking response — grand total AND
    // every per-leg / per-stay line item. Fixes the false-positive where
    // the agent legitimately quotes a subtotal (e.g. "Hotel total:
    // €188.60") that doesn't equal the grand total (€471.60).
    const knownBookingFigures = collectKnownBookingPriceFigures(
      ctx.toolCallCollector,
    );
    const wrongTotal = findWrongBookingTotal(text, knownBookingFigures);

    if (wrongTotal) {
      return trip(
        `A total I quoted (€${wrongTotal.claimed}) doesn't match any real booking figure. Please refer to the booking card for the correct amount.`,
        'wrong-booking-total',
        `claimed=€${wrongTotal.claimed}, known figures=[${wrongTotal.knownFigures.join(', ')}]`,
      );
    }

    // (c) Booking-mentioned-without-any-call

    if (
      // no propose_booking calls were made in this conversation, and the agent output contains a finality-adjacent phrase (e.g., "Your booking is confirmed"), then we trip the guardrail. This indicates that the agent is talking about a booking as if it exists, but no booking has actually been created.
      proposeBookingResults.length === 0 &&
      // E.g, text = "Your booking is confirmed. The total for your booking is €138."
      finalityWithoutProposalPattern.test(text)
    ) {
      return trip(
        "I mentioned a booking as if it exists, but I haven't actually created one. Ask me to propose a booking and I'll show you a real booking card.",
        'booking-without-call',
        '(no propose_booking in conversation)',
      );
    }

    // At this point, all three checks have passed — no fabricated references, no wrong totals, and no booking-without-call. The guardrail is not tripped.
    return { tripwireTriggered: false, outputInfo: null };
  },
};

// Minimal shape of what a propose_booking parsedResult carries that we
// care about here. Cross-reference only needs `reference` for check (a);
// check (b) collects `totalPriceEUR` values via a walk (see
// `collectKnownBookingPriceFigures` below) so no fixed shape is required.
type BookingLike = {
  reference?: unknown;
};

// Reference format is `BKG-YYYY-XXXXXX` per the Stage 8 spec. Regex is
// tight to avoid matching random alphanumeric tokens that happen to
// start with `BKG-`. Case-sensitive on purpose (real references are
// upper-case), but the agent may lowercase — we normalize to upper for
// comparison.
const REFERENCE_PATTERN = /BKG-\d{4}-[A-Z0-9]{4,}/gi;

// Returns the first booking reference mentioned in `text` that doesn't
// match any real booking reference in `bookings`. Returns null if all
// mentioned references are real, or if no references are mentioned.
// E.g., text = "Your booking reference is BKG-2023-XXXX. The total for your booking is €138.", bookings = [{ reference: 'BKG-2023-ABCD', totalPriceEUR: 138 }] returns "BKG-2023-XXXX"
function findFabricatedReference(
  text: string,
  bookings: BookingLike[],
): string | null {
  // E.g., text = "Your booking reference is BKG-2023-XXXX. The total for your booking is €138." => mentioned = ["BKG-2023-XXXX"]
  const mentioned = [...text.matchAll(REFERENCE_PATTERN)].map((m) =>
    m[0].toUpperCase(),
  );

  if (mentioned.length === 0) return null;

  // E.g., bookings = [{ reference: 'BKG-2023-ABCD', totalPriceEUR: 138 }] => real = Set("BKG-2023-ABCD")
  const real = new Set(
    bookings
      .map((b) => (typeof b.reference === 'string' ? b.reference : ''))
      // next line filters out any empty strings (e.g., if a booking has no reference or a non-string reference), and then normalizes to upper-case for comparison.
      .filter(Boolean)
      .map((r) => r.toUpperCase()),
  );

  // ref means "booking reference". For each mentioned reference, if it's not in the set of real references, return it. If all mentioned references are real, return null.
  for (const ref of mentioned) {
    // E.g, ref = "BKG-2023-XXXX", real = Set("BKG-2023-ABCD") => !real.has(ref) is true, so we return ref. If ref were "BKG-2023-ABCD", !real.has(ref) would be false, and we'd continue to the next mentioned reference.
    if (!real.has(ref)) return ref;
  }

  // At this point, all mentioned references are real, so we return null to indicate no fabricated reference was found.
  return null;
}

// Match € amounts that appear in booking-adjacent phrasing. Deliberately
// scoped — a mid-sentence total in flight-search prose ("€138") shouldn't
// trigger this; only totals that are being presented AS the booking's
// total. Ordered so more specific phrasings come first.
const BOOKING_TOTAL_PATTERN =
  /(?:booking\s+total|total\s+for\s+(?:the|your)\s+booking|trip\s+total|grand\s+total|total(?:\s+price)?)[^€\d\n]{0,30}€\s*([\d,]+(?:\.\d+)?)/gi;

// Returns the first claimed booking total in `text` that doesn't match
// any known real figure. `knownFigures` is the union of every
// `totalPriceEUR` value the propose_booking response carried (grand
// total + line items) — see `collectKnownBookingPriceFigures`.
//
// Returns null if every claimed total matches something real (±€1
// slack), or if no totals are claimed at all. ±€1 absorbs cent-rounding
// differences (some places display integer euros, others 2-decimal).
// E.g., text = "Your booking reference is BKG-2023-ABCD. The total for your booking is €138.", knownFigures = [138] returns null (match). If knownFigures = [139], returns { claimed: "138", knownFigures: ["€139"] } (mismatch).
function findWrongBookingTotal(
  text: string,
  knownFigures: number[],
): { claimed: string; knownFigures: string[] } | null {
  if (knownFigures.length === 0) return null; // check (c) handles this branch

  // E.g., text = "Your booking reference is BKG-2023-ABCD. The total for your booking is €138." => claimed = [138]
  // Looks for phrases like "booking total €138", "total for your booking €138", "trip total €138", "grand total €138", etc. The regex captures the numeric part after the € symbol, allowing for commas and optional decimal points.
  const claimed = [...text.matchAll(BOOKING_TOTAL_PATTERN)].map((m) =>
    parseNumber(m[1]),
  );
  if (claimed.length === 0) return null;

  // Returns true if the claimed value `v` is within ±€1 of any known figure. This allows for minor rounding differences between what the agent claims and what the booking system reports.
  const matches = (v: number) => knownFigures.some((a) => Math.abs(a - v) <= 1);

  // E.g, claimed = [138], knownFigures = [139] => matches(138) is false, so we return { claimed: "138", knownFigures: ["€139"] }. If claimed = [138], knownFigures = [138], matches(138) is true, so we continue to the next claimed value (if any). If all claimed values match known figures, we return null.
  // E.g, claimed = [138, 200], knownFigures = [138] => matches(138) is true, so we continue to 200. matches(200) is false, so we return { claimed: "200", knownFigures: ["€138"] }.
  for (const v of claimed) {
    if (!matches(v)) {
      return {
        claimed: v.toString(),
        knownFigures: knownFigures.map((a) => `€${a}`),
      };
    }
  }

  return null;
}

// Walk every propose_booking response and collect the numeric value of
// every `totalPriceEUR` field — at any nesting depth. That gives us the
// booking's grand total AND every per-leg / per-stay line-item total in
// one flat list. Anything under a different key name is ignored (keeps
// the check focused; no false negatives from picking up unrelated
// numbers like `flight_id`).
//
// The concrete bug this fixes (Stage 22 backlog):
//
// User books a hotel in Berlin (€188.60) + round-trip ATH↔BER (€283).
// propose_booking returns:
//   {
//     reference: "BKG-2026-A9F3K2",
//     totalPriceEUR: 471.6,                         // grand total
//     flightBookings: [ { totalPriceEUR: 283   } ], // per-leg subtotal
//     hotelBookings:  [ { totalPriceEUR: 188.6 } ], // per-stay subtotal
//   }
//
// Agent replies honestly: "Hotel total: €188.60. Round-trip flight
// total: €283. Trip total: €471.60." Every number is real.
//
// The BOOKING_TOTAL_PATTERN regex matches all three phrases — including
// "Hotel total: €188.60" via its loose `total(?: price)?` branch — and
// hands the amounts to check (b). Pre-fix, the "known" set was just
// [471.6], so the €188.60 subtotal looked fabricated → guardrail
// tripped → reply blocked, even though the number came straight from
// the booking system.
//
// The fix is this walk: the known set becomes [471.6, 283, 188.6]. All
// three claims match and pass. Fabricated numbers (e.g. "Hotel total:
// €250") still miss the set and still trip — no coverage lost.
// E.g., collector = [
//   { name: 'propose_booking', args: { ... }, result: '{"reference":"BKG-2023-ABCD","totalPriceEUR":138}', parsedResult: { reference: 'BKG-2023-ABCD', totalPriceEUR: 138 } },
//   { name: 'propose_booking', args: { ... }, result: '{"reference":"BKG-2023-EFGH","totalPriceEUR":200}', parsedResult: { reference: 'BKG-2023-EFGH', totalPriceEUR: 200 } },
//   ...
// ] => returns [138, 200]
function collectKnownBookingPriceFigures(
  collector: ToolCallRecord[],
): number[] {
  const values: number[] = [];

  for (const record of collector) {
    if (record.name !== 'propose_booking') continue;
    walkForPriceFigures(record.parsedResult, values);
  }
  return values;
}

const KNOWN_PRICE_KEYS = new Set(['totalPriceEUR']);

// Recursively walks an object or array, collecting every numeric value
// under keys that are in KNOWN_PRICE_KEYS. The accumulator `acc` is
// mutated in place. Non-object values are ignored. Arrays are traversed
// recursively. Objects are traversed recursively, and if a key matches
// KNOWN_PRICE_KEYS and its value is a number, that number is pushed to
// `acc`.
// E.g., value = { totalPriceEUR: 471.6, flightBookings: [ { totalPriceEUR: 283 } ], hotelBookings: [ { totalPriceEUR: 188.6 } ] }, acc = [] => acc becomes [471.6, 283, 188.6]
// (Grand total 471.6 = flight subtotal 283 + hotel subtotal 188.6, matching the concrete-bug example above.)
function walkForPriceFigures(value: unknown, acc: number[]): void {
  if (value == null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const el of value) walkForPriceFigures(el, acc);
    return;
  }

  // value is an object. Iterate over its entries. If a key is in KNOWN_PRICE_KEYS and its value is a number, push that number to acc. Otherwise, recursively walk the value.
  // E.g., value = { totalPriceEUR: 471.6, flightBookings: [ { totalPriceEUR: 283 } ], hotelBookings: [ { totalPriceEUR: 188.6 } ] }, acc = [] => acc becomes [471.6, 283, 188.6]
  // In this particular example, the first entry is ('totalPriceEUR', 471.6), which matches KNOWN_PRICE_KEYS and is a number, so 471.6 is pushed to acc. The next entry is ('flightBookings', [ { totalPriceEUR: 283 } ]), which doesn't match KNOWN_PRICE_KEYS, so we recursively walk the array. The array has one element, { totalPriceEUR: 283 }, which is an object. Its entry ('totalPriceEUR', 283) matches KNOWN_PRICE_KEYS and is a number, so 283 is pushed to acc. The same happens for the hotelBookings entry.
  for (const [k, v] of Object.entries(value)) {
    if (KNOWN_PRICE_KEYS.has(k) && typeof v === 'number') {
      acc.push(v);
    } else {
      walkForPriceFigures(v, acc);
    }
  }
}

// Finality-adjacent phrases used ONLY for check (c) — the presence of a
// finality claim without any propose_booking anywhere. This is a
// narrower pattern than the standalone `bookingTruthfulnessOutputGuardrail`
// list because check (c) is a specific failure mode ("the agent invented
// a booking existence"), not general finality-language policing.
// This regex matches phrases like "your booking is confirmed", "the reservation has been made", "your trip has been booked", etc. It also matches "booked your flight" or "reserved your hotel" to catch cases where the agent talks about a booking without having actually called `propose_booking`. The regex is case-insensitive and allows for some variation in phrasing.
const finalityWithoutProposalPattern =
  /\b(?:your|the)\s+(?:booking|reservation|trip)\s+(?:is|has\s+been|was)\b|\b(?:booked|reserved|confirmed)\s+(?:your|the)\s+(?:flight|hotel|trip|room)\b/i;

function parseNumber(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

// Tripwire helper. Returns a tripwire result object with the given
// message, pattern name, and matched text. The `tripwireTriggered`
// property is always true for tripwire results.
// E.g, trip("The booking reference I mentioned (BKG-2023-XXXX) doesn't match any real booking I've created.", "fabricated-reference", "BKG-2023-XXXX") returns:
// {
//   tripwireTriggered: true,
//   outputInfo: {
//     message: "The booking reference I mentioned (BKG-2023-XXXX) doesn't match any real booking I've created.",
//     patternName: "fabricated-reference",
//     matchedText: "BKG-2023-XXXX"
//   }
// }
function trip(
  message: string,
  patternName: string,
  matchedText: string,
): {
  tripwireTriggered: true;
  outputInfo: { message: string; patternName: string; matchedText: string };
} {
  return {
    tripwireTriggered: true,
    outputInfo: { message, patternName, matchedText },
  };
}
