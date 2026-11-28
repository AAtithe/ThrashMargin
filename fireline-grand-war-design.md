# Fireline: Grand War (one real-time mode in place of skirmish and War for the Planet)

Status (2026-11-28): proposal and contract. Nothing built yet. Phases G0 to G5 below are built in
order; each has its own acceptance tests and a build log entry at the end of this file. Where code
and this file disagree on a name or a number, this file wins until its build log says otherwise.

Read first: `CLAUDE.md` (invariants), `fireline-design.md` (the engine, and the 2026-11-21 to
2026-11-27 economy entries), `fireline-planet-design.md` (sections 6 to 8: cities, trade,
diplomacy), `fireline-round7-planet.md` (the links between the war and its battles).

---

## 1. The decision

Fireline offers three ways to play: the story campaign, skirmish (one real-time battle) and War for
the Planet (a turn-based strategic map whose attacks are fought as skirmishes). The owner wants the
last two merged into one game type, entirely real time, with the feel of three genres:

| Genre | What it contributes | Where it already lives |
|---|---|---|
| Base-builder (C&C) | Command Yard, ore and haulers, power, build queues, an army sent by hand, superweapons | `src/sim/` since the first build |
| Economy builder (Settlers) | Workers and housing, production chains, logistics, food, seasons | `industry.ts`, `supply.ts`, `territory.ts`, `production.ts`, `upkeep.ts`, `seasons.ts` (2026-11-21 to 27) |
| Empire builder (Civ) | Cities that grow, many factions, temperaments, trust, treaties, trade, research eras, domination | `src/planet/` (turn-based only) |

The finding that makes this tractable: over the last week the real-time engine has absorbed most of
the strategic economy. Territory, workforce, fuel and alloys, food and upkeep, seasons, supply depots,
neutral sites, hold-ground victory, Continental maps (384 to 448 tiles) and two-level route finding
are all in skirmish already. What is still only turn-based is the Civ layer: cities, diplomacy,
trade, independents, and a long game's victory. Grand War moves that layer into the real-time
engine and drops the turn.

### What is kept, retired and protected

- **Kept**: the story campaign, unchanged. Every skirmish save and every War for the Planet save
  loads and plays exactly as before (the "old saves load unchanged" rule of every round).
- **Retired for new games**: the lobby stops offering "New skirmish" and "New war". "Continue" stays
  for both while any save of that kind exists. The turn layer, auto-resolve and the strategic map
  canvas stay in the code for those saves and gain no new features.
- **Skirmish is not lost; it becomes a preset.** Grand War's "Battle" preset (section 4) is today's
  skirmish with every Grand War rule off. That is the faithful ruleset invariant 3 requires: it is
  stated key by key, and the harness proves a Battle preset game replays byte-identically to the same
  skirmish setup today.

---

## 2. The game in one paragraph

