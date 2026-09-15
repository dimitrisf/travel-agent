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

// HotelCard's RoomRow children read SelectionContext via useSelection,
// so every render needs the provider around it. Tests reset
// sessionStorage in beforeEach so cases don't leak selection state
// between each other.
function renderCard(props: { rooms?: HotelResult[]; stay?: StayContext } = {}) {
  const { rooms = [make()], stay = DEFAULT_STAY } = props;
  return render(
    <SelectionProvider>
      <HotelCard rooms={rooms} stay={stay} />
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

  it('renders the hotel name as an h3 (once, even with multiple rooms)', () => {
    renderCard({
      rooms: [
        make({ room_type_id: 10, room_type: 'Standard Double' }),
        make({ room_type_id: 11, room_type: 'Standard Twin' }),
      ],
    });
    const headings = screen.getAllByRole('heading', {
      level: 3,
      name: 'Athens Acropolis Suites',
    });
    expect(headings).toHaveLength(1);
  });

  it('renders the shared hotel metadata (address, amenities, cancellation) once', () => {
    renderCard({
      rooms: [
        make({ room_type_id: 10 }),
        make({ room_type_id: 11, room_type: 'Deluxe King' }),
      ],
    });
    expect(
      screen.getAllByText('Dionysiou Areopagitou 25, 11742 Athens'),
    ).toHaveLength(1);
    expect(screen.getAllByText('Breakfast')).toHaveLength(1);
    expect(
      screen.getAllByText('Free cancellation up to 24 hours before check-in.'),
    ).toHaveLength(1);
  });

  it('is expanded by default — room-type detail is visible without clicking', () => {
    renderCard({
      rooms: [
        make({ room_type_id: 10, room_type: 'Standard Double' }),
        make({ room_type_id: 11, room_type: 'Standard Twin' }),
      ],
    });
    // Room-type detail rows are in the DOM on mount.
    expect(screen.getByText('Standard Double · Athens')).toBeInTheDocument();
    expect(screen.getByText('Standard Twin · Athens')).toBeInTheDocument();
    // Per-room Add buttons are visible.
    expect(
      screen.getAllByRole('button', { name: /to booking/i }),
    ).toHaveLength(2);
    // The chevron reports aria-expanded=true and labels itself as
    // "Hide" (the toggle inverts to collapse).
    expect(
      screen.getByRole('button', { name: /Hide room types/i }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows a summary line with the room count and cheapest total (visible in both states)', () => {
    renderCard({
      rooms: [
        make({ room_type_id: 10, room_type: 'Standard Double', total_price: 190 }),
        make({ room_type_id: 11, room_type: 'Standard Twin', total_price: 200 }),
      ],
    });
    // "2 room types · from €190" — the summary is always visible, so
    // the user can price-compare hotels even after collapsing.
    expect(screen.getByText('2 room types · from €190')).toBeInTheDocument();
  });

  it('uses singular "room type" when the hotel has exactly one room', () => {
    renderCard({ rooms: [make({ total_price: 145 })] });
    expect(screen.getByText('1 room type · from €145')).toBeInTheDocument();
  });

  it('chevron collapses the room list on click and re-expands on a second click', async () => {
    const user = userEvent.setup();
    renderCard({
      rooms: [
        make({ room_type_id: 10, room_type: 'Standard Double' }),
        make({ room_type_id: 11, room_type: 'Standard Twin' }),
      ],
    });
    // Starts expanded.
    expect(screen.getByText('Standard Double · Athens')).toBeInTheDocument();
    const hideBtn = screen.getByRole('button', { name: /Hide room types/i });
    expect(hideBtn).toHaveAttribute('aria-expanded', 'true');

    // Click to collapse.
    await user.click(hideBtn);
    expect(screen.queryByText('Standard Double · Athens')).toBeNull();
    const showBtn = screen.getByRole('button', { name: /Show room types/i });
    expect(showBtn).toHaveAttribute('aria-expanded', 'false');

    // Click again to re-expand.
    await user.click(showBtn);
    expect(screen.getByText('Standard Double · Athens')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Hide room types/i }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders one row per room type with its own price', () => {
    renderCard({
      rooms: [
        make({ room_type_id: 10, room_type: 'Standard Double', price_per_night: 95, total_price: 190, nights: 2 }),
        make({ room_type_id: 11, room_type: 'Standard Twin', price_per_night: 100, total_price: 200, nights: 2 }),
      ],
    });
    // Both room types visible.
    expect(screen.getByText('Standard Double · Athens')).toBeInTheDocument();
    expect(screen.getByText('Standard Twin · Athens')).toBeInTheDocument();
    // The summary line embeds "€190" inside "2 room types · from €190",
    // but getByText matches whole text nodes, so the RoomRow's isolated
    // "€190" is the only match.
    expect(screen.getByText('€190')).toBeInTheDocument();
    expect(screen.getByText('€200')).toBeInTheDocument();
    // Both per-night lines visible.
    expect(screen.getByText('€95/night × 2 nights')).toBeInTheDocument();
    expect(screen.getByText('€100/night × 2 nights')).toBeInTheDocument();
  });

  it('renders singular "night" for a one-night stay', () => {
    renderCard({ rooms: [make({ nights: 1, total_price: 145 })] });
    expect(screen.getByText('€145/night × 1 night')).toBeInTheDocument();
  });

  it('renders the numeric rating with one decimal', () => {
    renderCard({ rooms: [make({ rating: 9 })] });
    expect(screen.getByText('9.0 / 10')).toBeInTheDocument();
  });

  it('renders an Add-to-booking toggle per room row, both starting as "Add"', () => {
    renderCard({
      rooms: [
        make({ room_type_id: 10, room_type: 'Standard Double' }),
        make({ room_type_id: 11, room_type: 'Standard Twin' }),
      ],
    });
    const buttons = screen.getAllByRole('button', { name: /Add .* to booking/i });
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) {
      expect(btn).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('toggling one room row does not select the sibling row', async () => {
    const user = userEvent.setup();
    renderCard({
      rooms: [
        make({ room_type_id: 10, room_type: 'Standard Double' }),
        make({ room_type_id: 11, room_type: 'Standard Twin' }),
      ],
    });
    const doubleBtn = screen.getByRole('button', {
      name: /Standard Double to booking/i,
    });
    await user.click(doubleBtn);

    // The clicked row is now Selected; the sibling is still Add.
    expect(
      screen.getByRole('button', {
        name: /Standard Double from booking/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', {
        name: /Standard Twin to booking/i,
      }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('flips to "Selected" after a click and stores the payload with the stay context', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Add .* to booking/i }));
    const now = screen.getByRole('button', { name: /Remove .* from booking/i });
    expect(now).toHaveAttribute('aria-pressed', 'true');
    expect(now).toHaveTextContent(/Selected/);
    const raw = sessionStorage.getItem('explorer:selection:v2');
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

  it('toggles off when the currently-selected row is clicked again', async () => {
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
