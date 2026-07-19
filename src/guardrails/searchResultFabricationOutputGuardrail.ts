import type { OutputGuardrail } from '@openai/agents';
import type { AgentRunContext, ToolCallRecord } from '@/agents/agentRunContext';

// Stage 13 — deterministic guardrail against fabricated search results.
// Complements the three booking guardrails (Stage 11) and the forecast
// classifier (Stage 12) with a fifth output-side check on `TravelAgent`.
//
// Failure mode caught: agent quotes a specific flight number or hotel
// name that no `search_flights` / `search_hotels` result ever returned
// during the conversation. Same shape as `bookingCrossReferenceOutputGuardrail`'s
// check (a) — extract candidate tokens from the reply, verify each
// against the collector's tool outputs, trip on the first miss.
//
// Deterministic on purpose. Search results are structured data — flight
// numbers match a tight regex, hotel names appear as bolded proper
// nouns in bullet lists — and Stage 12's classifier iteration showed
// how expensive prompt tuning gets when a domain doesn't need it.
// No LLM call; comparison is substring match against normalized tool
// blob text.
//
// Fails OPEN if the collector isn't threaded through (same policy as
// the other collector-reading guardrails). No classifier-error branch
// because there's no LLM to fail.
export const searchResultFabricationOutputGuardrail: OutputGuardrail = {
  name: 'search_result_fabrication_output',
  async execute({ agentOutput, context }) {
    const text = typeof agentOutput === 'string' ? agentOutput : '';
    if (!text) return { tripwireTriggered: false, outputInfo: null };

    // E.g., text = "Here are your flight options:\n**Outbound:** Aegean A3 824, €138.\n**Return:** LH 1753, €149.\nAlternative outbound: British Airways BA1234, €160."

    const ctx = context.context as AgentRunContext | undefined;
    if (!ctx?.toolCallCollector) {
      console.warn(
        '[guardrail:search_result_fabrication] no tool-call collector in context; skipping',
      );
      return { tripwireTriggered: false, outputInfo: { skipped: true } };
    }

    // Concatenate raw tool result strings per tool. Substring match against
    // the raw JSON is enough because the fields we care about (flight
    // numbers, hotel names) appear literally in the payload — no need to
    // parse. Weather / booking tools are dropped (out of scope).
    // E.g, flightBlob = '{"flights":[{"flight":"A3 824"}, {"flight":"LH 1753"}]}\n{"flights":[{"flight":"BA999"}]}'
    const flightBlob = collectBlob(ctx.toolCallCollector, 'search_flights');

    // E.g, hotelBlob = '{"hotels":[{"hotel":"City Budget Inn"}, {"hotel":"Grand Berlin Plaza"}]}'
    const hotelBlob = collectBlob(ctx.toolCallCollector, 'search_hotels');

    // Check (a) — fabricated flight number. First match trips.
    const fabricatedFlight = findFabricatedFlightNumber(text, flightBlob);

    if (fabricatedFlight) {
      // Here, e.g., flightBlob = '{"flights":[{"flight":"A3 824"}, {"flight":"LH 1753"}]}\n{"flights":[{"flight":"BA999"}]}' and text = "Here are your flight options:\n**Outbound:** Aegean A3 824, €138.\n**Return:** LH 1753, €149.\nAlternative outbound: British Airways BA1234, €160."

      return trip(
        'fabricated-flight-number',
        fabricatedFlight,
        `I mentioned a flight number (${fabricatedFlight}) that doesn't match any flight I actually saw from search_flights. Please refer to the actual search results.`,
      );
    }

    // Check (b) — fabricated hotel name. First match trips.
    const fabricatedHotel = findFabricatedHotelName(text, hotelBlob);

    if (fabricatedHotel) {
      return trip(
        'fabricated-hotel-name',
        fabricatedHotel,
        `I mentioned a hotel (${fabricatedHotel}) that isn't in my search_hotels results. Please refer to the actual results.`,
      );
    }

    // No fabrication detected. Pass.
    return { tripwireTriggered: false, outputInfo: null };
  },
};

// Flight number pattern — IATA airline code (letter + letter-or-digit) +
// optional space + 3-4 digit flight number. Matches "A3 824" (Aegean),
// "LH 1753" (Lufthansa), "BA999" (British Airways compact). Anchored on
// word boundaries so mid-word tokens don't spuriously match.
//
// Deliberately narrow. False-positive risk zones we accept: rare
// non-airline tokens like "Q4 2026" (fiscal quarter) could match — if
// the tool blob doesn't contain them, we'd trip on a legit reply. In
// practice these don't appear in travel replies from this agent.
const FLIGHT_NUMBER_PATTERN = /\b[A-Z][A-Z0-9]\s?\d{3,4}\b/g;

