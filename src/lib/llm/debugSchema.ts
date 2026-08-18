import { fileURLToPath } from 'node:url';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { buildFlightGenerationResponseSchema } from './flightGenerationSchema';
import { HotelGenerationResponseSchema } from './hotelGenerationSchema';

// Stage 23 dev-only utility. Prints the JSON Schema OpenAI actually
// receives, given our Zod schemas. Useful when debugging structured-
// output validation errors — the JSON Schema is what OpenAI enforces
// via constrained decoding, not our Zod definitions directly. The
// zodTextFormat helper wraps our Zod in an envelope like
//   { type: 'json_schema', name, strict, schema }
// which the Responses API accepts directly as text.format. We extract
// the inner `schema` field to see the actual constraints OpenAI
// applies during generation.
//
// Not imported anywhere in production code. Runnable directly:
//   npm run llm:schema
// which resolves to `tsx src/lib/llm/debugSchema.ts` and prints the
// full JSON Schema for both flight and hotel generation to stdout.

// Convert a Zod schema to the JSON Schema string OpenAI actually sees.
// Extracted so tests can lock in the pattern without executing the
// print block below. Uses zodTextFormat (Responses API) rather than
// zodResponseFormat (Chat Completions) — the two return slightly
// different envelope shapes.
export function schemaToJson<T extends z.ZodType>(
  schema: T,
  name: string,
): string {
  const format = zodTextFormat(schema, name);
  // zodTextFormat returns { type, name, strict, schema } (flatter
  // than zodResponseFormat's { type, json_schema: { name, strict,
  // schema } } envelope). The inner `schema` field is what OpenAI's
  // constrained decoding actually enforces during generation.
  return JSON.stringify(format.schema, null, 2);
}

// ESM-style entry-point detection. The condition is true only when
// this file is invoked directly (via `npm run llm:schema`), not when
// imported from a test. process.argv[1] is the absolute path of the
// executed script; import.meta.url is our own module URL — comparing
// them tells us whether we're the entry.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Sample airline list — matches what a repository call would pass
  // in production. Only affects the flight schema's airlineIata enum.
  const sampleAirlines = ['LH', 'BA', 'A3', 'TK', 'KL'];

  console.log('=== flight_generation JSON Schema ===');
  console.log(
    schemaToJson(
      buildFlightGenerationResponseSchema(sampleAirlines),
      'flight_generation',
    ),
  );
  console.log();
  console.log('=== hotel_generation JSON Schema ===');
  console.log(schemaToJson(HotelGenerationResponseSchema, 'hotel_generation'));
}
