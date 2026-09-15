import { describe, it, expect } from 'vitest';

import { buildProposePayload, cartHasItems } from './buildProposePayload';
import type {
  SelectedFlight,
  SelectedHotel,
} from '@/context/SelectionContext';
import type { Cart } from '@/types/booking';

const outbound: SelectedFlight = {
  flight_instance_id: 101,
  cabin_class: 'economy',
  adults: 2,
  children: 1,
  priceEUR: 200,
  totalEUR: 600,
  label: 'Aegean A3 824 · ATH → BER',
};

const inbound: SelectedFlight = {
  flight_instance_id: 303,
  cabin_class: 'economy',
  adults: 2,
  children: 1,
  priceEUR: 180,
  totalEUR: 540,
  label: 'Aegean A3 825 · BER → ATH',
};

const hotel: SelectedHotel = {
  room_type_id: 55,
  checkin: '2026-09-05',
  checkout: '2026-09-08',
  guests: 2,
  rooms: 1,
  nights: 3,
  pricePerNightEUR: 130,
  totalEUR: 390,
  label: 'Brooklyn Bay Inn · Standard',
};

const KEY = 'explorer:test-key';

describe('cartHasItems', () => {
  it('returns false for a fully-empty cart', () => {
    expect(
      cartHasItems({
        outboundFlight: null,
        inboundFlight: null,
        hotel: null,
      }),
    ).toBe(false);
  });

  it('returns true when any single slot is filled', () => {
    expect(
      cartHasItems({ outboundFlight: outbound, inboundFlight: null, hotel: null }),
    ).toBe(true);
    expect(
      cartHasItems({ outboundFlight: null, inboundFlight: inbound, hotel: null }),
    ).toBe(true);
    expect(
      cartHasItems({ outboundFlight: null, inboundFlight: null, hotel }),
    ).toBe(true);
  });
});

describe('buildProposePayload', () => {
  it('outbound-only cart produces a single flight leg and no hotels', () => {
    const cart: Cart = {
      outboundFlight: outbound,
      inboundFlight: null,
      hotel: null,
    };
    expect(buildProposePayload(cart, KEY)).toEqual({
      idempotency_key: KEY,
      flights: [
        {
          flight_instance_id: 101,
          cabin_class: 'economy',
          adults: 2,
          children: 1,
        },
      ],
      hotels: [],
    });
  });

  it('round-trip cart produces two flight legs preserving adults + children', () => {
    const cart: Cart = {
      outboundFlight: outbound,
      inboundFlight: inbound,
      hotel: null,
    };
    const payload = buildProposePayload(cart, KEY);
    expect(payload.flights).toHaveLength(2);
    expect(payload.flights?.[0].flight_instance_id).toBe(101);
    expect(payload.flights?.[1].flight_instance_id).toBe(303);
    // adults + children carried through verbatim on both legs.
    expect(payload.flights?.[0]).toMatchObject({ adults: 2, children: 1 });
    expect(payload.flights?.[1]).toMatchObject({ adults: 2, children: 1 });
  });

  it('hotel-only cart produces a single stay and no flights', () => {
    const cart: Cart = {
      outboundFlight: null,
      inboundFlight: null,
      hotel,
    };
    expect(buildProposePayload(cart, KEY)).toEqual({
      idempotency_key: KEY,
      flights: [],
      hotels: [
        {
          room_type_id: 55,
          checkin: '2026-09-05',
          checkout: '2026-09-08',
          guests: 2,
          rooms: 1,
        },
      ],
    });
  });

  it('full cart (outbound + inbound + hotel) carries everything through', () => {
    const cart: Cart = {
      outboundFlight: outbound,
      inboundFlight: inbound,
      hotel,
    };
    const payload = buildProposePayload(cart, KEY);
    expect(payload.flights).toHaveLength(2);
    expect(payload.hotels).toHaveLength(1);
    expect(payload.idempotency_key).toBe(KEY);
  });

  it('never includes the label / priceEUR / totalEUR display fields', () => {
    const cart: Cart = {
      outboundFlight: outbound,
      inboundFlight: null,
      hotel,
    };
    const payload = buildProposePayload(cart, KEY);
    // Display-only fields must not leak to the server — they're not on
    // the propose_booking input schema and would either be dropped by
    // zod or cause a strict-parse failure depending on how the schema
    // evolves. Keep the payload clean.
    expect(payload.flights?.[0]).not.toHaveProperty('label');
    expect(payload.flights?.[0]).not.toHaveProperty('priceEUR');
    expect(payload.flights?.[0]).not.toHaveProperty('totalEUR');
    expect(payload.hotels?.[0]).not.toHaveProperty('label');
    expect(payload.hotels?.[0]).not.toHaveProperty('pricePerNightEUR');
    expect(payload.hotels?.[0]).not.toHaveProperty('nights');
  });
});
