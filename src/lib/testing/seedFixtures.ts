import type { PrismaClient } from '@prisma/client';

// Small dictionary of cities used across integration tests. Names
// deliberately match entries in src/lib/cities.ts (`CITIES`) so
// hotel-side Scope B guards (`CITIES[opts.cityName]`) accept them —
// tests exercise the real path, not a bypass. Frankfurt is included
// even though it's NOT in the app CITIES lookup because flight tests
// need it as an airport destination; hotel tests should stick to
// {Athens, Berlin, London} (or add more as CITIES grows).
const KNOWN_CITIES = {
  Athens: { country: 'Greece', countryCode: 'GR' },
  Berlin: { country: 'Germany', countryCode: 'DE' },
  Frankfurt: { country: 'Germany', countryCode: 'DE' },
  London: { country: 'United Kingdom', countryCode: 'GB' },
} as const;

// Small dictionary of well-known airports used across integration
// tests. Extend by adding an entry — the city field must reference
// a KNOWN_CITIES key so seedAirport can compose off seedCity.
const KNOWN_AIRPORTS = {
  ATH: { icao: 'LGAV', name: 'Athens International', city: 'Athens' },
  FRA: { icao: 'EDDF', name: 'Frankfurt Airport', city: 'Frankfurt' },
  BER: { icao: 'EDDB', name: 'Berlin Brandenburg', city: 'Berlin' },
  LHR: { icao: 'EGLL', name: 'London Heathrow', city: 'London' },
} as const;

// Idempotent Country + City upsert. Extracted from seedAirport so
// hotel tests (which don't need an Airport row) can seed just the
// geographic anchor. Idempotent on Country (isoCode @unique) and
// City (name @unique) so it composes freely — call multiple times
// with the same name, or for several cities sharing a country
// (Frankfurt + Berlin both DE), without FK/unique clashes.
export async function seedCity(
  prisma: PrismaClient,
  name: keyof typeof KNOWN_CITIES,
): Promise<{ id: number; name: string }> {
  const meta = KNOWN_CITIES[name];
  const country = await prisma.country.upsert({
    where: { isoCode: meta.countryCode },
    create: { name: meta.country, isoCode: meta.countryCode },
    update: {},
  });
  const city = await prisma.city.upsert({
    where: { name },
    create: { name, countryId: country.id },
    update: {},
  });
  return { id: city.id, name };
}

// Seed an Airport (and its City + Country via seedCity). Airport
// itself is a create (not upsert) — each call produces a fresh row,
// so a test that seeds the same airport twice will error on the
// iataCode @unique constraint. That's the intended contract; tests
// that need multi-airport setups on the same country/city rely on
// seedCity's idempotency handling the shared graph.
export async function seedAirport(
  prisma: PrismaClient,
  iata: keyof typeof KNOWN_AIRPORTS,
): Promise<{ id: number; iataCode: string; cityId: number }> {
  const meta = KNOWN_AIRPORTS[iata];
  const city = await seedCity(prisma, meta.city);
  const airport = await prisma.airport.create({
    data: {
      iataCode: iata,
      icaoCode: meta.icao,
      name: meta.name,
      cityId: city.id,
      latitude: 0,
      longitude: 0,
      timezone: 'UTC',
    },
  });
  return { id: airport.id, iataCode: iata, cityId: city.id };
}

// Same pattern for airlines. Small hardcoded roster; extend as needed.
const KNOWN_AIRLINES = {
  A3: { icao: 'AEE', name: 'Aegean Airlines' },
  LH: { icao: 'DLH', name: 'Lufthansa' },
  BA: { icao: 'BAW', name: 'British Airways' },
} as const;

export async function seedAirline(
  prisma: PrismaClient,
  iata: keyof typeof KNOWN_AIRLINES,
): Promise<{ id: number; iataCode: string; name: string }> {
  const meta = KNOWN_AIRLINES[iata];
  const airline = await prisma.airline.create({
    data: { iataCode: iata, icaoCode: meta.icao, name: meta.name },
  });
  return { id: airline.id, iataCode: iata, name: meta.name };
}

// Create a User row for tests that need to pass a currentUser to
// BookingService.confirmBooking/cancelBooking. Required because
// Booking.userId is a FK to User.id — the DB rejects a claim to a
// user that doesn't exist. Defaults derive from `id` so `seedUser(px,
// { id: 'alice' })` produces a consistent test identity without
// caller-side ceremony.
//
// Returns the shape confirmBooking wants for `currentUser`, so the
// caller can spread it in directly.
export async function seedUser(
  prisma: PrismaClient,
  opts: { id: string; name?: string | null; email?: string },
): Promise<{ id: string; name: string | null; email: string }> {
  const id = opts.id;
  const name = opts.name === undefined ? id : opts.name;
  const email = opts.email ?? `${id}@test.example.com`;
  await prisma.user.create({ data: { id, name, email } });
  return { id, name, email };
}

