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

Freeplay on advanced tech (the default for a new freeplay game; the original set is the
"standard" option, and every save from before has no setup at all and plays exactly as before):

| Structure | Size | Cost | Power | Needs |
|---|---|---|---|---|
| Sandbag Wall | 1x1 | 50 | 0 | Barracks; not a structure for victory |
| Repair Bay | 2x2 | 800 | -30 | War Factory |
| Rocket Turret | 1x1 | 900 | -40 | Comms Uplink |
| Tech Centre | 2x2 | 2000 | -60 | War Factory, Comms Uplink; grants the artillery barrage |
| Strike Command | 3x3 | 3500 | -150 | Tech Centre; grants the missile strike every eight minutes |

| Unit | Cost | Role |
|---|---|---|
| Grenadier | 250 | Short-arc splash, infantry and structures |
| Medic | 300 | Unarmed, heals infantry within two tiles |
| Flame Tank | 1100 | Close-range flame with splash (Tech Centre) |
| Missile Carrier | 1300 | Range 8 anti-armour, minimum range 2.5 (Comms Uplink) |
| Bastion | 1800 | Slow heavy siege tank, mends itself (Tech Centre) |

The Comms Uplink also grants the recon sweep. A freeplay setup (lobby, saved in `state.setup`)
picks the map (classic, river, highlands, lakes, plains, canyon, or random: drawn from the seed),
the tech level, starting credits (clamped to 20,000) and ore. Maps come from
`generateSkirmishMap` in `src/sim/maps.ts`: point-symmetric, so neither seat is favoured by the
ground.

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

## 7. Phones and touch screens

Every pointer event is routed by its own `pointerType`, so mouse and finger both work on the same
device. `game/layout.ts` reads the window and decides the arrangement.

- **Gestures on the battlefield.** One finger drags the view, two fingers pinch to zoom, and a
  finger lifted without moving (10px slop) is a tap. With your units selected, a tap on open
  ground, ore, a refinery or an enemy is the order a right-click would give; a tap on your own unit
  or structure selects it. A selected Barracks or War Factory plus a tap sets the rally point.
  Double-tap a unit for every unit of that kind on screen.
- **Command bar** (touch screens only), along the foot of the map: Box (the next drag draws a
  selection box), Army (every fighting unit you own), Attack (then tap: attack-move), Stop, Clear,
  Base. While placing a structure or aiming a hero ability or support power it shrinks to one
  Stop placing or Cancel button in the corner: centred, it sat under the ground near the base and
  a phone's tap adjustment snapped map taps onto it. In a campaign battle the hero and power bar
  and the feed sit above it, and a tap completes an ability or power the way a click does.
- **Build buttons** carry a × to cancel, since iOS has no long-press context menu. On a touch
  screen they drop the hotkey letter and the hover stat card, which would stick open after a tap.
- **Layout.** An upright narrow window stacks the map over the build panel (the panel takes at
  most 44%, and the selection moves to its top). A phone on its side keeps the sidebar, narrowed to
  228px with the minimap beside credits and power. Under 1100px the top bar keeps Lobby, clock,
  Pause and Menu; speed, sound, theme, motion, the tour and the controls sheet move into the Menu, which
  pauses the battle and hides the tour card while open. The shell uses `100dvh`.
- **Edge scrolling ignores mouse events within a second of a touch.** Browsers follow a tap with a
  synthetic mouse move; without the guard, a tap near the edge of the map started edge-scrolling
  and carried the view away from the base.
