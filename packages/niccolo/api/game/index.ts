import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { createInitialState } from '../../src/sim/state';

/**
 * Same `games` table Thrash Margin uses (same Postgres/Supabase instance, same users/auth),
 * discriminated by the `game` column so both apps' saves can share one row of infrastructure
 * without either one's list/lookup queries seeing the other's rows.
 */
const GAME_KIND = 'niccolo';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  let user;
  try {
    user = getUser(req);
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const db = getDb();

  if (req.method === 'POST') {
    const name: string = ((req.body?.name as string | undefined) ?? 'Campaign').trim();
    const id = uuid();
    const state = createInitialState(id, name);

    try {
      await db.query(
        `INSERT INTO games (id, owner_id, game, mode, status, turn, state, config)
         VALUES ($1, $2, $3, 'single', 'active', $4, $5, '{}')`,
        [id, user.userId, GAME_KIND, state.week, JSON.stringify(state)],
      );
      return res.status(201).json({ gameId: id, state });
    } catch (err) {
      console.error('create niccolo game error', err);
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
        name: r.name ?? 'Campaign',
        turn: Number(r.turn) ?? 0,
        status: r.status,
        savedAt: Math.round(parseFloat(r.saved_at)),
      }));
      return res.json({ saves });
    } catch (err) {
      console.error('list niccolo games error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
