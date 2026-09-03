import { TravelServiceError } from '@/lib/services/TravelServiceError';

// YYYY-MM-DD (shape only — this helper isn't the format check; that's
// what IsoDate does at the service boundary).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The earliest calendar day a caller is allowed to submit as "not
// in the past". One day before UTC today, deliberately.
//
// Server dates on the wire are UTC calendar days (see the repository
// comments about UTC anchoring); a naive "reject anything before UTC
// today" over-rejects for users west of UTC in the evening — their
// local "today" is UTC-yesterday, so their genuinely-today request
// looks past on the server. The one-day buffer covers that. The
// symmetric price is that users east of UTC in the morning can
// submit UTC-yesterday (their real yesterday) — acceptable for a
// search endpoint where the worst outcome is an empty result set.
export function earliestAllowedIsoDate(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const yesterday = new Date(Date.UTC(y, m, d - 1));
  return yesterday.toISOString().slice(0, 10);
}

// Throws DATE_IN_PAST for the first labeled date that is a
// shape-valid YYYY-MM-DD strictly before `earliestAllowedIsoDate`.
// Undefined values (optional fields like return_date) and malformed
// strings are skipped — the latter get caught by the service's zod
// IsoDate check and surface as a proper 400 there. Labeled so the
// error message names the specific field.
export function assertNoPastDates(
  dates: ReadonlyArray<readonly [label: string, value: string | undefined]>,
  now: Date = new Date(),
): void {
  const earliest = earliestAllowedIsoDate(now);
  for (const [label, value] of dates) {
    if (value === undefined || !ISO_DATE_RE.test(value)) continue;
    if (value < earliest) {
      throw new TravelServiceError(
        `${label} must not be in the past.`,
        'DATE_IN_PAST',
      );
    }
  }
}
