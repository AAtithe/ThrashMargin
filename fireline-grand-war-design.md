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
| independent towns | 0 | 4 | 8 | 14 |
| diplomacy | off | on | on | on |
| trade convoys | off | on | on | on |
| industry, supply, territory, production | as chosen | on | on | on |
| upkeep, seasons | as chosen | on | on | on |
| victory | conquest or hold | conquest, dominion | conquest, dominion, score | conquest, dominion, score |
| dominionShare / dominionMinutes | n/a | 60% / 8 | 65% / 12 | 70% / 15 |
| time limit (score) | none | none | 4 h | 8 h |
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

## Build log

(none yet)