Two to four powers and a scatter of independent towns on one Continental map, in real time. Each
power starts with one city (its Command Yard is the city's heart) and a handful of settlers. Cities
grow with food and housing, claim the ground around them, and unlock districts as they level up.
Workers staff refineries, wells, foundries, farms and factories; goods move by road through depots,
and a city cut off from its capital starves. The other powers are run by commanders with a
temperament, a memory and a trust score toward everyone: they propose ceasefires, trade pacts and
alliances, honour them or break them, and fight each other as well as the player. Trade is a convoy
on the map that can be escorted or raided. Armies are built and fought by hand, as in skirmish. A
power wins by conquest, by holding a share of the cities for a set time, or on score when the clock
runs out.

---

## 3. Translating the turn-based rules into real time

Every planet rule below is ported, not rewritten: the formulas in `src/planet/` are pure and keyed on
`PlanetState`; Grand War gets thin adapters keyed on `GameState`, so the tuning that the planet ladder
already paid for carries over.

| War for the Planet (turns) | Grand War (real time) |
|---|---|
| A region with one city | A city on the map: a Command Yard or a founded settlement, with the tiles it claims (`territory.ts`) |
| City level 1 to 5, seven building kinds at Mk 1 to 3 | City level 1 to 5 from population; level sets the claim radius, the housing cap and how many district structures (refinery, farm, factory, institute, fortification, port, airfield) the city may hold; Mk 1 to 3 is the existing structure upgrade (`structureUpgrades`) |
| Founding by conquest only | The **Settler Wagon** (the Forward Base Truck, extended): deploys into a new city on unclaimed ground at least `CITY_GAP` tiles from any other; costs credits, food and 6 workers taken from the founding city |
| Independent militias hold unclaimed regions | **Independent towns**: neutral cities with a garrison scaled by `neutralStrength`; taken by force, or absorbed by holding a trade pact with them for `ABSORB_MINUTES` while your border touches theirs |
| Four resources: ore, fuel, alloys, food | The same four, already in the engine (`industry`, `production`) |
| Supply to the capital, cut regions surrender after N turns | Depots and roads (`supply.ts`); a city with no road to its capital produces at half rate and, after `SURRENDER_MINUTES` cut off and without a garrison, goes independent |
| Trade routes pay each turn; a route whose path is lost is blockaded | A **trade convoy** runs between two cities on a timer and pays on arrival; it is a unit, so it can be escorted, intercepted or sunk; a route whose road is cut stops |
| Diplomacy each turn | A **diplomatic beat** every 60 seconds of game time: trust drift, expiry, the AI's proposals and judgements. Treaty durations are in minutes; the formulas are the planet's with turns read as beats |
| Temperaments: expansionist, mercantile, defensive | The same three, per computer side, layered over the adaptive commander: temperament chooses targets and treaties, the commander still fights the battle |
| Research lines, doctrines, loadouts | Unchanged (`research: 'lines'`); an Institute district speeds a city's research |
| Persistent army, heroes, Commander perks | Live on the map; heroes and generals as in free play today |
| Domination share by turn limit | **Dominion victory**: hold `dominionShare` of all cities for `dominionMinutes` without a break (generalises hold-ground's points) |
| Auto-resolve | Gone. Every fight is fought live. Computer against computer fights happen on the map, visible under the fog rules like everything else |

### Why convoys rather than a ledger

The planet's trade was arithmetic on a turn. In real time the same numbers become a decision with a
cost: a rich route through contested ground pays more and needs an escort. That single change is the
place the three genres meet (a Settlers supply line, a Civ trade pact, a C&C raid target), which is
why it is worth building rather than a per-minute income line.

---

## 4. Presets

Every preset states every option (invariant 3); the harness compares key sets.

| Option | Battle | Frontier | Grand War | Epic |
|---|---|---|---|---|
| map size | as chosen (standard to continental) | huge | vast | continental |
| sides | 2 to 4 | 3 | 4 | 4 |
| cities | off | on | on | on |
| independent towns | 0 | 1 per side (3) | 2 per side (8) | 3 per side (12) |
| diplomacy | off | on | on | on |
| trade convoys | off | on | on | on |
| industry, supply, territory, production | as chosen | on | on | on |
| upkeep, seasons | as chosen | on | on | on |
| victory | conquest or hold | conquest, dominion | conquest, dominion, score | conquest, dominion, score |
| dominionShare / dominionMinutes | n/a | 60% / 10 | 65% / 12 | 70% / 15 |
| time limit (cities, then people) | none | 90 min | 4 h | 8 h |
| typical length | 20 to 60 min | about 1 h | 2 to 4 h | 4 h or more |

"Battle" with cities, diplomacy and convoys off is today's skirmish setup field for field.

---

## 5. Hard constraints found in the code (each is a gate, not a footnote)

1. **Four seats.** `Owner = 0 | 1 | 2 | 3` and `MAX_SIDES = 4` (`sim/rules.ts`). Every per-side
   array, the AI, saves and the renderer assume it. The planet allowed five factions. Grand War ships
   with four powers plus independents; independents are a non-seat owner, as neutral sites already
   are. Widening to five or six seats is a separate, costed decision after G5, not a side effect.
2. **The 512 KB save limit** (`shared/portal/server/saves.ts`, shared by every game). A four-sided
   Continental battle is 53 KB new and about 200 KB at ten minutes (83 KB of it units, 46 KB the
   commanders' memory). A four-hour Grand War will exceed it. G0 compacts unit and AI memory
   encoding before anything else is built; raising the portal limit is not on the table.
3. **Tick time.** Four-sided Continental, 430 units: median 6 ms, p99 30 ms. Cities and convoys add
   units. G0 adds a spatial index for target finding and separation (the items the 2026-11-27 log
   names as next) and sets the budget: p99 under 40 ms at 700 units.
4. **Purity.** New rules live in `src/sim/` under the same rules: no clock, no `Math.random`, refused
   actions return the same object, `createdAt` passed in. The diplomatic beat reads the tick.
5. **Sign-in and access.** Grand War is a save kind inside Fireline's existing endpoint. Nothing
   touches `getUser`, `api/play/[kind].ts` or the lobby gate.

---

## 6. Phases

Each phase ends with `npm run check` green, its own harness section in `npm run drive:fire`, and a
build log entry here. Balance-affecting phases also run `ladder:fire` at 150 seeds.

| Phase | Scope | Acceptance |
|---|---|---|
| G0 Foundations | Save compaction (units, commanders' memory); spatial index for targeting and separation; a `setup.grand` block, absent on every older save | A four-sided Continental save under 150 KB at 60 minutes in the ladder; p99 tick under 40 ms at 700 units; every pinned hash in `drive-size.ts` unchanged |
| G1 Cities | City record on the Command Yard and Field Yard; population from food and housing; level 1 to 5 with claim radius and district cap; Settler Wagon founding; independent towns with garrisons; dominion victory | 200 seeds of computer-only Frontier games: every city levels, no city founded on claimed ground, every independent town taken or absorbed in some seed, dominion fires correctly and conquest still wins outright |
| G2 Diplomacy | Adapters from `planet/diplomacy.ts` to `GameState`; stance per pair; treaties with terms and minutes; the diplomatic beat; temperaments on computer sides; allies stop targeting each other and share vision | A refusal and a legal case for every diplomatic action on deep-frozen states; every treaty transition and breach; trust stays in 0 to 100; replay exact |
| G3 Trade convoys | Routes between cities; convoy units on roads; pay on arrival; blockade when the road is cut; computer escorts and raids | Conservation (goods paid equal goods delivered); a cut road stops its route within one beat; raid and escort exercised in whole games |
| G4 Lobby and presets | One "New game" with the four presets; customise step; Continue for old skirmish and planet saves; diplomacy panel; city panel; guided first ten minutes | `npm run tours` with a new `fireline-grand` driver; `check:ui fireline` at 375 and 1440 in both modes; `check:loading` |
| G5 Balance and the computer | Temperament-driven grand strategy on top of the adaptive commander; dominion and score tuning | `ladder:fire` 150 seeds per preset and difficulty: difficulty order holds, seat spread within noise, under 2% of games unfinished at the cap |

---

## 7. What the owner gets at each stop

- After G1, Grand War is playable against silent computer powers: settle, grow, fight. That is the
  first point at which it is worth playing.
- After G2, the computer powers talk, ally and betray, which is what makes a long game strategic.
- After G3, the economy and the war share the same map, which is the full brief.
- G4 and G5 make it the default way to play and make the computer worth beating.

## 8. Open questions recorded, with the default taken

- Five or more powers: deferred (section 5.1). Default: four.
- Naval and air in Grand War: on, as in free play. Ports and airfields are city districts.
- A strategic zoomed-out view: the minimap plus a city list in G4; a full strategic overlay only if
  play shows the minimap is not enough on Continental.

---

## To do (ticked as each lands; the build log below says how)

- [x] G0 Save compaction (tables) and target finding by map cell
- [x] G1a `setup.grand` options and the four presets, every key stated
- [x] G1b Cities: population from food and housing, level 1 to 5, claim radius and district cap by level, workforce limited by population
- [x] G1c Settler founding: a Forward Base Truck founds a city on unclaimed ground away from other cities
- [x] G1d Independent towns with garrisons, taken by force
- [x] G1e Dominion victory and score at the time limit
- [x] G1f The computer founds cities and takes towns
- [x] G1g G1 harness sections, `npm run check`, build log, push
- [x] G2a Diplomacy: stances, treaties in minutes, trust, the 60-second beat, actions and refusals
- [x] G2b Diplomacy in battle (no fire between non-war pairs, allied vision) and computer temperaments
- [x] G2c G2 harness sections, check, log, push
- [x] G3 Trade routes and convoys: pay on arrival, raidable, blockade, computer escorts and raids, conservation tests
- [x] G4a Lobby: one New game with four presets; Continue for old skirmish and planet saves
- [x] G4b In-battle panels: cities, diplomacy, trade, dominion gauge (tokens in both modes, kit controls)
- [x] G4c Guided first ten minutes, `fireline-grand` tour driver, `npm run tours`, `check:ui`, `check:loading`
- [x] G5 Computer grand strategy; Frontier measured at 150 and 60-war rows; larger presets smoke-measured; `check:deep`; final log (open items below)

---

## Build log

### 2026-11-28: G0, foundations (saves and target finding)

Measured first, on a four-sided Continental battle with the full economy (`scripts/save-size.ts`,
seed size-1, the computer on every seat). The packed save before this phase: 92 KB at minute 10,
130 at 20, 152 at 30, 164 at 50. Units were more than half of it (about 360 bytes each, most of them
key names and idle defaults), the adaptive commanders' memory a fifth.

**1. Saves as tables** (`src/sim/pack.ts`, `packRows` and `unpackRows`). In a packed save (every map
wider than the balanced sizes: vast and Continental) units, structures and each adaptive commander's
`seen` and `sites` lists are kept as tables: each distinct key order once, each column's commonest
value once, and per object a mask and only the values that differ. Exact both ways: key order, every
value (denormals included), keys holding undefined left out as JSON leaves them, defaults returned as
fresh copies. A packed save carries `tables: 1`; one without it (every save made before) loads exactly
as it did; an unknown version or a malformed table is refused rather than loaded half-made. Nothing
changes for standard, large and huge battles, campaign missions or planet battles, which are never
packed. The server stores what the client sends and never reads units, so it needed no change.

Same battle, same seed, after: 49 KB at minute 10, 68 at 20, 81 at 30, 91 at 50 (about 45% smaller
throughout). A second seed (g0-long, the deep harness section) peaks at 126 KB in its first thirty
minutes. Unit positions are now most of what remains: full-precision floats, kept because rounding
would break exact replay through a save.

**2. Target finding by map cell** (`src/sim/tick.ts`, `nearIndex`, `nearCandidates`). `acquire`
tested every unit on the map, so its cost grew with the square of the armies. Units are now indexed
by 8-tile cell, built once a tick on first use; a search reads the cells round its square, widened by
a 3-tile margin, and visits the candidates in list order so it picks exactly the unit the full scan
picked, ties included. The unit loop moves each unit's entry after its update; anything after the loop
drops the index; a replaced units array is noticed by identity; units added during the loop are
scanned one by one. `npm run drive -- --near-check` runs the full scan beside every indexed search and
throws on any difference.

Tick time with a Grand War's crowd (`scripts/perf-crowd.ts`: minute 12 of the same battle, filled to
737 units, half of them attack-moving to the middle; 900 ticks, one per call, under `tsx`):

| | median | p95 | p99 |
|---|---|---|---|
| full scan (before) | 15.1 ms | 25.7 ms | 36.1 ms |
| by cell (after) | 13.0 ms | 24.1 ms | 32.7 ms |

The budget (p99 under 40 ms at 700 units) is met. The gain is modest because target finding was a
smaller share than the 2026-11-27 log assumed. The window's CPU profile puts the rest in route finding
(`tilePath`), the per-tick state copy, garbage collection and, only under `tsx`, the getters it
generates for module exports (about 15%, absent from the browser build). Those are the next
performance items if G1's cities push the crowd past this.

**3. Deferred to G1.** The `setup.grand` block is not added yet: an empty field with no rule behind it
would be dead weight in every save. It arrives with the first rule that reads it (cities).

**Checks.** `scripts/drive-grand.ts` (new, inside `npm run drive`): the table format (round trip, key
order, undefined keys, fresh defaults, wide objects, six malformed cases refused), saves as tables
(exact load, pre-table saves unchanged, unknown version and malformed tables refused, two minutes of
play identical after loading), and a deep-only thirty-minute battle saved and reloaded every five
minutes under 150 KB. `npm run drive -- --fast --near-check`: 348,770 assertions, none failed.
`npm run drive -- --near-check` (the deep tier, with every pinned byte-identical replay): 423,354
assertions, none failed, so the indexed search changed no battle anywhere. `npm run check`: all passed
(Fireline 348,770, campaign 7,713, War for the Planet 33,564, every other game's suite).

### 2026-11-28: G1, cities, founding, towns and dominion

**Options and presets** (`rules.ts`). `SkirmishSetup.grand?: GrandOptions` (preset, townsPerSide,
townStrength, diplomacy, trade, dominionShare, dominionMinutes, timeLimit) and `GRAND_PRESETS`
(Frontier, Grand War, Epic), each a full setup stating every key. `normaliseSetup` keeps the block only
with advanced tech, neutral sites and advanced production, and adds no key at all to any other setup,
so every older save, pinned hash and the Battle preset (today's skirmish) are untouched.
`normaliseGrand` replaces each bad value with its preset's.

**Cities** (`cities.ts`, `grand.ts`). A city is a Command Yard or Field Yard carrying `pop`. Every 30
seconds a city's population moves one toward the housing round it (its yard, and the Quarters nearer
it than any other of its side's cities; a hungry Quarters houses half), never under its floor, its
yard's own housing. Level 1 to 5 at 16, 28, 44 and 64 people; each level widens the city's claim by two
tiles and its district cap (structures that need a crew) is 3 plus 2 a level.

A first model made the population a stock that capped the workforce and grew by spending food. It
deadlocked the economy in play: Quarters eat whether or not anyone lives in them, so food ran out, cities
starved, and the computer sat on 50,000 credits with nothing to build with. The model kept builds on the
economy that already works: the workers are the existing housing rule; the population follows fed
housing, and is what levels a city and what it pays to found another. Food matters because a hungry
Quarters halves its housing and the city shrinks.

**Founding.** A Forward Base Truck deploys into a city only at least 22 tiles from every city and town,
and only while a city can spare 6 people above its floor; the new city starts at 6. A city cannot pack
up. Refusals return the same state.

**Towns.** `townsPerSide` independent towns (a new site kind, 3 by 3, outside `SITE_KINDS` so no
existing placement stream moves), placed from every legal spot in side 0's share of the map with the
map's own symmetry: every side's nearest town is at the same distance (within 1.5 tiles; 6 on three-sided
maps, as the sites). A town's militia (1,500 times townStrength) fires on every unit in reach while
independent and is worn down by the fire of the units round it, worked out as a siege; at nothing,
infantry take it as a neutral site. Held: it pays 30 credits every 5 seconds, houses 8 workers, claims 8
tiles round it, counts as a city, and its militia regrows to half. A first search along the line from
the yard to the middle found no ground on coast and canyon maps; the share-wide search places every
preset on every seed tried.

**Dominion and the time limit.** A team holding `dominionShare` of all cities (towns included) for
`dominionMinutes` without a break wins; at `timeLimit` the team with most cities wins, level teams play
on; conquest still wins outright.

**The computer** (`aiGrand.ts`). Every other wave, or any wave for which a town is nearer than the
enemy it was aimed at, takes a town and keeps to it until its team holds it (the first version re-aimed
at the enemy base every decision once under way, and never touched a town). Capture parties leave
garrisoned towns to the waves. From minute 8 it wants a city more every 15 minutes up to four, and its
expansions go ahead for that without a second Refinery, on ground a city may stand on. Its build plan
skips a district while every city is full and builds Quarters instead (it had stalled on a district it
could not place and never reached the Comms Uplink the truck needs), and puts districts by a city with
room.

**Measured** (computer-only, Normal): Frontier seed g1-a, cities level 3 by minute 25, all three towns
taken by minute 25 and changing hands after; Grand War seed g1-b (four sides, vast), every town attacked
and four taken by minute 35; a side founded two cities by minute 28. Battles still end by conquest at
about 30 minutes: the dominion clock and the balance of a long game are G5's.

**Not yet.** Towns draw with the Comms Relay's art at 2 by 2 until G4b gives them their own. The
computer founds slowly when poor (the truck costs 2,500 and the fund saves half its credits): G5.

**Checks** (`scripts/drive-grand.ts`, in `npm run drive`): presets (every key, own normal form, the
block dropped without its needs, junk values), the start on every preset and three seeds (cities, town
count, clear ground, fair distances, the same placement every time), cities (growth by the beat, filling
housing, level, a wider claim, shrinking to the floor, the district cap and its refusal), founding (too
close to a city or a town, no settlers to spare, a legal founding through `processAction` with the
input untouched, a city refusing to pack up, refused actions returning the same state), towns (fire,
siege, broken then taken, income, a city for dominion, claimed ground, regrowth to half, no capture
while garrisoned), dominion (clock, a break, victory at the time), the time limit (level plays on, most
cities wins), saves (exact, junk repaired, fields dropped outside a Grand War) and, deep only, three
whole computer Frontier battles checked every minute plus an exact replay: 125 assertions.
`npm run check`: all passed, Fireline 348,890 assertions.

### 2026-11-28: G2, diplomacy in real time

`src/sim/grandDiplomacy.ts`. The planet war's rules and numbers, read in minutes: stance per pair (war,
ceasefire, trade pact, alliance), trust 0 to 100 drifting each 60-second beat, temperaments
(expansionist, mercantile, defensive) drawn per computer power from the seed, proposals judged on
strength, fronts, temperament, interest in war and trust, and accepted at the planet's thresholds.
Treaties run 10, 15 and 20 minutes and must be renewed; one that runs out steps down (an alliance or a
pact to a ceasefire, a ceasefire to war) with trust up for a treaty kept. War through a running treaty
is a breach: the victim's trust falls 40, everyone else's 15.

**In battle.** The stance is a 16-character string on `s.grand`, read by `isEnemy` and `isAlly`
(`sides.ts`), so every system that asks "is that an enemy?" obeys it with no change of its own: target
finding, splash, the computer's choice of enemy, allied sight, sites and towns. Target finding and splash
used to compare teams directly; they now ask `isEnemy`, which is identical without diplomacy. Victory
counts every power not allied with the player as standing in the way (peace is not victory). Signing peace
drops any attack the two sides had under way. A site held by a power at peace is not captured from it.

**The player** proposes, renews or declares war (`diplomacy` action) and answers offers (`answer`). A
proposal is judged at once and a refusal names only the reasons against (a first version also listed
reasons for peace, such as "they are fighting on several fronts", in a refusal). **The computer** makes at
most one move a beat: a breach if its temperament breaks treaties and its war interest is high, a renewal,
or a step up toward peace. Under the harness's autopilot side 0 answers as a defensive power would, so
computer-only runs measure the same diplomacy a player meets.

**What the whole-battle runs show.** Treaties are made (23 steps toward peace across three Frontier battles),
but once everyone is at peace nobody returns to war, and all three battles were unfinished at 40 minutes.
Frontier now has a 90-minute time limit so a peaceful war still ends; making war worth declaring again is G5.
A crash found the same way: peace signed while a wave was gathering left it nothing to aim at; such a wave
now goes for a town, or stands down.

### 2026-11-28: G3, trade convoys

`src/sim/grandTrade.ts`. A route joins two of a side's cities or held towns, or one of its cities to a
partner's (trade pact or alliance). Opening one costs 600 and sends a convoy, a Supply Truck that drives to
the far end, is paid on arrival and drives home to go again; a lost convoy is replaced after a minute for 300;
a route whose end falls, or whose partner is no longer at peace, closes. One route per city or town held.
A home trip pays 6 credits a tile and a food every 15 tiles, a foreign one 8 a tile and the partner 3, each
with a bonus of 1% a tile for length. The first rates (2 and 3 a tile, no bonus) paid 50 credits a trip on a
25-tile route, too little to matter, and paying by the tile alone made income a minute independent of length
(the trip takes as long as it pays), so the long route a raider has more ground to catch paid no more. Now a
25-tile home route pays 188 a trip and a foreign route of the same length 733, with 275 to the partner.

The computer opens the best-paying route it can afford once a minute (foreign first), and its raiders hunt
enemy convoys as they hunt haulers. A convoy given another order goes there and takes its route up again
once idle; Supply Truck errands leave convoys alone.

**Checks** (`drive-grand.ts`): G2, the start on every preset (all at war, trust 50, temperaments, the same
each time; no table with diplomacy off), peace and war in battle (no fire at a ceasefire, fire at war, peace
dropping attacks under way), every refused action returning the same state, an accepted and a declined
proposal, the cool-down, a breach and its trust, expiry and step-down, an offer accepted and declined, saves
(exact; a lopsided table or trust out of bounds rebuilt), and deep whole battles (table symmetric and trust
in bounds every minute, exact replay). G3, every refusal, opening, the convoy shuttling, conservation (paid
equals trips times the trip's value), a lost convoy replaced at a price, a lost city closing its route, closing
by hand, a foreign route paying both and closing at war, saves, and deep whole battles in which the computer
opened 19 routes. `npm run check`: all passed.

### 2026-11-28: G4, the lobby, the war's panel and the guided run

**Lobby** (`pages/Lobby.tsx`). Section 02 is now Grand War: three preset cards (powers, map size, towns,
dominion share and time, time limit), the rivals' difficulty, a summary, a name and Begin the war. Section
03, the single battle, is labelled the Battle preset and is unchanged. "New war" (War for the Planet's setup)
is gone; wars begun before stay listed under the Grand War section and open as before. The battle's and the
war's Begin buttons have their own busy flags (`check:loading` caught the shared one putting a busy ring on
both).

**In battle.** A Grand War gauge in the sidebar (cities held against the total and the number needed, the
dominion clock either way, offers waiting) opens the war's panel (`components/GrandPanel.tsx`): Cities
(population, level, housing, districts against the cap, towns held, the dominion and time-limit lines),
Diplomacy (each power's temperament, stance and minutes left, trust both ways, a button for each step with
the rules' own reason when it is refused, offers to accept or decline) and Trade (routes with trips, credits
paid and the convoy's state, and a new route between two ends with what a trip pays). Every button sends an
ordinary action. Opening the panel closes the build window (the tour driver found the window lying over the
panel and swallowing its clicks); Escape closes it. Towns are drawn 3 by 3 as a cluster of roofs round a
square, with a bar for their militia. Powers are named as the battle names them (an early version invented
"The Third Power" beside the header's "Verdant Front"). Styles use existing tokens only.

**Guided run** (`components/GuidedTour.tsx`). In a Grand War the guided first battle gains two steps before
its closing card: the war's gauge (read), then "Offer peace on one front" (open the panel and propose a
ceasefire). The step completes on the proposal, never on the answer: the first version waited for a ceasefire
to be signed, and in the full tour matrix on a busy machine the run reached the step later, both rivals had
grown stronger and declined, and the step could not complete. The closing card speaks of founding, towns,
trade and treaties. Its own seen flag (`fireline_grand_tour_seen`), so a player who did the battle's run is
still offered the war's.

**Tours.** `scripts/tours/fireline-grand.cjs` runs the battle's driver in a Grand War mode: it begins a
Frontier war from the lobby, walks every step, opens the panel, proposes, closes it, checks the card hid and
came back on the same step, and checks the save for the proposal. War for the Planet's driver
(`fireline-planet.cjs`) is retired with new wars: no war can be begun to play it.

**Manual** (`pages/HowToPlay.tsx`). A Grand War section from the same numbers the game reads; War for the
Planet's section is marked as for wars begun before.

**Checks.** `npm run tours -- --quick`: all eight drivers pass. `npm run check:ui -- fireline`: 32 of 32 (its
battle is a skirmish, so the panel was checked by hand in Chromium, dark mode at 1440 and 390: no sideways
scroll, no page errors). `npm run check:loading`: 184 of 184. `npm run check`: all passed.

### 2026-11-28: G5, the computer's grand strategy and the first balance pass

`scripts/grand-ladder.ts` plays whole computer wars per preset and difficulty (side 0 under the autopilot,
which answers offers as a defensive power) and reports the endings, length, seats, treaties, wars, founding,
towns and trade. What it found, and what changed, in order:

1. **Peace froze the map.** Six treaties signed a war and none ever broken or left to lapse: computer powers
   at peace renewed every treaty, and the only wars were the opening ones. A power that wants war now lets
   the treaty in its way run out instead of renewing it, and a power with no independent town left and no
   more cities than a neighbour gains war interest ("no room to grow": 25 for an expansionist, 10 for the rest).
2. **At peace, nobody took a town.** A wave formed only with an enemy to aim at, so once everyone was at peace
   the towns stayed independent and the pressure in (1) never arrived. A wave now forms for any free town
   (independent, or held by a power at war with it), keeps to it until taken, then comes home so the next can
   form (with no enemy the wave had stood where it took the town for the rest of the war).
3. **Then the first to grab towns simply won.** 83% of Frontier wars ended by dominion at a median 39 minutes,
   with 0.3 wars declared a war. A power within 10 points of the dominion share now draws 40 war interest from
   every other, and once its dominion clock runs any temperament will break a treaty to stop it. Frontier's hold
   went from 8 to 10 minutes, to give the coalition time.
4. **Level at the time limit played on past it** (17% of a small run unfinished): a level count of cities is now
   decided by population, and only a level on both plays on.

**Frontier, Normal mirror, 150 wars** (prefix gl, cap 100 minutes): dominion 44%, conquest 30%, time 25%,
unfinished 1% (target under 2%). Median 47.7 minutes, quartiles 34 to 90. Side 0, the player's seat, won 31%:
a fair third. 7.0 treaties signed a war, 1.6 wars declared or resumed (1.2 of them breaches), 4.1 cities founded,
2.6 towns held at the end, 60 trade trips.

The seat spread the first report printed (seat 1 58%, seat 2 11%) was the ladder's error, not the game's: when
side 0 loses its last structure the engine names the lowest surviving seat the winner, so seat 1 collected every
war the player's seat lost by elimination. The ladder now reports eliminations apart and the spread only over wars
with a real winner.

`npm run check`: all passed (Fireline 348,966). Deep tier with the exactness check: 423,565 assertions, none
failed, so none of this moved an ordinary battle.

### 2026-11-28: G5, fairness and the measurements on the final build

**Seat 2 was the odd one out of every alliance.** Among wars with a real winner, seat 2 won 13% (seats 0 and
1 most of the rest) on two seed sets. It won time-limit endings as often as seat 1 (9 each) but dominion almost
never (3 against 22). Every beat the computer powers moved in seat order and tried partners in seat order, so
seat 1 had first pick of allies every beat. Both orders now rotate with the beat (`rotate`, grandDiplomacy.ts).
The ladder also credited an alliance's win to its lowest seat; it now records the whole winning alliance and
shares the credit. After both: seats 28%, 30% and 42%, within the noise of 60 wars.

**Frontier, final build** (prefix order, 60 wars a row, cap 100 minutes; the player's seat at Normal under
the autopilot, which answers and proposes as a defensive power; a win counts sharing in a winning alliance):

| Rivals | Player wins | Player eliminated | Dominion / time / conquest | Median length |
|---|---|---|---|---|
| Easy | 70% | 5% | 62% / 25% / 8% | 38.8 min |
| Normal | 38% | 17% | 58% / 22% / 3% | 48.3 min |
| Hard | 35% | 17% | 53% / 22% / 8% | 48.2 min |

None unfinished. Every row: about 7 treaties signed, 1.8 wars declared or resumed (1.3 breaches), 4 cities
founded, 2.5 of 3 towns held at the end, 45 to 64 trade trips. Easy against Normal is clear; Normal against Hard
is not separable at 60 wars. Hard's income bonus reaches every rival (`tick.ts`), but a Grand War turns more on
towns and alliances than on income.

**Epic** (4 wars to minute 60 of 480; a smoke run): no failure; 16.5 treaties, 9.8 cities founded, 10.8 of 12
towns held, 71 trade trips a war. One Epic war's packed save, every ten minutes to minute 60: 41, 54, 86, 80, 134
and 94 KB, each reloading exactly; the largest 134 KB of the portal's 512 KB, inside G0's 150 KB target.

**Grand War preset** (12 wars, capped at 130 of 240 minutes): dominion 50% at a median of 108 minutes, 17% still
running at the cap, the player's seat eliminated in 33% and winning 8%; 19 treaties, 4.2 wars (3 breaches), 6.8
cities founded, 7.6 of 8 towns held, 112 trade trips a war. Twelve wars carry about 25 points of noise, so this
says nothing firm, but it is a flag: in a four-power war the defensive autopilot may be a poor stand-in for a
player, or the player's seat may be weaker; only a larger run tells which.

**Checks on the final build.** `npm run check`: all passed (Fireline 348,966). Deep tier with the exactness
check: 423,565 assertions, none failed. Tours, `check:ui` and `check:loading` as in G4 (no client change since).

**Open, in order of what to do next.**
1. Grand War preset at 150 wars to the full 240 minutes (about 40 hours of computer time at four cores, so a
   nightly job, not a session), and a four-power run with side 0 at each temperament to separate the seat from
   the autopilot's diplomacy.
2. A Hard lever that bites in a Grand War (sharper town-taking or diplomacy rather than income), then Normal
   against Hard at 150 wars a row.
3. The computer founds slowly when poor (the truck's price is saved half a decision at a time).
4. Five or more powers (section 5.1): deferred, as decided.
