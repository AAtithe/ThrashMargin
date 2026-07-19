import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }

  const { id } = req.query;
  const db = getDb();

  if (req.method === 'GET') {
    try {
      const { rows } = await db.query(
        'SELECT state FROM games WHERE id = $1 AND owner_id = $2',
        [id, user.userId],
      );
      if (!rows[0]) return res.status(404).json({ message: 'Game not found' });
      return res.json({ state: rows[0].state });
    } catch (err) {
      console.error('get game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PUT') {
    // Overwrite full state — client batches local actions and syncs once at end-of-turn
    const { state } = req.body ?? {};
    if (!state) return res.status(400).json({ message: 'state required' });
    try {
      const newStatus = state.status === 'victory' ? 'victory'
        : state.status === 'defeated' ? 'defeated' : 'active';
      await db.query(
        'UPDATE games SET state = $1, status = $2, turn = $3, updated_at = NOW() WHERE id = $4 AND owner_id = $5',
        [JSON.stringify(state), newStatus, state.turn, id, user.userId],
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('save state error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await db.query(
        'DELETE FROM games WHERE id = $1 AND owner_id = $2',
        [id, user.userId],
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('delete game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
