import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { LlmFlightSource } from './LlmFlightSource';
import type { FlightGenerationInput } from './flightGenerationSchema';

// Unit tests for LlmFlightSource. The OpenAI client is injected via
// constructor so we can substitute a mock — no real API calls fire.
// Tests exercise the three outcome branches (happy path, null
// output_parsed for any reason, thrown error) plus prompt-threading
// and default-model verification.

const VALID_INPUT: FlightGenerationInput = {
  originAirport: { iataCode: 'ATH', cityName: 'Athens' },
  destinationAirport: { iataCode: 'BER', cityName: 'Berlin' },
  departureDate: '2026-08-20',
  allowedAirlines: [
    { iataCode: 'LH', name: 'Lufthansa' },
    { iataCode: 'A3', name: 'Aegean Airlines' },
  ],
};

const VALID_PARSED_RESPONSE = {
  flights: [
    {
      airlineIata: 'LH',
      flightNumber: '1234',
      departureTimeHHMM: '08:00',
      durationMinutes: 175,
      basePriceEUR: 187.5,
      stops: 0,
      aircraft: 'A320',
      seatsAvailable: 42,
    },
    {
      airlineIata: 'A3',
      flightNumber: '824',
      departureTimeHHMM: '13:40',
      durationMinutes: 180,
      basePriceEUR: 156,
      stops: 0,
      aircraft: 'A321',
      seatsAvailable: 78,
    },
    {
      airlineIata: 'LH',
      flightNumber: '2211',
      departureTimeHHMM: '19:15',
      durationMinutes: 190,
      basePriceEUR: 214,
      stops: 1,
      aircraft: null,
      seatsAvailable: 12,
    },
  ],
};

// Build a mock OpenAI client with just the surface LlmFlightSource
// actually uses (client.responses.parse). Cast through unknown so
// TypeScript accepts the shape-partial mock as an OpenAI instance.
function makeMockClient() {
  const parse = vi.fn();
  const client = { responses: { parse } } as unknown as OpenAI;
  return { client, parse };
}

describe('LlmFlightSource', () => {
  beforeEach(() => {
    // Suppress log noise from the source class during tests.
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns parsed flights on the happy path', async () => {
    const { client, parse } = makeMockClient();
    parse.mockResolvedValueOnce({ output_parsed: VALID_PARSED_RESPONSE });
    const source = new LlmFlightSource({ client });

    const result = await source.generateFlightsForRoute(VALID_INPUT);

    expect(result).not.toBeNull();
    expect(result?.flights).toHaveLength(3);
    expect(result?.flights[0].airlineIata).toBe('LH');
    expect(result?.flights[1].flightNumber).toBe('824');
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('passes the correct model + prompt to the client', async () => {
    const { client, parse } = makeMockClient();
    parse.mockResolvedValueOnce({ output_parsed: VALID_PARSED_RESPONSE });
    const source = new LlmFlightSource({ client, model: 'gpt-5.6' });

    await source.generateFlightsForRoute(VALID_INPUT);

    const callArgs = parse.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-5.6');
    // system + user messages via Responses API's `input` field
    expect(callArgs.input).toHaveLength(2);
    expect(callArgs.input[0].role).toBe('system');
    expect(callArgs.input[1].role).toBe('user');
    // User prompt carries route context and airline list.
    const userContent = callArgs.input[1].content as string;
    expect(userContent).toContain('ATH');
    expect(userContent).toContain('BER');
    expect(userContent).toContain('2026-08-20');
    expect(userContent).toContain('LH (Lufthansa)');
    expect(userContent).toContain('A3 (Aegean Airlines)');
    // Schema is passed via text.format (Responses API shape) — not
    // response_format (that'd be Chat Completions).
    expect(callArgs.text?.format).toBeDefined();
  });

  it('returns null when output_parsed is null (refusal / length cutoff / validation)', async () => {
    const { client, parse } = makeMockClient();
    parse.mockResolvedValueOnce({ output_parsed: null });
    const source = new LlmFlightSource({ client });

    const result = await source.generateFlightsForRoute(VALID_INPUT);

    expect(result).toBeNull();
  });

  it('returns null when parse throws (network / rate limit / SDK error)', async () => {
    const { client, parse } = makeMockClient();
    parse.mockRejectedValueOnce(new Error('Request failed with status 429'));
    const source = new LlmFlightSource({ client });

    const result = await source.generateFlightsForRoute(VALID_INPUT);

    expect(result).toBeNull();
  });

  it('defaults to gpt-4o-mini when no model is provided', async () => {
    const { client, parse } = makeMockClient();
    parse.mockResolvedValueOnce({ output_parsed: VALID_PARSED_RESPONSE });
    const source = new LlmFlightSource({ client });

    await source.generateFlightsForRoute(VALID_INPUT);

    expect(parse.mock.calls[0][0].model).toBe('gpt-4o-mini');
  });
});
