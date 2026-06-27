import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { signToken } from '../_lib/auth';
import { handleCors } from '../_lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

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
