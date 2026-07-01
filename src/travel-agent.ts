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

await mcpTravel.connect();

const today = new Date().toISOString().slice(0, 10);

const agent = new Agent({
  name: 'TravelAgent',
  model: 'gpt-4o-mini',
  instructions: [
    `You are a travel planning assistant. Today's date is ${today}.`,
    'Tools:',
    '- `search_flights(origin, destination, departure_date, ...)` returns `{ outbound: [...], inbound: [...] }` of matching flights. Requires 3-letter IATA airport codes.',
    '- `search_hotels(city, checkin, checkout, ...)` returns hotels with available rooms, sorted cheapest first.',
    'IATA codes for cities in the demo library: Athens=ATH, Berlin=BER, London=LHR, Tokyo=HND, New York=JFK. Never guess codes for other cities; if the user names a city not in this list, tell them the library only covers those five.',
    'When the user mentions a relative date ("next Friday", "in three days"), resolve it to YYYY-MM-DD yourself based on today\'s date given above.',
    'For multi-part questions (e.g. flight + hotel within a budget), plan the tool calls yourself and combine the results. Do arithmetic (totals, budget remaining, cheapest combination) in your head — do not ask a tool to do it.',
    'Reuse prior tool results within the same conversation. Before calling a tool, check whether the answer is already derivable from earlier tool outputs in this thread. Never repeat a call with the same arguments.',
    'The demo API only supports EUR. If the user asks in another currency, state this limitation and continue in EUR.',
    'Be concise. For flights include: flight number, times, price, stops. For hotels include: name, stars, room type, avg price/night, total for the stay, one line of key amenities.',
  ].join(' '),
  mcpServers: [mcpTravel],
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
  await mcpTravel.close();
  console.log('Bye.');
}
