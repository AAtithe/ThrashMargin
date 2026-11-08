import type { VercelRequest, VercelResponse } from '@vercel/node';
import thrashMargin from '../../packages/thrash-margin/api/game/index';
import niccolo from '../../packages/niccolo/api/game/index';
import niccoloRising from '../../packages/niccolo-rising/api/game/index';
import teaRace from '../../packages/tea-race/api/game/index';
import steadyEddie from '../../packages/steady-eddie/api/game/index';
import fireline from '../../packages/fireline/api/game/index';
import foundersLedger from '../../packages/founders-ledger/api/game/index';
import { getDb } from '../../packages/thrash-margin/api/_lib/db';
import { requireUser } from '../../packages/thrash-margin/api/_lib/auth';
import { handleCors } from '../../packages/thrash-margin/api/_lib/cors';
import { queryParam } from '../../packages/thrash-margin/api/_lib/query';
import { gameKeyForSlug, gamesFor } from '../../packages/thrash-margin/api/_lib/access';

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
  fireline,
  'founders-ledger': foundersLedger,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const kind = queryParam(req, 'kind');
  // Own keys only: a plain lookup would find Object.prototype's members, so /api/play/constructor
  // ran Object(req, res), which never answers and held the function open until it timed out.
  const run = kind && Object.prototype.hasOwnProperty.call(HANDLERS, kind) ? HANDLERS[kind] : undefined;
  const key = kind ? gameKeyForSlug(kind) : undefined;
  if (!run || !key) return res.status(404).json({ message: 'Unknown game' });

  // Game access (packages/thrash-margin/api/_lib/access.ts), checked here so it covers every
  // request to every game, whatever the handler does. Signed in first: an unknown caller gets 401
  // exactly as before, and the handler's own sign-in check still runs after this one.
  if (handleCors(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;
  let allowed: boolean;
  try {
    allowed = (await gamesFor(getDb(), user.userId)).includes(key);
  } catch (err) {
    // Fails closed: an access check that could not be made is not a yes.
    console.error('game access check failed', err);
    return res.status(503).json({ message: 'Service temporarily unavailable' });
  }
  if (!allowed) {
    return res.status(403).json({
      message: 'Your account does not have access to this game. Ask an admin if you think it should.',
      code: 'no_game_access',
    });
  }
  return run(req, res);
}