- **Tour.** Steps say tap and name the command bar; Select your riflemen rings Army. On a narrow
  screen the card goes full width above or below its target; on a phone on its side, a battlefield
  step puts it over the build panel. `npm run tours -- fireline-touch` plays the whole run by touch
  on an upright iPhone (CI's quick mode), the iPhone on its side, and a Pixel 7.


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

### 2026-11-08 — Round 1's computer opponent; even seats

The opponent workstream re-ran after a usage limit and landed: economy first, repairs, counter-
picked units, hauler raids, waves that gather, regroup and fall back, retreat below 30% health.
`npm run ladder:fire` (scripts/ai-ladder.ts, 150 seeds a match, parallel workers) measured the new
commander beating the old 82% of the time, and, from the same seat, the opponent winning 0% on
Easy, 78% on Normal and 97% on Hard.

The ladder also proved the seat imbalance first seen in round 1: side 1 won 78% of mirror games
with either commander. Every structure's front (door, refinery dock) was its south edge, which
faces away from the enemy for side 0 but towards it for side 1. `frontRow()` in grid.ts now puts
the front away from the enemy for both; docks, doors, spawns, placement, the AI's lanes and the
mission layout use it. The 150-game mirror now reads 43% to 56%, within about a margin of error
of even. Side 0, the player, plays exactly as before. Cosmetic gap still open: side 1's refinery
chute and factory door are drawn on the south face while its units leave from the north.

### 2026-11-08 — Campaign (see fireline-campaign-design.md)

Contract first, then four builders in parallel (simulation, campaign content and progression,
art, interface), then integration. Integration found and fixed: missions built the AI's memory
with five fields after round 1 had added seven more (now one `newAiMemory()` for both); the
campaign map hit-tested clicks with the wrong signature for the art's node positions, so clicks
missed the drawn nodes (now the same function and radius); the interface estimated hero health,
prices and cooldowns itself (now the sim's `maxHpOf`, `costFor` and `abilityCooldown`). Harness
tests written against the old AI broke under the new one, which rightly defends and refunds;
ability tests now run with side 1's commander off (`noCommander`). Mission AI modes added:
passive, defend, raid, and no structure queued by an outpost with no Command Yard; each is tested
by what the enemy actually does over twelve minutes. A hero ordered to use a structure ability
out of range now walks there and uses it on arrival.

Numbers at integration: drive 210,000+ assertions (about 80s), campaign-check 1,209 with all
eight missions built and run 2,000 ticks, the guided tour passes, and a browser run through
lobby, new campaign, map (clicking a node on the canvas), briefing, deploy, battle HUD, debrief
and back to the map (mission 1 won, mission 2 open) with no page errors.

### 2026-11-08 — Playable on phones

Touch gestures, the command bar, the phone layouts and the touch tour driver (§7). Until now the
only way to give an order was a right-click, so a phone could build but never move a unit. The
touch driver found three faults the desktop driver never could: the tour card covered the Menu
(so the Menu could not be used during the tour); the echo of a tap started edge-scrolling and
dragged the view off the base; and a centred Stop placing button swallowed taps aimed at the
ground near the base. All three fixed. The desktop layout at 1100px and wider is unchanged.
Rebuilt onto the campaign merge (#21), so hero abilities and support powers take a tap too.

### 2026-11-09 — Freeplay depth: new tech, random maps, a movement fix

Contract first, then four builders in parallel (rules and simulation, maps, art, interface and the
computer commander), then integration. Freeplay now defaults to a random map from six generated
types and the advanced tech above; the lobby offers map, tech, credits and ore, the server
validates the setup (`normaliseSetup`, junk falls back to defaults, no setup gives the original
game) and the saves list shows the map type. Both commanders build and use the new tech.

Integration found a movement bug that predates this round and was starving economies on every
map: a hauler whose smoothed path clipped the corner of a blocked tile from an off-centre position,
or whose path had since been cut by a new structure or wall, could stand still for the rest of the
game. A blocked step only counted as stuck when the very next point was blocked, and re-pathing
from the same tile gave the same line. `stepAlong` now looks a little further ahead, slides along
an open axis or steps back to its tile centre when blocked, and only a clean step clears the stuck
count, so a cut path is re-planned within a second. `npm run drive:fire` now fails any battle where
a hauler carrying ore home to a standing refinery stands still for two minutes; on the old code that
check failed 10 of the 28 standard battles.

AI ladder after the fix, 150 seeds on random maps with advanced tech, side 0 Normal throughout:
the mirror 45% to 54%, Hard on side 1 wins 91% (61% before the fix) and Easy 0%. The gaps widened
because haulers now deliver all game, so Hard's 25% income bonus and Easy's 20% cut compound. Before
the fix a 900-seed mirror per map type read 45% to 54% except plains (42% for side 0); not yet
re-measured, so left open below.

### 2026-11-09: Two, three or four sides (the round-4 foundation)

The engine no longer assumes two sides. `Owner` runs 0 to 3; a battle has 2, 3 or 4 players, each
on a team (`s.teams`), and every "who is the enemy" question goes through `src/sim/sides.ts`
(`isEnemy`, `isAlly`, `enemiesOf`, `wonBy` and the rest) instead of `1 - owner`. Targeting, splash,
attack orders, Spy detection, the computer's enemy lists, mission objectives, production, power,
blackouts, support powers and the computer's memory are all per side. Allies share sight (side 0's
fog is its team's), never hit each other, and win or lose together: the battle ends when side 0's
team is out or is the last team standing. Structure fronts face away from the middle of the map
by where each side starts, which gives exactly the old rule on every two-sided map. The map's size
is now a state property (`s.mapW`, `s.mapH`), read by the simulation, the renderer, the terrain
painter, the effects and the minimap; every map is still 64 by 64. Sides 2 and 3 have names
(Verdant Front, Ochre Legion), canvas colours with their own emblems, and chrome tokens in both
modes. No lobby option creates more than two sides yet: that, air power and campaign act two are
round 4's three workstreams, whose contract is `fireline-round4-design.md`.

Two-sided battles replay byte-identically: 14 whole battles (normal, easy, hard and every map
type) hashed the same at every 3,000 ticks before and after, and every summary line of
`npm run drive:fire` is unchanged. Saves from before load as two sides, free for all, on 64 by 64,
and play on exactly. New drive sections build three-sided battles by hand and check the helpers,
teams, shared sight, allies holding fire (splash included), victory with two allies left, defeat
only when the whole team is out, side 2's production and commander, and exact replay.

### 2026-11-09: Air power and research (round 4, workstream A)

Advanced tech only, as the contract (`fireline-round4-design.md` section 3) sets out. On standard
tech, in a mission and in every save from before, nothing changes: no Air tab, no Lab, and the
computer builds none of it.

| Structure | Size | Cost | Power | Needs |
|---|---|---|---|---|
| Helipad | 2x2 | 1500 | -40 | War Factory, Comms Uplink; builds and rearms two aircraft |
| Flak Cannon | 1x1 | 700 | -25 | Barracks; flak, range 7.5, air only |
| Research Lab | 2x2 | 1500 | -50 | War Factory; one upgrade at a time |

| Unit | Cost | Role |
|---|---|---|
| Gunship | 1400 | Rockets (38, range 4.5) at ground targets; 8 loads, a load every 1.2s on its pad |
| Bomber | 2000 | Fast (2.2 tiles/s); a run of 6 bombs (110, splash 1.3) in a line about 4.4 tiles long; a load every 2.5s on its pad. Needs a Tech Centre |
| Flak Track | 700 | Mobile flak, range 6.5, air only |
| Skyhunter | 350 | Anti-air missiles, range 6, air only |

| Upgrade | Cost | Time | Effect |
|---|---|---|---|
| Refinery efficiency | 2000 | 70s | ore pays 15% more |
| Armour plating | 1500 | 60s | vehicles' full health +20% (standing ones keep the damage they have taken) |
| Engine tuning | 1200 | 50s | vehicles 15% faster |
| Weapon calibration | 2000 | 75s | every weapon, units and structures, +15% damage (needs a Tech Centre) |
| Air frames | 1500 | 60s | aircraft health +25%, rearming 40% sooner (needs a Helipad) |

How it plays (`src/sim/air.ts`, `src/sim/research.ts`, `src/sim/aiAir.ts`):

- Aircraft fly straight lines over water, rock and structures, kept half a tile inside the map,
  and are left out of crowd separation, so they never push or block anything on the ground; a
  structure may go up under one. Sight and fog treat them like any unit.
- Only bullets (at 35%) and the anti-air weapons reach the air, and the anti-air weapons reach
  nothing else. Targeting, attack orders (`canAttack`), splash (anti-air splash stays in the air,
  every other splash, bombs included, on the ground) and returning fire all follow that: a tank
  shot by a gunship neither turns on it nor chases it.
- Out of loads an aircraft flies home and rearms; its pad gone, it takes another with room, and
  with none it waits where it is. Full, it stays parked on the pad, and a parked Gunship fires at
  ground targets in reach without leaving. A Bomber's run, once begun, is always finished
  (`Unit.bombRun`, an optional field the contract did not list).
- Research is paid in full on starting, refunded in full on cancelling, half speed on low power,
  paused while no Lab stands. Effects are read where the number is used: health through `maxHp`,
  damage in `fire`, speed in the movement step, income at the refinery, rearming in `air.ts`.
- The computer, after its own decisions: anti-air in proportion to the opponent's aircraft (none
  while it has none), paid for by taking back units it has queued but not started; then, once its
  refineries and turrets stand and its army at home is up to the next wave and to the opponent's,
  a Research Lab, Helipads (two on Hard), aircraft (Easy one Gunship, Normal a Gunship and a
  Bomber, Hard two of each), and research in a fixed order by difficulty. Gunships strike haulers
  and artillery where the fewest anti-air guns cover them; Bombers the thickest knot of
  structures. Aircraft not on a strike stay parked, so the ground waves never take them along.
  Nothing new goes on air once the map holds under 20,000 credits of ore, and with the ore all
  gone and no army left it sells its air structures and puts what it has into infantry: without
  those two rules the extra spending left both sides with nothing in the last minutes of a long
  battle, and 2 of the 12 advanced-tech drive battles ran to the tick cap.

Interface: an Air tab after Vehicles (advanced tech only; Tab skips it otherwise), the Research
block at the foot of the Structures tab once a Lab stands, hotkeys B, N and D for the 12th to 14th
items of the now longer Structures list, the ammunition and rearming state of a selected aircraft,
an Aircraft panel in How to play. Art: the seven new looks in any side's colours, aircraft drawn in
one pass after every ground unit, lifted over a shadow (lower when parked), with a turning rotor or
contrails; bombs falling, bomb blasts, flak bursts at the aircraft's height; aircraft on the
minimap with a wing bar. Chrome tokens `--ui-research-*` in both modes.

Two lines outside the contract's list were unavoidable and are kept to the minimum: the
`newPlayer` in `mission.ts` gives a mission's players an empty air queue (its return type demands
it), and `ai.ts` widens its private `ArmorClass` to the new armour class. In `drive.ts`, besides the
two markers, the invariants let aircraft stand over water and structures.

Numbers. `npm run drive:fire`: the mission and standard-tech lines unchanged; the advanced-tech
lines are now "12/12 finished, average 26.8 game minutes; side 0 won 4, side 1 won 8" (classic
side 1 in 28 and 33 min, river side 1 in 25 and side 0 in 27, highlands side 0 in 34 and side 1 in
33, lakes side 1 and side 0 in 17, plains side 1 in 27 and 24, canyon side 1 in 31 and side 0 in
27). In all 304,822 assertions, about 7,900 more than before, in 167s. AI ladder, 150 seeds,
random map, advanced tech, side 0 Normal throughout (before, then after): the mirror 45% to 54% (1
unfinished), then 49% to 49% (3 unfinished); Hard on side 1 wins 91%, then 89%; Easy 0%, then 0%.

### 2026-11-09: Bigger battles, three and four sides (round 4, workstream B)

The lobby offers 2, 3 or 4 sides and, with more than two, free for all or teams (`SkirmishSetup`
gains `sides` and `mode`; `normaliseSetup` repairs anything else to two sides, free for all, and two
sides are always free for all). Teams come only from `teamsFor`: a 2 against 2 is sides 0 and 2
against 1 and 3, and three sides as teams is sides 0 and 2 against side 1. Side 1, alone, starts
with `LONE_SIDE_CREDITS` (2.25) times the setup's credits: over 60 computer battles at 2.25 the
pair won 48%; over 40 each, it won 70% at 2, 33% at 2.5 and 3% at 4. Starting credits were the
handicap chosen because income is read in `tick.ts`, which this workstream does not touch. Two sides take exactly the old code path.

Maps (`generateSkirmishMap(seed, type, ore, sides)`): 80 tiles square for three sides, 96 for four.
The generator draws side 0's wedge (a quarter, or a third) mirrored about its own axis and turns it
round the centre, so a feature at the edge of a wedge meets its turned copy. Four sides are exactly
symmetric (tile (x, y) matches (95-y, x)): side 0 bottom left, 1 top right, 2 bottom right, 3 top
left. Three sides are turned by -0.5 and 0.8660254037844386, rounded to tiles, on a disc with rock
corners; side 0 bottom centre, 1 upper right, 2 upper left. `sidesProblem` (called by `mapProblem`
when there are more than two starts) checks the size, the symmetry, every site in one half, the
yards clear, everything connected, a home field by every site, a contested field, and fairness:
over 20 seeds of every type the largest spread between three sites was 9.4% in buildable ground,
7.1% in home ore and 6.9% in walking distance (eight ways, as units path), inside the stated
tolerance of 12% (`SIDES_TOLERANCE`). Each wedge holds a home field, a track to the centre and to
each neighbour, a field on each border shared by the two neighbours, and a rich field in the
centre; the map types add rivers or ridges along the borders, lakes, or a ring of cliffs.

The computer (`src/sim/aiSides.ts`): `chooseEnemy` aims each commander's waves at one enemy, the
nearest standing base by walking distance weighted by that side's strength (weaker counts nearer),
a quarter nearer if an ally is already attacking it, kept for `FOCUS_TICKS` (two minutes) unless it
falls. Near ties break the same way round the map for every seat: before that rule, both of side
0's neighbours chose side 0 first. `alliedPlan` sends half the idle reserve to an ally hit within
the last 20 seconds, unless its own base is under threat, and brings strays home. Defence still
answers every enemy. With one enemy and no ally both are no-ops, so the summary lines of
`npm run drive:fire` for two sides are unchanged.

Seat fairness, 4 sides free for all, advanced tech, 120 seeds played to the last side standing
(`scripts/sides-fairness.ts`): side 0 won 26.7%, side 1 25.0%, side 2 26.7%, side 3 21.7%, every
seat within the 7.9 points two standard errors allow. The interface: Sides and Mode in the lobby
with every map preview drawn for the chosen number of sides and a line naming each side and its
team, "2 against 2" or "3 sides, free for all" in the saves list (the server reads the player count
and mode from the saved state), each computer side named in its colour in the top bar (allies
marked, a side that is out struck through), and the end card naming the winning team.

### 2026-11-09: Campaign act two (round 4, workstream C)

Six more missions, 9 to 14, on a second theatre map: the northern coast and the highlands behind
it. Winning mission 8 opens mission 9; the campaign is complete when mission 14 is won. The act
brings in the round-3 advanced tech one or two arms at a time, in the enemy's hands first and then
the player's: sandbag walls and Grenadiers (Iron Coast), Medics and the Repair Bay (Convoy North),
Rocket Turrets and Missile Carriers (The Long Hold), the Tech Centre and Flame Tanks (Firestorm),
Bastions and the Strike Command (Bastion Line), and everything in the final assault on a full
Combine base, a normal commander on hard (Last Light). Specs are in `src/campaign/act2.ts`; the
design is section 9 of `fireline-campaign-design.md`.

New in the simulation (`mission.ts`, all pure):

- **escort**: a mission's `convoy` (side 0's units) is placed when the mission is built and sent
  along its route as a move and queued moves; the player may stop or redirect it. Done when
  `count` convoy units are within `r` of the point, failed when fewer than `count` are left;
  progress is how far along the route the leading unit is.
