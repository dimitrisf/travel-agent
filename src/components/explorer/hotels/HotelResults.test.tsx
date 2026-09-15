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
// count overline, empty state, and per-hotel grouping. HotelCard has
// its own tests.
vi.mock('./HotelCard', () => ({
  HotelCard: ({ rooms }: { rooms: HotelResult[] }) => (
    <div data-testid="hotel-card" data-rooms={rooms.length}>
      {rooms[0].hotel}
    </div>
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

  it('renders one card per unique hotel_id and a count overline (hotels + rooms)', () => {
    const data = [
      make({ hotel_id: 1, room_type_id: 1, hotel: 'A' }),
      make({ hotel_id: 2, room_type_id: 2, hotel: 'B' }),
      make({ hotel_id: 3, room_type_id: 3, hotel: 'C' }),
    ];
    render(<HotelResults stay={STAY} data={data} />);
    expect(screen.getByText('3 hotels · 3 rooms')).toBeInTheDocument();
    expect(screen.getAllByTestId('hotel-card')).toHaveLength(3);
  });

  it('groups multiple room types under the same hotel_id into one card and counts them separately in the overline', () => {
    // Same shape the API returns: 2 hotels, 2 room types each → 4
    // flat rows in, 2 grouped cards out — but 4 rooms in the count.
    const data = [
      make({ hotel_id: 1, room_type_id: 1, hotel: 'A', room_type: 'Std Double' }),
      make({ hotel_id: 1, room_type_id: 2, hotel: 'A', room_type: 'Std Twin' }),
      make({ hotel_id: 2, room_type_id: 3, hotel: 'B', room_type: 'Std Double' }),
      make({ hotel_id: 2, room_type_id: 4, hotel: 'B', room_type: 'Std Twin' }),
    ];
    render(<HotelResults stay={STAY} data={data} />);
    expect(screen.getByText('2 hotels · 4 rooms')).toBeInTheDocument();
    const cards = screen.getAllByTestId('hotel-card');
    expect(cards).toHaveLength(2);
    // Each card received 2 rooms (the stub reflects rooms.length).
    expect(cards[0]).toHaveAttribute('data-rooms', '2');
    expect(cards[1]).toHaveAttribute('data-rooms', '2');
  });

  it('preserves the API sort order across hotel groups (cheapest first row anchors the group)', () => {
    // A's cheapest is 100; B's cheapest is 90. B should appear first.
    const data = [
      make({ hotel_id: 2, room_type_id: 3, hotel: 'B', total_price: 270, price_per_night: 90 }),
      make({ hotel_id: 1, room_type_id: 1, hotel: 'A', total_price: 300, price_per_night: 100 }),
      make({ hotel_id: 1, room_type_id: 2, hotel: 'A', total_price: 360, price_per_night: 120 }),
      make({ hotel_id: 2, room_type_id: 4, hotel: 'B', total_price: 330, price_per_night: 110 }),
    ];
    render(<HotelResults stay={STAY} data={data} />);
    const cards = screen.getAllByTestId('hotel-card');
    expect(cards[0]).toHaveTextContent('B');
    expect(cards[1]).toHaveTextContent('A');
  });

  it('uses singular "hotel" and "room" when there is exactly one of each', () => {
    render(<HotelResults stay={STAY} data={[make()]} />);
    expect(screen.getByText('1 hotel · 1 room')).toBeInTheDocument();
  });
});
