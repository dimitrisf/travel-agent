import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ───────────────────────────────────────────────
// Static seed data
// ───────────────────────────────────────────────

const CONDITIONS = [
  'sunny',
  'overcast with light rain',
  'humid, partly cloudy',
  'clear',
  'clear, windy',
] as const;

const COUNTRIES = [
  { name: 'Greece', isoCode: 'GR' },
  { name: 'Germany', isoCode: 'DE' },
  { name: 'United Kingdom', isoCode: 'GB' },
  { name: 'Japan', isoCode: 'JP' },
  { name: 'United States', isoCode: 'US' },
] as const;

const CITIES: {
  name: string;
  countryIso: string;
  weather: { tempC: number; conditions: (typeof CONDITIONS)[number] };
}[] = [
  {
    name: 'Athens',
    countryIso: 'GR',
    weather: { tempC: 32, conditions: 'sunny' },
  },
  {
    name: 'Berlin',
    countryIso: 'DE',
    weather: { tempC: 24, conditions: 'clear' },
  },
  {
    name: 'London',
    countryIso: 'GB',
    weather: { tempC: 18, conditions: 'overcast with light rain' },
  },
  {
    name: 'Tokyo',
    countryIso: 'JP',
    weather: { tempC: 26, conditions: 'humid, partly cloudy' },
  },
  {
    name: 'New York',
    countryIso: 'US',
    weather: { tempC: 21, conditions: 'clear' },
  },
];

const AIRPORTS = [
  {
    iata: 'ATH',
    icao: 'LGAV',
    name: 'Athens International Airport',
    city: 'Athens',
    lat: 37.9364,
    lon: 23.9445,
    tz: 'Europe/Athens',
  },
  {
    iata: 'BER',
    icao: 'EDDB',
    name: 'Berlin Brandenburg',
    city: 'Berlin',
    lat: 52.3667,
    lon: 13.5033,
    tz: 'Europe/Berlin',
  },
  {
    iata: 'LHR',
    icao: 'EGLL',
    name: 'London Heathrow',
    city: 'London',
    lat: 51.47,
    lon: -0.4543,
    tz: 'Europe/London',
  },
  {
    iata: 'HND',
    icao: 'RJTT',
    name: 'Tokyo Haneda',
    city: 'Tokyo',
    lat: 35.5494,
    lon: 139.7798,
    tz: 'Asia/Tokyo',
  },
  {
    iata: 'JFK',
    icao: 'KJFK',
    name: 'John F. Kennedy International',
    city: 'New York',
    lat: 40.6413,
    lon: -73.7781,
    tz: 'America/New_York',
  },
] as const;

const AIRLINES = [
  { iata: 'A3', icao: 'AEE', name: 'Aegean Airlines' },
  { iata: 'LH', icao: 'DLH', name: 'Lufthansa' },
  { iata: 'BA', icao: 'BAW', name: 'British Airways' },
  { iata: 'JL', icao: 'JAL', name: 'Japan Airlines' },
  { iata: 'AA', icao: 'AAL', name: 'American Airlines' },
] as const;

const FLIGHT_DEFS: {
  airline: string;
  number: string;
  from: string;
  to: string;
  baseEUR: number;
  durationMin: number;
  stops: number;
  departureLocal: string; // HH:MM, local time at origin
}[] = [
  {
    airline: 'A3',
    number: '824',
    from: 'ATH',
    to: 'BER',
    baseEUR: 138,
    durationMin: 100,
    stops: 0,
    departureLocal: '09:40',
  },
  {
    airline: 'A3',
    number: '825',
    from: 'BER',
    to: 'ATH',
    baseEUR: 145,
    durationMin: 110,
    stops: 0,
    departureLocal: '12:30',
  },
  {
    airline: 'LH',
    number: '1753',
    from: 'ATH',
    to: 'BER',
    baseEUR: 149,
    durationMin: 160,
    stops: 1,
    departureLocal: '12:30',
  },
  {
    airline: 'LH',
    number: '1754',
    from: 'BER',
    to: 'ATH',
    baseEUR: 155,
    durationMin: 160,
    stops: 1,
    departureLocal: '15:00',
  },
  {
    airline: 'A3',
    number: '600',
    from: 'ATH',
    to: 'LHR',
    baseEUR: 220,
    durationMin: 240,
    stops: 0,
    departureLocal: '07:30',
  },
  {
    airline: 'BA',
    number: '632',
    from: 'LHR',
    to: 'ATH',
    baseEUR: 215,
    durationMin: 250,
    stops: 0,
    departureLocal: '14:00',
  },
  {
    airline: 'LH',
    number: '432',
    from: 'BER',
    to: 'LHR',
    baseEUR: 120,
    durationMin: 110,
    stops: 0,
    departureLocal: '08:15',
  },
  {
    airline: 'BA',
    number: '990',
    from: 'LHR',
    to: 'BER',
    baseEUR: 115,
    durationMin: 105,
    stops: 0,
    departureLocal: '17:45',
  },
  {
    airline: 'BA',
    number: '178',
    from: 'LHR',
    to: 'JFK',
    baseEUR: 510,
    durationMin: 470,
    stops: 0,
    departureLocal: '11:00',
  },
  {
    airline: 'AA',
    number: '100',
    from: 'JFK',
    to: 'LHR',
    baseEUR: 480,
    durationMin: 420,
    stops: 0,
    departureLocal: '21:30',
  },
  {
    airline: 'JL',
    number: '32',
    from: 'HND',
    to: 'LHR',
    baseEUR: 850,
    durationMin: 730,
    stops: 0,
    departureLocal: '10:00',
  },
  {
    airline: 'JL',
    number: '33',
    from: 'LHR',
    to: 'HND',
    baseEUR: 830,
    durationMin: 720,
    stops: 0,
    departureLocal: '19:00',
  },
];

