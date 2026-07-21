import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCors } from './_lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  return res.status(200).json({ ok: true, which: 'lib-only' });
}
