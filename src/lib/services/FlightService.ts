import { z } from 'zod';
import type { FlightRepository } from '../repositories/FlightRepository';
import { TravelServiceError } from './TravelServiceError';

const CabinClass = z.enum(['economy', 'premium_economy', 'business', 'first']);
type CabinClass = z.infer<typeof CabinClass>;

// Cabin multipliers are based on typical industry pricing, but can vary by airline and route. These are just rough estimates for the purpose of this service.
const CABIN_MULTIPLIER: Record<CabinClass, number> = {
  economy: 1,
  premium_economy: 1.5,
  business: 3,
  first: 6,
};

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format');

const SearchFlightsInput = z.object({
  // IATA airport codes are always 3 letters, and are case-insensitive. We'll normalize to uppercase. E.g., "ATH" for Athens, "LHR" for London Heathrow, etc.
  origin: z
    .string()
    .trim()
    .length(3, 'origin must be a 3-letter IATA code')
    .transform((s) => s.toUpperCase()),
  destination: z
    .string()
    .trim()
    .length(3, 'destination must be a 3-letter IATA code')
    .transform((s) => s.toUpperCase()),
  departure_date: IsoDate,
  return_date: IsoDate.optional(),
  adults: z.number().int().min(1).default(1),
  children: z.number().int().min(0).default(0),
  cabin_class: CabinClass.default('economy'),
  nonstop_only: z.boolean().default(false),
  max_price: z.number().positive().optional(),
  preferred_airlines: z
    .array(
      z
        .string()
        .trim()
        .length(2)
        .transform((s) => s.toUpperCase()),
    )
    .optional(),
  // EUR-only in the demo. Prices below are computed as
  // basePriceEUR * cabin multiplier and returned unconverted, so any
  // other currency here would produce EUR-valued numbers labeled with
  // the wrong ticker AND filter max_price against EUR while the caller
  // thinks it's in their currency. The tool spec (see
  // searchFlightsToolSpec) already tells callers this — enforce it at
  // parse time so a rogue `currency: 'USD'` fails loudly instead of
  // silently mispricing.
  currency: z.literal('EUR').default('EUR'),
});

export type SearchFlightsInput = z.input<typeof SearchFlightsInput>;

export interface FlightResult {
  flight_instance_id: number; // required as `flight_instance_id` in propose_booking
  flight_number: string;
  airline: string;
  departure: string; // ISO without timezone (YYYY-MM-DDTHH:MM)
  arrival: string;
  price: number;
  currency: string;
  stops: number;
  duration_minutes: number;
  origin: { airport: string; iata: string; city: string };
  destination: { airport: string; iata: string; city: string };
}

export interface SearchFlightsResult {
  // Outbound flights from origin to destination
  // The `outbound` and `inbound` arrays may be empty if no flights were found for that leg.
  // Also, both arrays may contain multiple flights, and the order is not guaranteed. Consumers should sort or filter as needed. We may have multiple flights per leg due to different airlines, times, or other factors.
  outbound: FlightResult[];
  // Inbound flights from destination back to origin
  inbound: FlightResult[];
}

export class FlightService {
  constructor(private readonly repo: FlightRepository) {}

  async searchFlights(input: SearchFlightsInput): Promise<SearchFlightsResult> {
    const parsed = SearchFlightsInput.parse(input);

    if (parsed.return_date && parsed.return_date <= parsed.departure_date) {
      throw new TravelServiceError(
        'return_date must be after departure_date.',
        'INVALID_DATE_RANGE',
      );
    }

    let originExists: boolean;
    let destinationExists: boolean;
    try {
      [originExists, destinationExists] = await Promise.all([
        this.repo.airportExists(parsed.origin),
        this.repo.airportExists(parsed.destination),
      ]);
    } catch (err) {
      throw new TravelServiceError(
        'Database error while validating airports.',
        'INTERNAL_ERROR',
        { cause: err },
      );
    }
    if (!originExists) {
      throw new TravelServiceError(
        `Origin airport "${parsed.origin}" not found.`,
        'AIRPORT_NOT_FOUND',
      );
    }
    if (!destinationExists) {
      throw new TravelServiceError(
        `Destination airport "${parsed.destination}" not found.`,
        'AIRPORT_NOT_FOUND',
      );
    }

    const outbound = await this.queryLeg({
      origin: parsed.origin,
      destination: parsed.destination,
      date: parsed.departure_date,
      cabin: parsed.cabin_class,
      nonstop: parsed.nonstop_only,
      maxPrice: parsed.max_price,
      airlines: parsed.preferred_airlines,
      currency: parsed.currency,
    });

    const inbound = parsed.return_date
      ? await this.queryLeg({
          origin: parsed.destination,
          destination: parsed.origin,
          date: parsed.return_date,
          cabin: parsed.cabin_class,
          nonstop: parsed.nonstop_only,
          maxPrice: parsed.max_price,
          airlines: parsed.preferred_airlines,
          currency: parsed.currency,
        })
      : [];

    return { outbound, inbound };
  }

  private async queryLeg(args: {
    origin: string;
    destination: string;
    date: string;
    cabin: CabinClass;
    nonstop: boolean;
    maxPrice: number | undefined;
    airlines: string[] | undefined;
    currency: string;
  }): Promise<FlightResult[]> {
    let flightSearchRows;
    try {
      // flightSearchRows is of type FlightSearchRow[] with nested origin and destination airport/city info
      flightSearchRows = await this.repo.findInstances({
        originIata: args.origin,
        destinationIata: args.destination,
        departureDate: args.date,
        nonstopOnly: args.nonstop,
        airlineCodes: args.airlines,
      });
    } catch (err) {
      throw new TravelServiceError(
        'Failed to search flights.',
        'INTERNAL_ERROR',
        {
          cause: err,
        },
      );
    }

    const multiplier = CABIN_MULTIPLIER[args.cabin];
    return flightSearchRows
      .map((r): FlightResult => {
        const price = Math.round(r.basePriceEUR * multiplier);
        return {
          flight_instance_id: r.flightInstanceId,
          flight_number: r.flightNumber,
          airline: r.airlineName,
          // Departure and arrival are returned as ISO strings without timezone, in the format YYYY-MM-DDTHH:MM
          departure: r.departureDatetime.toISOString().slice(0, 16),
          arrival: r.arrivalDatetime.toISOString().slice(0, 16),
          price,
          currency: args.currency,
          stops: r.stops,
          duration_minutes: r.durationMinutes,
          origin: {
            airport: r.origin.name,
            iata: r.origin.iata,
            city: r.origin.city,
          },
          destination: {
            airport: r.destination.name,
            iata: r.destination.iata,
            city: r.destination.city,
          },
        };
      })
      .filter((f) => (args.maxPrice == null ? true : f.price <= args.maxPrice));
  }
}
