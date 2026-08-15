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

**Pass two (2026-08-05)** worked from a compiled rules manual the owner supplied, which is far more
detailed and showed that six things pass one had invented were in the real game, done differently.

**Treat that document as a strong hint, not as authority.** On re-reading it carries the marks of an
AI-generated compilation rather than a transcription of the printed rules: bracketed citation markers
(`[1, 2]`), the phrase "formatted for direct copy-pasting", and a sign-off offering to draft an
appendix. It is confident and specific, which is exactly how a confabulation reads.

It has already been caught out once, and the correction has now been *tested*. The document states
that a commodity card locks buying to one named port — "Alternate routing or selling to unauthorized
ports is illegal" — and the owner, who has actually played the game, remembers the opposite: the card
tells you where the good is available at that price, and you may buy it anywhere that stocks it.
**Where the owner's memory and that document disagree, the owner wins.**

**Resolved 2026-08-10.** Before changing a line, a ship was put at Bombay, loaded with opium and
sailed to Foochow to land it on a card reading "Calcutta → Foochow". It paid the full 4×, because
`doDeliver` has only ever matched the good and the destination. **The lock was never implemented and
the document's claim was never in force** — the card's own label was the only thing enforcing it, and
only on the player. The owner's recollection was correct twice over: about the board game, and about
this implementation. §6a phase 2 records the change that stopped the UI implying otherwise.

That is one confabulation confirmed, and it is the only mark in the table below with direct evidence
either way. The rest still stand on that document alone, so the pass-two FAITHFUL marks continue to be
held with less confidence than pass one's, and several may yet move back to AUTHORED — the way to
settle any of them is to ask the owner, not to re-read the file.

**One mark has effectively moved.** "Four times the purchase price" is now read as four times the
*card's reckoned* price, because §6a phase 2 gave each quay its own price and the two readings came
apart. With a single global price they are numerically identical, so nothing published is
contradicted; but the choice is ours and it is recorded in `sim/pricing.ts` rather than claimed as
faithful.

What the real rules give:

- 2–6 players, each starting with one clipper at **Liverpool** and a bankroll of **£500–£1,000**.
- A world map of shipping lanes marked by **movement nodes**, one node = one movement point.
- **Every ship has exactly three cargo slots.** A full fleet of three ships carries nine.
- **Five commodity cards face up at all times.** ~~Each locks one good to one source and one
  destination; selling to any other port is illegal.~~ **Disproved — see above.** A card names a good,
  a buyer and a price; load it wherever it is stocked.
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

## 6a. Roadmap — three phases

Agreed with the owner 2026-08-05, ordered so each phase ships on its own and the risk climbs as it
goes. Phase 1 changes no rules at all; phase 2 changes the core economy; phase 3 adds systems.

### Phase 1 — make what already happens visible ✅

The owner's report was "pirates don't seem to do anything". They do: measured over 1,394 rounds,
268 storms, 70 ransoms and 8 seizures — roughly a storm every five rounds. But every one of them
produces only a line in a scrolling log, and if it fired on a computer captain's turn nobody ever
sees it. **This is a presentation failure, not a rules one**, which is why it comes first and why it
is cheap.

**Shipped 2026-08-10.** All three parts are in, and the ruleset is untouched: a game with the
`events` toggle off plays exactly as it did before, byte-identically, which the harness asserts.

- **The event card** (`components/EventCards.tsx`) — the universal reporting surface. Driven off
  `state.log` rather than a parallel event channel, because everything notable already writes one
  entry with structured `data`, so there is nothing to keep in step. Seen-ness is tracked by
  `LogEntry.seq`, never by index, and everything present at mount counts as seen so a reload does
  not dump the backlog.
- **The event deck** (`sim/events.ts`) — five kinds: a **strike** shutting a port to all trade, an
  **embargo** stopping a good being loaded anywhere, a **glut** paying ×0.55, a **shortage** paying
  ×1.5, and an **Admiralty bounty** paying +£45 a unit. Drawn at the top of a round, at most two at
  once, never the same kind twice running.
- **The news banner** (`components/NewsBanner.tsx`) — what is in force right now, with rounds
  remaining. The cards are the notification; the banner is the state.

Three properties hold the deck together, and each was a bug first:

