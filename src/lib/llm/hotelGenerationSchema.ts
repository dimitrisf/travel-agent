import { z } from 'zod';
import { AMENITY_NAMES } from '../amenities';

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
//
// Amenities ARE constrained via z.enum(AMENITY_NAMES). The
// requiredAmenities filter in HotelRepository joins on Amenity rows
// that only exist for the seed-known set, so any invented name would
// silently drop on upsert and the hotel would then fail the filter
// on the post-upsert re-query — exactly the bug we don't want.

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

const CancellationPolicyOfferSchema = z.object({
  // If true, HotelRepository's freeCancellationRequired filter accepts
  // this hotel. Mix true/false in the prompt so the filter is meaningful.
  freeCancellation: z.boolean(),
  // Short human-readable description shown in HotelSearchRow — the
  // caller may render it verbatim, so keep it plausible ("Free
  // cancellation up to 24 hours before check-in.", "Non-refundable.").
  description: z.string().min(10).max(200),
});

const HotelOfferSchema = z.object({
  // Realistic hotel name for the given city. Prompt instructs to
  // avoid names in `existingHotelNames`; upsert will handle any
  // residual collision by treating it as an update to the existing
  // row (which is fine — same hotel, refreshed pricing).
  name: z.string().min(3).max(80),
  address: z.string().min(10).max(150),
  // Bounded to 3-5 stars to match the demo-curation intent in the
  // LlmHotelSource system prompt ("mix of 3, 4, 5 stars"). Structured
  // outputs enforces this so the LLM cannot slip a 1-2 star hotel
  // through if it decides to sample low. Seed data is not affected —
  // one 2-star hotel exists there as an intentional budget outlier.
  stars: z.number().int().min(3).max(5),
  // Guest rating on a 0-10 scale (Booking.com / Kayak style), bounded
  // to the range demo hotels actually inhabit. Floor at 5 keeps the LLM
  // out of "unlisted / near-empty reviews" territory (1-4); ceiling at
  // 9.5 keeps it out of implausible-perfect territory. Real distribution
  // sits mostly around 7-9.
  rating: z.number().min(5).max(9.5),
  // Latitude/longitude. The prompt asks for coords within ~5km of the
  // city center passed in the input; enforced softly, not structurally.
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // 1-3 room types per hotel.
  roomTypes: z.array(RoomTypeOfferSchema).min(1).max(3),
  // Amenities from the fixed set (matches Amenity rows created in
  // prisma/seed.ts). HotelRepository.upsertHotels resolves these to
  // HotelAmenity join rows; anything outside the enum would fail
  // resolution and drop, so keep this as a strict z.enum.
  amenities: z
    .array(z.enum(AMENITY_NAMES as unknown as [string, ...string[]]))
    .min(1)
    .max(AMENITY_NAMES.length),
  // Per-hotel cancellation policy. Written as a CancellationPolicy row
  // (1:1 with Hotel). Without this, HotelRepository's
  // freeCancellationRequired filter would exclude every LLM hotel.
  cancellationPolicy: CancellationPolicyOfferSchema,
});

export const HotelGenerationResponseSchema = z.object({
  hotels: z.array(HotelOfferSchema).min(3).max(6),
});

export type RoomTypeOffer = z.infer<typeof RoomTypeOfferSchema>;
export type HotelOffer = z.infer<typeof HotelOfferSchema>;
export type HotelGenerationResponse = z.infer<
  typeof HotelGenerationResponseSchema
>;
