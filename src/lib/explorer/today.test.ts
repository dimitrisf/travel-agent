import { describe, it, expect } from 'vitest';

import { todayLocalIsoDate } from './today';

// The helper accepts an injected Date so we can pin "now" without
// touching global time. That's the whole test surface — everything
// else is a fixed string formatter.
describe('todayLocalIsoDate', () => {
  it('returns YYYY-MM-DD in the caller-provided date', () => {
    // Constructed via local calendar fields to sidestep timezone drift:
    // new Date(2026, 8, 3) means "Sept 3 2026" in whatever zone runs
    // the test, which is the calendar the picker shows the user.
    expect(todayLocalIsoDate(new Date(2026, 8, 3))).toBe('2026-09-03');
  });

  it('zero-pads single-digit months and days', () => {
    expect(todayLocalIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(todayLocalIsoDate(new Date(2026, 8, 9))).toBe('2026-09-09');
  });

  it('rolls to the next month/year across boundaries', () => {
    // Feb 29 2028 (leap) — proves we're not doing anything clever
    // with days-per-month; JS's Date handles the calendar.
    expect(todayLocalIsoDate(new Date(2028, 1, 29))).toBe('2028-02-29');
    expect(todayLocalIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
