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

Published descriptions of the 1988 board give the following, and only the following:

- 2–6 players, each starting with an empty clipper docked at **Liverpool**.
- **Five commodity cards** face up at all times, each naming a commodity, the port that has it and
  the port that wants it.
- Players roll dice to move, buy the commodity at its source and carry it to its destination.
- **Only the first two ships to arrive are paid**: the first gets **four times** the purchase
  price, the second **twice**. Later arrivals get nothing.
- Buying a commodity **on speculation**, with no card yet calling for it, is legal and expected.
- A player may own up to **three ships**.
- There are **ten shares**.
- Once a player holds a majority of the ten and **declares** it, the game runs **twelve more
  turns**. At the end, the declarer wins if they hold the majority, **£750**, and at least one ship.

Everything above is implemented faithfully. Everything below marked **[authored]** fills a gap the
published rules do not cover. The distinction is kept in the code too: every constant in
`src/sim/rules.ts` is commented FAITHFUL or AUTHORED.

---

## 2. Authored rulings

Ordered roughly by how much they matter.

### 2.1 Forced buy-outs, and why they have to exist

**The rule.** When the bank has sold all ten shares, a captain may still buy one — from the captain
holding the **fewest**, at **double** price, and only if the buyer **already holds at least as many
shares as the seller**. The seller cannot refuse and is paid.

**Why any such rule is needed.** With bank purchases alone, ten shares among four captains can
settle as 3/3/2/2. Nobody can reach six, nobody can declare, and the game has no ending whatsoever.
This is not hypothetical — it is what the harness produced: five games, none finished, every captain
rich, all ten shares out, no majority anywhere. The physical game must have a rule of this shape for
the same reason.

**Why the specific shape.** Two obvious versions both fail, and both were tried and measured:

| Rule tried | What happened |
|---|---|
| Buy from the **largest** holder | A raids B to six, B raids A back to five, forever. One game declared and lapsed **32 times** without settling. |
| Buy from the **smallest** holder, no restriction on the buyer | Concentrates within a turn, then the next captain strips it back. **10,850** share transactions in one game. A forced sale moves money *between players*, so nothing is ever spent down and it never self-limits. |

The restriction `buyer.shares >= seller.shares` is what makes it provably terminate. Take the sum of
the squares of every captain's holding: moving a share from a captain with `s` to one with `b >= s`
changes it by `2(b − s) + 2`, always positive. So every forced sale strictly increases a quantity
bounded above by 100, the whole game admits only a bounded number of them, and the holding always
concentrates. Once a captain does hold six, they are nobody's smallest holder, so the majority
cannot be raided away.

The cost to a trailing captain is real and deliberate: hold no shares and you cannot force your way
in, only buy from the bank. Every captain gets the same shot at the bank's ten in the opening
rounds — around round 25 in practice — so declining one is a decision, not an accident.

### 2.2 Selling a share back — the softlock escape

A captain may sell a share to the bank for **half** its issue price.

This exists because the harness found a real dead end: a captain who spends down to £10 buying
shares cannot afford the cheapest lot on any quay (£20), so she has no way to earn, nothing to sell,
and simply sails in circles. One sat on a *winning* majority of six shares and £10 for **370
rounds**, unable to raise the £750 the win also requires, while nobody else could reach a majority
either. Half is deliberately a bad price; it should hurt to need it.

### 2.3 Dumping an unwanted cargo

A lot nobody has a card for can be sold at any port that buys that good, for **half** what was paid.
Speculation is a real part of the original game, and without an exit a speculating ship can be
bricked permanently.

### 2.4 Movement

- **2d6 per ship per turn** [authored — the board's own multi-ship movement rule is not documented].
- Ships already at sea advance the moment their owner rolls, without a separate click: a ship
  mid-ocean has no decision to make.
- A course may cross several legs; intermediate ports are **sailed past**, not called at. To trade
  somewhere on the way, plot a course to that port instead. This is the routing decision the game
  is actually about.
- Tying up **forfeits the rest of the roll**. You cannot bank the wind.
- A course can only be set from port. No coming about mid-ocean.

### 2.5 Money

| Constant | Value | Note |
|---|---|---|
| Starting cash | £250 | Two mid-value lots, not enough for a share |
| Share (from the bank) | £120 | Six of them is £720 |
| Share (forced buy-out) | £240 | Double |
| Share sold back | £60 | Half |
| A new clipper | £250 | Fits out at Liverpool wherever her owner is |
| Cargo | £20–£90 | Flat per good, everywhere |

Cargo prices are flat per good rather than varying by port. This is not laziness: the payout is
"four times **the purchase price**", which is only unambiguous if the purchase price is a property
of the card rather than of where you happened to buy.

### 2.6 The deck

A card is only dealt if its source and destination are within **24 sail points**. Without a cap the
deck contains genuinely undeliverable runs — Hamburg timber to Yokohama is the width of the chart,
seven turns of sailing for a £75 profit — which would sit face-up and dead in one of only five
slots. At 24 the median run is about two turns and every good still appears; at 18, guano drops out
of the game entirely.

The five face-up cards are kept distinct, so the same run never appears twice.

### 2.7 A lapsed claim

If a declarer fails any of the three conditions when the twelve rounds are up, the claim lapses,
trading continues, and it can be re-declared. The original does not say.

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

Current pacing across twenty seeds with hazards on: every game finishes, median **155 rounds**,
range 116–307. Without hazards the median is about 114, so weather and pirates cost roughly a third
again in length — which is the price of having them.

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
information layer, voluntary share trading between captains, networked multiplayer, and Voyage mode
below.

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
