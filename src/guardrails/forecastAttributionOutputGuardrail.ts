import type { OutputGuardrail } from '@openai/agents';
import OpenAI from 'openai';
import type { AgentRunContext, ToolCallRecord } from '@/agents/agentRunContext';

// Stage 12 — semantic guardrail against forecast-attribution drift.
// The original trigger: during Stage 11 the agent presented weather for
// dates July 24-26 when `get_forecast` had only returned July 17-23. No
// existing layer caught it — booking regex/cross-reference/classifier
// only look at booking claims. This guardrail closes that gap.
//
// Structurally parallel to the Phase 4 classifier: pre-filter on
// weather-condition words → gpt-4o-mini verdict on
// { toolHistorySummary, agentReply } → BACKED | UNBACKED_FORECAST.
// Reuses the same `AgentRunContext.toolCallCollector` populated by the
// `agent_tool_end` hook on TravelAgent and WeatherAgent.
//
// Fails OPEN on:
//   - missing collector (call site didn't opt in) — logged.
//   - classifier network / quota errors — infra shouldn't block real users.

const CLASSIFIER_SYSTEM = [
  "You audit a travel/weather assistant's reply for unbacked forecast-attribution claims.",
  '',
  'DEFINITIONS',
  '- Forecast-attribution claim: language that describes weather conditions or temperature FOR A SPECIFIC DATE, DATE RANGE, or "today"/"now".',
  '  Examples: "It will be sunny on July 24", "Expect rain throughout your weekend of July 18-19", "It\'s 24°C in Berlin today", "The forecast for Fri Jul 18 shows partly cloudy skies".',
  '- Non-attribution: vague, hedged, or general talk about weather with no specific date and no "today"/"now" anchor is NOT attribution.',
  '  Examples: "The weather should be pleasant", "You might get some rain", "Not sure what the weather will be like", "Berlin summers are usually mild".',
  '- Non-attribution: PLANNING INTENT that mentions weather (e.g., "let me plan a sunny weekend", "I\'ll check the forecast", "I\'ll find you rain-free dates", "looking for warm destinations") describes the SEARCH the assistant is about to run, NOT the weather itself. Even when the user asked for a specific weather condition, the assistant echoing it back as part of its plan is NOT an attribution — it becomes attribution only when the assistant asserts the actual conditions.',
  '- Non-attribution: bare mentions of the words "weather" or "forecast" without an accompanying condition/temperature claim (e.g., "I\'ll check the weather", "the forecast for your trip") are NOT attribution.',
  '- Also non-attribution: text with no weather content at all.',
  '',
  'VERDICT (return EXACTLY one token)',
  '- BACKED             — the reply makes no forecast-attribution claim, OR every date/range referenced with weather content falls WITHIN what the tool history covered.',
  '- UNBACKED_FORECAST  — the reply makes weather claims about dates the tool history did not cover (empty history, dates outside the returned range, or a "today" claim with no get_weather call).',
  '',
  'TIE-BREAKING RULE: when uncertain, return BACKED. False positives on hedged or vague weather talk block real users; this classifier is a backstop for confident date-specific claims only.',
  '',
  'FEW-SHOT EXAMPLES',
  '',
  'Example 1 — no weather content at all → BACKED',
  '  Tool history: (no forecast tool calls)',
  '  Reply: "Here are three flights from Athens to Berlin next Friday."',
  '  Verdict: BACKED',
  '',
  'Example 2 — weather claim within covered range → BACKED',
  '  Tool history: get_forecast(Berlin) → covered 2026-07-17 to 2026-07-23 (7 days)',
  '  Reply: "The forecast for Berlin shows sunny skies on July 18 with a high of 24°C."',
  '  Verdict: BACKED',
  '',
  'Example 3 — weather claim OUTSIDE covered range → UNBACKED_FORECAST',
  '  Tool history: get_forecast(Berlin) → covered 2026-07-17 to 2026-07-23 (7 days)',
  '  Reply: "Expect sunshine on July 24 with clear skies and mild temperatures."',
  '  Verdict: UNBACKED_FORECAST',
  '',
  'Example 4 — "today" weather claim with empty tool history → UNBACKED_FORECAST',
  '  Tool history: (no forecast tool calls)',
  '  Reply: "It\'s currently raining in Berlin with a high of 16°C."',
  '  Verdict: UNBACKED_FORECAST',
  '',
  'Example 5 — vague / hedged claim with empty history → BACKED',
  '  Tool history: (no forecast tool calls)',
  '  Reply: "The weather should be nice for your weekend in Berlin."',
  '  Verdict: BACKED',
  '',
  'Example 6 — "today" claim backed by get_weather → BACKED',
  '  Tool history: get_weather(Berlin) → tempC=22, conditions=partly cloudy',
  '  Reply: "It\'s currently 22°C and partly cloudy in Berlin."',
  '  Verdict: BACKED',
  '',
  'Example 7 — partial coverage: some dates in range, others out → UNBACKED_FORECAST',
  '  Tool history: get_forecast(Berlin) → covered 2026-07-17 to 2026-07-23 (7 days)',
  '  Reply: "Expect sunshine on July 22 through 25 with mild temperatures."',
  '  Verdict: UNBACKED_FORECAST',
  '',
  'Example 8 — weather claim for a past date the forecast never covered → UNBACKED_FORECAST',
  '  Tool history: get_forecast(Berlin) → covered 2026-07-17 to 2026-07-23 (7 days)',
  '  Reply: "On July 15 it was 20°C and sunny in Berlin."',
  '  Verdict: UNBACKED_FORECAST',
  '',
  "Example 9 — planning preamble that echoes the user's condition, empty history → BACKED",
  '  Tool history: (no forecast tool calls)',
  '  Reply: "Let me plan a sunny weekend in Berlin from Athens for you. I\'ll check the forecast, search for flights and hotels, and put together a trip that fits your €600 budget."',
  '  Verdict: BACKED',
  '',
  'Example 10 — bare mention of "forecast" without a condition claim → BACKED',
  '  Tool history: (no forecast tool calls)',
  '  Reply: "I\'ll pull up the weather forecast for your dates and factor it into the trip plan."',
  '  Verdict: BACKED',
].join('\n');

