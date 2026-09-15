// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BookingPanel } from './BookingPanel';
import {
  SelectionProvider,
  type SelectedFlight,
  type SelectedHotel,
} from '@/context/SelectionContext';
import type { BookingLike } from '@/types/booking';

// BookingCard is a heavy client component (its own state, effects,
// next/navigation, auth). This test focuses on BookingPanel's own
// behavior — cart summary, propose call, error path — so we stub the
// card down to a testid the assertions can pick up.
vi.mock('@/components/BookingCard', () => ({
  BookingCard: ({ initialBooking }: { initialBooking: BookingLike }) => (
    <div data-testid="booking-card">
      Booking ref: {initialBooking.reference}
    </div>
  ),
}));

// next/navigation is controllable per test — the resume effect reads
// pathname, searchParams (for `?confirm=<id>`), and calls
// router.replace when it's done. Defaulting to /explorer/booking with
// no query keeps the pre-resume tests behaving the way they did
// before the effect was added.
let mockPathname = '/explorer/booking';
let mockSearchParams = new URLSearchParams();
const mockRouterReplace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockRouterReplace }),
}));

// useCurrentUser drives the resume effect's gate. Default to signed-
// out so the existing tests aren't accidentally in resume mode.
let mockCurrentUser: { id: string; email: string } | null = null;
vi.mock('@/lib/auth/client', () => ({
  useCurrentUser: () => mockCurrentUser,
}));

const STORAGE_KEY = 'explorer:selection:v2';

const outbound: SelectedFlight = {
  flight_instance_id: 101,
  cabin_class: 'economy',
  adults: 2,
  children: 1,
  priceEUR: 200,
  totalEUR: 600,
  label: 'Aegean A3 824 · ATH → BER',
};

