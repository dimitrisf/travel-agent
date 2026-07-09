import 'dotenv/config';
import readline from 'node:readline/promises';
import {
  Agent,
  MCPServerStdio,
  run,
  type AgentInputItem,
} from '@openai/agents';

const mcpLibrary = new MCPServerStdio({
  name: 'library',
  fullCommand: 'tsx src/mcp-server.ts',
});

await mcpLibrary.connect();

const researchAgent = new Agent({
  name: 'ResearchAgent',
  model: 'gpt-4o-mini',
  instructions: [
    'You are a research assistant that helps users find books and check store availability.',
    'Tools:',
    '- `search_books(topic)` returns books with ISBN, title, author, year.',
    '- `search_bookstores(isbn)` returns the stores stocking that ISBN, with price and copies.',
    'Reuse prior tool results within the same conversation. Before calling a tool, check whether the answer is already derivable from earlier tool outputs in this thread — if so, reason from that data instead of calling the tool again. Never repeat a call with the same arguments.',
    'Only call `search_books` when the user introduces a new topic.',
    'Only call `search_bookstores` for an ISBN you have not already looked up in this conversation.',
    'Cite each book as "Title — Author (Year)". When reporting stores, include store name, price, and copies.',
    'Be concise.',
  ].join(' '),
  mcpServers: [mcpLibrary],
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('Research REPL — empty line, "exit", or Ctrl+C to quit.\n');

let history: AgentInputItem[] = [];

try {
  while (true) {
    const userInput = (await rl.question('You: ')).trim();
    if (!userInput || userInput === 'exit' || userInput === 'quit') break;

    const result = await run(researchAgent, [
      ...history,
      { role: 'user', content: userInput },
    ]);

    console.log(`\nAgent: ${result.finalOutput}\n`);
    history = result.history;
  }
} finally {
  rl.close();
  await mcpLibrary.close();
  console.log('Bye.');
}
