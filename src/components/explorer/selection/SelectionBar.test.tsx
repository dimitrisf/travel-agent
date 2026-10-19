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
import { SettingsProvider } from '@/context/SettingsContext';
import { formatBookingDateRange, formatFlightLabel } from '@/utils/booking';

// usePathname is what SelectionBar consults to decide whether to
// show the "Go to booking" button (hidden on /explorer/booking).
// The mock is controllable per test via `mockPathname`.
let mockPathname = '/explorer/flights';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

const STORAGE_KEY = 'explorer:selection:v3';

const outbound: SelectedFlight = {
  flight_instance_id: 101,
  cabin_class: 'economy',
  adults: 2,
  children: 0,
  priceEUR: 200,
  totalEUR: 400,
  airline: 'Aegean',
  flight_number: 'A3 824',
  origin_iata: 'ATH',
  destination_iata: 'BER',
  departure: '2026-09-05T09:40:00Z',
};

const inbound: SelectedFlight = {
  flight_instance_id: 303,
  cabin_class: 'economy',
  adults: 2,
  children: 0,
  priceEUR: 180,
  totalEUR: 360,
  airline: 'Aegean',
  flight_number: 'A3 825',
  origin_iata: 'BER',
  destination_iata: 'ATH',
  departure: '2026-09-10T18:00:00Z',
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
  // Pin the SettingsProvider to 'eu' so useDateLocale returns the
  // same 'en-GB' the test's expected strings use. Without this,
  // the default ('auto') resolves to the test environment's system
  // locale, which drifts between dev and CI.
  return render(
    <SettingsProvider initial={{ dateFormat: 'eu' }}>
      <SelectionProvider>
        <SelectionBar />
      </SelectionProvider>
    </SettingsProvider>,
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
    expect(await screen.findByText(formatFlightLabel(outbound, 'en-GB'))).toBeInTheDocument();
    expect(screen.queryByText(formatFlightLabel(inbound, 'en-GB'))).toBeNull();
    expect(screen.queryByText(hotel.label)).toBeNull();
    expect(screen.getByText(/Outbound:/)).toBeInTheDocument();
    // "400" appears twice: once as the per-line price, once as the
    // total (equal here because there's only one selection). The
    // "Total" label and the amount are now separate text nodes, so
    // we assert each independently.
    const priceNodes = screen.getAllByText(/400/);
    expect(priceNodes.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('summarises a round-trip cart (outbound + inbound), lists per-line prices, and sums totals', async () => {
    seedSelection({ outboundFlight: outbound, inboundFlight: inbound });
    renderBar();
    expect(await screen.findByText(formatFlightLabel(outbound, 'en-GB'))).toBeInTheDocument();
    expect(screen.getByText(formatFlightLabel(inbound, 'en-GB'))).toBeInTheDocument();
    expect(screen.getByText(/Outbound:/)).toBeInTheDocument();
    expect(screen.getByText(/Return:/)).toBeInTheDocument();
    // Per-line prices appear next to each item. Match the number
    // substring only — formatEUR renders locale-dependent glyphs
    // ("400,00 €" vs. "€400.00") and any anchor would fight one of
    // them. The three values (400, 360, 760) don't overlap as
    // substrings so a bare number regex is uniquely identifying.
    expect(screen.getByText(/400/)).toBeInTheDocument();
    expect(screen.getByText(/360/)).toBeInTheDocument();
    // "Total" and the sum are now separate text nodes. 400 + 360 = 760
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText(/760/)).toBeInTheDocument();
  });

  it('summarises a full cart (outbound + inbound + hotel) with all three per-line prices and a total', async () => {
    seedSelection({
      outboundFlight: outbound,
      inboundFlight: inbound,
      hotel,
    });
    renderBar();
    expect(await screen.findByText(formatFlightLabel(outbound, 'en-GB'))).toBeInTheDocument();
    expect(screen.getByText(formatFlightLabel(inbound, 'en-GB'))).toBeInTheDocument();
    // Hotel label is now rendered as `${hotel.label} · <dates>` (one
    // text node), so match it as a substring rather than exact text.
    expect(screen.getByText(hotel.label, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Hotel:/)).toBeInTheDocument();
    // Three distinct per-line prices (loose regex per glyph — the
    // whole-number substring is enough for uniqueness at these
    // values). No start-anchor because formatEUR renders locale-
    // dependent glyphs (€ can be prefix or suffix).
    expect(screen.getByText(/400/)).toBeInTheDocument();
    expect(screen.getByText(/360/)).toBeInTheDocument();
    expect(screen.getByText(/390/)).toBeInTheDocument();
    // "Total" and the sum are separate text nodes. 400 + 360 + 390 = 1150
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText(/1[,.]?150/)).toBeInTheDocument();
  });

  it('shows the hotel check-in → check-out date range next to the hotel label', async () => {
    seedSelection({ hotel });
    renderBar();
    // The dates are appended to the hotel label with a ` · ` separator
    // so they render in the same body2 font as the flight date segment
    // — all one text node. `exact: false` runs a substring match on
    // that node, which also makes the assertion locale-agnostic
    // (formatDate renders different glyphs under, say, a Greek system
    // locale).
    const expected = formatBookingDateRange(
      hotel.checkin,
      hotel.checkout,
      'en-GB',
    );
    expect(await screen.findByText(expected, { exact: false })).toBeInTheDocument();
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
