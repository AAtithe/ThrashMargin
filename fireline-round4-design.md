# Fireline, round 4: the contract

Status (2026-11-09): contract written; the foundation it stands on is committed (see section 1).
Three workstreams build in parallel on top of it, each in its own worktree, then an integrator
merges them. This file is what stops them colliding: the exact names each one adds, the files each
one owns, the lines each one may touch in a shared file, and how each one is tested.

Read `fireline-design.md`, `fireline-campaign-design.md` and `fireline-improvements.md` first. The
repo rules hold throughout: `src/sim/` is pure (no `Math.random`, no clock, one `cloneState` per
action, an illegal action returns the same state object); colours are tokens in both the light and
the dark block of `styles.css`, never hex in a component; British English, no em dashes.

---

## 1. The foundation (already committed)

Every system now works for 2, 3 or 4 sides. No 3- or 4-sided content exists yet: no lobby option,
no map generator for it and no several-enemy strategy. That is workstream B.

| What | Where |
|---|---|
| `Owner = 0 \| 1 \| 2 \| 3`, `MAX_SIDES = 4`, `SIDE_NAMES` for all four | `src/sim/rules.ts` |
| `GameState.teams: number[]`, `mapW`, `mapH`; `players`, `ai`, `powers`, `blackoutUntil`, `starts` are per-side arrays of any length | `src/sim/types.ts` |
| `sideCount`, `sidesOf`, `computerSides`, `teamOf`, `isAlly`, `isEnemy`, `enemiesOf`, `alliesOf`, `wonBy`, `defaultTeams`, `teamsFor`, `normaliseTeams`, `isSide`, `startOf`, `frontDir`, `inwardDiagonal` | `src/sim/sides.ts` (the one place) |
| `tileAt(s, x, y)`, `onMap(s, x, y)`, `tileOf(s, u)`; `frontRow`, `laneRow`, `frontDir`, `dockTile`, `doorTile` take the state | `src/sim/grid.ts` |
| `teamVisibility(s, owner)`: what a side and its allies see; `explored` is side 0's team view | `src/sim/state.ts` |
| Team colours for sides 2 and 3 (canvas `TEAM[2]`, `TEAM[3]` with emblems), `--ui-side-0` to `--ui-side-3` in both modes, `UI.side[o]` | `src/theme.ts`, `src/styles.css`, `src/game/art.ts` |
| The end card has one column per side | `src/pages/GameScreen.tsx` (`EndCard`) |

Rules the foundation fixed, which every workstream keeps:

- **Side 0 is the human**, always. Sides 1 to 3 are computer commanders. Every computer side gets
  the difficulty's income multiplier; side 0 alone gets campaign perks.
- **Enemies by team.** `isEnemy(s, a, b)` is `teamOf(a) !== teamOf(b)`. Targeting, splash, attack
  orders, Spy detection, the AI's enemy lists and mission objectives all ask it. Never write
  `1 - owner`, `owner === 1` meaning "the enemy", or `b.owner !== owner` meaning "hostile".
- **Victory.** A side is out when it has no structure (walls do not count); a team is out when all
  its sides are. The battle ends when side 0's team is out (defeat) or is the only team left
  (victory). `winner` is then the lowest-numbered side of the winning team: always 0 for a victory.
  Ask `wonBy(s, owner)`. The server's save status reads `winner === 0` as victory and any other side
  as defeat. A mission is still decided by its objectives alone.
- **Decision timing.** Within a period of `DIFFICULTIES[d].period` ticks, side 1 decides on tick 0,
  side 2 a quarter of the way, side 0 (harness autopilot) half way, side 3 three quarters.
- **Fronts.** A structure's door and dock face south when its side's start site is in the bottom
  half of the map and north when it is in the top half (`frontDir`). Every map must put each site
  clearly in one half. Side 0 always starts in the bottom half.
- **Map size is a state property.** `s.mapW` by `s.mapH`; tile index `y * s.mapW + x`. `MAP_W` and
  `MAP_H` in `rules.ts` are only the default (64) for two-sided maps and for saves from before.
  The renderer, terrain painter, water, scars, atmosphere and minimap all take the size from the
  state. The generators in `map.ts` and `maps.ts` still build 64 by 64 and return `w` and `h`.
