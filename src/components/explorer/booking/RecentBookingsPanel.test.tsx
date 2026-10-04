// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecentBookingsPanel } from './RecentBookingsPanel';
import {
  computeBookingDateRange,
  formatBookingDateRange,
} from '@/utils/booking';
import type { BookingLike } from '@/types/booking';

// BookingCard is heavy (its own state, effects, next/navigation,
// auth). This test focuses on RecentBookingsPanel's own behavior —
// signed-out state, loading, error, empty, populated, and per-row
// expand — so we stub the card down to a testid the assertions can
// pick up.
vi.mock('@/components/BookingCard', () => ({
  BookingCard: ({ initialBooking }: { initialBooking: BookingLike }) => (
    <div data-testid="booking-card">
      Booking ref: {initialBooking.reference}
    </div>
  ),
}));

// useCurrentUser drives the auth gate. Default to signed-out; each
// test that wants the fetch path flips it. The mock deliberately
// returns a FRESH OBJECT LITERAL each call (matching the real
// useCurrentUser at src/lib/auth/client.ts, which builds
// `{ id, email, ... }` on every render). This guards against a
// regression where the effect's dep list uses `[currentUser]` — a
// new-object-each-render dep would fire the effect on every render
// and produce an infinite GET /api/bookings loop. The dep list must
// pin to the primitive `userId`; the "fires the fetch exactly once"
// assertion below is what catches a regression to `[currentUser]`.
let mockCurrentUser: { id: string; email: string } | null = null;
vi.mock('@/lib/auth/client', () => ({
  useCurrentUser: () => (mockCurrentUser ? { ...mockCurrentUser } : null),
}));

function makeBooking(overrides: Partial<BookingLike> = {}): BookingLike {
  return {
    id: 1,
    reference: 'BKG-2026-ABC001',
    status: 'PAID',
    customerName: 'Test User',
    customerEmail: 'test@example.com',
    totalPriceEUR: 500,
    currency: 'EUR',
    cancellationReason: null,
    flightBookings: [],
    hotelBookings: [],
    ...overrides,
  } as unknown as BookingLike;
}

const STORAGE_KEY = 'explorer:recentBookings:v1';

// Seed the sessionStorage cache with a success ResponseState so the
// panel hydrates directly into the populated view — used by tests
// that care about post-load behavior (row expand, time span
// rendering, etc.) and don't want to reason about the Load button
// click.
function seedCache(bookings: BookingLike[]): void {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      kind: 'success',
      status: 200,
      timing: 42,
      data: bookings,
    }),
  );
}

