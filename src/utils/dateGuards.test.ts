import { describe, it, expect } from 'vitest';

import { TravelServiceError } from '@/lib/services/TravelServiceError';
import { assertNoPastDates, earliestAllowedIsoDate } from './dateGuards';

// `now` fixed at 2026-09-03 UTC noon — comfortably away from midnight
// so the buffer's timezone-tail behavior is provable without any
// wall-clock drift concerns. Earliest allowed = 2026-09-02.
const NOW = new Date('2026-09-03T12:00:00Z');

describe('earliestAllowedIsoDate', () => {
  it('returns UTC today minus one day', () => {
    expect(earliestAllowedIsoDate(NOW)).toBe('2026-09-02');
  });

  it('rolls back across a month boundary', () => {
    expect(earliestAllowedIsoDate(new Date('2026-09-01T00:00:00Z'))).toBe(
      '2026-08-31',
    );
  });

  it('rolls back across a year boundary', () => {
    expect(earliestAllowedIsoDate(new Date('2027-01-01T00:00:00Z'))).toBe(
      '2026-12-31',
    );
  });
});

describe('assertNoPastDates', () => {
  it('is a no-op when every date is on or after the earliest allowed day', () => {
    expect(() =>
      assertNoPastDates(
        [
          ['departure_date', '2026-09-02'], // = earliest allowed, OK
          ['return_date', '2026-09-10'],
        ],
        NOW,
      ),
    ).not.toThrow();
  });

  it('throws DATE_IN_PAST naming the first past-dated field', () => {
    try {
      assertNoPastDates(
        [
          ['departure_date', '2026-08-31'],
          ['return_date', '2026-09-10'],
        ],
        NOW,
      );
      expect.fail('expected assertNoPastDates to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TravelServiceError);
      const e = err as TravelServiceError;
      expect(e.code).toBe('DATE_IN_PAST');
      expect(e.message).toContain('departure_date');
    }
  });

  it('also catches a past return_date when departure is fine', () => {
    // Order matters — the first past field wins the error. Here the
    // guard has to walk past a valid departure to find the bad return.
    try {
      assertNoPastDates(
        [
          ['departure_date', '2026-09-10'],
          ['return_date', '2026-08-01'],
        ],
        NOW,
      );
      expect.fail('expected assertNoPastDates to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TravelServiceError);
      expect((err as TravelServiceError).message).toContain('return_date');
    }
  });

  it('skips undefined values (optional fields)', () => {
    expect(() =>
      assertNoPastDates(
        [
          ['departure_date', '2026-09-10'],
          ['return_date', undefined],
        ],
        NOW,
      ),
    ).not.toThrow();
  });

  it('skips shape-invalid strings — those surface via zod at the service', () => {
    // '10-07-2026' looks vaguely date-like but doesn't match YYYY-MM-DD;
    // we defer to the service's IsoDate check rather than accidentally
    // greenlighting or falsely rejecting it via lexicographic compare.
    expect(() =>
      assertNoPastDates([['departure_date', '10-07-2026']], NOW),
    ).not.toThrow();
    expect(() =>
      assertNoPastDates([['departure_date', 'not-a-date']], NOW),
    ).not.toThrow();
  });
});
