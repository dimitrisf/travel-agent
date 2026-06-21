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

function getCountry(city: string): string {
  const fake: Record<string, string> = {
    Athens: 'Greece',
    London: 'United Kingdom',
    Tokyo: 'Japan',
    'New York': 'United States',
  };
  const country = fake[city] ?? 'unknown';
  return JSON.stringify({ city, country });
}

const handlers: Record<string, (args: { city: string }) => string> = {
  get_weather: ({ city }) => getWeather(city),
  get_country: ({ city }) => getCountry(city),
};

const cityParam: Tool = {
  type: 'function',
  name: '',
  description: '',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      city: { type: 'string', description: 'City name, e.g. "Athens"' },
    },
    required: ['city'],
  },
};

const tools: Tool[] = [
  {
    ...cityParam,
    name: 'get_weather',
    description: 'Get current weather for a city.',
  },
  {
    ...cityParam,
    name: 'get_country',
    description: 'Get the country a city belongs to.',
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
    const handler = handlers[tc.name];
    if (!handler) throw new Error(`Unknown tool: ${tc.name}`);
    console.log(`→ ${tc.name}(${JSON.stringify(args.city)})`);
    const result = handler(args);
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
