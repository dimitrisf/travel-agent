import { z } from 'zod';
import type { HotelRepository } from '../repositories/HotelRepository';
import { TravelServiceError } from './TravelServiceError';

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format');

const SearchHotelsInput = z.object({
  city: z.string().trim().min(1, 'city is required'),
  checkin: IsoDate,
  checkout: IsoDate,
  guests: z.number().int().min(1).default(2),
  rooms: z.number().int().min(1).default(1),
  min_stars: z.number().int().min(1).max(5).optional(),
  max_price: z.number().positive().optional(), // per night
  currency: z.string().default('EUR'),
  breakfast_required: z.boolean().default(false),
  free_cancellation: z.boolean().default(false),
  pet_friendly: z.boolean().default(false),
});

export type SearchHotelsInput = z.input<typeof SearchHotelsInput>;

export interface HotelResult {
  hotel_id: number;
  room_type_id: number; // required as `room_type_id` in propose_booking
  hotel: string;
  address: string;
  city: string;
  stars: number;
  rating: number;
  room_type: string;
  price_per_night: number; // average across the stay
  total_price: number;
  nights: number;
  currency: string;
  amenities: string[];
  free_cancellation: boolean;
  cancellation_description: string;
}

export class HotelService {
  constructor(private readonly repo: HotelRepository) {}

  async searchHotels(input: SearchHotelsInput): Promise<HotelResult[]> {
    const parsed = SearchHotelsInput.parse(input);

    if (parsed.checkout <= parsed.checkin) {
      throw new TravelServiceError(
        'checkout must be after checkin.',
        'INVALID_DATE_RANGE',
      );
    }

    let exists: boolean;
    try {
      exists = await this.repo.cityExists(parsed.city);
    } catch (err) {
      throw new TravelServiceError(
        'Database error while validating city.',
        'INTERNAL_ERROR',
        { cause: err },
      );
    }
    if (!exists) {
      throw new TravelServiceError(
        `City "${parsed.city}" not found.`,
        'CITY_NOT_FOUND',
      );
    }

    const requiredAmenities: string[] = [];
    if (parsed.breakfast_required) requiredAmenities.push('Breakfast');
    if (parsed.pet_friendly) requiredAmenities.push('Pet Friendly');

    let hotelSearchRows;
    try {
      // hotelSearchRows is of type HotelSearchRow[]
      hotelSearchRows = await this.repo.findAvailable({
        cityName: parsed.city,
        checkinDate: parsed.checkin,
        checkoutDate: parsed.checkout,
        guests: parsed.guests,
        rooms: parsed.rooms,
        minStars: parsed.min_stars,
        maxPricePerNight: parsed.max_price,
        requiredAmenities,
        freeCancellationRequired: parsed.free_cancellation,
      });
    } catch (err) {
      throw new TravelServiceError(
        'Failed to search hotels.',
        'INTERNAL_ERROR',
        {
          cause: err,
        },
      );
    }

    return hotelSearchRows.map((r) => ({
      hotel_id: r.hotelId,
      room_type_id: r.roomTypeId,
      hotel: r.hotelName,
      address: r.address,
      city: r.city,
      stars: r.stars,
      rating: r.rating,
      room_type: r.roomTypeName,
      price_per_night: r.avgPricePerNight,
      total_price: r.totalPrice,
      nights: r.nights,
      currency: r.currency,
      amenities: r.amenities,
      free_cancellation: r.freeCancellation,
      cancellation_description: r.cancellationDescription,
    }));
  }
}
