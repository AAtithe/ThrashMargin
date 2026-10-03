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
 *     an older, longer setting is refused too);
 *   - its account no longer exists;
 *   - its account's password was changed or reset after it was issued, which is what signs every
 *     other device out when a password changes.
 */
import jwt from 'jsonwebtoken';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './db';
import { ensureSchema } from './schema';

const SECRET = process.env.JWT_SECRET!;
const SESSION_MAX_AGE = '12h';

export interface TokenPayload {
  userId: string;
  username: string;
}

/** A request that is not signed in. Anything else thrown by getUser is a server fault. */
export class AuthError extends Error {}

export function signToken(payload: TokenPayload): string {
  return jwt.sign({ userId: payload.userId, username: payload.username }, SECRET, {
    expiresIn: SESSION_MAX_AGE,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload & { iat: number } {
  return jwt.verify(token, SECRET, { maxAge: SESSION_MAX_AGE }) as TokenPayload & { iat: number };
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
  const { rows } = await db.query('SELECT password_changed_at FROM users WHERE id = $1', [payload.userId]);
  if (!rows[0]) throw new AuthError('Account no longer exists');
  const changed = rows[0].password_changed_at as Date | null;
  // Whole seconds, because iat is: a token issued in the same second as the change still counts
  // as issued after it, which is what keeps the fresh token returned by a password change valid.
  if (changed && payload.iat < Math.floor(changed.getTime() / 1000)) {
    throw new AuthError('Signed out after a password change');
  }
  return { userId: payload.userId, username: payload.username };
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
