import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { createInitialState, DEFAULT_CONFIG } from '../../shared/engine-reference';
import type { GameConfig } from '../../shared/types';

/**
 * Same `games` table Niccolo and The Tea Race use (same Postgres/Supabase instance, same
 * users/auth), discriminated by the `game` column so no app's list or lookup queries see
 * another's rows.
 */
const GAME_KIND = 'thrash_margin';

/**
 * One Vercel function covering both `/api/game` (list/create) and `/api/game?id=:id`
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
  try { user = getUser(req); } catch { return res.status(401).json({ message: 'Unauthorized' }); }

  const db = getDb();
  const idParam = req.query.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;

  if (id === undefined) {
    if (req.method === 'POST') {
      const config: Partial<GameConfig> = req.body?.config ?? {};
      const name: string = ((req.body?.name as string | undefined) ?? 'Campaign').trim();
      const newId = uuid();
      const mergedConfig = { ...DEFAULT_CONFIG, ...config };
      const state = createInitialState(newId, mergedConfig);
      (state as unknown as Record<string, unknown>).name = name;
      try {
        await db.query(
          'INSERT INTO games (id, owner_id, game, mode, status, turn, state, config) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [newId, user.userId, GAME_KIND, 'single', state.status, state.turn, JSON.stringify(state), JSON.stringify(mergedConfig)],
        );
        return res.status(201).json({ gameId: newId, state });
      } catch (err) {
        console.error('create game error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    if (req.method === 'GET') {
      try {
        const { rows } = await db.query(
          `SELECT id, status, turn,
                  state->>'name' AS name,
                  config->>'diff' AS diff,
                  (config->>'campaignScenario')::int AS campaign_scenario,
                  state->'achievements' AS achievements,
                  EXTRACT(EPOCH FROM updated_at) * 1000 AS saved_at
           FROM games WHERE owner_id = $1 AND game = $2 ORDER BY updated_at DESC LIMIT 50`,
          [user.userId, GAME_KIND],
        );
        const saves = rows.map(r => ({
          id: r.id,
          name: r.name ?? 'Campaign',
          turn: Number(r.turn) ?? 1,
          status: r.status,
          diff: r.diff ?? 'normal',
          savedAt: Math.round(parseFloat(r.saved_at)),
          ...(r.campaign_scenario != null && { campaignScenario: Number(r.campaign_scenario) }),
          ...(Array.isArray(r.achievements) && r.achievements.length && { achievements: r.achievements }),
        }));
        return res.json({ saves });
      } catch (err) {
        console.error('list games error', err);
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
      console.error('get game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PUT') {
    // Overwrite full state — client batches local actions and syncs once at end-of-turn
    const { state } = req.body ?? {};
    if (!state) return res.status(400).json({ message: 'state required' });
    try {
      const newStatus = state.status === 'victory' ? 'victory'
        : state.status === 'defeated' ? 'defeated' : 'active';
      await db.query(
        'UPDATE games SET state = $1, status = $2, turn = $3, updated_at = NOW() WHERE id = $4 AND owner_id = $5 AND game = $6',
        [JSON.stringify(state), newStatus, state.turn, id, user.userId, GAME_KIND],
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('save state error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await db.query(
        'DELETE FROM games WHERE id = $1 AND owner_id = $2 AND game = $3',
        [id, user.userId, GAME_KIND],
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('delete game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
