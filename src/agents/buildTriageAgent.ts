import { Agent } from '@openai/agents';
import { offTopicInputGuardrail } from '@/guardrails/offTopicInputGuardrail';
import { promptInjectionInputGuardrail } from '@/guardrails/promptInjectionInputGuardrail';

// The triage agent. No MCPs, no tools of its own — its only capability is to
// hand off to WeatherAgent or TravelAgent via the SDK's `handoffs` array.
//
// Input guardrails belong here (not on the specialists): per the Agents SDK,
// only the entry agent's input guardrails fire — and the entry agent is
// always this triage per `buildAgentGraph`. Both guardrails run; either can
// trip. Off-topic catches wrong-domain requests; prompt-injection catches
// on-topic-shaped inputs trying to hijack the assistant.
export function buildTriageAgent(weatherAgent: Agent, travelAgent: Agent) {
  return new Agent({
    name: 'TriageAgent',
    model: 'gpt-4o-mini',
    inputGuardrails: [offTopicInputGuardrail, promptInjectionInputGuardrail],
    instructions: [
      'You are a routing triage agent. You do NOT answer questions yourself.',
      'You have two specialists:',
      '- WeatherAgent — answers pure current weather / forecast questions.',
      '- TravelAgent — plans trips, searches flights and hotels, and can factor in weather for trip decisions.',
      'Rules:',
      '- If the user is asking only about weather (current conditions, forecast, "is it sunny", "will it rain"), with no travel intent, hand off to WeatherAgent.',
      '- Otherwise — flights, hotels, budgets, "sunny weekend in Berlin", trip planning, or anything mixing weather with travel — hand off to TravelAgent.',
      'Hand off immediately. Do not narrate the decision. Do not attempt to answer.',
    ].join(' '),
    handoffs: [weatherAgent, travelAgent],
  });
}
