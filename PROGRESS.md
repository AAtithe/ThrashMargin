# Banco di Niccolo — Build Progress

---

## Phase checklist (Section 12)

| Phase | Title | Status |
|-------|-------|--------|
| **0** | Audit, monorepo, empty shell | ✅ Complete |
| 1 | Clock, 12-city map, ship/courier movement, save/load | ⬜ Next |
| 2 | Trade core — goods, prices, buy/sell, cargo, drift | ⬜ |
| 3 | Information layer — news latency, stale prices, couriers | ⬜ |
| 4 | Credit — bills, maturity ladder, deposits, loans, insolvency | ⬜ |
| 5 | Characters and assignments | ⬜ |
| 6 | Event engine — triggers, choices, effects, flags | ⬜ |
| 7 | Chapter 1 content pack — full Niccolo Rising arc | ⬜ |
| 8 | AI houses v1 — Medici, St Pol, Genoese; agents | ⬜ |
| 9+ | One chapter content pack per phase (Ch2 onward) | ⬜ |

---

## Phase 0 — Done

**Audit**
- Classified every Thrash Margin module as REUSE / ADAPT / IGNORE. See `AUDIT.md`.
- Verdict: build Niccolo as a clean sibling app. The TM simulation core (`GameState`, `Territory`, all action types, combat, AI) is fully entangled with territory-conquest mechanics and shares nothing with Niccolo's ledger/trade/character model.
- Extracted one genuinely theme-agnostic utility: `getNeighbours` + `shortestPath` into `packages/engine/src/graph.ts`.

**Monorepo restructure**
- Moved `thrash-margin/` → `packages/thrash-margin/` via `git mv` (history preserved).
- Moved `banco-di-niccolo-design.md` to repo root.
- Created root `package.json` with npm workspaces covering `packages/*`.
- Created root `.gitignore`.
- Confirmed Thrash Margin client builds cleanly after the move (`tsc && vite build` ✓).

**Niccolo shell**
- Created `packages/niccolo/` — Vite + React + TypeScript, identical stack to TM.
- Builds clean (`tsc && vite build` ✓), runs on port 5174.
- Placeholder screen: dark manuscript aesthetic, title + subtitle + phase note.

**Engine stub**
- Created `packages/engine/src/graph.ts` with `getNeighbours` and `shortestPath`.
- Neither app imports it yet; it is ready to use in Phase 1.

---

## Phase 1 — What it will do

Phase 1 deliverable: **sail Bruges to Venice and watch weeks pass.**

Concretely:

1. **Clock** — weekly turn counter displaying a real calendar date (e.g. `Week of 14 March 1460`). A single `advanceWeek()` action moves the clock forward. Exported from `packages/engine/`.

2. **12-city map** — Chapter 1 cities loaded from `packages/niccolo/content/cities/chapter1.json`. Each city has `id`, `name`, `region`, `power`, `x/y` for layout, `port: boolean`. Rendered as an SVG node graph on screen.

3. **Routes** — edges loaded from `packages/niccolo/content/routes/chapter1.json`. Each route has `from`, `to`, `distanceWeeks`, `type: 'land'|'sea'`, `seasonal` boolean.

4. **One ship** — player controls a single vessel. Can be dispatched from city A to city B along a valid route. Arrival fires after `distanceWeeks` turns.

5. **One courier** — same mechanics as the ship, but land-only routes, used for the Charetty dispatch business from Book 1.

6. **Save/load** — `localStorage`-backed save following the same pattern as TM's `useGameLocal.ts` (adapted). Single save slot is fine for Phase 1.

Content files to author in Phase 1:
- `packages/niccolo/content/cities/chapter1.json` — 12 cities
- `packages/niccolo/content/routes/chapter1.json` — land and sea connections

No trade, no credit, no characters, no events. Those are Phase 2+.

---

## Decisions needed from you

None outstanding from Phase 0. The audit verdict (sibling app, no shared engine) is recorded in `AUDIT.md` for reference.

---

## Session log

### 2026-07-19 — Phase 0
- Pulled latest TM commits from origin/main (was 2 commits behind).
- Completed all 5 Phase 0 tasks.
- No Phase 1 work started.
