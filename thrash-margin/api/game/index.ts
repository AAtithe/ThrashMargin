import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { createInitialState, DEFAULT_CONFIG } from '../../shared/engine-reference';
import type { GameConfig } from '../../shared/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }

  const db = getDb();

  if (req.method === 'POST') {
    const config: Partial<GameConfig> = req.body?.config ?? {};
    const name: string = ((req.body?.name as string | undefined) ?? 'Campaign').trim();
    const id = uuid();
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const state = createInitialState(id, mergedConfig);
    (state as unknown as Record<string, unknown>).name = name;
    try {
      await db.query(
        'INSERT INTO games (id, owner_id, mode, status, turn, state, config) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, user.userId, 'single', state.status, state.turn, JSON.stringify(state), JSON.stringify(mergedConfig)],
      );
      return res.status(201).json({ gameId: id, state });
    } catch (err) {
      console.error('create game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'GET') {
    try {
      const { rows } = await db.query(
        `SELECT id, status, turn,
                state->>'name' AS name,
                config->>'diff' AS diff,
                EXTRACT(EPOCH FROM updated_at) * 1000 AS saved_at
         FROM games WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 50`,
        [user.userId],
      );
      const saves = rows.map(r => ({
        id: r.id,
        name: r.name ?? 'Campaign',
        turn: Number(r.turn) ?? 1,
        status: r.status,
        diff: r.diff ?? 'normal',
        savedAt: Math.round(parseFloat(r.saved_at)),
      }));
      return res.json({ saves });
    } catch (err) {
      console.error('list games error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
