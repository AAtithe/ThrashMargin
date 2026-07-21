import type { VercelRequest, VercelResponse } from '@vercel/node';
import { dateForWeek } from '@repo/engine';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({ ok: true, which: 'repo-engine-only', date: String(dateForWeek(0, new Date(2026, 0, 1))) });
}
