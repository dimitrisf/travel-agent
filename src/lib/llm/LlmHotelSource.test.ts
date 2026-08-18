import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { LlmHotelSource } from './LlmHotelSource';
import type { HotelGenerationInput } from './hotelGenerationSchema';

// Unit tests for LlmHotelSource. Mirror of LlmFlightSource tests —
// same three outcome branches (happy path, null output_parsed,
// thrown error), plus a check that the "existing hotel names" list
// gets threaded into the user prompt via the Responses API `input`
// field.

const VALID_INPUT: HotelGenerationInput = {
  cityName: 'Athens',
  cityId: 1,
  checkinDate: '2026-08-20',
  checkoutDate: '2026-08-22',
  guests: 2,
  existingHotelNames: ['Plaka Boutique', 'Acropolis View'],
  cityCenter: { latitude: 37.9838, longitude: 23.7275 },
};

const VALID_PARSED_RESPONSE = {
  hotels: [
    {
      name: 'Syntagma Grand',
      address: 'Vasilissis Amalias 15, 10557 Athens',
      stars: 4,
      rating: 8.7,
      latitude: 37.9756,
      longitude: 23.7348,
      roomTypes: [
        { name: 'Standard Double', maxGuests: 2, beds: 1, basePriceEUR: 145, roomsAvailable: 20 },
        { name: 'Deluxe Twin', maxGuests: 2, beds: 2, basePriceEUR: 185, roomsAvailable: 12 },
      ],
    },
    {
      name: 'Kolonaki Suites',
      address: 'Skoufa 55, 10673 Athens',
      stars: 5,
      rating: 9.1,
      latitude: 37.9791,
      longitude: 23.7418,
      roomTypes: [
        { name: 'Executive King', maxGuests: 2, beds: 1, basePriceEUR: 320, roomsAvailable: 5 },
      ],
    },
    {
      name: 'Monastiraki Boutique',
      address: 'Athinas 21, 10554 Athens',
      stars: 3,
      rating: 8.2,
      latitude: 37.976,
      longitude: 23.726,
      roomTypes: [
        { name: 'Standard Double', maxGuests: 2, beds: 1, basePriceEUR: 95, roomsAvailable: 15 },
      ],
    },
  ],
};

function makeMockClient() {
  const parse = vi.fn();
  const client = { responses: { parse } } as unknown as OpenAI;
  return { client, parse };
}

describe('LlmHotelSource', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns parsed hotels on the happy path', async () => {
    const { client, parse } = makeMockClient();
    parse.mockResolvedValueOnce({ output_parsed: VALID_PARSED_RESPONSE });
    const source = new LlmHotelSource({ client });

    const result = await source.generateHotelsForCity(VALID_INPUT);

    expect(result).not.toBeNull();
    expect(result?.hotels).toHaveLength(3);
    expect(result?.hotels[0].name).toBe('Syntagma Grand');
    expect(result?.hotels[1].roomTypes[0].basePriceEUR).toBe(320);
  });

  it('threads existing hotel names + city center into the user prompt', async () => {
    const { client, parse } = makeMockClient();
    parse.mockResolvedValueOnce({ output_parsed: VALID_PARSED_RESPONSE });
    const source = new LlmHotelSource({ client });

    await source.generateHotelsForCity(VALID_INPUT);

    const userContent = parse.mock.calls[0][0].input[1].content as string;
    expect(userContent).toContain('Athens');
    expect(userContent).toContain('2026-08-20');
    expect(userContent).toContain('2026-08-22');
    expect(userContent).toContain('"Plaka Boutique"');
    expect(userContent).toContain('"Acropolis View"');
    // City center coordinates present so the LLM can place hotels
    // within the requested radius.
    expect(userContent).toContain('37.9838');
    expect(userContent).toContain('23.7275');
  });

  it('phrases the avoid-list gracefully when no existing hotels', async () => {
    const { client, parse } = makeMockClient();
    parse.mockResolvedValueOnce({ output_parsed: VALID_PARSED_RESPONSE });
    const source = new LlmHotelSource({ client });

    await source.generateHotelsForCity({
      ...VALID_INPUT,
      existingHotelNames: [],
    });

    const userContent = parse.mock.calls[0][0].input[1].content as string;
    // Empty list rendered as an explanatory phrase, not an empty bullet.
    expect(userContent).toContain('none');
  });

  it('returns null when output_parsed is null (refusal / length cutoff / validation)', async () => {
    const { client, parse } = makeMockClient();
    parse.mockResolvedValueOnce({ output_parsed: null });
    const source = new LlmHotelSource({ client });

    const result = await source.generateHotelsForCity(VALID_INPUT);

    expect(result).toBeNull();
  });

  it('returns null when parse throws', async () => {
    const { client, parse } = makeMockClient();
    parse.mockRejectedValueOnce(new Error('Network error'));
    const source = new LlmHotelSource({ client });

    const result = await source.generateHotelsForCity(VALID_INPUT);

    expect(result).toBeNull();
  });
});
