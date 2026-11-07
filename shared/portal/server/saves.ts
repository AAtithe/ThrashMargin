import type { Pool } from 'pg';
import type { VercelResponse } from '@vercel/node';

/**
 * Saving a game's state, for every game's PUT.
 *
 * Each save carries the version it was based on. The write only happens if the stored game is
 * still at that version, and bumps it. So with the same game open in two tabs or on two devices,
 * the second to save gets 409 and is told to reload, instead of silently overwriting the other's
 * progress. A save with no version (a page loaded before versions existed) is accepted as before.
 *
 * A save for a game that no longer exists answers 404. It used to answer "success" while writing
 * nothing, so the game carried on believing it was being saved.
 */
export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'conflict' | 'missing' | 'too_large' | 'storage_full' };

/**
 * Limits on what one account can store, so a script signed in as one player cannot fill the
 * database (the security review of November 2026 found no limit at all: unlimited games, each up to
 * Vercel's 4.5 MB request cap). Set far above real play: the largest save any game's harness
 * produces is about 76 KB, and ten years of a Banco di Niccolò campaign stays near 52 KB.
 *  - one save: 512 KB of JSON;
 *  - games per player per game: 50, the same number the game list shows, so a player can never have
 *    a save they cannot see and delete;
 *  - everything one account stores, across every game: 25 MB.
 */
export const MAX_SAVE_BYTES = 512 * 1024;
export const MAX_GAMES_PER_KIND = 50;
export const MAX_ACCOUNT_BYTES = 25 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveState(
  db: Pool,
  p: { id: string; ownerId: string; game: string; state: unknown; status: string; turn: number; version: unknown },
): Promise<SaveResult> {
  if (!UUID_RE.test(p.id)) return { ok: false, reason: 'missing' };
  const expected = Number.isInteger(p.version) ? (p.version as number) : null;
  const json = JSON.stringify(p.state ?? null);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_SAVE_BYTES) return { ok: false, reason: 'too_large' };
  // Everything else this account stores (as stored, i.e. compressed), plus this save at full size.
  const { rows: used } = await db.query(
    'SELECT COALESCE(SUM(pg_column_size(state)), 0)::bigint AS n FROM games WHERE owner_id = $1 AND id <> $2',
    [p.ownerId, p.id],
  );
  if (Number(used[0].n) + bytes > MAX_ACCOUNT_BYTES) return { ok: false, reason: 'storage_full' };
  const { rows } = await db.query(
    `UPDATE games
     SET state = $1, status = $2, turn = $3, version = version + 1, updated_at = NOW()
     WHERE id = $4 AND owner_id = $5 AND game = $6 AND ($7::int IS NULL OR version = $7)
     RETURNING version`,
    [json, p.status, p.turn, p.id, p.ownerId, p.game, expected],
  );
  if (rows[0]) return { ok: true, version: rows[0].version };
  const { rowCount } = await db.query('SELECT 1 FROM games WHERE id = $1 AND owner_id = $2 AND game = $3', [
    p.id,
    p.ownerId,
    p.game,
  ]);
  return { ok: false, reason: rowCount ? 'conflict' : 'missing' };
}

export function sendSaveResult(res: VercelResponse, r: SaveResult) {
  if (r.ok) return res.json({ success: true, version: r.version });
  if (r.reason === 'conflict') {
    return res.status(409).json({
      message: 'This game has been saved from another tab or device since you opened it. Reload to continue.',
    });
  }
  if (r.reason === 'too_large') {
    return res.status(413).json({ message: 'This save is larger than the portal accepts.' });
  }
  if (r.reason === 'storage_full') {
    return res.status(413).json({ message: 'Your account is out of storage. Delete some old games, then try again.' });
  }
  return res.status(404).json({ message: 'Game not found' });
}

/**
 * Creates a game row, unless the player already has MAX_GAMES_PER_KIND games of this kind: the count
 * and the insert are one statement. Returns false when the limit refused it (send sendGameLimit).
 */
export async function createGame(
  db: Pool,
  p: { id: string; ownerId: string; game: string; status: string; turn: number; state: unknown; config: unknown },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO games (id, owner_id, game, mode, status, turn, state, config)
     SELECT $1::uuid, $2::uuid, $3::varchar, 'single', $4::varchar, $5::int, $6::jsonb, $7::jsonb
     WHERE (SELECT COUNT(*) FROM games WHERE owner_id = $2::uuid AND game = $3::varchar) < $8::int`,
    [p.id, p.ownerId, p.game, p.status, p.turn, JSON.stringify(p.state), JSON.stringify(p.config), MAX_GAMES_PER_KIND],
  );
  return !!rowCount;
}

export function sendGameLimit(res: VercelResponse) {
  return res.status(409).json({
    message: `You have ${MAX_GAMES_PER_KIND} saved games in this game, the most it keeps. Delete one to start another.`,
  });
}

/** A display name from the request: a string, trimmed, at most 40 characters, else the fallback. */
export function cleanName(raw: unknown, fallback: string): string {
  return (typeof raw === 'string' ? raw.trim().slice(0, 40) : '') || fallback;
}

/** Player names for a multi-seat game: strings only, each cleaned, at most `max` of them. */
export function cleanNames(raw: unknown, max: number, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  return raw
    .filter((n): n is string => typeof n === 'string')
    .map(n => n.trim().slice(0, 40))
    .slice(0, max);
}

/** True for a well-formed game id; anything else cannot exist, so lookups can answer 404 early. */
export function isGameId(id: string): boolean {
  return UUID_RE.test(id);
}
