import { Agent } from '@openai/agents';

// The triage agent. No MCPs, no tools of its own — its only capability is to
// hand off to WeatherAgent or TravelAgent via the SDK's `handoffs` array.
export function buildTriageAgent(weatherAgent: Agent, travelAgent: Agent) {
  return new Agent({
    name: 'TriageAgent',
    model: 'gpt-4o-mini',
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
