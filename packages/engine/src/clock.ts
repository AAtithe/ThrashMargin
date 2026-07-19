// Pure calendar utilities — no game-specific concepts.
// A "week" is an integer count of 7-day periods elapsed since a caller-supplied start date.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The calendar date at the start of the given week index. */
export function dateForWeek(week: number, startDate: Date): Date {
  const d = new Date(startDate.getTime());
  d.setDate(d.getDate() + week * 7);
  return d;
}

/** Render a week index as "Week of D Month YYYY". */
export function formatWeekDate(week: number, startDate: Date): string {
  const d = dateForWeek(week, startDate);
  return `Week of ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Advance a week counter by one. Trivial, but keeps the mutation in one named place. */
export function advanceWeek(week: number): number {
  return week + 1;
}