- **Saves.** `migrateState` fills `teams` (free-for-all for the number of players), `mapW` and
  `mapH` (64), pads `ai`, and sizes `powers` and `blackoutUntil` to the sides. It refuses fewer than
  2 or more than 4 players, a map size that does not match `tiles`, and more than two sides
  without `starts`.
- **Two-sided battles replay byte-identically.** Checked when the foundation landed: the 14 whole
  battles fingerprinted at every 3,000 ticks hashed the same before and after, and every summary
  line of `npm run drive:fire` matched.

### The non-regression rule for this round

Each workstream must leave these lines of `npm run drive:fire` exactly as they are today, unless
the line belongs to it as stated:

```
  mission battle 1: won at tick 12164 (20.3 min), 156 kills, 109 losses
  mission battle 2: won at tick 9772 (16.3 min), 143 kills, 72 losses
  mission battle 3: won at tick 13761 (22.9 min), 154 kills, 123 losses
  26/28 battles finished, average 20.6 game minutes; side 0 won 15, side 1 won 11
  12/12 finished, average 23.4 game minutes; side 0 won 5, side 1 won 7
    classic: side 1 in 32 min, side 1 in 24 min
    river: side 1 in 30 min, side 0 in 26 min
    highlands: side 0 in 22 min, side 1 in 25 min
    lakes: side 1 in 14 min, side 1 in 16 min
    plains: side 1 in 25 min, side 0 in 28 min
    canyon: side 0 in 19 min, side 0 in 20 min
```

- The first four lines (missions and standard tech) are everyone's: no workstream may change them.
- The advanced-tech lines (the "12/12" line and the six map lines) change only for workstream A,
  whose air units and research are advanced tech. B and C must leave them alone.
- `npm run campaign:fire` must keep passing, with missions 1 to 8 unchanged.

Run `npm run drive:fire` before you start and keep the output, so the comparison is exact.

---

## 2. Shared files and how each is touched

A shared file is edited only where this table says. "Marker" means a comment already in the file
reading `round4:A`, `round4:B` or `round4:C`: put your lines directly under your own marker, never
under another's, and leave the marker in place. Lines between markers stay untouched, so the three
branches merge without conflicts.

