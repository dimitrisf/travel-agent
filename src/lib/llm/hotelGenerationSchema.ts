import { z } from 'zod';

// The LLM output contract for LlmHotelSource. Simpler than
// FlightGenerationSchema because hotels aren't constrained to a
// pre-existing list — the LLM invents realistic hotel names within
// a given city, and the repository upserts by the composite unique
// @@unique([cityId, name]).
//
// To avoid unique-constraint collisions on upsert, the input carries
// `existingHotelNames` which is passed to the LLM in the prompt as
// "avoid these names." The schema itself doesn't enforce this — it's
// a soft constraint enforced by prompt + post-upsert deduplication.

export interface HotelGenerationInput {
  cityName: string;
  // Resolved cityId, used by the repository for upsert. Not exposed to
  // the LLM — the LLM only sees cityName.
  cityId: number;
  // YYYY-MM-DD, interpreted as UTC calendar day (matches
  // HotelSearchOptions in HotelRepository).
  checkinDate: string;
  checkoutDate: string; // exclusive
  guests: number;
  // Names already in the DB for this city (from an upfront query).
  // Passed to the LLM in the prompt as an "avoid these" list to
  // reduce (but not eliminate) upsert-time collisions.
  existingHotelNames: string[];
  // Approximate city center for realistic lat/lon generation. LLM is
  // instructed to keep generated hotels within ~5km of this point.
  cityCenter: { latitude: number; longitude: number };
}

const RoomTypeOfferSchema = z.object({
  // e.g. "Standard Double", "Deluxe Twin", "Junior Suite".
  name: z.string().min(3).max(50),
  maxGuests: z.number().int().min(1).max(6),
  // Number of beds in the room. Constrained to 1-4 to keep the LLM from producing unrealistic "10-bed dorm" rooms.
  beds: z.number().int().min(1).max(4),
  // Base price per night in EUR. The repository fans this out to
  // per-date Availability rows for the checkin→checkout range with
  // the same price on each night (Scope B — no per-date price
  // variation from the LLM).
  basePriceEUR: z.number().positive().max(2000),
  // Total inventory of this room type at the hotel. The repository
  // writes this into every Availability row it creates for the search
  // date range, so the same count applies to every night in the stay
  // (Scope B — no per-date inventory variation from the LLM).
  // Bounded to a realistic hotel-inventory range. Symmetric with
  // FlightOfferSchema.seatsAvailable — both are "invented inventory
  // for demo purposes" fields the LLM populates.
  roomsAvailable: z.number().int().min(1).max(50),
});

const HotelOfferSchema = z.object({
  // Realistic hotel name for the given city. Prompt instructs to
  // avoid names in `existingHotelNames`; upsert will handle any
  // residual collision by treating it as an update to the existing
  // row (which is fine — same hotel, refreshed pricing).
  name: z.string().min(3).max(80),
  address: z.string().min(10).max(150),
  stars: z.number().int().min(1).max(5),
  // Guest rating 0-10 scale (Booking.com / Kayak style). Lower bound
  // above 0 keeps the LLM from producing unrealistic "1.0-rated"
  // hotels that would never be listed.
  rating: z.number().min(5).max(9.5),
  // Latitude/longitude. The prompt asks for coords within ~5km of the
  // city center passed in the input; enforced softly, not structurally.
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // 1-3 room types per hotel.
  roomTypes: z.array(RoomTypeOfferSchema).min(1).max(3),
});

export const HotelGenerationResponseSchema = z.object({
  hotels: z.array(HotelOfferSchema).min(3).max(6),
});

export type RoomTypeOffer = z.infer<typeof RoomTypeOfferSchema>;
export type HotelOffer = z.infer<typeof HotelOfferSchema>;
export type HotelGenerationResponse = z.infer<
  typeof HotelGenerationResponseSchema
>;
