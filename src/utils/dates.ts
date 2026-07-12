export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// We define a function that computes the next four Fridays (or fewer if less than 4 Fridays in the next 28 days) from a given anchor date. This is used to validate user input for check-in dates. The function returns an array of strings in the format YYYY-MM-DD representing the upcoming Fridays.
export function upcomingFridaysFrom(anchor: Date, count = 4): string[] {
  const fridays: string[] = [];
  for (let offset = 0; offset < 28 && fridays.length < count; offset++) {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() + offset);
    if (d.getUTCDay() === 5) fridays.push(d.toISOString().slice(0, 10));
  }
  return fridays;
}