const AMENITIES = [
  'Breakfast',
  'Free WiFi',
  'Swimming Pool',
  'Pet Friendly',
  'Parking',
  'Gym',
  'Air Conditioning',
  'Spa',
] as const;

type RoomSeed = {
  name: string;
  maxGuests: number;
  beds: number;
  basePrice: number;
};

type HotelSeed = {
  name: string;
  city: string;
  address: string;
  stars: number;
  rating: number;
  lat: number;
  lon: number;
  amenities: (typeof AMENITIES)[number][];
  cancellation: { free: boolean; description: string };
  rooms: RoomSeed[];
};

const HOTELS: HotelSeed[] = [
  {
    name: 'Hotel Berlin Central',
    city: 'Berlin',
    address: 'Friedrichstr. 100, 10117 Berlin',
    stars: 4,
    rating: 8.7,
    lat: 52.5176,
    lon: 13.3884,
    amenities: ['Breakfast', 'Free WiFi', 'Gym', 'Air Conditioning'],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 24 hours before check-in.',
    },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 129 },
      { name: 'Deluxe', maxGuests: 2, beds: 1, basePrice: 179 },
      { name: 'Family', maxGuests: 4, beds: 2, basePrice: 239 },
    ],
  },
  {
    name: 'City Budget Inn',
    city: 'Berlin',
    address: 'Skalitzer Str. 80, 10997 Berlin',
    stars: 3,
    rating: 8.2,
    lat: 52.4998,
    lon: 13.4419,
    amenities: ['Free WiFi', 'Pet Friendly'],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 7 days before check-in.',
    },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 82 },
      { name: 'Twin', maxGuests: 2, beds: 2, basePrice: 95 },
    ],
  },
  {
    name: 'Grand Berlin Plaza',
    city: 'Berlin',
    address: 'Kurfürstendamm 12, 10719 Berlin',
    stars: 5,
    rating: 9.1,
    lat: 52.5037,
    lon: 13.3279,
    amenities: [
      'Breakfast',
      'Free WiFi',
      'Swimming Pool',
      'Pet Friendly',
      'Parking',
      'Gym',
      'Air Conditioning',
      'Spa',
    ],
    cancellation: { free: false, description: 'Non-refundable.' },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 245 },
      { name: 'Suite', maxGuests: 2, beds: 1, basePrice: 395 },
    ],
  },
  {
    name: 'Athens Acropolis Suites',
    city: 'Athens',
    address: 'Dionysiou Areopagitou 25, 11742 Athens',
    stars: 4,
    rating: 8.6,
    lat: 37.9691,
    lon: 23.7286,
    amenities: ['Breakfast', 'Free WiFi', 'Swimming Pool', 'Air Conditioning'],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 24 hours before check-in.',
    },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 145 },
      { name: 'Suite', maxGuests: 3, beds: 1, basePrice: 210 },
    ],
  },
  {
    name: 'Plaka Boutique',
    city: 'Athens',
    address: 'Adrianou 80, 10556 Athens',
    stars: 3,
    rating: 8.5,
    lat: 37.974,
    lon: 23.73,
    amenities: ['Breakfast', 'Free WiFi', 'Pet Friendly'],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 24 hours before check-in.',
    },
    rooms: [{ name: 'Standard', maxGuests: 2, beds: 1, basePrice: 95 }],
  },
  {
    name: 'Athenaeum Grand',
    city: 'Athens',
    address: 'Vasilissis Sofias 46, 11528 Athens',
    stars: 5,
    rating: 9.0,
    lat: 37.9756,
    lon: 23.7468,
    amenities: [
      'Breakfast',
      'Free WiFi',
      'Swimming Pool',
      'Parking',
      'Gym',
      'Air Conditioning',
      'Spa',
    ],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 48 hours before check-in.',
    },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 280 },
      { name: 'Suite', maxGuests: 2, beds: 1, basePrice: 420 },
      { name: 'Family', maxGuests: 4, beds: 2, basePrice: 520 },
    ],
  },
  {
    name: 'Westminster Garden Hotel',
    city: 'London',
    address: '34 Buckingham Gate, London SW1E 6PA',
    stars: 4,
    rating: 8.4,
    lat: 51.4994,
    lon: -0.1357,
    amenities: ['Breakfast', 'Free WiFi', 'Gym', 'Air Conditioning'],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 24 hours before check-in.',
    },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 175 },
      { name: 'Deluxe', maxGuests: 2, beds: 1, basePrice: 230 },
    ],
  },
  {
    name: 'Kings Cross Budget',
    city: 'London',
    address: '12 Pentonville Rd, London N1 9HF',
    stars: 2,
    rating: 7.8,
    lat: 51.532,
    lon: -0.123,
    amenities: ['Free WiFi'],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 48 hours before check-in.',
    },
    rooms: [{ name: 'Standard', maxGuests: 2, beds: 1, basePrice: 75 }],
  },
  {
    name: 'The Strand Royale',
    city: 'London',
    address: '1 Savoy Pl, London WC2R 0BP',
    stars: 5,
    rating: 9.2,
    lat: 51.5101,
    lon: -0.1196,
    amenities: [
      'Breakfast',
      'Free WiFi',
      'Swimming Pool',
      'Pet Friendly',
      'Parking',
      'Gym',
      'Air Conditioning',
      'Spa',
    ],
    cancellation: { free: false, description: 'Non-refundable.' },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 340 },
      { name: 'Suite', maxGuests: 2, beds: 1, basePrice: 540 },
    ],
  },
  {
    name: 'Shibuya Modern',
    city: 'Tokyo',
    address: '2-21-1 Dogenzaka, Shibuya, Tokyo 150-0043',
    stars: 4,
    rating: 8.8,
    lat: 35.658,
    lon: 139.6994,
    amenities: ['Breakfast', 'Free WiFi', 'Gym', 'Air Conditioning'],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 24 hours before check-in.',
    },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 165 },
      { name: 'Twin', maxGuests: 2, beds: 2, basePrice: 185 },
    ],
  },
  {
    name: 'Asakusa Ryokan',
    city: 'Tokyo',
    address: '1-2-15 Asakusa, Taito, Tokyo 111-0032',
    stars: 3,
    rating: 9.0,
    lat: 35.7148,
    lon: 139.7967,
    amenities: ['Breakfast', 'Free WiFi', 'Swimming Pool'],
    cancellation: { free: false, description: 'Non-refundable.' },
    rooms: [{ name: 'Tatami', maxGuests: 2, beds: 1, basePrice: 110 }],
  },
  {
    name: 'Midtown Manhattan Suites',
    city: 'New York',
    address: '152 W 49th St, New York, NY 10019',
    stars: 4,
    rating: 8.5,
    lat: 40.76,
    lon: -73.983,
    amenities: [
      'Breakfast',
      'Free WiFi',
      'Pet Friendly',
      'Gym',
      'Air Conditioning',
    ],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 24 hours before check-in.',
    },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 220 },
      { name: 'Suite', maxGuests: 3, beds: 1, basePrice: 310 },
    ],
  },
  {
    name: 'Brooklyn Bay Inn',
    city: 'New York',
    address: '88 Bay St, Brooklyn, NY 11231',
    stars: 3,
    rating: 8.1,
    lat: 40.68,
    lon: -74.007,
    amenities: ['Free WiFi', 'Pet Friendly', 'Parking'],
    cancellation: {
      free: true,
      description: 'Free cancellation up to 7 days before check-in.',
    },
    rooms: [{ name: 'Standard', maxGuests: 2, beds: 1, basePrice: 130 }],
  },
  {
    name: 'The Empire Penthouse',
    city: 'New York',
    address: '350 5th Ave, New York, NY 10118',
    stars: 5,
    rating: 9.3,
    lat: 40.7484,
    lon: -73.9857,
    amenities: [
      'Breakfast',
      'Free WiFi',
      'Swimming Pool',
      'Parking',
      'Gym',
      'Air Conditioning',
      'Spa',
    ],
    cancellation: { free: false, description: 'Non-refundable.' },
    rooms: [
      { name: 'Standard', maxGuests: 2, beds: 1, basePrice: 420 },
      { name: 'Suite', maxGuests: 2, beds: 1, basePrice: 680 },
      { name: 'Penthouse', maxGuests: 4, beds: 2, basePrice: 1200 },
    ],
  },
];

