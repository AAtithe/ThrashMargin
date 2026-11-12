# Fireline: long campaigns, and what to build next

Status (2026-11-10): proposal. Nothing here is built. Written in answer to "I want the option of
playing very long campaigns" and "what other features can we add into the game".

Companion documents: `fireline-design.md` (rules, engine, build log), `fireline-campaign-design.md`
(the fourteen-mission story campaign, Commander and heroes), `fireline-round4-design.md` (sides,
air, research, act two). A fifth round on development lines (a research tree with Mk I to Mk III
upgrades, doctrine forks and vehicle loadouts, `fireline-round5b-design.md`) is being designed in
parallel; this proposal is written to sit on top of it and says where it depends on it.

---

## Summary for the reader in a hurry

- **What exists today.** A fixed story campaign of 14 hand-made missions (two acts), a Commander
  who ranks up and buys perks, four heroes who level up between missions, and a skirmish mode with
  six kinds of generated map, two to four sides, air power and research. A story campaign takes
  roughly 5 to 7 hours and then it is over.
- **What we recommend.** A second campaign mode, **Theatre of War**: a generated war map of
  territories, fought over turn by turn. Each turn the player chooses where to attack; the battle is
  built automatically from the map generator and the mission objectives the game already has. The
  army, its veterans, the heroes, the research and a war chest all carry from battle to battle,
  and the enemy strikes back. The player picks a length: Short (about 3 hours), Long (about 8) or
  Very long (15 hours or more), and every campaign is different because it is grown from a seed.
- **Why it is cheaper than it sounds.** About 70 per cent of what it needs is already in the code:
  battle setup from a specification, twelve kinds of objective, four enemy behaviours, six map
  generators, hero and Commander carry-over, saves that hold a whole campaign in one row, and a
  deterministic engine that can play itself. The new work is the strategic layer, a battle
  generator, and the screens.
- **Size.** Seven workstreams, about the size of round 4 in total. Built in four phases.
- **Other features.** Twelve ideas, ranked by value for cost; the top three are small and could be
  built alongside the long campaign.

---

## 1. Theatre of War: the recommended long-campaign design

### 1.1 What the player does

1. **Start.** In the lobby's Campaign panel, a second button: **New theatre**. The player names the
   Commander, picks a length (Short, Long, Very long), a difficulty, and optional rules (section
   1.9). A seed is shown and may be typed, so a friend can play the same war.
2. **The war map.** A map of 12 to 60 territories (by length) with the Meridian Corps holding a
   corner and the Ashen Combine holding the rest, its capital at the far side. Territories have a
   terrain (which picks the battle map type), a value (supply per turn) and sometimes a feature:
   a refinery town (more supply), a depot (cheaper replacements), a research station (unlocks
   research), an airfield (unlocks air), a fortress (a hard battle against a full base), a
   hero's trail (a hero mission).
3. **A turn.** The player spends supply (reinforce the army, research, heal heroes, garrison a
   border), then picks one enemy territory next to their own and attacks it. Optionally, a second
   front can be resolved automatically.
4. **The battle.** A normal Fireline battle, generated for that territory: its map, its objective,
   its enemy strength. The player's starting force is their **core army** plus whatever they bought.
5. **The result.** Win and the territory changes hands. Lose and the army falls back, losses
   counted. Veterans who survived keep their rank; heroes keep their xp; the fallen are gone.
6. **The enemy's turn.** The Combine reinforces and may counter-attack a weak border territory. The
   player can fight that defence, or let the garrison resolve it automatically.
7. **The end.** Capture the enemy capital (a finale on Hard against every structure). Defeat comes
   only if the home territory falls, so a long war is never lost by one bad battle.

### 1.2 What it reuses, and what is new