// Words that make a bolded phrase look like a hotel name. Used to filter
// markdown bold candidates ("**Standard Room**", "**Total**", "**Free WiFi**"
// don't match; "**City Budget Inn**", "**Grand Berlin Plaza**",
// "**Hotel Berlin Central**" do). Deliberately generous — false positives
// here would extract too many candidates, but each candidate is then
// verified against the tool blob so a real hotel name still passes.
const HOTEL_INDICATOR_PATTERN =
  /\b(?:Hotel|Inn|Plaza|Resort|Suites?|Palace|Lodge|Manor|Villa|Guesthouse|Hostel|B&B)\b/i;

// Concatenate all `result` strings from records matching the given tool
// name. Returns an empty string if the tool was never called — callers
// treat empty blob as "every mention is fabricated".
// E.g., if collector = [{name: 'search_flights', result: '{"flights":[{"flight":"A3 824"}, {"flight":"LH 1753"}]}'}, {name: 'search_hotels', result: '{"hotels":[{"hotel":"City Budget Inn"}, {"hotel":"Grand Berlin Plaza"}]}'}],
// and toolName = 'search_flights', returns '{"flights":[{"flight":"A3 824"}, {"flight":"LH 1753"}]}'.
// If toolName = 'search_hotels', returns '{"hotels":[{"hotel":"City Budget Inn"}, {"hotel":"Grand Berlin Plaza"}]}'.
// New lines are used to separate multiple results from the same tool call (e.g., if the agent called search_flights twice, each with a different result).
// For example, if collector = [{name: 'search_flights', result: '{"flights":[{"flight":"A3 824"}]}'}, {name: 'search_flights', result: '{"flights":[{"flight":"LH 1753"}]}'}, {name: 'search_hotels', result: '{"hotels":[{"hotel":"City Budget Inn"}, {"hotel":"Grand Berlin Plaza"}]}'}],
// and toolName = 'search_flights', returns '{"flights":[{"flight":"A3 824"}]}\n{"flights":[{"flight":"LH 1753"}]}'.
function collectBlob(collector: ToolCallRecord[], toolName: string): string {
  return collector
    .filter((r) => r.name === toolName)
    .map((r) => r.result ?? '')
    .join('\n');
}

// Returns the first flight number in `text` that doesn't appear in `blob`.
// Returns null if all mentioned flight numbers appear in the blob, or if
// no flight numbers were mentioned. Comparison normalizes both sides:
// lowercase and whitespace-stripped so "A3 824" matches "a3824" and
// vice versa (agent's cosmetic reformatting shouldn't trip).
// E.g., if text = "Here are your flight options:\n**Outbound:** Aegean A3 824, €138.\n**Return:** LH 1753, €149.\nAlternative outbound: British Airways BA1234, €160."
// and blob = '{"flights":[{"flight":"A3 824"}, {"flight":"LH 1753"}]}\n{"flights":[{"flight":"BA999"}]}',
// returns "BA1234" (first candidate that doesn't match any flight in the blob).
function findFabricatedFlightNumber(text: string, blob: string): string | null {
  // E.g., mentioned = ["A3 824", "LH 1753", "BA1234"]
  const mentioned = [...text.matchAll(FLIGHT_NUMBER_PATTERN)].map((m) => m[0]);
  if (mentioned.length === 0) return null;

  // Now, blobNormalized = "a3824\nlh1753\nba999" and mentioned = ["A3 824", "LH 1753", "BA1234"]
  // The first candidate that doesn't match any normalized blob entry is "BA1234".
  const blobNormalized = normalize(blob);

  for (const candidate of mentioned) {
    if (!blobNormalized.includes(normalize(candidate))) {
      // E.g, candidate = "BA1234" and blobNormalized = "a3824\nlh1753\nba999"
      return candidate;
    }
  }
  return null;
}

