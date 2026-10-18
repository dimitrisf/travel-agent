// formatEUR formats a number into a Euro currency string. E.g., 1234.56 → "€1,234.56"
export function formatEUR(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(n);
}

// Flight/hotel datetimes are stored as UTC wall-clock — i.e. the ISO "09:40Z"
// means "09:40 at the airport", not a real UTC instant — so we render with
// timeZone: 'UTC' to keep the display consistent with what the agent (and the
// search results) show, regardless of the browser's local offset.
//
// `locale` lets callers (via useFormatDate in SettingsContext) pin the
// day-before-month vs. month-before-day order to the user's preference:
// 'en-GB' → "Mon, 12 Oct 2026"; 'en-US' → "Mon, Oct 12, 2026". Pure
// callers (tests, non-React code) can pass undefined to get the system
// locale.
export function formatDate(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    // The ISO strings like "2026-10-12T09:40:00Z" aren't real UTC moments — they're the airport's local wall-clock time glued into a UTC-shaped string, because JavaScript needs some timezone marker. If you format one with the browser's local zone, Athens users would see 12:40 and Berlin users would see 10:40 for the same flight, even though it departs at 09:40 Athens-local. Passing timeZone: 'UTC' to toLocaleTimeString undoes that reinterpretation — you get back the digits you stored, consistent everywhere.
    timeZone: 'UTC',
  });
}

// Same shape as formatDate but drops the year, for the leading date in
// a same-year range — the trailing date keeps the year, which still
// anchors the range (e.g., "Mon, 12 Oct → Wed, 14 Oct 2026"). Isolated
// as its own export so the locale's day/month/weekday rendering is
// identical and we never do string surgery on Intl output.
export function formatDateNoYear(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// E.g., "2026-10-12T09:40:00Z" → "Mon, 12 Oct 2026 09:40"
export function formatDT(iso: string, locale?: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })} ${d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })}`;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
