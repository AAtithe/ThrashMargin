# Fireline — design and build log

A real-time strategy game in the genre of the classic base-builders: one Command Yard, ore to
harvest, power to keep ahead of demand, and an army to build and send. Original setting, names
and art: the Meridian Corps (blue, the player) against the Ashen Combine (red, the computer).

Package: `packages/fireline`. Served at `/fireline/`. Saves: `/api/play/fireline`, `games.game =
'fireline'`. Dev server: `npm run dev:fire` (port 5178). Tests: `npm run drive:fire`.

---

## 1. The game in one paragraph

Each side starts with a Command Yard, three riflemen and 3,000 credits on a 64 by 64 map that is
point-symmetric, so both start with the same ground and the same ore. The Yard builds structures
one at a time; a finished structure is placed by hand within four tiles of something you own.
Refineries arrive with a hauler, which gathers ore and turns it into credits. Barracks train
infantry, the War Factory builds vehicles, Generators supply power. Short of power, every queue
runs at half speed, turrets fire half as fast and the radar goes dark. A side loses when it has no
structures left.

## 2. Rules (all numbers in `src/sim/rules.ts`)

| Structure | Size | Cost | Power | Needs |
|---|---|---|---|---|
| Command Yard | 3x3 | (start) | +20 | |
| Generator | 2x2 | 300 | +100 | |
| Refinery | 3x2 | 1500 | -30 | Generator |
| Barracks | 2x2 | 400 | -20 | Generator |
| War Factory | 3x3 | 1800 | -40 | Refinery |
| Gun Turret | 1x1 | 600 | -25 | Barracks |
| Comms Uplink | 2x2 | 1000 | -50 | Refinery |

| Unit | Cost | Role |
|---|---|---|
| Rifleman | 100 | Anti-infantry |
| Rocketeer | 300 | Anti-armour and structures |
| Ore Hauler | 1200 | Economy (factory and refinery) |
| Raider Buggy | 500 | Fast scout, machine gun |
| Battle Tank | 800 | Main line unit |
| Artillery | 1000 | Range 9, splash, minimum range 2 (needs uplink) |

Damage is weapon kind against armour class (`DAMAGE_VS`). Shells, rockets and artillery are
projectiles with a flight time; artillery lands where the target was, with a little scatter.

Paying: in full when queued, refunded in full on cancel. Selling returns half, scaled by health.
Repair is paid as it goes. Ore regrows slowly on tiles that still hold some.

## 3. Engine

`src/sim/` follows the repo's purity rule (CLAUDE.md invariant 2): no `Math.random`, no clock.
Every random choice (map generation, AI picks, artillery scatter) draws from `rngSeed` in the
state. `processAction` clones the state once and works on the clone, so its input is never
touched; an illegal action returns the same object. One action is one order or one or more ticks
(10 ticks a second at normal speed). Trigonometry is kept out of the simulation (formation slots
are integer offsets) so a replay is exact.

- `map.ts`: value-noise terrain, mirrored about the centre; anything unreachable from a base
  becomes rock.
- `grid.ts`: occupancy, A* with string-pulling, distances.
- `commands.ts`: every order as a `can*` check and a `do*` apply, shared by player and AI.
- `tick.ts`: production, AI, units (movement, targeting, firing, harvesting), structures,
  projectiles, crowd separation, deaths, ore regrowth, fog, victory.
- `ai.ts`: build order by difficulty, unit mix, attack waves, base defence.

The computer plays by the same rules and orders. Two stated differences: it sees the whole map,
and on Hard its refineries pay 25% more.

## 4. Client

Canvas 2D, no image files. `game/art.ts` draws every unit and structure with paths, in either
team's colours; the same functions draw the build menu icons. `game/terrain.ts` paints the ground
once per battle. `game/renderer.ts` draws a frame: terrain window, scorch marks, ore, structures,
units interpolated between ticks, projectiles, muzzle flashes and explosions, particles, fog
(a 64 by 64 canvas scaled up with smoothing, which gives soft edges), placement ghost, drag box.
Particles and scorch marks are renderer-only and may use `Math.random`.