// Message shown to the user when the guardrail trips. Steers them toward
// asking for a fresh forecast rather than accepting the drift.
const UNBACKED_FORECAST_MESSAGE =
  "I was about to describe the weather for dates I don't actually have a forecast for. Ask me to fetch a fresh forecast, and I'll only report what the tool returned.";

// Words that CAN carry weather content. If none appear, skip the LLM call.
// Coverage aims at concrete weather/condition vocabulary that carries
// attribution risk. Everyday adjectives like "warm" or "clear" are
// included because they routinely appear as weather descriptors in
// summaries; the classifier itself filters the false positives.
const WEATHER_INDICATOR_PATTERN =
  /\b(?:weather|forecast|temperature|temperatures|sunny|sunshine|rain|rainy|rains|showers|cloud|clouds|cloudy|overcast|clear|snow|snowy|storm|stormy|windy|humid|humidity|chilly|mild|warm|hot|cold|cool|freezing|drizzle|thunderstorm|partly\s+cloudy|degrees|°C|°F)\b/i;

// Own OpenAI client, independent of the SDK's — same pattern as the
// booking classifier and input guardrails.
const client = new OpenAI();

export const forecastAttributionOutputGuardrail: OutputGuardrail = {
  name: 'forecast_attribution_output',
  async execute({ agentOutput, context }) {
    // If the agent output isn't a string, treat it as empty. The classifier
    // is only designed to handle text; non-text output can't make a
    // forecast-attribution claim.
    // E.g., text = "Expect sunshine on July 24 with clear skies and mild temperatures." → verdict = UNBACKED_FORECAST
    const text = typeof agentOutput === 'string' ? agentOutput : '';
    if (!text) return { tripwireTriggered: false, outputInfo: null };

    // Fail open if the collector isn't threaded through. Same rationale
    // as the booking guardrails: a plumbing gap shouldn't block a legit user.
    const ctx = context.context as AgentRunContext | undefined;
    if (!ctx?.toolCallCollector) {
      console.warn(
        '[guardrail:forecast_attribution] no tool-call collector in context; skipping',
      );
      return { tripwireTriggered: false, outputInfo: { skipped: true } };
    }

    // Cheap pre-filter: no weather-indicator word → nothing to classify.
    // Prevents the classifier from ever seeing pure-booking or pure-flight
    // text it never should have judged, and cuts the model call rate on
    // most TravelAgent turns.
    if (!WEATHER_INDICATOR_PATTERN.test(text)) {
      return {
        tripwireTriggered: false,
        outputInfo: { skippedReason: 'no-weather-indicator' },
      };
    }

    // Filter the collector to weather-relevant tools, format one line per
    // call. Non-weather tools (flights, hotels, bookings) are noise for
    // this verdict.
    // E.g, if ctx.toolCallCollector contains:
    // [
    //   { name: 'get_forecast', parsedResult: { city: 'Berlin', days: [ { date: '2026-07-17' }, ... ] } },
    //   { name: 'get_weather', parsedResult: { city: 'Berlin', tempC: 22, conditions: 'partly cloudy' } },
    //   { name: 'search_flights', parsedResult: { ... } }
    // ]
    // then summary will be: 'get_forecast(Berlin) → covered 2026-07-17 to 2026-07-23 (7 days)\nget_weather(Berlin) → tempC=22, conditions=partly cloudy'
    const summary = summarizeForecastTools(ctx.toolCallCollector);

    // Two labelled blocks so the model doesn't conflate tool history and
    // agent reply. Same shape as the booking classifier's input.
    const classifierInput = [
      'TOOL HISTORY:',
      summary,
      '',
      'AGENT REPLY:',
      text,
    ].join('\n');

    // E.g, classifierInput = 'TOOL HISTORY:\nget_forecast(Berlin) → covered 2026-07-17 to 2026-07-23 (7 days)\nget_weather(Berlin) → tempC=22, conditions=partly cloudy\n\nAGENT REPLY:\nExpect sunshine on July 24 with clear skies and mild temperatures.'
    // In that case, the classifier should return UNBACKED_FORECAST because July 24 is outside the covered range of July 17-23.
    let verdict = '';
    try {
      const response = await client.responses.create({
        model: 'gpt-4o-mini',
        instructions: CLASSIFIER_SYSTEM,
        input: classifierInput,
        max_output_tokens: 16,
        temperature: 0,
      });
      verdict = response.output_text.trim().toUpperCase();
    } catch (err) {
      console.error(
        '[guardrail:forecast_attribution] classifier call failed:',
        err,
      );
      return {
        // Fail open on classifier errors. The guardrail is a backstop, not a blocker; a network or quota error shouldn't block a legit user.
        tripwireTriggered: false,
        outputInfo: { classifierError: String(err) },
      };
    }

    const isUnbacked = verdict.startsWith('UNBACKED_FORECAST');
    return {
      tripwireTriggered: isUnbacked,
      outputInfo: {
        verdict,
        patternName: isUnbacked ? 'unbacked-forecast' : undefined,
        message: isUnbacked ? UNBACKED_FORECAST_MESSAGE : undefined,
      },
    };
  },
};

