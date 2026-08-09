import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { isAdminUsername } from '../_lib/admin';

// Combines what were two separate functions (users.ts, feedback.ts) into one, dispatching on
// the [resource] route param — Vercel's Hobby plan caps a deployment at 12 serverless
// functions, and the portal's three games plus this admin surface were pushing past it.
// URLs are unchanged: /api/admin/users and /api/admin/feedback still resolve here.

async function listUsers(res: VercelResponse) {
  const db = getDb();
  try {
    const { rows } = await db.query(
      `SELECT
         u.id, u.username, u.email, u.created_at, u.last_login_at,
         COUNT(g.id) FILTER (WHERE g.game = 'thrash_margin')            AS tm_games,
         COUNT(g.id) FILTER (WHERE g.game = 'niccolo')                  AS niccolo_games,
         COUNT(g.id) FILTER (WHERE g.game = 'tea_race')                 AS tearace_games,
         COUNT(g.id) FILTER (WHERE g.status = 'active')                 AS active_games,
         COUNT(g.id) FILTER (WHERE g.status = 'victory')                AS wins
       FROM users u
       LEFT JOIN games g ON g.owner_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    );
    const users = rows.map(r => ({
      id: r.id,
      username: r.username,
      email: r.email,
      registeredAt: new Date(r.created_at).getTime(),
      lastLoginAt: r.last_login_at ? new Date(r.last_login_at).getTime() : null,
      gamesByTitle: {
        thrash_margin: Number(r.tm_games),
        niccolo: Number(r.niccolo_games),
        tea_race: Number(r.tearace_games),
      },
      activeGames: Number(r.active_games),
      wins: Number(r.wins),
    }));
    return res.json({ users });
  } catch (err) {
    console.error('admin list users error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function listFeedback(res: VercelResponse) {
  const db = getDb();
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

async function updateFeedback(req: VercelRequest, res: VercelResponse) {
  const { id, status } = req.body ?? {};
  if (!id || (status !== 'open' && status !== 'resolved')) {
    return res.status(400).json({ message: 'id and status (open|resolved) required' });
  }
  const db = getDb();
  try {
    await db.query('UPDATE feedback SET status = $1 WHERE id = $2', [status, id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('admin update feedback error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }
  if (!isAdminUsername(user.username)) return res.status(403).json({ message: 'Admin access only' });

  const resource = req.query.resource;

  if (resource === 'users' && req.method === 'GET') return listUsers(res);
  if (resource === 'feedback' && req.method === 'GET') return listFeedback(res);
  if (resource === 'feedback' && req.method === 'PATCH') return updateFeedback(req, res);

  return res.status(404).json({ message: 'Not found' });
}
