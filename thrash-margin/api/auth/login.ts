import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcrypt';
import { getDb } from '../_lib/db';
import { signToken } from '../_lib/auth';
import { handleCors } from '../_lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

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

    const token = signToken({ userId: user.id, username: user.username });
    return res.json({ token, userId: user.id, username: user.username });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
