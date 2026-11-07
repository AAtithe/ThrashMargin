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

/**
 * The caller's network, as a rate-limit key. On Vercel, x-forwarded-for is set by the platform itself.
 *
 * An IPv6 address is cut to its /64: one connection is normally handed a whole /64, so counting
 * full addresses would let one person rotate through billions of them and never reach a limit.
 */
export function clientAddress(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd ?? '').split(',')[0].trim();
  return networkKey(first || req.socket?.remoteAddress || 'unknown');
}

export function networkKey(address: string): string {
  const a = address.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!a.includes(':')) return a; // IPv4, or 'unknown'
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return a.slice(0, 64);
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
