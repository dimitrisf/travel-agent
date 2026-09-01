// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { FlightResults } from './FlightResults';
import type { FlightResult, SearchFlightsResult } from '@/lib/services/FlightService';

// Stub LegBlock so we can assert what FlightResults hands to it
// (title + sorted flights + which sort/onSort). LegBlock has its own
// tests for the actual rendering.
vi.mock('./LegBlock', () => ({
  LegBlock: ({
    title,
    flights,
    sort,
  }: {
    title: string;
    flights: FlightResult[];
    sort: { mode: string; direction: string };
  }) => (
    <div data-testid={`leg-${title.toLowerCase()}`}>
      <span data-testid="sort">{`${sort.mode}-${sort.direction}`}</span>
      {flights.map((f) => (
        <span key={f.flight_instance_id} data-testid="order">
          {f.flight_number}
        </span>
      ))}
    </div>
  ),
}));

function makeFlight(overrides: Partial<FlightResult> = {}): FlightResult {
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

const empty: SearchFlightsResult = { outbound: [], inbound: [] };

describe('FlightResults', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the empty-state message when both legs are empty', () => {
    render(
      <FlightResults
        data={empty}
        passengers={1}
        outboundSort={{ mode: 'price', direction: 'asc' }}
        inboundSort={{ mode: 'price', direction: 'asc' }}
        onOutboundSort={vi.fn()}
        onInboundSort={vi.fn()}
      />,
    );
    expect(
      screen.getByText('No flights match those filters.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(/^leg-/)).not.toBeInTheDocument();
  });

  it('renders only the outbound leg when there are no return flights', () => {
    const data: SearchFlightsResult = {
      outbound: [makeFlight()],
      inbound: [],
    };
    render(
      <FlightResults
        data={data}
        passengers={1}
        outboundSort={{ mode: 'price', direction: 'asc' }}
        inboundSort={{ mode: 'price', direction: 'asc' }}
        onOutboundSort={vi.fn()}
        onInboundSort={vi.fn()}
      />,
    );
    expect(screen.getByTestId('leg-outbound')).toBeInTheDocument();
    expect(screen.queryByTestId('leg-return')).not.toBeInTheDocument();
  });

  it('sorts each leg using its own sort spec independently', () => {
    const cheap = makeFlight({ flight_instance_id: 1, flight_number: '001', price: 100 });
    const mid = makeFlight({ flight_instance_id: 2, flight_number: '002', price: 200 });
    const dear = makeFlight({ flight_instance_id: 3, flight_number: '003', price: 300 });

    render(
      <FlightResults
        data={{ outbound: [dear, cheap, mid], inbound: [mid, dear, cheap] }}
        passengers={1}
        outboundSort={{ mode: 'price', direction: 'asc' }}
        inboundSort={{ mode: 'price', direction: 'desc' }}
        onOutboundSort={vi.fn()}
        onInboundSort={vi.fn()}
      />,
    );

    // Grab the rendered order from within each leg — first getAllByTestId
    // matches inside the given container.
    const outbound = screen.getByTestId('leg-outbound');
    const outNumbers = Array.from(
      outbound.querySelectorAll('[data-testid="order"]'),
    ).map((n) => n.textContent);
    expect(outNumbers).toEqual(['001', '002', '003']);

    const inbound = screen.getByTestId('leg-return');
    const inNumbers = Array.from(
      inbound.querySelectorAll('[data-testid="order"]'),
    ).map((n) => n.textContent);
    expect(inNumbers).toEqual(['003', '002', '001']);
  });
});
