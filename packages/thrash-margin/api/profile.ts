import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { getDb } from './_lib/db';
import { requireUser, signToken } from './_lib/auth';
import { isEmail } from './_lib/validate';
import { handleCors } from './_lib/cors';
import { isAdmin } from './_lib/admin';
import { countsByGame, GAMES_BY_TITLE_SQL } from '../shared/games';

// /api/profile — a signed-in user's own account. Unlike /api/admin/users, this only ever
// reads or writes the row matching the caller's own JWT userId; there is no way to pass a
// different user's id in.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const db = getDb();

  if (req.method === 'GET') {
    try {
      const { rows } = await db.query(
        `SELECT
           u.id, u.username, u.email, u.created_at, u.last_login_at,
           ${GAMES_BY_TITLE_SQL} AS by_game,
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
        gamesByTitle: countsByGame(r.by_game),
        activeGames: Number(r.active_games),
        wins: Number(r.wins),
        isAdmin: await isAdmin(db, user.userId),
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
    if (newEmail && !isEmail(newEmail)) return res.status(400).json({ message: 'Enter a valid email address' });

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
        // password_changed_at signs out every session issued before now, on every device
        // (api/_lib/auth.ts). This one is replaced with a fresh token so it carries on.
        await db.query('UPDATE users SET password = $1, password_changed_at = NOW() WHERE id = $2', [
          hash,
          user.userId,
        ]);
        return res.json({ success: true, token: signToken(user) });
      }
      return res.json({ success: true });
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: 'That email is already in use' });
      console.error('update profile error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  // DELETE /api/profile { password } — the player deletes their own account and everything it owns:
  // every saved game in every game (games rows cascade with the user), sign-in attempt records and
  // rate-limit records. Feedback they sent stays, unattributed (feedback.user_id is set to null),
  // and the admin access history keeps the usernames it copied at the time.
  //
  // The sole remaining admin cannot delete their account: the portal would be left with no admin,
  // and the next sign-in would be promoted in their place. Make someone else admin first.
  if (req.method === 'DELETE') {
    const { password } = req.body ?? {};
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ message: 'Enter your password to confirm' });
    }
    try {
      const { rows } = await db.query('SELECT username, password, role FROM users WHERE id = $1', [user.userId]);
      const row = rows[0];
      if (!row) return res.status(404).json({ message: 'Account not found' });
      if (!(await bcrypt.compare(password, row.password))) {
        return res.status(403).json({ message: 'Password is incorrect' });
      }
      if (row.role === 'admin') {
        const { rows: admins } = await db.query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`);
        if (admins[0].n <= 1) {
          return res.status(409).json({
            message: 'You are the only admin. Make someone else an admin first, then delete your account.',
          });
        }
      }
      const c = await db.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM login_failures WHERE username_key = LOWER($1)', [row.username]);
        await c.query(`DELETE FROM rate_events WHERE bucket = 'feedback' AND key = $1`, [user.userId]);
        await c.query('DELETE FROM users WHERE id = $1', [user.userId]);
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        c.release();
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('delete account error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
