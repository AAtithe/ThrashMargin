import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/db';
import { handleCors } from './_lib/cors';

// GET /api/health — for an uptime monitor. 200 only when the API can actually reach the database;
// 503 otherwise. It used to answer "ok" without checking anything, so it stayed green through a
// database outage. Reports no details either way: it is public.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const started = Date.now();
  try {
    await Promise.race([
      getDb().query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('database check timed out')), 5000)),
    ]);
    return res.json({ status: 'ok', database: 'ok', ms: Date.now() - started });
  } catch (err) {
    console.error('health check failed', err);
    return res.status(503).json({ status: 'unavailable', database: 'unreachable' });
  }
}
