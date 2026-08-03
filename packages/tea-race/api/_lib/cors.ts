// Duplicated from packages/thrash-margin/api/_lib/cors.ts — see db.ts's comment for why.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