- **Everything expires**, and expiry runs unconditionally. New draws stop once a declaration is
  live — a strike on the declarer's home port mid-countdown would settle the game by dice — but the
  first version gated the whole round-turn on the declaration and quietly froze the deck, so
  anything in force when somebody declared stayed in force forever.
- **The AI prices the news with the same call the reducer uses** (`landedValue`), so a glut deters it
  and a bounty tempts it. Left news-blind it kept sailing to shut ports: median game 106 rounds
  against 87. Taught to read it, 88 — with the deck on.
- **Nothing repeats.** "No two of a kind at once" was not enough: four shortages in a row, each
  retiring as the next was dealt, read as a stuck deck. The deck now remembers its last two draws.

Pacing with everything on, 20 seeds: **min 35, median 88, max 151** — the same as before the deck
existed, so the variety is free.

### Phase 2 — make trading dynamic ✅

The rules change the owner cares most about, and the one that makes the map matter.

- ✅ **A card no longer locks its source** (2026-08-10). It names a good, a buyer and a price; load it
  at any port that stocks it.

  The finding that reframed this: **the source lock never existed in the rules.** `doDeliver` has
  always matched only the good and the destination, so opium bought at Bombay filled a
  "Calcutta → Foochow" card for the full 4× and always would have. The card's own label was the only
  lock. The owner's recollection of the board game was right and the implementation was already
  right — the UI was lying about it. Verified before changing anything, by loading off-source in the
  harness and watching it pay.

  So this was a presentation-and-model change, not a rules change. `Contract` lost its `source`
  field; card keys went from `good|source|destination` to `good|destination` (three-part keys from
  older saves still parse, with the middle field dropped, so an existing game keeps its draw pile);
  the deck's distance cap became a *reachability* test — some seller within
  `CONTRACT_MAX_DISTANCE` of the buyer — rather than a property of one named pair. Cards now read
  "Coffee, wanted at London, load at Rio de Janeiro, Zanzibar, Batavia", nearest seller picked out.

  The AI had to change most: it now costs the whole out-and-back for *every* port stocking the good
  and keeps the best, which is the work it previously got for free by being told where to load.
  Pacing improved as a result — 20 seeds went from min 35 / median 88 / max 151 to
  **min 49 / median 73 / max 123**, faster and much tighter, because nobody treks past a nearer
  supplier any more.
- ✅ **Prices vary by port** (2026-08-10). Each quay has its own price for each good it stocks, so the
  port table is a price sheet rather than a reference card.

  Nothing is hand-authored: `sim/pricing.ts` derives every figure from the content, from two forces.
  **Volume** — a port shipping many goods is a place trade passes through and prices below the
  reckoning, so Singapore is cheap because everything comes past it. **Local conditions** — a fixed
  per-quay idiosyncrasy, so two entrepôts of equal size are still worth choosing between. The band is
  0.78–1.22 of the card's price; observed across the actual content, 0.83–1.17. Deterministic and
  game-independent, because two players reading the same port table must agree on what a lot costs.

  **The trap, and it inverts the whole game if missed:** a delivery used to pay `lot.paid × 4`. Leave
  that alone once quays disagree on price and the cheapest port earns the *least*, making "always buy
  at the dearest quay" correct. Payout is therefore reckoned on the **card's** stated price per unit,
  and what you pay at the quay is the margin. The harness asserts the direction explicitly — buying at
  the cheapest seller must net strictly more than the dearest, by exactly the price difference — so
  this cannot silently regress. See the note in §1 on how this re-reads "four times the purchase
  price".

  The AI shops on it: it costs every seller's price against the card's reckoning, and its speculative
  load now ranks on *underpricing* rather than on the dearest lot it can afford, which was exactly
  backwards once prices stopped agreeing.
- ✅ **Re-audited §1's FAITHFUL marks** (2026-08-10) — see §1. The source-lock claim is now disproved by
  test rather than merely doubted; the remaining pass-two marks still rest on that one document and are
  flagged as such.

### Phase 3 — add depth

- **Named ship classes** — a fast clipper with two slots, a slow barque with four, an armed Indiaman
  with three. Fleet composition becomes strategy, and it slots into the copper and guns economy that
  already exists.
- **Port agents** — a cheap standing investment: early word of new cards, or cheaper loading. Gives
  money a use besides shares and makes where you trade matter over time.
- **Multiple stocks** — several shipping companies whose prices move with the trade flowing through
  their regions, so shares become a market to read rather than a counter to fill.

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

