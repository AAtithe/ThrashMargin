import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../../../thrash-margin/api/_lib/db';
import { getUser } from '../../../thrash-margin/api/_lib/auth';
import { handleCors } from '../../../thrash-margin/api/_lib/cors';

const GAME_KIND = 'niccolo';

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
      console.error('get niccolo game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PUT') {
    // Overwrite full state — the client is authoritative (single-player, no server-side
    // action validation) and syncs its whole GameState after every dispatched action.
    const { state } = req.body ?? {};
    if (!state) return res.status(400).json({ message: 'state required' });
    try {
      const status = state.insolvent ? 'defeated' : state.flags?.chapter1_complete ? 'victory' : 'active';
      await db.query(
        `UPDATE games SET state = $1, status = $2, turn = $3, updated_at = NOW()
         WHERE id = $4 AND owner_id = $5 AND game = $6`,
        [JSON.stringify(state), status, state.week ?? 0, id, user.userId, GAME_KIND],
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('save niccolo state error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await db.query('DELETE FROM games WHERE id = $1 AND owner_id = $2 AND game = $3', [id, user.userId, GAME_KIND]);
      return res.json({ success: true });
    } catch (err) {
      console.error('delete niccolo game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
