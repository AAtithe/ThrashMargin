import { getToken } from './token';

export const API = import.meta.env.VITE_API_URL ?? '';

export function authHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * The `tm_token` JWT expires after 7 days by default and every endpoint then 401s. Without a
 * distinct message the lobby just looks empty. Not cleared automatically: useGameHybrid re-reads
 * the token on every render, so clearing it here would flip to local saves and hide this message.
 */
export const SESSION_EXPIRED =
  'Your sign-in has expired. Use "Sign out" above, then sign in again to reach your saved campaigns.';
