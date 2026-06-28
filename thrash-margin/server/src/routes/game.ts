import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { createInitialState, processAction, DEFAULT_CONFIG } from 'shared/engine-reference';
import type { GameConfig, GameAction } from 'shared/types';
import { db } from '../db/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/game — list player's saves
router.get('/', (req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(
      `SELECT id, name, turn, status, config, updated_at FROM games
       WHERE owner_id = ? ORDER BY updated_at DESC`
    ).all(req.userId) as Array<{
      id: string; name: string; turn: number; status: string;
      config: string; updated_at: string;
    }>;

    const saves = rows.map(r => {
      const config = JSON.parse(r.config) as Partial<GameConfig>;
      return {
        id: r.id,
        name: r.name,
        turn: r.turn,
        status: r.status,
        diff: config.diff ?? 'normal',
        savedAt: new Date(r.updated_at).getTime(),
      };
    });
    res.json({ saves });
  } catch (err) {
    console.error('list games error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/game — create a new game
router.post('/', (req: AuthRequest, res: Response) => {
  const { config, name } = req.body ?? {};
  try {
    const id = uuid();
    const mergedConfig: GameConfig = { ...DEFAULT_CONFIG, ...(config ?? {}) };
    const state = createInitialState(id, mergedConfig);
    const campaignName = ((name as string | undefined) ?? 'Campaign').trim();

    db.prepare(
      `INSERT INTO games (id, owner_id, mode, status, turn, state, config, name)
       VALUES (?, ?, 'single', 'active', ?, ?, ?, ?)`
    ).run(id, req.userId, state.turn, JSON.stringify(state), JSON.stringify(mergedConfig), campaignName);

    res.json({ gameId: id, state });
  } catch (err) {
    console.error('create game error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/game/:id — fetch game state
router.get('/:id', (req: AuthRequest, res: Response) => {
  try {
    const row = db.prepare(
      `SELECT state FROM games WHERE id = ? AND owner_id = ?`
    ).get(req.params.id, req.userId) as { state: string } | undefined;

    if (!row) {
      res.status(404).json({ message: 'Game not found' });
      return;
    }
    res.json({ state: JSON.parse(row.state) });
  } catch (err) {
    console.error('load game error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/game/:id/action — process a player action
router.post('/:id/action', (req: AuthRequest, res: Response) => {
  const { action } = (req.body ?? {}) as { action: GameAction };
  if (!action) {
    res.status(400).json({ message: 'action is required' });
    return;
  }
  const processGame = db.transaction(() => {
    const row = db.prepare(
      `SELECT state, turn FROM games WHERE id = ? AND owner_id = ?`
    ).get(req.params.id, req.userId) as { state: string; turn: number } | undefined;

    if (!row) return null;

    const currentState = JSON.parse(row.state);
    const nextState = processAction(currentState, action);
    const newStatus = nextState.status === 'victory' ? 'victory'
      : nextState.status === 'defeated' ? 'defeated' : 'active';

    db.prepare(
      `UPDATE games SET state = ?, status = ?, turn = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(nextState), newStatus, nextState.turn, req.params.id);

    db.prepare(
      `INSERT INTO game_actions (id, game_id, user_id, turn, action)
       VALUES (?, ?, ?, ?, ?)`
    ).run(uuid(), req.params.id, req.userId, currentState.turn, JSON.stringify(action));

    return nextState;
  });

  try {
    const nextState = processGame();
    if (!nextState) {
      res.status(404).json({ message: 'Game not found' });
      return;
    }
    res.json({ success: true, state: nextState });
  } catch (err) {
    console.error('action error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/game/:id
router.delete('/:id', (req: AuthRequest, res: Response) => {
  try {
    db.prepare(`DELETE FROM games WHERE id = ? AND owner_id = ?`).run(req.params.id, req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('delete game error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
