# The Tea Race — design

A digital clipper-trading race, after **Ocean Trader** (Clipper Games Ltd, 1988). Third game on the
portal, alongside Thrash Margin and Banco di Niccolò, sharing one deployment, one `users` table and
one JWT session.

- **Package:** `packages/tea-race/`
- **Path:** `/tea-race/`
- **DB discriminator:** `games.game = 'tea_race'`
- **Ruleset:** `classic` (the 1988 board). A second ruleset, `voyage`, is designed in §7 and
  deliberately not built.

---

## 1. What the original game is

Sourced in two passes, and the difference matters.

**Pass one (2026-08-02)** worked from published *descriptions* of the 1988 board — the skeleton
only. Everything the descriptions did not cover was authored from scratch and marked as such.

**Pass two (2026-08-05)** worked from the owner's own compiled rules manual for John Rudford's
Ocean Trader (1988), which is far more detailed. **It showed that six things I had invented to fill
gaps are in the real game, done differently.** Those are corrected, and the FAITHFUL/AUTHORED marks
throughout this document and in `src/sim/rules.ts` now reflect the fuller source.

What the real rules give:

- 2–6 players, each starting with one clipper at **Liverpool** and a bankroll of **£500–£1,000**.
- A world map of shipping lanes marked by **movement nodes**, one node = one movement point.
- **Every ship has exactly three cargo slots.** A full fleet of three ships carries nine.
- **Five commodity cards face up at all times.** Each locks one good to one source and one
  destination; selling to any other port is illegal.
- **Independent dice per ship** — movement points are not shared across a fleet.
- Exact rolls are not needed to dock, and **excess points are forfeited on arrival**.
- Ports have infinite capacity; ships never block one another.
- Payouts by arrival order: **4× the purchase price first, 2× second, nothing after.**
- **Speculation is legal** — buy goods no card calls for and hope one turns up. The source names the
  cost of guessing wrong the *speculation bottleneck*: spec cargo locks up a third to two thirds of
  a ship's capacity.
- **Dumping cargo returns exactly £0.** The whole purchase price is forfeit to the bank. There is no
  selling back.
- Up to **three ships** per player.
- **Ten shares**, paying no dividends, whose price **scales upward as the pool empties**,
  "preventing a wealthy player from buying a victory in a single turn".
- Holding 6+ shares lets you **declare**, which starts a **twelve-turn countdown**. The source calls
  this the **sabotage window**: "Opponents use this window to buy shares away from the leader."
- At the end of it the declarer must hold 6+ shares, **£750** and at least one ship. **If they fail
  they lose automatically**, and the player with the highest total asset value wins instead.

### What pass two corrected

| Rule | Pass one had | The source says |
|---|---|---|
| Cargo capacity | One lot per ship | **Three slots**, nine across a fleet |
| Dumping | Half price back at a port that wanted it | **£0, anywhere** |
| Share price | Flat £120 | **Scales as the pool empties** |
| A failed claim | Lapses; trading continues | **Declarer loses; highest assets wins** |
| The countdown | Leader's shares untouchable | **A sabotage window** — raid the leader |
| Starting capital | £250 | **£500–£1,000** (we use £600) |

The three-slot hull was the most consequential. Pass one's single-lot ship made every voyage a
there-and-back errand, which is precisely the "flat gameplay" the owner reported. Three slots turn a
voyage into a routing puzzle and give the speculation bottleneck something to bite on — and it only
bites because dumping now returns nothing.

---

## 2. Authored rulings

What follows is **not** in the source, even in the detailed manual, and is my own ruling. Each one
fills a real gap; several were forced by measurement rather than taste.

### 2.1 Forced buy-outs, and why they have to exist

**The rule.** When the bank has sold all ten shares, a captain may still buy one — from the captain
holding the **fewest**, at **double** price, and only if the buyer already holds at least as many
shares as the seller. During a countdown that last restriction lifts entirely, which *is* faithful:
the source's sabotage window explicitly lets opponents buy shares off the leader.

