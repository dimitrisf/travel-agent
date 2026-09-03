// Today's date as YYYY-MM-DD in the caller's LOCAL calendar. Used as
// the `min` on Explorer's <input type="date"> controls so the native
// picker greys out past days. Local — not UTC — because the picker
// shows the viewer's local calendar; using UTC would disallow local
// "today" for viewers west of UTC (e.g. an America user at 20:00
// would see min = tomorrow-in-UTC and be unable to pick today).
export function todayLocalIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
