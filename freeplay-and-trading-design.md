# Free-play mode, an AI opponent, and three trading features

Companion to `banco-di-niccolo-design.md`. Written 2026-07-30, in response to: *"please can you build
out both, we should also start thinking about an AI to play against in a non story mode, as well as
being able to add extra ships and grow your fleet."*

**Status, updated 2026-08-23. All four parts are built.** Part 1 as Phase 27 (free play, rivals
wired into `advanceWeek`, standings, a win condition), Part 2 as Phase 26 (warehousing), Part 3 as
Phase 23 (cycling market events), Part 4 as Phase 28 (fleet growth). This document is now a build
record rather than a plan.

Read the Phase 27 note under Part 1 before touching the opponent: wiring it required threading the
demand layer and `sellProceeds` through every price it reads, and the driver then found — and the
code now fixes — an inversion where *staler* information beat fresher information 23 seeds out of 24.

---

## Part 1 — Free-play mode and a real opponent

### The problem with the houses we have

`sim/houses.ts`'s AI is ambient scenery, not a competitor. `applyHouseTradeFootprint` picks a random
good at each house's home city and nudges scarcity ±3 units. A house has **no cash, no ships, no
cargo, no ledger** — the "reduced fidelity" model. It cannot be beaten or outmanoeuvred because it
isn't playing. An opponent worth the name needs real state and a real policy.

### The core decision: difficulty is information, never cheating

An AI trader never reads live prices. It acts on `remembered` — its own cache of what a city's prices
were when it last had word from there — and `reportLagWeeks` sets how stale that cache may get. A
harder opponent gets **fresher reports and more capital**; it never gets hidden knowledge, never
ignores travel time, and never trades at a price the player couldn't also get.

This isn't only fairness. It makes the opponent an expression of the game's own subject (§3,
information asymmetry): a player who invests in couriers is buying a real edge *over the AI*, not
merely over the map. It also means one dial produces the whole difficulty curve without a single
special case.

**Three rules the AI shares with the player, verified rather than assumed:**

1. Its selling calls the same `adjustScarcity`, so an AI dumping cargo really does depress that
   market — competition is *felt* as prices moving under you.
2. Its buying moves no price at all, preserving exactly the asymmetry `buyGood` established to close
   the buy/sell round-trip exploit. An opponent on different price mechanics would be a separate
   simulation sharing a map, not a rival.
3. It can only trade a market it has **reached**. Unknown cities stay unknown at any lag, so it must
   explore to build the map it then trades on.

### What the skeleton already proves

A seeded scripted driver (deterministic LCG replacing `Math.random`, 80 simulated weeks, background
flows and drift running exactly as `advanceWeek` applies them) established, 11/11:

| Claim | Result |
|---|---|
| It really trades and compounds | 600f → 3270f over 80 weeks, 77 buy/sell actions |
| **Fresher information alone wins** — identical cash *and* capacity, only `reportLagWeeks` differs | 2-week lag x5.203 vs 10-week lag x4.481, winning **12/12 seeds** |
| A bigger ship is an upgrade | 30-capacity beat 12-capacity on **10/12 seeds** |
| Its sales hit the player's market | London cloth 45f → 37f on one sale |
| Its buying moves no price | confirmed across every Bruges good |
| It never acts on knowledge it lacks | with empty memory it explores instead of inventing a destination |

**Three real bugs the driver caught, each of which had falsified a claim I had already written down:**

- **Accidental omniscience.** The first `refreshAiKnowledge` refreshed every city whose memory was
  merely *stale*, so a trader with empty memory instantly learnt the entire map's live prices — the
  exact cheating the model exists to forbid. Unknown cities must stay unknown; exploration is what
  bootstraps knowledge.
- **Capacity was a penalty.** An unmetered trader empties its hold into one market, driving
  `adjustScarcity` into its 0.5 floor and realising a fraction of the expected price. A 30-unit ship
  *lost to* a 12-unit ship on 9 of 12 seeds. Fixed by metering sales (`MAX_UNITS_SOLD_PER_WEEK = 6`,
  capping the self-inflicted hit near 18%) and capping single-good loads at what a market can absorb
  (`ABSORBABLE_UNITS = 18`), with spare hold filled by *diversifying* into other goods the same
  destination buys.
