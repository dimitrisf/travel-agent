import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { LlmFlightSource } from './LlmFlightSource';
import { LlmHotelSource } from './LlmHotelSource';

// Stage 23 dev-only smoke script. Hits the REAL OpenAI API and prints
// what the LLM actually produced for a sample flight and hotel search.
// Costs ~$0.002 per run (two gpt-4o-mini calls, ~2500 output tokens
// each). Used during prompt tuning (Phase 8) and as an eyeball check
// before shipping schema changes — the mocked unit tests can't tell
// you whether the generated output looks realistic.
//
// Requires OPENAI_API_KEY in .env (loaded via dotenv/config above).
// new OpenAI() will throw a clear "OPENAI_API_KEY is missing" error
// if it's not set, so no separate check needed here.
//
// Run with: npm run llm:smoke
//
// Not imported anywhere in production code. The ESM entry-point
// guard at the bottom means importing this file from a test would
// not fire the real API calls.

async function main() {
  const flightSource = new LlmFlightSource();
  const hotelSource = new LlmHotelSource();

  console.log('=== LlmFlightSource: ATH → BER on 2026-08-20 ===');
  const flights = await flightSource.generateFlightsForRoute({
    originAirport: { iataCode: 'ATH', cityName: 'Athens' },
    destinationAirport: { iataCode: 'BER', cityName: 'Berlin' },
    departureDate: '2026-08-20',
    allowedAirlines: [
      { iataCode: 'LH', name: 'Lufthansa' },
      { iataCode: 'A3', name: 'Aegean Airlines' },
      { iataCode: 'BA', name: 'British Airways' },
    ],
  });
  console.log(JSON.stringify(flights, null, 2));
  console.log();

  console.log(
    '=== LlmHotelSource: Athens (2026-08-20 → 2026-08-22, 2 guests) ===',
  );
  const hotels = await hotelSource.generateHotelsForCity({
    cityName: 'Athens',
    cityId: 1,
    checkinDate: '2026-08-20',
    checkoutDate: '2026-08-22',
    guests: 2,
    existingHotelNames: ['Plaka Boutique'],
    cityCenter: { latitude: 37.9838, longitude: 23.7275 },
  });
  console.log(JSON.stringify(hotels, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('smoke run failed:', err);
    process.exit(1);
  });
}
