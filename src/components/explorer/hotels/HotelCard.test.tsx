// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { HotelCard } from './HotelCard';
import type { HotelResult } from '@/lib/services/HotelService';

function make(overrides: Partial<HotelResult> = {}): HotelResult {
  return {
    hotel_id: 1,
    room_type_id: 10,
    hotel: 'Athens Acropolis Suites',
    address: 'Dionysiou Areopagitou 25, 11742 Athens',
    city: 'Athens',
    stars: 4,
    rating: 8.6,
    room_type: 'Standard',
    price_per_night: 145,
    total_price: 435,
    nights: 3,
    currency: 'EUR',
    amenities: ['Breakfast', 'Free WiFi', 'Swimming Pool'],
    free_cancellation: true,
    cancellation_description: 'Free cancellation up to 24 hours before check-in.',
    ...overrides,
  };
}

describe('HotelCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the hotel name as an h3', () => {
    render(<HotelCard hotel={make()} />);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Athens Acropolis Suites' }),
    ).toBeInTheDocument();
  });

  it('renders address, room type and city', () => {
    render(<HotelCard hotel={make()} />);
    expect(
      screen.getByText('Dionysiou Areopagitou 25, 11742 Athens'),
    ).toBeInTheDocument();
    expect(screen.getByText('Standard · Athens')).toBeInTheDocument();
  });

  it('renders one chip per amenity', () => {
    render(<HotelCard hotel={make()} />);
    for (const a of ['Breakfast', 'Free WiFi', 'Swimming Pool']) {
      expect(screen.getByText(a)).toBeInTheDocument();
    }
  });

  it('renders the numeric rating with one decimal', () => {
    render(<HotelCard hotel={make({ rating: 9 })} />);
    expect(screen.getByText('9.0 / 10')).toBeInTheDocument();
  });

  it('renders total and per-night price with € prefix', () => {
    render(<HotelCard hotel={make()} />);
    expect(screen.getByText('€435')).toBeInTheDocument();
    expect(screen.getByText('€145/night × 3 nights')).toBeInTheDocument();
  });

  it('renders singular "night" for a one-night stay', () => {
    render(
      <HotelCard hotel={make({ nights: 1, total_price: 145 })} />,
    );
    expect(screen.getByText('€145/night × 1 night')).toBeInTheDocument();
  });

  it('renders the cancellation description', () => {
    render(<HotelCard hotel={make()} />);
    expect(
      screen.getByText(
        'Free cancellation up to 24 hours before check-in.',
      ),
    ).toBeInTheDocument();
  });
});
