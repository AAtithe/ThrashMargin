import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';

const GAME_KIND = 'tea_race';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  let user;
  try {
    user = getUser(req);
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.query;
  const db = getDb();

  if (req.method === 'GET') {
    try {
      const { rows } = await db.query(
        'SELECT state FROM games WHERE id = $1 AND owner_id = $2 AND game = $3',
        [id, user.userId, GAME_KIND],
      );
      if (!rows[0]) return res.status(404).json({ message: 'Game not found' });
      return res.json({ state: rows[0].state });
    } catch (err) {
      console.error('get tea-race game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PUT') {
    // Overwrite full state — the client is authoritative (single-player against computer captains,
    // or hotseat on one device; no server-side action validation), and syncs its whole GameState
    // after every dispatched action. Same trust model as the other two games.
    const { state } = req.body ?? {};
    if (!state) return res.status(400).json({ message: 'state required' });
    try {
      // The Tea Race has no losing state of its own — a captain who runs out of money can always
      // sell a share back and carry on — so a game is either won or still being played.
      const status = state.winnerId ? 'victory' : 'active';
      await db.query(
        `UPDATE games SET state = $1, status = $2, turn = $3, updated_at = NOW()
         WHERE id = $4 AND owner_id = $5 AND game = $6`,
        [JSON.stringify(state), status, state.round ?? 0, id, user.userId, GAME_KIND],
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('save tea-race state error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await db.query('DELETE FROM games WHERE id = $1 AND owner_id = $2 AND game = $3', [
        id,
        user.userId,
        GAME_KIND,
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('delete tea-race game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
