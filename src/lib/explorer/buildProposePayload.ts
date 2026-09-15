import type { SelectedFlight } from '@/context/SelectionContext';
import type { ProposeBookingInput } from '@/lib';
import type { Cart } from '@/types/booking';

// Assembles a POST /api/booking/propose body from the /explorer cart.
// Kept as a pure function so /explorer/booking's page component stays
// thin and the payload shape is unit-testable without mounting the
// page. The server owns final validation (at-least-one item, no
// duplicate flight_instance_ids, past-date rejection) — this helper
// just does the transform.

export function buildProposePayload(
  cart: Cart,
  idempotencyKey: string,
): ProposeBookingInput {
  const flights = [cart.outboundFlight, cart.inboundFlight]
    .filter((f): f is SelectedFlight => f !== null)
    .map((f) => ({
      flight_instance_id: f.flight_instance_id,
      cabin_class: f.cabin_class,
      adults: f.adults,
      children: f.children,
    }));

  const hotels = cart.hotel
    ? [
        {
          room_type_id: cart.hotel.room_type_id,
          checkin: cart.hotel.checkin,
          checkout: cart.hotel.checkout,
          guests: cart.hotel.guests,
          rooms: cart.hotel.rooms,
        },
      ]
    : [];

  return {
    idempotency_key: idempotencyKey,
    flights,
    hotels,
  };
}

// True when the cart has at least one item — the same rule the server
// enforces via zod refine. Exposed so the page can disable "Propose"
// before a doomed round-trip.
export function cartHasItems(cart: Cart): boolean {
  return (
    cart.outboundFlight !== null ||
    cart.inboundFlight !== null ||
    cart.hotel !== null
  );
}
