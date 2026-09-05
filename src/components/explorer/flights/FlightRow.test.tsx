// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FlightRow } from './FlightRow';
import { SelectionProvider } from '@/context/SelectionContext';
import type { CabinClass } from '@/lib/pricing';
import type { FlightResult } from '@/lib/services/FlightService';

function make(overrides: Partial<FlightResult> = {}): FlightResult {
  return {
    flight_instance_id: 100,
    flight_number: '824',
    airline: 'A3',
    departure: '2026-09-15T09:40',
    arrival: '2026-09-15T11:20',
    price: 138,
    currency: 'EUR',
    stops: 0,
    duration_minutes: 100,
    origin: { airport: 'Athens Intl', iata: 'ATH', city: 'Athens' },
    destination: { airport: 'Berlin Brandenburg', iata: 'BER', city: 'Berlin' },
    ...overrides,
  };
}

// FlightRow reads SelectionContext via useSelection, so every render
// needs the provider around it. The tests don't care about persisted
// state across cases — sessionStorage.clear() in beforeEach resets it.
function renderRow(
  props: { flight?: FlightResult; passengers?: number; cabinClass?: CabinClass } = {},
) {
  const {
    flight = make(),
    passengers = 1,
    cabinClass = 'economy' as CabinClass,
  } = props;
  return render(
    <SelectionProvider>
      <FlightRow
        flight={flight}
        passengers={passengers}
        cabinClass={cabinClass}
      />
    </SelectionProvider>,
  );
}

describe('FlightRow', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders airline + flight number, times, duration, and route', () => {
    renderRow();
    expect(screen.getByText('A3 824')).toBeInTheDocument();
    expect(screen.getByText('09:40 → 11:20')).toBeInTheDocument();
    expect(screen.getByText('1h 40m')).toBeInTheDocument();
    expect(screen.getByText('ATH – BER')).toBeInTheDocument();
  });

  it('shows the per-seat price for a single passenger', () => {
    renderRow();
    expect(screen.getByText('€138')).toBeInTheDocument();
    // No "×" breakdown line for a solo traveler.
    expect(screen.queryByText(/× 1/)).not.toBeInTheDocument();
  });

  it('multiplies price by passenger count and shows the breakdown', () => {
    renderRow({ passengers: 3 });
    expect(screen.getByText('€414')).toBeInTheDocument();
    expect(screen.getByText('€138 × 3')).toBeInTheDocument();
  });

  it('renders a stops chip only when stops > 0', () => {
    const { rerender } = renderRow();
    expect(screen.queryByText(/stop/)).not.toBeInTheDocument();

    rerender(
      <SelectionProvider>
        <FlightRow
          flight={make({ stops: 1 })}
          passengers={1}
          cabinClass="economy"
        />
      </SelectionProvider>,
    );
    expect(screen.getByText('1 stop')).toBeInTheDocument();

    rerender(
      <SelectionProvider>
        <FlightRow
          flight={make({ stops: 2 })}
          passengers={1}
          cabinClass="economy"
        />
      </SelectionProvider>,
    );
    expect(screen.getByText('2 stops')).toBeInTheDocument();
  });

  it('shows a non-EUR currency ticker inline with the price', () => {
    renderRow({ flight: make({ currency: 'USD', price: 200 }), passengers: 2 });
    expect(screen.getByText('USD 400')).toBeInTheDocument();
  });

  it('renders the Add-to-booking toggle as "Add" when nothing is selected', () => {
    renderRow();
    const btn = screen.getByRole('button', { name: /Add .* to booking/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveTextContent(/Add/);
  });

  it('flips to "Selected" (aria-pressed=true) after a click and stores the payload', async () => {
    const user = userEvent.setup();
    renderRow({ passengers: 2, cabinClass: 'business' });
    await user.click(screen.getByRole('button', { name: /Add .* to booking/i }));
    const now = screen.getByRole('button', { name: /Remove .* from booking/i });
    expect(now).toHaveAttribute('aria-pressed', 'true');
    expect(now).toHaveTextContent(/Selected/);
    // Payload written to sessionStorage carries the full search context —
    // cabin + seats + per-seat and total price — so a later booking-
    // page can build propose_booking without re-fetching.
    const raw = sessionStorage.getItem('explorer:selection:v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.flight).toMatchObject({
      flight_instance_id: 100,
      cabin_class: 'business',
      seats: 2,
      priceEUR: 138,
      totalEUR: 276,
    });
  });

  it('toggles off when the currently-selected row is clicked again', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name: /Add .* to booking/i }));
    await user.click(
      screen.getByRole('button', { name: /Remove .* from booking/i }),
    );
    const btn = screen.getByRole('button', { name: /Add .* to booking/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});
