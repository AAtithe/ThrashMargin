# CLAUDE.md — Thrash Margin

This file tells Claude Code exactly what this project is, what has been built, and what to build next.

## Accounts — no guest path (portal-wide invariant)

**A signed-in account is required to play, on every game on this portal. There is no guest route and
none is to be added back** — one existed and was deliberately removed. Do not relax the gate to make
local development, testing, or a screenshot easier.

Two checks, and only one is a security boundary:

- `client/src/pages/Lobby.tsx`'s `if (!user)` is **presentational** — it reads `tm_user` from
  localStorage, so anyone can satisfy it from the browser console. It protects nothing by itself, and
  stays because it is what stops the app inviting somebody to start a game they cannot save.
- `api/_lib/auth.ts`'s `getUser(req)` is **the real boundary** — a Bearer JWT verified against
  `JWT_SECRET`, with every endpoint returning 401 without one. No bypass, no dev-mode escape hatch,
  no unauthenticated read path.

To check the UI locally, satisfy the presentational half from the console:

```js
localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev' }))
```

See `CLAUDE.md` at the repo root for the portal-wide version of this.

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

## Onboarding, and the map-click bug it uncovered

There are now two tutorials, and they do different jobs:

- **The tutorial map** (`buildTutorial`, the lobby's "Start Tutorial", `getTutorialHint`'s six
  hints in the green side panel, the "Tutorial Graduate" achievement). Unchanged, and still the
  gentle eight-territory board. It only exists on `mapId === 'tutorial'`, so a player who starts a
  normal campaign — what the lobby's main button does — never sees it.
- **The guided turn** (`client/src/components/GuidedTour.tsx`), which runs on **any** map. It
  spotlights one real control at a time, waits for the game state to say the player used it, and
  walks one complete turn: select the capital, recruit, build, pick a target, attack, end turn.
  `planFirstTurn` reads the board rather than hardcoding anything, so the copy names whatever the
  player's actual capital, weakest neighbour and cheapest affordable building are called.

  It is built around action points: recruit 1 + build 1 + attack 2 is exactly the default
  `apPerTurn` of 4. **Do not add a fifth action step** — it would either sit waiting on a disabled
  button or push the attack out of reach. `Game.tsx` hides the hint panel while the run is up so
  the two are never talking at once.

  `GameConfig.enableTutorial` remains declared in `shared/types.ts` and read by nothing. The run is
  offered on a fresh campaign and from the header, not behind a lobby checkbox.

### `setPointerCapture` on the map container swallows every click

Building the above found that **a plain mouse click on a territory did nothing at all**.
`handlePointerDown` captured the pointer on the map container for every pointer type. Pointer
capture retargets the compatibility mouse events — `click` among them — to the capturing element,
so the click was delivered to the container rather than to the territory under the cursor:
`TerritoryRegion`'s `<g onClick>` never fired, and neither did the SVG's own deselect handler.

Capture is now taken in `handlePointerMove`, at the moment a gesture crosses the drag threshold,
which is all it was ever needed for — keeping a pan alive when the cursor leaves the map — plus on
the second pointer of a pinch. **Do not move it back to pointerdown.** If you touch the map's
pointer handling, check all four by hand in a browser: click selects, clicking the same territory
again deselects, dragging pans *without* deselecting, and clicking empty sea clears the selection.
A typecheck cannot see any of it.

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