- **A double-load bug that was hiding both signals.** `marketGoodsAt` re-includes the chosen good, so
  the diversification pass bought it twice, piling one good past the absorption cap. Fixing this one
  line moved fresher-information from 8/12 to **12/12** seeds and capacity from 3/12 to **10/12**.
  Worth remembering: a single quantity bug can make a whole design model look wrong.

### Free-play mode — built, Phase 27

- `createInitialState` gains a mode: `'campaign' | 'freeplay'`. Free-play skips all chapter content —
  no events, no objectives, no chapter freeze in `processAction` — opens the whole map from week one,
  and seeds cash plus one ship.
- Seed 1–3 `AiTrader`s from `AI_PROFILES` (`cautious` / `steady` / `ruthless`, differing only in
  capital, capacity and lag). Store as `GameState.aiTraders?: AiTrader[]` — optional, so no
  migration and no `isCurrentShape` change, matching every recent field.
- Call `resolveAiWeek` per trader inside `advanceWeek`, threading `scarcity` through each in turn,
  **before** `deriveMarketCauses` so their trades can be named in the price narration. Add a
  `PriceCauseKind: 'rival_trade'` (or reuse `house_trade` with the trader's name) and the existing
  Phase 16 pipeline explains the competition for free.
- **A goal is required, or free-play is aimless.** `aiNetWorth` already computes the standings figure.
  This brushes against the documented "no ambient net-worth/score display" decision — but that
  decision was about the *story campaign*, where a permanent visible number becomes a de facto win
  condition and undermines "no scripted victory". In an explicitly competitive sandbox, standings are
  the entire point. Different context, not a reversal — but say so in `PROGRESS.md` when building it,
  so it doesn't read as quietly overturning a prior call.
- Suggested win conditions, pick one: first to N florins; highest net worth at a fixed year; or last
  house solvent.

> **Phase 27 implementation, confirmed 2026-08-23.** Free play ships as a mode flag on the same
> reducer, not a second one (`GameState.mode`): the scripted layer is *absent* rather than
> suppressed — `advanceWeek` skips `checkTriggers` entirely, so no chapter event can enter
> `pendingEvents`. That branch is load-bearing: a free-play game is created with
> `chapter0_complete` set, because that flag is what unlocks wages and warehousing, and Chapter 1's
> opening event triggers on exactly that flag. Without it the sandbox opened with Marian handing
> Claes a dyeworks contract.
>
> **The three fairness rules are now true rather than merely claimed.** They were not, before this
> phase. `aiTrader.ts` called `priceAt` without `events`, so it remembered and traded on
> `base × scarcity` — prices with the demand layer omitted, which **no player can transact at** —
> and it sold at snapshot-times-quantity, which after Phase 26 was a systematically *better* price
> than the player gets for the identical trade. Both are threaded through now, embargoes included,
> and each is pinned by a driver assertion that compares the rival's realised proceeds against
> `sellProceeds` directly.
>
> **The difficulty model needed two real fixes, and one claim did not survive.** Measured over 150
> seeds:
> - *Fresher information alone wins* — **116/150**. But only after two fixes. `bestPlanFor` scored
>   runs at a flat believed sell price it could no longer realise, so thin margins became
>   loss-making and a sharper-informed trader, seeing *more* of those, over-traded on them
>   (`SALE_IMPACT_FACTOR` now prices the trader's own impact from `SCARCITY_STEP`). And, more
>   surprising: with exploration as the only fallback, a well-informed trader that had just crushed
>   its own market saw that accurately, found no positive margin, and **sat**, while an ignorant one
>   still believed the old price and traded anyway. **Staler information won 23 of 24 seeds** —
>   accuracy punished with idleness. `sailTowardBestKnownMarket` is the fix: relocate toward a market
>   you *know* is better rather than idling.
> - *The three shipped profiles are ordered in strength* — ruthless > steady **150/150**, all three
>   ordered **149/150**. This is what the player actually meets, and it holds cleanly.
> - *A bigger ship is an upgrade* — **does not survive honest pricing.** The old figure (10/12) was
>   measured when a large load sold at one untouched snapshot price. Hull beyond what a market can
>   absorb and what cash can fill now buys mostly time in port; a 30-unit hull merely stays within
>   25% of a 12-unit one (60/60). The same diminishing return shows in capital — the cautious trader
>   compounds at a *higher multiple* than the ruthless one and still never catches it in absolute
>   terms. Recorded as a known limit rather than quietly re-asserted.
>
> **On the visible score.** §11 and Phase 15 rejected an ambient net-worth readout, and Phase 25
> deferred the real figure to the epilogue. The standings panel is gated on `mode === 'freeplay'`
> and the campaign's rule is untouched — different context, not a reversal, exactly as this section
> asked to have stated when built.
>
> **The win condition does not stop the clock.** First past 8,000f is recorded in `freeplayWonWeek`
> and announced; play continues. A campaign ends because its story has; a sandbox has no story to
> end, and freezing it the week a rival crosses the line would take the board away from a player
> 200f behind and about to pass them.

### Deliberately out of scope

Networked multiplayer (still explicitly scoped out). AI houses gaining ledgers/loans/agents — the
opponent trades; it does not bank or run intelligence. AI use of grades or warehousing until those
are the player's own settled mechanics.

---

## Part 2 — City warehousing — built, Phase 26

**Purpose.** Decouple buying from selling *in time*: store goods and sell when the price recovers,
instead of being forced to dump a full hold at once. Also relieves "my hold is full."

**`WarehouseStock` never existed** — it was only ever a design-doc phrase. So the "graded lots have
nowhere to go" gap flagged earlier is *not* a retrofit; design it grade-aware from the first line by
reusing the exact `Vessel.cargoGrades` shape, and `gradeHeld`/`addGrade`/`removeGrade`/`gradeBreakdown`
from `sim/grades.ts` work on a warehouse unchanged.

```ts
interface Warehouse {
  cityId: string;
  capacity: number;
  cargo: Cargo;
  grades?: Record<string, Partial<Record<'fine' | 'excellent', number>>>; // same shape as Vessel
}
// GameState.warehouses?: Record<string, Warehouse>  — optional, no migration
```

- Actions: `LEASE_WAREHOUSE`, `STORE_GOOD`, `WITHDRAW_GOOD`, `EXPAND_WAREHOUSE`.
- Weekly rent per leased warehouse, drawn in `advanceWeek`'s upkeep so storage is a real ongoing cost
  and feeds the existing insolvency path.
- **Storing and withdrawing must not touch `adjustScarcity`.** They are not market transactions. Only
  real buy/sell moves price — that is what keeps the exploit fix intact.
- Exploit re-check: buy (no price move) → store → sell later at a recovered price is *not* free money,
  because selling still depresses and buying still doesn't lift. Metering sales across weeks to avoid
  crashing a market is legitimate strategy — it is the intended new lever, and it is exactly what the
  AI now does too.
- Deliberately deferred: warehouse sabotage. `resolveHouseSabotage` targets docked vessels; a
  warehouse at a hostile house's home city is a natural future target, not a v1 concern.

> **Phase 26 implementation, confirmed 2026-08-23.** Built as specified, and grade-aware from the
> first line as this section asks — `Warehouse` reuses `Vessel`'s exact `cargo` + `grades` shape, so
> `sim/grades.ts` operates on a shed unchanged. 30f to lease, 20 units, 2f/week, three 15-unit bays
> to a hard ceiling of 65. Store/withdraw touch `adjustScarcity` in neither direction, and a driver
> shuffles one lot in and out thirty times to prove it. Unpaid rent lapses the lease (the
> `resolveWeeklyUpkeep`/`resolveWeeklyConvoy` precedent) with the contents sold at half price, which
> is always worse than selling properly — **except** for a good under a `guild_embargo`, which
> returns nothing, or a deliberate lapse would be a way to sell into a market an event had closed.
>
> **This section's stated purpose could not be delivered without an engine fix it did not anticipate.**
> "Instead of being forced to dump a full hold at once" assumed dumping was punished. It was not:
> `sellGood` priced the whole quantity at one pre-trade snapshot and applied the scarcity hit
> afterwards, so sixteen units all sold at the untouched price and the crash only landed on the
> *next* sale. Metering returned exactly what dumping did, to the florin — which is how the driver
> found it. The same snapshot also *punished* splitting a sale (two eights fetched less than one
> sixteen), which is the identical mistake `buyGood` records fixing on the buy side in the Phase 16
> era; nobody had looked at the sell side. `market.ts`'s new `sellProceeds` applies the impact across
> the quantity, unit by unit. **Anything added here that prices a quantity must go through it** —
> including `resolveAiWeek` when Part 1 is finally wired, or the opponent will be trading in a market
> model the player no longer plays in.
>
> Deferred as this section says: warehouse sabotage. Storing goods does currently dodge
> `resolveHouseSabotage`, which only targets docked vessels — a real asymmetry, and the natural shape
> of that future feature.

## Part 3 — Cycling market events — built, Phase 23

**Purpose.** Which cities want which goods should shift over time, "Ocean Trader" style, without
losing the campaign's voice.

**Key structural decision: a separate demand layer, not scarcity.** Writing demand into
`MarketScarcity` would have `driftScarcity` mean-revert it away within a few weeks. So:

```
priceAt = base × scarcity × demand
```

- New `sim/marketEvents.ts` plus `ActiveMarketEvent { id, cityId, goodId, multiplier, endsWeek }` on
  an optional `GameState.marketEvents?`.
- Authored as **content** (`content/marketEvents/*.json`) with thematic text, drawn at random — not
  procedural noise. Kinds that fit the setting: `festival_demand` (a doge's wedding, spices dear for
  six weeks), `harvest_glut`, `guild_embargo` (a good untradeable at that city for N weeks),
  `war_scare` (a whole city swings).
- **Hooks straight into Phase 16**: add `PriceCauseKind: 'demand_shift'` and the existing narration
  explains it — *"Spices are dear at Venice; the doge's wedding has the whole city buying."*
- Must be visible somewhere the player looks: a market-news line plus a marker on the affected row,
  or it reads as unexplained numbers moving.

## Part 4 — Fleet growth — built, Phase 28

- `BUY_VESSEL` / `SELL_VESSEL` at named shipyards — reuse the `canInsureAt` precedent (a short list of
  cities) rather than allowing it at every port.
- Vessel classes as content (`content/vesselTypes.json`): cog (cap ~20), carrack (~40, slower),
  galley (small, fast). Cost, weekly upkeep, and a **speed multiplier** applied in `dispatchVessel`
  (`weeksRemaining = ceil(distanceWeeks × speed)`) so class choice means more than capacity.
- Per-vessel weekly upkeep in `advanceWeek`, so an overlarge fleet genuinely hurts.
- Free: `resolveVoyageRisk`, `resolveHouseSabotage` and `resolveWeeklyExpedition` all iterate vessels
  generically, so extra ships need no changes there.

> **Phase 28 implementation, confirmed 2026-08-23.** Built as specified. Four classes in
> `content/vesselTypes.json`, `SHIPYARD_CITY_IDS` following the `canInsureAt` precedent this section
> asks for by name, and the speed multiplier applied in `dispatchVessel`. The "Free:" line above held
> exactly — a five-hull fleet run for a year through the real pipeline needed no change to any of
> those three resolvers.
>
> **`Vessel.typeId` is optional, and absent is meaningful.** `ship_1`, `courier_1` and every hull an
> `EventEffects.grantVessel` hands over have no class: they sail at exactly the speed they always
> did and cost no upkeep. That is what makes this additive rather than a migration, and it means a
> chapter can keep granting hulls without knowing the shipyard exists.
>
> **A convoy sails at its slowest member's pace.** Without that, mixing a galley and a carrack would
> have them arrive on different weeks — silently undoing the only reason `Convoy` exists.
>
> **Unpaid upkeep lays a hull up rather than repossessing it**, and only one hull a week, dearest
> first. Losing a 520f carrack over an 8f shortfall would be a punishment out of all proportion, and
> it would remove the player's ability to earn it back. Laying up clears the class: she still sails
> and still carries, at ordinary speed, and costs nothing. A real, legible loss that cannot spiral.
>
> **Two bugs worth recording.** The driver caught that deriving a new hull's id from the *current*
> fleet recycles ids after a sale — and `vesselIdAt` names ids in content, so a recycled id would
> let a hull that never made the voyage satisfy another chapter's trigger, reintroducing the very
> bug pinning ids was meant to fix. A high-water mark (`GameState.vesselSeq`) fixes it. And reading
> the live panel caught that pricing every untyped hull off the cog valued the house's dispatch
> rider at 132f when a new courier costs 90f — free money, so untyped hulls are now valued as the
> cheapest class of their **own kind**.
>
> **Hulls count as assets** in the free-play standings, on both sides, and in the epilogue. Without
> that, converting cash into a carrack read as a 520f loss and the mode would have punished the
> exact growth this section adds.

### ⚠ Fleet growth introduces a live regression — fix it in the same change

> **RESOLVED, and the warning below was already out of date when Phase 28 came to it.** Every
> `vesselKindAt` trigger had been migrated to `vesselIdAt` back in Phase 20, so the specific bug
> described here could no longer happen — a driver assertion now holds that line (zero
> `vesselKindAt` triggers remain in content, checked against `EVENTS` rather than a hardcoded list).
>
> **The live hazard was the mirror image of it.** Four triggers across Chapters 4, 5 and 7 name
> `ship_1` *by id*, precisely because pinning the hull was the fix for the bug below. Fleet growth
> makes that hull sellable — and a by-id-only check would then leave three chapters permanently
> unsatisfiable. Fixed twice over, because a soft-lock is the worst class of bug this game can have:
> `sellVessel` refuses any hull carrying live scripted business (under way, loaded, in convoy,
> insured, on the expedition, or the last hull that can carry goods), **and** `vesselIdAt` degrades
> to a kind check when the named vessel no longer exists — the same "degrade rather than block
> forever" discipline `weeksAfterFlag` records, and it still will not fire on the ever-present home
> courier. The driver walks all four states: right hull right port, right hull wrong port, hull sold
> with a later ship there, and courier only.
>
> Kept below as written, because the reasoning is still the reason those triggers are pinned.

Chapter 4's homecoming event `ev_c4_022` triggers on
`vesselKindAt: { kind: 'ship', location: 'bruges' }`. That is correct **only while the player owns
exactly one ship.** The moment a second ship can be bought, a ship idling at Bruges satisfies the
trigger while the expedition is still at Timbuktu, firing `gambia_expedition_success` →
`gambia_epilogue` → the Gelis arc → `chapter4_complete` far too early.

This was predicted when `vesselKindAt` was introduced and is now a real hazard. Fleet growth must
narrow that trigger to the *specific* vessel that made the voyage — e.g. have `sim/expedition.ts`
(which already tracks the expedition vessel by id) record its homecoming, and trigger on that.
**Grep every `vesselKindAt` trigger before shipping fleet growth.**

---

## Sequencing, and why it matters here

All three specs touch `sim/types.ts`, `sim/state.ts`, `sim/actions.ts` and `pages/GameScreen.tsx`.
Chapter 5 was mid-build in those same files in a parallel session while this was written, which is
why nothing above was wired in. Build order:

1. Land Chapter 5 first, so those files have one owner.
2. **Warehousing**, then **fleet growth** (it needs the trigger fix above, which is easier once
   warehousing has already added its own actions and the pattern is fresh).
3. **Cycling market events** — self-contained apart from `priceAt` gaining its demand factor, which
   is a one-line change touching every price read, so do it when nothing else is in flight.
4. **Free-play + AI wiring** last. The engine exists and is tested; what remains is a game mode,
   which is mostly UI and lobby work rather than simulation.
