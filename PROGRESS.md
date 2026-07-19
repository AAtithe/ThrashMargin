# Banco di Niccolo — Build Progress

---

## Phase checklist (Section 12)

| Phase | Title | Status |
|-------|-------|--------|
| **0** | Audit, monorepo, empty shell | ✅ Complete |
| 1 | Clock, 12-city map, ship/courier movement, save/load | ✅ Complete |
| 2 | Trade core — goods, prices, buy/sell, cargo, drift | ✅ Complete |
| 3 | Information layer — news latency, stale prices, couriers | ✅ Complete |
| 4 | Credit — bills, maturity ladder, deposits, loans, insolvency | ✅ Complete |
| 5 | Characters and assignments | ✅ Complete |
| 6 | Event engine — triggers, choices, effects, flags | ✅ Complete |
| 7 | Chapter 1 content pack — full Niccolo Rising arc | ⬜ Next |
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

## Phase 1 — Done

Deliverable met: **sail Bruges to Venice and watch weeks pass.** Verified live in browser — dispatched the ship from Bruges, advanced the clock week by week, watched the marker travel the Bruges–Venice sea route, and confirmed arrival at "Week of 9 May 1460" (8 weeks after the 14 March 1460 campaign start, matching the route's `distanceWeeks`). Reloaded the page and confirmed the save survived.

1. **Clock** — `dateForWeek`, `formatWeekDate`, `advanceWeek` added to `packages/engine/src/clock.ts` (pure, theme-agnostic — takes a `startDate` rather than hard-coding one) and re-exported from `packages/engine/src/index.ts`. Niccolo supplies its own campaign start (14 March 1460) from `packages/niccolo/src/sim/content.ts`.

2. **12-city map** — authored `packages/niccolo/src/content/cities/chapter1.json`: London, Calais, Bruges, Ghent, Antwerp, Dijon, Geneva, Lyon, Milan, Genoa, Florence, Venice, each with `id/name/region/power/x/y/port`. Rendered as an SVG node graph in `packages/niccolo/src/components/MapView.tsx`.

3. **Routes** — authored `packages/niccolo/src/content/routes/chapter1.json`: 13 edges (land + sea), including a direct Bruges–Venice sea route (8 weeks, seasonal, the Flanders galley line) and an overland alternative via Dijon–Geneva–Milan–Florence (the Alpine pass at Geneva–Milan is marked seasonal).

4. **One ship** ("The Charetty ship") and **5. one courier** ("The dispatch rider") — both start docked at Bruges. Sim core lives in `packages/niccolo/src/sim/`: `types.ts` (GameState/City/Route/Vessel/GameAction), `state.ts` (`createInitialState`), `actions.ts` (pure `processAction` handling `ADVANCE_WEEK` and `DISPATCH_VESSEL`, mirroring TM's reducer pattern). The courier is restricted to land routes only — verified it cannot be sent across the Bruges–Venice sea leg, unlike the ship.

6. **Save/load** — `packages/niccolo/src/hooks/useGameLocal.ts`, single `localStorage` slot (`niccolo_save`), same shape as TM's `useGameLocal.ts` but simplified (no multi-save index — that's TM-specific complexity Phase 1 doesn't need).

Also required, not originally itemised: added `@repo/engine` as a real npm-workspace dependency of `packages/niccolo/package.json` (it wasn't wired up in Phase 0) and ran `npm install` at the repo root so the workspace symlink exists.

No trade, no credit, no characters, no events. Those are Phase 2+.

---

## Phase 2 — Done

Deliverable met: **profitable triangle run.** Verified live in browser — with the ship starting docked at Bruges with 40f cash: sailed Bruges → Calais → London (2 weeks), bought 4 wool at 10-11f/unit (40f spent, cash to 0), sailed back to Bruges (2 weeks), sold the wool at 18-20f/unit (80f received, cash to 80f — a 40f profit on the wool leg alone), then bought 3 Flemish cloth at 24-26f/unit (72f spent, cash to 8f), ready to carry it back to London where cloth base-prices at 45f. Confirmed the save survives a full page reload mid-run (cash, week, and cargo all persisted).

1. **Goods** — authored `packages/niccolo/src/content/goods/chapter1.json`: 8 goods (wool, Flemish cloth, madder, wine, salt, silk, spices, glass), each with an `id/name/unit`.

2. **Local prices** — extended each city in `packages/niccolo/src/content/cities/chapter1.json` with a `market` map (`goodId -> { base }`), following the node data model in Section 3 of the design doc. Prices are deliberately uneven across the map to make arbitrage real: e.g. wool is 10f in London (produced) and 20f in Bruges (imported); cloth is the reverse (24f in Bruges where it's woven, 45f in London where it's a luxury import).

3. **Buy/sell** — new `BUY_GOOD` / `SELL_GOOD` actions in `packages/niccolo/src/sim/actions.ts`. Both require the vessel to be docked (not under way) and to have a cargo hold (couriers don't trade); buying additionally checks cargo space and cash on hand, selling checks the vessel is actually carrying that much.

4. **Cargo** — `Vessel` gained `cargo: Record<goodId, quantity>` and a `capacity` (the Charetty ship: 20 units; the dispatch rider: 0, so it's mechanically excluded from trade). `cargoTotal()` in the new `packages/niccolo/src/sim/market.ts` sums a manifest against capacity.

5. **Price drift** — each city-good pair tracks a `scarcity` multiplier (1.0 = base price) in `GameState.scarcity`. Buying nudges it up (price rises as local supply is depleted), selling nudges it down; every `ADVANCE_WEEK` it decays 10% of the way back toward 1.0 (`driftScarcity` in `sim/market.ts`), so a market a player has been trading in gradually normalises if left alone. `eventModifier` and true random `noise` from the design doc's price formula are deferred — there's no event system yet (Phase 6) and Phase 3 explicitly inverts the pricing problem (stale received-news prices vs. live prices), so it isn't worth building noise into a price the player can currently see live.

Also required, not originally itemised: a defensive check in `useGameLocal.ts`'s `readSave()` that discards a pre-Phase-2 save missing `cash`/`scarcity`/`cargo` rather than crashing on it (there's only one local save slot, so this just means a stale save quietly restarts a fresh campaign instead of throwing).

Starting cash is 40f — small on purpose, per the design pillar that cash-on-hand should be "a small, dangerous number." A `MarketPanel` component (`packages/niccolo/src/components/MarketPanel.tsx`) renders when a cargo-capable vessel is selected and docked: current city's goods, live price, a quantity input, and Buy/Sell buttons; cash and hold usage are shown in both the panel and the vessel list.

No news/latency layer (prices are all live, not stale-by-report), no insurance, no multi-currency, no characters, no events. Those remain Phase 3+.

---

## Phase 3 — Done

Deliverable met: **lose money on stale information, then fix it with couriers.** Verified live in browser.

1. **News items** — `NewsItem` (`packages/niccolo/src/sim/types.ts`): `cityId`, `trueAsOfWeek`, `receivedOnWeek`, and a `prices` snapshot. New `packages/niccolo/src/sim/news.ts` generates one for every city with a market, every week, snapshotting that week's true prices.

2. **Latency** — `shortestReportWeeks()` (Dijkstra over all 12 cities) gives each city a base correspondence time from Bruges, over *every* route, land or sea — a letter rides whatever ship or rider is already making a crossing, unlike Phase 1's single dispatch-rider unit, which stays land-only for its own physical travel. Base latencies from Bruges: Ghent/Antwerp/Calais 1 week, London 2, Dijon 3, Geneva 5, Lyon 6, Milan 7, Venice 8 (via the direct Flanders galley route — the fastest path for both cargo and mail), Genoa 8, Florence 9. Bruges itself is always latency 0 — it's home, the player has first-hand knowledge there always.

3. **Stale prices** — `GameState` gained `pendingNews` (in transit) and `knownPrices` (cityId → newest arrived report). Every `ADVANCE_WEEK`, new snapshots are generated and any whose `receivedOnWeek` has passed move into `knownPrices`. A vessel actually docked at a city still trades at the true live price (unchanged from Phase 2) — the risk is purely in planning a voyage on a report that's gone stale by the time you arrive, not in the trade itself.

4. **Background market flows** — added `applyBackgroundFlows()` (`packages/niccolo/src/sim/market.ts`): a small random nudge (±0.08) to every city-good's scarcity, every week, independent of the player's own trades. This was necessary, not just itemised: without it, nothing in the sim ever moved a price except the player's own buying and selling, so a stale report about a city the player hadn't touched would always still be exactly true when it arrived — there'd be no actual staleness risk to play around. This represents the wider economy the player can't see directly (design doc §3/§4, "scarcity drifts with simulated supply flows between nodes").

5. **Courier investment** — new `INVEST_COURIER` action. Costs `15f × (current level + 1)` and shaves one week off a city's latency, down to a floor of 1 week (a report can never beat a courier's actual travel time, however much is invested). Bruges can't be invested in — it's already instant.

Also required, not originally itemised: extended the save-guard in `useGameLocal.ts` to discard pre-Phase-3 saves missing `knownPrices`/`pendingNews`/`courierInvestment`.

New `DispatchesPanel` component (design doc's UI screen 4): lists every city, its last-known report and age, when the next report is due, current vs. base latency, and an invest button; shows "live" instead of a stale report for any city a vessel is currently docked at. `MapView` now fades city markers by information age (screen 1's "fog by information age") — solid for live or fresh reports, dimmer for stale or unreported cities.

Verified live in browser: reset to a fresh campaign and confirmed only Bruges was live at week 0, with all 11 other cities showing "no report yet". Advanced a week and watched the 1-week-latency neighbours (Ghent, Antwerp, Calais) report in while London (2 weeks) and everything further stayed dark. Invested 15f in London's courier line, watched its latency drop from 2 to 1 week and its button switch to a disabled "Fastest". Dispatched the ship to Dijon (3-week land route, no report yet), advanced 3 weeks, and on arrival found the true docked price (wine 12f, salt 17f) had drifted from the 11f/18f base under background flows the player had no visibility into until physically arriving — the stale-information risk the phase exists to demonstrate. Confirmed the save (including the news queue and courier investment) survives a page reload, then reset the campaign to a clean state. `tsc --noEmit` and `vite build` both clean.

No agents, secrets, or ciphers (design doc ties those to Phase 8/counter-intelligence and the event system), no insurance or multi-currency (Phase 4), no `eventModifier` term in the price formula (Phase 6, event engine). Those remain Phase 4+. **Do not start Phase 4 — stop here per instructions.**

---

## Phase 4 — Done

Deliverable met: **leverage a venture and survive the ladder.** Verified live in browser.

1. **Multi-currency** — `sim/currency.ts` defines 5 currencies grouped by `City.power` (confirmed 2026-07-19): florin (home ledger + Florence), groot (Burgundy/Flanders: Bruges/Ghent/Antwerp/Dijon), pound (England: London/Calais), écu (Savoy/France/Milan/Genoa: Geneva/Lyon/Milan/Genoa), ducat (Venice). Every city in `content/cities/chapter1.json` gained a `currency` field. Cash itself stays a single florin balance — foreign-currency exposure lives entirely in the credit instruments below, not in a multi-wallet system, so Phase 2/3's trade code needed no changes.
2. **Exchange rates** — `initialExchangeRates()`/`driftExchangeRates()` in `sim/currency.ts` give each foreign currency a simplified peg against the florin (not literal historical mint weights) and a weekly random walk that mean-reverts toward par, mirroring the existing scarcity-drift pattern. Verified live: a bill written at 1.30f/pound settled eight weeks later at 1.27f/pound — real FX risk, not just flavour text.
3. **Bills of exchange** — `WRITE_BILL` (`sim/credit.ts`) lets the player borrow florins now against a future repayment, denominated in the destination city's currency, term 2–26 weeks, cost hidden in the exchange spread (0.6%/week). No branch gating (confirmed 2026-07-19) — bills can be written at any city on the map right now; Phase 5 tightens this once branches/managers exist.
4. **Deposits** — `TAKE_DEPOSIT` is the cheap-capital instrument: always florin-denominated, always at home, lowest rate (0.15%/week) — "a merchant deposits with the bank."
5. **Loans out** — `WRITE_LOAN` offers merchant loans (safe, 0.4%/week) and prince loans (risky, 0.9%/week, 20% default chance at maturity) — the design doc's "high margin, may default politically" vs. "secured on cargo" distinction, without named counterparties (Phase 5/8 content).
6. **Discounting** — `DISCOUNT_OBLIGATION` lets the player sell a not-yet-matured receivable for immediate cash at a present-value haircut (1%/week) — a real financial trade-off, not free money. Verified live: a 102f loan receivable discounted early for 98f.
7. **Maturity ladder & insolvency** — `resolveMaturingObligations` (`sim/credit.ts`) runs every `ADVANCE_WEEK`: receivables pay in (prince loans may default), payables draw from cash first, then from a forced sale of any *docked* vessel's cargo at a 70% haircut (cargo under way is illiquid and can't be reached). If that still doesn't cover it, `insolvent` is set and the campaign ends — binary, no stopgap rescue (confirmed 2026-07-19): the design doc's rescue options (Medici support, marriage capital, branch sale) all depend on systems that don't exist until Phase 5/8, so inventing a stand-in would contradict the scope discipline already established in Phase 3. `LedgerPanel` (design doc's Ledger + Counting House screens, consolidated) shows cash, exchange rates, the next-12-weeks maturity ladder, and forms for all three instruments.

Also required, not originally itemised: extended the save-guard in `useGameLocal.ts` to discard pre-Phase-4 saves missing `exchangeRates`/`obligations`/`insolvent`; rounded all cash displays (`Math.round`) since interest math now produces fractional florins; `processAction` short-circuits to a no-op once `insolvent` is true, so the only way forward from the game-over screen is the existing reset flow.

Verified live in browser: borrowed 50f via a bill at London (8-week term, pound-denominated), sailed to London, bought 9 wool at 9f (leveraged past the starting 40f), sailed home to Bruges, sold the wool at 21f for 189f, watched the bill auto-settle in full from cash at week 8 with the ledger clearing to "Nothing due soon." Separately confirmed a merchant loan and its early discount, then deliberately over-leveraged (a 200f bill with all cash lent away and no cargo to liquidate) to trigger the insolvency screen, and confirmed "Start a new campaign" resets cleanly to 40f/week 0. `tsc --noEmit` and `vite build` both clean.

No characters, no branch network, no condotta contracts, no reputation-gated deposit runs, no AI houses. Those remain Phase 5+. **Do not start Phase 5 — stop here per instructions.**

---

## Phase 5 — Done

Deliverable: **assign officers to postings and watch loyalty, Conscience, and the assignments themselves materially change trade, credit, and information outcomes — then neglect the household and watch it cost you.** Verified live in browser.

Section 12 gives Phase 5 no explicit "Playable:" sentence the way Phases 1-4 have one; the deliverable above was written to match that pattern, scoped tightly to §7's own feature list (roster, skills, postings, loyalty, Conscience) rather than inventing scope Phase 12 doesn't ask for. The three judgement calls behind it are recorded as implementation notes in `banco-di-niccolo-design.md` (Section 7): the Chapter 1 roster is seeded at campaign start rather than staggered by chapter-script join dates (that scripting is Phase 6+ content); the assignment loop's four postings map onto systems that already exist (aboard/negotiate/investigate) and skip the one that doesn't yet (manage branch); and loyalty-driven departure is a new generic mechanic, explicitly distinct from the scripted, unpreventable deaths (Marian, Katelina, Godscalc, Umar) this section already promises for later chapters.

1. **Roster** — authored `packages/niccolo/src/content/characters/chapter1.json`: the six officers already with the Charetty company in the earliest chapters of Book 1 — Marian de Charetty (owner), Julius (notary), Tobias Beventini (physician), Father Godscalc (chaplain), Gregorio of Asti (lawyer), Astorre (condottiere) — each with the `law/trade/combat/intrigue` skills from §7's own data model, a starting loyalty, a weekly salary (0f for Marian, the owner; 2-6f for the rest), and `status: 'active'`. Total starting upkeep is 19f/week against a 40f starting stake — deliberately real pressure, per the same "cash is small and dangerous" pillar Phase 2 established.
2. **Assignments** — new `CharacterAssignment` union (`idle | aboard | negotiate | investigate`) and `ASSIGN_CHARACTER` action. `sim/characters.ts` computes each assignment's effect from the assigned officer's skill: **aboard** a vessel gives that vessel's `BUY_GOOD`/`SELL_GOOD` trades a trade-skill discount (cheaper buys, dearer sells, capped at 5%); **negotiate** at a city gives a law-skill discount to the per-week rate on any bill, deposit, or loan written there (capped at 50% off, verified live: Julius negotiating at Bruges is baked into the bill/loan/deposit rate at that city); **investigate** at a city gives an intrigue-skill cut to that city's news latency (`news.ts`'s `currentLatencyFor` now takes `characters` and stacks the cut with paid courier investment) — verified live: assigning Tobie (intrigue 3) to investigate London cut its latency from 2 weeks to 1 and correctly flipped its courier-investment button to "Fastest". `manage branch` is not implemented — no branch network exists yet (§5, gated behind Phase 8+).
3. **Loyalty and weekly upkeep** — `resolveWeeklyUpkeep()` runs every `ADVANCE_WEEK` alongside `resolveMaturingObligations`: if cash covers the whole active roster's salaries, everyone is paid and loyalty ticks up by 1; if it doesn't, nobody is paid (no partial pay, no back-pay debt on the maturity ladder) and loyalty drops by 4 for everyone active. A character whose loyalty reaches zero leaves the company permanently and their assignment reverts to idle. Verified live: with cash at 5f against 19f in wages due, advancing a week dropped every active officer's loyalty by exactly 4 (e.g. Marian 90→86, Julius 70→66) and left cash untouched.
4. **Conscience** — a single `conscience: number` (0-100, starts at 100) on `GameState`. The one wired trigger in Phase 5 is `WRITE_LOAN` with `kind: 'prince'`: it costs 5 Conscience and 3 loyalty each for Godscalc and Tobie by name (matching §7's own "affects Godscalc/Tobie loyalty" sentence), regardless of whether the prince later defaults. Verified live: writing an 85f prince loan dropped Conscience from 100 to 95 and Godscalc/Tobie's loyalty from 85/75 to 82/72, while Marian/Julius/Gregorio/Astorre were untouched.
5. **Household screen** — new `HouseholdPanel` (design doc's UI screen 5): roster with skills, loyalty (colour-coded), salary, current assignment in plain English, and a single combined dropdown to reassign (idle / aboard a vessel / negotiate at a city / investigate at a city — investigate is hidden for Bruges, since its latency is already 0). Header shows a running Conscience total; the panel shows total wages due next week and whether they're currently covered. `DispatchesPanel` now names whichever officer is investigating a city inline with its latency figure.

Also required, not originally itemised: extended the save-guard in `useGameLocal.ts` to discard pre-Phase-5 saves missing `characters`/`conscience`; threaded `characters` through `generateNews`/`currentLatencyFor`/`canInvestFurther` (all default to `[]` so nothing else calling them needed updating); `credit.ts`'s `writeBill`/`takeDeposit`/`writeLoan` all now apply the negotiate discount at their respective city (bills at their destination city, deposits/loans always at home) before computing the obligation amount.

Verified live in browser: assigned Julius to negotiate at Bruges and confirmed a bill written there executes without error under the discounted spread; assigned Tobie to investigate London and watched its report latency drop from 2 weeks to 1 and its courier-invest button switch to "Fastest"; assigned Marian aboard the Charetty ship and confirmed a wool purchase's cost dropped from an undiscounted 20f to a discounted-and-rounded 19f (read directly off the "not enough cash" error message); wrote an 85f prince loan and watched Conscience fall 100→95 with Godscalc and Tobie's loyalty falling 3 points each while the rest of the roster was untouched; then, with cash too low to cover the 19f weekly payroll, advanced a week and watched every active officer's loyalty drop by 4 uniformly. Reset the campaign to a clean state (40f, week 0, conscience 100) afterward. `tsc --noEmit` and `vite build` both clean.

No branch network, no condotta contracts as a live asset, no chapter-scripted join dates or scripted deaths, no AI houses. Those remain Phase 6+ (event engine), Phase 7 (Chapter 1 content pack), and Phase 8 (AI houses). **Do not start Phase 6 — stop here per instructions.**

---

## Phase 6 — Done

Section 12 gives Phase 6 no explicit "Playable:" sentence either (its own line is "Author 10 test events"), so the deliverable is scoped tightly to that and to §8's own feature list, following the same pattern Phase 5 used: **data-driven events fire on schedule, chain off each other's flags, and interrupt play with a real choice that changes cash, Conscience, or the flag state — proven with 10 authored test events, not narrated Chapter 1 content.** Verified live in browser.

1. **Event data model** — `ScriptedEvent`/`EventTrigger`/`EventChoice`/`EventEffects` (`packages/niccolo/src/sim/types.ts`) match §8's own JSON shape: `id`, `chapter`, `trigger` (`dateAfter`/`location`/`flag`, all optional and AND-combined), `title`, `body`, `choices[].{text, effects}`. Content lives entirely in `packages/niccolo/src/content/events/chapter1.json` — logic never inspects a hardcoded event id beyond the engine's own bookkeeping.
2. **Triggers** — `sim/events.ts`'s `triggerMatches` checks the in-game clock (`dateForWeek` against `trigger.dateAfter`), whether any vessel is docked at `trigger.location`, and whether `trigger.flag` is already set in `GameState.flags`. `checkTriggers` runs once at campaign start and once after every `ADVANCE_WEEK`, queuing any newly-satisfied, not-yet-fired-or-pending event onto `pendingEvents`.
3. **Choices and effects** — `resolveEvent` (new `RESOLVE_EVENT` action) pops the front of `pendingEvents`, applies the chosen effect (`flag` sets a flag permanently, `cash` deltas the florin balance, `conscience` deltas the meter, clamped 0-100), and records the event id in `firedEvents` so it can never fire again.
4. **Flags** — `GameState.flags: Record<string, boolean>`, set only by event effects, readable only by later event triggers — the chaining mechanism. Two of the 10 test events demonstrate a chain: refusing a shortcut (`refused_shortcut`) unlocks a follow-up reward the week after (`reputation_probity`); paying for a dockside tip (`dockside_tip`) unlocks its payoff (`tip_paid_off`).
5. **Interruption** — while `pendingEvents` is non-empty, `processAction` blocks every action except `RESOLVE_EVENT` (mirroring the existing `insolvent` short-circuit), and only the front of the queue can be resolved — one scripted scene at a time, per pillar 3 ("victories cost more than defeats... interrupts commercial positions").
6. **10 test events** — authored in `content/events/chapter1.json` (`ev_c1_001` through `ev_c1_010`), spanning March–October 1460: pure date triggers, date+location triggers (Bruges, London, Venice), and the two flag-gated chains above, exercising all three trigger fields and all three effect fields the engine supports.

Also required, not originally itemised: extended the save-guard in `useGameLocal.ts` to discard pre-Phase-6 saves missing `flags`/`firedEvents`/`pendingEvents`; built `EventOverlay` (design doc's UI screen 8) as a full-screen modal card (title, body, one button per choice) and wired it into `App.tsx` above everything else when `state.pendingEvents[0]` resolves to a known event; created `.claude/launch.json` so the niccolo dev server can be previewed (`npm run dev --workspace niccolo`, port 5174) — it didn't exist yet.

No `rep.*` house-reputation effects (no AI houses to hold a reputation with — Phase 8), no scripted deaths/departures, no Chapter 1 narrative content — those remain Phase 7 (content pack) and Phase 8 (AI houses). The scope judgement calls (effects limited to flag/cash/conscience; trigger evaluation on the weekly tick, not instantly on flag-set) are recorded as an implementation note in `banco-di-niccolo-design.md` (Section 8).

Verified live in browser: on a fresh campaign, "A ledger left open" (dateAfter 1460-03-01, location Bruges) fired immediately at week 0 and blocked the rest of the UI until resolved; chose "Take his word for it" (conscience +1, clamped at the 100 ceiling). Advanced three weeks to 4 April 1460 and watched "The dyeworks apprentice" fire on schedule; chose "Refuse — the vats are done properly" (sets `refused_shortcut`). Advanced one more week and confirmed the chained "Word gets around" fired only now (not the same tick the flag was set), paying out +10f on the queue's single choice, cash rising from 2f to 12f. Confirmed normal play (buy/sell, dispatch, household, ledger) was inert while an event card was up and resumed the instant it was resolved. Reset the campaign afterward. `tsc --noEmit` and `vite build` both clean.

---

## Decisions needed from you

None outstanding. Phase 6's two scope judgement calls (effects limited to flag/cash/conscience; weekly-tick trigger evaluation) follow the same scope-discipline precedent as every prior phase and are recorded as an implementation note in `banco-di-niccolo-design.md` (Section 8).

Phase 5's three scope judgement calls (roster seeding, assignment-to-system mapping, Conscience trigger) were made under the same scope-discipline precedent as Phases 3/4 — no invented stand-ins for systems that don't exist yet — and are recorded as implementation notes in `banco-di-niccolo-design.md` (Section 7).

Three Phase 4 scope questions were flagged for your input and confirmed on 2026-07-19 — all are now recorded as implementation notes directly in `banco-di-niccolo-design.md` (Section 5) rather than left as open questions:

1. Multi-currency uses 5 currencies grouped by `City.power` (florin/groot/pound/écu/ducat), not the design doc's full historical set — several of which (Ottoman/Mamluk coin) have no city in the Chapter-1 map yet.
2. Bills of exchange have no branch gating in Phase 4 — any city can be used — since the branch network is Phase 5+ content gated behind a manager character.
3. Insolvency is binary (forced haircut sale, then game over) rather than adding a stand-in rescue lever, since the design doc's actual rescue options (Medici support, marriage capital, branch sale) all depend on Phase 5/8 systems.

Two Phase 3 judgement calls were confirmed on 2026-07-19 and are recorded in Sections 4 and 6 of the design doc:

1. News latency is shortest-path over any route (land or sea), not just the land-only courier network Phase 1's dispatch-rider uses.
2. Background price drift (±0.08/week, independent of the player's trades) is confirmed as the intended reading of the design doc's "scarcity drifts with simulated supply flows between nodes" — the magnitude stays a placeholder pending a feel-check once Chapter 1's content pack (Phase 7) lands.

The audit verdict (sibling app, no shared engine) is recorded in `AUDIT.md` for reference.

---

## Session log

### 2026-07-19 — Phase 0
- Pulled latest TM commits from origin/main (was 2 commits behind).
- Completed all 5 Phase 0 tasks.
- No Phase 1 work started.

### 2026-07-19 — Phase 1
- Added `@repo/engine` as a declared dependency of `packages/niccolo` and ran root `npm install` to create the workspace symlink (Phase 0 had left it undeclared).
- Added clock utilities to `packages/engine`.
- Authored the 12-city Chapter 1 map and its 13 routes as JSON content files.
- Built the sim core (types, initial state, pure reducer), the local-storage save hook, the SVG map view, and the App shell (clock display, vessel list, dispatch-by-clicking-a-lit-city, advance-week button, reset button).
- Verified end-to-end in the browser: dispatched the ship Bruges → Venice, advanced 8 weeks, confirmed arrival and date math, confirmed save persists across reload, confirmed the courier is blocked from sea routes.
- `tsc --noEmit` and `vite build` both clean.

### 2026-07-19 — Phase 2
- Authored 8 goods and extended all 12 cities with per-good base market prices as JSON content.
- Added `BUY_GOOD`/`SELL_GOOD` actions, cargo + capacity on `Vessel`, and a scarcity-based price/drift model (`sim/market.ts`) to the sim core.
- Built `MarketPanel` and wired cash/cargo display into the App shell.
- Added a defensive check to discard pre-Phase-2 saves missing the new fields instead of crashing on them.
- Verified end-to-end in the browser: bought wool cheap in London, sold it dear in Bruges for a 40f profit, bought cloth with the proceeds, confirmed prices move with trades and confirmed the save (including cargo and cash) survives a page reload.
- `tsc --noEmit` and `vite build` both clean.

### 2026-07-19 — Phase 3
- Added `NewsItem`, `pendingNews`, `knownPrices`, `courierInvestment` to the sim types and state.
- Built `sim/news.ts`: Dijkstra-based latency-from-Bruges per city (over all routes, not just land), weekly news generation, arrival resolution, and courier-investment cost/floor logic.
- Added `applyBackgroundFlows()` to `sim/market.ts` — small weekly random drift independent of the player's own trades, so stale reports can actually be wrong by the time they arrive.
- Added the `INVEST_COURIER` action and wired news generation/arrival into `ADVANCE_WEEK`.
- Built `DispatchesPanel` (per-city report age, next-arrival week, latency, invest button) and wired it into the App shell; added information-age fog to `MapView`.
- Extended the save-guard to discard pre-Phase-3 saves missing the new fields.
- Verified end-to-end in the browser: confirmed the week-0 fog-of-war baseline (only Bruges live), watched near-city reports arrive on schedule, invested in London's courier line and watched its latency and button state update, sailed to Dijon and confirmed the true dockside price had drifted from base under background flows the player couldn't see coming, and confirmed the save (news queue, courier investment) survives a page reload. Reset the campaign to a clean state afterward.
- `tsc --noEmit` and `vite build` both clean.

### 2026-07-19 — Phase 4
- Flagged 3 scope questions before starting (currency set, bill gating, insolvency rescue) — all confirmed with the recommended option.
- Added `CurrencyId`/`Currency`/`ExchangeRates`/`Obligation` types; gave every Chapter-1 city a `currency` field grouped by `power`.
- Built `sim/currency.ts` (5 pegged currencies, weekly mean-reverting drift) and `sim/credit.ts` (bills, deposits, loans, discounting, maturity resolution, forced-liquidation insolvency logic).
- Wired `WRITE_BILL`/`TAKE_DEPOSIT`/`WRITE_LOAN`/`DISCOUNT_OBLIGATION` actions; extended `advanceWeek` to drift exchange rates and resolve maturing obligations before price drift each week; gated `processAction` to a no-op once `insolvent`.
- Extended the save-guard for the new fields; rounded cash displays for fractional-florin interest math.
- Built `LedgerPanel` (balance sheet, maturity ladder, currency rates, all three instrument forms) and wired it into `App.tsx`, including an insolvency game-over screen.
- Verified end-to-end in the browser: borrowed against a bill, leveraged the proceeds into a profitable wool run, watched the bill auto-settle from cash at maturity with FX drift affecting the exact amount owed, confirmed loan-out and early discounting, then deliberately triggered insolvency (over-leveraged with no liquid cargo) to confirm the game-over screen and reset flow, and reset to a clean campaign afterward.
- `tsc --noEmit` and `vite build` both clean.

### 2026-07-19 — Phase 5
- Authored the six-officer Chapter 1 roster (Marian, Julius, Tobie, Godscalc, Gregorio, Astorre) as JSON content, each with skills, loyalty, salary, and a starting `idle` assignment.
- Added `Character`/`CharacterAssignment` types, `GameState.characters`/`conscience`, and the `ASSIGN_CHARACTER` action.
- Built `sim/characters.ts`: `assignCharacter`, `negotiateDiscount` (law skill → credit-rate discount), `investigateLatencyBonus` (intrigue skill → news-latency cut), `tradeBonus` (trade skill → buy/sell price edge), `resolveWeeklyUpkeep` (salary payment, loyalty drift, loyalty-zero departure), and `applyConscienceCost` (Conscience spend + Godscalc/Tobie loyalty penalty).
- Wired all four into the existing systems rather than inventing new ones: `news.ts`'s latency functions and `credit.ts`'s bill/deposit/loan writers now take `characters` into account; `actions.ts`'s `buyGood`/`sellGood` apply the trade bonus and `advanceWeek` runs weekly upkeep; `WRITE_LOAN` with `kind: 'prince'` now costs Conscience.
- Built `HouseholdPanel` (roster, skills, loyalty, salary, a combined assignment dropdown per officer, Conscience/wages summary) and wired it into `App.tsx`; added a Conscience readout to the header; taught `DispatchesPanel` to name an investigating officer inline with a city's latency.
- Extended the save-guard for `characters`/`conscience`.
- Verified end-to-end in the browser: negotiated a bill's rate down via Julius at Bruges, cut London's report latency in half by assigning Tobie to investigate there (confirmed against the courier-investment button switching to "Fastest"), watched a wool purchase get cheaper with Marian aboard the ship, wrote a prince loan and watched Conscience and Godscalc/Tobie's loyalty fall while the rest of the roster was untouched, then starved the payroll on purpose and watched every active officer's loyalty drop uniformly on the next `ADVANCE_WEEK`. Reset the campaign to a clean state afterward.
- `tsc --noEmit` and `vite build` both clean.

### 2026-07-19 — Phase 6
- Added `ScriptedEvent`/`EventTrigger`/`EventChoice`/`EventEffects` types and `GameState.flags`/`firedEvents`/`pendingEvents`; added the `RESOLVE_EVENT` action.
- Built `sim/events.ts`: `triggerMatches` (date/location/flag, AND-combined) and `checkTriggers` (queues newly-satisfied events, never refires a fired one) and `resolveEvent` (applies the front-of-queue choice's effects, marks it fired).
- Wired `checkTriggers` into `createInitialState` and the end of `advanceWeek`; `processAction` now blocks every action except `RESOLVE_EVENT` while an event is pending, mirroring the existing `insolvent` short-circuit.
- Authored 10 test events as JSON (`content/events/chapter1.json`), including two flag-gated chains, to exercise every trigger and effect field without writing any Chapter 1 narrative content.
- Extended the save-guard for the new fields; built `EventOverlay` (title, body, one button per choice, full-screen modal) and wired it into `App.tsx`.
- Created `.claude/launch.json` (it didn't exist yet) so the niccolo dev server could be previewed for verification.
- Verified end-to-end in the browser: a week-0 date+location event fired and blocked the UI immediately on a fresh campaign; a second date-triggered event fired on schedule three weeks later; refusing its shortcut choice set a flag whose chained follow-up event fired only on the *next* week's tick (not instantly), paying out cash on resolution; confirmed normal play was inert while an event card was open and resumed immediately after resolving it. Reset the campaign afterward.
- `tsc --noEmit` and `vite build` both clean.
