import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../../_lib/db';
import { getUser } from '../../_lib/auth';
import { handleCors } from '../../_lib/cors';

// Discriminator for the shared `games` table — see api/game/index.ts for the full explanation.
const GAME_KIND = 'thrash_margin';

// PUT /api/game/:id/state — overwrite full state. The client (useGame.ts) batches local
// actions and syncs once at end-of-turn to this path. It previously had no matching Vercel
// function (only the local Express dev server implemented PUT /:id/state), so in production
// every end-of-turn sync 404'd silently and cloud saves never advanced past turn 1.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'PUT') return res.status(405).end();

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }

  const { id } = req.query;
  const { state } = req.body ?? {};
  if (!state) return res.status(400).json({ message: 'state required' });

  const db = getDb();
  try {
    const newStatus = state.status === 'victory' ? 'victory'
      : state.status === 'defeated' ? 'defeated' : 'active';
    await db.query(
      'UPDATE games SET state = $1, status = $2, turn = $3, updated_at = NOW() WHERE id = $4 AND owner_id = $5 AND game = $6',
      [JSON.stringify(state), newStatus, state.turn, id, user.userId, GAME_KIND],
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('save state error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
