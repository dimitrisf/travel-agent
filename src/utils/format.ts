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
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function formatDT(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })} ${d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })}`;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
