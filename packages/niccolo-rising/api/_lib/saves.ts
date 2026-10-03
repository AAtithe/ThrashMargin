// GENERATED from shared/portal/server/saves.ts by scripts/sync-shared.mjs. Do not edit this copy: edit the original,
// then run `npm run sync-shared`. `npm run check` fails while any copy differs.
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
export type SaveResult = { ok: true; version: number } | { ok: false; reason: 'conflict' | 'missing' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveState(
  db: Pool,
  p: { id: string; ownerId: string; game: string; state: unknown; status: string; turn: number; version: unknown },
): Promise<SaveResult> {
  if (!UUID_RE.test(p.id)) return { ok: false, reason: 'missing' };
  const expected = Number.isInteger(p.version) ? (p.version as number) : null;
  const { rows } = await db.query(
    `UPDATE games
     SET state = $1, status = $2, turn = $3, version = version + 1, updated_at = NOW()
     WHERE id = $4 AND owner_id = $5 AND game = $6 AND ($7::int IS NULL OR version = $7)
     RETURNING version`,
    [JSON.stringify(p.state), p.status, p.turn, p.id, p.ownerId, p.game, expected],
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
  return res.status(404).json({ message: 'Game not found' });
}

/** True for a well-formed game id; anything else cannot exist, so lookups can answer 404 early. */
export function isGameId(id: string): boolean {
  return UUID_RE.test(id);
}
