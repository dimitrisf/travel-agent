// Canonical list of hotel amenities the demo library recognises.
//
// Consumers:
//   - prisma/seed.ts                                    (creates one Amenity row per name)
//   - src/lib/llm/hotelGenerationSchema.ts              (constrains LLM output to this set so upserts always resolve)
//   - src/lib/services/HotelService.ts                  (maps agent flags → filter names — must match entries here)
//
// Adding a new amenity: append here + rerun `db:seed` so a matching
// Amenity row exists. Anything the LLM emits that isn't in this list
// would fail to resolve to an Amenity row and would silently drop.
export const AMENITY_NAMES = [
  'Breakfast',
  'Free WiFi',
  'Swimming Pool',
  'Pet Friendly',
  'Parking',
  'Gym',
  'Air Conditioning',
  'Spa',
] as const;

export type AmenityName = (typeof AMENITY_NAMES)[number];
