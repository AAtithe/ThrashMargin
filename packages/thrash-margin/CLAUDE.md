# CLAUDE.md: Thrash Margin

What this game is, how it is built, and the rules for changing it. The rules themselves, and the
build log, are in `thrash-margin-design.md` at the repo root: read it before changing a rule.

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

A turn-based territory strategy game: Settlers-style settlement building against Risk-style
conquest, on a graph of territories. Warfare (thrash) and economics (margin) are inseparable: every
troop costs gold to raise and food to keep, and food is the hard ceiling on the size of an army.

## Layout

| Path | What |
|---|---|
| `shared/sim/` | The engine. Pure TypeScript, shared by the client and the API. |
| `scripts/drive.ts` | Headless rules harness (`npm run drive:tm` from the repo root). |
| `client/src/pages/Game.tsx` | The game screen: board, sidebar tabs, top bar, modals. |
| `client/src/components/` | MapView, TerritoryPanel, OrdersPanel, RealmPanel, ResearchPanel, LogPanel, Modals, HistoryChart, ui, Icon. |
| `client/src/game/plan.ts` | Pure helpers: highlights, suggested assault columns, what is undoable. |
| `client/src/hooks/` | `useGameCloud` (API, debounced saves) and `useGameLocal`, switched by `useGameHybrid`. |
| `client/src/theme.ts`, `styles.css` | Palette, fonts, the few things inline styles cannot do. |
| `api/game/index.ts` | List, create, load, save, delete; the `games` table with `game = 'thrash_margin'`. |

## Engine invariants

1. **`shared/sim/` is pure.** No `Math.random`, no `Date.now`. Every roll comes from `rng.ts`
   against the persisted `rngSeed`; `createdAt` and the seed are passed in by the caller. The
   harness replays a game byte for byte and resumes a serialised game to prove it.
2. **`explain(state, action)` is the single source of legality.** It returns null or the reason.
   Handlers call it first and return **the same state object** when it objects. The AI uses that
   to detect a rejected move, the save hooks use it to skip a write, and the UI shows the same
   sentence under a disabled button. Never add a check in a handler that `explain` does not make.
3. **The AI plays by the human's rules.** `ai.ts` only ever calls `step`. Difficulty may change an
   AI faction's income, action budget and boldness (`DIFFICULTY` in content.ts), never what it is
   allowed to do.
4. **Every faction owns its own `FactionState`.** Never read or write a treasury or research list
   anywhere but `state.factions[id]`.
5. **Presets state every rule toggle** (`RULE_TOGGLES`); the harness asserts it.
6. **Saves are versioned.** `version: 2`. Change the shape and you must extend `migrateState`; the
   harness carries a version 1 fixture.

## Working practices

- `npm run drive:tm` before trusting anything: about 12,000 assertions over every map and
  difficulty in a few seconds. `SEEDS=40` for a wider run.
- Typecheck both projects: `npx tsc --noEmit -p tsconfig.json` here, then `npx tsc --noEmit` in `client/`.
- Win-rate comparisons need 150+ seeds (see the root CLAUDE.md). The harness prints outcomes for
  the AI standing in for the player; it is a regression signal, not a balance study.
- Load the game in a browser after any UI change. Set `tm_user` as above; without a token the hybrid
  hook uses browser saves, so the whole game is playable with no API running.

## Commands

```bash
npm run drive:tm                       # from the repo root: rules harness
npm run dev:client                     # from this package: Vite on :5173
npm run build                          # client production build
```
