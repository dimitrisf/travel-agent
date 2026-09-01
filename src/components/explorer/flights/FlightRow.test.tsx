// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { FlightRow } from './FlightRow';
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

describe('FlightRow', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders airline + flight number, times, duration, and route', () => {
    render(<FlightRow flight={make()} passengers={1} />);
    expect(screen.getByText('A3 824')).toBeInTheDocument();
    expect(screen.getByText('09:40 → 11:20')).toBeInTheDocument();
    expect(screen.getByText('1h 40m')).toBeInTheDocument();
    expect(screen.getByText('ATH – BER')).toBeInTheDocument();
  });

  it('shows the per-seat price for a single passenger', () => {
    render(<FlightRow flight={make()} passengers={1} />);
    expect(screen.getByText('€138')).toBeInTheDocument();
    // No "×" breakdown line for a solo traveler.
    expect(screen.queryByText(/× 1/)).not.toBeInTheDocument();
  });

  it('multiplies price by passenger count and shows the breakdown', () => {
    render(<FlightRow flight={make()} passengers={3} />);
    expect(screen.getByText('€414')).toBeInTheDocument();
    expect(screen.getByText('€138 × 3')).toBeInTheDocument();
  });

  it('renders a stops chip only when stops > 0', () => {
    const { rerender } = render(<FlightRow flight={make()} passengers={1} />);
    expect(screen.queryByText(/stop/)).not.toBeInTheDocument();

    rerender(<FlightRow flight={make({ stops: 1 })} passengers={1} />);
    expect(screen.getByText('1 stop')).toBeInTheDocument();

    rerender(<FlightRow flight={make({ stops: 2 })} passengers={1} />);
    expect(screen.getByText('2 stops')).toBeInTheDocument();
  });

  it('shows a non-EUR currency ticker inline with the price', () => {
    render(
      <FlightRow flight={make({ currency: 'USD', price: 200 })} passengers={2} />,
    );
    expect(screen.getByText('USD 400')).toBeInTheDocument();
  });
});