| File | A (air and research) | B (bigger battles) | C (campaign act two) |
|---|---|---|---|
| `src/sim/rules.ts` | Edits the unions (`UnitKind`, `BuildingKind`, `Category`, `WeaponKind`, `Armor`), `Weapon`, `UnitSpec`, `DAMAGE_VS`, `FLIGHT_TICKS`, `PRODUCER`, `BUILD_MENU`; appends entries at the end of `UNITS` and `BUILDINGS`; appends its own section at the end of the file | Edits the "Skirmish setup" section only (`SkirmishSetup`, `DEFAULT_SETUP`, `LEGACY_SETUP`, new constants just below them) | None |
| `src/sim/types.ts` | `Unit` (new optional fields), `Order` (one new variant), `PlayerState`, `Effect['kind']`, `AiMemory` (new optional fields, at its end), `GameAction` (two new variants, at its end) | None | `ObjectiveSpec` (new variants), `MissionSpec` and `MissionRuntime` (new optional fields, at their ends) |
| `src/sim/state.ts` | `newPlayer`, `cloneState` (the player's queues and research), one line in `migrateState` calling `migrateAir` | `createInitialState`, `normaliseSetup` | None |
| `src/sim/tick.ts` | Owner: movement, targeting, firing, `separate` for aircraft | None | None |
| `src/sim/ai.ts` | One call line under `round4:A` | Replaces the lines between `round4:B begin` and `round4:B end`; one call line under the second `round4:B` | None |
| `src/sim/commands.ts` | Placement and queue rules for air and the lab (its own functions; small edits to `canQueue`) | None | None |
| `src/sim/actions.ts` | Two new cases at the end of the switch | None | None |
| `src/sim/mission.ts` | None | None | Owner: new objective kinds, labels, convoy set-up |
| `src/sim/sides.ts` | None | May add helpers at the end of the file | None |
| `src/sim/map.ts`, `src/sim/maps.ts` | None | Owner | None |
| `src/game/renderer.ts` | Owner of the air layer and shadows (one new pass after ground units) | None (side colours are done) | None |
| `src/game/art.ts`, `src/game/icons.ts` | Owner (new units and structures appended at the end of each switch and file) | None | None |
| `src/game/Sidebar.tsx` | Owner (the air tab and research) | None | None |
| `src/game/Minimap.tsx` | Aircraft dots (one line in the units loop) | Scale for larger maps (the `SCALE` constant only) | None |
| `src/pages/GameScreen.tsx` | Hotkeys and the air tab in `TAB_ORDER` only if needed | `EndCard` and side names in the top bar | `missionZones` (new objective kinds) |
| `src/components/SkirmishSetup.tsx`, `src/pages/Lobby.tsx`, `src/hooks/useSaves.ts`, `api/game/index.ts` | None | Owner | None |
| `src/campaign/*`, `src/pages/Campaign.tsx`, `src/game/campaignArt.ts`, `src/components/CampaignHud.tsx` | None | None | Owner |
| `src/styles.css` | Under its own heading at the end of the file | Under its own heading | Under its own heading |
| `scripts/drive.ts` | Import line at the top plus its sections under its `round4:A` marker | Same, under `round4:B` | Same, under `round4:C` |
| `scripts/campaign-check.ts` | None | None | Owner |
| `fireline-design.md` | Its own build-log entry, appended | Same | Same, plus a section in `fireline-campaign-design.md` |
| `fireline-improvements.md` | Ticks its own line in section H, adds lines under it | Same | Same |

New files each workstream owns outright: A `src/sim/air.ts`, `src/sim/research.ts`,
`src/sim/aiAir.ts`, `scripts/drive-air.ts`; B `src/sim/aiSides.ts`, `scripts/drive-sides.ts`;
C `src/campaign/act2.ts`, `scripts/drive-act2.ts`.

Each `scripts/drive-*.ts` exports `export const sections: [string, (ok: Ok) => void][]`, where
`type Ok = (cond: unknown, what: string) => void`, so its assertions count in the main script's
totals. `drive.ts` carries two markers per workstream: one among its imports, where the import
goes (`import { sections as airSections } from './drive-air';`), and one in the list of sections,
where the call goes (`...airSections.map(([name, fn]): [string, () => void] => [name, () => fn(ok)]),`).
A workstream's tests that need `drive.ts`'s own helpers (`put`, `tickUntil`, `noCommander`) copy
the few lines they need rather than exporting them, so `drive.ts` changes only at the markers.

---

## 3. Workstream A: air power and research

Advanced tech only. With standard tech, in a mission and in every save from before, nothing
changes: no air tab, no lab, the computer builds none of it.

### Rules (`src/sim/rules.ts`)

- `Category` gains `'air'`; `PRODUCER.air = 'helipad'`; `UnitSpec.category` gains `'air'`.
  An aircraft is any unit whose category is `'air'`.
- `Armor` gains `'aircraft'`. Every row of `DAMAGE_VS` gets an `aircraft` column; rows for the new
  weapons are added.
- `WeaponKind` gains `'flak' | 'aamissile' | 'bomb'`, with `FLIGHT_TICKS` for each.
- `Weapon` gains `canHitAir?: boolean` and `canHitGround?: boolean`. Read them only through
  `hitsAir(w)` (`w.canHitAir ?? w.kind === 'bullet'`) and `hitsGround(w)` (`w.canHitGround ?? true`),
  exported from `rules.ts`. So every existing ground weapon cannot hit aircraft except bullets,
  whose `DAMAGE_VS.bullet.aircraft` is the reduced effect (about 0.35).
- New `UnitKind`s, all advanced tech:

| Id | Name | Category | Role |
|---|---|---|---|
| `gunship` | Gunship | air | Attack helicopter: rockets at ground targets, hovers, returns to rearm when its ammunition runs out |
| `bomber` | Bomber | air | Fast; flies over its target dropping a line of bombs (`bomb`), then returns to its Helipad to rearm |
| `flaktrack` | Flak Track | vehicle | Mobile anti-air (`flak`, air only) |
| `skyhunter` | Skyhunter | infantry | Anti-air infantry (`aamissile`, air only) |

- New `BuildingKind`s, all advanced tech:

| Id | Name | Size | Role |
|---|---|---|---|
| `helipad` | Helipad | 2x2 | Builds aircraft (the `air` queue) and rearms them; each pad serves `HELIPAD_SLOTS` aircraft |
| `flakcannon` | Flak Cannon | 1x1 | Anti-air turret (`flak`, air only) |
| `researchlab` | Research Lab | 2x2 | Offers the upgrades below, one at a time per side |

- Research, appended in its own section:

```ts
export type UpgradeId = 'plating' | 'calibration' | 'engines' | 'refining' | 'airframes';
export interface UpgradeSpec {
  name: string;          // 'Armour plating', 'Weapon calibration', 'Engine tuning', 'Refinery efficiency', 'Air frames'
  blurb: string;
  cost: number;
  ticks: number;
  requires: BuildingKind[]; // always includes 'researchlab'
}
export const UPGRADES: Record<UpgradeId, UpgradeSpec>;
export const UPGRADE_ORDER: UpgradeId[];
```

  Effects, applied wherever the number is read, never by rewriting specs: plating raises vehicle
  health, calibration raises weapon damage, engines raise vehicle speed, refining raises harvest
  income, airframes raise aircraft health and shorten rearming. The numbers are A's to choose and
  state in the design log.

### State (`src/sim/types.ts`)

```ts
// Unit, optional fields at its end:
ammo?: number;            // aircraft only: loads left; 0 means it must rearm
pad?: number;             // aircraft only: the Helipad it belongs to, or 0
// Order, one new variant:
| { type: 'rearm'; pad: number }
// PlayerState:
queues: Record<Category, QueueItem[]>;        // now includes 'air'
upgrades?: UpgradeId[];                        // done, in the order finished
research?: { id: UpgradeId; progress: number } | null;
// Effect['kind'] gains 'bomb' (a bomb's impact in a bomber's line).
// AiMemory, optional, at its end: airIds?: number[]; nextAirStrike?: number;
// GameAction, at its end:
| { type: 'research'; upgrade: UpgradeId }
| { type: 'cancelResearch' }
```

`migrateAir(s)` in `air.ts`, called on one line in `migrateState`, gives every player an empty
`air` queue when it has none. `newPlayer` creates it, so every new state has it.

### Simulation

- `src/sim/air.ts`: aircraft movement (straight lines, ignoring tiles, occupancy and structures,
  clamped to the map), bomber runs, rearming, aircraft never pushed by `separate` and never
  blocking ground units, `migrateAir`. `tick.ts` dispatches aircraft to it from `updateUnit`.
- Targeting in `tick.ts`: `acquire` takes the weapon and skips aircraft unless `hitsAir`, ground
  targets unless `hitsGround`; an attack order on a target the unit cannot hit is illegal
  (`canAttack` in `commands.ts`). Splash from ground weapons never reaches aircraft; bombs never hit
  aircraft.
- `src/sim/research.ts`: `canResearch(s, owner, id)`, `doResearch`, `canCancelResearch`,
  `doCancelResearch`, `hasUpgrade(s, owner, id)`, and the per-tick progress (paid in full when
  started, refunded in full when cancelled, half speed on low power, like any queue).
- Air units are seen by sight like anything else and drawn by the fog like ground units.

### Computer commander

`src/sim/aiAir.ts` exports `airPlan(s: GameState, owner: Owner, home: { x: number; y: number }, enemy:
Building[], foes: Unit[]): void`, called on the one line under `round4:A` in `ai.ts`. It builds a
Helipad and a Research Lab once its economy and the plan's turrets stand, researches in a fixed
order by difficulty, trains aircraft, sends gunships at haulers and artillery and bombers at
clusters of structures, and builds anti-air (Skyhunters, Flak Tracks, Flak Cannons) in proportion
to the opponent's aircraft: none while it has seen none. Only when `techAllowed(s, owner,
'helipad')` holds.

### Client

- `art.ts`: the seven new looks, drawn in any side's colours, plus a shadow for aircraft; the same
  functions draw the build icons. `renderer.ts`: aircraft in one pass after every ground unit,
  lifted above their shadow, with a rotor or contrail effect; the bomber's line of impacts.
- `Sidebar.tsx`: an Air tab after Vehicles (only with advanced tech), hotkeys as for the other
  tabs; once a Research Lab stands, a Research block at the foot of the Structures tab listing each
  upgrade with cost, time and effect, its progress, and cancel.
- Tokens for anything new in the chrome go under workstream A's heading in `styles.css`, in both
  modes.

### Tests (`scripts/drive-air.ts`)

- Aircraft cross water, rock and structures; ground units never path through a Helipad's aircraft.
- Every existing ground weapon except bullets never targets or damages an aircraft; bullets do, at
  the reduced effect; flak and anti-air missiles never target ground.
- A bomber drops a line of bombs across its target, returns to its Helipad, rearms and is ready
  again; with its Helipad gone it lands at another or, with none, waits.
- Each upgrade: refused without a Lab or credits, charged when started, refunded when cancelled,
  its effect measured on the number it changes, kept through a save and `migrateState`.
- Old saves (no `air` queue) load and play on exactly; standard tech offers none of it and the
  standard battles' summary line is unchanged.
- The computer, on advanced tech: builds a Helipad and a Lab and researches in a long battle; builds
  no anti-air when its opponent has no aircraft and some when it has.
- `npm run ladder:fire` (150 seeds, advanced tech) before and after: report the mirror and each
  difficulty; the advanced-tech map lines in `drive:fire` will change and are A's to report.

---

## 4. Workstream B: bigger battles

Everything B adds must be a no-op in a two-sided battle: the summary lines in section 1 stay as
they are, including the advanced-tech ones.

### Setup (`src/sim/rules.ts`, `src/sim/state.ts`)

```ts
export type SideMode = 'ffa' | 'teams';
// SkirmishSetup gains:
sides: 2 | 3 | 4;
mode: SideMode;
// DEFAULT_SETUP and LEGACY_SETUP: sides 2, mode 'ffa'.
export const MAP_SIZE_FOR: Record<2 | 3 | 4, number> = { 2: 64, 3: 80, 4: 96 };
```

- `normaliseSetup`: `sides` not 2, 3 or 4 falls back to the base's (2); `mode` not `'ffa'` or
  `'teams'` falls back to `'ffa'`; with 2 sides `mode` is always `'ffa'`. The server already runs
  every lobby setup through it.
- Teams come from `teamsFor(sides, mode)` in `sides.ts` and nothing else:
  - free-for-all: every side on its own team;
  - teams with 4 sides: a 2 against 2, side 0 and side 2 against side 1 and side 3, `[0, 1, 0, 1]`;
  - teams with 3 sides: two against one, side 0 and side 2 against side 1, `[0, 1, 0]`. Side 1, alone,
    gets a handicap B measures and states (more starting credits, or a better income multiplier).
- `createInitialState` with `sides > 2` builds `sides` players, `ai` memories, `teams`, `starts`,
  `powers` (advanced tech), a `MAP_SIZE_FOR[sides]` square map, and each side's Command Yard and
  three riflemen. With `sides === 2` it is exactly today's code path.

### Maps (`src/sim/map.ts`, `src/sim/maps.ts`)

- Map size rule: square, `MAP_SIZE_FOR[sides]` tiles a side: 64 for two sides, 80 for three, 96 for
  four. Generators take `(seed, type, ore, sides)` and return `w`, `h` and one start per side.
- Four sides: exact 90-degree rotational symmetry (tile (x, y) matches (N-1-y, x)). Side 0 bottom
  left, side 1 top right (opposite, as today), side 2 bottom right, side 3 top left. In a 2 against
  2 the allies share the bottom of the map.
- Three sides: 120-degree rotational symmetry about the centre, made by generating one wedge and
  sampling the other two through a rotation by the constants -0.5 and 0.8660254037844386 (no
  trigonometry calls), rounded to tiles. Side 0 at the bottom centre, sides 1 and 2 upper right
  and upper left. Exact symmetry is impossible on a square grid; B states the measured fairness
  (each site's buildable ground, ore within `HOME_FIELD_RANGE`, walking distance to each rival)
  and keeps the spread within a stated tolerance.
- Every site must sit clearly in the top or bottom half (the front rule in section 1).
- `mapProblem` gains an N-sided check: one start per side, every start on clear ground with enough
  buildable ground, all starts connected, a home ore field near each, at least one contested field.

### Computer commanders (`src/sim/aiSides.ts`)

- `chooseEnemy(s, owner): Owner | null` picks which enemy to attack: the nearest standing enemy base
  by walking distance, weighted by that side's strength, and sticky for at least
  `FOCUS_TICKS` (stated by B) so waves do not swing between bases. Stored in new optional
  `AiMemory` fields `focus?: Owner` and `focusUntil?: number`, written only when there is more than
  one enemy, so two-sided memory stays as it is.
- The lines between `round4:B begin` and `round4:B end` in `ai.ts` become: `enemy` the focused
  enemy's structures, `enemyHome` its base, `foes` every enemy unit (defence still answers anyone).
- `alliedPlan(s, owner, ...)` under the second `round4:B` marker: allies never attack each other
  (already true by `isEnemy`), aim at their ally's focus when they have no better one, and send help
  when an ally's base is hit (the ally's `hurtTick` within the last 20 seconds).
- Several enemies may also counter-pick against the sum of what all enemies field.

### Interface

- Lobby (`SkirmishSetup.tsx`): Sides (2, 3, 4) and Mode (Free for all, Teams) with a preview of the
  map that draws every start in its side's colour, and a line naming each side and whose team it is
  on. Mode is hidden for 2 sides.
- The saves list shows "3 sides, free for all" or "2 against 2" next to the map type: the server's
  list query adds `jsonb_array_length(state->'players')` and `state->'setup'->>'mode'`.
- In battle: each computer side's name in its colour (`UI.side[o]`) where the opponent is named today;
  the end card (already one column per side) names the winning team.
- Minimap: `SCALE` chosen so a 96-tile map fits the same box.

### Tests (`scripts/drive-sides.ts`)

- `normaliseSetup` for every sides and mode value, junk included; `teamsFor` per case.
- Every map type at 3 and 4 sides over at least 20 seeds each: `mapProblem` passes, the symmetry
  holds (exact for 4, within tolerance for 3), each site in one half, each with a home field.
- Whole computer-against-computer battles at 3 sides free-for-all, 3 sides teams and 4 sides teams,
  on several map types: they finish (at least 85%), every side harvests, allies never damage each
  other (count hits between allies: zero), the winner's team is the last with structures.
- Replay: a 4-sided battle played twice is byte-identical.
- The two-sided summary lines in section 1, unchanged.

---

## 5. Workstream C: campaign act two

Missions 1 to 8 stay exactly as they are (their `drive:fire` lines and `campaign:fire` checks). Act
two is six more missions on a second theatre map, opened by winning mission 8.

### Objectives (`src/sim/types.ts`, `src/sim/mission.ts`)

```ts
// ObjectiveSpec gains:
| { kind: 'escort'; x: number; y: number; r: number; count: number }
| { kind: 'destroyWithin'; building: BuildingKind; count: number; ticks: number }
// holdZone (existing) gains an optional field: reset?: boolean
//   default false: progress pauses while the zone is contested (today's rule);
//   true: progress drops to 0 whenever an enemy stands in the zone with none of ours.
// MissionSpec, optional at its end:
convoy?: { kinds: UnitKind[]; x: number; y: number; route: { x: number; y: number }[] };
// MissionRuntime, optional at its end:
convoy?: number[];   // ids of the convoy's units, set when the mission is built
```

- `escort`: the convoy is side 0's, placed at (x, y) of `convoy` when the mission is built and
  ordered along `route` (queued move orders; the player may also command it). Done when `count`
  convoy units are within `r` of the objective's point; failed when fewer than `count` are left
  alive. Progress is the share of the route the leading unit has covered.
- `destroyWithin`: like `destroy` (counted in `noteDestroyed`), and failed once `s.tick` passes
  `ticks` with it not done. Its label names the time ("Destroy the enemy Tech Centre within 8
  minutes").
- There is no separate `holdFor` kind: `holdZone` with `reset` covers it.
- `objectiveLabel`, `missionZones` (GameScreen) and `objectiveTarget` (CampaignHud) learn the new
  kinds.

### Missions (`src/campaign/act2.ts`, `src/campaign/missions.ts`)

- `act2.ts` exports `ACT_TWO: MissionSpec[]`, orders 9 to 14; `missions.ts` appends them to
  `MISSIONS` on one line. Ids, in order: `iron-coast`, `convoy-north`, `the-long-hold`, `firestorm`,
  `bastion-line`, `last-light`.
- Mission 9 is unlocked by winning mission 8 (`missionUnlocked` already reads `order - 1`).
- They introduce the round-3 advanced tech one or two at a time, in the player's tech or the
  enemy's: sandbag walls, flame tanks, Bastions, rocket turrets, the Tech Centre (barrage) and
  Strike Command (missile), building to a final assault (mission 14) on a full base with every
  structure, against a `normal` commander on `hard`.
- Missions are two-sided: the enemy is side 1, and `teams` is `[0, 1]`.
- Each uses at least one of the new objective kinds across the act, with bonus objectives as in
  act one, and rewards that unlock act two's tech for later missions.
- Air units (workstream A) appear in no mission yet. After integration they are added to:
  mission 11 (`the-long-hold`): enemy gunship raids by trigger, the player given Skyhunters;
  mission 12 (`firestorm`): enemy bombers by trigger, the player given a Flak Cannon to build;
  mission 14 (`last-light`): both sides' full air and research. Each of these missions must be
  winnable and pass `campaign:fire` without them; the trigger slots are written as comments
  (`// after integration: air`) in `act2.ts`.