| Element | Already in the code | New work |
|---|---|---|
| Building a battle from a description | `createMissionState(spec, ctx)` in `src/sim/mission.ts` takes a `MissionSpec` and a `MissionContext` | A generator that writes the `MissionSpec` for a territory (section 1.4) |
| Objectives | Twelve kinds in `ObjectiveSpec` (`src/sim/types.ts`): destroyAll, destroy, survive, keepAlive, infiltrate, capture, reach, holdZone (with reset), harvest, build, escort, destroyWithin | None; templates combine these |
| Enemy behaviour | `AiMode`: normal, defend, raid, passive, plus outpost and full base | None for the first version |
| Maps | `generateSkirmishMap(seed, type, ore, sides)` in `src/sim/maps.ts`: six types, checked by `mapProblem` | Missions today use the original generator only (`generateMap`), so missions need an optional map type |
| Carry-over | `CampaignState` (`src/campaign/types.ts`): Commander xp, perks, heroes with xp and wounds, unlocked tech | A core army, supply, territories, strategic research |
| Rules for a refused move | `buyPerk` returns the same object when it cannot be bought, as the engine does | The same pattern for every strategic action |
| Saves | One row per campaign (`CampaignSave`, `kind: 'campaign'`), created by `POST /api/play/fireline` | A new kind, `'theatre'`, beside it |
| Playing a battle without a human | `autopilot` in `GameState`: the computer plays side 0, used by every harness | Auto-resolve (section 1.7) |
| Seeded dice | `src/sim/rng.ts`: `next`, `stream`, `seedFromString` | Used by the strategic layer too |

### 1.3 The war map

- **Generated, not drawn.** A pure function `generateTheatre(seedText, length)` scatters territory
  centres on a canvas-sized plane with a seeded stream, links neighbours (each territory touches
  2 to 5 others), and checks the result the way `mapProblem` checks a battle map: the home and
  the capital are far apart, every territory is reachable, there are at least two routes to the
  capital (so the player has real choices), and features are spread out rather than clumped.
- **Size by length** (numbers to be tuned by the harness):

  | Length | Territories | Battles to win (typical) | Play time (typical) |
  |---|---|---|---|
  | Short | 12 | 8 to 10 | about 3 hours |
  | Long | 28 | 18 to 24 | about 8 hours |
  | Very long | 60, in two or three regions | 40 to 55 | 15 hours or more |

  "Battles to win" is less than the territory count because cut-off enemy territories surrender
  (section 1.6) and some battles are auto-resolved.
- **Regions for Very long.** A Very long war is split into two or three regions, each with its
  own enemy general and capital, opened one after another, so the war has chapters and the
  difficulty can rise between them (a natural use of the act-two pattern already on the campaign
  screen, `campaignActOf` in `src/game/campaignArt.ts`).
- **Drawn by the existing art style.** `src/game/campaignArt.ts` already draws theatre maps with
  canvas paths (coast, fjords, forest, ranges). A new `drawTheatreMap(ctx, w, h, territories)`
  draws regions, borders, ownership colours and features in the same style. No image files.

### 1.4 How a battle is generated

A new pure module, `src/campaign/theatre/battles.ts`, turns (territory, attacker strength,
defender strength, turn number, seed) into an ordinary `MissionSpec`.

- **The map.** The territory's terrain picks the `MapType` (river country gives a river map,
  hills give highlands, and so on). The battle seed is `"<theatre seed>:<turn>:<territory id>"`,
  so the same war always produces the same battle. Missions need one new optional field,
  `MissionSpec.map?: { type: MapType; ore?: OreLevel }`; when present, `createMissionState` calls
  `generateSkirmishMap` instead of `generateMap`. Absent, nothing changes, so the 14 story missions
  replay byte-identically.
