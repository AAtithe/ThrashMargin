import type { Pool } from 'pg';
import { GAMES, GAME_KEYS } from '../../shared/games';
import { ensureSchema } from './schema';

// Which games an account may play.
//
// Stored on the account itself, `users.game_access` (JSONB):
//   - NULL       every game, including any game added to the portal later. Every account that
//                existed before access control did is NULL, so nobody lost a game when it shipped.
//   - [keys...]  exactly those games (keys from GAMES in shared/games.ts). [] means none.
//
// New accounts take their list from the portal setting `new_account_games` (portal_settings), set on
// the Admin page. It is copied onto the account once, at registration: changing the setting later
// never changes an existing account. While the setting has never been saved, new accounts are NULL
// (every game), which is how the portal behaved before this existed.
//
// Enforced server-side in api/play/[kind].ts, before any game's handler runs: an account without
// access to a game gets 403 on every request to it (list, load, create, save, delete). The lobbies'
// own check (session.ts, hasGameAccess) is presentational only, like their sign-in check.

export const NEW_ACCOUNT_GAMES = 'new_account_games';

/** A stored value as the list of games it allows. Unknown keys are dropped; NULL is every game. */
export function resolveAccess(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [...GAME_KEYS];
  if (!Array.isArray(raw)) return [];
  return GAME_KEYS.filter(k => raw.includes(k));
}

/** A request body's list of games, or null if it is not a list of known game keys. */
export function parseGameList(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.some(k => typeof k !== 'string' || !GAME_KEYS.includes(k))) return null;
  return GAME_KEYS.filter(k => raw.includes(k)); // de-duplicated, in the portal's order
}

export function isGameKey(raw: unknown): raw is string {
  return typeof raw === 'string' && GAME_KEYS.includes(raw);
}

export function gameKeyForSlug(slug: string): string | undefined {
  return GAMES.find(g => g.slug === slug)?.key;
}

/** The games this account may play. Throws on a database error: callers answer 503, never "allowed". */
export async function gamesFor(db: Pool, userId: string): Promise<string[]> {
  await ensureSchema(db);
  const { rows } = await db.query('SELECT game_access FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return [];
  return resolveAccess(rows[0].game_access);
}

/**
 * The value a new account is created with: the saved setting, or NULL (every game) if it has never
 * been saved. Read with the same query that inserts the account, so this returns the raw JSON.
 */
export async function newAccountAccess(db: { query: Pool['query'] }): Promise<string[] | null> {
  const { rows } = await db.query('SELECT value FROM portal_settings WHERE key = $1', [NEW_ACCOUNT_GAMES]);
  if (!rows[0]) return null;
  return resolveAccess(rows[0].value);
}
