import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { queryParam } from '../_lib/query';
import { cleanName, createGame, isGameId, saveState, sendGameLimit, sendSaveResult } from '../_lib/saves';
import { createInitialState, normaliseSetup } from '../../src/sim/state';
import { DEFAULT_SETUP, MAP_TYPES } from '../../src/sim/rules';
import { campaignSaveStatus, campaignSaveTurn, isCampaignSave, migrateCampaignSave, newCampaignSave } from '../../src/campaign/save';

/**
 * Fireline's saves, in the shared `games` table, discriminated by `game = 'fireline'` so no other
 * game's queries see these rows. Served at /api/play/fireline through api/play/[kind].ts, which
 * checks sign-in and game access before this runs; this handler checks sign-in again itself.
 *
 * The client is authoritative (single player against the computer, the same trust model as every
 * game here): it saves the whole battle state every few seconds of play.
 */
const GAME_KIND = 'fireline';
const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;

function readDifficulty(raw: unknown): (typeof DIFFICULTIES)[number] | undefined {
  return typeof raw === 'string' && (DIFFICULTIES as readonly string[]).includes(raw) ? (raw as (typeof DIFFICULTIES)[number]) : undefined;
}

/** Saves report minutes of battle in the `turn` column, which the lobby shows. */
const minutes = (state: { tick?: unknown }) => (typeof state.tick === 'number' ? Math.floor(state.tick / 600) : 0);

/**
 * A finished battle names its winner by side (0 to 3). Side 0 is the player, and `winner` is 0
 * whenever the player's team won (see GameState.winner), so any other side means a defeat.
 */
const statusOf = (state: { winner?: unknown }) =>
  state.winner === 0 ? 'victory' : state.winner === 1 || state.winner === 2 || state.winner === 3 ? 'defeated' : 'active';

/**
 * A campaign is one row holding the whole career (`kind: 'campaign'`). Its `turn` is missions won and
 * its status is 'victory' once the last mission is won, 'active' until then: a lost mission can be
 * retried, so a campaign is never 'defeated'.
 */
function rowFields(state: object): { status: string; turn: number } {
  if (isCampaignSave(state)) {
    const c = migrateCampaignSave(state);
    return c ? { status: campaignSaveStatus(c), turn: campaignSaveTurn(c) } : { status: 'active', turn: 0 };
  }
  return { status: statusOf(state), turn: minutes(state) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const db = getDb();
  // Read from req.url, never req.query: Vercel builds req.query with url.parse (DEP0169). See _lib/query.ts.
  const id = queryParam(req, 'id');
  if (id !== undefined && !isGameId(id)) return res.status(404).json({ message: 'Game not found' });

  if (id === undefined) {
    if (req.method === 'POST' && req.body?.mode === 'campaign') {
      const name = cleanName(req.body?.name, 'Campaign');
      const commander = cleanName(req.body?.commander, 'Commander');
      const newId = uuid();
      const state = newCampaignSave(newId, name, commander, Date.now());
      try {
        const created = await createGame(db, {
          id: newId, ownerId: user.userId, game: GAME_KIND, status: 'active', turn: 0, state, config: {},
        });
        if (!created) return sendGameLimit(res);
        return res.status(201).json({ gameId: newId, state, version: 0 });
      } catch (err) {
        console.error('create fireline campaign error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    if (req.method === 'POST') {
      const name = cleanName(req.body?.name, 'Battle');
      const seed = typeof req.body?.seed === 'string' ? req.body.seed.slice(0, 64) : undefined;
      const newId = uuid();
      // A skirmish setup from the lobby (map type, tech, credits, ore). Untrusted: normaliseSetup keeps
      // only known values and clamps credits. No setup (an older client) gives the original game.
      const rawSetup = req.body?.setup;
      const setup =
        rawSetup && typeof rawSetup === 'object' && !Array.isArray(rawSetup) ? normaliseSetup(rawSetup, DEFAULT_SETUP) : undefined;
      const state = createInitialState(newId, name, {
        seed,
        difficulty: readDifficulty(req.body?.difficulty),
        createdAt: Date.now(),
        setup,
      });
      try {
        const created = await createGame(db, {
          id: newId, ownerId: user.userId, game: GAME_KIND, status: 'active', turn: 0, state, config: {},
        });
        if (!created) return sendGameLimit(res);
        return res.status(201).json({ gameId: newId, state, version: 0 });
      } catch (err) {
        console.error('create fireline game error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    if (req.method === 'GET') {
      try {
        const { rows } = await db.query(
          `SELECT id, status, turn, state->>'name' AS name, state->>'kind' AS kind, state->>'mapType' AS map_type,
                  CASE WHEN jsonb_typeof(state->'players') = 'array' THEN jsonb_array_length(state->'players') END AS sides,
                  state->'setup'->>'mode' AS mode,
                  EXTRACT(EPOCH FROM updated_at) * 1000 AS saved_at
           FROM games WHERE owner_id = $1 AND game = $2 ORDER BY updated_at DESC LIMIT 50`,
          [user.userId, GAME_KIND],
        );
        const saves = rows.map(r => ({
          id: r.id,
          name: r.name ?? 'Battle',
          turn: Number(r.turn) || 0,
          status: r.status,
          savedAt: Math.round(parseFloat(r.saved_at)),
          ...(r.kind === 'campaign' ? { kind: 'campaign' as const } : {}),
          ...(typeof r.map_type === 'string' && (MAP_TYPES as readonly string[]).includes(r.map_type) ? { mapType: r.map_type } : {}),
          // Battles of three or four sides: how many, and whether they were played as teams.
          ...(Number(r.sides) === 3 || Number(r.sides) === 4 ? { sides: Number(r.sides), mode: r.mode === 'teams' ? 'teams' : 'ffa' } : {}),
        }));
        return res.json({ saves });
      } catch (err) {
        console.error('list fireline games error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    return res.status(405).end();
  }

  if (req.method === 'GET') {
    try {
      const { rows } = await db.query('SELECT state, version FROM games WHERE id = $1 AND owner_id = $2 AND game = $3', [
        id,
        user.userId,
        GAME_KIND,
      ]);
      if (!rows[0]) return res.status(404).json({ message: 'Game not found' });
      return res.json({ state: rows[0].state, version: rows[0].version });
    } catch (err) {
      console.error('get fireline game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PUT') {
    const { state } = req.body ?? {};
    if (!state || typeof state !== 'object') return res.status(400).json({ message: 'state required' });
    try {
      const result = await saveState(db, {
        id, ownerId: user.userId, game: GAME_KIND, state, ...rowFields(state),
        version: req.body?.version,
      });
      return sendSaveResult(res, result);
    } catch (err) {
      console.error('save fireline state error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await db.query('DELETE FROM games WHERE id = $1 AND owner_id = $2 AND game = $3', [id, user.userId, GAME_KIND]);
      return res.json({ success: true });
    } catch (err) {
      console.error('delete fireline game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