Saves: every 15 seconds of play, on pause, on leaving, when the tab hides and when the battle
ends. Not after every action, unlike the turn-based games: the battle advances ten times a second.

## 5. Guided first battle

`components/GuidedTour.tsx`, twelve steps on the live battle, which keeps running underneath:
build and place a Generator, then a Refinery; read how ore becomes credits; select the riflemen
with a box and give them an order; build a Barracks and train a soldier; read the power bar; a
closing card on what comes next. It opens by itself on a fresh battle (under a minute in) for
anyone who has not finished or skipped it in this browser (`fireline_tour_seen`), and the Tour
button in the top bar reopens it on the welcome card at any time.

Built to the lessons the portal's other tours paid for: every predicate compares against a
snapshot taken when its step became current, so nothing completes on arrival; completion is
latched, so a move order turning back into idle cannot undo it; it always opens on the welcome
card; it stays mounted (hidden) through pause, the controls sheet and the end card. The card
carries `data-tour-target`, `data-tour-manual` and `data-tour-done`; build buttons carry
`data-state` and the battlefield `data-placement`, so `scripts/tours/fireline.cjs` can play it
by doing what the card names. That driver waits 1.5s on every step before acting, checks the
ringed control is on screen, uncovered and enabled, pauses and resumes mid-run, checks the save
for the real effects, and checks a finished run is not offered again.

## 6. Sound

`game/sound.ts`, synthesised with the Web Audio API: no audio files, for the same reasons the art
is code. Gunfire by weapon (machine gun, tank shell, rocket whoosh, artillery thump), explosions
by size (hit, vehicle, structure), selling, placing a structure, build-menu clicks and refusals,
unit orders and selection, "ready" chimes, the under-attack alarm, victory and defeat stings.

- Audio starts only after the player's first click or key press, as browsers require.
- Battle sounds are panned by screen position and fade with distance from the middle of the view.
  Anything under the fog is silent, so sound never reveals what the player cannot see.
- Each sound has a minimum gap and the mix has a 24-voice cap, plus a compressor, so a large
  firefight stays legible.
- Sound on or off (top bar, or M) and volume are saved per browser in `fireline_sound`.
- The renderer marks effects already in a loaded save as heard, so opening a battle mid-fight does
  not play a burst of stale explosions.
- Renderer-side only: the simulation never touches it.

## 7. Not built yet

- Touch controls. The game is playable with a mouse and keyboard; orders are right-click.

---

## Build log

### 2026-11-08 — First playable build

Engine, AI, renderer, lobby, saves, portal registration. `npm run drive:fire`: whole battles over
28 seeds (20 Normal, 4 Easy, 4 Hard) computer against computer, plus every order legal and
illegal; about 120,000 assertions in about 40 seconds. All 28 battles finished, average 17 game
minutes, side 0 won 12 and side 1 won 16 (symmetric map, so that split is noise at this sample).

Two problems the harness found on the way, both fixed before the first commit:

1. A traffic jam froze an economy. The AI's staging point sat between two refineries, idle units
   crowded the dock pad, and separation pushed haulers back as fast as they drove. Fixed three
   ways: whoever is standing still gives way to whoever is moving (haulers most of all), idle
   units step off dock pads and factory doors, and the AI stages its army on open ground.
2. Under `tsx`, module-level constants read inside the innermost loops cost a getter call each
   time; local copies in `grid.ts` and `tick.ts` halved the harness time. Results were identical
   before and after (same winners, same ticks), which is the determinism doing its job.

### 2026-11-08 — Guided first battle

Added the tour and its driver (above). `npm run tours -- fireline` passes; `scripts/loading-check.cjs`
no longer skips Fireline's tour check. The driver's first run caught React's warning for mixing
the `font` shorthand with `fontWeight` on a re-rendered button, in the tour card and the sidebar
tabs; both now set `fontFamily` instead.

