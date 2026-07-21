import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createInitialState } from '../src/sim/state';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const s = createInitialState('diag4-test');
  return res.status(200).json({ ok: true, which: 'sim-only', week: s.week });
}
