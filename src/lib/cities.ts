// Single source of truth for the five cities the demo library covers.
// Everything that lists supported cities (input guardrail message, agent
// prompts, live weather API queries, IATA-code references) reads from
// here. Adding a sixth city is a one-file change.
//
// Consumers today:
//   - src/lib/repositories/LiveWeatherRepository.ts    (CITIES for OWM queries)
//   - src/lib/repositories/HotelRepository.ts          (city center for LlmHotelSource prompts, Stage 23)
//   - src/guardrails/offTopicInputGuardrail.ts         (CITY_NAMES in tripwire message)
//   - src/agents/buildWeatherAgent.ts                  (CITY_NAMES in cities-available line)
//   - src/agents/buildTravelAgent.ts                   (CITY_IATA_PAIRS + CITY_NAMES.length)
//   - src/components/explorer/widgets/CitySelect.tsx   (CITY_NAMES for Explorer autocomplete)
//   - src/components/explorer/widgets/AirportSelect.tsx (CITIES for Explorer IATA-per-city autocomplete)

export type CityMetadata = {
  // 2-letter country code, for OpenWeatherMap `q=` queries.
  country: string;
  // Optional 2-letter US state code, for cases where a name+country
  // pair is still ambiguous (hypothetical Athens, GA vs. Athens, GR
  // future disambiguation). Fed through OWM's 3-level q=City,State,Country.
  state?: string;
  // 3-letter IATA airport code, for TravelAgent's flight-search prompts.
  iata: string;
  // City center coordinates (Stage 23). Used by HotelRepository to
  // give LlmHotelSource an anchor point for generated hotels ("within
  // ~5km of these coords"). Not the airport lat/lon — airports are
  // typically 10-30km outside the city, wrong anchor for hotels.
  center: { latitude: number; longitude: number };
};

export const CITIES: Record<string, CityMetadata> = {
  Athens: {
    country: 'GR',
    iata: 'ATH',
    center: { latitude: 37.9838, longitude: 23.7275 },
  },
  Berlin: {
    country: 'DE',
    iata: 'BER',
    center: { latitude: 52.52, longitude: 13.405 },
  },
  London: {
    country: 'GB',
    iata: 'LHR',
    center: { latitude: 51.5074, longitude: -0.1278 },
  },
  Tokyo: {
    country: 'JP',
    iata: 'HND',
    center: { latitude: 35.6762, longitude: 139.6503 },
  },
  'New York': {
    country: 'US',
    iata: 'JFK',
    center: { latitude: 40.7128, longitude: -74.006 },
  },
};

// Ordered list of city names — Object.keys preserves insertion order.
export const CITY_NAMES: readonly string[] = Object.keys(CITIES);

// "Athens=ATH, Berlin=BER, London=LHR, Tokyo=HND, New York=JFK" — the
// exact string TravelAgent's prompt interpolates.
export const CITY_IATA_PAIRS: string = Object.entries(CITIES)
  .map(([name, { iata }]) => `${name}=${iata}`)
  .join(', ');
