// GENERATED from shared/portal/server/cors.ts by scripts/sync-shared.mjs. Do not edit this copy: edit the original,
// then run `npm run sync-shared`. `npm run check` fails while any copy differs.
import type { VercelRequest, VercelResponse } from '@vercel/node';

// The portal's pages and API share one origin, so browsers need no CORS permission at all. Other
// sites are refused by default. CORS_ORIGIN can name one extra origin, for a local dev server that
// runs on a different port; it was once "*" by default, which allowed any site to call the API.
export function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = process.env.CORS_ORIGIN;
  if (origin && origin !== '*') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
