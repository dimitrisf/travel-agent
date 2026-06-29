import type { PrismaClient } from '@prisma/client';

export interface FlightSearchOptions {
  // e.g. "ATH" for Athens, "LHR" for London Heathrow, etc.
  originIata: string;
  destinationIata: string;
  departureDate: string; // YYYY-MM-DD, interpreted as UTC calendar day

  // Optional filters

  // If true, only return flights with no stops. If false or undefined, return all flights.
  nonstopOnly?: boolean;
  // If provided, only return flights operated by airlines with IATA codes in this list. If undefined or empty, return all flights.
  airlineCodes?: string[]; // IATA codes to whitelist
}

// Represents a single flight instance (i.e. a single flight on a specific date/time) returned by the FlightRepository.
export interface FlightSearchRow {
  flightNumber: string; // e.g. "A3 824"
  airlineName: string;
  airlineIata: string;
  basePriceEUR: number;
  stops: number;
  // Duration of the flight in minutes, including any stops
  durationMinutes: number;
  departureDatetime: Date;
  arrivalDatetime: Date;
  origin: { iata: string; name: string; city: string };
  destination: { iata: string; name: string; city: string };
}

export class FlightRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async airportExists(iata: string): Promise<boolean> {
    const a = await this.prisma.airport.findUnique({
      where: { iataCode: iata },
      select: { id: true },
    });
    return a !== null;
  }

  async findInstances(opts: FlightSearchOptions): Promise<FlightSearchRow[]> {
    // Interpret the departureDate as a UTC calendar day, and find all flight instances that depart on that day.
    const dayStart = new Date(`${opts.departureDate}T00:00:00.000Z`);

    // Add 24 hours to get the end of the day (exclusive)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const rows = await this.prisma.flightInstance.findMany({
      where: {
        departureDatetime: { gte: dayStart, lt: dayEnd },
        flightDefinition: {
          originAirport: { iataCode: opts.originIata },
          destinationAirport: { iataCode: opts.destinationIata },
          ...(opts.nonstopOnly ? { stops: 0 } : {}),
          ...(opts.airlineCodes && opts.airlineCodes.length > 0
            ? { airline: { iataCode: { in: opts.airlineCodes } } }
            : {}),
        },
      },
      include: {
        flightDefinition: {
          include: {
            airline: true,
            originAirport: { include: { city: true } },
            destinationAirport: { include: { city: true } },
          },
        },
      },
      orderBy: { departureDatetime: 'asc' },
    });

    return rows.map((r) => ({
      flightNumber: `${r.flightDefinition.airline.iataCode} ${r.flightDefinition.flightNumber}`,
      airlineName: r.flightDefinition.airline.name,
      airlineIata: r.flightDefinition.airline.iataCode,
      basePriceEUR: r.flightDefinition.basePriceEUR,
      stops: r.flightDefinition.stops,
      durationMinutes: r.flightDefinition.durationMinutes,
      departureDatetime: r.departureDatetime,
      arrivalDatetime: r.arrivalDatetime,
      origin: {
        iata: r.flightDefinition.originAirport.iataCode,
        name: r.flightDefinition.originAirport.name,
        city: r.flightDefinition.originAirport.city.name,
      },
      destination: {
        iata: r.flightDefinition.destinationAirport.iataCode,
        name: r.flightDefinition.destinationAirport.name,
        city: r.flightDefinition.destinationAirport.city.name,
      },
    }));
  }
}
