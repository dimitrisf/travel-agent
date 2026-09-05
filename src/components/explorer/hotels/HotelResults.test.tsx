// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { HotelResults, type StayContext } from './HotelResults';
import type { HotelResult } from '@/lib/services/HotelService';

const STAY: StayContext = {
  checkin: '2026-09-15',
  checkout: '2026-09-18',
  guests: 2,
  rooms: 1,
};

// Stub the child so this test focuses on the container's behavior:
// count overline, empty state, and per-result rendering. HotelCard has
// its own tests.
vi.mock('./HotelCard', () => ({
  HotelCard: ({ hotel }: { hotel: HotelResult }) => (
    <div data-testid="hotel-card">{hotel.hotel}</div>
  ),
}));

function make(overrides: Partial<HotelResult> = {}): HotelResult {
  return {
    hotel_id: 1,
    room_type_id: 10,
    hotel: 'Test Hotel',
    address: '',
    city: 'Athens',
    stars: 4,
    rating: 8.0,
    room_type: 'Standard',
    price_per_night: 100,
    total_price: 300,
    nights: 3,
    currency: 'EUR',
    amenities: [],
    free_cancellation: true,
    cancellation_description: '',
    ...overrides,
  };
}

describe('HotelResults', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the empty-state message when the array is empty', () => {
    render(<HotelResults stay={STAY} data={[]} />);
    expect(
      screen.getByText('No hotels match those filters.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('hotel-card')).not.toBeInTheDocument();
  });

  it('renders one card per hotel and a count overline', () => {
    const data = [
      make({ room_type_id: 1, hotel: 'A' }),
      make({ room_type_id: 2, hotel: 'B' }),
      make({ room_type_id: 3, hotel: 'C' }),
    ];
    render(<HotelResults stay={STAY} data={data} />);
    expect(screen.getByText('3 hotels')).toBeInTheDocument();
    expect(screen.getAllByTestId('hotel-card')).toHaveLength(3);
  });

  it('uses singular "hotel" when there is exactly one', () => {
    render(<HotelResults stay={STAY} data={[make()]} />);
    expect(screen.getByText('1 hotel')).toBeInTheDocument();
  });
});