- **Objective templates.** Each territory gets one template, picked by its feature and the seed.
  Every one uses objective kinds that already exist:

  | Template | Objectives | Enemy |
  |---|---|---|
  | Assault | destroyAll | outpost, defend or raid |
  | Seize the ground | holdZone (on the ore field nearest the middle) | raid |
  | Strike | destroyWithin on a Generator or Refinery | defend |
  | Sabotage (a hero's trail) | infiltrate or destroy, then reach, keepAlive on the hero | passive outpost |
  | Capture (depot or research station) | capture the key structure with the Engineer, or destroy it | defend |
  | Convoy | escort along the shortest walk between two points | raid |
  | Hold the line (defending) | survive or holdZone with reset | raid, enemy waves by trigger |
  | Fortress | destroy the Command Yard; bonus destroyAll | full base, normal |

- **Where the points go.** Story missions use coordinates picked by hand and checked by
  `scripts/campaign-check.ts`. A generated battle cannot do that, so it finds its points from the
  map: hold zones on ore field centres (`oreFields`, `fieldCentre` in `maps.ts`), convoy routes
  from `shortestWalk` between bases, a flanking point from `secondRoute`, extraction points at the
  map edge furthest from the enemy. The campaign check's "in bounds, open ground, open neighbours"
  test moves into a shared helper in `maps.ts` so the generator can use it and retry with the next
  candidate. If no template fits a map (rare), it falls back to Assault, which needs no points.
- **Strength.** Enemy starting units, structures and credits come from the territory's garrison,
  which grows each enemy turn and with distance from the player's home. The player's side is the
  core army plus purchases. Difficulty (easy, normal, hard, already in `DIFFICULTIES` in
  `rules.ts`) rises by region.
- **Stars and bonuses** are generated the same way (harvest, build, keepAlive on a hero, a faster
  destroyWithin) and pay extra supply rather than skill points.
- **Tech allowed** is the theatre's unlocked tech, so features like the airfield and research
  station decide when air power and research appear, which paces a long war.

### 1.5 What carries between battles

- **The core army.** Up to a cap of units (8 on Short, 12 on Long, 16 on Very long) are the
  player's standing force. They start each battle, and the ones still alive at the end come home
  with their kills and rank (`Unit.kills` and `Unit.vet` exist today; `VET_KILLS` is 3 and 7). A
  unit lost in battle is gone. Units built during a battle can be **promoted** into the core
  after a win, if there is room, so a lucky Flame Tank with seven kills can become an Elite
  regular. Engine changes: an optional `core?: number` field on `Unit` (a roster slot), an
  optional `core?: { kind; kills }[]` on `MissionContext`, and the survivors listed in
  `MissionOutcome`. All optional, so old saves and story missions are untouched.
- **Heroes.** Exactly as now: xp and level carried, wounded heroes start at half health
  (`HeroRecord` in `campaign/types.ts`). In a theatre a wounded hero can also be rested for a
  turn, or healed with supply. With the optional Iron rule (section 1.9), a hero who falls is lost
  for the rest of the war.
- **The Commander.** The same skill tree (`PERKS` in `progression.ts`). A long war outruns today's
  six ranks (General at 4,500 xp), so a theatre adds ranks above General that pay points, and the
  three or four most popular perks get higher levels. The story campaign's Commander is separate
  and unchanged.
- **Research.** Today research is bought inside a battle and lasts only that battle
  (`PlayerState.upgrades`, `src/sim/research.ts`). In a theatre, research is bought with supply
  between battles and every battle starts with it already done: a new optional
  `MissionContext.upgrades` fills `players[0].upgrades` at the start. When round 5's tree of
  Mk I to Mk III upgrades and doctrine forks lands, the theatre uses it directly: a doctrine is
  chosen once per war (or once per region on Very long), which is the kind of long-term choice a
  long campaign needs. Until round 5 lands, the five current upgrades are enough.
- **What does not carry.** Structures. Every battle starts from the core army and a Command Yard
  (or none, on a hero mission). Carrying bases would make saves large and battles samey.

### 1.6 The economy between battles

- **Supply** is the war chest. Each owned territory pays supply every turn (more for refinery
  towns); a win pays a bounty, each star pays extra.
- **Spent on:** replacing core units (cheaper at a depot), starting credits for the next battle,
  strategic research, healing heroes, garrisons that defend a border automatically, and
  fortifying a territory (its defence battle starts with turrets or walls).
- **Supply lines.** An enemy territory cut off from its capital stops being reinforced, and after
  two turns surrenders without a battle. This shortens long wars for players who plan, and it is
  the main reason Very long stays playable.
- **No haggling screens.** Every spending choice is one button with a stated price and effect,
  in the style of the existing perk screen.

### 1.7 The enemy strikes back

- **A strategic opponent**, `src/campaign/theatre/enemy.ts`, pure, taking the theatre state and
  returning the next. Each enemy turn it reinforces garrisons (more on harder difficulty and later
  regions), and every few turns launches a counter-offensive at the player's weakest border
  territory, more often after the player wins quickly.
- **Defence battles** use the Hold the line template. The player may fight it, or let the garrison
  auto-resolve it.
- **Auto-resolve.** The engine can already play both sides (`autopilot`). Auto-resolve runs the
  generated battle with the computer playing the player's side, at full speed, in a Web Worker so
  the page stays responsive, and applies the result exactly as if the player had fought. It is
  deterministic, so a reload does not change the result. A typical 15-minute battle is about
  9,000 ticks; the harnesses run whole battles in a few seconds each in Node, so a few seconds in a
  browser is the target. If that proves too slow on phones, a fallback formula (army value,
  veterancy, garrison, terrain, plus one seeded roll) resolves it instantly; the harness keeps the
  formula honest by comparing it with real simulated results over many seeds.
- **Enemy generals.** Each region's enemy is a named general with a style that sets the
  strategic opponent's habits and the battle AI mode it prefers (a raider favours `raid`, a
  turtle `defend`). This grows naturally into feature 4 in section 2.

