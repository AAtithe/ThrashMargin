/**
 * Reads the same account session Thrash Margin writes (packages/thrash-margin/client/src/lib/token.ts).
 * The Tea Race has no accounts of its own — this exists only so the shared PortalNav can show and
 * manage one session from any of the games, since they are all served from the same origin in
 * production.
 *
 * **This is not an authorisation check and must never be treated as one.** Everything here reads
 * localStorage, which the user controls; `getStoredUser()` returning a name proves only that a name
 * is stored. The lobby uses it to decide what to render, and that is all it is for.
 *
 * Authorisation happens server-side in `api/_lib/auth.ts`, where `getUser(req)` verifies a Bearer JWT
 * against JWT_SECRET and every endpoint 401s without one. See CLAUDE.md at the repo root before
 * changing anything in this file.
 */
const KEY = 'tm_token';
const USER_KEY = 'tm_user';

export interface StoredUser {
  userId: string;
  username: string;
}

export const getToken = (): string | null => localStorage.getItem(KEY);

export const clearToken = () => {
  localStorage.removeItem(KEY);
  localStorage.removeItem(USER_KEY);
};

export const getStoredUser = (): StoredUser | null => {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
};