**Why any such rule is needed.** With bank purchases alone, ten shares among four captains can
settle as 3/3/2/2. Nobody reaches six, nobody can declare, and the game has no ending. The harness
produced exactly that: five games, none finished, every captain rich, all ten shares out, no
majority anywhere.

**Why the specific shape.** Two obvious versions fail, and both were tried and measured:

| Rule tried | What happened |
|---|---|
| Buy from the **largest** holder | A raids B to six, B raids A back to five, forever. One game declared and lapsed **32 times**. |
| Buy from the **smallest**, no restriction on the buyer | The next captain strips it straight back. **10,850** share transactions in one game — a forced sale moves money between players, so nothing is ever spent down. |

`buyer.shares >= seller.shares` is what makes it terminate. Take the sum of the squares of every
holding: moving a share from a captain with `s` to one with `b >= s` changes it by `2(b − s) + 2`,
always positive, and the sum is bounded above by 100. So only a bounded number of forced sales can
ever happen, and the holding always concentrates.

### 2.2 Selling a share back — the softlock escape

A captain may sell a share to the bank at half the current price band. This exists because the
harness found a real dead end: a captain who spends down to £10 cannot afford the cheapest lot on any
quay, so she has no way to earn and nothing to sell. One sat on a *winning* majority with £10 for
**370 rounds**. Half is deliberately a bad price.

### 2.3 Movement, in sail points rather than nodes

The board uses printed nodes at one point each. We use **sail points** — roughly nautical miles ÷
500 — which is the same idea at a different granularity, chosen so that real geography could drive
the chart. A 2d6 roll averages 7, the world is about seven turns across.

Faithful within that: independent dice per ship, no exact roll needed to dock, excess forfeited on
arrival, infinite port capacity.

**Authored:** a course may cross several legs in one plot, sailing past intermediate ports. And a
ship at sea may be re-ordered to either end of the leg she is on — carry on, or put about and lose
the ground she made. The source is silent on both; the second exists because forbidding any change
of course once set was simply annoying.

### 2.4 Money

| Constant | Value | Note |
|---|---|---|
| Starting cash | £600 | FAITHFUL — inside the source's £500–£1,000 |
| Share, from the bank | £90 rising £45 a step | FAITHFUL in shape; the numbers are ours |
| Share, forced buy-out | 2× the top band | Authored |
| Share sold back | half the band | Authored |
| A new clipper | £250 | Authored |
| Cargo | £20–£90 a lot | Authored |

Cargo prices are flat per good rather than varying by port. The payout is "four times **the purchase
price**", which is only unambiguous if that price is a property of the card rather than of where you
happened to buy.

### 2.5 The deck

A card is only dealt if source and destination are within **24 sail points**. Without a cap the deck
contains genuinely undeliverable runs — Hamburg timber to Yokohama is the width of the chart — which
would sit face-up and dead in one of only five slots. At 24 the median run is about two turns and
every good still appears; at 18, guano drops out of the game entirely.

The five face-up cards are kept distinct, so the same run never appears twice.

### 2.6 Everything in §5a

Weather, wind, storms, piracy, ransoms, insurance, guns and copper are **entirely authored**. The
source says nothing about any of them. They are all optional and off in the 1988 preset.

---

## 3. The world

26 real clipper ports, 19 goods, 49 sea legs. Ports carry real WGS84 coordinates; screen positions
are **derived** from them by `sim/geography.ts`, never authored — that is what keeps a port on its
own coastline without anyone placing it by hand.

Sail-point distances are roughly nautical miles ÷ 500, adjusted to play well. A 2d6 roll averages 7,
so the whole world is about seven turns across and the mean port-to-port hop is about three.

**There is deliberately no Suez route.** The 1869 canal is what killed the clippers; including it
would make the Cape routes pointless.

