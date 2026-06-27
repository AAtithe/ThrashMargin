// server/src/routes/game.ts
// Claude Code: implement create, fetch, and action endpoints
// The engine lives in ../engine — import processAction from there

import { Router, Request, Response } from 'express';
// import { processAction, createInitialState } from '../engine';
// import { db } from '../db/client';
// import { authMiddleware } from '../middleware/auth';

const router = Router();

// POST /api/game — create a new game
router.post('/', async (req: Request, res: Response) => {
  // TODO: create game, persist to DB, return initial state
  // const { config } = req.body;
  // const state = createInitialState(uuid(), { ...DEFAULT_CONFIG, ...config });
  // await db.query('INSERT INTO games ...', [state]);
  // res.json({ gameId: state.id, state });
  res.status(501).json({ message: 'Not implemented — Claude Code: build this out' });
});

// GET /api/game/:id — fetch game state
router.get('/:id', async (req: Request, res: Response) => {
  // TODO: fetch from DB, return state
  res.status(501).json({ message: 'Not implemented — Claude Code: build this out' });
});

// POST /api/game/:id/action — process a player action
router.post('/:id/action', async (req: Request, res: Response) => {
  // TODO:
  // 1. Fetch current state from DB
  // 2. Validate it is the player's turn
  // 3. Call processAction(state, req.body.action)
  // 4. Persist new state to DB
  // 5. Log action to game_actions table
  // 6. Return new state
  res.status(501).json({ message: 'Not implemented — Claude Code: build this out' });
});

// GET /api/game — list player's games
router.get('/', async (req: Request, res: Response) => {
  // TODO: return paginated list of games for authenticated user
  res.status(501).json({ message: 'Not implemented — Claude Code: build this out' });
});

export default router;
