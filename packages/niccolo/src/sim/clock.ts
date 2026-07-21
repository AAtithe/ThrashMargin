// Duplicated from packages/engine/src/clock.ts rather than imported from `@repo/engine`.
// That workspace package's package.json points `main` straight at raw TypeScript source with
// no compiled output, which Vite's dev/build bundler handles fine but Vercel's serverless
// function builder cannot resolve at runtime (confirmed via a diagnostic endpoint — importing
// `@repo/engine` alone, with nothing else, crashed the function with FUNCTION_INVOCATION_FAILED).
// Since Niccolo's API routes need `createInitialState`'s full dependency chain to be reliably
// deployable, this trades a small amount of duplication for not depending on that resolution
// behaviour at all. Content is unchanged from the shared engine.

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
