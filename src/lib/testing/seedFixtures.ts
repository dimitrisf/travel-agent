import type { PrismaClient } from '@prisma/client';

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
