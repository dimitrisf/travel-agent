import { describe, it, expect } from 'vitest';
import { schemaToJson } from './debugSchema';
import { buildFlightGenerationResponseSchema } from './flightGenerationSchema';
import { HotelGenerationResponseSchema } from './hotelGenerationSchema';

// Tests for the dev-only debugSchema helper. Verifies the JSON Schema
// output shape without requiring OpenAI or a runnable-script setup.

describe('schemaToJson', () => {
  it('produces a valid JSON string for the flight schema', () => {
    const json = schemaToJson(
      buildFlightGenerationResponseSchema(['LH', 'BA']),
      'flight_generation',
    );
    // Should parse cleanly — no leading garbage, valid escaping, etc.
    const parsed = JSON.parse(json) as {
      type?: string;
      properties?: { flights?: unknown };
    };
    expect(parsed.type).toBe('object');
    expect(parsed.properties?.flights).toBeDefined();
  });

  it('inlines the allowed-airline enum in the flight schema', () => {
    const json = schemaToJson(
      buildFlightGenerationResponseSchema(['LH', 'A3']),
      'flight_generation',
    );
    // The enum values become part of the constraint OpenAI enforces.
    // If they're not in the printed JSON, structured outputs would
    // let the LLM produce any string — silent regression risk.
    expect(json).toContain('"LH"');
    expect(json).toContain('"A3"');
    expect(json).toContain('"enum"');
  });

  it('produces a valid JSON string for the hotel schema', () => {
    const json = schemaToJson(HotelGenerationResponseSchema, 'hotel_generation');
    const parsed = JSON.parse(json) as {
      type?: string;
      properties?: { hotels?: unknown };
    };
    expect(parsed.type).toBe('object');
    expect(parsed.properties?.hotels).toBeDefined();
  });
});
