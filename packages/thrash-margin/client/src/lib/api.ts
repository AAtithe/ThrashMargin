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

/**
 * The body of an API reply, or null when it is not JSON. Every endpoint answers in JSON, so a reply
 * that is not means the platform answered instead (the function crashed or ran out of time). That
 * used to throw inside the caller's try and reach the player as "Network error", which sent anyone
 * looking at it after the wrong cause.
 */
export async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** The message for a reply the server did not answer in JSON, naming the status so it can be traced. */
export function serverFailure(action: string, res: Response): string {
  return `The server failed while ${action} (error ${res.status}). Nothing was lost; try again in a moment.`;
}
