/**
 * The portal's games: the one list every per-game screen and query is built from.
 *
 * Before this existed the list was written out by hand in about six places (feedback's allowed
 * values and form, profile and admin counts, admin labels), and each new game was missed somewhere:
 * Steady Eddie's and then Niccolò Rising's feedback were both silently filed as 'general'.
 * Adding a game is now one entry here.
 *
 * `key` is the value stored in games.game and feedback.game (VARCHAR(16), so 16 characters at most).
 * `slug` is the game's URL segment, both for its client (/tea-race/) and its save endpoint
 * (/api/play/tea-race).
 * `optIn` marks a game that no account has until an admin turns it on (Admin page, Game access).
 * Every other game is on for an account whose access was never set (users.game_access NULL); an
 * opt-in game is not, so adding one never puts it in front of every existing account.
 */
export const GAMES = [
  { key: 'thrash_margin', slug: 'thrash-margin', label: 'Thrash Margin', short: 'TM' },
  { key: 'niccolo', slug: 'niccolo', label: 'Banco di Niccolò', short: 'Niccolò' },
  { key: 'niccolo_rising', slug: 'niccolo-rising', label: 'Niccolò Rising', short: 'Rising' },
  { key: 'tea_race', slug: 'tea-race', label: 'The Tea Race', short: 'Tea Race' },
  { key: 'steady_eddie', slug: 'steady-eddie', label: 'Steady Eddie', short: 'Steady Eddie' },
  // A personal CEO coaching game, not a game for the whole portal: off until an admin turns it on.
  { key: 'founders_ledger', slug: 'founders-ledger', label: "The Founder's Ledger", short: 'Ledger', optIn: true },
] as const;

export type GameKey = (typeof GAMES)[number]['key'];

export const GAME_KEYS: readonly string[] = GAMES.map(g => g.key);

/** The games an account has when its access was never set: every game except the opt-in ones. */
export const DEFAULT_GAME_KEYS: readonly string[] = GAMES.filter(g => !('optIn' in g && g.optIn)).map(g => g.key);

/** Feedback can also be about the portal as a whole. */
export const FEEDBACK_TOPICS = [
  { key: 'general', label: 'General / Portal' },
  ...GAMES.map(g => ({ key: g.key as string, label: g.label })),
];

/** Per-game counts with every game present, from a `{ game: count }` object (missing means 0). */
export function countsByGame(raw: unknown): Record<string, number> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(GAMES.map(g => [g.key, Number(src[g.key] ?? 0)]));
}

/**
 * SQL for one user's saves per game, as a JSON object, for a query where the user row is `u`.
 * Grouped by whatever is in the table, so a new game is counted without editing any query.
 */
export const GAMES_BY_TITLE_SQL = `(
  SELECT COALESCE(json_object_agg(c.game, c.n), '{}'::json)
  FROM (SELECT game, COUNT(*) AS n FROM games WHERE owner_id = u.id GROUP BY game) c
)`;
