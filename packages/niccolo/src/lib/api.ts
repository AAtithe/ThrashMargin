import { getToken } from './portalAuth';

/** Same API origin Thrash Margin's client uses — both apps' Vercel functions are served from
 * the one deployment (see /api/niccolo/* re-export shims at the repo root). */
export const API = import.meta.env.VITE_API_URL ?? '';

export function authHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
