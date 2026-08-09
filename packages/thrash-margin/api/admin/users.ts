import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { isAdminUsername } from '../_lib/admin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }
  if (!isAdminUsername(user.username)) return res.status(403).json({ message: 'Admin access only' });

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