export type ProposeBookingFixture = {
  flightInstanceId: number;
  roomTypeId: number;
  hotelId: number;
  checkin: string; // 'YYYY-MM-DD'
  checkout: string; // 'YYYY-MM-DD' (exclusive)
  flightBasePriceEUR: number;
  hotelNightlyPriceEUR: number;
};

// Minimal seed sufficient for a proposeBooking happy-path integration
// test. One route (ATH→FRA), one FlightInstance, one Hotel with one
// RoomType, Availability for a 2-night stay. Returns the ids and
// per-unit prices the test needs so assertions don't have to query
// them back or hardcode magic numbers duplicated with the seed body.
//
// Kept deliberately spare — every additional row here is a maintenance
// tax for every test that seeds a variant. Extend by writing a new
// fixture builder (seedTwoLegRoundTripFixture, etc.) rather than by
// widening this one to accept flags.
export async function seedProposeBookingFixture(
  prisma: PrismaClient,
): Promise<ProposeBookingFixture> {
  const greece = await prisma.country.create({
    data: { name: 'Greece', isoCode: 'GR' },
  });
  const germany = await prisma.country.create({
    data: { name: 'Germany', isoCode: 'DE' },
  });

  const athens = await prisma.city.create({
    data: { name: 'Athens', countryId: greece.id },
  });
  const frankfurt = await prisma.city.create({
    data: { name: 'Frankfurt', countryId: germany.id },
  });

  const ath = await prisma.airport.create({
    data: {
      iataCode: 'ATH',
      icaoCode: 'LGAV',
      name: 'Athens International',
      cityId: athens.id,
      latitude: 37.9364,
      longitude: 23.9445,
      timezone: 'Europe/Athens',
    },
  });
  const fra = await prisma.airport.create({
    data: {
      iataCode: 'FRA',
      icaoCode: 'EDDF',
      name: 'Frankfurt Airport',
      cityId: frankfurt.id,
      latitude: 50.0379,
      longitude: 8.5622,
      timezone: 'Europe/Berlin',
    },
  });

  const aegean = await prisma.airline.create({
    data: { iataCode: 'A3', icaoCode: 'AEE', name: 'Aegean Airlines' },
  });

  const flightBasePriceEUR = 120;
  const definition = await prisma.flightDefinition.create({
    data: {
      airlineId: aegean.id,
      flightNumber: '824',
      originAirportId: ath.id,
      destinationAirportId: fra.id,
      basePriceEUR: flightBasePriceEUR,
      durationMinutes: 200,
      stops: 0,
    },
  });
  const instance = await prisma.flightInstance.create({
    data: {
      flightDefinitionId: definition.id,
      departureDatetime: new Date('2026-08-25T08:00:00.000Z'),
      arrivalDatetime: new Date('2026-08-25T11:20:00.000Z'),
      seatsAvailable: 100,
    },
  });

  const hotel = await prisma.hotel.create({
    data: {
      name: 'Frankfurt Central Hotel',
      cityId: frankfurt.id,
      address: '1 Main St, Frankfurt',
      stars: 4,
      rating: 8.5,
      latitude: 50.1109,
      longitude: 8.6821,
    },
  });
  const hotelNightlyPriceEUR = 150;
  const room = await prisma.roomType.create({
    data: {
      hotelId: hotel.id,
      name: 'Standard Double',
      maxGuests: 2,
      beds: 1,
      basePrice: hotelNightlyPriceEUR,
    },
  });
  await prisma.availability.createMany({
    data: [
      {
        roomTypeId: room.id,
        date: new Date('2026-08-25T00:00:00.000Z'),
        roomsAvailable: 5,
        price: hotelNightlyPriceEUR,
      },
      {
        roomTypeId: room.id,
        date: new Date('2026-08-26T00:00:00.000Z'),
        roomsAvailable: 5,
        price: hotelNightlyPriceEUR,
      },
    ],
  });

  return {
    flightInstanceId: instance.id,
    roomTypeId: room.id,
    hotelId: hotel.id,
    checkin: '2026-08-25',
    checkout: '2026-08-27',
    flightBasePriceEUR,
    hotelNightlyPriceEUR,
  };
}