### 1.8 Saves, size and determinism

- **A new save kind.** `TheatreSave` with `kind: 'theatre'`, beside today's `CampaignSave`. The
  story campaign's saves are not touched, so every existing save loads exactly as now.
  `migrateTheatreSave` follows the pattern of `migrateCampaignSave` in `campaign/save.ts`: every
  field read defensively, unknown values dropped, a fresh default for anything missing.
- **What the row holds:** the seed and the length; territories (owner, garrison, fortification;
  the map itself is regenerated from the seed, never stored); the core army roster; heroes;
  Commander; supply; research; the turn number; a capped war journal (the last 50 entries); and
  the battle in progress, if any.
- **Size budget.** The portal allows 512 KB per save and 25 MB per account
  (`shared/portal/server/saves.ts`). Measured today: a story battle's state is about 21 KB at the
  start of First Light and 34 KB at the start of Last Light; the largest save any harness produces
  is about 76 KB. A Very long theatre's strategic part is estimated at 15 to 25 KB (60 territories
  at about 80 bytes, 16 core units, a 50-entry journal). With a battle in progress and a three- or
  four-sided map (up to 96 by 96 tiles), the worst case should stay under 150 KB. The harness
  asserts a hard budget of 200 KB at every turn of every Very long run, so a slow creep is caught
  long before the limit.
- **Saved when.** After every strategic action and every battle result (so closing the tab never
  loses a turn), and every 15 seconds during a battle, as now.
- **Server.** `packages/fireline/api/game/index.ts` gains `mode: 'theatre'` on create, a status
  and turn for the saves list (turn = turns played, status victory or active), and returns `kind`
  so the lobby can label it. The account and game-access checks in `api/play/[kind].ts` and
  `getUser` are untouched; the server stays a store, as everywhere on the portal.
- **Deterministic.** Everything strategic lives in `src/campaign/theatre/` and follows the same
  rule as the engine: no `Math.random`, no clock, dice from `rng.ts` against a seed held in the
  state, the time passed in by the caller, and a refused action returns the same object. The same
  seed and the same choices give a byte-identical war, which is what lets a harness play whole
  campaigns as a real test.

### 1.9 Options and presets

Each length is a preset that states every option explicitly, as the project requires for rule
toggles (the harness asserts it, so a new option cannot slip in by omission):

| Option | Short | Long | Very long |
|---|---|---|---|
| Territories | 12 | 28 | 60 |
| Regions | 1 | 1 | 3 |
| Core army cap | 8 | 12 | 16 |
| Auto-resolve allowed | yes | yes | yes |
| Iron rule (fallen heroes are lost, no retry) | off | off | off |
| Enemy counter-offensives | every 4 turns | every 3 turns | every 3 turns |
| Supply-line surrender | on | on | on |

The player may change the optional rules (Iron, auto-resolve, counter-offensive frequency) at the
start; the preset's values are the defaults shown.

### 1.10 Files that change

| File | Change |
|---|---|
| `src/sim/types.ts` | Optional `MissionSpec.map`, `Unit.core`, `MissionContext.core` and `upgrades`, core survivors in `MissionOutcome` |
| `src/sim/mission.ts` | `createMissionState` uses `generateSkirmishMap` when `spec.map` is set; places core units with their kills and rank; applies starting upgrades; `missionOutcome` lists core survivors |
| `src/sim/maps.ts` | A shared "is this point usable" helper, moved from `scripts/campaign-check.ts` |
| `src/campaign/theatre/` (new) | `types.ts`, `generate.ts` (war map), `battles.ts` (battle generator), `turn.ts` (player actions and the reducer), `enemy.ts` (strategic opponent), `economy.ts`, `autoResolve.ts`, `save.ts` |
| `src/campaign/progression.ts` | Ranks above General for theatre Commanders (story ranks unchanged) |
| `packages/fireline/api/game/index.ts` | Create, list and status for `kind: 'theatre'` |
| `src/hooks/useSaves.ts`, `src/pages/campaignSaves.ts`, `src/pages/Lobby.tsx` | New theatre button and setup, saves list label |
| `src/pages/Theatre.tsx` (new) | War map, territory panel, spending, army roster, enemy turn report |
| `src/pages/GameScreen.tsx`, `src/components/CampaignHud.tsx` | Core units marked in battle; debrief shows survivors, promotions and supply |
| `src/game/campaignArt.ts` | `drawTheatreMap` |
| `src/styles.css` | New colour tokens for territory ownership and features, in both light and dark blocks |
| `src/workers/autoResolve.worker.ts` (new) | Runs auto-resolve off the main thread |
| `scripts/drive-theatre.ts` (new), `scripts/check.sh`, `package.json` | The harness (section 1.11) |
| `scripts/tours/fireline.cjs` | A short first-turn tour of the war map |
| `fireline-design.md`, `fireline-improvements.md` | Build log and checklist |

