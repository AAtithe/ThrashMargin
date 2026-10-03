// Duplicated from packages/thrash-margin/api/_lib/auth.ts — see db.ts's comment for why.
// Same JWT_SECRET env var, so a token issued by Thrash Margin's login verifies here too.
//
// **This file is the portal's authorisation boundary.** The lobbies' `if (!user)` checks are
// presentational only — they read localStorage and can be satisfied by anyone. `getUser` below is
// what actually protects the data, and every game endpoint must call it and 401 on failure.
//
// Do not add a bypass, a dev-mode escape hatch, an env-var override, or an "unauthenticated read"
// path. There is deliberately no guest access to this portal; see CLAUDE.md at the repo root.
import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';

const SECRET = process.env.JWT_SECRET!;
// Sessions last 12 hours from sign-in, then the user signs in again. Fixed here rather than read
// from JWT_EXPIRES_IN, and enforced on verify through maxAge (measured from the token's iat), so a
// token issued under an older, longer setting stops working too.
const SESSION_MAX_AGE = '12h';

export interface TokenPayload {
  userId: string;
  username: string;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: SESSION_MAX_AGE } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET, { maxAge: SESSION_MAX_AGE }) as TokenPayload;
}

export function getUser(req: VercelRequest): TokenPayload {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) throw new Error('Unauthorized');
  return verifyToken(auth.slice(7));
}
