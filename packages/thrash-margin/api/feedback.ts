import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/db';
import { getUser } from './_lib/auth';
import { handleCors } from './_lib/cors';

const VALID_GAMES = new Set(['general', 'thrash_margin', 'niccolo', 'tea_race']);
const VALID_TYPES = new Set(['bug', 'idea', 'comment']);
const MAX_MESSAGE_LEN = 4000;

// POST /api/feedback — any signed-in user, against any of the three games (or 'general' for
// portal-wide notes). Read access is admin-only (see api/admin/feedback.ts) — submitters can't
// list or see other people's feedback through this endpoint.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  let user;
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }

  const { game, type, message } = req.body ?? {};
  const g = typeof game === 'string' && VALID_GAMES.has(game) ? game : 'general';
  const t = typeof type === 'string' && VALID_TYPES.has(type) ? type : 'idea';
  const msg = typeof message === 'string' ? message.trim() : '';
  if (!msg) return res.status(400).json({ message: 'message is required' });
  if (msg.length > MAX_MESSAGE_LEN) return res.status(400).json({ message: `message must be under ${MAX_MESSAGE_LEN} characters` });

  const db = getDb();
  try {
    await db.query(
      'INSERT INTO feedback (user_id, game, type, message) VALUES ($1, $2, $3, $4)',
      [user.userId, g, t, msg],
    );
    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('submit feedback error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