// Returns the first candidate hotel name in `text` that doesn't match
// any real hotel name from the tool blob. Candidates are markdown-bolded
// phrases that contain a hotel-indicator word ("Hotel", "Inn", "Plaza", …).
//
// Matching is bidirectional: a candidate is considered legitimate if the
// candidate CONTAINS a real hotel name OR the real hotel name contains
// the candidate. This handles cases where the agent decorates the label
// ("**With City Budget Inn:**") — the decorated candidate still contains
// the real name as a substring and shouldn't trip. Fabrication requires
// the candidate to not overlap with ANY real hotel name.
// E.g, if text = "Here are your hotel options:\n**City Budget Inn:** $120/night.\n**Grand Berlin Plaza:** $200/night.\n**Hotel Berlin Central:** $150/night.\nAlternative: **Berlin Budget Hotel:** $100/night."
// and blob = '{"hotels":[{"hotel":"City Budget Inn"}, {"hotel":"Grand Berlin Plaza"}]}',
// returns "Hotel Berlin Central" (first candidate that doesn't match any real hotel name).
function findFabricatedHotelName(text: string, blob: string): string | null {
  const mentioned = extractCandidateHotelNames(text);
  if (mentioned.length === 0) return null;

  // Here mentioned = ["City Budget Inn", "Grand Berlin Plaza", "Hotel Berlin Central", "Berlin Budget Hotel"]
  // and realNames = ["City Budget Inn", "Grand Berlin Plaza"]
  const realNames = extractRealHotelNames(blob).map(normalize);

  // Empty tool blob (search_hotels was never called) — every candidate
  // is fabricated by definition. Return the first one.
  if (realNames.length === 0) return mentioned[0];

  for (const candidate of mentioned) {
    const normalizedCandidate = normalize(candidate);

    // E.g, if normalizedCandidate = "hotel berlin central" and realNames = ["city budget inn", "grand berlin plaza"], then overlapsReal = false and we return "Hotel Berlin Central".
    const overlapsReal = realNames.some(
      (real) =>
        normalizedCandidate.includes(real) ||
        real.includes(normalizedCandidate),
    );
    if (!overlapsReal) return candidate;
  }

  // All candidates matched at least one real hotel name. No fabrication.
  return null;
}

// Extract real hotel names from the raw search_hotels blob. The blob is
// JSON with `"hotel":"…"` fields; a light regex is enough because we
// don't need the full parse — just the name string values.
// E.g, if blob = '{"hotels":[{"hotel":"City Budget Inn"}, {"hotel":"Grand Berlin Plaza"}]}',
// returns ["City Budget Inn", "Grand Berlin Plaza"].
function extractRealHotelNames(blob: string): string[] {
  return [...blob.matchAll(/"hotel"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
}

// Extract markdown-bold phrases that look like hotel names. Filters out
// bold uses that aren't hotels by requiring THREE signals:
//   (i)   contains a hotel-indicator word ("Hotel", "Inn", "Plaza", …)
//   (ii)  has at least 2 word tokens after stripping non-word characters
//   (iii) does not end in ":" (section labels like "**Hotel Total:**",
//         "**Hotel Options:**" match (i) and (ii) but are labels, not
//         hotel names — real hotel names in this agent's output are
//         never presented as trailing-colon labels)
// Real names in the demo data have 3+ words ("City Budget Inn", "Hotel
// Berlin Central", "Grand Berlin Plaza") and never end in a colon.
// E.g, if text = "Here are your hotel options:\n**City Budget Inn:** $120/night.\n**Grand Berlin Plaza:** $200/night.\n**Hotel Berlin Central:** $150/night.\nAlternative: **Berlin Budget Hotel:** $100/night.",
// returns ["City Budget Inn", "Grand Berlin Plaza", "Hotel Berlin Central", "Berlin Budget Hotel"].
function extractCandidateHotelNames(text: string): string[] {
  // Mathcing "**City Budget Inn:**" and "**Grand Berlin Plaza:**" and "**Hotel Berlin Central:**" and "**Berlin Budget Hotel:**" but not "**Total**" or "**Free WiFi**".
  const bolded = [...text.matchAll(/\*\*([^*\n]+?)\*\*/g)].map((m) =>
    m[1].trim(),
  );

  return bolded.filter((name) => {
    // If it doesn't contain a hotel-indicator word, it's not a candidate. E.,g "**Total**" or "**Free WiFi**" match the bold regex but aren't hotel names.
    if (!HOTEL_INDICATOR_PATTERN.test(name)) return false;

    if (name.endsWith(':')) return false;

    // Here we require at least 2 word tokens to avoid false positives like "**Total**" or "**Free WiFi**" that match the hotel-indicator pattern but aren't real hotel names. Real hotel names in the demo data have 3+ words.
    const wordCount = name
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    return wordCount >= 2;
  });
}

// Case-insensitive whitespace-stripped normalization. Used for both
// blob and candidate so cosmetic reformatting doesn't cause spurious
// fabrication trips.
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

// Tripwire helper. Returns a tripwire result object with the given
// pattern name, matched text, and user-facing message. Same shape as
// the other cross-reference guardrail's `trip()` for consistency.
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
