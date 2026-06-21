import 'dotenv/config';
import OpenAI from 'openai';
import type {
  ResponseInputItem,
  Tool,
} from 'openai/resources/responses/responses';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getWeather(city: string): string {
  const fake: Record<string, { tempC: number; conditions: string }> = {
    Athens: { tempC: 32, conditions: 'sunny' },
    London: { tempC: 18, conditions: 'overcast with light rain' },
    Tokyo: { tempC: 26, conditions: 'humid, partly cloudy' },
    'New York': { tempC: 21, conditions: 'clear' },
  };
  const w = fake[city] ?? { tempC: 22, conditions: 'clear' };
  return JSON.stringify({ city, ...w, units: 'celsius' });
}

const tools: Tool[] = [
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get current weather for a city.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        city: { type: 'string', description: 'City name, e.g. "Athens"' },
      },
      required: ['city'],
    },
  },
];

const userQuestion =
  process.argv.slice(2).join(' ').trim() || 'Weather in Athens';

console.log(`User: ${userQuestion}\n`);

let response = await client.responses.create({
  model: 'gpt-4o-mini',
  input: userQuestion,
  tools,
});

while (true) {
  const toolCalls = response.output.filter((i) => i.type === 'function_call');
  if (toolCalls.length === 0) break;

  const toolOutputs: ResponseInputItem[] = toolCalls.map((tc) => {
    const args = JSON.parse(tc.arguments) as { city: string };
    console.log(`→ get_weather(${JSON.stringify(args.city)})`);
    const result = getWeather(args.city);
    console.log(`← ${result}\n`);
    return {
      type: 'function_call_output',
      call_id: tc.call_id,
      output: result,
    };
  });

  response = await client.responses.create({
    model: 'gpt-4o-mini',
    previous_response_id: response.id,
    input: toolOutputs,
    tools,
  });
}

console.log('Final answer:\n');
for (const item of response.output) {
  if (item.type === 'message') {
    for (const part of item.content) {
      if (part.type === 'output_text') console.log(part.text);
    }
  }
}

console.log(`\n[response id: ${response.id}]`);
if (response.usage) {
  console.log(
    `[tokens — in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens}, total: ${response.usage.total_tokens}]`,
  );
}
