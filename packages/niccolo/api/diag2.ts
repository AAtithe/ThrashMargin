import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/db';
import { getUser } from './_lib/auth';
import { handleCors } from './_lib/cors';
import { createInitialState } from '../src/sim/state';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  const s = createInitialState('diag2-test');
  return res.status(200).json({
    getDb: typeof getDb,
    getUser: typeof getUser,
    week: s.week,
  });
}
