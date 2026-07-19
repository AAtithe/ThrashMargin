# Thrash Margin — Codebase Audit for Banco di Niccolo

Audit conducted: 2026-07-19  
Purpose: classify every module as REUSE, ADAPT, or IGNORE before building Banco di Niccolo alongside Thrash Margin.

---

## Classification key

- **REUSE** — theme-agnostic, take as-is into a shared package or copy verbatim
- **ADAPT** — structurally sound but contains TM-specific content; extract the pattern, rewrite the content
- **IGNORE** — territorial-conquest mechanics with no meaningful overlap; write Niccolo fresh

---

## Module-by-module classification

### Infrastructure / auth / persistence

| File | Class | Reason |
|------|-------|--------|
| `api/_lib/db.ts` | **REUSE** | Lazy Postgres pool, zero game logic |
| `api/_lib/auth.ts` | **REUSE** | JWT sign/verify, completely generic |
| `api/_lib/cors.ts` | **REUSE** | Two-line CORS helper |
| `api/auth/login.ts` | **REUSE** | Generic username+bcrypt login |
| `api/auth/register.ts` | **REUSE** | Generic registration |
| `server/src/middleware/auth.ts` | **REUSE** | Express JWT middleware |
| `server/src/db/client.ts` | **REUSE** | Express DB pool wrapper |
| `server/src/app.ts` | **REUSE** | Bare Express + CORS setup |
| `client/src/lib/token.ts` | **REUSE** | localStorage JWT helpers |
| `client/src/pages/Login.tsx` | **REUSE** | Auth form; TM branding is trivial to swap |

### Save system

| File | Class | Reason |
|------|-------|--------|
| `client/src/hooks/useGameLocal.ts` | **ADAPT** | Save index + localStorage pattern is sound; `SaveMeta` fields (`campaignScenario`, `diff`) are TM-specific |
| `client/src/hooks/useGame.ts` | **ADAPT** | Optimistic-update + cloud sync pattern is reusable; API endpoints and state shape are TM-specific |
| `client/src/hooks/useGameHybrid.ts` | **ADAPT** | Auth-gated local/cloud switch is generic; imports TM hooks directly |
| `server/src/db/schema.sql` | **ADAPT** | `games` table structure (id, owner, status, turn, state JSONB) is reusable; JSONB contents are TM-specific |
| `server/src/routes/game.ts` | **ADAPT** | CRUD + action dispatch pattern; all field names are TM-specific |
| `api/game/index.ts` | **ADAPT** | As above, Vercel serverless variant |
| `api/game/[id].ts` | **ADAPT** | As above |
| `api/game/[id]/action.ts` | **ADAPT** | As above |

### Graph / map

| File | Class | Reason |
|------|-------|--------|
| `shared/engine-reference.ts` → `getNeighbours()` | **REUSE** | Pure graph traversal: `edges.flatMap(([a,b]) => a===id?[b]:b===id?[a]:[])` — extracted into `packages/engine/src/graph.ts` |
| `shared/engine-reference.ts` → SVG layout (x/y coords on `Territory`) | **IGNORE** | Hard-coded pixel positions for the TM map |

### Game engine

| File | Class | Reason |
|------|-------|--------|
| `shared/engine-reference.ts` → `processAction()` dispatch | **ADAPT** | The `switch(action.type)` dispatch pattern is clean; all action types (`ATTACK`, `RECRUIT`, `BUILD`, …) are territorial-conquest concepts |
| `shared/engine-reference.ts` → `resolveCombat()` | **IGNORE** | Military ratio-based combat; no analogue in Niccolo |
| `shared/engine-reference.ts` → `runEnemyTurn()` AI | **ADAPT** | Scoring-based AI evaluation (score targets, pick best) is the right shape for Niccolo's rival houses; the scoring function itself is territory-specific |
| `shared/engine-reference.ts` → `getGoldProd / getFoodProd / getMatProd / getTroopCap / getDefStr` | **IGNORE** | Military settlement stats |
| `shared/engine-reference.ts` → `BUILDINGS / LV / TECH_TREE` | **IGNORE** | Territory-conquest content |
| `shared/engine-reference.ts` → `createInitialState()` | **IGNORE** | Hard-coded TM map; Niccolo maps come from JSON under `/content` |
| `shared/engine-reference.ts` → `diffMult / prodTotals / totalTroops` | **IGNORE** | TM-specific calculations |
| `shared/engine-reference.ts` → `FACTION_COLORS / FACTION_BORDER / TERRAIN_COLORS` | **IGNORE** | TM palette constants |
| `shared/types.ts` → `Territory / Owner / Resources / GameConfig / GameState / GameAction` | **IGNORE** | Territory-control types throughout; Niccolo's state model is completely different (ledger, routes, characters, news items) |

### UI

| File | Class | Reason |
|------|-------|--------|
| `client/src/pages/Game.tsx` | **IGNORE** | 1,600-line SVG map renderer with territory circles, troop sliders, combat overlays — nothing transfers |
| `client/src/pages/Lobby.tsx` | **ADAPT** | Save list + new game button pattern transfers; campaign scenario sections, map selector, difficulty selector are TM-specific |
| `client/src/main.tsx` | **ADAPT** | React Router setup is identical; routes and auth context will differ |

### Tooling / config

| File | Class | Reason |
|------|-------|--------|
| `client/vite.config.ts` | **REUSE** | Standard Vite+React config; `shared` alias removed for Niccolo (no shared TS needed at first) |
| `client/package.json` | **REUSE** | Identical React + Vite dep set |
| `client/tsconfig.json` | **REUSE** | Standard React/Vite TS config |
| `vercel.json` | **ADAPT** | Build/rewrite structure is identical; Niccolo will have its own Vercel project |
| `docker-compose.yml` | **REUSE** | Local Postgres; both games use the same DB |

---

## Coupling analysis

The two coupling points that prevent wholesale engine extraction are:

1. **`GameState` is a territory-control document.** Every field — `nodes: Territory[]`, `edges`, `resources.food/mat`, `actionsLeft`, `ceasefires`, `research` — is meaningful only in a military conquest context. Niccolo's state document needs a ledger, a news inbox, character locations, bills of exchange. There is no common base type.

2. **`createInitialState()` and all map data are hard-coded.** The design doc requires all Niccolo content in JSON under `/content`. TM's maps are baked into the engine file. An extraction would require refactoring TM's map handling at the same time — that is scope beyond Phase 0.

---

## Verdict: clean sibling app

**Do not extract a shared engine. Build Banco di Niccolo as a clean sibling app.**

The TM simulation core and its content are fully entangled. The only genuinely theme-agnostic piece of logic is `getNeighbours()` (and the BFS I added alongside it), which has been extracted into `packages/engine/src/graph.ts`.

The infrastructure layer (auth, db pool, save pattern, Vite config) will be shared by convention — Niccolo copies and adapts those files rather than importing them from a shared package. This keeps each app self-contained for deployment and avoids a premature abstraction boundary.

The monorepo layout makes it easy to promote shared code to `packages/engine` or `packages/ui-kit` as genuine shared needs emerge during Phase 1+. Nothing is stopping that; we just haven't seen the need yet.

---

## What was extracted

`packages/engine/src/graph.ts` — `getNeighbours(edges, id)` and `shortestPath(edges, from, to)`. Both apps will eventually need BFS pathfinding for route planning (TM for AI targeting, Niccolo for ship/courier routing). This is the one function that is provably theme-agnostic.
