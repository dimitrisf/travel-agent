// Turns the hotels search form's state into the GET /api/hotels URL.
// Only includes params that differ from the API's defaults so the curl
// command the user copies stays as short and readable as possible.

export type HotelsQueryInput = {
  city: string;
  checkin: string;
  checkout: string;
  guests: number;
  rooms: number;
  minStars: number | undefined;
  maxPrice: number | undefined;
  breakfastRequired: boolean;
  freeCancellation: boolean;
  petFriendly: boolean;
};

export function buildHotelsQuery(input: HotelsQueryInput): string {
  const params = new URLSearchParams();

  if (input.city) params.set('city', input.city);

  if (input.checkin) params.set('checkin', input.checkin);

  if (input.checkout) params.set('checkout', input.checkout);

  if (input.guests !== 2) params.set('guests', String(input.guests));

  if (input.rooms !== 1) params.set('rooms', String(input.rooms));

  if (input.minStars !== undefined)
    params.set('min_stars', String(input.minStars));

  if (input.maxPrice !== undefined)
    params.set('max_price', String(input.maxPrice));

  if (input.breakfastRequired) params.set('breakfast_required', 'true');

  if (input.freeCancellation) params.set('free_cancellation', 'true');

  if (input.petFriendly) params.set('pet_friendly', 'true');

  return `/api/hotels?${params.toString()}`;
}
