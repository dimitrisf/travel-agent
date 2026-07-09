import 'dotenv/config';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const question = process.argv.slice(2).join(' ').trim() || 'What is recursion?';

console.log(`Q: ${question}\n`);
console.log('A: ');

const stream = await client.responses.create({
  model: 'gpt-4o-mini',
  input: question,
  stream: true,
});

let responseId = '';
let usage:
  | { input_tokens: number; output_tokens: number; total_tokens: number }
  | undefined;

for await (const event of stream) {
  if (event.type === 'response.output_text.delta') {
    process.stdout.write(event.delta);
  } else if (event.type === 'response.completed') {
    responseId = event.response.id;
    const u = event.response.usage;
    if (u) {
      usage = {
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        total_tokens: u.total_tokens,
      };
    }
  }
}

console.log('\n');
console.log(`Response ID: ${responseId}`);
if (usage) {
  console.log(
    `Tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}, total: ${usage.total_tokens}`,
  );
}