Browser checks (first build): 60 frames a second during a 15-minute battle at 1440x900; light and dark mode;
`node scripts/loading-check.cjs fireline` 25 of 25.

### 2026-11-08 — Sound

Added synthesised sound (§6). Checked in Chromium through the engine's play counts (exposed on
`window.__firelineSound` in dev builds only): audio stays locked until the first gesture; queue,
ready, place, select and order sounds fire on the matching actions; M mutes and unmutes; four
seconds of a large firefight produced 41 machine-gun shots, 3 rockets and 3 impacts, the throttle
holding gunfire to about ten a second. No page errors. `npm run tours -- fireline` and
`npm run check` still pass.

### 2026-11-08 — Tour fix from CI

CI's tutorial job failed on the tour commit: the run reached "Build a Refinery" with that button
disabled. The CI screenshot showed 2,400 credits and one item in the structure queue: a second
Generator. In the one render after a structure was placed, the placing state had cleared but the
step had not yet latched, so the card rang the build button again, and the fast CI runner clicked
it (a quick double click would do the same for a player). Two fixes: a step now counts as done in
the same render the game says so, and keeps ringing what it last rang while it pauses; and when
another structure occupies the queue, the queue and place steps ring that structure and explain how
to clear it, instead of ringing a disabled button. The driver now re-reads the card before every
click and checks the busy-queue path itself. Not reproducible locally even with the CPU slowed
four-fold; the screenshot is what found it.

### 2026-11-08 — Improvement round 1 (five parallel builders)

Five agents, one workstream each, each in its own git worktree and owning its own files, worked
against written contracts at the seams (pose fields, veterancy, group badges, AI measurement,
waypoints and stances); the plan is `fireline-improvements.md`. Four branches merged without a
conflict; the computer-opponent workstream hit a usage limit and is being re-run.

- Effects (`game/fx/`): tread marks, wrecks and rubble baked into the terrain canvas and faded
  back towards a pristine copy; layered explosions with debris and smoke columns; muzzle light;
  animated water and shore foam drawn into the terrain canvas; cloud shadows and vignette folded
  into the fog canvas; dashed order lines; veterancy chevrons; control-group badges.
- Art: much richer vehicles, infantry with a firing pose, structures with working machinery,
  damage drawn from health (scorch, holes, sparks, fire), per-pixel terrain with raised rock
  plateaus and banded shores. A sprite cache stamps each unit look per facing at screen
  resolution, which made the richer art faster than the old art in big battles.
- Gameplay: veterancy at 3 and 7 kills; waypoint queues (Shift + right-click, up to 12);
  aggressive, guard and hold-fire stances; survivors from destroyed and sold structures; shells
  now credit the unit that fired them. Older saves migrate. Harness: 170,387 assertions.
- Interface: build hotkeys Q to Y and Tab, Shift to queue five, combat alerts pinged on the
  minimap with Space to jump, an animated credits counter, a low-power banner, refusal toasts,
  stat cards from `rules.ts`, a hero banner and difficulty cards in the lobby. Repair moved from R
  to G; P alone pauses.
- Integration fixes: a selection of more than four units draws one order line per order rather
  than a web of one per unit; a fuller scrim behind the lobby headline; the controls sheet and the
  lobby's What is new strip now cover every workstream.

Found and handed on: over 84 computer-against-computer battles side 1 won 59 to side 0's 25, and
the same split appears on the code before this round, so the round did not cause it. The likely
cause is the two sides deciding at different points in the AI's cycle (and the income multiplier
applying only to side 1); it does not affect a human player but it skews harness win rates, and it
is the AI workstream's to measure.

Frame rate in headless Chromium (software rendering, no GPU): 60 fps on ordinary mid-battle saves
in each builder's own measurement; 47 to 58 fps in 200-unit set pieces, at or above the old
build in the same setup. Integrated measurements taken while a builder was running on the same
machine read lower and are not comparable; a check on a real GPU browser is still owed.
