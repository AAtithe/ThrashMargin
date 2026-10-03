import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { createInitialState } from '../../src/sim/state';

/**
 * The same `games` table every other game in the portal uses, discriminated by the `game` column.
 * 'niccolo_rising' is 14 characters, inside the column's VARCHAR(16), and the column carries no
 * CHECK constraint, so a fifth game needs no migration.
 */
const GAME_KIND = 'niccolo_rising';

/**
 * One function for `/api/niccolo-rising/game` (list, create) and `?id=` (load, save, delete), for
 * the reason Steady Eddie's records: the Hobby plan's 12-function ceiling. This is the tenth.
 *
 * Every route calls getUser first and 401s without a verified token. That is the portal's real
 * sign-in boundary (CLAUDE.md, invariant 1) and must never be made optional.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  let user;
  try {
    user = getUser(req);
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const db = getDb();
  const idParam = req.query.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;

  if (id === undefined) {
    if (req.method === 'POST') {
      const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
      const name = rawName.trim().slice(0, 40) || 'Claes';
      const seed = typeof req.body?.seed === 'string' ? req.body.seed.slice(0, 64) : undefined;
      const newId = uuid();
      // The server's clock, not the client's, starts the character. The client is authoritative
      // after this (see the design doc, section 4), but creation at least starts honest.
      const state = createInitialState(newId, name, { seed, createdAt: Date.now() });
      try {
        await db.query(
          `INSERT INTO games (id, owner_id, game, mode, status, turn, state, config)
           VALUES ($1, $2, $3, 'single', 'active', $4, $5, '{}')`,
          [newId, user.userId, GAME_KIND, state.level, JSON.stringify(state)],
        );
        return res.status(201).json({ gameId: newId, state });
      } catch (err) {
        console.error('create niccolo-rising game error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    if (req.method === 'GET') {
      try {
        const { rows } = await db.query(
          `SELECT id, status, turn, state->>'name' AS name,
                  EXTRACT(EPOCH FROM updated_at) * 1000 AS saved_at
           FROM games WHERE owner_id = $1 AND game = $2 ORDER BY updated_at DESC LIMIT 50`,
          [user.userId, GAME_KIND],
        );
        const saves = rows.map(r => ({
          id: r.id,
          name: r.name ?? 'Claes',
          turn: Number(r.turn) || 1,
          status: r.status,
          savedAt: Math.round(parseFloat(r.saved_at)),
        }));
        return res.json({ saves });
      } catch (err) {
        console.error('list niccolo-rising games error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    return res.status(405).end();
  }

  if (req.method === 'GET') {
    try {
      const { rows } = await db.query(
        'SELECT state FROM games WHERE id = $1 AND owner_id = $2 AND game = $3',
        [id, user.userId, GAME_KIND],
      );
      if (!rows[0]) return res.status(404).json({ message: 'Character not found' });
      return res.json({ state: rows[0].state });
    } catch (err) {
      console.error('get niccolo-rising game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PUT') {
    const { state } = req.body ?? {};
    if (!state || typeof state !== 'object') return res.status(400).json({ message: 'state required' });
    try {
      // A character has no end state: it is always active. `turn` carries the level for the list.
      const level = Number.isFinite(state.level) ? Number(state.level) : 1;
      await db.query(
        `UPDATE games SET state = $1, status = 'active', turn = $2, updated_at = NOW()
         WHERE id = $3 AND owner_id = $4 AND game = $5`,
        [JSON.stringify(state), level, id, user.userId, GAME_KIND],
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('save niccolo-rising state error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await db.query('DELETE FROM games WHERE id = $1 AND owner_id = $2 AND game = $3', [id, user.userId, GAME_KIND]);
      return res.json({ success: true });
    } catch (err) {
      console.error('delete niccolo-rising game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
