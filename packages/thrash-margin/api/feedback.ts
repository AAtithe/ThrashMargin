import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/db';
import { requireUser } from './_lib/auth';
import { handleCors } from './_lib/cors';
import { FEEDBACK_TOPICS } from '../shared/games';
import { isOverLimit, LIMITS, recordEvent } from './_lib/rateLimit';

const VALID_GAMES = new Set(FEEDBACK_TOPICS.map(t => t.key));
const VALID_TYPES = new Set(['bug', 'idea', 'comment']);
const MAX_MESSAGE_LEN = 4000;

// POST /api/feedback — any signed-in user, against any of the portal's games (or 'general' for
// portal-wide notes). Read access is admin-only (see api/admin/feedback.ts) — submitters can't
// list or see other people's feedback through this endpoint.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req, res);
  if (!user) return;

  const { game, type, message } = req.body ?? {};
  const g = typeof game === 'string' && VALID_GAMES.has(game) ? game : 'general';
  const t = typeof type === 'string' && VALID_TYPES.has(type) ? type : 'idea';
  const msg = typeof message === 'string' ? message.trim() : '';
  if (!msg) return res.status(400).json({ message: 'message is required' });
  if (msg.length > MAX_MESSAGE_LEN) return res.status(400).json({ message: `message must be under ${MAX_MESSAGE_LEN} characters` });

  const db = getDb();
  // At most 10 a hour per account, so the list cannot be flooded.
  if (await isOverLimit(db, LIMITS.feedback, user.userId)) {
    return res.status(429).json({ message: 'You have sent a lot of feedback this hour. Try again later.' });
  }
  try {
    await db.query(
      'INSERT INTO feedback (user_id, game, type, message) VALUES ($1, $2, $3, $4)',
      [user.userId, g, t, msg],
    );
    await recordEvent(db, LIMITS.feedback, user.userId);
    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('submit feedback error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
