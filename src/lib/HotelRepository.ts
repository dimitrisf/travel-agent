import type { PrismaClient } from '@prisma/client';

export interface HotelSearchOptions {
  cityName: string;
  checkinDate: string; // YYYY-MM-DD
  checkoutDate: string; // YYYY-MM-DD (exclusive)
  guests: number;
  rooms: number;
  minStars?: number;
  maxPricePerNight?: number;
  requiredAmenities?: string[]; // amenity names
  freeCancellationRequired?: boolean;
}

export interface HotelSearchRow {
  hotelName: string;
  address: string;
  city: string;
  stars: number;
  rating: number;
  roomTypeName: string;
  totalPrice: number;
  avgPricePerNight: number;
  nights: number;
  currency: string;
  amenities: string[];
  freeCancellation: boolean;
  cancellationDescription: string;
}

export class HotelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async cityExists(name: string): Promise<boolean> {
    const c = await this.prisma.city.findUnique({
      where: { name },
      select: { id: true },
    });
    return c !== null;
  }

  async findAvailable(opts: HotelSearchOptions): Promise<HotelSearchRow[]> {
    const checkin = new Date(`${opts.checkinDate}T00:00:00.000Z`);
    const checkout = new Date(`${opts.checkoutDate}T00:00:00.000Z`);

    // Calculate the number of nights between checkin and checkout
    const nights = Math.round(
      (checkout.getTime() - checkin.getTime()) / 86_400_000,
    );

    const hotels = await this.prisma.hotel.findMany({
      where: {
        city: { name: opts.cityName },
        ...(opts.minStars != null ? { stars: { gte: opts.minStars } } : {}),
        ...(opts.freeCancellationRequired
          ? { cancellationPolicy: { freeCancellation: true } }
          : {}),
        ...(opts.requiredAmenities && opts.requiredAmenities.length > 0
          ? {
              AND: opts.requiredAmenities.map((name) => ({
                hotelAmenities: { some: { amenity: { name } } },
              })),
            }
          : {}),
      },
      include: {
        city: true,
        cancellationPolicy: true,
        hotelAmenities: { include: { amenity: true } },
        roomTypes: {
          // Only include room types that can accommodate the requested number of guests, and only include availability for the requested date range.
          where: { maxGuests: { gte: opts.guests } },
          include: {
            availability: {
              where: { date: { gte: checkin, lt: checkout } },
              orderBy: { date: 'asc' },
            },
          },
        },
      },
    });

    const results: HotelSearchRow[] = [];

    for (const hotel of hotels) {
      const amenities = hotel.hotelAmenities.map((ha) => ha.amenity.name);
      const policy = hotel.cancellationPolicy;

      for (const room of hotel.roomTypes) {
        // Check that the room has availability for all nights in the requested date range
        if (room.availability.length !== nights) continue;
        // Check that all nights have enough rooms available for the requested number of rooms
        if (!room.availability.every((a) => a.roomsAvailable >= opts.rooms))
          continue;

        const totalPrice = room.availability.reduce(
          (sum, a) => sum + a.price,
          0,
        );
        const avgPricePerNight = totalPrice / nights;

        if (
          opts.maxPricePerNight != null &&
          avgPricePerNight > opts.maxPricePerNight
        ) {
          continue;
        }

        results.push({
          hotelName: hotel.name,
          address: hotel.address,
          city: hotel.city.name,
          stars: hotel.stars,
          rating: hotel.rating,
          roomTypeName: room.name,
          totalPrice: round1(totalPrice),
          avgPricePerNight: round1(avgPricePerNight),
          nights,
          currency: 'EUR',
          amenities,
          freeCancellation: policy?.freeCancellation ?? false,
          cancellationDescription:
            policy?.description ?? 'No cancellation policy on record.',
        });
      }
    }

    // Sort results by average price per night, ascending
    results.sort((a, b) => a.avgPricePerNight - b.avgPricePerNight);
    return results;
  }
}

// Round a number to 1 decimal place, e.g. 123.456 -> 123.5
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