**The chart wraps east–west, because the ocean does.** Four legs cross the Pacific — San Francisco
to Yokohama and to Hong Kong, and both Cape Horn runs to Australia. Drawn as plain straight lines
between projected points, every one of them went the *long* way: San Francisco to Yokohama rendered
as 1164px straight across Europe and Asia instead of 436px across the Pacific. The routes were
always right in the graph, and a full circumnavigation was always possible; only the drawing was
wrong. `wrapDx` now takes every hop the short way and the whole chart is drawn three times side by
side, so a line leaving one edge is picked up by the copy beyond it, and panning east or west
continues forever instead of hitting a wall. **Any new leg spanning more than half the sheet is
handled automatically; nothing needs authoring per-leg.**

Two content bugs found by audit rather than by play, both worth remembering as a class:

- **Indigo was a dead-end good.** Its only sources (Bombay, Calcutta) sat further from its only
  sinks (the northern European ports) than the deck's distance cap, so no indigo card could ever be
  dealt. Fixed by adding nearer entrepôt demand at Singapore, Hong Kong and Alexandria — the same
  fix Niccolò needed for sugar. **Whenever a good is added, check it has a source and a sink within
  the cap.**
- **Liverpool sold nothing.** Every captain started there with an empty hold and no way to load,
  making turn one always "sail somewhere else". Manufactured **cloth** is the historical outbound
  cargo and fixes it.

---

## 4. Architecture

Mirrors `packages/niccolo` — the established pattern for an app on this portal.

```
src/sim/           pure, no React, no clock, no Math.random
  types.ts         every interface
  rules.ts         every tunable number, each marked FAITHFUL or AUTHORED
  rng.ts           seeded mulberry32 against GameState.rngSeed
  content.ts       loads content/*.json; Dijkstra planRoute; distance matrix
  geography.ts     plate carrée projection; ports and coastlines share one project()
  movement.ts      spending sail points along a course
  contracts.ts     deck, draw, replenish, payout ladder
  state.ts         createInitialState — the only place a game is born
  actions.ts       processAction, the single reducer
  ai.ts            computer captains (nextAiAction)
src/content/       ports, goods, legs, worldChart (all data, no logic)
scripts/
  build_chart.py   regenerates worldChart.json from Natural Earth
  drive.ts         headless rules harness
api/               self-contained db/auth/cors + game endpoints
```

Two conventions the whole codebase leans on:

1. **An illegal action returns the same object it was given** — reference equality, not a copy. The
   AI loop uses that to detect a rejected move and stop rather than spin; the hooks use it to skip a
   pointless save.
2. **Nothing in `sim/` reads a clock or calls `Math.random`.** Dice come from `rng.ts` against the
   persisted seed, timestamps are passed in at creation. A game therefore replays byte-identically
   from its seed, which is what makes the harness a test rather than a smoke check.

### Turn flow

`roll` → `act` → (`handover`) → next seat. `END_TURN` automatically plays every consecutive computer
captain and stops at the next human. An all-AI table drives turns explicitly via the exported
`runAiTurn`, because the auto-run only fires when there is a human waiting.

### The AI

Reduced fidelity, the same modelling level as Niccolò's AI houses: it plays the real rules through
the real reducer but reasons with one greedy score, profit per turn. Three temperaments — `racer`,
`speculator`, `financier` — differ only in cash reserves, willingness to load on spec, and patience
with an unwanted lot.

One piece of it earns its keep: **contest awareness**. Before starting a run, a captain counts rival
ships already carrying that good and closer to the destination. Only two ships are ever paid, so a
run with two rivals ahead is worth nothing. Before this check, computer captains **dumped cargo more
often than they landed it** — 185 sell-offs against 132 deliveries in one game.

---

## 5. Verification

`npm run drive:tea` — around 300,000 assertions in a couple of seconds.

Focused rule checks drive `processAction` directly (payout ladder including a rejected third
delivery, cargo and port rules, sailing distance floors, the fleet and share caps, buy-out legality
in both directions, the declaration clock and all three victory conditions). Then twenty full AI
games run end to end, asserting on every turn that five cards are face up and distinct, that ten
shares exist, that no captain exceeds three ships or goes overdrawn, and that every ship is either
in port or at sea but never both. Finally one game is replayed from its seed and compared
byte-for-byte, which is what would catch a stray `Math.random`.

