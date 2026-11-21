/**
 * **The portal's authorisation boundary.** The lobbies' `if (!user)` checks are presentational only:
 * they read localStorage and can be satisfied by anyone. `getUser` below is what actually protects
 * the data, and every game endpoint must call it (or `requireUser`) and refuse the request on failure.
 *
 * Do not add a bypass, a dev-mode escape hatch, an env-var override, or an "unauthenticated read"
 * path. There is deliberately no guest access to this portal; see CLAUDE.md at the repo root.
 *
 * A session is refused when any of these hold:
 *   - no `Authorization: Bearer` token, or it does not verify against JWT_SECRET;
 *   - it was issued more than 12 hours ago (maxAge, measured from its iat, so a token issued under
 *     an older, longer setting is refused too), or more than 30 days ago for a session where the
 *     player ticked "Keep me signed in on this device" (the `rem` claim, which only signToken sets,
 *     inside the signature, so it cannot be added to a token afterwards);
 *   - its account no longer exists;
 *   - its account's password was changed or reset after it was issued, which is what signs every
 *     other device out when a password changes;
 *   - its account is not active: suspended by an admin, or still waiting for approval. Checked on
 *     every request, so a suspension ends the account's sessions on its next request.
 */
import jwt from 'jsonwebtoken';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './db';
import { ensureSchema } from './schema';

const SECRET = process.env.JWT_SECRET!;
const SESSION_MAX_AGE = '12h';
const SESSION_MAX_AGE_S = 12 * 3600;
/** "Keep me signed in on this device": a month, then sign in again. Still ended at once by a
 *  suspension or a password change, like every other session. */
const REMEMBERED_MAX_AGE = '30d';

export interface TokenPayload {
  userId: string;
  username: string;
  /** Signed in with "Keep me signed in on this device". */
  remember?: boolean;
}

/** A request that is not signed in. Anything else thrown by getUser is a server fault. */
export class AuthError extends Error {}

export function signToken(payload: TokenPayload): string {
  const claims: Record<string, unknown> = { userId: payload.userId, username: payload.username };
  if (payload.remember) claims.rem = 1;
  return jwt.sign(claims, SECRET, {
    expiresIn: payload.remember ? REMEMBERED_MAX_AGE : SESSION_MAX_AGE,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload & { iat: number } {
  // The longer limit first, then the shorter one for any token without the remember claim.
  const p = jwt.verify(token, SECRET, { maxAge: REMEMBERED_MAX_AGE }) as TokenPayload & { iat: number; rem?: number };
  const remember = p.rem === 1;
  if (!remember && Math.floor(Date.now() / 1000) - p.iat > SESSION_MAX_AGE_S) throw new AuthError('Session expired');
  return { userId: p.userId, username: p.username, iat: p.iat, ...(remember ? { remember: true } : {}) };
}

export async function getUser(req: VercelRequest): Promise<TokenPayload> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AuthError('Unauthorized');
  let payload: TokenPayload & { iat: number };
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    throw new AuthError('Unauthorized');
  }

  const db = getDb();
  await ensureSchema(db);
  const { rows } = await db.query('SELECT password_changed_at, status FROM users WHERE id = $1', [payload.userId]);
  if (!rows[0]) throw new AuthError('Account no longer exists');
  if (rows[0].status !== 'active') throw new AuthError('Account is not active');
  const changed = rows[0].password_changed_at as Date | null;
  // Whole seconds, because iat is: a token issued in the same second as the change still counts
  // as issued after it, which is what keeps the fresh token returned by a password change valid.
  if (changed && payload.iat < Math.floor(changed.getTime() / 1000)) {
    throw new AuthError('Signed out after a password change');
  }
  return { userId: payload.userId, username: payload.username, ...(payload.remember ? { remember: true } : {}) };
}

/**
 * getUser for an endpoint: on failure it answers the request itself and returns null. 401 when
 * the caller is not signed in; 503 when the check could not be made (the database is unreachable),
 * so an outage is not reported to players as their session having expired.
 */
export async function requireUser(req: VercelRequest, res: VercelResponse): Promise<TokenPayload | null> {
  try {
    return await getUser(req);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json({ message: 'Unauthorized' });
    } else {
      console.error('sign-in check failed', err);
      res.status(503).json({ message: 'Service temporarily unavailable' });
    }
    return null;
  }
}
