import { getToken } from './portalAuth';

/** Same API origin every other game uses: all the portal's Vercel functions are served from the one
 * deployment (see the /api/niccolo-rising/* re-export shim at the repo root). */
export const API = import.meta.env.VITE_API_URL ?? '';

export function authHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