### 1.11 How we know it works

- **`npm run drive:theatre`** (new, in `npm run check`): plays whole Short wars over 20 seeds with
  a scripted strategic player and auto-resolve, and checks: the same seed replays byte-identically;
  every generated battle builds and runs 2,000 ticks; every generated objective point is usable;
  refused actions return the same object; supply never goes negative; the save stays under budget;
  an old story-campaign save and an old skirmish save still load.
- **`npm run ladder:theatre`** (new, not in check, like `ladder:fire`): Long and Very long wars over
  150 seeds per difficulty, for balance: how often and how fast the computer wins a war, and whether
  difficulty stays in order. The project's rule is 150 seeds or more for any win-rate comparison.
- **Non-regression.** The story missions' and skirmish lines of `npm run drive:fire` stay exactly
  as they are; `npm run campaign:fire` keeps passing with all 14 missions unchanged.
- **In the browser**, light and dark: lobby, new theatre, war map, a battle, the debrief, an enemy
  turn and an auto-resolve; and `npm run tours` for the new tour.

### 1.12 Workstreams and sizes

Sizes: small is about a day of one builder; medium two to three; large four or more.

| Workstream | Owns | Size |
|---|---|---|
| **T0 Contract** | The new types and function stubs, committed first, as rounds 2 and 4 did | small |
| **T1 Strategic core** | `src/campaign/theatre/` except battles and auto-resolve: war map generation, turns, economy, enemy | large |
| **T2 Battle generator and engine hooks** | `battles.ts`; the optional fields in `sim/types.ts` and `sim/mission.ts`; the point helper in `maps.ts` | large |
| **T3 Saves and server** | `theatre/save.ts`, `api/game/index.ts`, `useSaves.ts`, saves list | small to medium |
| **T4 Interface and art** | `Theatre.tsx`, lobby setup, debrief changes, `drawTheatreMap`, colour tokens, tour | large |
| **T5 Auto-resolve** | `autoResolve.ts`, the worker, the fallback formula and its calibration | medium |
| **T6 Harness and balance** | `drive-theatre.ts`, `ladder:theatre`, tuning the numbers in T1 and T2 | medium |

---

## 2. Other features worth adding, ranked by value for cost

Ranked so that the best return for the effort comes first. Costs use the same scale as above.

**1. Aircraft repair at the Helipad.**
What: a damaged aircraft that lands to rearm is also mended. Why: today a damaged Gunship stays
damaged for the whole battle (an open item in `fireline-improvements.md`), which feels like a bug
to players and matters more in a long campaign where aircraft can become veterans. Cost: small
(`src/sim/air.ts`). Risk: changes advanced-tech balance, so the air harness lines will move and
the air AI ladder should be rerun.

**2. Showing where allies and objectives are.**
What: markers on the minimap and an opening camera pan for allied bases in three- and four-sided
battles, and for objective points in missions. Why: the camera opens only on the player's base and
nothing points at allies (another open item); generated theatre battles make this essential, as
the player will not know each map. Cost: small (`Minimap.tsx`, `GameScreen.tsx`). Risk: little;
check phone layouts.

**3. Endless survival mode.**
What: a skirmish option where waves grow without end and the score is how long you held.
Why: a quick, replayable challenge between long sessions, and a natural shareable score. Cost:
small to medium; it reuses the survive objective, timed triggers and the raid AI mode. Risk:
waves must be capped so a very long run does not slow the page or swell the save.

**4. Enemy commander personalities.**
What: named computer commanders with styles (rusher, turtle, air-heavy, artillery, harasser),
chosen in skirmish setup and used as the theatre's enemy generals. Why: the single biggest source
of variety over a long campaign; today every opponent plays the same way, scaled by difficulty.
Cost: medium (`src/sim/ai.ts`, `aiAir.ts`, setup). Risk: balance; each style needs a 150-seed
ladder run so no style is simply better.

