// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { LegBlock } from './LegBlock';
import type { FlightResult } from '@/lib/services/FlightService';

// Stub the row + header so this test focuses on LegBlock's own
// contract: header overline (title · date · count), and rendering
// one FlightRow per flight. FlightRow and FlightHeaderRow have their
// own tests.
vi.mock('./FlightRow', () => ({
  FlightRow: ({ flight }: { flight: FlightResult }) => (
    <div data-testid="flight-row">{flight.flight_number}</div>
  ),
}));
vi.mock('./FlightHeaderRow', () => ({
  FlightHeaderRow: () => <div data-testid="flight-header-row" />,
}));

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

describe('LegBlock', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the overline with title, date, and count', () => {
    render(
      <LegBlock
        title="Outbound"
        flights={[make(), make({ flight_instance_id: 101, flight_number: '825' })]}
        passengers={1}
        sort={{ mode: 'price', direction: 'asc' }}
        onSort={vi.fn()}
      />,
    );
    // Date comes from the first flight's departure (slice 0-10).
    expect(screen.getByText('Outbound · 2026-09-15 · 2')).toBeInTheDocument();
  });

  it('renders one FlightRow per flight', () => {
    render(
      <LegBlock
        title="Outbound"
        flights={[
          make({ flight_instance_id: 1, flight_number: '111' }),
          make({ flight_instance_id: 2, flight_number: '222' }),
          make({ flight_instance_id: 3, flight_number: '333' }),
        ]}
        passengers={1}
        sort={{ mode: 'price', direction: 'asc' }}
        onSort={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('flight-row')).toHaveLength(3);
  });

  it('renders the header row for sortable columns', () => {
    render(
      <LegBlock
        title="Return"
        flights={[make()]}
        passengers={1}
        sort={{ mode: 'price', direction: 'asc' }}
        onSort={vi.fn()}
      />,
    );
    expect(screen.getByTestId('flight-header-row')).toBeInTheDocument();
  });
});
