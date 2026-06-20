import 'dotenv/config';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log('=== 1) Plain text response ===\n');
const r1 = await client.responses.create({
  model: 'gpt-4o-mini',
  input: 'Say hello in one short sentence.',
});
console.log(JSON.stringify(r1, null, 2));

console.log('\n=== 2) Function-tool response ===\n');
const r2 = await client.responses.create({
  model: 'gpt-4o-mini',
  input: 'What is the weather in Athens right now?',
  tools: [
    {
      type: 'function',
      name: 'get_weather',
      description: 'Get current weather for a city',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    },
  ],
});
console.log(JSON.stringify(r2, null, 2));
