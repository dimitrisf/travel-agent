// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FlightRow } from './FlightRow';
import { SelectionProvider, type FlightLeg } from '@/context/SelectionContext';
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
// needs the provider around it. sessionStorage.clear() in beforeEach
// resets cart state between cases.
function renderRow(
  props: {
    flight?: FlightResult;
    adults?: number;
    children?: number;
    cabinClass?: CabinClass;
    leg?: FlightLeg;
  } = {},
) {
  const {
    flight = make(),
    adults = 1,
    children = 0,
    cabinClass = 'economy' as CabinClass,
    leg = 'outbound' as FlightLeg,
  } = props;
  return render(
    <SelectionProvider>
      <FlightRow
        flight={flight}
        adults={adults}
        children={children}
        cabinClass={cabinClass}
        leg={leg}
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

  it('multiplies price by adults + children and shows the breakdown', () => {
    renderRow({ adults: 2, children: 1 });
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
          adults={1}
          children={0}
          cabinClass="economy"
          leg="outbound"
        />
      </SelectionProvider>,
    );
    expect(screen.getByText('1 stop')).toBeInTheDocument();

    rerender(
      <SelectionProvider>
        <FlightRow
          flight={make({ stops: 2 })}
          adults={1}
          children={0}
          cabinClass="economy"
          leg="outbound"
        />
      </SelectionProvider>,
    );
    expect(screen.getByText('2 stops')).toBeInTheDocument();
  });

  it('shows a non-EUR currency ticker inline with the price', () => {
    renderRow({
      flight: make({ currency: 'USD', price: 200 }),
      adults: 2,
    });
    expect(screen.getByText('USD 400')).toBeInTheDocument();
  });

  it('renders the Add-to-booking toggle as "Add" when nothing is selected', () => {
    renderRow();
    const btn = screen.getByRole('button', { name: /Add .* to booking/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveTextContent(/Add/);
  });

  it('outbound click stores under outboundFlight with adults + children preserved', async () => {
    const user = userEvent.setup();
    renderRow({ adults: 2, children: 1, cabinClass: 'business', leg: 'outbound' });
    await user.click(screen.getByRole('button', { name: /Add .* to booking/i }));
    const now = screen.getByRole('button', { name: /Remove .* from booking/i });
    expect(now).toHaveAttribute('aria-pressed', 'true');
    expect(now).toHaveTextContent(/Selected/);
    const raw = sessionStorage.getItem('explorer:selection:v2');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.outboundFlight).toMatchObject({
      flight_instance_id: 100,
      cabin_class: 'business',
      adults: 2,
      children: 1,
      priceEUR: 138,
      totalEUR: 414,
    });
    expect(parsed.inboundFlight).toBeNull();
  });

  it('inbound click stores under inboundFlight, leaving outboundFlight untouched', async () => {
    const user = userEvent.setup();
    // Seed an outbound pick first (via storage, so the row doesn't
    // fight React commit ordering) — proves the inbound click
    // doesn't wipe it.
    sessionStorage.setItem(
      'explorer:selection:v2',
      JSON.stringify({
        outboundFlight: {
          flight_instance_id: 999,
          cabin_class: 'economy',
          adults: 1,
          children: 0,
          priceEUR: 100,
          totalEUR: 100,
          label: 'outbound placeholder',
        },
        inboundFlight: null,
        hotel: null,
      }),
    );
    renderRow({ leg: 'inbound' });
    await user.click(screen.getByRole('button', { name: /Add .* to booking/i }));
    const parsed = JSON.parse(
      sessionStorage.getItem('explorer:selection:v2') as string,
    );
    expect(parsed.outboundFlight?.flight_instance_id).toBe(999);
    expect(parsed.inboundFlight?.flight_instance_id).toBe(100);
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