**Deliveries are audited from the log, not by diffing state.** Filling a card for the second time
and dealing its replacement happen inside a single action, so no observer watching state between
actions can ever catch a card holding two fills. `LogEntry.data` carries the structured numbers for
exactly this reason.

**A wide seed set is not optional.** Every pathology in this game's history showed up in some seeds
and not others, and a five-seed run twice reported a bug fixed while it was still there.

Current pacing across twenty seeds with hazards on: every game finishes, median **87 rounds**,
range 34–149. Three cargo slots roughly doubled throughput and brought this down from 155.

---

## 5a. Weather, wind and piracy

Optional, per game, both defaulting on. A save with no `hazards` field reads as off, so anything
made before they existed still plays the pure 1988 rules.

**This moved the game toward its source, not past it.** Before it, every captain raced round the
world in the same direction, because raw distance was the only thing telling one route from another.
That is a circuit, not clipper sailing.

### The wind is derived, not authored

`sim/weather.ts` computes wind from the same real lon/lat the chart is built on — six bands from the
leg's mid-latitude and the direction it is sailed. Two properties carry the whole feature:

- **It is directional.** `windFor(a, b, s)` and `windFor(b, a, s)` are different questions. In every
  band with a fair side, the reverse is strictly worse.
- **The monsoon reverses**, which is why seasons exist at all. Seasons are a pure function of the
  round — derived, never stored, nothing to migrate.

**Every directional band must net to zero over both directions.** The wind's job is to redistribute
speed, not remove it; a net-negative field just makes the whole fleet slower and stretches the game.
The first pass came out at −0.41 points distance-weighted, a 5.8% fleet-wide slowdown, because the
horse latitudes and doldrums were −2 in *both* directions while nothing was +2 in both. Those two
genuinely have no fair side and keep a −1, giving a residual −0.25. **Check this with the mean
modifier, not by eye** — the harness asserts it per band.

Four seasons must behave four ways. A first pass had the monsoon flip at the half-year and the
Forties strengthen for the other half, which made spring identical to summer — two seasons wearing
four names. The monsoon now has two settled phases and two turning ones, and the Forties peak in
northern *summer* (southern winter), six months from the northern westerlies' own peak.

### Route choice is the point

Directional wind is worthless if the game still tells everyone to sail the same way. `planRoute`
gained a pluggable edge cost; `planFastestRoute` costs edges by expected turns in a season. The raw
distance matrix stays for things that should be stable facts about geography — the contract deck's
cap and the port table's "how far".

Measured: **154 of 650 port pairs change route with the season, 290 differ from the shortest path,
and all 650 have a different way home than way out.** Liverpool to Foochow switches from the Cape
and India in spring to running the easting down through Melbourne in autumn — the real clipper
strategy, falling out of the latitudes rather than authored.

`SAIL_TO` carries an optional `via`, so a player choosing the longer fair-wind route actually sails
it instead of being quietly re-planned onto the shortest.

### Storms cost time, pirates cost money

Kept strictly distinct so the two never blur into one tax. A storm forfeits the rest of the turn and
sets the ship back, never past her leg's start, and never touches ship or cargo. Piracy lives on
`SeaLeg.piracy` — **authored**, unlike the wind, because the Malacca Strait was dangerous for
reasons no formula over latitude would find. Measured at 93% ransoms to 7% seizures: taking the
cargo off a captain who was winning is the harshest thing this game can do, so it is the rare case.

### Three mitigations, each covering a different failure

**Guns** halve encounters and talk most seizures down to a ransom. **Copper** cuts storm setback and
adds a point of speed always. **Insurance** is a standing open policy — set once, premium taken at
cast-off, priced from the route's real risk — and covers goods taken and ransoms paid, **never lost
time**. Routing and timing fall out of the above for free.

