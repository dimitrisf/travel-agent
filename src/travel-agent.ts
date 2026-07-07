import 'dotenv/config';
import readline from 'node:readline/promises';
import {
  Agent,
  MCPServerStdio,
  run,
  type AgentInputItem,
} from '@openai/agents';

const mcpTravel = new MCPServerStdio({
  name: 'travel',
  fullCommand: 'tsx src/travel-mcp.ts',
});

const mcpWeather = new MCPServerStdio({
  name: 'weather',
  fullCommand: 'tsx src/weather-mcp.ts',
});

await Promise.all([mcpTravel.connect(), mcpWeather.connect()]);

const now = new Date();
now.setUTCHours(0, 0, 0, 0);
const today = now.toISOString().slice(0, 10);
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const todayWeekday = WEEKDAY_NAMES[now.getUTCDay()];

// Compute the next four Fridays (or fewer if less than 4 Fridays in the next 28 days)
// This is used to validate user input for check-in dates.
const upcomingFridays: string[] = [];
for (let offset = 0; offset < 28 && upcomingFridays.length < 4; offset++) {
  const d = new Date(now);
  d.setUTCDate(now.getUTCDate() + offset);
  if (d.getUTCDay() === 5) upcomingFridays.push(d.toISOString().slice(0, 10));
}

const agent = new Agent({
  name: 'TravelAgent',
  model: 'gpt-4o-mini',
  instructions: [
    `You are a travel planning assistant. Today is ${today} (${todayWeekday}). Upcoming Fridays: ${upcomingFridays.join(', ')}.`,
    'When the user asks for a "weekend", default to Fri check-in → Sun check-out (2 nights). If the user says "long weekend" or "3-day weekend", use Fri → Mon (3 nights). Always verify the check-in date is a Friday from the list above and the check-out is the Sunday or Monday that follows.',
    'Tools:',
    '- `search_flights(origin, destination, departure_date, ...)` returns `{ outbound: [...], inbound: [...] }` of matching flights. Requires 3-letter IATA airport codes.',
    '- `search_hotels(city, checkin, checkout, ...)` returns hotels with available rooms, sorted cheapest first.',
    '- `get_weather(city)` returns current weather for a city.',
    '- `get_forecast(city, days?)` returns a 1–7 day forecast for a city.',
    'IATA codes for cities in the demo library: Athens=ATH, Berlin=BER, London=LHR, Tokyo=HND, New York=JFK. Weather is available for the same five cities. Never guess codes for other cities; if the user names a city not in this list, tell them the library only covers those five.',
    'When the user mentions a relative date ("next Friday", "in three days"), resolve it to YYYY-MM-DD yourself based on today\'s date given above.',
    'For multi-part questions (e.g. flight + hotel within a budget, or "find a sunny weekend in Berlin"), plan the tool calls yourself and combine the results. Do arithmetic (totals, budget remaining, cheapest combination) in your head — do not ask a tool to do it.',
    'Demo data windows: forecast covers the next 7 days, flight schedules the next 14 days, hotel availability the next 21 days. Only pick check-in dates within the flight window.',
    'For a trip-planning request (any question that combines a destination and dates), you MUST call BOTH `search_flights` AND `search_hotels`. Presenting only one is an incomplete answer. If the user gave a budget, sum flights + hotels and confirm it fits.',
    'When the user cares about conditions at the destination ("sunny", "avoid rain", "warm"), call `get_forecast` for the destination city and factor the result into your recommendation. If the forecast horizon doesn\'t reach the candidate weekend, still return the best-available flights + hotels for that weekend and note that the forecast doesn\'t extend that far. If no candidate weekend in the forecast has the requested condition, pick the closest match (e.g. treat "clear" as broadly sunny) and note the compromise.',
    'Reuse prior tool results within the same conversation. Before calling a tool, check whether the answer is already derivable from earlier tool outputs in this thread. Never repeat a call with the same arguments.',
    'The demo API only supports EUR. If the user asks in another currency, state this limitation and continue in EUR.',
    'Be concise. For flights include: flight number, times, price, stops. For hotels include: name, stars, room type, avg price/night, total for the stay, one line of key amenities. For weather include: city, temperature, conditions (and dates if forecast).',
  ].join(' '),
  mcpServers: [mcpTravel, mcpWeather],
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('Travel REPL — empty line, "exit", or Ctrl+C to quit.\n');

let history: AgentInputItem[] = [];

try {
  while (true) {
    const userInput = (await rl.question('You: ')).trim();
    if (!userInput || userInput === 'exit' || userInput === 'quit') break;

    const result = await run(agent, [
      ...history,
      { role: 'user', content: userInput },
    ]);

    console.log(`\nAgent: ${result.finalOutput}\n`);
    history = result.history;
  }
} finally {
  rl.close();
  await Promise.all([mcpTravel.close(), mcpWeather.close()]);
  console.log('Bye.');
}
