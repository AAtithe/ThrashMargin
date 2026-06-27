import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../../_lib/db';
import { getUser } from '../../_lib/auth';
import { handleCors } from '../../_lib/cors';
import { processAction } from '../../../shared/engine-reference';
import type { GameAction } from '../../../shared/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }

  const { id } = req.query;
  const action: GameAction = req.body?.action;
  if (!action?.type) return res.status(400).json({ message: 'action.type required' });

  const db = getDb();
  try {
    const { rows } = await db.query(
      'SELECT state FROM games WHERE id = $1 AND owner_id = $2',
      [id, user.userId],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ message: 'Game not found' });

    const currentState = row.state;
    if (currentState.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Game is over', state: currentState });
    }

    const newState = processAction(currentState, action);

    await db.query(
      'UPDATE games SET state = $1, status = $2, turn = $3, updated_at = NOW() WHERE id = $4',
      [JSON.stringify(newState), newState.status, newState.turn, id],
    );

    await db.query(
      'INSERT INTO game_actions (id, game_id, user_id, turn, action) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
      [id, user.userId, currentState.turn, JSON.stringify(action)],
    );

    if (newState.status !== 'active') {
      const won = newState.status === 'victory' ? 1 : 0;
      await db.query(
        `INSERT INTO player_stats (user_id, games_played, games_won, games_lost)
         VALUES ($1, 1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET
           games_played = player_stats.games_played + 1,
           games_won    = player_stats.games_won    + $2,
           games_lost   = player_stats.games_lost   + $3,
           updated_at   = NOW()`,
        [user.userId, won, 1 - won],
      );
    }

    return res.json({ success: true, state: newState });
  } catch (err) {
    console.error('action error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
