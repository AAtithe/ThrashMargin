import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { getUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { createInitialState } from '../../src/sim/state';

/**
 * The same `games` table Thrash Margin and Niccolo use — one Postgres/Supabase instance, one
 * users/auth setup — discriminated by the `game` column so no app's list or lookup queries ever
 * see another's rows. The column is VARCHAR(16), which 'tea_race' fits, and carries no CHECK
 * constraint, so adding a third game needed no migration.
 */
const GAME_KIND = 'tea_race';

/**
 * Everything below reads the request body, so nothing below trusts it.
 *
 * These three fields carry the whole of the lobby's settings screen, and until they were added here
 * the endpoint accepted a game's name, seat count and seed and silently dropped the rest — so for
 * any signed-in player every game came out with the default ruleset, the default hazards and the
 * default difficulty no matter what they had chosen. Anything unrecognised falls back to the default
 * rather than being passed through, so a malformed or hostile body can only ever produce an ordinary
 * game.
 */
const RULESETS = ['classic', 'voyage'] as const;
const DIFFICULTIES = ['gentle', 'steady', 'hard'] as const;

/** The optional-rule switches, listed explicitly so an unknown key cannot reach the sim. */
const HAZARD_KEYS = [
  'weather',
  'piracy',
  'events',
  'hostileBids',
  'quaysideSales',
  'wages',
  'loans',
  'deadlines',
  'shipClasses',
  'stocks',
  'agents',
] as const;

function readRules(raw: unknown): 'classic' | 'voyage' | undefined {
  return typeof raw === 'string' && (RULESETS as readonly string[]).includes(raw)
    ? (raw as 'classic' | 'voyage')
    : undefined;
}

function readDifficulty(raw: unknown): 'gentle' | 'steady' | 'hard' | undefined {
  return typeof raw === 'string' && (DIFFICULTIES as readonly string[]).includes(raw)
    ? (raw as 'gentle' | 'steady' | 'hard')
    : undefined;
}

function readHazards(
  raw: unknown,
): ({ weather: boolean; piracy: boolean } & Record<string, boolean>) | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const body = raw as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const key of HAZARD_KEYS) {
    if (typeof body[key] === 'boolean') out[key] = body[key] as boolean;
  }
  // weather and piracy are required by the Hazards type. Defaulted off rather than guessed, and
  // spread *before* the sanitised values so a body that does set them still wins.
  return { weather: false, piracy: false, ...out };
}


/**
 * One Vercel function covering both `/api/tea-race/game` (list/create) and
 * `/api/tea-race/game?id=:id` (load/save/delete) as a single function — the two were separate
 * functions until a 4th game's own pair would have pushed the Hobby-plan function count past
 * its 12-function ceiling. A path-based `[[...id]].ts` catch-all doesn't work here: that's a
 * Next.js routing convention, not something plain Vercel Functions understand, so it silently
 * 404s on every request in production even though it looks fine locally. Query-string `id` on a
 * single plain `index.ts` sidesteps that entirely. `req.query.id` is `undefined` on the
 * collection route and a plain string (or one-element array, if the key is repeated) otherwise.
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
      const name: string = ((req.body?.name as string | undefined) ?? 'Voyage').trim();
      const humanNames: string[] = Array.isArray(req.body?.humanNames)
        ? (req.body.humanNames as unknown[]).filter((n): n is string => typeof n === 'string')
        : ['You'];
      const aiCount = Number.isFinite(req.body?.aiCount) ? Number(req.body.aiCount) : 3;
      const seed = typeof req.body?.seed === 'string' ? req.body.seed : undefined;

      const newId = uuid();
      const state = createInitialState(newId, name, {
        humanNames,
        aiCount,
        seed,
        rules: readRules(req.body?.rules),
        hazards: readHazards(req.body?.hazards),
        difficulty: readDifficulty(req.body?.difficulty),
        createdAt: Date.now(),
      });

      try {
        await db.query(
          `INSERT INTO games (id, owner_id, game, mode, status, turn, state, config)
           VALUES ($1, $2, $3, 'single', 'active', $4, $5, '{}')`,
          [newId, user.userId, GAME_KIND, state.round, JSON.stringify(state)],
        );
        return res.status(201).json({ gameId: newId, state });
      } catch (err) {
        console.error('create tea-race game error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    if (req.method === 'GET') {
      try {
        const { rows } = await db.query(
          `SELECT id, status, turn, state->>'name' AS name, state->>'rules' AS rules,
                  EXTRACT(EPOCH FROM updated_at) * 1000 AS saved_at
           FROM games WHERE owner_id = $1 AND game = $2 ORDER BY updated_at DESC LIMIT 50`,
          [user.userId, GAME_KIND],
        );
        const saves = rows.map(r => ({
          id: r.id,
          name: r.name ?? 'Voyage',
          turn: Number(r.turn) ?? 0,
          status: r.status,
          // Which game it is, so the lobby can say so rather than making you open it to find out.
          // Read out of the stored state rather than a new column, so no migration is needed.
          rules: r.rules === 'voyage' ? 'voyage' : 'classic',
          savedAt: Math.round(parseFloat(r.saved_at)),
        }));
        return res.json({ saves });
      } catch (err) {
        console.error('list tea-race games error', err);
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
      console.error('get tea-race game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PUT') {
    // Overwrite full state — the client is authoritative (single-player against computer captains,
    // or hotseat on one device; no server-side action validation), and syncs its whole GameState
    // after every dispatched action. Same trust model as the other two games.
    const { state } = req.body ?? {};
    if (!state) return res.status(400).json({ message: 'state required' });
    try {
      // The Tea Race has no losing state of its own — a captain who runs out of money can always
      // sell a share back and carry on — so a game is either won or still being played.
      const status = state.winnerId ? 'victory' : 'active';
      await db.query(
        `UPDATE games SET state = $1, status = $2, turn = $3, updated_at = NOW()
         WHERE id = $4 AND owner_id = $5 AND game = $6`,
        [JSON.stringify(state), status, state.round ?? 0, id, user.userId, GAME_KIND],
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('save tea-race state error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await db.query('DELETE FROM games WHERE id = $1 AND owner_id = $2 AND game = $3', [
        id,
        user.userId,
        GAME_KIND,
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('delete tea-race game error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