describe('RecentBookingsPanel', () => {
  beforeEach(() => {
    mockCurrentUser = null;
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders a "sign in" prompt and does NOT fetch when the user is signed out', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<RecentBookingsPanel />);

    expect(
      screen.getByText('Sign in to see your recent bookings.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the "Load" button and does NOT fetch on mount (no auto-fetch)', () => {
    mockCurrentUser = { id: 'user-1', email: 'test@example.com' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<RecentBookingsPanel />);

    expect(
      screen.getByRole('button', { name: /Load recent bookings/i }),
    ).toBeInTheDocument();
    // Fetch is deferred to the user's explicit click — never fires
    // as a side effect of rendering.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches /api/bookings and renders one row per booking when "Load" is clicked', async () => {
    mockCurrentUser = { id: 'user-1', email: 'test@example.com' };
    const bookings = [
      makeBooking({ id: 1, reference: 'BKG-A', totalPriceEUR: 100 }),
      makeBooking({ id: 2, reference: 'BKG-B', totalPriceEUR: 200 }),
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => bookings,
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<RecentBookingsPanel />);

    await user.click(
      screen.getByRole('button', { name: /Load recent bookings/i }),
    );

    expect(await screen.findByText('BKG-A')).toBeInTheDocument();
    expect(screen.getByText('BKG-B')).toBeInTheDocument();

    // GET /api/bookings called exactly once — verifies (a) explicit
    // click drives the request and (b) no accidental re-render loop.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/bookings');
    expect(init.method).toBe('GET');
  });

  it('hydrates the list from sessionStorage on mount (no fetch on return-visit)', async () => {
    // Simulate the "returned to /explorer/booking after navigating
    // away" case: sessionStorage already has a cached success from
    // a previous visit. The panel should show the list immediately
    // and NOT fire /api/bookings.
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kind: 'success',
        status: 200,
        timing: 42,
        data: [makeBooking({ id: 9, reference: 'BKG-CACHED' })],
      }),
    );
    mockCurrentUser = { id: 'user-1', email: 'test@example.com' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<RecentBookingsPanel />);

    // findByText waits for usePersistedState's hydrate effect.
    expect(await screen.findByText('BKG-CACHED')).toBeInTheDocument();
    // No network round-trip — the whole point of the cache.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-fetches when the "Refresh" button is clicked, replacing the cached list', async () => {
    // Seed a cached row, then verify Refresh clicks trigger a new
    // fetch AND replace the cached row with the fresh response.
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        kind: 'success',
        status: 200,
        timing: 42,
        data: [makeBooking({ id: 9, reference: 'BKG-STALE' })],
      }),
    );
    mockCurrentUser = { id: 'user-1', email: 'test@example.com' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [makeBooking({ id: 10, reference: 'BKG-FRESH' })],
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<RecentBookingsPanel />);

    await screen.findByText('BKG-STALE');
    await user.click(screen.getByRole('button', { name: /Refresh/i }));

    // Cached row is gone; fresh row is present; fetch was called.
    expect(await screen.findByText('BKG-FRESH')).toBeInTheDocument();
    expect(screen.queryByText('BKG-STALE')).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('renders the empty-state message after a Load that returns no bookings', async () => {
    mockCurrentUser = { id: 'user-1', email: 'test@example.com' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
      }),
    );
    const user = userEvent.setup();
    render(<RecentBookingsPanel />);

    await user.click(
      screen.getByRole('button', { name: /Load recent bookings/i }),
    );

    expect(await screen.findByText(/No bookings yet/i)).toBeInTheDocument();
  });

  it('surfaces the server error message and offers a Retry button on non-2xx', async () => {
    mockCurrentUser = { id: 'user-1', email: 'test@example.com' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Database error while listing bookings.' }),
      }),
    );
    const user = userEvent.setup();
    render(<RecentBookingsPanel />);

    await user.click(
      screen.getByRole('button', { name: /Load recent bookings/i }),
    );

    expect(
      await screen.findByText('Database error while listing bookings.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Retry/i }),
    ).toBeInTheDocument();
  });

  it('expands one row into a full BookingCard on chevron click', async () => {
    mockCurrentUser = { id: 'user-1', email: 'test@example.com' };
    // Seed the cache so the panel hydrates directly into the
    // populated view — the Load button click is exercised elsewhere.
    seedCache([makeBooking({ id: 1, reference: 'BKG-EXPAND-ME' })]);
    const user = userEvent.setup();
    render(<RecentBookingsPanel />);

    // Wait for the row to render, then find its expand button.
    await screen.findByText('BKG-EXPAND-ME');
    const btn = screen.getByRole('button', {
      name: /Show details for BKG-EXPAND-ME/i,
    });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('booking-card')).toBeNull();

    await user.click(btn);

    // BookingCard now rendered with the row's booking; button flipped.
    await waitFor(() => {
      expect(screen.getByTestId('booking-card')).toHaveTextContent(
        'BKG-EXPAND-ME',
      );
    });
    expect(
      screen.getByRole('button', { name: /Hide details for BKG-EXPAND-ME/i }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the booking time span next to the reference in the row summary', async () => {
    mockCurrentUser = { id: 'user-1', email: 'test@example.com' };
    // Combined booking: one round-trip (12 → 14 Sep) + one hotel stay
    // (12 → 15 Sep). Widest end (15 Sep) is the hotel's checkout, so
    // the summary range should be 12 Sep → 15 Sep.
    seedCache([
      makeBooking({
        id: 1,
        reference: 'BKG-WINDOW',
        flightBookings: [
          {
            flightInstance: {
              departureDatetime: '2026-09-12T09:00:00Z',
              arrivalDatetime: '2026-09-12T12:00:00Z',
            },
          },
          {
            flightInstance: {
              departureDatetime: '2026-09-14T18:00:00Z',
              arrivalDatetime: '2026-09-14T21:00:00Z',
            },
          },
        ] as unknown as BookingLike['flightBookings'],
        hotelBookings: [
          {
            checkinDate: '2026-09-12',
            checkoutDate: '2026-09-15',
          },
        ] as unknown as BookingLike['hotelBookings'],
      }),
    ]);

    render(<RecentBookingsPanel />);

    await screen.findByText('BKG-WINDOW');
    // formatBookingDateRange returns locale-dependent glyphs (e.g.
    // "Sat, 12 Sep → Tue, 15 Sep" in en-US; "Σάβ 12 Σεπ → Τρί 15 Σεπ"
    // in el-GR). Derive the expected string by calling the formatter
    // — this stays correct under any runtime locale (local dev vs.
    // CI Ubuntu).
    const expected = formatBookingDateRange('2026-09-12', '2026-09-15');
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('toggles each row independently when there are multiple bookings', async () => {
    mockCurrentUser = { id: 'user-1', email: 'test@example.com' };
    seedCache([
      makeBooking({ id: 1, reference: 'BKG-A' }),
      makeBooking({ id: 2, reference: 'BKG-B' }),
    ]);
    const user = userEvent.setup();
    render(<RecentBookingsPanel />);

    await screen.findByText('BKG-A');
    await user.click(
      screen.getByRole('button', { name: /Show details for BKG-A/i }),
    );

    // A is expanded; B is still collapsed. Only one BookingCard is
    // present, and it matches A's reference.
    await waitFor(() => {
      const cards = screen.getAllByTestId('booking-card');
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent('BKG-A');
    });
    expect(
      screen.getByRole('button', { name: /Show details for BKG-B/i }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('computeBookingDateRange', () => {
  function b(overrides: Partial<BookingLike>): BookingLike {
    return {
      flightBookings: [],
      hotelBookings: [],
      ...overrides,
    } as unknown as BookingLike;
  }

  it('returns null when the booking has neither flights nor hotels', () => {
    expect(computeBookingDateRange(b({}))).toBeNull();
  });

  it('spans a single one-way flight (departure → arrival)', () => {
    const range = computeBookingDateRange(
      b({
        flightBookings: [
          {
            flightInstance: {
              departureDatetime: '2026-09-12T09:00:00Z',
              arrivalDatetime: '2026-09-12T12:00:00Z',
            },
          },
        ] as unknown as BookingLike['flightBookings'],
      }),
    );
    expect(range).toEqual({
      start: '2026-09-12T09:00:00Z',
      end: '2026-09-12T12:00:00Z',
    });
  });

  it('spans a round trip: earliest departure → latest arrival', () => {
    const range = computeBookingDateRange(
      b({
        flightBookings: [
          {
            flightInstance: {
              departureDatetime: '2026-09-14T18:00:00Z',
              arrivalDatetime: '2026-09-14T21:00:00Z',
            },
          },
          {
            flightInstance: {
              departureDatetime: '2026-09-12T09:00:00Z',
              arrivalDatetime: '2026-09-12T12:00:00Z',
            },
          },
        ] as unknown as BookingLike['flightBookings'],
      }),
    );
    // Order of legs in the array doesn't matter — the helper sorts.
    expect(range?.start).toBe('2026-09-12T09:00:00Z');
    expect(range?.end).toBe('2026-09-14T21:00:00Z');
  });

  it('spans a hotel-only booking: checkin → checkout', () => {
    const range = computeBookingDateRange(
      b({
        hotelBookings: [
          { checkinDate: '2026-09-12', checkoutDate: '2026-09-15' },
        ] as unknown as BookingLike['hotelBookings'],
      }),
    );
    expect(range).toEqual({ start: '2026-09-12', end: '2026-09-15' });
  });

  it('spans a combined flight + hotel booking across the widest window', () => {
    const range = computeBookingDateRange(
      b({
        flightBookings: [
          {
            flightInstance: {
              departureDatetime: '2026-09-12T09:00:00Z',
              arrivalDatetime: '2026-09-14T21:00:00Z',
            },
          },
        ] as unknown as BookingLike['flightBookings'],
        hotelBookings: [
          { checkinDate: '2026-09-11', checkoutDate: '2026-09-15' },
        ] as unknown as BookingLike['hotelBookings'],
      }),
    );
    // Hotel opens earlier and closes later than the flight, so the
    // hotel dates bound both ends.
    expect(range?.start).toBe('2026-09-11');
    expect(range?.end).toBe('2026-09-15');
  });
});

describe('formatBookingDateRange', () => {
  // formatDate under the hood uses Intl with the runtime's default
  // locale, so the exact glyphs differ across environments. These
  // tests assert STRUCTURAL properties (single label vs. arrow-
  // joined pair; contains a "12" and a "15") rather than the
  // English-specific strings, so they pass under el-GR (Σεπ) just
  // as they do under en-US (Sep).

  it('renders a single date (no "→") when start and end fall on the same day', () => {
    const label = formatBookingDateRange(
      '2026-09-12T09:00:00Z',
      '2026-09-12T12:00:00Z',
    );
    expect(label).not.toContain('→');
    // The day-of-month digit is stable across locales.
    expect(label).toMatch(/12/);
  });

  it('renders "start → end" when start and end fall on different days', () => {
    const label = formatBookingDateRange('2026-09-12', '2026-09-15');
    expect(label).toContain('→');
    // Both day-of-month digits appear on the correct sides of the
    // arrow, so a start/end swap would fail this test.
    const [before, after] = label.split('→');
    expect(before).toMatch(/12/);
    expect(after).toMatch(/15/);
  });
});
