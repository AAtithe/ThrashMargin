import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { isGameId, saveState, sendSaveResult } from '../_lib/saves';
import { createInitialState, DEFAULT_CONFIG } from '../../shared/engine-reference';
import type { GameConfig } from '../../shared/types';

/**
 * Same `games` table Niccolo and The Tea Race use (same Postgres/Supabase instance, same
 * users/auth), discriminated by the `game` column so no app's list or lookup queries see
 * another's rows.
 */
const GAME_KIND = 'thrash_margin';

/**
 * Served at /api/play/<game> through api/play/[kind].ts, which all five games now share.
 *
 * Originally one Vercel function of its own, covering both `/api/play/thrash-margin` (list/create) and `/api/play/thrash-margin?id=:id`
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

  const user = await requireUser(req, res);
  if (!user) return;

  const db = getDb();
  const idParam = req.query.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  // A malformed id cannot exist; answered here rather than as a database error.
  if (id !== undefined && !isGameId(id)) return res.status(404).json({ message: 'Game not found' });

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
        return res.status(201).json({ gameId: newId, state, version: 0 });
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
        'SELECT state, version FROM games WHERE id = $1 AND owner_id = $2 AND game = $3',
        [id, user.userId, GAME_KIND],
      );
      if (!rows[0]) return res.status(404).json({ message: 'Game not found' });
      return res.json({ state: rows[0].state, version: rows[0].version });
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
      const result = await saveState(db, {
        id, ownerId: user.userId, game: GAME_KIND, state, status: newStatus, turn: state.turn,
        version: req.body?.version,
      });
      return sendSaveResult(res, result);
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