const inbound: SelectedFlight = {
  flight_instance_id: 303,
  cabin_class: 'economy',
  adults: 2,
  children: 1,
  priceEUR: 180,
  totalEUR: 540,
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

// Fake booking returned from /api/booking/propose — only the fields
// this test's stubbed BookingCard reads plus the outer shape that
// keeps setBooking(body) typechecking loose enough.
const FAKE_BOOKING = { id: 42, reference: 'BK-DEMO-001' } as unknown as BookingLike;

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

function renderPanel() {
  return render(
    <SelectionProvider>
      <BookingPanel />
    </SelectionProvider>,
  );
}

describe('BookingPanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // Reset the module-scoped mocks between tests so we don't leak
    // resume-effect state (signed-in user, ?confirm=<id>) across
    // cases that don't opt into it.
    mockPathname = '/explorer/booking';
    mockSearchParams = new URLSearchParams();
    mockCurrentUser = null;
    mockRouterReplace.mockReset();
    // Stable idempotency key so payload assertions are exact.
    vi.stubGlobal('crypto', {
      ...globalThis.crypto,
      randomUUID: () => 'test-uuid',
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders an empty-state alert and a disabled Propose button when the cart is empty', () => {
    renderPanel();
    expect(screen.getByText(/Nothing selected yet/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Propose booking/i }),
    ).toBeDisabled();
  });

  it('shows a summary row per selection with per-line and total prices', async () => {
    seedSelection({ outboundFlight: outbound, inboundFlight: inbound, hotel });
    renderPanel();
    // findByText waits for the hydrate effect.
    expect(await screen.findByText(outbound.label)).toBeInTheDocument();
    expect(screen.getByText(inbound.label)).toBeInTheDocument();
    expect(screen.getByText(hotel.label)).toBeInTheDocument();
    // 600 + 540 + 390 = 1530
    expect(screen.getByText('€1530')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Propose booking/i }),
    ).toBeEnabled();
  });

  it('POSTs the built payload to /api/booking/propose and swaps to BookingCard on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => FAKE_BOOKING,
    });
    vi.stubGlobal('fetch', fetchMock);
    seedSelection({ outboundFlight: outbound, hotel });
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole('button', { name: /Propose booking/i }),
    );

    // fetch called exactly once with the correct URL, method, and body.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/booking/propose');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      idempotency_key: 'explorer:test-uuid',
      flights: [
        {
          flight_instance_id: 101,
          cabin_class: 'economy',
          adults: 2,
          children: 1,
        },
      ],
      hotels: [
        {
          room_type_id: 55,
          checkin: '2026-09-05',
          checkout: '2026-09-08',
          guests: 2,
          rooms: 1,
        },
      ],
    });

    // BookingCard appears with the returned reference; the cart
    // summary and Propose button are gone.
    expect(await screen.findByTestId('booking-card')).toHaveTextContent(
      'BK-DEMO-001',
    );
    expect(
      screen.queryByRole('button', { name: /Propose booking/i }),
    ).toBeNull();
    // Cart cleared as a side effect — sessionStorage now reflects
    // the empty state so a page reload wouldn't re-summon the picks.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        outboundFlight: null,
        inboundFlight: null,
        hotel: null,
      }),
    );
  });

  it('rehydrates a previously-proposed booking from sessionStorage on mount', async () => {
    // The proposed booking survives /explorer/* navigation because
    // BookingPanel persists it under PROPOSED_BOOKING_STORAGE_KEY.
    // Seeding storage before mount simulates a returning user.
    sessionStorage.setItem(
      'explorer:proposedBooking:v1',
      JSON.stringify(FAKE_BOOKING),
    );
    renderPanel();

    // BookingCard renders with the persisted reference; the Propose
    // button and cart Alert are absent (the panel is in booking-shown
    // mode).
    expect(await screen.findByTestId('booking-card')).toHaveTextContent(
      'BK-DEMO-001',
    );
    expect(
      screen.queryByRole('button', { name: /Propose booking/i }),
    ).toBeNull();
  });

  it('clears the persisted booking and returns to the empty state when "Start a new booking" is clicked', async () => {
    sessionStorage.setItem(
      'explorer:proposedBooking:v1',
      JSON.stringify(FAKE_BOOKING),
    );
    const user = userEvent.setup();
    renderPanel();

    // The BookingCard is up. Click the reset button.
    await screen.findByTestId('booking-card');
    await user.click(
      screen.getByRole('button', { name: /Start a new booking/i }),
    );

    // Empty state returns, BookingCard is gone, storage now holds
    // the null sentinel (usePersistedState writes JSON.stringify).
    expect(screen.queryByTestId('booking-card')).toBeNull();
    expect(screen.getByText(/Nothing selected yet/)).toBeInTheDocument();
    expect(sessionStorage.getItem('explorer:proposedBooking:v1')).toBe('null');
  });

  it('persists the proposed booking to sessionStorage on a successful propose', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => FAKE_BOOKING,
    });
    vi.stubGlobal('fetch', fetchMock);
    seedSelection({ outboundFlight: outbound });
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole('button', { name: /Propose booking/i }),
    );
    await screen.findByTestId('booking-card');

    // Storage now carries the booking so a page reload / cross-page
    // nav would restore it. Match on the reference so this test
    // doesn't couple to every unrelated field the API returns.
    const raw = sessionStorage.getItem('explorer:proposedBooking:v1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({
      reference: 'BK-DEMO-001',
    });
  });

  it('fires the confirm POST and updates the persisted booking when returning from OAuth with ?confirm=<id> matching', async () => {
    // Simulate the "just came back from Google" moment: persisted
    // PROPOSED booking, ?confirm=<its-id> in the URL, currentUser set.
    sessionStorage.setItem(
      'explorer:proposedBooking:v1',
      JSON.stringify(FAKE_BOOKING),
    );
    mockSearchParams = new URLSearchParams(
      `confirm=${String(FAKE_BOOKING.id)}`,
    );
    mockCurrentUser = { id: 'u1', email: 'user@example.com' };

    const paidBody = { ...FAKE_BOOKING, status: 'PAID' } as unknown as BookingLike;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => paidBody,
    });
    vi.stubGlobal('fetch', fetchMock);

    // Spy on window dispatchEvent so we can assert the
    // 'booking-updated' broadcast BookingCard listens for.
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    renderPanel();

    // Wait for the effect to complete (fetch + setBooking + URL
    // cleanup).
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // POST hit the right endpoint.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/booking/${FAKE_BOOKING.id}/confirm`);
    expect(init.method).toBe('POST');

    // Persisted booking now reflects the PAID status.
    await vi.waitFor(() => {
      const raw = sessionStorage.getItem('explorer:proposedBooking:v1');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toMatchObject({ status: 'PAID' });
    });

    // BookingCard-update broadcast fired with the fresh booking.
    const bookingUpdatedCall = dispatchSpy.mock.calls.find(
      ([e]) => (e as Event).type === 'booking-updated',
    );
    expect(bookingUpdatedCall).toBeDefined();
    const evt = bookingUpdatedCall![0] as CustomEvent<BookingLike>;
    expect(evt.detail).toMatchObject({ status: 'PAID' });

    // ?confirm= stripped from the URL so a subsequent action doesn't
    // re-fire.
    expect(mockRouterReplace).toHaveBeenCalledWith('/explorer/booking');
  });

  it('does NOT fire the confirm POST when the ?confirm query does not match the persisted booking id', async () => {
    sessionStorage.setItem(
      'explorer:proposedBooking:v1',
      JSON.stringify(FAKE_BOOKING),
    );
    // A different booking id in the URL — resume effect must ignore.
    mockSearchParams = new URLSearchParams('confirm=999');
    mockCurrentUser = { id: 'u1', email: 'user@example.com' };

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();

    // Wait a tick for any pending effects. The gate should have
    // rejected the resume, so fetch is never called.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('does NOT fire the confirm POST when the user is signed out even if ?confirm is present', async () => {
    sessionStorage.setItem(
      'explorer:proposedBooking:v1',
      JSON.stringify(FAKE_BOOKING),
    );
    mockSearchParams = new URLSearchParams(
      `confirm=${String(FAKE_BOOKING.id)}`,
    );
    mockCurrentUser = null; // signed out

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the server error message and re-enables Propose on HTTP failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'departure_date must not be in the past.',
        code: 'DATE_IN_PAST',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    seedSelection({ outboundFlight: outbound });
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole('button', { name: /Propose booking/i }),
    );

    expect(
      await screen.findByText('departure_date must not be in the past.'),
    ).toBeInTheDocument();
    // Cart preserved (the propose flow didn't succeed), button
    // re-enabled so the user can retry after fixing whatever's wrong
    // upstream.
    expect(
      screen.getByRole('button', { name: /Propose booking/i }),
    ).toBeEnabled();
    expect(screen.queryByTestId('booking-card')).toBeNull();
  });
});