**5. Accessibility: colour-blind-safe side colours and rebindable keys.**
What: a palette option where sides differ by more than red against green, and a keys screen.
Why: some players cannot tell sides apart today; rebinding helps left-handed players and those on
other keyboard layouts. Cost: small to medium. Risk: canvas art uses literal team colours, so every
place that draws a side colour must read the chosen palette; check both themes.

**6. Hero talent choices.**
What: at each hero level-up, choose one of two upgrades (for example the Spy's stealth radius or a
longer blackout). Why: makes heroes the player's own over a long war, and gives a reason to care
which hero fights. Cost: medium (`rules.ts` hero data, `mission.ts`, a picker screen, saves).
Risk: four heroes times four levels is sixteen choices to balance; old saves need a default.

**7. The computer using stances and waypoints.**
What: the opponent sets artillery to hold, uses guard on defenders and queues routes round
defences. Why: smarter-looking battles without making the AI cheat. Open item in the improvement
plan. Cost: small to medium (`ai.ts`). Risk: any AI change shifts the drive and ladder baselines;
rerun both.

**8. A daily challenge.**
What: one shared seed and setup per day, the same for every player, with a results table.
Why: a reason to return daily and a light social layer. Cost: medium: the battle side is free
(seeded maps already exist), the results table needs a new API endpoint and table. Risk: any score
the client reports can be faked, since the client is authoritative; keep it friendly rather than
competitive, or verify by replay (feature 9).

**9. Battle replays.**
What: watch a finished battle again, at any speed. Why: players enjoy reliving a close win; replays
are also the best bug report there is. Cost: medium to large: the engine is deterministic, but
saves store snapshots every 15 seconds, not the orders given, so an order log must be recorded.
Risk: the log grows with battle length; it needs compression and a cap to respect the 512 KB save
limit, or a separate store.

**10. Music that follows the battle.**
What: an ambient bed that rises when fighting starts and calms when it ends. Why: atmosphere over
long sessions; already in the "later rounds" list. Cost: medium (generated in `sound.ts`, as the
effects are, so no audio files). Risk: easy to make tiresome; must have its own volume and off
switch.

**11. Scenario and map editor.**
What: place terrain, ore, bases and objectives, and share the result by code. Why: endless
content from players. Cost: large. Risk: shared scenarios need validation on the server like any
other input, and moderation if names and briefings are shared.

**12. Two players online (not recommended yet).**
What: co-operative or head-to-head play between two signed-in players. Why: the most requested
kind of feature in real-time strategy. Cost: very large. Risk: the portal's model is one
authoritative browser per save; real-time play between two browsers needs a server that relays
orders every tick, which the current serverless setup is not built for. Listed so the decision is
explicit.

---

## 3. Phased build order

**Phase 0: contract (small).** Write the theatre types and function stubs (T0) and agree them
against round 5's contract once it lands, in particular how strategic research uses the Mk I to
Mk III tree and doctrines. Record today's `npm run drive:fire` output for the non-regression check.
In parallel, start the two quick wins: aircraft repair (feature 1) and ally and objective markers
(feature 2). Both also help the theatre.

**Phase 1: foundations, in parallel (large).**
- T2: the engine hooks (optional map type, core units, starting upgrades) and the battle
  generator, proving every template builds on hundreds of seeds. The 14 story missions must not
  change.
- T1: the strategic core as pure code, driven by a script before there is any screen.
- T6: the harness grows alongside both, so determinism and save size are checked from day one.

**Phase 2: playable Short war (large).** T3 saves and server, T4 screens and art, and the first
tour. At the end, a player can start, play and finish a Short war in the browser, with every battle
fought by hand. Check light and dark mode and phones.

**Phase 3: long and very long (medium to large).** T5 auto-resolve, counter-offensives, supply-line
surrender, regions and enemy generals, higher Commander ranks, then the Long and Very long presets.
Feature 4 (enemy personalities) fits here, since generals need styles.

**Phase 4: balance and polish (medium).** `ladder:theatre` over 150 seeds per length and
difficulty, tuning supply, garrisons and counter-offensive frequency; a full Very long war played
through by the harness to confirm save size and pacing; then the remaining features from section 2
in rank order.

Throughout: `npm run check` before every push, `npm run test:api` after the server change in
phase 2, `npm run tours` after the tour, and a browser check after every new screen.
