import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuid } from 'uuid';
import { getDb } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { queryParam } from '../_lib/query';
import { createGame, isGameId, saveState, sendGameLimit, sendSaveResult } from '../_lib/saves';
import { handleCoach } from './coach';

/**
 * The Founder's Ledger: one coaching ledger per account, in the shared `games` table like every other
 * game, discriminated by the `game` column ('founders_ledger' fits its VARCHAR(16)).
 *
 * Served at /api/play/founders-ledger through api/play/[kind].ts, which signs the caller in (401) and
 * checks the account has this game (403, and it is opt-in: off until an admin turns it on) before this
 * runs. This handler checks the user again and only ever reads or writes the caller's own row.
 *
 * The client is authoritative, as in the other single-player games: it sends the whole state after a
 * pause in typing. The state is the player's own writing (reviews, the 2030 letter), so nothing reads
 * it but its owner; size is capped by saveState (MAX_SAVE_BYTES, and the account's storage).
 */
const GAME_KIND = 'founders_ledger';

/** A ledger as the engine saves it: a plain object marked with its shape version. */
function isLedgerState(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).v === 2;
}

function reviewCount(state: Record<string, unknown>): number {
  return Array.isArray(state.reviews) ? state.reviews.length : 0;
}

async function ownLedger(db: ReturnType<typeof getDb>, userId: string) {
  const { rows } = await db.query(
    `SELECT id, status, turn, EXTRACT(EPOCH FROM updated_at) * 1000 AS saved_at
     FROM games WHERE owner_id = $1 AND game = $2 ORDER BY updated_at DESC LIMIT 1`,
    [userId, GAME_KIND],
  );
  return rows[0] as { id: string; status: string; turn: number; saved_at: string } | undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const user = await requireUser(req, res);
  if (!user) return;

  const db = getDb();
  // The coach (Claude): ?coach=status, or POST ?coach=<task>. See ./coach.ts.
  const coach = queryParam(req, 'coach');
  if (coach !== undefined) return handleCoach(req, res, db, user.userId, coach);

  // From req.url, never req.query, which logs a deprecation warning on Vercel; see _lib/query.ts.
  const id = queryParam(req, 'id');
  if (id !== undefined && !isGameId(id)) return res.status(404).json({ message: 'Ledger not found' });

  if (id === undefined) {
    if (req.method === 'GET') {
      try {
        const row = await ownLedger(db, user.userId);
        const saves = row
          ? [{ id: row.id, name: "The Founder's Ledger", turn: Number(row.turn) || 0, status: row.status, savedAt: Math.round(parseFloat(row.saved_at)) }]
          : [];
        return res.json({ saves });
      } catch (err) {
        console.error('list founders-ledger error', err);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    if (req.method === 'POST') {
      try {
        // One ledger per account: a second create (another tab, a retry) returns the one that exists.
        const existing = await ownLedger(db, user.userId);
        if (existing) return res.status(200).json({ gameId: existing.id, existing: true });
        const newId = uuid();
        const state = { v: 2 };
        const created = await createGame(db, {
          id: newId, ownerId: user.userId, game: GAME_KIND, status: 'active', turn: 0, state, config: {},
        });
        if (!created) return sendGameLimit(res);
        return res.status(201).json({ gameId: newId, state, version: 0 });
      } catch (err) {
        console.error('create founders-ledger error', err);
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
      if (!rows[0]) return res.status(404).json({ message: 'Ledger not found' });
      return res.json({ state: rows[0].state, version: rows[0].version });
    } catch (err) {
      console.error('get founders-ledger error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'PUT') {
    const state = req.body?.state;
    if (!isLedgerState(state)) return res.status(400).json({ message: 'A ledger state (v: 2) is required' });
    try {
      const result = await saveState(db, {
        id, ownerId: user.userId, game: GAME_KIND, state, status: 'active', turn: reviewCount(state),
        version: req.body?.version,
      });
      return sendSaveResult(res, result);
    } catch (err) {
      console.error('save founders-ledger error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await db.query('DELETE FROM games WHERE id = $1 AND owner_id = $2 AND game = $3', [id, user.userId, GAME_KIND]);
      return res.json({ success: true });
    } catch (err) {
      console.error('delete founders-ledger error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  }

  return res.status(405).end();
}
