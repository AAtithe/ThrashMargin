# CLAUDE.md — Thrash Margin

This file tells Claude Code exactly what this project is, what has been built, and what to build next.

## What this is

Thrash Margin is a browser-based territory strategy game combining Settlers-style settlement building with Risk-style military conquest. The name reflects the core tension: warfare (thrash) and economics (margin) are inseparable.

## What has been built (prototype stage)

The game was prototyped as a single-file HTML/JS widget. The full game logic is defined and tested. Key design decisions that are locked:

### Game mechanics
- 20 territories on a graph map, connected by edges
- Three factions: Player (blue), Enemy (red), Neutral (grey)
- Three resources: Gold (income), Food (troop upkeep), Materials (upgrades)
- Settlement levels 1–4, unlocked with materials + gold. Each level adds one building slot and increases base gold production and troop cap
- Five building types per slot: Farm (+4 food/turn), Mine (+3 mat/turn), Barracks (+5 troop cap), Market (+2 gold/turn), Tower (+4 def strength)
- Troop upkeep: 1 food per troop per turn. Food deficit causes troop starvation
- Combat: fully deterministic based on attacker/defender strength ratio. No RNG
- Player chooses exact troop count to send per attack via slider
- Win condition: conquer all enemy territories

### AI system
- Configurable via settings: aggression threshold, expand priority, troop growth rate, build chance, difficulty multiplier
- Difficulty levels: Easy, Normal, Hard, Brutal (applies a global multiplier)
- AI evaluates targets by scoring: expansion priority + gold value - defence strength

### Settings
- All game parameters are runtime-configurable: starting resources, recruit cost, food upkeep, player attack bonus, neutral territory strength

## Architecture

### Data flow
```
Client (React) → POST /api/game/:id/action → Server validates → Engine processes → Returns new GameState → Client renders
```

### Key principle
The game engine is pure TypeScript with no side effects. It takes a GameState and an Action and returns a new GameState. The server owns the authoritative state. The client only renders.

## What to build next (priority order)

### Phase 1 — Server foundation
1. Set up Express server with TypeScript (server/src/index.ts)
2. Connect to Postgres using the schema in server/src/db/schema.sql
3. Implement JWT auth: POST /api/auth/register, POST /api/auth/login
4. Implement game CRUD: POST /api/game (create), GET /api/game/:id (fetch state)
5. Implement POST /api/game/:id/action (validate + process + persist)

### Phase 2 — Engine port
Port the game engine from shared/engine-reference.ts into server/src/engine/:
- engine/state.ts — GameState type and initial state factory
- engine/combat.ts — attack resolution (deterministic ratio-based)
- engine/ai.ts — enemy turn logic
- engine/actions.ts — action handlers (attack, recruit, build, upgrade, endTurn)
- engine/index.ts — main processAction() function

### Phase 3 — Client
1. Replace the widget canvas with a proper React component in client/src/game/GameCanvas.tsx
2. Build the sidebar UI in client/src/components/
3. Wire all actions to API calls in client/src/hooks/useGame.ts
4. Add auth pages: client/src/pages/Login.tsx, Register.tsx
5. Add game lobby: client/src/pages/Lobby.tsx (list/create games)

### Phase 4 — Multiplayer
1. Add socket.io to server
2. Replace AI turn with second player's action when game mode is 'pvp'
3. Emit state updates to both players on each action

### Phase 5 — Polish
1. Game history / replay log
2. Statistics per player (win rate, avg game length, favourite strategy)
3. Leaderboard

## File locations

| File | Purpose |
|------|---------|
| shared/types.ts | All shared TypeScript types |
| shared/engine-reference.ts | Complete game engine from prototype |
| server/src/db/schema.sql | Postgres schema |
| server/.env.example | Environment variable template |
| docker-compose.yml | Local Postgres setup |

## Commands

```bash
npm run dev          # Start both client and server (from root)
npm run dev:client   # Client only
npm run dev:server   # Server only
npm run migrate      # Run DB migrations (from server/)
npm run build        # Build both for production
```
