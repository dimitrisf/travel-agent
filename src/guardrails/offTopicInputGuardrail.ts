import type { InputGuardrail } from '@openai/agents';
import OpenAI from 'openai';
import { CITY_NAMES } from '@/lib/cities';
import { extractLatestUserText } from '@/utils/extractLatestUserText';

// Input guardrail that short-circuits off-topic user messages before the
// (expensive) triage/handoff/tool loop begins. Uses gpt-4o-mini as a
// zero-shot topic classifier: ~1 model call per user turn, a few hundred ms,
// a few dozen tokens.
//
// Runs on the TriageAgent only. Per the Agents SDK contract (run.js line ~114
// — "only the first agent's input guardrails are run") the entry agent is the
// only one whose input guardrails fire, so this is where it belongs.

const CLASSIFIER_SYSTEM = [
  'You are a topic classifier for a travel-and-weather assistant.',
  'The assistant helps with: flight search, hotel search, trip planning, bookings (propose/confirm/cancel), weather, and forecasts.',
  'Classify the LATEST user message. Reply with EXACTLY one token:',
  '- "ON_TOPIC" if the message is about travel, flights, hotels, bookings, weather, forecasts, or a plausible follow-up in an ongoing travel conversation.',
  '- "OFF_TOPIC" if the message is clearly about something else (code, jokes, general knowledge, personal advice, etc.).',
  'Ambiguous short follow-ups ("yes", "the second one", "book it", "when is that") are ON_TOPIC — the user is likely referring to earlier travel context.',
].join(' ');

const OFF_TOPIC_MESSAGE = `I only handle travel planning, bookings, and weather questions. Ask me about flights, hotels, trips, or the forecast for one of the demo cities (${CITY_NAMES.join(', ')}).`;

// The Agents SDK instantiates its own OpenAI client internally; we spin up
// our own here so the classifier call is independent of the main agent run.
// Reuses the OPENAI_API_KEY from the environment, same as the SDK.
const client = new OpenAI();

export const offTopicInputGuardrail: InputGuardrail = {
  name: 'off_topic',
  // E.g., input: "What's the weather in Berlin next week?", or (more commonly) an array of ModelItemLike objects representing the conversation history, e.g., [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi there!' }]. The guardrail extracts the latest user message and classifies it.
  async execute({ input }) {
    const userText = extractLatestUserText(input);
    // if the userText is empty, there's nothing to classify — pass through. (Shouldn't happen in normal flow;
    // route handler already validated userInput is a non-empty string.)
    if (!userText) return { tripwireTriggered: false, outputInfo: null };

    let verdict = '';
    try {
      const response = await client.responses.create({
        model: 'gpt-4o-mini',
        instructions: CLASSIFIER_SYSTEM,
        input: userText,
        max_output_tokens: 16,
        // Low temperature for deterministic classification; we want the same input to always yield the same verdict.
        temperature: 0,
      });

      // The SDK's Responses API returns a structured object; the text output is in response.output_text. Trim whitespace and normalize to uppercase for consistent comparison.
      verdict = response.output_text.trim().toUpperCase();
    } catch (err) {
      // If the classifier call itself fails (network, quota), fail OPEN —
      // let the request through rather than blocking a legit user on
      // guardrail infrastructure trouble. Log for visibility.
      console.error('[guardrail:off_topic] classifier call failed:', err);
      return {
        tripwireTriggered: false,
        outputInfo: { classifierError: String(err) },
      };
    }

    // If the classifier verdict is OFF_TOPIC, tripwire is triggered; otherwise, pass through. The outputInfo includes the verdict and the userText for logging/debugging.
    const isOffTopic = verdict.startsWith('OFF_TOPIC');
    return {
      tripwireTriggered: isOffTopic,
      outputInfo: {
        verdict,
        userText,
        // Consumed by app/api/agent/route.ts's error handler (Phase 5 will
        // surface this cleanly in the UI; for now it appears in the error
        // frame).
        message: isOffTopic ? OFF_TOPIC_MESSAGE : undefined,
      },
    };
  },
};
