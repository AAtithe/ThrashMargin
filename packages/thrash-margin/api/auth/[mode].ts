import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { signToken } from '../_lib/auth';
import { handleCors } from '../_lib/cors';

// Combines what were two separate functions (login.ts, register.ts) into one, dispatching on
// the [mode] route param — Vercel's Hobby plan caps a deployment at 12 serverless functions.
// URLs are unchanged: /api/auth/login and /api/auth/register still resolve here.

async function login(req: VercelRequest, res: VercelResponse) {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ message: 'username and password required' });
  }

  const db = getDb();
  try {
    const { rows } = await db.query(
      'SELECT id, username, password FROM users WHERE username = $1',
      [username],
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const match = await bcrypt.compare(String(password), user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });

    // Non-blocking: a failed timestamp update shouldn't fail the login itself.
    db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch(err =>
      console.error('last_login_at update failed', err),
    );

    const token = signToken({ userId: user.id, username: user.username });
    return res.json({ token, userId: user.id, username: user.username });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function register(req: VercelRequest, res: VercelResponse) {
  const { username, email, password } = req.body ?? {};
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'username, email and password required' });
  }
  if (typeof username !== 'string' || username.length < 3 || username.length > 32) {
    return res.status(400).json({ message: 'username must be 3–32 characters' });
  }

  const db = getDb();
  try {
    const hash = await bcrypt.hash(password, 12);
    const id = uuid();
    await db.query(
      'INSERT INTO users (id, username, email, password) VALUES ($1, $2, $3, $4)',
      [id, username, String(email).toLowerCase(), hash],
    );
    await db.query('INSERT INTO player_stats (user_id) VALUES ($1)', [id]);
    const token = signToken({ userId: id, username });
    return res.status(201).json({ token, userId: id, username });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Username or email already taken' });
    }
    console.error('register error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  if (req.query.mode === 'login') return login(req, res);
  if (req.query.mode === 'register') return register(req, res);
  return res.status(404).json({ message: 'Not found' });
}
