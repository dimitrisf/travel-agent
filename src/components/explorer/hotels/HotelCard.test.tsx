// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HotelCard } from './HotelCard';
import { SelectionProvider } from '@/context/SelectionContext';
import type { StayContext } from './HotelResults';
import type { HotelResult } from '@/lib/services/HotelService';

const DEFAULT_STAY: StayContext = {
  checkin: '2026-09-15',
  checkout: '2026-09-18',
  guests: 2,
  rooms: 1,
};

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

// HotelCard reads SelectionContext via useSelection, so every render
// needs the provider around it. Tests reset sessionStorage in
// beforeEach so cases don't leak selection state to each other.
function renderCard(props: { hotel?: HotelResult; stay?: StayContext } = {}) {
  const { hotel = make(), stay = DEFAULT_STAY } = props;
  return render(
    <SelectionProvider>
      <HotelCard hotel={hotel} stay={stay} />
    </SelectionProvider>,
  );
}

describe('HotelCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the hotel name as an h3', () => {
    renderCard();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Athens Acropolis Suites' }),
    ).toBeInTheDocument();
  });

  it('renders address, room type and city', () => {
    renderCard();
    expect(
      screen.getByText('Dionysiou Areopagitou 25, 11742 Athens'),
    ).toBeInTheDocument();
    expect(screen.getByText('Standard · Athens')).toBeInTheDocument();
  });

  it('renders one chip per amenity', () => {
    renderCard();
    for (const a of ['Breakfast', 'Free WiFi', 'Swimming Pool']) {
      expect(screen.getByText(a)).toBeInTheDocument();
    }
  });

  it('renders the numeric rating with one decimal', () => {
    renderCard({ hotel: make({ rating: 9 }) });
    expect(screen.getByText('9.0 / 10')).toBeInTheDocument();
  });

  it('renders total and per-night price with € prefix', () => {
    renderCard();
    expect(screen.getByText('€435')).toBeInTheDocument();
    expect(screen.getByText('€145/night × 3 nights')).toBeInTheDocument();
  });

  it('renders singular "night" for a one-night stay', () => {
    renderCard({ hotel: make({ nights: 1, total_price: 145 }) });
    expect(screen.getByText('€145/night × 1 night')).toBeInTheDocument();
  });

  it('renders the cancellation description', () => {
    renderCard();
    expect(
      screen.getByText('Free cancellation up to 24 hours before check-in.'),
    ).toBeInTheDocument();
  });

  it('renders the Add-to-booking toggle as "Add" when nothing is selected', () => {
    renderCard();
    const btn = screen.getByRole('button', { name: /Add .* to booking/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveTextContent(/Add/);
  });

  it('flips to "Selected" after a click and stores the payload with the stay context', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Add .* to booking/i }));
    const now = screen.getByRole('button', { name: /Remove .* from booking/i });
    expect(now).toHaveAttribute('aria-pressed', 'true');
    expect(now).toHaveTextContent(/Selected/);
    const raw = sessionStorage.getItem('explorer:selection:v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.hotel).toMatchObject({
      room_type_id: 10,
      checkin: '2026-09-15',
      checkout: '2026-09-18',
      guests: 2,
      rooms: 1,
      nights: 3,
      pricePerNightEUR: 145,
      totalEUR: 435,
    });
  });

  it('toggles off when the currently-selected card is clicked again', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Add .* to booking/i }));
    await user.click(
      screen.getByRole('button', { name: /Remove .* from booking/i }),
    );
    const btn = screen.getByRole('button', { name: /Add .* to booking/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});
