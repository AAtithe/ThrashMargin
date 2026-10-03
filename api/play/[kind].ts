import type { VercelRequest, VercelResponse } from '@vercel/node';
import thrashMargin from '../../packages/thrash-margin/api/game/index';
import niccolo from '../../packages/niccolo/api/game/index';
import niccoloRising from '../../packages/niccolo-rising/api/game/index';
import teaRace from '../../packages/tea-race/api/game/index';
import steadyEddie from '../../packages/steady-eddie/api/game/index';

// Every game's saves, as one Vercel function: /api/play/<game>?id=...
//
// Each game had its own function until the portal reached 10 of the Hobby plan's 12, with each
// new game costing one more. They now share this one, so a new game costs none. Same dynamic-file
// pattern as api/auth/[mode].ts, which is known to route correctly in production (a catch-all
// [[...x]] does not). The slugs match `slug` in packages/thrash-margin/shared/games.ts.
//
// Each handler still does its own auth (getUser, 401 otherwise) and reads its own `game` rows;
// this only picks which handler runs.
const HANDLERS: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  'thrash-margin': thrashMargin,
  niccolo,
  'niccolo-rising': niccoloRising,
  'tea-race': teaRace,
  'steady-eddie': steadyEddie,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const kind = Array.isArray(req.query.kind) ? req.query.kind[0] : req.query.kind;
  const run = kind ? HANDLERS[kind] : undefined;
  if (!run) return res.status(404).json({ message: 'Unknown game' });
  return run(req, res);
}
