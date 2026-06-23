import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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

const server = new McpServer({
  name: 'library',
  version: '1.0.0',
});

server.registerTool(
  'search_books',
  {
    title: 'Search Books',
    description:
      'Search a small library for books related to a topic. Returns a JSON array of {isbn, title, author, year}.',
    inputSchema: {
      topic: z
        .string()
        .describe('The topic to search for, e.g. "Russian Revolution".'),
    },
  },
  async ({ topic }) => {
    const key = topic.toLowerCase().trim();
    const hits =
      bookDb[key] ??
      Object.entries(bookDb)
        .filter(([k]) => k.includes(key) || key.includes(k))
        .flatMap(([, v]) => v);
    return {
      content: [{ type: 'text', text: JSON.stringify(hits) }],
    };
  },
);

server.registerTool(
  'search_bookstores',
  {
    title: 'Search Bookstores',
    description:
      'Look up which bookstores stock a given ISBN. Returns a JSON array of {store, price, copies}.',
    inputSchema: {
      isbn: z.string().describe('The ISBN-13 of the book to look up.'),
    },
  },
  async ({ isbn }) => {
    const hits = Object.entries(stores)
      .filter(([, inv]) => isbn in inv)
      .map(([store, inv]) => ({ store, ...inv[isbn] }));
    return {
      content: [{ type: 'text', text: JSON.stringify(hits) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[library MCP] server running on stdio');
