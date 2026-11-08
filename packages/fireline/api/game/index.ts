import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { cleanName, createGame, isGameId, saveState, sendGameLimit, sendSaveResult } from '../_lib/saves';
import { createInitialState } from '../../src/sim/state';

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

const statusOf = (state: { winner?: unknown }) => (state.winner === 0 ? 'victory' : state.winner === 1 ? 'defeated' : 'active');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const db = getDb();
  const idParam = req.query.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  if (id !== undefined && !isGameId(id)) return res.status(404).json({ message: 'Game not found' });

  if (id === undefined) {
    if (req.method === 'POST') {
      const name = cleanName(req.body?.name, 'Battle');
      const seed = typeof req.body?.seed === 'string' ? req.body.seed.slice(0, 64) : undefined;
      const newId = uuid();
      const state = createInitialState(newId, name, {
        seed,
        difficulty: readDifficulty(req.body?.difficulty),
        createdAt: Date.now(),
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
          `SELECT id, status, turn, state->>'name' AS name,
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
        id, ownerId: user.userId, game: GAME_KIND, state, status: statusOf(state), turn: minutes(state),
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