// Compact one-line-per-call summary of weather-related tools. Emits:
//   get_forecast(<city>) → covered <minDate> to <maxDate> (<N> days)
//   get_weather(<city>)  → tempC=<n>, conditions=<str>
// Non-weather tools are dropped — they can't back or undermine a forecast
// claim. Multiple calls for the same city produce multiple lines; the
// classifier reasons across them.
function summarizeForecastTools(collector: ToolCallRecord[]): string {
  const weatherCalls = collector.filter(
    (r) => r.name === 'get_forecast' || r.name === 'get_weather',
  );
  if (weatherCalls.length === 0) return '(no forecast tool calls)';

  // At this point, e.g, weatherCalls might look like:
  // [
  //   {
  //     name: 'get_forecast',
  //     parsedResult: {
  //       city: 'Berlin',
  //       days: [
  //         { date: '2026-07-17' },
  //         { date: '2026-07-18' },
  //         { date: '2026-07-19' },
  //         { date: '2026-07-20' },
  //         { date: '2026-07-21' },
  //         { date: '2026-07-22' },
  //         { date: '2026-07-23' }
  //       ]
  //     }
  //   },
  //   {
  //     name: 'get_weather',
  //     parsedResult: {
  //       city: 'Berlin',
  //       tempC: 22,
  //       conditions: 'partly cloudy'
  //     }
  //   }
  // ]
  return weatherCalls
    .map((r) => {
      const parsed = r.parsedResult as
        | {
            city?: unknown;
            days?: Array<{ date?: unknown }>;
            tempC?: unknown;
            conditions?: unknown;
          }
        | undefined;

      // E.g, parsed = { city: 'Berlin', days: [ { date: '2026-07-17' }, ... ] } for get_forecast
      // or parsed = { city: 'Berlin', tempC: 22, conditions: 'partly cloudy' } for get_weather.

      // If the tool returned no city, say "unknown" — the classifier should treat that as no coverage.
      const city = typeof parsed?.city === 'string' ? parsed.city : 'unknown';

      if (r.name === 'get_forecast') {
        // Sort dates so `covered X to Y` is monotonic regardless of the
        // order the tool returned them. If the tool returned no days, say
        // so explicitly — the classifier should treat that as no coverage.
        const dates = Array.isArray(parsed?.days)
          ? parsed.days
              .map((d) => (typeof d?.date === 'string' ? d.date : null))
              .filter((d): d is string => d !== null)
              .sort()
          : [];

        // At this point, e.g., dates might look like:
        // [ '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23' ]
        if (dates.length === 0) {
          return `get_forecast(${city}) → no days returned`;
        }

        // E.g, `get_forecast(Berlin) → covered 2026-07-17 to 2026-07-23 (7 days)` returned to the classifier. The classifier should treat this as coverage for July 17-23, and any claim outside that range is unbacked.
        const first = dates[0];
        const last = dates[dates.length - 1];
        const dayWord = dates.length === 1 ? 'day' : 'days';

        return `get_forecast(${city}) → covered ${first} to ${last} (${dates.length} ${dayWord})`;
      }

      // get_weather (current conditions)
      // E.g, parsed = { city: 'Berlin', tempC: 22, conditions: 'partly cloudy' } for get_weather.
      const tempC = typeof parsed?.tempC === 'number' ? parsed.tempC : null;

      const conditions =
        typeof parsed?.conditions === 'string' ? parsed.conditions : null;

      // returns e.g., `get_weather(Berlin) → tempC=22, conditions=partly cloudy` to the classifier. The classifier should treat this as coverage for "today" in Berlin, and any claim about "today" without a get_weather call is unbacked.
      return `get_weather(${city}) → tempC=${tempC ?? 'unknown'}, conditions=${conditions ?? 'unknown'}`;
    })
    .join('\n');
}
