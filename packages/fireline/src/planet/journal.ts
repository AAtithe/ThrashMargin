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

/** A list of names as prose: "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
