import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import type { Pool } from 'pg';
import { getDb } from '../_lib/db';
import { signToken } from '../_lib/auth';
import { isAdmin } from '../_lib/admin';
import { ensureSchema } from '../_lib/schema';
import { isEmail } from '../_lib/validate';
import { clientAddress, isOverLimit, LIMITS, recordEvent } from '../_lib/rateLimit';
import { handleCors } from '../_lib/cors';

// Combines what were two separate functions (login.ts, register.ts) into one, dispatching on
// the [mode] route param — Vercel's Hobby plan caps a deployment at 12 serverless functions.
// URLs are unchanged: /api/auth/login and /api/auth/register still resolve here.

// Sign-in attempt limit: after 10 wrong passwords for one username within 15 minutes, that
// username is refused for the rest of the window, even with the right password. Keyed on the
// lower-cased username whether or not the account exists, so the response does not reveal which
// usernames are real. An admin's password reset clears the count.
//
// Fails open: if the count cannot be read, sign-in proceeds. Locking every player out because the
// limiter's own table is unavailable would be the worse failure.
const MAX_FAILURES = 10;
const WINDOW = '15 minutes';

async function tooManyFailures(db: Pool, key: string): Promise<boolean> {
  try {
    await ensureSchema(db);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM login_failures WHERE username_key = $1 AND at > NOW() - $2::interval`,
      [key, WINDOW],
    );
    return rows[0].n >= MAX_FAILURES;
  } catch (err) {
    console.error('login limiter read failed', err);
    return false;
  }
}

async function recordFailure(db: Pool, key: string): Promise<void> {
  try {
    await db.query('INSERT INTO login_failures (username_key) VALUES ($1)', [key]);
    // Keeps the table small; nothing older than the window is ever read.
    await db.query(`DELETE FROM login_failures WHERE at < NOW() - INTERVAL '1 day'`);
  } catch (err) {
    console.error('login limiter write failed', err);
  }
}

async function login(req: VercelRequest, res: VercelResponse) {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ message: 'username and password required' });
  }

  const db = getDb();
  const key = String(username).toLowerCase().slice(0, 64);
  if (await tooManyFailures(db, key)) {
    return res.status(429).json({
      message: 'Too many failed sign-in attempts. Try again in 15 minutes, or ask an admin to reset your password.',
    });
  }
  try {
    const { rows } = await db.query(
      'SELECT id, username, password FROM users WHERE username = $1',
      [username],
    );
    const user = rows[0];
    if (!user) {
      await recordFailure(db, key);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(String(password), user.password);
    if (!match) {
      await recordFailure(db, key);
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    db.query('DELETE FROM login_failures WHERE username_key = $1', [key]).catch(() => {});

    // Non-blocking: a failed timestamp update shouldn't fail the login itself.
    db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch(err =>
      console.error('last_login_at update failed', err),
    );

    const token = signToken({ userId: user.id, username: user.username });
    // For the nav's Admin link only. Presentational: every admin endpoint re-checks the role.
    const admin = await isAdmin(db, user.id);
    return res.json({ token, userId: user.id, username: user.username, isAdmin: admin });
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
  // Same floor as /api/profile's password change, which previously was the only place it applied.
  // The type check also stops a non-string body value reaching bcrypt and surfacing as a 500.
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ message: 'password must be at least 6 characters' });
  }
  if (!isEmail(email)) return res.status(400).json({ message: 'Enter a valid email address' });

  const db = getDb();
  // At most 5 new accounts per network address per hour, so a script cannot fill the portal with
  // accounts. Counted only on success, so typos and taken names do not use up the allowance.
  const address = clientAddress(req);
  if (await isOverLimit(db, LIMITS.register, address)) {
    return res.status(429).json({ message: 'Too many new accounts from this network. Try again in an hour.' });
  }
  try {
    // The UNIQUE constraint on users.username is case-sensitive, so 'Tom' and 'tom' could both
    // register and pass for each other in feedback, the admin list and anywhere a name is shown.
    const { rowCount } = await db.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (rowCount) return res.status(409).json({ message: 'Username or email already taken' });

    const hash = await bcrypt.hash(password, 12);
    const id = uuid();
    // One statement, so an account is either fully created or not at all. It used to be followed
    // by a second insert into player_stats (a table nothing read); if that failed, the player was
    // told "Server error" while the account already existed, and their retry was refused as taken.
    await db.query(
      'INSERT INTO users (id, username, email, password) VALUES ($1, $2, $3, $4)',
      [id, username, email.toLowerCase(), hash],
    );
    await recordEvent(db, LIMITS.register, address);
    const token = signToken({ userId: id, username });
    return res.status(201).json({ token, userId: id, username, isAdmin: false });
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
