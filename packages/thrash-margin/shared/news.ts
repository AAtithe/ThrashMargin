/**
 * The portal's news: launch notes for new games, feature updates, and the monthly roundup.
 *
 * One announcement is written once on the Admin page and appears in two places: the "What's new"
 * page on the portal (pages/News.tsx) and, for players who have asked for it, an email
 * (api/_lib/newsEmail.ts). Both are built from the same plain fields below, never from HTML an
 * admin typed, so neither can carry markup or script from the editor.
 */
import { GAMES } from './games';

export const NEWS_KINDS = [
  { key: 'new_game', label: 'New game', eyebrow: 'Now playing' },
  { key: 'update', label: 'Update', eyebrow: 'Just shipped' },
  { key: 'newsletter', label: 'Monthly roundup', eyebrow: 'The monthly roundup' },
] as const;

export type NewsKind = (typeof NEWS_KINDS)[number]['key'];

export interface NewsSection {
  heading: string;
  /** Plain text. A blank line starts a new paragraph. */
  body: string;
  /** Optional game this section is about: shows its name and a link to play it. */
  game?: string;
}

export interface NewsDraft {
  kind: NewsKind;
  title: string;
  /** One or two sentences: the teaser on the news page, and the email's preview line. */
  summary: string;
  /** The game the whole piece is about, if any: sets its accent colour and the main button. */
  game?: string;
  sections: NewsSection[];
}

export interface NewsItem extends NewsDraft {
  id: string;
  status: 'draft' | 'published';
  publishedAt: number | null;
  createdAt: number;
}

export const LIMITS = { title: 120, summary: 400, heading: 120, body: 6000, sections: 12 };

/**
 * Each game's accent, for the news page and the emails. Emails cannot use the portal's CSS
 * variables, so these are fixed colours chosen to read on both a white and a near-black ground.
 */
export const GAME_ACCENTS: Record<string, string> = {
  thrash_margin: '#b4532a',
  niccolo: '#8a6d1f',
  niccolo_rising: '#6b4fa0',
  tea_race: '#1f6f8b',
  steady_eddie: '#2f7d4f',
  fireline: '#b8322a',
  founders_ledger: '#3d4f7a',
};
export const HOUSE_ACCENT = '#a8843f';

export function accentFor(game?: string): string {
  return (game && GAME_ACCENTS[game]) || HOUSE_ACCENT;
}

export function gameLabel(key?: string): string | undefined {
  return GAMES.find(g => g.key === key)?.label;
}

/** The game's path on the portal ('/tea-race/'). Niccolò Rising is served at /rising/. */
export function gamePath(key?: string): string | undefined {
  const g = GAMES.find(x => x.key === key);
  if (!g) return undefined;
  return g.slug === 'niccolo-rising' ? '/rising/' : `/${g.slug}/`;
}

export function kindInfo(kind: string) {
  return NEWS_KINDS.find(k => k.key === kind) ?? NEWS_KINDS[1];
}

export function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const gameKey = (v: unknown) => (typeof v === 'string' && GAMES.some(g => g.key === v) ? v : undefined);

/**
 * A draft from a request body, cleaned: unknown fields dropped, every string trimmed and cut to its
 * limit, unknown games and kinds refused. Returns the reason instead when it cannot be saved.
 */
export function parseDraft(raw: unknown): NewsDraft | string {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = NEWS_KINDS.some(k => k.key === b.kind) ? (b.kind as NewsKind) : null;
  if (!kind) return 'Choose what kind of piece this is.';
  const title = str(b.title, LIMITS.title);
  if (!title) return 'Give it a title.';
  const summary = str(b.summary, LIMITS.summary);
  if (!summary) return 'Write a short summary: it is the teaser on the news page and the email preview line.';
  if (b.game !== undefined && b.game !== '' && !gameKey(b.game)) return 'Unknown game.';
  const rawSections = Array.isArray(b.sections) ? b.sections.slice(0, LIMITS.sections) : [];
  const sections: NewsSection[] = [];
  for (const s of rawSections) {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const heading = str(o.heading, LIMITS.heading);
    const body = str(o.body, LIMITS.body);
    if (!heading && !body) continue;
    if (o.game !== undefined && o.game !== '' && !gameKey(o.game)) return 'Unknown game in a section.';
    sections.push({ heading, body, ...(gameKey(o.game) ? { game: gameKey(o.game) } : {}) });
  }
  if (!sections.length) return 'Add at least one section.';
  return { kind, title, summary, ...(gameKey(b.game) ? { game: gameKey(b.game) } : {}), sections };
}
