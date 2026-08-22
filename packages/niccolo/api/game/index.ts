import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { createInitialState } from '../../src/sim/state';

/**
 * Same `games` table Thrash Margin and The Tea Race use (same Postgres/Supabase instance, same
 * users/auth), discriminated by the `game` column so no app's list or lookup queries see another's
 * rows.
 */
const GAME_KIND = 'niccolo';

/**
 * One Vercel function covering both `/api/niccolo/game` (list/create) and `/api/niccolo/game?id=:id`
 * (load/save/delete) as a single function — the two were separate functions until a 4th
 * game's own pair would have pushed the Hobby-plan function count past its 12-function ceiling.
 * A path-based `[[...id]].ts` catch-all doesn't work here — that's a Next.js routing
 * convention, not something plain Vercel Functions understand, so it silently 404s on every
 * request in production even though it looks fine locally. Query-string `id` on a single
 * plain `index.ts` sidesteps that entirely. `req.query.id` is `undefined` on the collection
 * route and a plain string (or one-element array, if the key is repeated) otherwise.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  let user;
  try {
    user = getUser(req);
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const db = getDb();
  const idParam = req.query.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;

  if (id === undefined) {
    if (req.method === 'POST') {
      const name: string = ((req.body?.name as string | undefined) ?? 'Campaign').trim();
      const skipPrologue = req.body?.skipPrologue === true;
      const hideObjectives = req.body?.hideObjectives === true;
      const hotseatHouseId: string | null =
        typeof req.body?.hotseatHouseId === 'string' ? req.body.hotseatHouseId : null;
      const newId = uuid();
      const state = createInitialState(newId, name, { skipPrologue, hideObjectives, hotseatHouseId });

      try {
        await db.query(
          `INSERT INTO games (id, owner_id, game, mode, status, turn, state, config)
           VALUES ($1, $2, $3, 'single', 'active', $4, $5, '{}')`,
          [newId, user.userId, GAME_KIND, state.week, JSON.stringify(state)],
        );
        return res.status(201).json({ gameId: newId, state });
      } catch (err) {
        console.error('create niccolo game error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    if (req.method === 'GET') {
      try {
        const { rows } = await db.query(
          `SELECT id, status, turn, state->>'name' AS name,
                  EXTRACT(EPOCH FROM updated_at) * 1000 AS saved_at
           FROM games WHERE owner_id = $1 AND game = $2 ORDER BY updated_at DESC LIMIT 50`,
          [user.userId, GAME_KIND],
        );
        const saves = rows.map(r => ({
          id: r.id,
          name: r.name ?? 'Campaign',
          turn: Number(r.turn) ?? 0,
          status: r.status,
          savedAt: Math.round(parseFloat(r.saved_at)),
        }));
        return res.json({ saves });
      } catch (err) {
        console.error('list niccolo games error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    return res.status(405).end();
  }

  if (req.method === 'GET') {
    try {
      const { rows } = await db.query(
        'SELECT state FROM games WHERE id = $1 AND owner_id = $2 AND game = $3',
        [id, user.userId, GAME_KIND],
      );
      if (!rows[0]) return res.status(404).json({ message: 'Game not found' });
      return res.json({ state: rows[0].state });
    } catch (err) {
      console.error('get niccolo game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PUT') {
    // Overwrite full state — the client is authoritative (single-player, no server-side
    // action validation) and syncs its whole GameState after every dispatched action.
    const { state } = req.body ?? {};
    if (!state) return res.status(400).json({ message: 'state required' });
    try {
      const status = state.insolvent ? 'defeated' : state.flags?.chapter6_complete ? 'victory' : 'active';
      await db.query(
        `UPDATE games SET state = $1, status = $2, turn = $3, updated_at = NOW()
         WHERE id = $4 AND owner_id = $5 AND game = $6`,
        [JSON.stringify(state), status, state.week ?? 0, id, user.userId, GAME_KIND],
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('save niccolo state error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await db.query('DELETE FROM games WHERE id = $1 AND owner_id = $2 AND game = $3', [id, user.userId, GAME_KIND]);
      return res.json({ success: true });
    } catch (err) {
      console.error('delete niccolo game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
