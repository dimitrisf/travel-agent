import { describe, it, expect, vi, afterEach } from 'vitest';
import { confirmBooking, cancelBooking } from './bookingActions';
import type { BookingLike } from '@/types/booking';

const FAKE_BOOKING = {
  id: 42,
  reference: 'BK-TEST-001',
  status: 'PAID',
} as unknown as BookingLike;

describe('bookingActions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('confirmBooking', () => {
    it('POSTs to /api/booking/<id>/confirm and returns the parsed body on 2xx', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => FAKE_BOOKING,
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await confirmBooking(42);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/booking/42/confirm');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(result).toBe(FAKE_BOOKING);
    });

    it('throws with the server-provided error message on non-2xx', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({ error: 'Booking already CONFIRMED.' }),
        }),
      );

      await expect(confirmBooking(7)).rejects.toThrow(
        'Booking already CONFIRMED.',
      );
    });

    it('throws with `HTTP <status>` when the server omits an error field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({}),
        }),
      );

      await expect(confirmBooking(7)).rejects.toThrow('HTTP 500');
    });
  });

  describe('cancelBooking', () => {
    it('POSTs to /api/booking/<id>/cancel and returns the parsed body on 2xx', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...FAKE_BOOKING, status: 'CANCELLED' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await cancelBooking(42);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/booking/42/cancel');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(result).toMatchObject({ status: 'CANCELLED' });
    });

    it('throws with the server-provided error message on non-2xx', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: async () => ({
            error: 'Non-refundable hotel; cancellation forfeits full stay.',
          }),
        }),
      );

      await expect(cancelBooking(7)).rejects.toThrow(
        'Non-refundable hotel; cancellation forfeits full stay.',
      );
    });

    it('throws with `HTTP <status>` when the server omits an error field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({}),
        }),
      );

      await expect(cancelBooking(7)).rejects.toThrow('HTTP 500');
    });
  });
});
