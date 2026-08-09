import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { getDb } from './_lib/db';
import { getUser } from './_lib/auth';
import { handleCors } from './_lib/cors';

// /api/profile — a signed-in user's own account. Unlike /api/admin/users, this only ever
// reads or writes the row matching the caller's own JWT userId; there is no way to pass a
// different user's id in.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }

  const db = getDb();

  if (req.method === 'GET') {
    try {
      const { rows } = await db.query(
        `SELECT
           u.id, u.username, u.email, u.created_at, u.last_login_at,
           COUNT(g.id) FILTER (WHERE g.game = 'thrash_margin') AS tm_games,
           COUNT(g.id) FILTER (WHERE g.game = 'niccolo')       AS niccolo_games,
           COUNT(g.id) FILTER (WHERE g.game = 'tea_race')      AS tearace_games,
           COUNT(g.id) FILTER (WHERE g.status = 'active')      AS active_games,
           COUNT(g.id) FILTER (WHERE g.status = 'victory')     AS wins
         FROM users u
         LEFT JOIN games g ON g.owner_id = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
        [user.userId],
      );
      const r = rows[0];
      if (!r) return res.status(404).json({ message: 'Account not found' });
      return res.json({
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
      });
    } catch (err) {
      console.error('get profile error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PATCH') {
    const { currentPassword, newEmail, newPassword } = req.body ?? {};
    if (!currentPassword) return res.status(400).json({ message: 'Current password is required' });
    if (!newEmail && !newPassword) return res.status(400).json({ message: 'Nothing to update' });
    if (newPassword && String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    try {
      const { rows } = await db.query('SELECT password FROM users WHERE id = $1', [user.userId]);
      const row = rows[0];
      if (!row) return res.status(404).json({ message: 'Account not found' });
      const match = await bcrypt.compare(String(currentPassword), row.password);
      if (!match) return res.status(401).json({ message: 'Current password is incorrect' });

      if (newEmail) {
        await db.query('UPDATE users SET email = $1 WHERE id = $2', [String(newEmail).toLowerCase(), user.userId]);
      }
      if (newPassword) {
        const hash = await bcrypt.hash(String(newPassword), 12);
        await db.query('UPDATE users SET password = $1 WHERE id = $2', [hash, user.userId]);
      }
      return res.json({ success: true });
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: 'That email is already in use' });
      console.error('update profile error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
