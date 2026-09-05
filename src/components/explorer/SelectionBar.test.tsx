// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SelectionBar } from './SelectionBar';
import {
  SelectionProvider,
  type SelectedFlight,
  type SelectedHotel,
} from '@/context/SelectionContext';

const STORAGE_KEY = 'explorer:selection:v1';

const flight: SelectedFlight = {
  flight_instance_id: 101,
  cabin_class: 'economy',
  seats: 2,
  priceEUR: 200,
  totalEUR: 400,
  label: 'Aegean A3 824 · ATH → BER',
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

// Seed sessionStorage before mounting — the provider's hydrate effect
// reads it and pushes the value into state. Avoids the "state update
// during render" trap of calling toggle*() inside a child component.
function seedSelection(seed: {
  flight?: SelectedFlight;
  hotel?: SelectedHotel;
}) {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      flight: seed.flight ?? null,
      hotel: seed.hotel ?? null,
    }),
  );
}

function renderBar() {
  return render(
    <SelectionProvider>
      <SelectionBar />
    </SelectionProvider>,
  );
}

describe('SelectionBar', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when the cart is empty', () => {
    renderBar();
    expect(
      screen.queryByRole('region', { name: /booking selection/i }),
    ).toBeNull();
  });

  it('summarises a flight-only cart with its total', async () => {
    seedSelection({ flight });
    renderBar();
    // Bar appears once the hydrate effect commits — findBy awaits it.
    // Each selection is rendered on its own line with its label; when
    // only a flight is picked, no hotel label appears.
    expect(await screen.findByText(flight.label)).toBeInTheDocument();
    expect(screen.queryByText(hotel.label)).toBeNull();
    // formatEUR renders locale-dependent glyphs (dot vs comma, symbol
    // before vs after) — assert the amount + currency shape loosely.
    expect(screen.getByText(/Total .*400/)).toBeInTheDocument();
  });

  it('summarises a flight + hotel cart and sums their totals', async () => {
    seedSelection({ flight, hotel });
    renderBar();
    // Both labels appear on their own lines — a previous single-line
    // "1 flight (...) · 1 hotel (...)" layout let the flight's own `·`
    // separators swallow the boundary between the two selections.
    expect(await screen.findByText(flight.label)).toBeInTheDocument();
    expect(screen.getByText(hotel.label)).toBeInTheDocument();
    // 400 + 390 = 790
    expect(screen.getByText(/Total .*790/)).toBeInTheDocument();
  });

  it('the Go to booking button links to /explorer/booking', async () => {
    seedSelection({ flight });
    renderBar();
    const link = await screen.findByRole('link', { name: /go to booking/i });
    expect(link).toHaveAttribute('href', '/explorer/booking');
  });

  it('Clear empties the cart so the bar disappears', async () => {
    const user = userEvent.setup();
    seedSelection({ flight });
    renderBar();
    // Precondition: bar visible after hydrate.
    expect(
      await screen.findByRole('region', { name: /booking selection/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(
      screen.queryByRole('region', { name: /booking selection/i }),
    ).toBeNull();
  });
});
