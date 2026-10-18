import { describe, it, expect } from 'vitest';

import {
  computeBookingDateRange,
  formatBookingDateRange,
  formatFlightLabel,
  formatHotelLabel,
  formatNights,
} from './booking';
import type { SelectedFlight, SelectedHotel } from '@/context/SelectionContext';
import type { BookingLike } from '@/types/booking';

// These helpers are the booking-domain string composers used by
// SelectionBar, CartSummary, FlightRow's aria-labels and the recent-
// bookings panel. Tests live here (next to the helpers) rather than
// in each consumer's component test, so a format change touches one
// file instead of three.

describe('computeBookingDateRange', () => {
  // Helper to create a booking object with optional overrides.
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

  it('includes the year on a single-day label', () => {
    const label = formatBookingDateRange(
      '2026-09-12T09:00:00Z',
      '2026-09-12T12:00:00Z',
    );
    expect(label).toContain('2026');
  });

  it('shows the year only on the trailing date for a same-year span', () => {
    // Skip-first-year: both dates in 2026 → "2026" appears exactly
    // once in the composed label (on the trailing date).
    const label = formatBookingDateRange('2026-09-12', '2026-09-15');
    const yearMatches = label.match(/2026/g) ?? [];
    expect(yearMatches.length).toBe(1);
  });

  it('shows the year on both dates for a cross-year span', () => {
    // Dec 2026 → Jan 2027 → each year appears exactly once on its
    // own side of the arrow.
    const label = formatBookingDateRange('2026-12-30', '2027-01-02');
    expect(label.match(/2026/g)?.length ?? 0).toBe(1);
    expect(label.match(/2027/g)?.length ?? 0).toBe(1);
  });
});

describe('formatNights', () => {
  it('renders "night" (singular) for 1', () => {
    expect(formatNights(1)).toBe('1 night');
  });

  it('renders "nights" (plural) for 2 and higher', () => {
    expect(formatNights(2)).toBe('2 nights');
    expect(formatNights(10)).toBe('10 nights');
  });

  it('renders "nights" (plural) for 0 — matches English convention of plural at zero', () => {
    expect(formatNights(0)).toBe('0 nights');
  });
});

describe('formatFlightLabel', () => {
  function f(overrides: Partial<SelectedFlight> = {}): SelectedFlight {
    return {
      flight_instance_id: 1,
      cabin_class: 'economy',
      adults: 1,
      children: 0,
      priceEUR: 100,
      totalEUR: 100,
      airline: 'Aegean',
      flight_number: 'A3 824',
      origin_iata: 'ATH',
      destination_iata: 'BER',
      departure: '2026-09-12T09:40:00Z',
      ...overrides,
    };
  }

  it('includes the airline + flight number as the first segment', () => {
    expect(formatFlightLabel(f())).toMatch(/^Aegean A3 824/);
  });

  it('shows the route as "ORIGIN → DESTINATION"', () => {
    expect(formatFlightLabel(f())).toContain('ATH → BER');
  });

  it('ends with the formatted departure date + time (HH:MM, 24-hour)', () => {
    const label = formatFlightLabel(f());
    // Time segment is sliced directly from the ISO string, so it is
    // stable across locales. Date segment goes through formatDate so
    // we only assert the day digit is present.
    expect(label).toMatch(/09:40$/);
    expect(label).toMatch(/12/);
  });

  it('separates segments with " · "', () => {
    const label = formatFlightLabel(f());
    // Three ` · ` separators: airline+number / route / date+time.
    expect(label.split(' · ')).toHaveLength(3);
  });
});

describe('formatHotelLabel', () => {
  function h(overrides: Partial<SelectedHotel> = {}): SelectedHotel {
    return {
      room_type_id: 1,
      checkin: '2026-09-12',
      checkout: '2026-09-15',
      guests: 2,
      rooms: 1,
      nights: 3,
      pricePerNightEUR: 100,
      totalEUR: 300,
      label: 'Brooklyn Bay Inn · Standard',
      ...overrides,
    };
  }

  it('starts with the raw hotel label (hotel name + room type)', () => {
    expect(formatHotelLabel(h())).toMatch(/^Brooklyn Bay Inn · Standard/);
  });

  it('includes the formatted check-in → check-out date range', () => {
    const label = formatHotelLabel(h());
    // Dates go through formatDate, so the glyph form is locale-
    // dependent — assert structural inclusion of the arrow and the
    // day digits only.
    expect(label).toContain('→');
    expect(label).toMatch(/12/);
    expect(label).toMatch(/15/);
  });

  it('appends the night count in parentheses with the correct plural form', () => {
    expect(formatHotelLabel(h({ nights: 3 }))).toMatch(/\(3 nights\)$/);
    expect(formatHotelLabel(h({ nights: 1 }))).toMatch(/\(1 night\)$/);
  });

  it('collapses the date range to a single date for a single-night stay', () => {
    // When checkin and checkout are the same day, formatBookingDateRange
    // emits a single formatted date rather than "same → same". The
    // enclosing (N nights) count still renders.
    const label = formatHotelLabel(
      h({ checkin: '2026-09-12', checkout: '2026-09-12', nights: 1 }),
    );
    expect(label).not.toContain('→');
    expect(label).toMatch(/\(1 night\)$/);
  });
});
