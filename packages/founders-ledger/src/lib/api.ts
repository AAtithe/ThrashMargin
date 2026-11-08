import { getToken } from './portalAuth';

/** Same API origin the other two games use — all three deployments' Vercel functions are served
 * from the one deployment (see the /api/tea-race/* re-export shims at the repo root). */
export const API = import.meta.env.VITE_API_URL ?? '';

export function authHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
