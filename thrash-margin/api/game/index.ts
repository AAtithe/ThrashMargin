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
    const id = uuid();
    const state = createInitialState(id, { ...DEFAULT_CONFIG, ...config });
    try {
      await db.query(
        'INSERT INTO games (id, owner_id, mode, status, turn, state, config) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, user.userId, 'single', state.status, state.turn, JSON.stringify(state), JSON.stringify(state.config)],
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
        'SELECT id, status, turn, created_at FROM games WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 20',
        [user.userId],
      );
      return res.json({ games: rows });
    } catch (err) {
      console.error('list games error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
