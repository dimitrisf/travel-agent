import 'dotenv/config';
import OpenAI from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const Book = z.object({
  title: z.string(),
  author: z.string(),
  year: z.number().int(),
});

const BookList = z.object({
  books: z.array(Book),
});

const response = await client.responses.parse({
  model: 'gpt-4o-mini',
  input: 'Recommend three books on the Russian Revolution.',
  text: {
    format: zodTextFormat(BookList, 'book_list'),
  },
});

const parsed = response.output_parsed;
if (!parsed) {
  console.error('No parsed output received.');
  process.exit(1);
}

console.log('Recommended books:\n');
for (const book of parsed.books) {
  console.log(`- ${book.title} — ${book.author} (${book.year})`);
}

console.log('\nRaw JSON:');
console.log(JSON.stringify(parsed, null, 2));

console.log(`\n[response id: ${response.id}]`);
if (response.usage) {
  console.log(
    `[tokens — in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens}, total: ${response.usage.total_tokens}]`,
  );
}
