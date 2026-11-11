# Fireline, round 5: the contract

Status (2026-11-09): contract written; the groundwork it stands on is committed (section 1). Four
workstreams build in parallel on top of it, each in its own worktree, then an integrator merges
them. As in round 4 (`fireline-round4-design.md`, whose rules all still hold), this file is what
stops them colliding: the exact names each one adds, the files each one owns, the lines each one may
touch in a shared file, and how each one is tested.

The player asked: "move the tech tree so it's a pop out window; add repair trucks and larger maps,
with skirmish bases so we can have much longer games and more tech." That is four workstreams:

- **A. The build window**: the build lists leave the sidebar for a pop-out tech tree (interface only).
- **B. Larger maps and long games**: a map size option, the generator scaled, long-game tuning, performance.
- **C. Engineering vehicles**: the Repair Truck, and the Forward Base Truck that deploys into a Field Yard.
- **D. Neutral sites and tier three**: Oil Derricks, Field Hospitals and Comms Relays to capture, and a third tier of tech.

Read `fireline-design.md` (the build log, latest entries last), `fireline-round4-design.md` and
`fireline-improvements.md` first. The repo rules hold throughout: `src/sim/` is pure (no
`Math.random`, no clock, one `cloneState` per action, an illegal action returns the same state
object); every enemy question goes through `src/sim/sides.ts`; colours are tokens in both the light
and the dark block of `styles.css`, never hex in a component; British English, no em dashes, plain
and direct.

---

## 1. The groundwork (already committed)

Everything below is in the tree now and changes nothing in play: every summary line of
`npm run drive:fire` is the same before and after it (section 7 lists them).

