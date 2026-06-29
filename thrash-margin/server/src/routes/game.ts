import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { createInitialState, processAction, DEFAULT_CONFIG } from 'shared/engine-reference';
import type { GameConfig, GameAction } from 'shared/types';
import { db } from '../db/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/game — list player's saves
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await db.query(
      `SELECT id,
              state->>'name' AS name,
              (state->>'turn')::int AS turn,
              status,
              config->>'diff' AS diff,
              (config->>'campaignScenario')::int AS campaign_scenario,
              EXTRACT(EPOCH FROM updated_at) * 1000 AS saved_at
       FROM games WHERE owner_id = $1 ORDER BY updated_at DESC`,
      [req.userId]
    );
    const saves = result.rows.map(r => ({
      id: r.id,
      name: r.name ?? 'Campaign',
      turn: r.turn ?? 1,
      status: r.status,
      diff: r.diff ?? 'normal',
      savedAt: Math.round(parseFloat(r.saved_at)),
      ...(r.campaign_scenario != null && { campaignScenario: Number(r.campaign_scenario) }),
    }));
    res.json({ saves });
  } catch (err) {
    console.error('list games error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/game — create a new game
router.post('/', async (req: AuthRequest, res: Response) => {
  const { config, name } = req.body ?? {};
  try {
    const id = uuid();
    const mergedConfig: GameConfig = { ...DEFAULT_CONFIG, ...(config ?? {}) };
    const state = createInitialState(id, mergedConfig);
    (state as unknown as Record<string, unknown>).name = ((name as string | undefined) ?? 'Campaign').trim();

    await db.query(
      `INSERT INTO games (id, owner_id, mode, status, turn, state, config)
       VALUES ($1, $2, 'single', 'active', $3, $4, $5)`,
      [id, req.userId, state.turn, JSON.stringify(state), JSON.stringify(mergedConfig)]
    );
    res.json({ gameId: id, state });
  } catch (err) {
    console.error('create game error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/game/:id — fetch game state
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await db.query(
      `SELECT state FROM games WHERE id = $1 AND owner_id = $2`,
      [req.params.id, req.userId]
    );
    if (!result.rows[0]) {
      res.status(404).json({ message: 'Game not found' });
      return;
    }
    res.json({ state: result.rows[0].state });
  } catch (err) {
    console.error('load game error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/game/:id/action
router.post('/:id/action', async (req: AuthRequest, res: Response) => {
  const { action } = (req.body ?? {}) as { action: GameAction };
  if (!action) {
    res.status(400).json({ message: 'action is required' });
    return;
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT state, turn FROM games WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
      [req.params.id, req.userId]
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      res.status(404).json({ message: 'Game not found' });
      return;
    }
    const currentState = result.rows[0].state;
    const nextState = processAction(currentState, action);
    const newStatus = nextState.status === 'victory' ? 'victory'
      : nextState.status === 'defeated' ? 'defeated' : 'active';

    await client.query(
      `UPDATE games SET state = $1, status = $2, turn = $3 WHERE id = $4`,
      [JSON.stringify(nextState), newStatus, nextState.turn, req.params.id]
    );
    await client.query(
      `INSERT INTO game_actions (id, game_id, user_id, turn, action)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuid(), req.params.id, req.userId, currentState.turn, JSON.stringify(action)]
    );
    await client.query('COMMIT');
    res.json({ success: true, state: nextState });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('action error', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    client.release();
  }
});

// PUT /api/game/:id/state — overwrite full state (used by client after batching local actions)
router.put('/:id/state', async (req: AuthRequest, res: Response) => {
  const { state } = req.body ?? {};
  if (!state) { res.status(400).json({ message: 'state is required' }); return; }
  try {
    const newStatus = state.status === 'victory' ? 'victory'
      : state.status === 'defeated' ? 'defeated' : 'active';
    await db.query(
      `UPDATE games SET state = $1, status = $2, turn = $3 WHERE id = $4 AND owner_id = $5`,
      [JSON.stringify(state), newStatus, state.turn, req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('save state error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/game/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await db.query(
      `DELETE FROM games WHERE id = $1 AND owner_id = $2`,
      [req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('delete game error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