### What the harness caught here

| Symptom | Cause |
|---|---|
| Median game 114 → 179 rounds | The net-negative wind field, not the hazard rates. Halving the rates barely moved it. |
| A game of 20 never finishing | A captain held a majority for **1,170 consecutive turns** and was cash-ready on none of them, because every time she reached £370 she bought a *seventh* share. Shares past a majority are worthless and the AI no longer buys them. |
| Zero fittings and zero policies in 1,085 rounds | The AI ordered every docked ship to sea before it ever considered fitting her out. Fit-out now happens before sailing. |
| 800 policy toggles of log noise | The AI opened and closed policies as holds filled and emptied. A policy is never closed now. |

## 6. Things deliberately not built

Crew and captain skills, ship speed classes beyond copper, weather forecasting as a purchasable
information layer, networked multiplayer, and Voyage mode below.

**Requested and not yet built:** optional *multiple stocks* — several shipping companies whose share
prices move with the trade flowing through their regions, so shares become a market to read rather
than a counter to fill. Designed in conversation, not started.

---

## 7. Voyage mode — designed, not built

The classic ruleset is a dice-and-cards board game. Voyage mode would be the same world run as a
continuous simulation, in the manner of Banco di Niccolò.

**Do not start building this without being asked.** It is recorded here so the intent is not lost,
and so that `GameState.rules` has a documented reason to exist.

What would change:

- **Time.** Weeks instead of turns; `movement.ts` spends a fixed weekly distance modified by
  season, latitude and rig, instead of 2d6. The trade winds and the monsoon become real: the eastward
  run through the Roaring Forties is fast and dangerous, the westward run is not.
- **Prices.** Cards go away. Each port keeps a live price per good that drifts, responds to what is
  actually landed there, and is only known as accurately as your last report from it — Niccolò's
  courier-latency news model applies directly. `contracts.ts` becomes a market rather than a deck.
- **The race becomes implicit.** Nobody is "first home" for a fixed multiplier; you simply get a
  worse price because a rival landed 400 chests of tea last week. This is the single biggest change
  and the reason the two modes cannot share a scoring path.
- **Standing costs.** Crew wages, victualling, refits, insurance per voyage. Cash stops being a
  score and starts being a constraint.
- **Victory.** The share majority stops making sense without a fixed-length game. Most likely a
  season structure with an end-of-season reckoning.

What could be reused unchanged: the ports, goods and legs data; the projection and chart; the whole
UI shell; `state.ts`'s creation path; the save and API layer.

What could not: `contracts.ts` entirely, most of `actions.ts`, and all of `ai.ts` — a greedy
profit-per-turn score against five known cards has nothing to say about a drifting market.

---

## 8. Build log

Kept here rather than in `PROGRESS.md`, which is Banco di Niccolò's own record and titled as such.

### Session 1 (2026-08-02) — the vertical slice

Shipped: the package, the API and cloud saves, the portal wiring, the full classic ruleset, computer
captains, local hotseat, the chart, and the whole UI. Playable end to end and deployable.

Decisions taken with the owner before building: keep the 1988 rules faithful now and document
Voyage mode for later; ship both AI rivals and hotseat; a stylised board chart rather than the
real-coastline pipeline Niccolò needed several sessions of rework to get right; the name.

Two chart treatments were mocked up as a throwaway Artifact — with real port coordinates and real
legs, not a sketch — before `MapView.tsx` was written. Both palettes live in `src/theme.ts` and
`CHART_STYLE` picks between them, so the choice costs one word either way. **The owner chose
`printed`** — the pale one, which reads like an actual board on a table.

Bugs found and fixed during the build, all by measurement rather than by looking:

