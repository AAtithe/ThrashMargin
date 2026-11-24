/**
 * War for the Planet: the journal (fireline-planet-design.md, section 4). W1.
 * Newest last, capped at JOURNAL_MAX. Pure.
 */
import { JOURNAL_MAX } from './rules';
import type { FactionId, JournalEntry, PlanetState } from './types';

/** Appends an entry to a draft state in place (callers own the draft), dropping the oldest. */
export function note(d: PlanetState, text: string, tone: JournalEntry['tone'] = 'info', f?: FactionId): void {
  const e: JournalEntry = f === undefined ? { turn: d.turn, text, tone } : { turn: d.turn, text, tone, f };
  d.journal.push(e);
  if (d.journal.length > JOURNAL_MAX) d.journal.splice(0, d.journal.length - JOURNAL_MAX);
}

// round7:review begin. The after-action review: a fought battle's turning points on its journal entry.
/** Lines kept, and characters a line. */
export const REVIEW_LINES_MAX = 3;
export const REVIEW_LINE_CHARS = 160;

/** The lines a report or a save may carry: strings, at most REVIEW_LINES_MAX, each cut to REVIEW_LINE_CHARS; null when none. */
export function cleanReview(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const lines = raw.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, REVIEW_LINES_MAX).map(x => x.slice(0, REVIEW_LINE_CHARS));
  return lines.length ? lines : null;
}

/**
 * Puts the review on the newest entry (the battle's result, just noted) and takes it off every
 * other, so the journal holds one battle's review at most. Entries are replaced, never edited.
 */
export function attachReview(d: PlanetState, raw: unknown): void {
  const lines = cleanReview(raw);
  if (!lines || !d.journal.length) return;
  d.journal = d.journal.map(e => {
    if (!e.review) return e;
    const { review: _old, ...rest } = e;
    return rest;
  });
  const i = d.journal.length - 1;
  d.journal[i] = { ...d.journal[i], review: lines };
}
// round7:review end.

/** A list of names as prose: "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
