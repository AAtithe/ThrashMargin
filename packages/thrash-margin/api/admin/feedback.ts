import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { isAdminUsername } from '../_lib/admin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }
  if (!isAdminUsername(user.username)) return res.status(403).json({ message: 'Admin access only' });

  const db = getDb();

  if (req.method === 'GET') {
    try {
      const { rows } = await db.query(
        `SELECT f.id, f.game, f.type, f.message, f.status, f.created_at,
                u.username
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         ORDER BY f.created_at DESC
         LIMIT 200`,
      );
      const items = rows.map(r => ({
        id: r.id,
        game: r.game,
        type: r.type,
        message: r.message,
        status: r.status,
        createdAt: new Date(r.created_at).getTime(),
        username: r.username ?? '(deleted user)',
      }));
      return res.json({ items });
    } catch (err) {
      console.error('admin list feedback error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body ?? {};
    if (!id || (status !== 'open' && status !== 'resolved')) {
      return res.status(400).json({ message: 'id and status (open|resolved) required' });
    }
    try {
      await db.query('UPDATE feedback SET status = $1 WHERE id = $2', [status, id]);
      return res.json({ success: true });
    } catch (err) {
      console.error('admin update feedback error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