### The theatre map (`src/game/campaignArt.ts`, `src/pages/Campaign.tsx`)

- A second theatre map for act two, its own look (a northern coast and highlands), drawn by
  `drawCampaignMap` when the mission shown is order 9 or more; `campaignNodePosition(order, w, h)`
  places nodes 9 to 14 along it (route positions as today, counted from 9). The campaign screen
  offers both acts once act two is open, and opens on the act of the next unfinished mission.
- `campaignComplete` becomes true when mission 14 is won.

### Tests (`scripts/drive-act2.ts`, `scripts/campaign-check.ts`)

- Each new objective kind: done, failed and progress, with a hand-built mission; `holdZone` with and
  without `reset`; labels.
- `campaign:fire`: all fourteen mission specs valid (every point on the map and on open ground, the
  convoy's route walkable), each act-two mission built and run 2,000 ticks, progression from
  mission 8 to 9 and on to 14, saves from before act two still load.
- Missions 1 to 8 unchanged: their `campaign:fire` checks and `drive:fire` lines as in section 1.

---

## 6. Integration

Merge order A, then B, then C (A changes the most shared code). After each merge: `npx tsc -p
packages/fireline --noEmit`, `npm run drive:fire` (compare with section 1 and with each workstream's
stated changes), `npm run campaign:fire`, and at the end `npm run check`, `npm run tours --
fireline` and a browser run of a 4-sided battle with air in both light and dark mode.

Known seams the integrator closes, none of which a workstream should pre-empt:

- The computer's air play against several enemies: `airPlan` takes the lists B's block produces.
- Aircraft in 3- and 4-sided battles: nothing extra expected, since A asks `isEnemy` throughout.
- Air units in act two missions 11, 12 and 14 (section 5).
