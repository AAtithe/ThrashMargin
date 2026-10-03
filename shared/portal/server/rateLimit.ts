import type { Pool } from 'pg';
import type { VercelRequest } from '@vercel/node';
import { ensureSchema } from './schema';

/**
 * Limits on how often something can be done, counted in rate_events. Used for account
 * registration (per network address) and feedback (per account). Sign-in has its own, stricter
 * limit on failed attempts (login_failures, in the auth endpoint).
 *
 * Fails open: if the count cannot be read, the request proceeds. Refusing every registration
 * because the limiter's own table is unavailable would be the worse failure.
 */
export interface Limit {
  bucket: string;
  max: number;
  windowMinutes: number;
}

export const LIMITS = {
  register: { bucket: 'register', max: 5, windowMinutes: 60 },
  feedback: { bucket: 'feedback', max: 10, windowMinutes: 60 },
} satisfies Record<string, Limit>;

export async function isOverLimit(db: Pool, limit: Limit, key: string): Promise<boolean> {
  try {
    await ensureSchema(db);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM rate_events
       WHERE bucket = $1 AND key = $2 AND at > NOW() - make_interval(mins => $3)`,
      [limit.bucket, key.slice(0, 128), limit.windowMinutes],
    );
    return rows[0].n >= limit.max;
  } catch (err) {
    console.error('rate limit read failed', err);
    return false;
  }
}

export async function recordEvent(db: Pool, limit: Limit, key: string): Promise<void> {
  try {
    await db.query('INSERT INTO rate_events (bucket, key) VALUES ($1, $2)', [limit.bucket, key.slice(0, 128)]);
    await db.query(`DELETE FROM rate_events WHERE at < NOW() - INTERVAL '1 day'`);
  } catch (err) {
    console.error('rate limit write failed', err);
  }
}

/** The caller's network address. On Vercel, x-forwarded-for is set by the platform itself. */
export function clientAddress(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd ?? '').split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}