| Found by | Bug |
|---|---|
| Harness | The share deadlock, the buy-out oscillation, and the 10,850-transaction rotation (§2.1) |
| Harness | The £10 softlock on a winning majority (§2.2) |
| Harness | Computer captains dumping cargo more often than landing it (§4) |
| Deck audit | Indigo had no deliverable route anywhere in the game (§3) |
| Deck audit | Liverpool sold nothing, so turn one was always "sail elsewhere" (§3) |
| DOM label-collision check | Calcutta's and Hong Kong's labels overlapped on the chart |
| Browser play-through | The contract highlight ring swallowed clicks on the port beneath it |
| Browser play-through | Clicking your own port read "No sea route from Lisbon to Lisbon" |
| Browser play-through | The sidebar pushed the chart off screen, making "click a port" impossible |

### Session 4 (2026-08-05) — the real rulebook

The owner supplied a compiled rules manual for the actual 1988 game, which invalidated six authored
rulings at once (§1). Correcting them was the most productive change the game has had:

- **Three cargo slots** answered the "flat gameplay" complaint directly, and roughly doubled
  throughput — median game 155 rounds → **87**.
- **The scaling share price and the sabotage window** fixed a genuine dead end the owner spotted:
  the bank sold out by round 37–63 of a ~155-round game at a flat £120, after which a captain on
  zero shares could never buy in, because a forced buy-out requires already holding as many as your
  target. Six shares now cost ~£1,600 across the whole game.
- **A failed claim ending the game on asset value** means out-trading the table is a real route to
  victory, so nobody is locked out by the share race.

Also this session: mid-voyage redirect, the three-column board (exchange left, chart centre, controls
right), rival ships made legible with wakes, captain names and cargo pips, a RivalFleets panel, and
two lobby presets.

**A methodology note worth keeping.** Half a session was spent diagnosing a "stuck game" against a
working tree where an in-progress rename had left `actions.ts` uncompilable. `tsx` transpiles without
typechecking, so every game looked broken for reasons unrelated to the bug being hunted. **Typecheck
before trusting any measurement taken mid-refactor.**

### Session 3 (2026-08-03) — weather, wind, piracy, and a stuck endgame

Two bugs made a live game look like it would never finish. The declared-majority countdown ran for
twelve complete table **rounds** — forty-eight turns at a four-captain table — because "the game
lasts for 12 more turns" was read as rounds; it is twelve individual turns, which is both shorter and
more faithful. And the AI declared on money it did not have, failing and re-declaring: **five
declare-and-lapse cycles in one 91-round game**, each putting the countdown banner back at full.
It now declares only holding the £750, and protects that cash once it has. One declaration per game,
zero lapses, across twenty seeds.

Then weather, wind and piracy — see §5a.

### Session 2 (2026-08-03) — owner feedback

- **Printed board palette selected.** `CHART_STYLE = 'printed'`. The zoom buttons had hardcoded
  dark-chart colours and became a black box floating in a pale ocean; they are palette-driven now.
- **The chart wraps** (§3). Found by the owner asking to "sail around the world" — the graph always
  allowed circumnavigation, but four Pacific legs were drawn backwards across the whole sheet, which
  made the map look like a wall. Verified numerically: the longest drawn leg went from 1164px to
  652px, and no leg now spans more than half the chart.
- **The port trade table is on the board at all times** (`components/PortLedger.tsx`), under the
  chart, the way the printed board carried it round the map edge. Sells and buys are separate views;
  a filled chip means a face-up commission wants that good from that quay; clicking a port lays off
  a course exactly as clicking the chart does. The chart is no longer sticky, because the table is
  part of the same column and has to scroll with it.

Three of those — the label collision, the click-swallowing ring, and the sticky map — are the same
lessons Niccolò's map taught, arriving again in new clothes. The label check in particular is worth
rerunning after **any** change to port coordinates or label sides: it is a pairwise bounding-box
test on the rendered labels, and it catches what a screenshot does not.

---

## 9. Attribution

Rules are adapted from Ocean Trader (Clipper Games Ltd, 1988). This is an original implementation
with an original name, original content data and a substantial number of authored rulings where the
source rules are undocumented; it reproduces no text, art or components from the published game.