### Session 7 (2026-08-15) — the way back in, and ships left standing

Two owner reports, both about agency.

**"If you fall behind in shares, there is nothing you can do to win?"** Very nearly yes, and the code
already admitted it: `canBuyOut` requires the buyer to hold at least as many shares as the seller,
and nobody holds fewer than zero, so once the bank empties a captain on nothing is locked out for
good. Its own comment called the cost "real and deliberate". Measured: two captains across 20 seeds
finished the bank-emptying round holding nothing and **neither ever won**; one of them, in
`levanter`, ended on £27,623 — the richest on the board and unable to make a single share move.

The fix is the **hostile bid**: buy a share off anyone, including the leader, whatever your own
holding. Priced off two compounding terms — how much the buyer already holds, and how many bids
anyone has made this game (which doubles each time).

Getting it right needed measurement twice over, and the first version was wrong in an instructive
way. Priced **flat**, a hostile bid is just a machine for turning money into shares, so it is won by
whoever has the most money — and the captain leading at round 30 leads because they have been trading
well, so they are also the richest. A/B over 20 identical seeds:

| | round-30 leader wins | lead changes after r30 | median rounds |
|---|---|---|---|
| No hostile bid | 50% | 16 | 83 |
| Flat price | **65%** | 49 | 78 |
| Priced on the buyer's holding | **45%** | 155 | 99 |
| …and doubling per bid (shipped) | **35%** | 97 | 89 |

**An expensive comeback mechanic favours the rich, and the rich are usually the leader.** Charging on
the buyer's own holding fixes it at the root — a captain with nothing pays £180 for a way in, while
the captain going from five to a winning six pays the most anyone pays.

The escalation rate was picked the same way. 1.6× churned harder but ran 19% long; 2× is lowest on
leader-conversion *and* back to a normal median with a tighter worst case. 1.8× was worse than both,
which is the useful reminder that at 20 seeds these figures carry about ±10 points of noise — 2× was
taken because it wins on all three axes at once, not on any one of them.

Termination is the thing this move puts at risk, since a bid from a captain holding fewer shares than
the seller *lowers* the sum of squares that the ordinary buy-out's proof depends on — precisely the
oscillation that once produced a 10,850-transaction game. What replaces the proof: bids double in
price globally, so they are bounded by cash and settle at about five a game; sum-of-squares is
non-decreasing everywhere else. Bounded rather than proven, which is why the harness asserts the
count stays small instead of trusting the algebra.

Victory stays **share-only** at the owner's direction. The existing rule where a *failed* claim
resolves on asset value is untouched, because that happens at the close of the countdown — inside the
sabotage window.

**"There should be a reminder when boats are stuck at port."** `sim/attention.ts`, and the signal
turns out to be exact: `ROLL` writes `sailPoints` for every ship and sailing spends it down, so a
docked ship still holding points is precisely one that was rolled for and never sent anywhere. No log
scanning. The fleet panel marks her "awaiting orders", and `End the turn` becomes one extra
click naming her and what she could be doing — never a block, because waiting in port for cash or a
better card is a real move.

The judgement lives in `sim/` rather than the component on purpose: a warning that nags about a ship
with nothing to do is worse than none, because it trains you to click through. So the *hints* are
what the harness tests — a full hold is told to sail rather than to shop, a shut port is named as the
reason, a penniless captain is told she can afford nothing.

One bug worth recording, because typechecking cannot catch it: the new hooks were first placed beside
the code that used them, which is **after** `GameScreen`'s `if (!state)` bail-out. Hooks after an
early return render conditionally, React counts them, and the whole screen died with "rendered more
hooks than during the previous render". Clean `tsc`, clean harness, blank page. Only the browser
found it.

Verified: 421,554 assertions, 0 failed, all 20 seeds reaching a winner, min 63 / median 89 / max 135.
Browser-verified end to end: the idle warning fires and clears correctly, and a bid of £180 took a
share off the leader with £54 destroyed in brokerage.

Still open: the two AI captains who hold nothing when the bank empties still won 0 of 2, because the
AI only reaches for a bid *after* the bank is dry. A human is not so restricted, but the AI could
probably use it earlier.

### Session 6 (2026-08-10) — phase 2: sourcing becomes a decision

Two changes, and the first one turned out to be a discovery rather than a change.

