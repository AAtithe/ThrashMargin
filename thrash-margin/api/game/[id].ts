import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }

  const { id } = req.query;
  const db = getDb();
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
