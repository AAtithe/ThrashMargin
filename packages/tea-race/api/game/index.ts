import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { createInitialState } from '../../src/sim/state';

/**
 * The same `games` table Thrash Margin and Niccolo use — one Postgres/Supabase instance, one
 * users/auth setup — discriminated by the `game` column so no app's list or lookup queries ever
 * see another's rows. The column is VARCHAR(16), which 'tea_race' fits, and carries no CHECK
 * constraint, so adding a third game needed no migration.
 */
const GAME_KIND = 'tea_race';

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
    const name: string = ((req.body?.name as string | undefined) ?? 'Voyage').trim();
    const humanNames: string[] = Array.isArray(req.body?.humanNames)
      ? (req.body.humanNames as unknown[]).filter((n): n is string => typeof n === 'string')
      : ['You'];
    const aiCount = Number.isFinite(req.body?.aiCount) ? Number(req.body.aiCount) : 3;
    const seed = typeof req.body?.seed === 'string' ? req.body.seed : undefined;

    const id = uuid();
    const state = createInitialState(id, name, {
      humanNames,
      aiCount,
      seed,
      createdAt: Date.now(),
    });

    try {
      await db.query(
        `INSERT INTO games (id, owner_id, game, mode, status, turn, state, config)
         VALUES ($1, $2, $3, 'single', 'active', $4, $5, '{}')`,
        [id, user.userId, GAME_KIND, state.round, JSON.stringify(state)],
      );
      return res.status(201).json({ gameId: id, state });
    } catch (err) {
      console.error('create tea-race game error', err);
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
        name: r.name ?? 'Voyage',
        turn: Number(r.turn) ?? 0,
        status: r.status,
        savedAt: Math.round(parseFloat(r.saved_at)),
      }));
      return res.json({ saves });
    } catch (err) {
      console.error('list tea-race games error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