**Cards name a buyer, never a seller.** The owner remembered the board game not making you buy at a
named port. Before touching anything I tested it: a ship at Bombay, loaded with opium, landed it on a
"Calcutta → Foochow" card and was paid the full 4×. `doDeliver` has only ever matched the good and
the destination, so **the source lock was never implemented** — the card's label was the only thing
enforcing it, and only on the player. The owner was right about the board game *and* about this
codebase; the UI was lying about the rules. So the work was to stop it lying: `Contract` lost its
`source`, card keys went to `good|destination` (three-part keys still parse, so existing saves keep
their draw pile), and the deck's distance cap became a reachability test rather than a property of one
named pair.

The AI changed most, and improved: it now costs the whole out-and-back for every port stocking the
good instead of being told where to load. Pacing went from min 35 / median 88 / max 151 to
min 49 / median 73 / max 123 — faster and much tighter, because nobody treks past a nearer supplier.

**Prices vary by port**, derived from the content rather than authored: a volume discount for
entrepôts, plus a fixed per-quay idiosyncrasy, banded 0.78–1.22 of the card's reckoning.

That change carries a trap worth recording, because it is easy to write by accident and it inverts the
whole game. Payout was `lot.paid × multiplier`. Leave that as it is once quays disagree on price and
**the cheapest port earns the least**, so the correct play becomes "always buy at the dearest quay" —
nonsense, and it would have looked like working code. Payout is now reckoned on the card's stated
price per unit; what the quay charges is the margin. The harness asserts the direction outright:
buying at the cheapest seller must net strictly more than the dearest, by exactly the price
difference. Two more general lessons from this session:

- **Test the belief before implementing it.** An hour's worth of change turned into a five-line probe
  and a much better commit message, because the rule I was about to "add" was already there.
- **When a derived quantity changes meaning, re-check every formula that consumed it.** `lot.paid`
  went from "the card's price" to "what this quay charged" without changing type, so nothing broke and
  everything reading it silently changed meaning.

Verified: 370,788 assertions, 0 failed, all 20 seeds reaching a winner. Browser-verified against a
pre-change round-41 save: it loads clean, cards read "wanted at London / load at Rio de Janeiro,
Zanzibar, Batavia", and Liverpool asks £52 for cloth reckoned at £45.

### Session 5 (2026-08-10) — phase 1: the event deck

Shipped the whole of phase 1 above: the event card, the five-kind world event deck, and the news
banner. No rule changed for anyone playing with `events` off.

Four bugs, all found by the harness or the browser rather than by reading:

- **Insurance premiums drowned the card surface.** A standing policy writes a premium line at every
  cast-off; promoting log kinds wholesale to cards buried a storm under three identical notices about
  paperwork. Notability is now a predicate, not a list of kinds: only an actual payout is news.
- **The cards covered the orders panel.** Floating bottom-right put them squarely over the one column
  you click. They live bottom-left now, over the exchange, which is read rather than operated.
- **Gating the round-turn on the declaration froze expiry**, so events in force when somebody
  declared never retired. Only *drawing* belongs outside the endgame; retiring news never does.
- **An unpayable premium could imprison a ship for good.** `SAIL_TO` charged the premium at cast-off
  and refused the whole voyage if the captain could not pay — sound reasoning ("better than sailing
  uninsured while believing you are covered") with a fatal consequence. The harness found a captain
  holding a *winning* six shares with two lots of opium aboard, orders for Shanghai and £1 in hand:
  every cast-off rejected, so she never sailed, never sold, never reached the £750 the win also
  needs, and could not be raided because a forced buy-out requires the buyer to hold at least as many
  shares as the seller and she held the most. Four hundred rounds tied up at Bombay. **An unpayable
  bill must never be able to hold a ship alongside.** The cover lapses instead, which is also what
  really happens. This one was latent long before the event deck — longer games merely reached it.

That last bug also exposed a second latent one: the AI's softlock escape (`SELL_SHARE` when too poor
to buy the cheapest lot) sat *after* the sailing branch and was therefore unreachable, because a
captain with ships always finds some card worth steering for. It now comes first. A majority you
cannot turn into £750 is worth nothing.

Verification: 391,352 assertions over 20 seeds, 0 failed. Pacing min 35 / median 88 / max 151 —
indistinguishable from before the deck, so the added variety costs no length. Browser-verified:
banner, cards, retirement notices and expiry all observed in one six-round game, and the orders panel
stays clear.

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
