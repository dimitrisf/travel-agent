import 'dotenv/config';
import readline from 'node:readline/promises';
import { Agent, run, tool, type AgentInputItem } from '@openai/agents';
import { z } from 'zod';

type Book = { isbn: string; title: string; author: string; year: number };

const bookDb: Record<string, Book[]> = {
  'russian revolution': [
    {
      isbn: '9780670859962',
      title: 'A People’s Tragedy: The Russian Revolution 1891–1924',
      author: 'Orlando Figes',
      year: 1996,
    },
    {
      isbn: '9780199237678',
      title: 'The Russian Revolution',
      author: 'Sheila Fitzpatrick',
      year: 2008,
    },
    {
      isbn: '9780140182934',
      title: 'Ten Days That Shook the World',
      author: 'John Reed',
      year: 1919,
    },
  ],
  'french revolution': [
    {
      isbn: '9780679726104',
      title: 'Citizens',
      author: 'Simon Schama',
      year: 1989,
    },
    {
      isbn: '9780198608660',
      title: 'The Oxford History of the French Revolution',
      author: 'William Doyle',
      year: 1989,
    },
  ],
  recursion: [
    {
      isbn: '9780262510875',
      title: 'Structure and Interpretation of Computer Programs',
      author: 'Abelson & Sussman',
      year: 1985,
    },
    {
      isbn: '9780262560993',
      title: 'The Little Schemer',
      author: 'Friedman & Felleisen',
      year: 1995,
    },
  ],
};

type StockEntry = { price: number; copies: number };

const stores: Record<string, Record<string, StockEntry>> = {
  Bookworm: {
    '9780670859962': { price: 25.99, copies: 3 },
    '9780199237678': { price: 14.99, copies: 5 },
    '9780679726104': { price: 22.0, copies: 2 },
  },
  'Athens Reads': {
    '9780670859962': { price: 28.5, copies: 1 },
    '9780140182934': { price: 9.5, copies: 4 },
  },
  'Old Pages': {
    '9780199237678': { price: 12.0, copies: 2 },
    '9780140182934': { price: 8.0, copies: 7 },
  },
  'Tech Annex': {
    '9780262510875': { price: 45.0, copies: 6 },
    '9780262560993': { price: 18.0, copies: 3 },
  },
};

const searchBooks = tool({
  name: 'search_books',
  description:
    'Search a small library for books related to a topic. Returns a JSON array of {title, author, year}.',
  parameters: z.object({
    topic: z
      .string()
      .describe('The topic to search for, e.g. "Russian Revolution"'),
  }),
  execute: async ({ topic }) => {
    const key = topic.toLowerCase().trim();
    const hits =
      bookDb[key] ??
      Object.entries(bookDb)
        .filter(([k]) => k.includes(key) || key.includes(k))
        .flatMap(([, v]) => v);
    console.log(
      `  → search_books(${JSON.stringify(topic)}) — ${hits.length} hits`,
    );
    return JSON.stringify(hits);
  },
});

const searchBookstores = tool({
  name: 'search_bookstores',
  description:
    'Look up which bookstores stock a given ISBN. Returns a JSON array of {store, price, copies}. Use the ISBN returned by `search_books`.',
  parameters: z.object({
    isbn: z.string().describe('The ISBN-13 of the book to look up.'),
  }),
  execute: async ({ isbn }) => {
    const hits = Object.entries(stores)
      .filter(([, inv]) => isbn in inv)
      .map(([store, inv]) => ({ store, ...inv[isbn] }));
    console.log(
      `  → search_bookstores(${JSON.stringify(isbn)}) — ${hits.length} hits`,
    );
    return JSON.stringify(hits);
  },
});

// Old version:
// instructions: [
// 'You are a research assistant that helps users find books and check store availability.',
// 'Use `search_books` to discover titles by topic. Each book it returns includes an ISBN — remember those ISBNs for follow-up questions.',
// 'Use `search_bookstores` to check which stores carry a specific book; it takes an ISBN, not a title.',
// 'When the user asks about availability of books that appeared earlier in the conversation, issue one `search_bookstores` call per ISBN (you may call multiple times in parallel).',
// 'Cite each book as "Title — Author (Year)". When reporting stores, include store name, price, and copies.',
// 'Be concise.'
// ]
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
  tools: [searchBooks, searchBookstores],
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('Research REPL — empty line, "exit", or Ctrl+C to quit.\n');

let history: AgentInputItem[] = [];

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

rl.close();
console.log('Bye.');