const FORECAST_DAYS = 21;
const FLIGHT_INSTANCE_DAYS = 14;
const HOTEL_AVAILABILITY_DAYS = 21;

// ───────────────────────────────────────────────
// Seed flow
// ───────────────────────────────────────────────

async function main() {
  console.log('Seeding conditions…');
  const conditionsByDescription = new Map<string, number>();
  for (const description of CONDITIONS) {
    const row = await prisma.conditions.upsert({
      where: { description },
      update: {},
      create: { description },
    });
    conditionsByDescription.set(description, row.id);
  }

  console.log('Seeding countries…');
  const countryIdByIso = new Map<string, number>();
  for (const c of COUNTRIES) {
    const row = await prisma.country.upsert({
      where: { isoCode: c.isoCode },
      update: { name: c.name },
      create: { name: c.name, isoCode: c.isoCode },
    });
    countryIdByIso.set(c.isoCode, row.id);
  }

  console.log('Seeding cities, current weather, and forecasts…');
  const cityIdByName = new Map<string, number>();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const { name: cityName, countryIso, weather } of CITIES) {
    const countryId = countryIdByIso.get(countryIso)!;
    const city = await prisma.city.upsert({
      where: { name: cityName },
      update: { countryId },
      create: { name: cityName, countryId },
    });
    cityIdByName.set(cityName, city.id);

    const conditionsId = conditionsByDescription.get(weather.conditions)!;

    await prisma.currentWeather.upsert({
      where: { cityId: city.id },
      update: { tempC: weather.tempC, conditionsId },
      create: { cityId: city.id, tempC: weather.tempC, conditionsId },
    });

    for (let i = 0; i < FORECAST_DAYS; i++) {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() + i);
      const jitter = (i * 1.7) % 5;
      const dailyCondition =
        i % 3 === 2 ? rotatingCondition(i) : weather.conditions;

      await prisma.forecast.upsert({
        where: { cityId_date: { cityId: city.id, date } },
        update: {
          tempCMin: round1(weather.tempC - 4 - jitter),
          tempCMax: round1(weather.tempC + 2 + jitter),
          conditionsId: conditionsByDescription.get(dailyCondition)!,
        },
        create: {
          cityId: city.id,
          date,
          tempCMin: round1(weather.tempC - 4 - jitter),
          tempCMax: round1(weather.tempC + 2 + jitter),
          conditionsId: conditionsByDescription.get(dailyCondition)!,
        },
      });
    }
  }

  console.log('Seeding airports…');
  const airportIdByIata = new Map<string, number>();
  for (const a of AIRPORTS) {
    const cityId = cityIdByName.get(a.city);
    if (!cityId)
      throw new Error(
        `Airport "${a.iata}" references unknown city "${a.city}"`,
      );
    const row = await prisma.airport.upsert({
      where: { iataCode: a.iata },
      update: {
        icaoCode: a.icao,
        name: a.name,
        cityId,
        latitude: a.lat,
        longitude: a.lon,
        timezone: a.tz,
      },
      create: {
        iataCode: a.iata,
        icaoCode: a.icao,
        name: a.name,
        cityId,
        latitude: a.lat,
        longitude: a.lon,
        timezone: a.tz,
      },
    });
    airportIdByIata.set(a.iata, row.id);
  }

  console.log('Seeding airlines…');
  const airlineIdByIata = new Map<string, number>();
  for (const a of AIRLINES) {
    const row = await prisma.airline.upsert({
      where: { iataCode: a.iata },
      update: { icaoCode: a.icao, name: a.name },
      create: { iataCode: a.iata, icaoCode: a.icao, name: a.name },
    });
    airlineIdByIata.set(a.iata, row.id);
  }

  console.log('Seeding flight definitions…');
  const flightDefIdByKey = new Map<string, number>();
  for (const f of FLIGHT_DEFS) {
    const airlineId = airlineIdByIata.get(f.airline)!;
    const originAirportId = airportIdByIata.get(f.from)!;
    const destinationAirportId = airportIdByIata.get(f.to)!;
    const def = await prisma.flightDefinition.upsert({
      where: {
        airlineId_flightNumber: { airlineId, flightNumber: f.number },
      },
      update: {
        originAirportId,
        destinationAirportId,
        basePriceEUR: f.baseEUR,
        durationMinutes: f.durationMin,
        stops: f.stops,
      },
      create: {
        airlineId,
        flightNumber: f.number,
        originAirportId,
        destinationAirportId,
        basePriceEUR: f.baseEUR,
        durationMinutes: f.durationMin,
        stops: f.stops,
      },
    });
    flightDefIdByKey.set(`${f.airline}${f.number}`, def.id);
  }

  console.log(`Seeding flight instances (${FLIGHT_INSTANCE_DAYS} days)…`);
  for (const f of FLIGHT_DEFS) {
    const flightDefinitionId = flightDefIdByKey.get(`${f.airline}${f.number}`)!;
    const [hh, mm] = f.departureLocal.split(':').map(Number) as [
      number,
      number,
    ];

    for (let i = 0; i < FLIGHT_INSTANCE_DAYS; i++) {
      const date = new Date(today);
      date.setUTCDate(today.getUTCDate() + i);
      date.setUTCHours(hh, mm, 0, 0);

      const departureDatetime = date;
      const arrivalDatetime = new Date(
        departureDatetime.getTime() + f.durationMin * 60_000,
      );

      await prisma.flightInstance.upsert({
        where: {
          flightDefinitionId_departureDatetime: {
            flightDefinitionId,
            departureDatetime,
          },
        },
        update: { arrivalDatetime },
        create: {
          flightDefinitionId,
          departureDatetime,
          arrivalDatetime,
        },
      });
    }
  }

  console.log('Seeding amenities…');
  const amenityIdByName = new Map<string, number>();
  for (const name of AMENITIES) {
    const row = await prisma.amenity.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    amenityIdByName.set(name, row.id);
  }

  console.log(
    `Seeding hotels + rooms + availability (${HOTEL_AVAILABILITY_DAYS} days)…`,
  );
  for (const h of HOTELS) {
    const cityId = cityIdByName.get(h.city);
    if (!cityId)
      throw new Error(`Hotel "${h.name}" references unknown city "${h.city}"`);

    const hotel = await prisma.hotel.upsert({
      where: { cityId_name: { cityId, name: h.name } },
      update: {
        address: h.address,
        stars: h.stars,
        rating: h.rating,
        latitude: h.lat,
        longitude: h.lon,
      },
      create: {
        name: h.name,
        cityId,
        address: h.address,
        stars: h.stars,
        rating: h.rating,
        latitude: h.lat,
        longitude: h.lon,
      },
    });

    await prisma.cancellationPolicy.upsert({
      where: { hotelId: hotel.id },
      update: {
        freeCancellation: h.cancellation.free,
        description: h.cancellation.description,
      },
      create: {
        hotelId: hotel.id,
        freeCancellation: h.cancellation.free,
        description: h.cancellation.description,
      },
    });

    await prisma.hotelAmenity.deleteMany({ where: { hotelId: hotel.id } });
    for (const name of h.amenities) {
      const amenityId = amenityIdByName.get(name);
      if (!amenityId)
        throw new Error(
          `Hotel "${h.name}" references unknown amenity "${name}"`,
        );
      await prisma.hotelAmenity.create({
        data: { hotelId: hotel.id, amenityId },
      });
    }

    for (const r of h.rooms) {
      const room = await prisma.roomType.upsert({
        where: { hotelId_name: { hotelId: hotel.id, name: r.name } },
        update: {
          maxGuests: r.maxGuests,
          beds: r.beds,
          basePrice: r.basePrice,
        },
        create: {
          hotelId: hotel.id,
          name: r.name,
          maxGuests: r.maxGuests,
          beds: r.beds,
          basePrice: r.basePrice,
        },
      });

      for (let i = 0; i < HOTEL_AVAILABILITY_DAYS; i++) {
        const date = new Date(today);
        date.setUTCDate(today.getUTCDate() + i);
        const dow = date.getUTCDay();
        const isWeekend = dow === 5 || dow === 6;
        const price = round1(r.basePrice * (isWeekend ? 1.15 : 1.0));

        await prisma.availability.upsert({
          where: { roomTypeId_date: { roomTypeId: room.id, date } },
          update: { roomsAvailable: 5, price },
          create: { roomTypeId: room.id, date, roomsAvailable: 5, price },
        });
      }
    }
  }

  console.log('Done.');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function rotatingCondition(i: number): (typeof CONDITIONS)[number] {
  return CONDITIONS[i % CONDITIONS.length]!;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
