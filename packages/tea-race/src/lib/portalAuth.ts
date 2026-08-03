/**
 * Reads the same account session Thrash Margin writes (packages/thrash-margin/client/src/lib/token.ts).
 * The Tea Race has no accounts of its own — this exists only so the shared PortalNav can show and
 * manage one session from any of the three games, since they are all served from the same origin
 * in production.
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
