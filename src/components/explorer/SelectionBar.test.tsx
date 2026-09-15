// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SelectionBar } from './SelectionBar';
import {
  SelectionProvider,
  type SelectedFlight,
  type SelectedHotel,
} from '@/context/SelectionContext';

// usePathname is what SelectionBar consults to decide whether to
// show the "Go to booking" button (hidden on /explorer/booking).
// The mock is controllable per test via `mockPathname`.
let mockPathname = '/explorer/flights';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

const STORAGE_KEY = 'explorer:selection:v2';

const outbound: SelectedFlight = {
  flight_instance_id: 101,
  cabin_class: 'economy',
  adults: 2,
  children: 0,
  priceEUR: 200,
  totalEUR: 400,
  label: 'Aegean A3 824 · ATH → BER',
};

const inbound: SelectedFlight = {
  flight_instance_id: 303,
  cabin_class: 'economy',
  adults: 2,
  children: 0,
  priceEUR: 180,
  totalEUR: 360,
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

// Seed sessionStorage before mounting — the provider's hydrate effect
// reads it and pushes the value into state. Avoids the "state update
// during render" trap of calling toggle*() inside a child component.
function seedSelection(seed: {
  outboundFlight?: SelectedFlight;
  inboundFlight?: SelectedFlight;
  hotel?: SelectedHotel;
}) {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      outboundFlight: seed.outboundFlight ?? null,
      inboundFlight: seed.inboundFlight ?? null,
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
    mockPathname = '/explorer/flights';
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

  it('summarises an outbound-only cart with its per-line price and total', async () => {
    seedSelection({ outboundFlight: outbound });
    renderBar();
    expect(await screen.findByText(outbound.label)).toBeInTheDocument();
    expect(screen.queryByText(inbound.label)).toBeNull();
    expect(screen.queryByText(hotel.label)).toBeNull();
    expect(screen.getByText(/Outbound:/)).toBeInTheDocument();
    // formatEUR renders locale-dependent glyphs — assert loosely on
    // both the per-line price and the total (they're equal here since
    // there's only one selection).
    const priceNodes = screen.getAllByText(/400/);
    expect(priceNodes.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Total .*400/)).toBeInTheDocument();
  });

  it('summarises a round-trip cart (outbound + inbound), lists per-line prices, and sums totals', async () => {
    seedSelection({ outboundFlight: outbound, inboundFlight: inbound });
    renderBar();
    expect(await screen.findByText(outbound.label)).toBeInTheDocument();
    expect(screen.getByText(inbound.label)).toBeInTheDocument();
    expect(screen.getByText(/Outbound:/)).toBeInTheDocument();
    expect(screen.getByText(/Return:/)).toBeInTheDocument();
    // Per-line prices appear next to each item.
    expect(screen.getByText(/^400/)).toBeInTheDocument();
    expect(screen.getByText(/^360/)).toBeInTheDocument();
    // 400 + 360 = 760
    expect(screen.getByText(/Total .*760/)).toBeInTheDocument();
  });

  it('summarises a full cart (outbound + inbound + hotel) with all three per-line prices and a total', async () => {
    seedSelection({
      outboundFlight: outbound,
      inboundFlight: inbound,
      hotel,
    });
    renderBar();
    expect(await screen.findByText(outbound.label)).toBeInTheDocument();
    expect(screen.getByText(inbound.label)).toBeInTheDocument();
    expect(screen.getByText(hotel.label)).toBeInTheDocument();
    expect(screen.getByText(/Hotel:/)).toBeInTheDocument();
    // Three distinct per-line prices (loose regex per glyph — the
    // whole-number substring is enough for uniqueness at these
    // values).
    expect(screen.getByText(/^400/)).toBeInTheDocument();
    expect(screen.getByText(/^360/)).toBeInTheDocument();
    expect(screen.getByText(/^390/)).toBeInTheDocument();
    // 400 + 360 + 390 = 1150
    expect(screen.getByText(/Total .*1[,.]?150/)).toBeInTheDocument();
  });

  it('the Go to booking button links to /explorer/booking when off the booking page', async () => {
    seedSelection({ outboundFlight: outbound });
    renderBar();
    const link = await screen.findByRole('link', { name: /go to booking/i });
    expect(link).toHaveAttribute('href', '/explorer/booking');
  });

  it('hides the Go to booking button when the user is already on /explorer/booking', async () => {
    mockPathname = '/explorer/booking';
    seedSelection({ outboundFlight: outbound });
    renderBar();
    // The bar still renders (cart is non-empty) — but the "Go to
    // booking" button is gone. The Clear button is still there.
    expect(
      await screen.findByRole('region', { name: /booking selection/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /go to booking/i }),
    ).toBeNull();
  });

  it('Clear empties the cart so the bar disappears', async () => {
    const user = userEvent.setup();
    seedSelection({ outboundFlight: outbound, hotel });
    renderBar();
    expect(
      await screen.findByRole('region', { name: /booking selection/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(
      screen.queryByRole('region', { name: /booking selection/i }),
    ).toBeNull();
  });
});
