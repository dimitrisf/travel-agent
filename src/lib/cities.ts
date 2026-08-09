// Single source of truth for the five cities the demo library covers.
// Everything that lists supported cities (input guardrail message, agent
// prompts, live weather API queries, IATA-code references) reads from
// here. Adding a sixth city is a one-file change.
//
// Consumers today:
//   - src/lib/repositories/LiveWeatherRepository.ts    (CITIES for OWM queries)
//   - src/guardrails/offTopicInputGuardrail.ts         (CITY_NAMES in tripwire message)
//   - src/agents/buildWeatherAgent.ts                  (CITY_NAMES in cities-available line)
//   - src/agents/buildTravelAgent.ts                   (CITY_IATA_PAIRS + CITY_NAMES.length)

export type CityMetadata = {
  // 2-letter country code, for OpenWeatherMap `q=` queries.
  country: string;
  // Optional 2-letter US state code, for cases where a name+country
  // pair is still ambiguous (hypothetical Athens, GA vs. Athens, GR
  // future disambiguation). Fed through OWM's 3-level q=City,State,Country.
  state?: string;
  // 3-letter IATA airport code, for TravelAgent's flight-search prompts.
  iata: string;
};

export const CITIES: Record<string, CityMetadata> = {
  Athens: { country: 'GR', iata: 'ATH' },
  Berlin: { country: 'DE', iata: 'BER' },
  London: { country: 'GB', iata: 'LHR' },
  Tokyo: { country: 'JP', iata: 'HND' },
  'New York': { country: 'US', iata: 'JFK' },
};

// Ordered list of city names — Object.keys preserves insertion order.
export const CITY_NAMES: readonly string[] = Object.keys(CITIES);

// "Athens=ATH, Berlin=BER, London=LHR, Tokyo=HND, New York=JFK" — the
// exact string TravelAgent's prompt interpolates.
export const CITY_IATA_PAIRS: string = Object.entries(CITIES)
  .map(([name, { iata }]) => `${name}=${iata}`)
  .join(', ');
