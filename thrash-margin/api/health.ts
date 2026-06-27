import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCors } from './_lib/cors';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  res.json({ status: 'ok', service: 'thrash-margin-api', ts: new Date().toISOString() });
}
