// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BookingLike, BookingStatus } from '@/types/booking';

// Mock next/navigation's useSearchParams — the card reads
// ?confirm=<id> for the OAuth-return path.
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock auth so we can toggle between signed-in and anon per test.
vi.mock('@/lib/auth/client', () => ({
  useCurrentUser: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

// Mock the sessionStorage helpers so no FAST-path preconfirmed
// booking interferes with the mount effect.
vi.mock('@/utils/anonChatStorage', () => ({
  readPendingConfirmedBooking: vi.fn(() => null),
  clearPendingConfirmedBooking: vi.fn(),
}));

// Stub the line-item renderers — testing their internals is out of
// scope for BookingCard's own responsibilities.
vi.mock('./FlightLegRows', () => ({
  FlightLegRows: () => <div data-testid="flight-leg-rows" />,
}));
vi.mock('./HotelStayRows', () => ({
  HotelStayRows: () => <div data-testid="hotel-stay-rows" />,
}));

import { BookingCard } from './BookingCard';
import { useCurrentUser, signInWithGoogle } from '@/lib/auth/client';
import { useSearchParams } from 'next/navigation';

const useCurrentUserMock = vi.mocked(useCurrentUser);
const signInWithGoogleMock = vi.mocked(signInWithGoogle);
const useSearchParamsMock = vi.mocked(useSearchParams);

function makeBooking(overrides: Partial<BookingLike> = {}): BookingLike {
  return {
    id: 42,
    reference: 'BKG-TEST-42',
    status: 'PROPOSED' satisfies BookingStatus,
    customerName: null,
    customerEmail: null,
    totalPriceEUR: 250,
    currency: 'EUR',
    cancellationReason: null,
    flightBookings: [
      {
        id: 1,
        cabinClass: 'economy',
        adults: 1,
        children: 0,
        seats: 1,
        totalPriceEUR: 150,
        flightInstance: {
          id: 100,
          departureDatetime: '2026-09-15T09:00',
          arrivalDatetime: '2026-09-15T11:00',
          flightDefinition: {
            flightNumber: '824',
            airline: { iataCode: 'A3', name: 'Aegean' },
            originAirport: {
              iataCode: 'ATH',
              name: 'Athens Intl',
              city: { name: 'Athens' },
            },
            destinationAirport: {
              iataCode: 'BER',
              name: 'Berlin Brandenburg',
              city: { name: 'Berlin' },
            },
          },
        },
      },
    ],
    hotelBookings: [
      {
        id: 1,
        checkinDate: '2026-09-15',
        checkoutDate: '2026-09-16',
        nights: 1,
        guests: 1,
        rooms: 1,
        totalPriceEUR: 100,
        roomType: {
          name: 'Standard',
          hotel: {
            name: 'Berlin Hotel',
            address: '1 Main St',
            stars: 4,
            city: { name: 'Berlin' },
          },
        },
      },
    ],
    ...overrides,
  };
}

describe('BookingCard', () => {
  beforeEach(() => {
    // Default: signed-in user, no ?confirm param, mount-effect
    // fetch returns 404 (no fresh snapshot to apply).
    useCurrentUserMock.mockReturnValue({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      image: null,
    });
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 404 }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('rendering by status', () => {
    it('renders reference, PROPOSED chip, flights, hotels, total, Confirm + Cancel', () => {
      render(<BookingCard initialBooking={makeBooking()} />);

      expect(screen.getByText('BKG-TEST-42')).toBeInTheDocument();
      expect(screen.getByText('PROPOSED')).toBeInTheDocument();
      expect(screen.getByTestId('flight-leg-rows')).toBeInTheDocument();
      expect(screen.getByTestId('hotel-stay-rows')).toBeInTheDocument();
      // formatEUR uses Intl with undefined locale — locale detection
      // varies across environments (Windows en-US vs. el-GR emits
      // €250.00 vs. 250,00 €), so match the numeric part only.
      expect(screen.getByText(/250[.,]00/)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /confirm/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^cancel$/i }),
      ).toBeInTheDocument();
    });

    it('renders PAID with "Cancel booking" and no Confirm button', () => {
      render(
        <BookingCard
          initialBooking={makeBooking({
            status: 'PAID',
            customerName: 'Test User',
            customerEmail: 'test@example.com',
          })}
        />,
      );

      expect(screen.getByText('PAID')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /confirm/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /cancel booking/i }),
      ).toBeInTheDocument();
    });

    it('renders CANCELLED with no action buttons and shows the cancellation reason', () => {
      render(
        <BookingCard
          initialBooking={makeBooking({
            status: 'CANCELLED',
            cancellationReason: 'Changed plans',
          })}
        />,
      );

      expect(screen.getAllByText('CANCELLED').length).toBeGreaterThan(0);
      expect(
        screen.queryByRole('button', { name: /confirm/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /cancel/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/changed plans/i)).toBeInTheDocument();
    });

    it('omits the flights block when flightBookings is empty', () => {
      render(
        <BookingCard
          initialBooking={makeBooking({ flightBookings: [] })}
        />,
      );

      expect(screen.queryByTestId('flight-leg-rows')).not.toBeInTheDocument();
      expect(screen.getByTestId('hotel-stay-rows')).toBeInTheDocument();
    });

    it('shows the "guest identity set at Confirm" placeholder when no customer info', () => {
      render(<BookingCard initialBooking={makeBooking()} />);

      expect(
        screen.getByText(/guest identity is set at confirm/i),
      ).toBeInTheDocument();
    });
  });

  describe('Confirm button', () => {
    it('POSTs to /api/booking/:id/confirm and updates the card to PAID', async () => {
      const paidResponse = makeBooking({
        status: 'PAID',
        customerName: 'Test User',
        customerEmail: 'test@example.com',
      });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 404 })) // mount effect
        .mockResolvedValueOnce(
          new Response(JSON.stringify(paidResponse), { status: 200 }),
        );

      const user = userEvent.setup();
      render(<BookingCard initialBooking={makeBooking()} />);

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      await waitFor(() => {
        expect(screen.getByText('PAID')).toBeInTheDocument();
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/booking/42/confirm',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('kicks off Google sign-in with a ?confirm=<id> callback when anonymous', async () => {
      useCurrentUserMock.mockReturnValue(null);
      const user = userEvent.setup();
      render(<BookingCard initialBooking={makeBooking()} />);

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      expect(signInWithGoogleMock).toHaveBeenCalledExactlyOnceWith(
        '/?confirm=42',
      );
    });

    it('shows a spinner + disables both buttons while the confirm request is in flight', async () => {
      // Never-resolving fetch keeps the card in the busy state so we
      // can assert the spinner + disabled attributes.
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 404 })) // mount effect
        .mockImplementationOnce(() => new Promise(() => {}));

      const user = userEvent.setup();
      render(<BookingCard initialBooking={makeBooking()} />);

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      await waitFor(() => {
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
      expect(
        screen.getByRole('button', { name: /^cancel$/i }),
      ).toBeDisabled();
    });

    it('shows spinner + disables buttons when returning from OAuth (?confirm=<id> in URL)', () => {
      useSearchParamsMock.mockReturnValue(
        new URLSearchParams(
          'confirm=42',
        ) as unknown as ReturnType<typeof useSearchParams>,
      );

      render(<BookingCard initialBooking={makeBooking()} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
      expect(
        screen.getByRole('button', { name: /^cancel$/i }),
      ).toBeDisabled();
    });
  });

  describe('Cancel button', () => {
    it('POSTs to /api/booking/:id/cancel and updates the card to CANCELLED', async () => {
      const cancelledResponse = makeBooking({
        status: 'CANCELLED',
        cancellationReason: 'User cancelled',
      });
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 404 })) // mount effect
        .mockResolvedValueOnce(
          new Response(JSON.stringify(cancelledResponse), { status: 200 }),
        );

      const user = userEvent.setup();
      render(<BookingCard initialBooking={makeBooking()} />);

      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      await waitFor(() => {
        expect(screen.getAllByText('CANCELLED').length).toBeGreaterThan(0);
      });
    });
  });

  describe('error handling', () => {
    it('renders an error alert when the action API returns non-ok', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 404 })) // mount effect
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Insufficient inventory' }), {
            status: 409,
          }),
        );

      const user = userEvent.setup();
      render(<BookingCard initialBooking={makeBooking()} />);

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /insufficient inventory/i,
        );
      });
    });
  });
});