- **destroyWithin**: counted like destroy, failed once the tick passes its limit.
- **holdZone with `reset`**: an enemy alone in the zone drops the count to nothing; contested, it
  only pauses, as before.
- **structurePowers** on a mission: structures grant support powers for both sides as in an
  advanced skirmish (Uplink, Tech Centre, Strike Command), never touching powers the mission gave
  at the start, and the computer side calls its barrage and missile once charged (the missile at
  side 0's densest structures, the barrage at a knot of three or more units). The computer's own
  commander still plays standard tech in a mission, so this is how the enemy's Tech Centre and
  Strike Command matter.

Interface: the objectives panel's Show button follows the convoy's leading vehicle, a timed
objective shows its time left, the escort point has a ring, and the campaign screen offers both
acts as tabs once act two is open, opening on the act of the next unfinished mission.

Tests: `scripts/drive-act2.ts` (91 assertions inside `npm run drive:fire`) proves each new kind
with hand-built missions, from labels to saves and replay. `npm run campaign:fire` checks all
fourteen specs against their maps (the convoy's route walked leg by leg), builds and runs each
act-two mission, checks progression from 8 to 14 and saves from before act two, and plays four
act-two missions to a win: Convoy North escorted by script (and lost if left alone), The Long Hold
held by a garrison kept supplied (and overrun, its count reset, without one), Iron Coast by the
skirmish commander, Bastion Line by the commander with the army sent at the turrets. Firestorm's
Commando, placed at the Strike Command, stops the first missile. Every summary line of
`npm run drive:fire` is unchanged.

### 2026-11-09: Round 4 integration

The foundation (sides, then the contract) went first; air, bigger battles and act two were built
in parallel on it and merged with conflicts only in the docs. Putting them together found:

- Act two's air slots filled: gunship raids on Graystone Ford (mission 11) with Skyhunters for the
  garrison and two more tanks, because Skyhunters cannot fire at the ground and without the tanks
  the scripted garrison lost the ford; bomber runs on the base in Firestorm (12) with Flak Cannons
  cleared; the whole air arm for both sides in Last Light (14), whose Combine base now has Helipads,
  a Research Lab and Flak Cannons, so its raiders go home and rearm.
- A Bomber on attack-move flew to the point and hovered with a full bay. It now bombs the first
  enemy structure it comes near, then rearms.
- Ground units no longer chase aircraft on attack-move or the aggressive stance; they fire at what
  comes in range. An explicit attack order still pursues.
- The sides harness's invariants now let aircraft stand over water and structures, as drive's do.
- A mission with no base opens the camera on the player's units, not the map's corner.

Numbers at integration: drive 344,186 assertions, campaign-check 2,595 (fourteen missions), both
tours (desktop, and touch on three phones), 27 loading checks and 573 server tests pass. AI ladder,
150 seeds, random maps, advanced tech: the mirror 51% to 47% (2 unfinished), Hard on side 1 wins
91%, Easy 0%.

### 2026-11-09: Demolition (mission 4) made winnable; the Commando strengthened

Reported unbeatable. Played by script it was lost every way in, and for three separate reasons:

- The outpost ran a refinery on 'defend' and trained a rifleman every five seconds: 13 at one
  minute, over 50 by the time the Commando arrived. It is now 'passive' (a fixed garrison of four
  riflemen and a rocketeer that fights what comes close and trains nothing), and 'defend' itself now
  only replaces losses up to the garrison it started with (`AiMemory.garrison`), in every mission.
- Its Gun Turrets (range 5.5) outranged the Commando (4.5): he died in four shells without firing.
  Two turrets now, not three, and the briefing says where they cannot reach.
- The buggies sent after the extraction spawned where the last Generator stood, on top of the
  Commando, and buggies are two and a half times his speed: no race was possible. A squad of five
  riflemen now marches from the north-west corner instead, the Commando's own strength.

The Commando himself: health 160 to 240, range 4.5 to 5, reload 9 ticks to 7. Six riflemen deal
about 54 a second together and he killed one every two seconds, so at 160 he lost any open fight.
His squad is four riflemen and two rocketeers (was three and two). campaign-check now plays the
mission by script straight at the outpost and round its flank, and both must win.

### 2026-11-09: Round 5 contract and groundwork

The player asked for the tech tree in a pop-out window, repair trucks, larger maps and forward
bases, for much longer games with more tech. That is four parallel workstreams, set out in
`fireline-round5-design.md`: A the build window (interface only), B larger maps and long games, C
engineering vehicles (the Repair Truck, and the Forward Base Truck that deploys into a Field Yard),
D neutral sites (Oil Derrick, Field Hospital, Comms Relay) and tier three (Prototype Works,
Fortress, Railgun Tank, Stealth Tank).

The groundwork committed with the contract changes nothing in play: the build lists are one table
in `rules.ts` (`MENUS`), a queue may be worked by more than its producer (`ALSO_PRODUCES`, read by
`producerFor` and the new `hasProducer`), the setup carries an optional map `size` and `sites`
switch (repaired by `normaliseSetup`; old setups read as standard size, no sites), `GameState`
carries an optional list of neutral `Site`s (not structures, so `sides.ts`, targeting and victory
are untouched), the reducer knows the `deploy` and `undeploy` actions by name and refuses both
until workstream C, a selected unit or structure can offer its own commands through
`src/game/selectionActions.ts` (a button each, and F in a skirmish), and marker comments mark every
place a workstream adds lines to a shared file. Every printed line of `npm run drive:fire` is the
same before and after; the assertion count rose by one (the new `'rail'` weapon kind's flight time).

