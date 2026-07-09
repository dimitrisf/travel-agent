import 'dotenv/config';
import readline from 'node:readline/promises';
import {
  Agent,
  MCPServerStdio,
  run,
  type AgentInputItem,
} from '@openai/agents';

//
// Who is the MCP client?
//
// It's hidden inside MCPServerStdio. In our current setup it's the mcpWeather instance.
// MCPServerStdio is the misleadingly-named class from @openai/agents that internally manages the MCP client. More specifically:
// 1. Spawns tsx src/mcp-servers/weather-mcp.ts as a child process.
// 2. Wraps a Client + StdioClientTransport from @modelcontextprotocol/sdk around its stdin/stdout.
// 3. On connect(), calls tools/list to discover get_weather and get_forecast.
// 4. When the agent decides to call one, sends tools/call over the same channel.
// So the full chain is: Agent → MCPServerStdio → Client → StdioClientTransport → MCP server (weather-mcp.ts) → REST API (weather-api.ts).
// or in other words:
// weather-agent.ts ── MCPServerStdio (MCP client) ──stdio──▶ weather-mcp.ts (MCP
//                        │
//                        └ wraps @modelcontextprotocol/sdk's Client
// server) ──HTTP──▶ weather-api.ts
// Bottom line, the MCP client is hidden inside MCPServerStdio, which is why we don't see it in this file.
const mcpWeather = new MCPServerStdio({
  // ← MCP client lives in here
  name: 'weather',
  fullCommand: 'tsx src/mcp-servers/weather-mcp.ts',
});

await mcpWeather.connect();

const agent = new Agent({
  name: 'WeatherAgent',
  model: 'gpt-4o-mini',
  instructions: [
    'You answer weather questions for the user.',
    'Tools:',
    '- `get_weather(city)` for current conditions.',
    '- `get_forecast(city, days?)` for a 1–7 day forecast.',
    'Reuse prior tool results within the same conversation. Never repeat a call with the same arguments.',
    'Be concise. Always state the city you queried.',
  ].join(' '),
  mcpServers: [mcpWeather],
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('Weather REPL — empty line, "exit", or Ctrl+C to quit.\n');

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
  await mcpWeather.close();
  console.log('Bye.');
}