| What | Where |
|---|---|
| `MENUS: Record<Category, readonly (BuildingKind \| UnitKind)[]>`, the one table of build lists (it was private to the sidebar); `AIR_MENU` moved up beside the other lists | `src/sim/rules.ts` |
| `ALSO_PRODUCES: Partial<Record<BuildingKind, Category>>`, structures that work a queue besides its `PRODUCER` (empty; C adds the Field Yard), read by `producerFor` | `src/sim/rules.ts`, `src/sim/state.ts` |
| `hasProducer(s, owner, category)`: something stands that works this queue. The sidebar greys a list on it, no longer on `PRODUCER` alone | `src/sim/state.ts`, `src/game/Sidebar.tsx` |
| `MapSize = 'standard' \| 'large' \| 'huge'`, `MAP_SIZES`, `MAP_SIZE_NAMES`, `MAP_SIZE_TILES`, `MAP_TILES_MAX`, `mapTilesFor(setup)` (inside B's block) | `src/sim/rules.ts` |
| `SkirmishSetup.size?: MapSize` and `SkirmishSetup.sites?: boolean`; `DEFAULT_SETUP` and `LEGACY_SETUP` carry `size: 'standard', sites: false`; `normaliseSetup` repairs both (unknown size: the base's, or `'standard'`; sites on only when exactly `true`, else the base's, else off) | `src/sim/rules.ts`, `src/sim/state.ts` |
| `WeaponKind` gains `'rail'` with its `DAMAGE_VS` row, `FLIGHT_TICKS.rail = 0` and the build tip's name "Railgun" (nothing fires it yet) | `src/sim/rules.ts`, `src/game/Sidebar.tsx` |
| Optional spec fields: `UnitSpec.mender`, `UnitSpec.deploysTo`, `UnitSpec.stealth`, `BuildingSpec.buildRadius`, `BuildingSpec.undeploysTo` (declared, read by nothing yet) | `src/sim/rules.ts` |
| `SiteKind = 'derrick' \| 'hospital' \| 'relay'`, `SITE_KINDS` (inside D's block) | `src/sim/rules.ts` |
| `Site` (a neutral site) and `GameState.sites?: Site[]` | `src/sim/types.ts` |
| `GameAction` gains `{ type: 'deploy'; id }` and `{ type: 'undeploy'; id }`; until C handles them the reducer's default refuses both (the same state back) | `src/sim/types.ts`, `src/sim/actions.ts` |
| The selection's own commands: `SELECTION_ACTIONS` (empty), `selectionActions(state, sel)`. The selection panel shows one button per command that applies; **F** in a skirmish runs the first that can go (in a campaign battle F stays the hero's ability); the key table lists F | `src/game/selectionActions.ts` (new), `src/game/Sidebar.tsx`, `src/pages/GameScreen.tsx` |
| Marker comments (`round5:A` to `round5:D`, mostly `begin` and `end` pairs) at every place a workstream adds lines to a shared file | see section 2 |

Rules the groundwork fixes, which every workstream keeps:

- **Old saves and setups.** A setup without `size` is `'standard'`, without `sites` is off; a state
  without `sites` has none. A save from before round 5 loads and plays exactly as before.
- **Missions are untouched.** Nothing from this round appears in a mission: no new kind is in
  `STANDARD_TECH`, so `techAllowed` keeps it out of every mission (side 0's tech list and the
  enemy's standard tech) and out of standard-tech skirmishes. A mission state never has `sites`.
- **Every new kind is advanced tech**, and every new item reaches the build window only as data: a
  kind in a union, a spec in `UNITS` or `BUILDINGS` with its `requires`, and an entry in one of the
  lists `MENUS` reads. Nothing else tells the window it exists.
- **Neutral is not a side.** A neutral site is not a `Building` and never in `s.buildings`: it is
  never a target, never fires, never counts for victory or for the build radius, and `sides.ts` does
  not change. `Site.owner` is the side holding it or `null`.
- **Hotkeys.** Every letter already has a job (build keys Q W E R T Y U I J K L B N D; A, S, G, H, M,
  O, P; Z X C V and F in the campaign). Items keep their keys. The window's toggle is the backquote
  key (section 3). A list's fifteenth item onwards has no key and is clicked.

### The non-regression rule for this round

These lines of `npm run drive:fire` were measured before and after the groundwork and are the
baseline (2026-11-09, fireline-base `ce964a2` plus the groundwork):

```
  mission battle 1: lost (Time ran out.) at tick 20000 (33.3 min), 167 kills, 164 losses
  mission battle 2: won at tick 7498 (12.5 min), 112 kills, 35 losses
  mission battle 3: won at tick 9738 (16.2 min), 137 kills, 62 losses
  26/28 battles finished, average 20.6 game minutes; side 0 won 15, side 1 won 11
  12/12 finished, average 23.6 game minutes; side 0 won 6, side 1 won 6
    classic: side 1 in 26 min, side 0 in 24 min
    river: side 1 in 23 min, side 0 in 27 min
    highlands: side 0 in 20 min, side 1 in 39 min
    lakes: side 1 in 13 min, side 0 in 17 min
    plains: side 1 in 22 min, side 1 in 28 min
    canyon: side 0 in 30 min, side 0 in 14 min
```

plus the round-4 sides block ("12/12 finished, average 20.3 game minutes" and its twelve lines).
(The round-4 contract's numbers are older; these are today's.) Every printed line of the run is
identical before and after the groundwork; the assertion count rose by one, 343,755 to 343,756,
because the harness checks that every weapon kind has a flight time and `'rail'` is a new one.

- **The mission lines and the standard-tech line (the first four) are everyone's**: no workstream
  may change them.
- **A** changes no simulation code: every line stays.
- **B** gates everything it changes in play on `size !== 'standard'`: every line stays.
- **C and D** may move the advanced-tech lines (the "12/12" line, the six map lines, and the
  advanced battles in the sides block), because the computer uses the Repair Truck and tier three
  in any advanced battle. Each reports its new lines in its build-log entry; the integrator merges C
  then D and reports the result.
- `npm run campaign:fire` keeps passing with all fourteen missions unchanged.

Run `npm run drive:fire` before you start and keep the output, so the comparison is exact.

---

## 2. Shared files and how each is touched

A shared file is edited only where this table says. "Marker" means a comment already in the file
reading `round5:A`, `round5:B`, `round5:C` or `round5:D`, either alone (put your lines directly
under it) or as a `begin` and `end` pair (put your lines between them). Never write under another
workstream's marker, and leave every marker in place. Lines between markers stay untouched, so the
four branches merge without conflicts (checked: insertions under neighbouring single-line markers
merge cleanly in git).

| File | A (build window) | B (larger maps) | C (engineering) | D (sites, tier three) |
|---|---|---|---|---|
| `src/sim/rules.ts` | None | Its `round5:B` block in the skirmish section: may change the numbers, add constants | Unions, `UNITS`, `BUILDINGS`, `VEHICLE_MENU`, `ALSO_PRODUCES` and the end-of-file block, each between its `round5:C` markers | Unions, `UNITS`, `BUILDINGS`, `BUILD_MENU`, `VEHICLE_MENU`, `DAMAGE_VS.rail` (numbers only) and the end-of-file block, between its `round5:D` markers |
| `src/sim/types.ts` | None | `AiMemory` between its markers | `Unit`, `Building`, `Effect['kind']`, `AiMemory`, between its markers (the two actions are already there) | `Unit`, `Effect['kind']`, `AiMemory`, between its markers; may add optional fields to `Site` |
| `src/sim/state.ts` | None | Owner of `createInitialState` outside D's marker; may change `visibility` and `updateExplored` for speed, keeping D's marker block intact | None (`producerFor` reads `ALSO_PRODUCES`) | Its markers in `createInitialState`, `cloneState`, `visibility`, `migrateState` |
| `src/sim/tick.ts` | None | The ore-regrowth block in `step`, `pathBudget`, and the `updateExplored` cadence, all gated on size | One call line between its marker in `updateUnit` | One call line between its marker in `step`; the four `kind === 'spy'` checks may become `kind === 'spy' \|\| UNITS[kind].stealth` with the stealth rule (section 6) |
| `src/sim/grid.ts` | None | `findPath` and `nearestPassable` for speed (same results) | None | Its marker in `occupancy` |
| `src/sim/commands.ts` | None | None | Owner: `canQueue` refuses the Field Yard; `placementProblem`'s "near" rule reads `buildRadius`; deploy and undeploy rules in its own functions or in `engineering.ts` | `canAttack` and `enemyTarget` respect stealth (one condition each) |
| `src/sim/actions.ts` | None | None | The two cases between its markers | None |
| `src/sim/ai.ts` | None | The `round5:B` block in `commander`; the two distance literals in the wave code (the reserve's 30 tiles from home, the staging point's 10) may read a function in `aiScale.ts` | One call line between its marker after `airPlan`; the `mine.some(b => b.kind === 'hq')` test before building may also accept a Field Yard | One call line between its marker after `airPlan` |
| `src/sim/map.ts`, `src/sim/maps.ts`, `src/sim/aiSides.ts` | None | Owner | None | None (D reads `maps.ts` exports, never edits) |
| `src/sim/sides.ts` | None | None | None | None |
| `src/sim/mission.ts` | None | None | None | `isDetected` may be reused; no edit |
| `src/game/Sidebar.tsx` | Owner | None | None (its buttons come through `selectionActions.ts`) | None |
| `src/game/selectionActions.ts` | May restyle, keep the API | None | Its entries between its markers | None |
| `src/pages/GameScreen.tsx` | Owner (layout, keys, the window) | None (the camera already reads the state's size; anything else found is the integrator's) | None | None |
| `src/game/renderer.ts` | None | Owner of performance work (culling, terrain prerender, fog) | None (the 'repair' effect already draws on a mended unit) | Its marker before the structures pass; the Spy lines (`spySeen`, `shimmer`, `cloaked`) may extend to stealth units |
| `src/game/art.ts`, `src/game/icons.ts` | None | None | Its cases at the end of `drawUnit`'s and `drawBuilding`'s switches and its functions at the end of the file, between its markers | The same, between its markers; `drawSite` among its functions |
| `src/game/terrain.ts`, `src/game/Minimap.tsx` | None | Owner (scale for 160 tiles, cost of the fog pass) | None | Its marker in `Minimap.tsx` |
| `src/components/SkirmishSetup.tsx`, `src/pages/Lobby.tsx`, `src/hooks/useSaves.ts`, `api/game/index.ts` | None | Owner | None | The Neutral sites field under its marker in `SkirmishSetup.tsx` only |
| `src/components/GuidedTour.tsx`, `scripts/tours/fireline*.cjs` | Owner | None | None | None |
| `src/pages/HowToPlay.tsx` | Its panel under its marker; owner of the Controls table | Under its marker | Under its marker | Under its marker |
| `src/styles.css` | Under its own heading at the end | Same | Same | Same |
| `scripts/drive.ts` | None | Its import and section lines under its markers; `TICK_CAP` may become a function of the setup that returns 45000 for every standard-size battle | Its import and section lines under its markers | Its import and section lines under its markers |
| `fireline-design.md` | Its own build-log entry, appended | Same | Same | Same |
| `fireline-improvements.md` | A section I line, ticked, with lines under it | Same | Same | Same |

New files each workstream owns outright:

- A: `src/game/BuildWindow.tsx` (and any `src/game/techTree.ts` for the layout).
- B: `src/sim/aiScale.ts`, `scripts/drive-maps.ts`, `scripts/perf-fire.ts`, `scripts/perf-render.cjs`, `scripts/long-games.ts`.
- C: `src/sim/engineering.ts`, `src/sim/aiEngineering.ts`, `scripts/drive-engineering.ts`.
- D: `src/sim/sites.ts`, `src/sim/aiSites.ts`, `scripts/drive-sites.ts`.

Each `scripts/drive-*.ts` exports `export const sections: [string, (ok: Ok) => void][]` with
`type Ok = (cond: unknown, what: string) => void`, exactly as round 4's do, and copies any helper it
needs from `drive.ts` rather than exporting it. Each adds at most 60 seconds to `npm run drive:fire`
(anything longer goes in a script of its own, outside `npm run check`).

---

## 3. Workstream A: the tech tree as a pop-out window

Interface only: no file under `src/sim/` changes, and every `drive:fire` line stays.

### The sidebar

Keeps credits, power, the minimap, the selection panel, and gains:

- a **Build** button (`id="fl-build-open"`, `data-testid="build-open"`) that opens the window on the
  last tab used, labelled with the open tab's name ("Build: Structures") and the key (`` ` ``);
- a **production strip**: one small icon per queue that has anything in it (Structures, Infantry,
  Vehicles, Air, and the research), with its progress bar, its count, and a cancel on click
  (touch: on the ×), the ready structure pulsing and clickable to place it. `id="fl-queue-strip"`.

### The window (`src/game/BuildWindow.tsx`)

- Opened by the Build button or the backquote key (`` ` ``, `e.code === 'Backquote'`); closed by the
  same, by Esc (before Esc's other jobs: Esc first closes the window, then cancels placement and so
  on, as today), or by its own close button. `role="dialog"`, `aria-label="Build"`, focus moves into
  it on open and back to the Build button on close. It is not modal: the battle keeps running and the
  map stays clickable outside it.
- **Desktop**: a panel over the left or centre of the battlefield, about 60% of the canvas wide and
  at most 80% tall, never over the sidebar; draggable by its title bar, its position remembered per
  viewer in `localStorage` (wrapped in try/catch) under `fl_build_window`.
- **Phones and touch** (the existing touch layout, `layout.ts`): a full-screen sheet with a close
  button at the top, tabs below it, the tree scrolling vertically.
- **Tabs** as today (`tabsFor(state)`: Structures, Infantry, Vehicles, and Air with advanced tech),
  with Tab and Shift+Tab cycling them whether the window is open or closed (so a closed window's
  hotkeys act on the tab the Build button names). A Research tab follows the others once a Research
  Lab stands (the Research block moves here from the foot of the Structures list, unchanged in what
  it does).
- **The tree**: items laid out by tier, left to right on desktop and top to bottom on a phone. An
  item's tier is computed from data alone: `tier(k) = 0` when `requires` is empty or holds only
  `'hq'`, else `1 + max(tier of each structure it requires)`, where a structure's own tier comes
  from its own `requires` (memoised; a cycle, which no data has, counts as tier 0). Within a tier,
  items keep `MENUS[tab]` order. A line runs from each item to each structure it requires; a required
  structure on another tab appears as a small ghost node at the left of the tab ("needs Tech Centre"),
  so every line has both ends. Lines are an inline SVG layer behind the buttons, coloured by tokens:
  met, unmet.
- Each item keeps today's button: icon (`iconFor`), name, cost, hotkey letter, queue count and
  progress, the Shift batch, the ready-to-place pulse, the stat tip on hover or long press, cancel by
  right-click (desktop) or × (touch). It keeps its id, `fl-build-<kind>`, and the tabs keep
  `fl-tab-<tab>`, so the guided tour can find them. A locked item is greyed with its missing
  structures named under it ("Needs Tech Centre, Research Lab"); a kind the battle does not allow
  is left out as today (`menuFor`).
- The window must lay out **any** item, including kinds it has never seen: it reads names, costs,
  requirements and lists only from `rules.ts` (`MENUS`, `UNITS`, `BUILDINGS`, `UPGRADES`), never a
  hard-coded kind. A test proves it (below).
- **Placement**: when a structure is ready and the player starts placing it (button, key, or the
  strip), the window closes (desktop and phone alike) and reopens on the same tab when the structure
  is placed or placement is cancelled, if it was open before. The placement cursor is never under the
  window.
- **Hotkeys** for items are unchanged and work with the window open or closed: Q W E R T Y U I J K
  L B N D on the open tab's `menuFor` list, Shift to batch. A list's fifteenth item onwards has no key.
- The guided tour (`GuidedTour.tsx`) and the touch tour are updated to the new layout: a step that
  wants a build button first targets `fl-build-open` while the window is closed, then the button. The
  tour's `queueTarget` and `placeTarget` learn this; every step still passes the five checks in
  `CLAUDE.md` (no step complete on arrival, none can un-complete, no spotlight mid-scroll, no
  disabled target, no target off screen).
- Tokens for the window (`--ui-tree-*`: panel, rule, line met, line unmet, ghost, tier heading) under
  A's heading in `styles.css`, both modes.

### Tests

- `npm run tours fireline fireline-touch` pass (desktop, and touch on the three phones).
- `npm run check:loading` still passes (the sidebar's loading state is untouched, but it is a lobby
  and game screen check).
- A small harness in A's own Playwright check (inside `scripts/tours/fireline.cjs` after the tour,
  or a `scripts/build-window.cjs` of its own) that: opens and closes the window by button, key and
  Esc; places a structure from it and sees the window close and reopen; queues by hotkey with it open
  and with it closed; finds every `MENUS` kind on its tab with the right greyed state at the start of
  an advanced skirmish; and, with a kind added to a copy of the menus at run time (a test-only hook
  such as `window.__flExtraMenuItem`), sees it laid out at the right tier with its lines.
- Both colour modes checked in the browser; a phone width (375 by 667) checked.

---

## 4. Workstream B: larger maps and long games

Everything B changes in play is gated on `setupOf(s).size !== 'standard'` (or reads the map's own
size), so every standard-size battle, two to four sides, plays exactly as before.

### Setup and size (`src/sim/rules.ts`, `src/sim/state.ts`)

Starting numbers (in B's block; B measures and may lower, never raise past `MAP_TILES_MAX` = 160):

| Size | 2 sides | 3 sides | 4 sides |
|---|---|---|---|
| standard | 64 | 80 | 96 |
| large | 96 | 112 | 128 |
| huge | 128 | 144 | 160 |

- `createInitialState` builds a `mapTilesFor(setup)` square map; with `size === 'standard'` it takes
  exactly today's path.
- `normaliseSetup` already repairs `size`; the server already runs every lobby setup through it.

### Maps (`src/sim/map.ts`, `src/sim/maps.ts`)

- `generateSkirmishMap(seed, type, ore, sides, size = 'standard')`: the same symmetry rules as round 4
  (point symmetry for two sides, exact 90-degree rotation for four, the -0.5 and 0.8660254037844386
  rotation for three), with terrain features, ridges, rivers, lakes and tracks scaled to the map,
  more ore fields (home, a second field behind each base, contested fields between neighbours and
  in the centre), and bases spaced further apart. Every start still sits clearly in its half (the
  front rule).
- `mapProblem` and `sidesProblem` pass at every size: B states the measured fairness (buildable
  ground, home ore, walking distance) for each size and side count over 20 seeds of every type, and
  keeps it within `SIDES_TOLERANCE`.

### Long games

- **Ore.** On large and huge maps a field regrows from its edges once worked out: an empty ore tile
  next to a tile with ore regains a little ore every `ORE_SPREAD_TICKS` (B states the numbers), so
  a field never vanishes for good while one tile of it is left. Standard maps unchanged.
- **The computer.** `aiScale.ts` exports `scaledFor(s, d): DifficultySpec`, the difficulty's numbers
  for the map's size (later first attack, larger waves, a longer interval, a reserve kept nearer the
  staging point), called on the `round5:B` line in `commander`; and the distance helpers the wave code
  reads (reserve radius, staging distance) in place of the literals 30 and 10. Standard size returns
  `d` and the literals exactly.
- **The harness.** `TICK_CAP` becomes `capFor(setup)`: 45000 for standard (unchanged), 72000 for
  large, 108000 for huge.

### Performance

Measure first, then fix, then measure again, and state both in the build log:

- `scripts/perf-fire.ts` (headless): a four-sided computer battle on huge, advanced tech, sites on
  if D has landed; the time of one-tick `processAction` calls between minutes 20 and 30 of play:
  median and 99th percentile. Targets: median under 4 ms, 99th percentile under 25 ms (the client
  runs ten ticks a second, so this leaves a frame budget). Also the same at standard size, for the
  comparison.
- `scripts/perf-render.cjs` (Chromium, Playwright): load a saved late-game huge battle and record
  frame times for ten seconds while panning: median under 16 ms at 1280 by 800, zoom 1.
- Likely hot spots to look at: path searches per tick (`pathBudget` 24, per tick, whatever the
  map) and `findPath`'s cost on 25,600 tiles; `updateExplored` and `teamVisibility` every five
  ticks (a full-map pass per side); the minimap's per-tile fog fill; the terrain prerender's canvas
  size (160 tiles at the renderer's tile size may pass a browser's canvas limit: tile it); per-frame
  `s.buildings` and `s.units` scans in the renderer. Results must stay the same (`findPath` returns
  the same path), so replays do not move.

### Interface

- Lobby (`SkirmishSetup.tsx`): a Map size field (Standard, Large, Huge) under the `round5:B` marker,
  each with a line saying the tiles and roughly how long a battle runs, and the map previews drawn
  at the chosen size.
- Saves list: "Large map" or "Huge map" beside the map type (the server's list query reads
  `state->'setup'->>'size'`).
- In battle: the camera, scroll limits and minimap work at 160 tiles; the minimap box keeps its size.

### Tests (`scripts/drive-maps.ts`)

- `normaliseSetup` for every size, junk included; `mapTilesFor` for every size and side count.
- Every map type at large and huge, two to four sides, over at least 10 seeds each: `mapProblem`
  passes, symmetry holds, fairness within tolerance, ore fields scale.
- Ore spreading: a worked-out tile next to ore regrows on large, never on standard.
- Whole computer battles at large and huge (two sides, and four sides as teams): they finish within
  `capFor` (at least 80%), every side harvests, and they run longer than standard on average; a
  huge battle played twice is byte-identical. Kept within the 60 seconds; the longer sweep lives in
  `scripts/long-games.ts`.
- Every standard-size line of `drive:fire` unchanged.

---

## 5. Workstream C: engineering vehicles

Advanced tech, skirmish only. Starting numbers; C balances and states them.

### Rules (`src/sim/rules.ts`, inside C's markers)

| Id | Name | Kind | Cost | Build | Health | Armour | Speed | Sight | Needs |
|---|---|---|---|---|---|---|---|---|---|
| `repairtruck` | Repair Truck | vehicle, `mender: true`, no weapon | 900 | 110 ticks | 300 | light | 0.085 | 6 | factory, repairbay |
| `basetruck` | Forward Base Truck | vehicle, `deploysTo: 'fieldyard'`, no weapon | 2500 | 250 ticks | 900 | heavy | 0.055 | 5 | factory, uplink |

| Id | Name | Size | Cost | Health | Power | Sight | Notes |
|---|---|---|---|---|---|---|---|
| `fieldyard` | Field Yard | 2x2 | 2500 (for selling: half, as any) | 1000 | 0 | 5 | `buildRadius: 6`, `undeploysTo: 'basetruck'`, `requires: []`, on no menu; `ALSO_PRODUCES.fieldyard = 'building'` |

Both trucks join `VEHICLE_MENU` (after the Flak Track, in that order). Constants at C's end-of-file
block:

```ts
export const REPAIR_TRUCK_RANGE = 2;      // tiles, centre to centre
export const REPAIR_TRUCK_HP = 8;         // per mend
export const REPAIR_TRUCK_TICKS = 5;      // ticks between mends (16 health a second; the Repair Bay is 12)
export const REPAIR_TRUCK_SEEK = 8;       // tiles it looks for a damaged vehicle when idle
export const MAX_FIELD_YARDS = 3;         // per side, counting Forward Base Trucks
```

### How it plays (`src/sim/engineering.ts`)

- **Repair Truck.** Free, like the Medic and the Repair Bay. Every `REPAIR_TRUCK_TICKS` the most
  damaged of its own side's ground vehicles within range (never itself, never infantry, never an
  aircraft) gets `REPAIR_TRUCK_HP` back, with a `'repair'` effect on it (already drawn). Idle and not
  on hold, it drives to the nearest damaged own vehicle within `REPAIR_TRUCK_SEEK`; given an order it
  follows the order. `menderStep(s, u)` is called on C's line in `tick.ts`'s `updateUnit`.
- **Forward Base Truck.** `deploy` (side 0 through the reducer, the computer directly): legal when
  the unit is the side's own `basetruck`, idle or moving, and the 2x2 footprint with top-left
  `(Math.round(u.x) - 1, Math.round(u.y) - 1)` passes `placementProblem` for `'fieldyard'` with two
  exceptions: no "near your base" rule, and the truck itself is not "in the way". The truck is
  removed and a Field Yard with the truck's share of health appears there at once (its `placedAt`
  rise animates it). The cap is kept at `canQueue`: a `basetruck` is refused once the side's Field
  Yards, Forward Base Trucks and trucks already queued reach `MAX_FIELD_YARDS`.
- **Field Yard.** A structure: it counts for victory, for the build radius (its own `buildRadius`
  of 6 instead of `BUILD_RADIUS`), and it works the Structures queue (`ALSO_PRODUCES`), so a side
  whose Command Yard has fallen can still build. `canQueue` refuses `'fieldyard'` like `'hq'`.
  `undeploy`: legal for the side's own Field Yard unless it is the side's last structure (the battle
  would end) or a structure it is working is ready to place and no other producer stands; the yard
  is removed and a `basetruck` with its share of health stands at its centre.
- Selection commands (`src/game/selectionActions.ts`): `deploy` ("Deploy", shown for a selection
  holding a Forward Base Truck, greyed with the placement problem as its tooltip) and `undeploy`
  ("Pack up", for a selected Field Yard). F runs the first that can go.
- Victory: unchanged code; a Field Yard is a structure, a truck is not.

### Computer (`src/sim/aiEngineering.ts`)

`engineeringPlan(s, owner, home, enemyHome, units, foes)` on C's line in `ai.ts`:

- Repair Trucks, advanced tech, any size: one once it fields 6 vehicles, up to one per 8, at most 3;
  they follow the wave as the Medics do and stay out of its count.
- Expansion, large and huge maps only (`setupOf(s).size !== 'standard'`): once it has two refineries
  and no threat at home, and an ore field (or, after D lands, a site) at least 24 tiles from every
  structure it owns has no enemy unit within 12 tiles, it builds one Forward Base Truck, drives it
  there, deploys, then builds a Refinery and a Gun Turret within the yard's radius. One expansion at
  a time; it tries again after a failure only after two minutes. Memory: `expansion?: { truck: number;
  x: number; y: number; since: number } | null` in `AiMemory` between C's markers.
- The `mine.some(b => b.kind === 'hq')` test before building also accepts a Field Yard.

### Interface

- Art for the three looks in any side's colours (`art.ts`, `icons.ts`, between C's markers); a
  deploying yard rises as any new structure does.
- How to play: an Engineering panel under C's marker. Tokens, if any, under C's heading.

### Tests (`scripts/drive-engineering.ts`)

- Stats, menus, requirements; advanced only (`techAllowed` false on standard tech and in missions).
- The truck mends only its own side's damaged ground vehicles in range, the most damaged first,
  never itself, infantry or aircraft; the rate measured; it seeks when idle and not on hold, and not
  when holding.
- Deploy: legal on clear ground far from any base; refused on water, ore, rock, structures, a
  refinery's dock, another unit's tile, an enemy's truck, a truck that is not idle or moving; the
  yard's tile and health exact. Undeploy: legal, and refused for the last structure.
- Build radius: a structure 6 tiles from a Field Yard and far from home is placeable, 7 is not.
- With the Command Yard destroyed and a Field Yard standing, the Structures queue progresses and the
  side is not out; with the yard packed up into a truck as its only asset, the side is out (and the
  reducer refuses that move, so only the computer path or a destroyed yard can reach it).
- Save, `migrateState` and replay byte-identical with trucks and yards.
- The computer: builds Repair Trucks in a long advanced battle; on a large map (after B lands; until
  then with a state built by hand with a far ore field) builds a truck, deploys it and builds there.
- Every mission and standard-tech line unchanged; the advanced lines reported.

---

## 6. Workstream D: neutral sites and tier three

Advanced tech, skirmish only. Starting numbers; D balances and states them.

### Sites (`src/sim/rules.ts` inside D's markers, `src/sim/sites.ts`)

```ts
export interface SiteSpec { name: string; w: number; h: number; blurb: string }
export const SITES: Record<SiteKind, SiteSpec>;   // all 2x2: 'Oil Derrick', 'Field Hospital', 'Comms Relay'
export const SITE_CAPTURE_TICKS = 100;   // 10 seconds of an infantry unit beside it
export const SITE_CAPTURE_RANGE = 1.5;   // tiles from the footprint's edge
export const DERRICK_INCOME = 25;        // credits to the holder
export const DERRICK_TICKS = 50;         // every 5 seconds: 300 a minute (a Hauler's load is 600)
export const HOSPITAL_RANGE = 3;         // tiles from the footprint's edge
export const HOSPITAL_HEAL = 5;          // to each of the holder's infantry in range
export const HOSPITAL_TICKS = 10;
export const RELAY_RADIUS = 10;          // tiles revealed round its centre, to the holder and its team
export const SITES_PER_SIDE: Record<MapSize, Record<SiteKind, number>> = {
  standard: { derrick: 1, hospital: 0, relay: 0 },
  large:    { derrick: 2, hospital: 1, relay: 1 },
  huge:     { derrick: 3, hospital: 1, relay: 2 },
};
```

- **Placement**: `placeSites(s)` in `sites.ts`, called on D's line in `createInitialState` when
  `setup.sites` is on, fills `s.sites` (ids from `s.nextId`). It picks spots in side 0's share of the
  map and maps each through the map's own symmetry (two sides: the 2x2 footprint's top-left `(x, y)`
  goes to `(W - 2 - x, H - 2 - y)`; four sides: the 90-degree turn; three sides: the round-4
  rotation, rounded, then nudged to the nearest legal spot), so every side gets the same set at the
  same distances. A spot is legal on walkable ground with no ore, at least 10 tiles from every
  start's yard, at least 6 from any other site, and reachable from every start. Its own random
  stream (a generator seeded from `s.rngSeed` and a constant, never the battle's stream), so placing
  sites changes nothing else about the battle. `sitesProblem(s)` checks the rules and the symmetry.
- **Blocking**: a site occupies its tiles in `occupancy` with its own id (D's marker in `grid.ts`),
  so units walk round it and nothing is placed on it. Nothing that reads occupancy assumes the id is
  a structure's (checked: it never dereferences it).
- **Capture** (`sitesStep(s)`, on D's line in `tick.ts`): any side's infantry within
  `SITE_CAPTURE_RANGE` capture it; its progress rises by `1 / SITE_CAPTURE_TICKS` a tick while one
  team's infantry alone is beside it, pauses while two teams' are, and falls at the same rate while
  none is. A side's capture of a site its team already holds does nothing. At 1 the site passes to
  the capturing side (from neutral or from an enemy alike), a log line for side 0's team, and a
  `'captured'` effect (it exists). Aircraft and vehicles never capture.
- **Effects**: a Derrick pays its holder; a Hospital heals its holder's infantry in range (the
  existing `'heal'` effect); a Relay reveals its area (`visibility`, D's marker, so allies see it
  too through `teamVisibility`). The computer sees the whole map anyway.
- **Saves**: `cloneState` copies `sites` one object deep; `migrateState` keeps a well-formed list
  (known kinds, integer tiles on the map, owner a side or null, progress clamped) and drops the rest.
- Neutral is never a side: nothing in `sides.ts`, victory, targeting or splash changes.

### Tier three

| Id | Name | Kind | Cost | Build | Health | Power | Weapon | Needs |
|---|---|---|---|---|---|---|---|---|
| `protoworks` | Prototype Works | structure 3x3 | 2500 | 240 | 1200 | -100 | none | researchlab, techcentre |
| `fortress` | Fortress | structure 2x2 | 2400 | 220 | 2200 | -70 | shell 75, range 7, cooldown 24, splash 0.8 | protoworks |
| `railtank` | Railgun Tank | vehicle, heavy, speed 0.085, sight 6 | 1800 | 200 | 650 | | rail 150, range 6.5, cooldown 45 | factory, protoworks |
| `stealthtank` | Stealth Tank | vehicle, light, speed 0.11, sight 6, `stealth: true` | 1400 | 160 | 380 | | rocket 45, range 5, cooldown 30 | factory, protoworks |

- Structures join `BUILD_MENU` (Prototype Works, then Fortress: the 15th and 16th items, so no
  hotkeys), units `VEHICLE_MENU` after C's.
- `'rail'`: instant (`FLIGHT_TICKS.rail = 0`), single target, `DAMAGE_VS.rail` as in the groundwork
  (D tunes). Against a Battle Tank (50 every 25 ticks) the Railgun Tank does about twice the damage a
  second against heavy armour for 2.25 times the cost, and poorly against infantry.
- **Stealth**: an enemy can neither see nor target a stealth unit unless one of that enemy's units or
  structures is within `STEALTH_DETECT_RANGE` (2.5) of it, or it fired within `STEALTH_REVEAL_TICKS`
  (30). The rule lives in `sites.ts` or a `stealth.ts` of D's (`stealthSeen(s, u, by)`), and the four
  `kind === 'spy'` checks in `tick.ts`, `canAttack`/`enemyTarget` in `commands.ts`, and the renderer's
  `spySeen` call it as well. The Spy's own rule (`isDetected` in `mission.ts`) is untouched. The
  last shot is an optional `Unit` field between D's markers.
- The computer, advanced tech, any size: after `TIER3_AI_TICKS` (15000, 25 minutes) with its
  economy standing, a Prototype Works, then Railgun Tanks in its vehicle mix and a Fortress at its
  front; Stealth Tanks for raids on Haulers. On a map with sites, it sends small infantry parties to
  the nearest sites it does not hold, nearest first, and retakes lost ones near home.
  `sitesPlan(s, owner, home, enemyHome, units, foes)` in `aiSites.ts` on D's line in `ai.ts`.

### Interface

- Lobby: a Neutral sites field (Off, On) under D's marker in `SkirmishSetup.tsx`, with a line naming
  what appears at the chosen size; the map preview shows site markers when on (B's preview reads
  `placeSites` output through a pure helper D exports, `siteSpots(map, setup)`, so the preview and
  the battle agree).
- Renderer: sites drawn before the structures (D's marker), in the holder's colours or a neutral
  grey, with the capture progress as a ring while one is under way; the minimap marks them. A
  selected site (click) shows its name, holder, effect and capture state: the selection panel reads
  it through a `siteAt(s, x, y)` helper; A's panel shows a site's line when given one (A and D agree
  the one prop at integration; until then a site is not selectable).
- How to play: a Sites and tier three panel under D's marker. Tokens under D's heading.

### Tests (`scripts/drive-sites.ts`)

- Placement: every map type at every size (standard now; large and huge once B lands), two to four
  sides, 10 seeds: `sitesProblem` passes, the counts match `SITES_PER_SIDE`, symmetry holds, and
  placing sites leaves the rest of the state (tiles, ore, units, the rng seed) as it was.
- Capture: neutral to a side; retaken by an enemy; paused when contested; decays when left; never by
  vehicles or aircraft; allies do not take each other's.
- Each effect measured: derrick income per minute, hospital healing, relay sight for the holder and
  its ally and not for the enemy.
- A site is never a target, never in victory: a side holding sites but no structure is out.
- Tier three: stats, menus, requirements, advanced only; the rail weapon's damage table; stealth
  hidden at range, seen within 2.5 and after firing, targetable only when seen, for the computer too.
- Saves, `migrateState` (junk sites dropped) and replay byte-identical with sites and tier three.
- The computer captures sites in a long battle with sites on and builds tier three after 25 minutes.
- Every mission and standard-tech line unchanged; the advanced lines reported.

---

## 7. Integration

Merge order A, then B, then C, then D (A touches no simulation code; B changes the most shared sim
code; C and D depend on B's sizes only in their tests and the computer's expansion). After each
merge: `npx tsc -p packages/fireline --noEmit`, `npm run drive:fire` (compare with section 1 and each
workstream's stated changes), `npm run campaign:fire`; at the end `npm run check`, `npm run tours
fireline fireline-touch`, `npm run check:loading`, and a browser run of a huge four-sided battle with
sites on, in light and dark mode, on desktop and a phone.

Known seams the integrator closes, none of which a workstream should pre-empt:

- C's expansion aiming at D's sites as well as ore fields.
- B's map previews drawing D's site markers (`siteSpots`), and D's placement tests at large and huge.
- A's selection panel showing a selected site (D's `siteAt`).
- The tier-three structures being the Structures list's 15th and 16th items, with no hotkey: the
  window's tree makes them easy to click; say so in How to play.
- B's performance measurements rerun with sites and tier three in play.
