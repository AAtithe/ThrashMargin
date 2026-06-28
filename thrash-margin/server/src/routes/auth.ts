import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { db } from '../db/client';

const router = Router();
const SALT_ROUNDS = 10;

function makeToken(userId: string, username: string): string {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET!, { expiresIn: '30d' });
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { username, email, password } = req.body ?? {};
  if (!username || !email || !password) {
    res.status(400).json({ message: 'username, email and password are required' });
    return;
  }
  if (username.length < 3 || username.length > 32) {
    res.status(400).json({ message: 'Username must be 3–32 characters' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ message: 'Password must be at least 6 characters' });
    return;
  }
  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = uuid();
    await db.query(
      `INSERT INTO users (id, username, email, password) VALUES ($1, $2, $3, $4)`,
      [id, username.trim(), email.trim().toLowerCase(), hash]
    );
    await db.query(
      `INSERT INTO player_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [id]
    );
    res.json({ token: makeToken(id, username.trim()), userId: id, username: username.trim() });
  } catch (err: unknown) {
    const msg = (err as { message?: string }).message ?? '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      res.status(409).json({ message: 'Username or email already taken' });
    } else {
      console.error('register error', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ message: 'username and password are required' });
    return;
  }
  try {
    const result = await db.query(
      `SELECT id, username, password FROM users WHERE username = $1`,
      [username.trim()]
    );
    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ message: 'Invalid username or password' });
      return;
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      res.status(401).json({ message: 'Invalid username or password' });
      return;
    }
    res.json({ token: makeToken(user.id, user.username), userId: user.id, username: user.username });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
