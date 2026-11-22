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
Ore fields are drawn by `game/fx/ore.ts` (a ragged stain with lit crystal clusters that shrink as a
tile is mined, glints held still with motion off); `game/fx/ground.ts` gives each structure a
trampled skirt and a contact shadow and each unit a soft shadow. The fog grid is blurred before it
is scaled up, so its edge is a curve rather than a tile staircase.

The campaign's theatre maps (`game/campaignArt.ts`) are drawn as staff operational maps: paper,
grid references, contours, a front line that advances with each mission won, arrows of advance and
OBJ markers. Static layers are cached; only the open objective pulses. The lobby draws a preview of
the same map through `components/campaignArtBridge.ts`.
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

War for the Planet has its own guided first turn on the same pattern (`components/planet/PlanetTour.tsx`,
driven by `scripts/tours/fireline-planet.cjs`); see fireline-planet-design.md, build log, "Guided
first turn".

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

### 2026-11-10: The build window (round 5, workstream A)

The build lists have left the sidebar for a pop-out tech tree, as `fireline-round5-design.md`
section 3 sets out. Interface only: no file under `src/sim/` changed.

- **Sidebar.** Credits, power and the minimap as before, then a **Build** button naming the
  window's tab ("Build: Structures", with the `` ` `` key) and the **production strip**: one icon
  per queue with anything in it (the four build queues and the research under way), the head item
  with its progress bar and the queue's count. A click cancels the last one queued (right-click
  does the same); a ready structure pulses and a click picks it up to place. On touch a tap on an
  icon opens its list and the × cancels. Then the selection panel.
- **The window** (`src/game/BuildWindow.tsx`). Opened and closed by the Build button or the
  backquote key, closed by Esc (after the controls sheet, before placement and the rest) or its ×.
  `role="dialog"`, focus moves to the open tab on open and back to the Build button on close. Not
  modal. On a desktop it is a panel inside the battlefield's own box (so never over the sidebar),
  about 60% of it wide (at least 560px where the field allows) and at most 80% tall, dragged by its
  title bar; its place is kept under `fl_build_window` as fractions of the room it can move in, so
  it survives a resize. On phones and touch screens (`layout.touch` or `layout.stacked`) it is a
  full-screen sheet. It hides, keeping its state, while paused, on the controls sheet and at the end.
- **The tree** (`src/game/techTree.ts`, pure). Tiers from `requires` alone, the Command Yard
  ignored, memoised, a cycle counting as 0. Columns left to right on a desktop, rows top to bottom
  on a phone; within a tier, menu order. A structure needed from another tab is a ghost node at the
  start ("needs War Factory"), so every line has both ends. Lines are an SVG layer behind the
  buttons, measured from the laid-out buttons (again on any resize and whenever a Needs line comes
  or goes), solid in the met token, dashed in the unmet one. Cells are opaque, so a line passes
  behind a greyed (see-through) item rather than across it. A locked item names what it lacks.
- **Research** is a tab of its own after the others once a Lab stands (`tabsFor`), the old block
  unchanged; Tab and Shift+Tab cycle every tab the battle offers, window open or closed.
- **Placement.** Picking up a ready structure (button, key or strip) closes the window; placing
  it or cancelling placement reopens it on the same tab, if placement closed it. Opening the
  window while placing puts the structure back to Ready.
- **Hotkeys** are unchanged and act on the tab the Build button names, open or closed; the 15th
  item of a list onwards has none. The stat card now sits beside the window (right if there is
  room, else left), and on touch shows on a long press (which no longer cancels: only the × does).
- **Guided tours.** A step that wants a build button rings the Build button while the window is
  closed, then the list's tab, then the button, saying so in the card. A step on the battlefield
  (other than placing) rings the window's close button first while it is open, and on a sheet so
  does any step whose target is outside it. A card ringing a control in the window docks clear of
  the whole window (on a phone on its side, the half of the screen away from the target), so it
  never hides the window's other buttons. Both drivers pass; the touch driver now closes the sheet
  before its pan check and taps the card's own Close.
- **The window's own check**, `scripts/tours/fireline-build-window.cjs`, run by
  `scripts/tours/fireline.cjs` after the tour (or alone): on a fresh advanced-tech skirmish every
  `MENUS` kind (29) is on its tab, greyed exactly when the rules say, in the tier column the rules
  give, with a drawn line to every structure it needs; button, key and Esc open and close it, focus
  goes in and back; Tab cycles with it open and closed; Q queues with it closed and W with it open;
  picking up the Generator closes it and placing reopens it on Structures; picking up the Refinery
  and pressing Esc cancels placement and reopens it; dragging moves it, the place is stored, and it
  never reaches the sidebar; and a kind no rule knows (`window.__flExtraMenuItem`, honoured only in
  development builds), needing a Tech Centre and a Research Lab, is laid out in tier 4 with both
  lines and both ghosts, greyed and naming its needs.

Decisions where the contract was silent:

- Column headings read "Tier N" with N one more than the computed tier, the same numbers on every
  tab (infantry start at Tier 3, because a Barracks is tier 2). Round 5's own "tier three" (D) is a
  name for a set of tech, not this number; the integrator may want to relabel.
- A strip click cancels the *last* item queued in that queue, which is what `cancel` already does
  for a kind, and leaves the one in progress alone when the queue is longer than one.
- Esc closes the controls sheet before the window, because the sheet hides the window.
- The window opens first in the centre of the battlefield, a quarter of the way down.
- A few stale lines elsewhere in How to play (the first five minutes, Advanced tech, Aircraft) now
  name the build window instead of the sidebar list; the build window has its own panel under A's
  marker, and the Controls table has rows for `` ` ``, the strip, long press and the new Esc order.

Numbers: `npm run drive:fire` prints the same lines as before (A touches no simulation code);
`npm run tours fireline fireline-touch` pass (desktop with the window check; iPhone 13 upright and
on its side, Pixel 7). Checked by eye in light and dark at 1440 by 900, 1100 by 800, an iPhone 13
and 375 by 667, with no page errors.


### 2026-11-10: Round 5 B, larger maps and long games

A Map size field in the skirmish lobby: Standard, Large and Huge. The tiles, by side count:
standard 64, 80, 96 (as before); large 96, 112, 128; huge 128, 144, 160 (`MAP_SIZE_TILES`, at most
`MAP_TILES_MAX`). The lobby line under each size gives the tiles and roughly how long a battle runs;
the previews are drawn at the chosen size; the saves list says "Large map" or "Huge map". Everything
in play is gated on the size, so a standard battle, a mission or an old save plays exactly as before.

- **Maps.** The skirmish and sides generators stretch their layout by the map's scale and add
  fields: a second home field behind each base, contested fields on the flanks and more expansions.
  Over 20 seeds of every type (`tsx scripts/long-games.ts --maps`), 0 problems at any size; ore
  fields a map, standard, large, huge: two sides 5.6, 13.4, 17.2; three 6.9, 20.4, 20.2; four 8.7,
  21.6, 22.7. Largest spread between three sides' sites (tolerance 12%): large ground 11.5%, home
  ore 9.5%, walk 7.5%; huge 11.7%, 5.1%, 6.9%. Two sides are point-symmetric and four a quarter turn,
  so their spreads are 0.
- **Ore that spreads back** (large and huge only): every 300 ticks a worked-out ore tile beside one
  that still holds ore, with nothing standing on it, regains 60. A field never vanishes while one
  tile of it is left; ground that never held ore never gets any.
- **The computer** (`aiScale.ts`), per unit of scale over standard (1.5 on a large two-sided map, 2
  on huge): the first attack 150% later, the interval twice as long, two more in the first wave, four
  more in the largest, one more refinery and eight more turrets; it stages further forward and
  recruits from further out. The first numbers (60% later, 40% longer, eight more in a wave, no extra
  turrets) gave large battles no longer than standard ones: the waves were bigger but came as soon
  and broke a base that had no more defences. A base that holds out longer is what makes the game
  longer.
- **Long games.** Normal against Normal, advanced tech, the same eight seeds at each size: standard
  26.6 game minutes on average, large 44.9, huge 47.7, every one finished (single battles run 18 to
  84 minutes). The harness's cap is 45000 ticks standard (unchanged), 72000 large, 108000 huge.
- **AI ladder, large maps**, 60 seeds, random maps, advanced tech: the Normal mirror 43% to 57%
  (within the noise at 60 seeds), Hard on side 1 wins 92% (91% at standard size), nothing
  unfinished; average 36.1 and 24.3 game minutes. `ai-ladder.ts` takes `--size`.
- **Performance.** Measured, fixed, measured again. Before: the ore bed was drawn again from the
  running random stream every pass, which made the worst tick 114 ms, and the first frame of a
  160-tile battle took 5.1 s to paint its terrain. Fixed: `findPath` reuses its scratch arrays and
  keeps its heap in typed arrays (the same paths, compared on 3000 searches); the ore bed is cached
  by the battle's starting seed; fewer, longer path searches a tick and fog every 10 ticks on larger
  maps; the terrain is painted in a worker, the minimap's colours stretched over the battlefield
  until it arrives, and its per-pixel pass works a band at a time (the same pixels); the minimap's
  fog is one image. After, `perf-fire.ts`, four sides on huge (160 tiles), minutes 20 to 30, one
  tick a call: median 1.53 ms, p95 4.79 ms, p99 9.43 ms, worst 38.4 ms with up to 231 units
  (standard, four sides: median 0.22 ms, p99 1.17 ms). `perf-render.cjs`, minute 25 of a huge
  battle at 1280 by 800, panning for ten seconds: frame work median 3.3 ms (3.4 dark), p99 9.0 ms
  (8.7 dark), 60 frames a second, first frame 21 to 27 ms. Targets were a 4 ms median and 25 ms
  p99 tick, a 16 ms median frame.
- **Tests.** `scripts/drive-maps.ts`, six sections inside `drive:fire`: the size option and junk
  setups, 360 maps at large and huge, ore spreading, the computer's numbers, a huge battle replayed
  byte-identically and through a save, and whole battles (four large two-sided, one huge four-sided
  as teams: all finish, every side harvests, two-sided ones average 31.7 minutes against 27.4 at
  standard with the same seeds). Four battles rather than two, because two seeds once read shorter
  than standard. The sections add about 90 seconds to `drive:fire`. `scripts/long-games.ts` is the
  longer sweep. Every standard-size line of `drive:fire` is unchanged.


### 2026-11-10: Round 5, workstream C: engineering vehicles

The Repair Truck, and the Forward Base Truck that deploys into a Field Yard, as set out in
`fireline-round5-design.md` section 5. Advanced tech, skirmish only: none of the three kinds is in
`STANDARD_TECH`, so no mission and no standard-tech battle sees them.

- **Numbers as the contract started them.** Repair Truck 900 credits, 110 ticks, 300 health,
  light, mends 8 health every 5 ticks (16 a second, free) within 2 tiles, seeks within 8. Forward
  Base Truck 2500, 250 ticks, 900 health, heavy. Field Yard 2x2, 1000 health, build radius 6. Three
  yards and trucks a side at most, counting trucks queued.
- **Simulation** (`src/sim/engineering.ts`): `menderStep` from `updateUnit`; `deployProblem` and
  `doDeploy` (the yard's top-left is the truck's rounded tile less one, placement as any structure
  but with no "near your base" rule and the truck not in its own way; a truck moving or
  attack-moving may deploy, one on any other errand is "Busy"); `undeployProblem` and `doUndeploy`
  (refused for the side's last structure, and for the only producer while a structure is ready to
  place). Health carries over by share both ways. `placementProblem` takes options for the two
  exceptions and reads each structure's `buildRadius`. Packing up leaves the same ring and chime as
  a sale, which also tells the renderer to leave clean ground rather than rubble.
- **The Repair Truck takes a stance**, though unarmed: on Hold it stays where it is put. The stance
  buttons (the sidebar's, not this workstream's) show only for armed units, so the selection panel
  gains **Stay put** and **Roam** for Repair Trucks, beside **Deploy** and **Pack up**.
- **The computer** (`src/sim/aiEngineering.ts`). It spends every credit on units, so neither the
  trucks nor the expansion could ever be afforded: in the first measurements the computer never once
  held 2500. Engineering now saves: at each decision half its credits go into
  `AiMemory.engineeringFund`, out of reach of the rest of the commander, until the purchase can be
  paid for, and the fund goes back when it gives up. Repair Trucks: one once it fields 6 ground
  vehicles (haulers count, the trucks do not; counting only armed vehicles, a real battle rarely
  reached 6 at once), one per 8 after that, at most 3. Expansion on large and huge setups: with two
  refineries and no threat at home, the nearest ore field 24 tiles from its structures with no enemy
  within 12; truck, yard, then a Refinery and a Gun Turret round it (the commander asks
  `expansionSpot` before its own spot). Until workstream B lands, a large setup still generates a
  64-tile map, which is what the harness plays.
- **Campaign check**: the test that Last Light's enemy has every structure kind now skips the
  Field Yard (a structure only ever deployed). Missions are unchanged.

Measured (`npm run drive:fire`, 354,122 assertions, 0 failed; was 343,756): the four mission and
standard-tech lines are unchanged. Advanced lines now read:

```
  12/12 finished, average 26.1 game minutes; side 0 won 4, side 1 won 8
    classic: side 1 in 30 min, side 1 in 18 min
    river: side 1 in 25 min, side 0 in 25 min
    highlands: side 1 in 36 min, side 1 in 31 min
    lakes: side 1 in 21 min, side 0 in 31 min
    plains: side 1 in 18 min, side 0 in 17 min
    canyon: side 0 in 29 min, side 1 in 32 min
```

and in the round-4 sides block "12/12 finished, average 21.8 game minutes" (was 20.3), with the
four advanced battles moved: river three sides teams side 1 in 27 min (was side 0 in 12), river four
free for all side 3 in 17 (18), lakes three teams side 0 in 13 (17), canyon three teams side 1 in 32
(side 0 in 25). The hard air battle now reads "side 1 won at 21 min; 12 bombs, 5 gunship rockets, 4
aircraft at most; upgrades 0 and 0" (was 22 min, 10 rockets, upgrades 0 and 1): the fund draws on
the same credits research would. Advanced battles run a little longer, as the request wanted. The
engineering sections add 182 assertions and about 7 seconds. In the whole-battle section a hard
advanced battle on a large setup fields a Repair Truck that mends, and two Field Yards go down.
`npm run campaign:fire`: 2,595 assertions, 0 failures, all fourteen missions unchanged.


### 2026-11-10: Neutral sites and tier three (round 5, workstream D)

**Neutral sites** (`src/sim/sites.ts`, numbers in `rules.ts`): Oil Derricks, Field Hospitals and
Comms Relays, switched on by the lobby's Neutral sites field (either tech level). `SITES_PER_SIDE`
sets how many of each every side gets by map size (standard: one Derrick). `siteSpots(map, setup,
seed?)` picks spots in side 0's share (the bottom half, or side 0's wedge) and maps each through the
map's own symmetry: point mirror for two sides, the exact quarter turn for four, the third of a
turn rounded and nudged at most three tiles for three. Its own stream (the battle's seed xor a
constant; with no seed, a hash of the map), so placing sites moves nothing else: map, ore, the
battle's stream, the yards and the riflemen are as they were (ids aside, since sites take theirs
first). A spot needs clear walkable ground round it, no ore within two tiles, 13 tiles from every
yard and 8 from other sites if it can (the rules `sitesProblem` checks are 10 and 6), and must close
off no walkable ground. Bands of distance from home keep the first Derrick near home, the second
further out and Relays towards the middle. Over 180 battles (six map types, two to four sides, ten
seeds) every placement passes `sitesProblem`; large and huge maps are B's, so placement there is
the integrator's to measure.

Capture: one team's infantry within 1.5 tiles, alone, take a site in 100 ticks; two teams pause it;
nobody (or only the holder's own) and it winds down at the same rate; another team's partial capture
winds down before theirs starts. A side with no structure left loses its sites to neutral (the
contract was silent; a side that is out should not keep earning). Derrick 300 a minute exactly,
Hospital 5 health a second to the holder's infantry within 3 tiles, Relay 10 tiles of sight
through `visibility`, so allies share it. Sites block their tiles in `occupancy`, are never a
target, never fire and never count for victory.

**Tier three**: Prototype Works (needs Research Lab and Tech Centre), Fortress, Railgun Tank,
Stealth Tank at the contract's numbers. `DAMAGE_VS.rail` stays as the groundwork set it: 2.08 times
a Battle Tank's damage a second on heavy armour, 0.35 on infantry. Stealth (`stealthSeen`): unseen
and untargetable by an enemy beyond 2.5 tiles of its units and structures, except for 30 ticks
after it fires (its `lastShot`, recorded from the projectiles it launched that tick) or inside a
recon sweep. The four Spy checks in `tick.ts` now ask `seenBy` (the Spy still by `isDetected`,
unchanged), `enemyTarget` refuses a hidden one (so does `canAttack`), and `sitesStep` makes every
enemy drop one that slips from sight. The renderer skips hidden enemy Stealth Tanks and draws your
own faint, with a ripple. A Railgun shot has no projectile, so the site layer draws its streak.

**The computer** (`src/sim/aiSites.ts`): parties of two (Easy) or three infantry, up to one, two or
three at once, to the nearest site its team does not hold, a lost site near home first; a party
shuffles between two tiles beside its site so no other part of the commander takes it for idle
reserve, gives up after four minutes and leaves the site for six. In a sites battle both sides hold
a site within a minute. Tier three from minute 25 (Easy 30) with a hauler, a refinery and a factory
and its army at home up to strength: a Research Lab and Tech Centre if missing, the Works, a
Fortress (Normal and Hard; the commander's own placement puts it by the yard, since `findSpot` is
not D's), Railgun Tanks to one per two to four armed vehicles, and Stealth Tanks (Normal one, Hard
two) hunting haulers outside the waves. On a standard map most battles are decided by minute 25, so
tier three is rare there; in a held-back hard battle the Works went up at minute 27.5 and both tanks
followed.

Tests: `scripts/drive-sites.ts`, eleven sections, 1,904 assertions, about 25 seconds. Mission and
standard-tech lines of `npm run drive:fire` unchanged; of the advanced lines only these moved:
"12/12 finished, average 23.3 game minutes; side 0 won 6, side 1 won 6" (was 23.6) and
"highlands: side 0 in 20 min, side 1 in 36 min" (was 39). The round-4 sides block is unchanged.
344,405 assertions in all; `npm run campaign:fire` 2,595 (its Last Light check that the enemy fields
every structure kind now skips the two skirmish-only ones).

AI ladder, 150 seeds, random maps, advanced tech, after the change: the Normal mirror 77 to 71
(51% to 47%, 2 unfinished), Normal against Hard 8% to 91%, against Easy 100% to 0%: the same as
round 4's integration, since tier three only starts at minute 25 and the ladder plays without sites.

Left for integration: sites in B's map previews (`siteSpots` with the battle's `rngSeed`), a
selected site's line in A's panel (`siteAt`), the lobby's stored setup forgetting `sites`
(`readStoredSetup` is B's), the minimap showing an enemy Stealth Tank in sight (one condition in
B's units loop), and C's expansion aiming at sites.

### 2026-11-10: Round 5 integration

The contract went first; the four workstreams (the build window, larger maps, engineering vehicles,
sites and tier three) were built in parallel. A container restart stopped the run partway; the
finished work was on disk in each worktree and three builders resumed in place. The branches merged
with conflicts only in the docs, the Last Light check (both C and D taught it to skip skirmish-only
structures) and one renderer import.

Seams closed at integration:
- The radar no longer draws an enemy Spy or Stealth Tank that the battlefield hides.
- The lobby previews mark the neutral sites, placed exactly where the battle puts them (checked for
  every size and side count), and say what the grey diamonds are.
- The lobby remembers the sites switch, and a new lobby starts with sites on; DEFAULT_SETUP keeps
  them off because it also fills in setups saved before sites existed.

Checked on real large and huge maps (three seeds each, Normal mirror, sites on): the computer took
every site, sent out a Forward Base Truck between minutes 8 and 17 and deployed it, and fielded
Repair Trucks by minute 13. With sites on, these battles ran 20 to 38 minutes; without them, larger
maps ran 45 to 48 minutes on average (workstream B's figures). The Derricks' income speeds both
sides up.

Numbers at integration: drive 367,688 assertions (about 5.7 minutes), campaign-check 2,595, both
tours (desktop, and touch on three phones), 27 loading checks. AI ladder, 150 seeds, random maps,
advanced tech: the mirror 45% to 53%, Hard on side 1 wins 93%, Easy 0%.


### 2026-11-10: Development lines and loadouts (round 5b)

The contract and the full build log are in `fireline-round5b-design.md`. On an advanced-tech skirmish
the setup offers a second research mode, **Development lines** (the default for a new advanced
skirmish; Classic is one click away, standard tech disables the choice): each line runs Mk I to
Mk II, then a doctrine fork whose adopted branch has a Mk III and whose other branch closes. Mk II
research unlocks vehicle modules, fitted per kind on the Vehicles tab's Loadouts panel and paid
for on top of the unit's price (for example a tank with Long barrel and Reinforced tracks costs
1050, not 800); units already built keep what they were built with. The computer researches its
difficulty's lines list, adopts doctrines and fits modules at Normal and Hard (Easy fits none).
Classic battles, every campaign mission (all pinned to `research: 'classic'`), standard tech and
every existing save play exactly as before; a save without the new fields reads as classic.

Ladder, 150 seeds, `--map random` (advanced tech, 3000 credits, normal ore), 1650 battles each.
Before: the tree at HEAD (classic research, the only mode it has), exported with `git archive` and
run on its own. After: this round, `--research lines`. The two tables are identical in every cell,
so one table serves for both:

| Side 0 | Side 1 | Side 0 wins | Side 1 wins | Unfinished | Median min |
|---|---|---|---|---|---|
| new hard | new normal | 67 (45%) | 81 (54%) | 2 | 24.6 |
| new normal | new hard | 12 (8%) | 137 (91%) | 1 | 19.2 |
| new normal | new easy | 150 (100%) | 0 (0%) | 0 | 15.6 |
| new easy | new normal | 2 (1%) | 148 (99%) | 0 | 19.5 |
| new normal | prev normal | 105 (70%) | 44 (29%) | 1 | 17.3 |
| prev normal | new normal | 34 (23%) | 114 (76%) | 2 | 16.9 |
| new hard | prev hard | 4 (3%) | 146 (97%) | 0 | 14.9 |
| prev hard | new hard | 2 (1%) | 148 (99%) | 0 | 14.8 |
| new hard | prev normal | 75 (50%) | 74 (49%) | 1 | 19.4 |
| prev hard | prev normal | 42 (28%) | 106 (71%) | 2 | 17.1 |
| new normal | new normal | 77 (51%) | 71 (47%) | 2 | 23.9 |

Summary lines, the same before and after: Hard beats Normal 68.0% both ways round, Normal beats
Easy 99.3%, Normal beats prev Normal 73.0%, Hard beats prev Hard 50.7%. Hard beats Normal beats
Easy (monotonic), every pairing is 0 points from baseline, median length up 0%.

Why identical: a per-battle comparison (the ladder's worker output, 150 seeds, both trees) found
Hard against Normal unchanged in every battle, and the Normal mirror changed in length in 6 of 150
battles and in winner in none. The development lines' Mk I nodes are the classic five, and at
3000 credits a battle is decided (median 15 to 25 minutes) before either side reaches Mk II or
fits a module that matters. So the thresholds pass, but this ladder says little about lines play
itself; a richer setup (`--credits 10000 --ore rich`) would exercise it, and is the place to look
if section 2.4 or section 5 numbers are ever tuned.

### 2026-11-10: Borrowed Steel (mission 5) made winnable; campaign difficulty settings

Reported unbeatable. Played by script straight at the outpost, round its north and round its east,
it was lost every way, inside two minutes, with nothing of the enemy's killed. Three causes:

- Six infantry and an unarmed Engineer against three Gun Turrets, two tanks and five riflemen on
  'defend'. Turret shells kill riflemen in four hits and riflemen barely scratch a turret (bullets do
  15% to structures). The squad is now three tanks, four riflemen and two rocketeers, which the
  Engineer repairs as they fight; the outpost is passive (four riflemen, a rocketeer, two turrets,
  trains nothing). Credits 3,000 to 2,400, still three tanks' worth.
- Units auto-target structures, so attack-moving into the yard shot the War Factory down, and with
  it gone the capture could never happen: no time limit, so the mission sat open forever. Now side
  0's units never pick for themselves a structure that an unfinished primary capture or infiltrate
  objective names (an explicit attack order still fires), and if one is destroyed anyway the
  objective fails and the mission is lost with "The enemy War Factory was destroyed before it could
  be captured."
- `evaluateMission` judged objectives before firing triggers, so capturing the factory last won on
  the spot and the counter-attack it triggers spawned into a finished battle. An enemy group a
  trigger sends now reopens "destroy everything" on that tick. (Firing triggers first instead was
  tried and broke three harness checks: tick-judged objectives fired their triggers a tick late,
  and a say-only trigger on the final objective never spoke.) The counter-attack is now two tanks from the far west on the capture, not three from the
  north at a fixed six minutes (which could land before the capture, on a squad still fighting).

Campaign difficulty (`src/campaign/difficulty.ts`): Easy, Normal, Hard, on the campaign (default
Normal, and every older save loads as Normal), chosen on any briefing and changeable between
missions; a battle in progress keeps the level it started with (`MissionRuntime.level`). Normal is
every mission as written. `scaleMission` adjusts the spec before the battle is built, so the
briefing, the battle and the checks read the same numbers:

| | Easy | Hard |
|---|---|---|
| Enemy starting troops, triggered enemy groups | x0.6 (each kind kept, at least one) | x1.3 |
| Enemy credits | x0.5 | x1.5 |
| Enemy commander tier | one step down | one step up |
| Player credits | x1.5 | as written |
| Player unit health (with the Armour perk) | x1.25 | as written |
| Mission time limit | x1.5 | as written |

Never changed: structures (bonuses such as "destroy 2 Gun Turrets" must stay possible), objectives
and their timings (the briefings name durations in prose), our own reinforcements, and rewards.

campaign-check plays Borrowed Steel by script three ways in at every level (Easy and Normal must win
all three; Hard at least one), checks the scaling for every mission, and builds and runs all 14
missions at Easy and Hard. drive.ts covers the spared structure, the failed capture and the trigger
order.

### 2026-11-10: War for the Planet (a strategic campaign)

The contract and the five workstreams' build logs are in `fireline-planet-design.md`. A new panel in
the lobby, inside the signed-in branch like everything else, starts a turn-based war for a whole
seeded planet: Short (3 factions, 18 regions, 40 turns), Long (4, 36, 90) or Very long (5, 60, 160),
each preset stating every option explicitly; the setup also picks the number of factions, the
difficulty and four optional rules (allied victory, iron rule, simulated battles, rival
diplomacy). The player and two to four
computer factions (each with a temperament) hold regions with cities, build and grow them, earn ore,
fuel, food and science, open trade routes, research the round 5 development lines with doctrines
and loadouts, recruit a persistent army that keeps its kills and ranks, and make or break ceasefires,
trade pacts and alliances with tribute and exchange terms. Regions cut off from supply lose yield and
in the end surrender. An attack becomes a battle: fought in the ordinary real-time engine as a
skirmish built from the region (two to four sides, allies' contingents included, heroes and powers
in play, saved every 15 seconds), auto-resolved by a formula, or, with the option on, simulated to
the end in a worker. The result flows back into the war: the region changes hands, survivors are
promoted, heroes are wounded or lost, the city takes damage, the Commander earns xp for perks. A
war ends by domination, elimination, an allied share, the player's fall, a rival's share, or the
turn limit.

The strategic layer (`src/planet/`) is pure like `src/sim/`: no clock, no dice outside the seed, an
illegal order returns the same object. A war is one more save kind (`kind: 'planet'`) in Fireline's
existing endpoint behind the same 401 and 403; campaign and skirmish saves, every story mission and
every skirmish replay exactly as before (the harness checks 118 recorded hashes). `npm run
drive:planet` (about 38,500 assertions, about a minute) is in `npm run check`. Its first run found
two strategic defects, both fixed the same day: a faction could start short of its start regions on
a few seeds, and a treaty ended by an unpaid term kept its foreign trade routes.

Not built yet: a guided tour for the war, a `ladder:planet` for balance (computer factions currently
sign open-ended trade pacts and rarely fight one another after the truce, so most wars end on the
turn limit), and a check that a full battle fought by hand reaches its end card in the browser.


### 2026-11-10: Game size and deep research in skirmishes (round 6)

The contract and the full build log are in `fireline-round6b-design.md`. Round 5's ladder showed
that at 3000 credits a skirmish ends before the computer gets past Mk I, so doctrines and modules
rarely mattered. A skirmish now opens on a **game size** screen: four cards, Quick, Standard
(checked for a new player), Long and Epic, each with its credits and ore, how long a battle lasts,
how far research gets, and Begin or Customise. Quick is the game as it was; the three paced sizes
give more credits and richer ore, scale every upgrade's price and research time on the
development-lines tree, delay the computer's first attack, and give the computer a paced research
list that saves for its next item. The detailed setup keeps every control and gains a Size row; a
setup changed by hand reads "Customised" on its card. Classic research and standard tech keep their
prices at every size. Every campaign mission, every battle without a setup and every save from
before this round reads as Quick and plays exactly as before (30 pre-round-6 battles hashed and
unchanged).

Ladder, 150 seeds, `--map random`, development lines, each size's preset, 1650 battles a size.
Depth counts new against new, Normal and Hard sides only.

| Size | Credits, ore | Normal Mk II / Mk III | Hard Mk II / Mk III | Normal mirror median (p10 to p90) | Hard beats Normal | Normal beats Easy | Unfinished |
|---|---|---|---|---|---|---|---|
| Quick | 3000, normal | 0% / 0% | 0% / 0% | 23.9 (16.0 to 33.6) | 68.0% | 99.3% | 11 |
| Standard | 3000, normal | 70% / 51% | 93% / 82% | 23.7 (16.0 to 32.5) | 79.7% | 100% | 0 |
| Long | 5000, rich | 96% / 85% | 100% / 93% | 23.8 (16.4 to 32.5) | 58.3% | 99.7% | 0 |
| Epic | 10000, rich | 100% / 97% | 100% / 98% | 21.3 (19.8 to 30.3) | 58.7% | 99.7% | 0 |

Quick matches round 5's table in every cell. Every card says 15 to 35 minutes, because at today's
map sizes battles last about as long at every size: the sizes differ in how deep research gets.
Larger maps would make the bigger sizes longer, and are out of scope for this round. `drive:fire`
gains 582 assertions (about 345,700 in all, about 8 to 9 minutes).

### 2026-11-10: every campaign mission played to a win; three missions and the enemy barrage fixed

Checked whether every mission can be won, at every campaign difficulty, by a scripted player
(`scripts/campaign-player.ts`): the skirmish commander runs side 0's base, held at home and sent at
the mission's target at a chosen minute, and a script plays the heroes and support powers. Twelve
plans per base mission (two commander strengths, six attack times), six for The Quiet Man, three
for Ace of Spades; `npm run sweep:fire` runs them all. Before this, six of the fourteen missions had
a played proof; the rest were only built and run for 2,000 ticks.

Found and fixed:

- **The Quiet Man could not be won at Normal or Hard.** Two buggies sent after the Spy drove to the
  extraction point and parked on it; they beat his four riflemen, and he could not come within two
  tiles of them unseen. Every run ended with him alive, waiting, until the time ran out. A squad of
  three riflemen goes after him now, the same fix Demolition had.
- **The enemy barrage aimed at what it could not see.** Firestorm, Bastion Line and Last Light give
  the enemy a Tech Centre's barrage, and it found the player's rally point deep in their own base
  every three minutes: one barrage killed 27 of side 0's units at once in Firestorm, with no enemy
  near. A mission enemy now shells only troops within sight of its own units or structures, else
  one of the player's structures. With the barrage switched off entirely, Firestorm went from 0 to 5
  wins of 6 plans; with the sight rule instead, 5 of 12.
- **Blackout, Firestorm and Last Light were not won at Normal by most plans** (3, 0 and 0 of 12 at
  first). Blackout: enemy credits 5,000 to 2,500, a rifleman fewer, the armoured column three tanks
  not four. Last Light: the commander at Normal rather than Hard (campaign Hard gives Hard back),
  credits 10,000 to 5,000, and about two-thirds of its garrison and of every wave. Firestorm needed
  only the barrage fix; its remaining losses are all its 15-minute deadline, every one of them a plan
  that attacks too late or builds too slowly to get there. Every plan that reaches it in time wins.
- **Campaign Hard eased** from x1.3 troops and x1.5 credits to x1.15 and x1.25 (still a tier up):
  at the steeper setting no plan held Hold the Ford for its eight minutes.

Not missions, but the scripted player, and worth knowing for the next one: left to attack on its own,
the skirmish commander threw its whole army into the enemy's turrets at four and a half minutes in
every base mission (52 units lost for 6 in thirty seconds in Fireline); heroes walked in alone and
died in the first minute and a half; and in First Light, where it may not build tanks, it trained
nothing and sat on 33,500 credits. Fireline read as unwinnable at Normal until the heroes were used
properly, then won 9 of 12 with no change to the mission. A scripted player that loses proves little.

Wins out of plans tried (`npm run sweep:fire`):

| Mission | Easy | Normal | Hard |
|---|---|---|---|
| 1 First Light | 12/12 | 12/12 | 12/12 |
| 2 The Quiet Man | 6/6 | 6/6 | 6/6 |
| 3 Hold the Ford | 12/12 | 12/12 | 7/12 |
| 6 Ace of Spades | 3/3 | 2/3 | 2/3 |
| 7 Blackout | 12/12 | 9/12 | 0/12 |
| 8 Fireline | 12/12 | 9/12 | 0/12 |
| 9 Iron Coast | 12/12 | 11/12 | 0/12 |
| 12 Firestorm | 10/12 | 5/12 | 0/12 |
| 14 Last Light | 12/12 | 12/12 | 5/12 |

Missions 4, 5, 10, 11 and 13 have their own players in campaign-check (Borrowed Steel at every
level). campaign-check now plays every mission to a win at Easy and Normal, The Quiet Man and Ace of
Spades at all three. Hard on Blackout, Fireline, Iron Coast and Firestorm is not won by any scripted
plan; that proves less than it seems (the player does not micro and its heroes go in on a timer), but
it is the open question if Hard is reported as too hard.

### 2026-11-10: The air war: recon, interceptors, countermeasures

The player asked for air warfare to be more involved, recon planes among it. Air power had one job,
striking the ground, and one answer, anti-air on the ground. It now has three jobs (scout, strike,
defend) and the air can be contested from the air. Advanced tech only, like the rest of air power:
standard tech, missions and saves from before are untouched, and two-sided standard battles replay
exactly as they did.

| Unit | Cost | Needs | Role |
|---|---|---|---|
| Recon Plane | 700 | Helipad | Unarmed, fast (2.4 tiles/s), sight 11; a detector |
| Interceptor | 1200 | Helipad, Research Lab | Air-to-air missiles (55, range 5, every 1s), 6 loads; fastest aircraft (2.7 tiles/s) |

| Upgrade | Cost | Time | Effect |
|---|---|---|---|
| Countermeasures | 1500 | 60s | flak and anti-air missiles do 25% less to the side's aircraft (needs a Helipad) |

How it plays (`src/sim/air.ts`, numbers in `rules.ts` under "Air war"):

- **Recon Plane.** Its loads are fuel (12), one burnt every `FUEL_TICKS` (5 seconds) while it is off
  its pad, none while parked. At `FUEL_RESERVE` (2) it turns for home, refuels a load a second and
  stays parked. Sent to a point, by move or attack-move alike, it flies there and circles (its heading
  turns 0.12 radians a tick; cos and sin are constants so a replay never rests on `Math.cos`), so a
  sortie lasts about 45 seconds over the target. Shift-click waypoints make a patrol. It can never be
  given an attack order.
- **Detection.** A unit whose spec has `detector` (the Recon Plane) sees Stealth Tanks and Spies within
  `DETECTOR_RANGE` (7 tiles), where anything else needs 2.5 (Stealth Tanks) or the Spy rule's range.
  One condition in each of `stealthSeen` (sites.ts) and `isDetected` (mission.ts); allies share it as
  they share everything else. A Gun Turret that cannot see a Stealth Tank four tiles off opens fire
  the moment a Recon Plane comes over.
- **Interceptor.** Fights like a Gunship but at aircraft only (its weapon is `aamissile`, which never
  reaches the ground). Left on its pad, full and not on hold, it **scrambles**: any enemy aircraft
  within `SCRAMBLE_RANGE` (14 tiles) of the pad takes it up (`Unit.scramble`, an optional field), it
  fights, takes the next intruder near the pad if there is one, and lands again. It never chases
  beyond `SCRAMBLE_LEASH` (20 tiles) from the pad; a Bomber running for home at full speed gets away.
  Any order ends a scramble. Ordered on attack-move with a strike, it takes on the fighters that come
  up to meet it.
- **Countermeasures.** Read in `hurt` (tick.ts): flak or anti-air missile damage on an aircraft is
  multiplied by `COUNTERMEASURES_DAMAGE` (0.75) for the victim's side. Bullets are unchanged.
- An Interceptor's missile is drawn level at aircraft height, not climbing from the ground.

The computer (`aiAir.ts`):
- Interceptors on Normal (one) and Hard (two), half one per enemy aircraft, first in line for its
  Helipads' room, with one Helipad more than its plan to hold them. They stay parked and scramble by
  themselves. Easy flies neither new aircraft.
- A Recon Plane on Normal and Hard once the opponent fields a Stealth Tank, flown over the one
  nearest its base and kept on it as it moves, so its guns can see it. Without one it stays parked.
- Interceptors count as anti-air cover when it picks a strike target.
- Countermeasures last in its research order on Normal and Hard.
- In a real Hard battle the commander only meets enemy aircraft if the other side flies; the
  autopilot on side 0 in the existing battle seeds never builds air, so the new battle section gives
  side 0 a Helipad and two Gunships at the start.

Interface: the Air tab now offers Recon Plane, Gunship, Interceptor, Bomber; stat cards show fuel,
detection and the scramble ranges; a selected aircraft's line reads Fuel or Missiles and says when it
is circling, refuelling, low on fuel, scrambled or ready to scramble. Art: a twin-boom recon plane
with a turning radar dome and a fuel strip, and a delta-wing interceptor with missiles under its
wings and an afterburner trail; both have shadows. How to play's Aircraft panel explains the three
jobs. Countermeasures takes the Research block's sixth row.

Tests: `scripts/drive-airwar.ts`, eight sections in `npm run drive:fire` (helpers exported from
`drive-air.ts`): rules and tech levels, the Recon Plane's fuel, orbit, return, refuel and patrol,
detection of a Stealth Tank and a Spy (an ally's plane included), Interceptors against a Gunship and
never the tank under it, a scramble, its range, hold, leash and the order that ends it, two
Interceptors fighting, Countermeasures measured on a Flak Cannon and a Skyhunter hit (30 to 23, 60 to
45) and not on a bullet, old saves, the computer (an Interceptor by minute 8 on Hard against
Gunships, a Recon Plane by minute 7 against a Stealth Tank, which its side then sees; nothing on
Easy), and a Hard battle that replays byte-identically.

Numbers. `npm run drive:fire`: 373,669 assertions, 0 failed, 362s (was 367,688). The advanced-tech
battle line now reads "12/12 finished, average 28.0 game minutes; side 0 won 4, side 1 won 8": the
commanders fly Countermeasures research and, where the opponent flies or fields Stealth Tanks, the new
aircraft. The air war battle: "aircraft gunship, interceptor; 1 interceptor missiles; side 1 won at 38
min". `npm run campaign:fire` 2,595, unchanged. The AI ladder (150 seeds) has not yet been run on this
change and should be before any balance work on it.

### 2026-11-10: The air war, part two: Troop Carriers and the Heavy Bomber; tuning

The player then asked for troop carriers and bigger bombers, and for the ladder to be run and the
balance tuned.

| Unit | Cost | Needs | Role |
|---|---|---|---|
| Troop Carrier | 1000 | Helipad, Barracks | Unarmed, 380 health, 1.7 tiles/s; carries 6 infantry |
| Heavy Bomber | 3000 | Helipad, Tech Centre, Research Lab | 640 health, 1.5 tiles/s; 10 bombs (160, splash 1.8) in one run; takes a whole Helipad |

**Troop Carrier** (`src/sim/transport.ts`). Infantry ordered aboard (`board`, a right-click on your
own carrier) walk to it with `Unit.boarding` set and climb in within `BOARD_RANGE` (2.3 tiles) while
it is still (hovering, or parked on its pad, so they board at the Helipad). Aboard, a unit leaves
`s.units` and is kept as it was (id, health, kills) in `Unit.carried`, an array only ever replaced.
`unload` (the Unload button, F) sets them down at once on free tiles within `UNLOAD_RADIUS` (3) if
the carrier is still, or where it next stops (`Unit.drop`); over water or rock with no ground near,
it cannot. A carrier shot down takes its passengers with it, counted as losses. Boarding and setting
down run in one pass after every unit has moved (`transportStep`), never inside the units loop.
Heroes cannot ride. Old saves: passengers are kept only when they are infantry, up to the room.

**Heavy Bomber.** Uses the Bomber's run code (`isBomberKind`, by weapon), so it lines up, drops all
ten and goes home. `AIR_SLOTS` makes it take both places on a Helipad: `padLoad`, `airCount`,
`airRoom`, `homePad`, `launchAircraft` and `canQueue` all count places, not aircraft, and it parks
in the middle of its pad. One run flattens a Barracks.

**The computer.** A Heavy Bomber on Hard, flown with the Bombers. Airlift raids on Normal (5) and
Hard (6): a parked carrier takes idle infantry from home (not in a wave, a raid or a site party) to
the opponent's refinery the fewest anti-air guns cover, sets them down three tiles short and sends
them in; one at a time, on the strike timer, giving up after a minute boarding or three flying.
Its memory (`AiMemory.airlift`) is replaced, never changed in place, and repaired from saves.

**Tuning, measured one on one** (two Interceptors parked by a Barracks, one Bomber attacking it):
at the first numbers all six bombs fell and the Barracks went; one Interceptor never stopped a
Bomber at any setting tried, which is right for 1,200 credits against 2,000. Scramble range 11 to 14,
leash 16 to 20, reload 1.4s to 1.0s: the pair now holds the raid to three bombs and the Barracks
stands (at 16 tiles one bomb fell, but one pad would then cover a third of a standard map).

**Tuning the commander.** A census of 48 computer battles (Normal mirror, Normal against Hard)
showed aircraft in 45, Interceptors built in 7 and firing in 1, and never a Recon Plane or
Countermeasures: the commander bought Interceptors behind its army-ready gate and parked them
where enemy gunships never came, since those hunt haulers out at the ore. Interceptors and the
Recon Plane are now bought as anti-air is (before the army is ready), and an enemy aircraft within
8 tiles of its haulers or structures draws one sent by the commander. After: built in 15, firing
in 5. Gunship strikes now avoid them (they count as cover), which is the deterrence working.

**The ladder** (150 seeds, random maps, advanced tech), before any of the air war and after its
first version, run on the same machine:

| Match | Before | First version |
|---|---|---|
| Normal mirror | 45% / 53% | 45% / 53% |
| Normal v Hard | 6% / 93% | 5% / 95% |
| Normal v Easy | 100% / 0% | 100% / 0% |
| Hard v Normal, both ways | 70.3% | 70.7% |

Within a game or two on every row: the first version barely changed the computer's play, because
it barely used the new aircraft (the census above).

**Two fixes the full harness forced.** The airlift shared the strike timer and held the Bombers back
for good (the round-4 Hard battle dropped no bombs); it now has its own, every two strike intervals.
And a Hard commander down to one Gunship never struck, waiting for a group of two; it now goes with
what it has. The round-5 tier-three check's window is 15 minutes past the start of tier three (was
10): with carriers and Interceptors to buy, the Hard commander's first Railgun Tank came at minute
37 or 38.

**Final ladder**, the same card, with everything above:

| Match | Before the air war | Final |
|---|---|---|
| Normal mirror | 45% / 53% | 47% / 53% |
| Normal v Hard | 6% / 93% | 5% / 94% |
| Normal v Easy | 100% / 0% | 100% / 0% |
| Hard beats Normal, both ways | 70.3% (65-76) | 73.0% (68-78) |
| Normal beats Easy, both ways | 99.0% | 99.0% |

The intervals overlap on every row: the difficulty ladder is where it was, with Hard a shade
stronger for using its air arm properly. No number was changed to hold it there. Battles last as
long as before (Normal mirror 23.4 to 24.1 minutes on average).

Harness at the end: `npm run drive:fire` 371,018 assertions, 0 failed (the round-4 Hard battle now
"side 1 won at 17 min; 6 bombs, 6 gunship rockets"; the air war battle "gunship, interceptor,
bomber; 2 interceptor missiles; side 0 won at 31 min"); `npm run campaign:fire` 2,595, unchanged.

### 2026-11-11: Two armies (round 6, workstream A)

Every skirmish seat now picks an army, as `fireline-round6-design.md` section 3 sets out. Meridian
Corps is today's army exactly; Ashen Combine is the variant. Missions, old saves and every default
battle (all Meridian) play as before: every summary line of `npm run drive` is unchanged.

- **Doctrines.** Meridian: heavier and slower, armour, range and static defence; signature unit
  the **Sapper** (infantry, 400 credits, satchel charges at 1.75 tiles: wrecks structures and
  armour, falls fast to rifles; needs a Tech Centre); air the Gunship and Bomber. Ashen: lighter,
  faster, cheaper; signature unit the **Raider Bike** (450 credits, 140 hp, 2 tiles/s, rockets);
  air the **Kestrel** (strafe role: 1,200 credits, 260 hp, 10 rockets, a load every 0.9s) and the
  **Firebrand** (bomb role: 1,800 credits, a smaller blast than the Bomber, and each incendiary
  burns three more times on the spot, a second apart, at 30% of its damage). All four are advanced
  tech, each fielded by its army alone (`FACTION_MENUS`; Ashen removes the Gunship and Bomber).
- **Ashen's overlay** (`FACTION_OVERLAY.ashen`): about 13% less health and 6% more speed across
  the army; infantry, the buggy and the Flak Track 5% cheaper; the Tank, Artillery, Missile
  Carrier, Bastion and Railgun half a tile shorter; Gun and Rocket Turrets and the Fortress cheaper
  and frailer. How to play has the whole table, read from the specs.
- **Balance.** The plan's first numbers (10% less health, 12% faster, 10% cheaper) gave Ashen 62%
  over 150 seeds from each seat on random maps at Normal (`npm run ladder:fire -- --factions`, or
  the two `--match new:normal:ashen,new:normal:meridian` orientations). Fewer Raider Bikes made it
  worse (61%: the computer built more tanks instead), a cheaper-only nerf reached 55%, and slowing
  the army to +6% brought it to **53.0%** (Ashen 159, Meridian 137, 4 unfinished of 300; 56% from
  seat 0, 50% from seat 1; the Normal mirror gives seat 1 about three in four).
- **Engine.** Numbers arrive through the per-side specs; nothing in `tick.ts` changed. `air.ts`'s
  `dropBomb` lands a bomb as its weapon's own kind and, for a weapon kind in `BOMB_PATCH` (the
  Firebrand's `flame`), adds the patch as later projectiles on the same spot, so the burn is drawn
  and dealt as flame by the code that already lands every projectile. No new weapon or effect kind.
- **Computer.** Ashen mixes Raider Bikes into its advanced vehicles and queues aircraft by role
  from its own Air list (`aiAir.ts`), one more Kestrel on Hard. Meridian's choices are today's,
  except that in a battle with two armies it also trains Sappers (an all-Meridian battle draws
  exactly as before).
- **Interface.** An Army row per seat in the lobby with each army's one-line doctrine; the build
  window, sidebar, stat cards and How to play read the player's army (`rulesCatalogue(faction)`,
  `menuOf`, `statsOf(kind, faction)`); the funds toast prices by `costFor`. Army tags are tokens
  (`--army-meridian`, `--army-ashen`) in both modes; battlefield colours stay the seats'.
- **Tests** (`scripts/drive-factions.ts`): the overlay merge, the bounds of "slightly different",
  menus and catalogues per army, signature items refused through `canQueue` and the reducer, none
  in standard tech or any mission, a Firebrand bombing and burning, a Bomber not, a Kestrel
  strafing and rearming faster than a Gunship, Ashen's prices, health, speed and range measured,
  and a whole Ashen-against-Meridian battle from each seat played to a finish, saved and loaded
  mid-battle, and replayed byte-identically.
- **For the integrator.** The groundwork's "Meridian: every build list is MENUS" now reads "MENUS
  in order, then its signature items", since the Sapper is Meridian's addition. With B's Ace
  appended to Vehicles, Ashen's list (with the Raider) runs to 15 items, one more than the build
  keys.

### 2026-11-11: Heroes in free play (round 6, workstream B)

A skirmish setup option, **Heroes: Off / On** (off by default; advanced tech only, greyed on
standard tech), lets the campaign's Spy, Commando, Engineer and Ace be recruited in free play. The
campaign is untouched: missions never offer the Academy or a hero, and a mission's fallen hero still
stays out for the rest of the mission.

- **Recruiting**: a new structure, the **Command Academy** (`academy`, 2x2, 1500, needs a Tech
  Centre, heroes on only). Once one stands, `techAllowed` lets the Spy, Commando and Engineer onto the
  Infantry list (trained at the Barracks) and the Ace onto the Vehicles list (War Factory), through
  `'queue'` like any unit. Prices `HERO_RECRUIT_COST` (Engineer 1000, Spy 1200, Commando 1800, Ace
  2500, read by `costFor`), training `HERO_RECRUIT_TICKS` (20, 22, 30, 36 seconds, read by
  `buildTicksFor`); the heroes' entries in `UNITS` keep their campaign numbers.
- **Limit**: one of each per side, standing plus queued (`heroRecruitProblem`, `src/sim/heroes.ts`).
- **Revive**: a fallen hero is recorded in `PlayerState.heroFallen` and may be recruited again after
  `HERO_REVIVE_TICKS` (90 seconds) at half price; it comes back wounded (half health) with the
  experience it had, the campaign's "wounded" rule within one battle.
- **Engine**: the hero tick runs in a skirmish with heroes on; `enlistHeroes` gives a trained hero
  its hero state (level from its experience, ability ready) and health from `heroMaxHp`.
- **Interface**: the hero bar (heroes standing) beside the skirmish power bar, with each fallen
  hero's recruit timer; Z X C V; F uses the ability only when one hero alone is selected, otherwise
  the selection's command as before. The Repair Truck's and Forward Base Truck's blurbs say they are
  free play's engineering units. How to play has a panel.
- **Computer** (`src/sim/aiHeroes.ts`): saves a share of its credits into `heroFund` for the Academy
  and then each hero (Engineer, Ace, Commando, Spy). The Engineer captures an undefended structure or
  site; the Commando takes one to three escorts from the reserve to an outlying structure and plants
  a charge; the Ace joins the wave and opens Overdrive in a fight; the Spy infiltrates (Generators
  first) as an attack is about to go, avoiding structures a gun covers. `keptBack` holds back every
  hero but the Ace, and the escort.
- **Tests**: `scripts/drive-heroes.ts` (recruiting, limits, prices, revive, levels and abilities,
  replay and save, missions, a computer battle with heroes on); drive.ts's hero refusal now also
  asserts acceptance with heroes on. Every summary line of `npm run drive` is unchanged (heroes off
  by default).

### 2026-11-11: Generals (round 6, workstream C)

Doctrines, in `GENERALS` (rules.ts), applied per side by `applyDoctrines` (generals.ts) when the battle
is made: the three rate multipliers become that side's Perks (`s.perks` for side 0, `s.sidePerks` for
the rest, read through perksFor); prices on some kinds alone are read in costFor's C marker from
`PlayerState.general`, so `Perks` gained no fields. Refined from the plan where a perk needed code
outside C's markers: Hale's "+10% structure health" would have left health above the spec's (bars,
repair and sell refunds all read the spec), and Kade's "+10% vehicle speed" lives in movement code;
both were replaced as below.

- Hale (Meridian, Fortress): Gun and Rocket Turrets, Flak Cannons, the Fortress and walls 20% cheaper;
  powers recharge 10% sooner.
- Voss (Meridian, Armour): Tanks, Flame Tanks, Rail Tanks and Bastions 15% cheaper; harvest 10% slower;
  powers 5% sooner.
- Kade (Ashen, Blitz): every queue 10% faster; powers 15% sooner.
- Ilse (Ashen, Air): Helipads 25% and aircraft (any kind with an airRole) 10% cheaper; rearm 20%
  faster (generals.ts takes an extra tick off a rearming aircraft's cooldown every fourth tick);
  powers 5% sooner.

With Generals on, a computer seat left on "Any" gets one of its army's two from a generator seeded
from rngSeed and a constant. Field General (`general`, infantry, Barracks plus Comms Uplink, 1200
credits, 320 health, a pistol): one per side standing or queued. Aura: own units within 6 tiles,
scanned every 10 ticks into `Unit.aura`; inside it a shot uses `auraWeapon` (damage x1.1, reload
x0.9) at tick.ts's C marker; a mark never stacks. A fall halves the doctrine (perks replaced) until a
replacement arrives, which may be queued 1200 ticks after. The computer saves for one after its first
wave, keeps it 2.5 tiles behind its wave's centre (gathering point otherwise), and pulls it home
below 40% health until 75%. Tests: `scripts/drive-generals.ts`. Default battles are unchanged: every
summary line of `npm run drive` matches the baseline.

### 2026-11-11: Formations and squads (round 6, workstream D)

Contract: `fireline-round6-design.md` section 6. Four shapes (line, column, wedge, box), a squad that
keeps pace, and the computer's waves in formation on advanced tech.

- **Slots** (`src/sim/formations.ts`): `slotsFor(shape, n, facing)` returns integer offset tables,
  front first and centred on the group. Line: one rank up to ten, then more ranks. Column: one file
  up to four, then two. Wedge: row k holds k + 1 slots two tiles apart, so the arms run back at 45
  degrees. Box: the edge of a near-square first, the inside last (a short box drops back-row corners,
  never the inside). Turned to eight facings with unnormalised steps (diagonals scaled by 0.75), and
  `facingOf` snaps a direction with integer comparisons against 0.414 (tan 22.5 degrees).
- **Role order**, by category and spec, never by name: armed vehicles, then infantry, then Medics and
  Repair Trucks, then artillery and support (a minimum range, no ground weapon, no weapon, aircraft).
  In a box the Medics and Repair Trucks go last, so they take the inside. Ties by id.
- **Squads.** A move with a `formation` (or the `formation` action, which forms up where the units
  stand) makes the ground units a squad (`s.squads`, ids from `s.nextId`; aircraft take a slot but
  join none). The leader (slot 0) paths to its slot. Every 8 ticks, from the leader's own step, the
  rest are aimed at their slot beside the leader plus 2 tiles ahead, or at their final slot once the
  leader is within 4 tiles of its goal; members that fell or took other orders leave then. Keep pace:
  one line in `stepAlong` caps every member at the slowest member's speed, except one more than 1.5
  tiles from its slot, which may catch up. A plain move of exactly a squad's members keeps its shape;
  any other plain move takes the named units out; a squad down to one is dissolved; `'none'` breaks one
  up and leaves the orders alone. `migrateRound6` drops fallen members, re-picks a fallen leader,
  dissolves a squad under two and drops malformed squad fields and stray slots.
- **No formation, no change**: a move without a `formation`, with no squads in the state, is the
  spiral exactly, so every replay and every standard-tech and mission line is unchanged.
- **Interface.** Line, Column, Wedge, Box and None beside Stance in the selection panel (the same panel
  on touch), the current one pressed. The period key cycles line, column, wedge, box, none (Shift goes
  back). Control groups are kept per battle in this browser (`fireline_groups:<save id>`), not in the
  save: the battle screen fills its groups in from storage on the first key and records each
  Ctrl + digit. On touch, chips under the formation row select a group (again: jump to it) and
  "+ Group" makes the selection the next free one; a chip presses the same key the keyboard does.
- **Computer.** On advanced tech only (`adv`), a wave sets off to attack in a wedge and regroups in a
  box. Gathering, reinforcements and retreats are as before.

Harness (`scripts/drive-formations.ts`, about 380 assertions, about 5 seconds): every table for
four shapes, 1 to 40 units and eight facings is deterministic, whole, unrepeated, led from the front,
turned with its facing and centred; facing within 20 degrees and at the 22.5 degree boundaries;
every shaped move toward eight directions lands on distinct passable tiles with the role order;
keeping pace (wedge, column and box arrive within 50 ticks of each other and of the slowest member,
the line within 120; the plain move spreads about 156, the buggies arriving 190 ticks sooner);
replay and save-and-load mid-march byte-identical; joining, leaving, dissolving, fallen leaders;
eleven refusals; the computer forms a wedge on advanced tech and never on standard.

`npm run drive`: 0 failed. Only the advanced lines moved, as the contract allows:

| Line | Before | After |
|---|---|---|
| Air battle on Hard | side 1 at 21 min; 12 bombs, 5 rockets; upgrades 0 and 0 | side 1 at 19 min; 12 bombs, 4 rockets; upgrades 0 and 2 |
| Sides block | 12/12, 21.8 min | 12/12, 20.8 min (the six advanced battles moved, the six standard ones did not) |
| Larger maps | 5/5; 33.2 min larger, 25.6 standard | 5/5; 34.7 and 23.4 |
| Engineering battle | side 1 in 21 min, 3 trucks, 3 Field Yards, 78 mends | side 1 in 25 min, 3 trucks, 5 Field Yards, 86 mends |
| Map types | 12/12, 26.2 min; side 0 won 4, side 1 won 8 | 11/12, 25.1 min; side 0 won 4, side 1 won 7 |

The unfinished map-type battle (highlands, seed 2) was followed to its cap: no squad left after
minute 50, both sides broke with three units each; an attrition stalemate, of the kind the default
battles already show (26/28). Unchanged: the mission lines, the standard-tech line, the tier-three
battle, every map and site check.

Ladder, `--map mix`, 150 seeds, Normal: the mirror read 53% / 45% (3 unfinished) before and 47% / 53%
(1 unfinished) after, inside the noise, average length 25.1 and 25.2 minutes; new against `prev` 69%
before, 67% after. Formations neither help nor hurt the computer measurably; they change how a wave
looks on the way in, which is the point.

### 2026-11-11: Round 6 integration

The four workstreams merged in the contract's order (A, B, C, D), each with `git merge --no-ff` and a
clean typecheck before the next. A and B merged without code conflicts; C met B only in the import
lines of `GameScreen.tsx`, `ai.ts`, `commands.ts` and `SkirmishSetup.tsx` (both kept), and the build
log and improvements list met in every merge (every entry kept, in merge order; headings brought to
this log's "date: title" form).

Seams closed at integration:

- **The General leads a formation.** A squad with a field General among its members is led by the
  General (`squadLeader`), wherever its slot falls by role (behind the armour). Such a squad re-aims
  its members every 4 ticks rather than 8; a member out of its slot catches up past 1 tile rather
  than 1.5, but one ahead of its slot waits for the squad instead of running on; and the General
  holds to a quarter of the squad's pace while any member is more than 1.5 tiles behind or beside
  its slot. Measured on open ground over eight directions, once formed: the worst distance from a
  slot averages 0.99 tiles led by the General against 1.18 led from the front, tighter in 6 of 8
  directions, never more than 2.2 tiles. The computer adds its General to its wave's wedge and
  regroup box when it stands within 12 tiles of the wave and is not pulling back (`generalLeads`),
  and `generalPlan` leaves a leading General to its squad; pulled back below 40% health, a plain move
  takes it out and the squad goes on under its front slot. In six whole battles the computer's
  General led its wave's squad in 48 samples of 250 ticks.
- **Build keys.** `menuOf` now closes every list with the round's recruits (the General, then the
  heroes) after the army's own items, so a key in use never moves when Heroes or Generals are on or
  when an Academy goes up mid-battle (it used to: the Raider Bike went from N to D). Every unit list
  fits the 14 keys with everything on (Ashen's Vehicles: 14, the Ace on D); past the fourteenth only
  the Prototype Works, the Fortress and the Command Academy, which the key table now names as
  clicked. The `0` row shows in a skirmish only; the touch table gained rows for the formation
  buttons and the group chips.
- **Prices on the cards.** Stat cards price what the battle charges (`listedCost`: `costFor` and
  `buildTicksFor`, so a doctrine's discount and a hero's recruit price show); How to play's grids and
  the armies panel show a hero's recruit price and time rather than the campaign's 0.
- **Setup text.** Advanced tech's description names the Academy and its heroes only with Heroes on,
  and the General only with Generals on (`techText`); How to play says what each option adds.
- **Generals and armies.** Already right in C's code (GENERAL_FACTION, the setup's own two, the
  computer's seeded pick); now asserted over every pairing of armies from both seats, with Ilse's
  air discount reaching the Kestrel and Firebrand by `airRole`.
- **The General's button** sat in its own corner and covered the power bar on a phone; it now sits
  in the bar row beside the hero and power bars and wraps with them. Selected, its tint lay over the
  battlefield rather than the HUD colour, and its title vanished in light mode.
- **A livelock found by the all-options battles.** With its economy broken, the computer's
  `raiseFunds` cancelled the queued General to pay for a hauler and `generalPlan` queued it again at
  once, every decision, so the infantry queue never moved and the battle ran to its cap.
  `generalPlan` now recruits nothing without a refinery and a hauler (B's rule for heroes).
- **Harness repairs.** C's "other kinds at full price" read Meridian's catalogue price for an Ashen
  side; it now reads the side's own army. B's computer section played one Hard battle, which D's
  formations end at 17 minutes, before any hero acts (Hard advanced mirrors now average 22 minutes
  against 31 before D, over 12 seeds); it now plays four Normal battles, 21 hero abilities among them.
  The tour's build-window check now expects the recruits to be absent with both options off. The
  script type errors are gone (`drive.ts`'s missing air queue, `drive-heroes`' building list,
  `campaign-check`'s objective set; `HERO_ACADEMY` is a literal type): every round 6 harness
  typechecks with `src`.
- **Contract.** Section 1 now says Meridian's `FACTION_MENUS` adds the Sapper, as built.

`npm run drive`: 0 failed, 374,046 assertions, about 7.7 minutes. Against the round's baseline, only
the advanced lines D's entry names moved, by exactly D's figures; no line moved at A, B or C, or at
integration:

| Line | Before round 6 | After |
|---|---|---|
| Air battle on Hard | side 1 at 21 min; 12 bombs, 5 rockets; upgrades 0 and 0 | side 1 at 19 min; 12 bombs, 4 rockets; upgrades 0 and 2 |
| Sides block | 12/12, 21.8 min | 12/12, 20.8 min (the six advanced battles) |
| Larger maps | 5/5; 33.2 min larger, 25.6 standard | 5/5; 34.7 and 23.4 |
| Engineering battle | side 1 in 21 min, 3 trucks, 3 Field Yards, 78 mends | side 1 in 25 min, 3 trucks, 5 Field Yards, 86 mends |
| Map types | 12/12, 26.2 min; side 0 won 4, side 1 won 8 | 11/12, 25.1 min; side 0 won 4, side 1 won 7 |

Unchanged: the three mission lines, the standard-tech line (26/28, 20.6 minutes), the tier-three
battle and every map and site check. `campaign-check` 2,937 assertions; `npm run check` passes; both
tours pass (desktop; touch on three phone layouts); 27 of 27 loading checks for Fireline.

AI ladder, default card (150 seeds, the original game): identical to the card before the round
(mirror 52% to 47%, Hard over Normal 67%, Normal over Easy 100%, new over old 89% at Normal and 56%
at Hard). Twenty-four advanced battles with every option on (Ashen against Meridian from both seats,
Heroes and Generals on, Normal, random maps): 23 finished, 10 to 50 minutes; both sides fielded a
General in every one. The one left at the 100-minute cap is an attrition stalemate (neither side
has a refinery or a hauler; side 1 is left with a Repair Truck and a Kestrel that stays parked at
its Helipad, side 0 with structures alone; the same seed with Generals off ends at 31 minutes).
Ashen won 16 of the 23, more than workstream A's 53% without the options: 23 battles is too few to
read, but the armies with heroes and Generals on want their own 150-seed run.

In the browser (desktop and iPhone 13, light and dark): an Ashen-against-Meridian lobby offers seat 0
only Ashen's two Generals and names the Academy and the General in the tech text; in the battle the
Academy and the General are listed and buildable, the General's button shows, a Wedge given to the
General and four tanks keeps its shape on the move, the saved squad is led by the General, and no
page or console errors.

### 2026-11-11: Merged with main's air war

Main's air war (the two 2026-11-10 entries above) and round 6 were built side by side and merged
here. The contract's rules hold for the new aircraft (`fireline-round6-design.md`, section 8):

- **Roles, not names.** `AirRole` gains `'scout'` (Recon Plane), `'intercept'` (Interceptor) and
  `'transport'` (Troop Carrier); the Heavy Bomber is `'bomb'`. Every kind-name branch the air war
  added in `air.ts`, `aiAir.ts`, the sidebar and the renderer reads the role, and the old
  `isBomberKind` (by weapon kind) is gone, since the Firebrand's incendiaries are not `'bomb'`
  weapons. `detector` and `carries` are identity fields no overlay may change.
- **Both armies fly them, unchanged.** No overlay names the four, so both armies get the
  catalogue's exact numbers (asserted), and Meridian's Air list is main's. Ashen's Air list is the
  four, then its Kestrel and Firebrand: no key is shared and recruits stay last.
- **One commander for both.** `aiAir.ts` picks every aircraft by role from the army's own Air list
  (a `heavy` flag tells the Heavy Bomber from a side's ordinary bomber), so an Ashen side gets main's
  whole air plan (Interceptors, the Recon Plane, airlifts, the Heavy Bomber, Countermeasures) with
  its own strike aircraft.
- **Seams.** The field General may not board a Troop Carrier (off the map it would read as fallen);
  boarding is an order, so a boarder leaves its squad.

Tests: a new drive-factions section (the four on both lists with exact numbers; an Ashen
Interceptor scrambling at a Meridian Gunship and a Meridian one at a Kestrel; an Ashen Heavy Bomber's
run; an Ashen Recon Plane circling; the Ashen Hard commander answering Gunships with an
Interceptor and never a Gunship or Bomber). Two harness inputs moved with the merge, each a seed
effect rather than a rule: the round-4 Hard air battle (seed strike-1) now lasts 31 minutes and
ends while its first Bomber is on its way, so bombs are counted over it and a second battle
(strike-8, 18 bombs); about three seeds in seven drop bombs, in main and after the merge alike.
The heroes replay battle starts with 30,000 credits a side (was 20,000): the air war's Interceptors
spent the spare credits and side 0 fell at minute 9 before anyone fielded a hero.

Numbers. `npm run drive`: 374,120 assertions, 0 failed. Against main's own run, the three mission
lines, the standard-tech line (26/28, 20.6 minutes), every standard-tech sides line, the tier-three
battle and every map and site check are identical. The advanced lines moved: the air battles, the
advanced sides battles (12/12, 21.0 minutes; main 11/12, 20.9), larger maps (33.1 and 20.6 minutes;
main 31.1 and 28.3), the engineering battle (side 1 in 25 minutes, 36 mends; main 29 and 155) and
the map types (12/12, 27.2 minutes, 6 to 6; main 11/12, 24.0, 7 to 4). All of it is round 6's
computer formations on advanced tech: with the two formation moves switched off in a scratch copy,
every summary line of the merged tree equals main's exactly. `npm run campaign:fire` 2,951, 0
failures.

### 2026-11-11: Merge with main (main's round 5 and this branch's rounds 5b and 6, War for the Planet)

Main, built in parallel and live, had its own round 5 (the pop-out build window, map sizes, engineering
vehicles, neutral sites and tier three) and the Demolition, Borrowed Steel and trigger fixes. Sixteen
files conflicted. Main's names won wherever they collided:

- **`SkirmishSetup.size` is main's map size** (`MapSize`). This branch's game size became the
  **pace**: `SkirmishSetup.pace` (`GamePace`), `GAME_PACES`, `GAME_PACE_ORDER`, `LOBBY_DEFAULT_PACE`,
  `GamePaceSpec`, `applyPace`, `difficultyForPace`, `paceOf`, `GamePacePicker.tsx`, ladder `--pace`.
  The cards still say "game size". A setup without a pace reads as Quick; a setup saved by this
  branch before the merge with `size: 'quick' | 'long' | 'epic'` reads that as the pace, on a
  standard map (`'standard'` is ambiguous and reads as the map size). Planet battles state
  `pace: 'quick', size: 'standard', sites: false`. `normaliseSetup` returns map, tech, credits, ore,
  sides, mode, size, sites, research, pace, and both presets state every field in that order.
- **Design docs.** Main's `fireline-round5-design.md` keeps its name; this branch's became
  `fireline-round5b-design.md` (development lines and loadouts), with every reference updated.
- **Research in the build window.** The development-lines tree is the build window's Research tab
  (classic research is there exactly as main has it), and the loadouts panel sits under the tree on
  its Vehicles tab. Build buttons and the production strip price a vehicle with its loadout and time
  research by `researchTicksOf`. Every data-testid kept; the build-window tour now opens Customise
  before choosing advanced tech, since the lobby opens on the game size cards.
- **Tier three and lines.** Main's new vehicles (Repair Truck, Forward Base Truck, Railgun Tank,
  Stealth Tank) play in development lines as main defines them, without modules: the module
  `fits` lists and `MODULE_SLOTS` name the round 5b vehicles only (`MODULE_VEHICLES`).
- **The commander.** `scaledFor(s, tuned(difficultyFor(s, diff), mode))`: the pace's attack timing,
  then main's map-size scaling. Main's "no new structure with the ore gone" rule for paced research
  now also counts a Field Yard as a yard.

**Game size cards now pick the map size.** Quick and Standard keep the standard map; Long plays on
a Large map and Epic on a Huge one, which is what round 6 said a genuinely longer Long and Epic
needed (round 6, section 10.2). `applyPace` writes the map size, `isPresetSetup` checks it, the card
shows it, and the enemy cards show first-attack times scaled for the map (`scaledForSetup`).
Measured with the ladder, `--map random`, lines, each pace's preset (Normal mirror 150 seeds;
Hard and Easy rows 60 seeds each way):

| Card | Map | Normal mirror median (p10 to p90), minutes | Finished | Hard beats Normal (side 0 / side 1) | Card says |
|---|---|---|---|---|---|
| Quick | Standard | 22.1 (15.1 to 32.1) | 147 of 150 | (unchanged rules) | 15 to 35 |
| Standard | Standard | 23.9 (15.0 to 33.2) | 150 of 150 | (unchanged rules) | 15 to 35 |
| Long | Large, 96 tiles | 32.0 (24.7 to 41.5), longest 96.4 | 150 of 150 | 68% / 95% (60 seeds) | 20 to 45 (was 15 to 35) |
| Epic | Huge, 128 tiles | 52.6 (49.8 to 80.1), longest 115.0 | 150 of 150 | 90% / 100% (30 seeds) | 45 to 85 (was 15 to 35) |

Normal beat Easy in all 60 Long battles. Every Normal side reached Mk II and Mk III at Long and Epic
(medians 11.3 and 12.8 minutes at Long, 10.8 and 12.3 at Epic). Quick's three unfinished battles are
mined-out stand-offs of main's commander (round 6 recorded 11 at Quick before main's changes). So
the larger maps make the bigger cards genuinely longer, as round 6 said they would, and the card
minutes are the measured p10 and p90 rounded outwards to five minutes. A 150-seed Epic ladder on
huge maps takes about an hour on four cores. Hard's lead grows with the map (Epic on 64 tiles had
it beating Normal 58.7% both ways round; on a huge map 90% and 100% over 30 seeds): the order holds,
but a balance pass at 150 seeds on large and huge maps is owed (not done here).

Gates at the merge: `npm run check` passed (drive:fire 368,204 assertions, about 20 minutes on one
core; campaign-check 2,965; drive:planet 38,471), `npm run tours -- --quick fireline` ok (build
window: 35 menu items), `npm run test:api` 607 passed, `npm run check:loading` 183 of 184 under ladder load (the one
failure, Niccolo's handover blink sample, untouched here, passed 28 of 28 when rerun idle).

**Byte identity.** Every story mission and every classic and standard-tech skirmish in the merged
tree hashes exactly as origin/main's own code (setup projected without `research` and `pace`): 78
of 78. Every lines skirmish hashes as this branch did before the merge once `pace`, `size` and
`sites` are left out: 62 of 62 in `drive-planet-battle.ts`, so those hashes are unchanged. Regenerated:

- `drive-planet-battle.ts` STORY_HASHES, 22 of 56, all now origin/main's values: Demolition (all
  four: the mission itself, ce964a2), Borrowed Steel (all four: cb7044c, and at 600 ticks ce964a2's
  garrison), the Commando's health at tick 0 wherever he is brought (heroes runs of Blackout,
  Fireline, Firestorm and Last Light, ce964a2), and a defending enemy's `garrison` written at its
  first decision (ce964a2) at 600 ticks in Ace of Spades, Convoy North and Bastion Line. Probed at
  every main commit between: main's round 5 changed none of them, the trigger fix none.
- `drive-size.ts` PRE_ROUND6, 12 of 30: the Normal and Hard advanced battles (lines, classic,
  three sides). Main's computer fields Repair Trucks on advanced tech; its first engineering decision
  comes at ticks 4,200 to 8,100 in these battles, and every one first differs from the pre-merge
  build in the 1,000-tick snapshot after it. The classic ones equal origin/main's own battles; no
  setup, standard tech and Easy are unchanged.
- `drive-lines.ts` hashes nothing fixed; two of its computer checks were made precise rather than
  loosened: a lines battle may reach the cap only if the same seed played classic does too, with no
  research done (ai-normal-3: a mined-out stand-off, identical on origin/main's classic), and when
  Hard researches nothing at Quick (main's Repair Trucks come first; its one researching battle,
  ai-hard-5, researches in neither mode on main) the loadouts are checked at the Standard pace.

### 2026-11-11: Merge with main's air war (development lines, pace and War for the Planet kept)

Main's PRs #32 to #34 (the air war: the Recon Plane, Interceptors, Countermeasures, Troop Carriers,
the Heavy Bomber, the airlift's own timer and a lone Gunship's strikes; every campaign mission played
to a win; Founder's Ledger work) met this branch's development lines, loadouts, game size (pace) and
War for the Planet. Twelve files conflicted. Both sides' features are kept, and main's air war rules
and units apply in every mode:

- **Countermeasures is a classic upgrade only.** `UPGRADE_ORDER` lists six, as on main; the
  development lines stay five lines of four, and Armoured cockpits (the Air line's defensive
  doctrine, the same quarter off flak and anti-air missiles, and off bullets too) is its counterpart.
  A lines battle refuses Countermeasures as "Not in this battle" and a lines save drops it.
  `UPGRADE_LINE` is now a partial record. The computer's classic lists end with Countermeasures, as
  main's do; its lines and paced lists are unchanged.
- **The Air line covers main's aircraft through the paths every aircraft shares:** Air frames and
  Armoured cockpits by category, Avionics in `fly`, Heavy munitions where an aircraft fires
  (`gunshipFight` for the Gunship and the Interceptor, `dropBomb` for both bombers). Heavy munitions'
  blurb now names the Interceptor's missiles. No aircraft takes a module; `MODULE_VEHICLES` stays the
  eight round 5b vehicles. The decision and its table are in `fireline-round5b-design.md` (build log,
  2026-11-11), and `drive-lines.ts` gained a section for it ("Lines: the air war's aircraft").
- **`hurt`** applies this branch's `damageTakenMul` (armour forks, cockpits, smoke) and then main's
  Countermeasures; each is 1 where the other mode's upgrade lives, so classic is main's arithmetic.
- **`step`** runs main's `transportStep`, then heroes in a mission or a planet battle.
- **War for the Planet.** Planet battles are advanced lines battles, so carriers can fly in them; a
  battle's report now counts infantry aboard a living Troop Carrier as survivors, core slot kept.
  Planet battle setups already state every `SkirmishSetup` field (main added none).
- **Harness.** `drive.ts` runs main's `drive-airwar.ts` sections beside `drive-lines.ts` and
  `drive-size.ts`; `drive-air.ts` exports `airArena` (main's air war sections use it) with this
  branch's explicit `research: 'classic'`. `package.json` has main's `sweep:fire` beside
  `drive:planet` and `ladder:planet`.

**Byte identity.** Every story mission (at 0, 600 and 3,000 ticks, default and every hero), every
classic and standard-tech skirmish (2, 3 and 4 sides, every map, 3,000 ticks) and twelve classic
computer battles to 18,000 ticks (advanced, 10,000 credits, rich ore, every difficulty) hash in the
merged tree exactly as in origin/main's own code with `research` and `pace` left out of the setup:
251 of 251. Lines skirmishes of the same kind are unchanged against this branch before the merge
(the 3,000-tick ones, and Easy's computer battles). Lines computer battles at Normal and Hard change,
and only where main's air war commander acts. Bisected over main's air war commits (e7c5cef,
461af83, 265800d, a3d3040, d7536fc) by stepping each pair of trees tick by tick to the first
difference, on the classic battle of the same seed:

| Battle | First difference in lines (merged against this branch) | Same tick and change on main's classic | Commit |
|---|---|---|---|
| air-normal-1 | tick 2,946: a Helipad queued instead of a Gunship | yes | 265800d (a Helipad more for the Troop Carrier) |
| air-hard-1 | tick 2,994: a parked Gunship sent at a target, `airIds` and `nextAirStrike` set | yes | a3d3040 (a lone Gunship strikes) |
| size-a and size-b, Normal (lines) | ticks 7,008 and 7,038: a Helipad instead of a Gunship | yes | 265800d |
| size-a and size-b, Hard (lines) | ticks 4,026 and 4,236: a Power Plant queued | yes | 265800d |
| size-a Hard, three sides | tick 10,555: a Grenadier queued | yes (three sides, classic) | 265800d |

Regenerated, with the reasons in the files:

- `drive-planet-battle.ts` STORY_HASHES, 12 of 56, all now origin/main's values: Quiet Man, Blackout
  and Last Light, all four each, rebuilt by main's 2668bda so a player can win them. Skirmish hashes
  unchanged (62 of 62).
- `drive-size.ts` PRE_ROUND6, 11 of 30: Normal and Hard lines and classic, both Normal three-sided
  battles and Hard three-sided size-a (the table above; the classic ones equal origin/main's own
  battles). No setup, standard tech and Easy unchanged.
- `drive-size.ts`'s replayed Standard battle moved from seed size-replay to size-replay-2: on
  size-replay main's commander now ends the battle at tick 7,246, before either side reaches a Mk II.
- `drive-lines.ts`'s long quiet battle now also holds off `nextAirlift`: main's airlift raids keep
  their own timer, and the first took side 0's lone structure at tick 5,867 to 7,231.

Normal mirror at the Standard pace, lines, `--map random`, 150 seeds (`npm run ladder:fire -- --map
random --pace standard --match new:normal,new:normal`): side 0 wins 61 (41%), side 1 89 (59%), none
unfinished, median 24.1 minutes, Mk II reached by 81% of sides at 12.8 minutes and Mk III by 65% at
15.4. The same ladder on this branch before the merge: 68 (45%) and 82 (55%), median 23.9 minutes,
Mk II 82% at 12.9, Mk III 66% at 15.5. Length and research depth are unchanged; the 4-point seat
swing is inside the noise at 150 seeds.

The branch gained two commits while this merge was under way (lighter development-lines and pace
sweeps in `npm run check`, with `npm run drive:fire -- --deep` for the full ones; the build-window
tour waiting for the window to close), so the merge was redone on top of them; they touch only the
harness, CI and the tour driver, and merged cleanly with the changes above.

Gates at the merge: `npm run check` "All checks passed" (drive:fire "372968 assertions, 0 failed,
820.5s", about 14 minutes on one core; campaign-check "2979 assertions, 0 failures", about a
minute; drive:planet "34944 assertions passed, 0 failed, 68.4s"; the whole check 18m09s). The full
sweeps, run before the lighter sample landed (what `-- --deep` runs now): "373039 assertions, 0
failed, 1152.3s". `npm run
sweep:fire` 279 battles in 302s, the same table as main's (missions are byte-identical to main).
`npm run tours -- --quick fireline` "ok fireline" (build window: 39 menu items). `npm run
ladder:planet` "Every target passes; 106.5 s in all", and with `-- --prefix holdout` "Every target
passes; 109.4 s in all".

### 2026-11-11: The naval war, and the Coast map

The player asked for naval warfare next. No map had a sea to fight on: over six seeds of every type
the largest body of water was about 270 tiles, scattered lakes that no two bases shared. So the
naval war comes with a map type of its own. Advanced tech only, like air power; standard tech, the
campaign and older saves are untouched, and on any map without open sea nothing changes.

**The Coast map** (`maps.ts`, `coast` in `MAP_TYPES`, so `random` can draw it too). Two sides: a sea
across the middle that stops short of both edges, with a wobbling shore, rock islets and a harbour
bay in front of each base, so the shore lies at about the edge of the base's clearing. The land
corridors round its two ends are the two routes between the bases, and the contested ore lies in
them on the line as far from one base as the other. Three and four sides: an inland sea round a
central island, crossed by the tracks to the centre as causeways, so every shore faces its
neighbours. Drafts pass `mapProblem` 35 to 38 times in 40 on two sides (the generator retries) and
40 in 40 on three and four, at every size.

| Unit | Cost | Role |
|---|---|---|
| Patrol Boat | 600 | Fast (1.6 tiles/s); machine guns (16, range 5) that reach aircraft too |
| Destroyer | 1400 | 720 health; deck gun (55, range 6.5); sonar: a detector, finds Submarines 7 tiles off |
| Submarine | 1200 | Stealthy; torpedoes (130, range 5.5) that hit ships alone. Needs a Research Lab |
| Battleship | 3200 | 1500 health, slow; guns (120, splash 1.3) from 3 to 11 tiles. Needs a Tech Centre |
| Landing Craft | 900 | Unarmed; six places, an infantryman one, a vehicle two |

| Structure | Size | Cost | Power | Needs |
|---|---|---|---|---|
| Naval Yard | 3x3 | 1500 | -40 | Factory; on the shore of open sea; mends ships beside it |

How it plays (`naval.ts`, `transport.ts`, numbers in `rules.ts` under "The naval war"):

- **Sea layer.** `passable`, `nearestPassable`, `lineClear` and `findPath` take an optional `sea`
  flag: open water for ships, land for everything else, as before. Every existing call keeps the
  default. Ships move, path and are pushed apart only on water; a ship and a soldier on the beach
  beside it never push each other. A ship sent inland stops at the nearest water within 10 tiles.
- **Who hits what.** Ships are ground-level: `hitsNaval` is whatever `hitsGround` says, so tanks,
  turrets and bombs hit ships, flak never does, and the new `torpedo` (`canHitGround: false`,
  `canHitNaval: true`) hits ships and nothing else. Armour class `ship`. A ship as close as the water
  lets it get to a target still out of range, or a soldier as close as the shore lets it get to a
  ship, gives the target up: at first a fleet sat for twenty minutes locked on a structure inland.
  Limited to cases involving ships, so land battles play exactly as before.
- **The Naval Yard** needs at least 3 water tiles round its footprint belonging to a body of at least
  `NAVAL_MIN_SEA` (60) tiles: a pond is refused. Ships come out on the nearest open water. It mends
  its side's ships within 2 tiles, 8 health a second, free.
- **The Submarine** uses the Stealth Tank's rule (`stealth`), so a Destroyer or a Recon Plane (both
  detectors) finds it 7 tiles off, anything else at 2.5, and everyone just after it fires.
- **The Landing Craft** is the Troop Carrier's code (`transport.ts`), from the shore: infantry and
  ground vehicles board (never a hauler or a deploying truck; a vehicle takes two places), it is still
  whenever it has no order, and it sets them down on the nearest beach within 3 tiles.

**The computer** (`aiNaval.ts`), once a decision after its air plan: on its first naval decision it
looks for a sea within 20 tiles of home that also comes within 20 of an enemy base (`navalShore`,
kept). Without one, nothing. With one: a Naval Yard once a Factory and refineries stand, building up
to three Generators toward the shore first if it is out of reach (`navalCreep`, read by `findSpot`);
ships to a plan by difficulty (Easy two Patrol Boats; Normal two, two Destroyers, a Submarine and a
Landing Craft; Hard three Destroyers, two Submarines and a Battleship as well); defence of its shore
by every fit warship; fleet strikes on the opponent's Naval Yard or the structure nearest the sea,
the Battleship shelling it; Submarines hunting ships; hurt ships home to be mended; and landings of
five (Normal) or six (Hard) places of idle troops at a refinery they can walk to from a beach. Ships
never join a land wave (one filter in `ai.ts`).

The first Hard battles showed what to fix: the commander found no sea at all until the map gained
its harbours and the reach rules widened (the nearest water was 18 tiles from the Command Yard); a
fleet that won the sea then sat locked on an inland target (the give-up rule above); and landings
never sailed once the opponent's Naval Yard fell, because their target had to be within 8 tiles of
water (now 14 for landings, since the troops walk the rest). In a Hard Coast battle after those
fixes the fleets met mid-sea around minute 15, twenty ships were sunk, ships scored over a hundred
kills, and side 0 then shelled side 1's coast.

Interface: a Naval tab after Air (advanced tech, maps with open sea), selecting a Naval Yard opens it;
stat cards for ships, the Naval Yard's shore rule and mending; the Landing Craft's status line counts
places. Art: five ships with wakes while under way, turrets that track, a low dark Submarine, a
Landing Craft whose seats fill; the Naval Yard with a slipway, a hull on the stocks and a gantry
crane. How to play has a Naval panel; the lobby offers seven battlefields.

Tests: `scripts/drive-naval.ts`, ten sections in `npm run drive:fire`: the rules and tech levels, the
Coast map at every size and side count, the Naval Yard's shore and pond rules, sailing (on water
the whole way, stopping at the shore when sent inland), who hits what (a Destroyer sinks a Patrol
Boat, torpedoes sink a Destroyer and never touch a tank on the beach, a tank shells a ship, flak never
does, a Patrol Boat fires at a gunship, a ship gives up an inland target), Submarines found by a
Destroyer, mending, landings (two tanks and two riflemen fill six places, nowhere to land at sea, all
ashore at the far beach), old saves, and the computer (a yard, a fleet that scores kills, a landing,
exact replay, and no navy on Plains).

**The ladder** (150 seeds, advanced tech, standard size). On the six older map types (the same
seeds and maps as before the naval war, `--map classic,river,highlands,lakes,plains,canyon`), and on
the Coast map alone:

| Match | Six types, before (air war) | Six types, now | Coast |
|---|---|---|---|
| Normal mirror | 47% / 53% | 47% / 49% (5 unfinished) | 49% / 45% (9 unfinished) |
| Hard beats Normal, both ways | 73.0% (68-78) | 75.3% (70-80) | 81.7% (77-86) |
| Normal beats Easy, both ways | 99.0% | 99.7% | 99.3% |
| Average minutes, Normal mirror | 24.1 | 25.6 | 32.3 |

On the older maps the intervals overlap: a Lakes or Classic map with a big enough lake near both
bases can now carry a small navy, which is the only way the naval war reaches them. On the Coast
map the difficulty ladder holds and Hard pulls further ahead (its plan adds a Battleship, a third
Destroyer and a second Submarine), and battles run longer: the armies go round the sea. Unfinished
battles at the 100-minute cap are more common there (6% in the mirror, up to 17% in one cross
match against the frozen commander); a long naval stand-off between two navies that each hold their
own shore is the likely cause, and is the first thing to look at if Coast games feel stuck.
Harness at the end: `npm run drive:fire` 391,798 assertions, 0 failed; `npm run campaign:fire`
2,951 (the Naval Yard joins the skirmish-only structures its Last Light check skips).

### 2026-11-11: Merged with main's naval war

Round 6 merged main's naval war (the entry above). The rules are in `fireline-round6-design.md`
section 9: both armies sail the five ships and build the Naval Yard at the catalogue's exact
numbers; main's naval code reads prices, weapons and names through the per-side lookups where it
knows the side; the Naval Yard sits after the Fortress and before the Academy, keyless like both;
formations are for land units (`formsUp`: a ship takes a rear slot but never joins a squad, and two
ships cannot form up); the field General boards no Landing Craft either; the computer's ships stay
out of its waves. Two things the merge itself fixed: the build window's per-army catalogue had four
tabs and so showed an empty Naval list (it now takes every key of `MENUS`), and the key table names
the Naval Yard among the clicked Structures. `drive-factions.ts` gains a naval section (lists, specs,
build keys over the Naval tab, boarding, formations, and an Ashen-against-Meridian Hard battle on the
Coast map from each seat).

**One harness input changed, and why.** Main put the Coast map in `MAP_TYPES`, so a `'random'` map
now draws from seven types and many seeds land on another map. Round 6's checks (formations,
heroes, Generals, armies) were written and measured on the six-type draw; on the new one the
formations check's middle-of-the-map group stood beside a lake and one heroes battle ran 60 minutes
on the Coast map. Those checks now create their battles through `createAsWritten`, which gives a
random-map setup the type the same seed drew from the six, so each keeps the battlefield it was
written on. Nothing a check asserts was loosened. Main's own checks are untouched.

Harness: `npm run drive:fire` 396,760 assertions, 0 failed. The mission, standard-tech and
tier-three lines are identical to main's. The advanced lines moved (the air battles, the naval
battle, the advanced sides battles, larger maps, the engineering battle and the map types); with
the computer's two formation moves switched off in a scratch copy, every summary line equals main's
exactly, so all of it is round 6's formations, as at the air-war merge. `npm run campaign:fire`
2,951, 0 failures.

### 2026-11-11: Merge with main's naval war (development lines, pace and War for the Planet kept)

Main's PRs #38 and #39 (the naval war: the Coast map, five ships, the Naval Yard, the computer's navy;
a small Founder's Ledger change) met this branch's development lines, game size (pace) and War for
the Planet. Five files conflicted (this log, `renderer.ts`, `Lobby.tsx`, `state.ts`, `tick.ts`), each
a both-sides merge: the Landing Craft's places beside the hauler's cargo over `cargoMaxOf` (the ore
cage), "War for the Planet" and "Seven battlefields" in What's new, `migrateNaval` after the paced
research repair, main's `navalStep` before heroes (which still run in a mission or a planet battle),
and the module and research speeds before main's sea layer in `stepAlong`. The decisions:

- **Coast and the game size.** The cards do not choose a map type, so Coast plays at every size
  as main built it, and `random` now draws it one time in seven at every size. Long on a Large map
  and Epic on a Huge one were played on the Coast map, lines, Normal mirror: both sides built a
  Naval Yard and a fleet in every battle (4 Long seeds, played before and after the hold below; 3
  Epic, before it), and every side reached Mk II and Mk III (Long medians about 13 and 15 minutes,
  Epic about 12 and 13). Long Coast battles ran 27 to 76 minutes, beyond the card's 20 to 45 in five
  of the eight; Epic's ran 50 to 82, inside 45 to 85.
  The card minutes were measured over the six land maps and are kept; Coast at Long runs long, as
  main found at the standard size (32 minutes against 25).
- **Paced research holds ships too.** At a paced research size the commander holds its unit
  purchases while short of its next research with an army at home. Main's navy bought ships through
  that hold, and ships counted as the army at home, so on a Coast map a paced commander could hold
  its land army back while it built a fleet. Now ships do not count toward the army at home and the
  ship purchases wait while the hold is on (`navalPlan`'s `hold`, from `ai.ts`). Only paced lines
  battles can see this; classic, standard tech, Quick and missions never hold.
- **No navy in War for the Planet.** No planet terrain is the Coast map: `PlanetTerrain` is the six
  land types (`PLANET_TERRAINS`, in `MAP_TYPES`' old order, so every planet map and draw is
  unchanged), the yield, defence, ore and name tables are keyed by it, and a save whose battle names
  any other map type is refused. A large Lakes or Classic battle could still hold a sea, so a
  planet battle refuses the Naval Yard and every ship for every side (`techAllowed`), and the
  computer never looks for a sea there. The planet's armies are infantry and vehicles, a ship
  could never come home from a battle, and the battles stay the ones this branch built: the v1
  fixture and the battle rules 1 wars give their old hashes (OLD_WAR_HASHES, unchanged; the battles
  are hashed without the empty Naval queue every state now carries). Larger planet maps by stakes
  (`battleRules`, `mapSize`) are untouched; a planet battle's setup still states every field.
- **Ships and development lines.** No Naval line and no module for a ship: the decision and its
  checks are in `fireline-round5b-design.md` (build log, 2026-11-11). In short, ships are neither
  vehicles nor aircraft, so the Armour, Engines and Air lines, Autoloaders, Field workshops and
  Salvage crews pass them by, while Calibration, HEAT rounds (the Destroyer's shells),
  High-explosive fill (the Battleship's blast) and Assembly lines (the Naval queue) reach them as
  they reach every weapon and queue; Assembly lines' blurb now names ships. Nothing stacks, and
  main added no `SkirmishSetup` field, so every preset still states every field.
- **Purity.** `src/sim/` and `src/planet/` still use no `Math.random` and no clock; main's naval
  code draws nothing. The harness's refusal and same-object checks cover main's new actions.

**Byte identity.** Every story mission (0, 600 and 3,000 ticks, default and every hero: 84), every
classic and standard-tech skirmish (2, 3 and 4 sides, all seven map types, 3,000 ticks: 142) and
fifteen classic computer battles to 18,000 ticks (advanced, 10,000 credits, rich ore, every
difficulty, on random, Coast and Lakes maps) hash in the merged tree exactly as in origin/main's own
code (345207f) with `research` and `pace` left out of the setup: 241 of 241. Regenerated, with the
reasons in the files:

- `drive-planet-battle.ts` STORY_HASHES, all 56, now origin/main's values. Bisected: all 56 equal
  the old values at 1608d33's parent and origin/main's at 1608d33 (part one of the naval war),
  which gives every player an empty Naval queue, so every state's JSON changed.
- `drive-planet-battle.ts` SKIRMISH_HASHES, all 62, for the same reason, and because main's
  computer (62f30b6) notes `navalShore: null` at its first decision in an advanced battle with no
  sea. Every old value equals the merged state with only those two left out, so no battle played
  differently. The loop keeps the six old map types (`PRE_NAVAL_MAPS`), so its seeds are unchanged,
  and ten Coast skirmish hashes were added.
- `drive-size.ts` PRE_ROUND6, 24 of 30: every battle on `map: 'random'`. Main's 1608d33 puts Coast
  in `MAP_TYPES`, so `random` draws among seven and both seeds now draw another map (size-a canyon
  to Coast, size-b highlands to Lakes). The classic and standard ones equal origin/main's own
  battles. The six without a setup are unchanged: the hash now also leaves out an empty Naval queue
  and `navalShore: null`.
- `drive-size.ts`'s starvation guard counts ground units without ships, and leaves out seeds that
  draw the Coast map, where the fleets' fight decided the land armies (one seed: 2 ground units at
  Standard against 19 at Quick, with side 0 broke for the last 3,000 ticks and nobody holding for
  research).

Normal mirror at the Standard pace, lines, 150 seeds (`npm run ladder:fire -- --pace standard
--match new:normal,new:normal`). On the six land maps (`--map classic,river,highlands,lakes,plains,canyon`,
the same maps both builds): this branch before the merge side 0 57 (38%), side 1 92 (61%), 1
unfinished, median 24.3 minutes, Mk II 82% at 12.9, Mk III 64% at 15.4; merged 57 (38%), 91 (61%),
2 unfinished, median 24.3, Mk II 80% at 12.9, Mk III 64% at 15.6 (the one battle more unfinished is
on a Lakes map with a sea). With `--map random`: before 61 (41%) and 89 (59%), none unfinished, median
24.1, Mk II 81% at 12.8, Mk III 65% at 15.4; merged 71 (47%), 76 (51%), 3 unfinished, median 23.7,
Mk II 77% at 12.6, Mk III 62% at 15.3, Coast 14/5/1 of its 20 battles.

The build-window tour driver walks every tab in `MENUS`, which now includes Naval; the Naval tab is
offered only on a map with open sea, so the driver's battle is now on the Coast map and checks the
Naval tab's five ships and the Naval Yard too (45 menu items, was 39).

Gates at the merge: `npm run check` "All checks passed" (drive:fire "393357 assertions, 0 failed,
979.4s"; campaign-check "2979 assertions, 0 failures"; drive:planet "35252 assertions passed, 0
failed, 97.8s"; the whole check 21m28s). `npm run tours -- --quick fireline fireline-planet` "ok
fireline" (build window: 45 menu items) and "ok fireline-planet". `npm run ladder:planet` "Every
target passes; 107.8 s in all", and with `-- --prefix holdout` "Every target passes; 110.3 s in all".

### 2026-11-11: the visual pass

Four parallel strands, each owning its own files. The lobby became a briefing room: Campaign, then
Skirmish, then Your battles, with a live preview of the theatre map and mission counts read from
the mission lists (the copy still said eight missions after act two added six). The theatre maps
were redrawn as operational maps, in a night map-table version for dark mode. The battle console
was regrouped (clock, speed, sound and display clusters; a twelve-light power meter; build buttons
whose state reads at a glance; an after-action table on the victory and defeat cards). The
battlefield gained ore fields, structure skirts and contact shadows, a curved fog edge, leaning
grass, directional muzzle flashes and notched health bars. Frame time held: median 2.7 to 3.0 ms
against 2.9 ms before at minute 25 of a huge battle, 60 fps either way.

### 2026-11-11: territory and engagements

The campaign map became a country (`fireline-campaign-design.md` section 11). Rules in
`src/campaign/territory.ts`: a region is held (home ground, its mission won, or its engagement
won), open (no mission, its act's front reachable, bordering held ground) or enemy ground. Every
region without a story mission holds an engagement, a side battle rolled from the region's id and
scaled by missions won: an outpost or (from mission 4) a whole base, garrison, posture, credits,
one or two bonus objectives. Half a story mission's xp; never tech, heroes, or a mission won.
`CampaignState.engagements` is additive and older saves load with none.

Tuning on the way, measured with the scripted base player over every engagement at two points of
its act (44 battles): a whole Combine base on the attack ("normal" posture) beat a player still
raising a base in four of five cases, and a rich defending base was never broken by an army sent
at its nearest structure in 45 minutes. So a base only defends, on a smaller purse, and is beaten
by bringing down its Command Yard and War Factory rather than its last harvester; raiding outposts
start with a smaller garrison. After: 43 of 44 won with the army sent at twelve minutes, 38 of 44
at ten. `campaign:fire` plays a seeded six of the twenty-two at Normal, builds every engagement at
three points of its act at every difficulty, and checks the geometry and the control rules: 7,642
assertions, about 25 seconds more than before.

### 2026-11-11: Round 6 merged with the visual pass

Round 6 merged main's visual pass and territory campaign (the two entries above). Main's look is the
look; every round 6 control now sits inside it.

- **Skirmish orders.** The Army row, the Heroes field and the two Generals fields go in step 3,
  Forces, under Tech level (Heroes and Generals are greyed on standard tech, so they follow it).
  Tech level keeps round 6's `techText`, which names the Command Academy and the field General only
  when their options are on. The Deploy step's summary gains Armies ("Ashen against Meridian"),
  Your General, and Heroes and Generals with advanced tech. The army seats fill the row; on a phone
  each doctrine seat's name goes above its choices, so the three fit across.
- **Battle console.** The General's button is a drawer in the dock, labelled General like Heroes
  and Support, its face lit in the General's gold when it stands (the hero revival note is a drawer
  too). The formation row is a segmented strip of the console's small buttons under Stance, the
  pressed shape lit as a stance is; the touch group chips are the same buttons, finger-sized. The
  desktop orders legend gains the period key. The build window was not restyled by main, so its
  per-army lists and Naval tab are unchanged.
- **How to play.** Main's manual sections replace the old panels; the manual's section is now
  `ManualSection` in `components/ui.tsx`, so the round 6 panels (Two armies, Heroes in free play,
  Generals, Formations and groups) use it too and appear in the page index, with Naval, which
  main's index had left out.
- Main added `@fontsource/old-standard-tt`: run `npm install` after pulling.

Harness: `npm run drive:fire` 396,760 assertions, 0 failed, every summary line equal to the run on
the round 6 head (the visual pass is client-side); `npm run campaign:fire` 7,642, main's number,
with the territory and engagement checks.

### 2026-11-11: Merge with main's visual pass and territory campaign (pace, lines and War for the Planet kept)

Main's PRs #36 (the visual pass: the briefing-room lobby, the war-map theatre, the battle console,
the field-manual How to play; territory and engagements) and #40 (a Founder's Ledger coach) met this
branch's game size (pace), development lines and War for the Planet. Six files conflicted (this log,
`SkirmishSetup.tsx`, `GameScreen.tsx`, `HowToPlay.tsx`, `Lobby.tsx`, `styles.css`), each merged with
both sides kept. The decisions:

- **The lobby reads 01 Campaign, 02 War for the Planet, 03 Skirmish, 04 Your battles.** The war's
  setup panel became a numbered section like main's, with its saves under "Your wars" in main's save
  rows (a war's row names its length and turn); the hero banner and the section path gained a War
  for the Planet entry. `WarSetup` is unchanged but for a class, `fl-war-setup`, under which the
  lobby gives it main's monospaced field labels, larger inputs, ticked length cards and boxed rules.
  "Guided first turn" and every `war-*` hook are where they were.
- **The game size start screen lives inside main's numbered skirmish orders.** The section still
  opens on the size cards every visit: 1 Game size (the cards, now two by two with main's corner
  tick), 2 Enemy commander (scaled for the pace and map size, as before), 3 Deploy (main's orders
  table, which now also lists the game size and the research mode and carries `setup-summary`, the
  name, Begin and Customise). Customise shows main's five steps, with "Game size" as a back button:
  1 Enemy commander, 2 Battlefield (with the seed), 3 Forces (sides, mode, tech level, and the
  research choice under it, still greyed at standard tech), 4 Terms of engagement (the game size
  row first, then credits, ore, map size and sites), 5 Deploy. One Begin button at a time, so the
  tour drivers' `Begin the battle` lookups still find exactly one.
- **The war screen in the campaign screen's lettering.** Main restyled the campaign map, the war
  screen's neighbour; the war screen's title and card headings now use the campaign's small-caps
  serif (`--a-serif`), its tabs main's monospaced labels with an accent rule on the open tab. Only
  CSS changed; every `data-tour-target` id, the Tour button and its tests are untouched.
- **The battle console.** The message feed takes main's `fl-d-feed` class and offsets (80 pixels
  over a bar) and still rises over a planet battle's hero and power bar.
- **How to play** became main's field manual: War for the Planet is a `Section` after Campaign, and
  the index lists it, and Naval, which the index had left out.
- **What's new** keeps War for the Planet first, beside main's counted campaign line.
- **Engagements state their research mode.** This branch's `MissionSpec.research` is required, so
  `engagementSpec` sets `research: 'classic'`, as every story mission does. Main's territory
  campaign changed no file under `src/sim/` or `src/planet/`, and no mission.

**Byte identity.** Every story mission (default and every hero, 0, 600 and 3,000 ticks: 28) and every
engagement (fresh campaign and every mission won, 0 and 1,500 ticks: 44) hash in the merged tree
exactly as in origin/main's own code (268d78a), with `research` and `pace` left out of the setup:
72 of 72. No hash in any harness was regenerated; OLD_WAR_HASHES, STORY_HASHES and SKIRMISH_HASHES
are unchanged and pass.

### 2026-11-11: campaign Hard winnable on Blackout, Fireline, Iron Coast and Firestorm

No scripted plan won these four at campaign Hard (0 of 12 each, again on main after the air war
landed). Measured one part of Hard at a time over the four:

| Hard as | Blackout | Fireline | Iron Coast | Firestorm |
|---|---|---|---|---|
| tier up, troops x1.15, credits x1.25 (as it was) | 0 | 0 | 0 | 0 |
| no tier step, troops x1.15, credits x1.25 | 5 | 0 | 4 | 5 |
| tier up, no extra troops or credits | 1 | 9 | 3 | 1 |

So the commander's tier step broke three of them, and Fireline (whose Normal already plays the Hard
commander, with 8,000 credits) was broken by the extra credits. Dropping the tier step from Hard for
every mission was tried and rejected: Hold the Ford and Last Light then won 12 of 12 at Hard, the
same as Normal. Instead a mission may now set its own Hard (`MissionSpec.hard`: the commander's tier
and the enemy's credits multiplier, anything unnamed being Hard as usual). Blackout, Iron Coast and
Firestorm keep a Normal commander at Hard with Hard's larger forces; Fireline keeps its Hard
commander and the extra troops but no extra credits.

| Mission | Easy | Normal | Hard |
|---|---|---|---|
| 1 First Light | 12/12 | 12/12 | 12/12 |
| 2 The Quiet Man | 6/6 | 6/6 | 6/6 |
| 3 Hold the Ford | 12/12 | 12/12 | 7/12 |
| 6 Ace of Spades | 3/3 | 2/3 | 2/3 |
| 7 Blackout | 12/12 | 9/12 | 5/12 |
| 8 Fireline | 12/12 | 9/12 | 6/12 |
| 9 Iron Coast | 12/12 | 11/12 | 4/12 |
| 12 Firestorm | 10/12 | 5/12 | 5/12 |
| 14 Last Light | 12/12 | 12/12 | 5/12 |

Firestorm reads the same at Normal and Hard: its losses at both are mostly its 15-minute deadline,
which Hard does not move, and the plans that reach the Strike Command in time win at both.
campaign-check now plays one winning plan for each base mission at Hard as well as Easy and Normal,
and `npm run sweep:fire -- --level hard` runs one level alone.

### 2026-11-11: The Coast stalemates

The naval war left more Coast battles at the 100-minute cap than on any other map (78 across the
ladder card). The player asked for them to be fixed. Each stalled battle was traced by hand; each was
a side that could neither win nor lose, waiting:

- **A fleet turning to and fro.** Locked on a Command Yard ten tiles inland, a fleet turned toward
  it, gave up, turned back to its attack-move, and saw it again, every tick for an hour; the give-up
  rule waited for an arrival that never came. A ship now never chases a land target no water lies
  within range of (`canReach` in naval.ts), nor a soldier a ship no shore lies within range of.
- **Broke with ore on the map.** No hauler and less than one costs; or no refinery. On advanced
  tech a commander with no income and no way to buy it back takes back queued units, then sells what
  it can live without, one a decision (`recover` in aiAir.ts: Research Lab first, Generators never),
  and with nothing left trains what it can and goes all in.
- **A last stand that never started.** Ships counted as an army, so a side whose only units were
  at sea never made its last stand; land units only now.
- **A winner that could not finish.** An opponent reduced to a Barracks and three Generators, out
  of the fleet's reach, with no armed unit left: every idle unit that can take ground now goes in,
  wave or no wave (`mopUp`). Like any attack it waits for the commander's first attack to be due,
  and it leaves an opponent defending with turrets alone to the waves (the full check caught both:
  harness battles that hold attacks off were overrun at first).
- **A Grenadier cancelled every decision.** `raiseFunds` took back the last troops a broke side was
  training to save for a refinery it could never reach; it now leaves the queue alone when even every
  queued unit and spare structure would not reach the price. And the navy bought ships with the same
  credits; it now buys no yard and no ships while there is no income.
- **Nothing to pay for a rifleman.** Two broke sides sat on five Generators each. With no troops and
  not the price of one, the last resort sells a Naval Yard, Helipads, the Uplink, turrets and any
  Generator but the last.

The ladder (150 seeds, Coast; the same card before and after):

| | Before | After |
|---|---|---|
| Unfinished, all eleven matches | 78 | 30 |
| Unfinished, Normal mirror | 9 | 0 |
| Unfinished, the new commander against itself (750 battles) | 17 | 5 |
| Hard beats Normal, both ways | 78.3% | 81.0% |
| Normal mirror, average minutes | 34.8 | 30.9 |

Most of what remains involves the frozen `prev` commanders, which by design get none of this. On
the six older map types nothing moved beyond the noise (Hard beats Normal 75.0%, was 75.3%; 11
unfinished in all, was 16). The round-4 air battle's one seed now ends a minute before its Bombers
fly, so its bombing check counts a second, longer battle as well. Harness: `npm run drive:fire`
396,367 assertions, 0 failed; `npm run campaign:fire` 7,642, 0 failures.

### 2026-11-12: Merge with main's Coast stalemates (pace, lines and War for the Planet kept)

Main's PR #42 (the Coast stalemates: ships that never chase what they cannot reach, a broke
commander's recovery, mop-up, the land-only last stand) met this branch's development lines, game
size (pace) and War for the Planet. Three files conflicted (`ai.ts`, `aiAir.ts`, `aiNaval.ts`), each
merged with both sides kept: the imports joined, main's last stand, `recover` and `mopUp` in place
of the old last-stand line and ahead of the paced research block, and the navy's ship purchases
gated on both the paced hold and main's crisis. The decisions:

- **Mop-up, all-in and the paced hold run side by side.** The hold (2026-11-11, the naval war's
  merge) only stops purchases: no land units and no ships are bought while the commander saves for
  its next research. Mop-up and a broke side's all-in buy nothing; they send idle units already
  built. So both apply at once: a holding commander whose opponent has no armed unit left still
  sends its army in, and keeps saving. Neither needed a change.
- **The attack timer is the pace's.** Mop-up and all-in wait for `nextAttack`, which at a paced size
  is already the pace's first attack, scaled for the map (`difficultyForPace`, `scaledFor`). So at
  Long and Epic they wait as long as the first wave does, and a quiet harness battle stays quiet.
- **A crisis lifts the hold.** Paced research is planned only out of a crisis, and the plan clears
  `researchFor` at every decision, so in a crisis the hold falls away. The hold in `ai.ts` reads the
  previous decision's note, so it can last one decision into a crisis; that costs at most one
  decision's purchases and was left as it is. Main's crisis rule (no yard and no ships with no
  income) and the hold both stop ships; either is enough.
- **Recovery and paced research.** `recover` sells the Research Lab first, paced research or not:
  the economy comes first. Research in progress pauses until a Lab stands again (its progress and
  any doctrine kept), and the paced plan rebuilds the Lab once out of the crisis with ore on the map.
- **Development lines: a queued unit's modules count.** Main's `raiseFunds` now does nothing when
  even every queued unit and spare structure would not reach the price. Taking a queued vehicle back
  refunds its modules too (`extra`), so the sum it adds up now includes them. Classic battles carry
  no modules, so they are unchanged to the credit.
- **War for the Planet.** A planet battle has no Naval Yard and no ships (`techAllowed`), so
  `recover` finds no yard to sell there and the land-only last stand is the old one. OLD_WAR_HASHES
  unchanged and passing.
- **Purity.** Main's code draws nothing and reads no clock; `src/sim/` still uses neither.

**Byte identity.** Every story mission (default and every hero; 0, 600 and 6,000 ticks: 84 hashes in
28 runs), 98 classic and standard-tech skirmishes played to the end or 60,000 ticks (all seven map
types, 2, 3 and 4 sides, every difficulty with two sides) and 24 computer battles on the original
game to the end (every difficulty, eight seeds) hash in the merged tree exactly as in origin/main's
own code (d16b2bf) with `research` and `pace` left out of the setup: 150 of 150 runs. The same runs
on this branch before the merge differ from main in 50 of them, so the check sees main's change.
Regenerated, with the reasons in the file:

- `drive-size.ts` PRE_ROUND6, 18 of 30: every advanced battle (lines, classic and three, both
  seeds). Bisected on the pre-merge build: every one first changes with main's 611005a alone
  (recovery when broke, ships that never chase what they cannot reach), and most again with
  f216f26 and 385ce76. The six classic ones equal origin/main's own battles exactly. No setup and
  standard tech are unchanged.

No other hash moved: STORY_HASHES, SKIRMISH_HASHES and OLD_WAR_HASHES are unchanged and pass.

Normal mirror, Standard pace, lines, 150 seeds on `--map random` (`npm run ladder:fire -- --pace
standard --match new:normal,new:normal --map random --seeds 150`): this branch before the merge
side 0 71 (47%), side 1 76 (51%), 3 unfinished, median 23.7 minutes, Mk II 77% at 12.6, Mk III 62%
at 15.3, Coast 14/5/1; merged 71 (47%), 77 (51%), 2 unfinished, median 23.6, Mk II 77% at 12.6,
Mk III 62% at 15.3, Coast 13/7/0. `npm run sweep:fire` gives exactly the table in main's campaign
Hard entry (2026-11-11), every mission and level.

Gates at the merge: `npm run check` "All checks passed" (drive:fire "397801 assertions, 0 failed,
838.2s"; campaign-check "7699 assertions, 0 failures"; drive:planet "35252 assertions passed, 0
failed, 84.3s"; the whole check 19m16s). `npm run tours -- --quick fireline fireline-planet` "ok
fireline" (build window: 45 menu items) and "ok fireline-planet". `npm run ladder:planet` "Every
target passes; 94.5 s in all", and with `-- --prefix holdout` "Every target passes; 96.1 s in all".

### 2026-11-12: Round 6 merged with War for the Planet (development lines and the game pace)

Main's PR #35 (War for the Planet, with development lines and loadouts, the game pace and the merges
recorded in the entries above) met round 6's two armies, heroes in free play, Generals and formations.
Nineteen files conflicted; every one was merged with both sides kept. The rules are in
`fireline-round6-design.md`, section 10. In short:

- **Two contracts, one name.** Main's pace contract was also `fireline-round6-design.md`. Round 6's
  armies keep the name; main's is now `fireline-round6b-design.md`, every reference updated (as round
  5b was named at the merge before). The build log entries above keep their words; where one of main's
  says "round 6" about the game size, it means round 6b.
- **War for the Planet is unchanged.** `buildPlanetBattle` states round 6's four setup fields (every
  seat Meridian, heroes, Generals and doctrine Generals off), `heroesInPlay` and `fieldGenerals` are
  false in any planet battle, and the computer's wedge and regroup box run in a skirmish only. The
  war's own heroes run as main built them; a player may still give a formation. The war's player
  faction is called Meridian Corps on the planet map, and every planet battle seat fields round 6's
  Meridian army, so the names agree.
- **Textual merges.** Setup fields in the order map to pace, then factions, heroes, generals,
  generalPicks, in both presets. The hero tick runs in a mission or a planet battle (main) or a
  skirmish with heroes on (round 6), and Z X C V do likewise. The skirmish orders' Forces step is
  tech level, research, then army, Heroes and Generals. The stat card takes the army, the battle and
  the research mode; the loadout panel and the build window's Vehicles tab sit with round 6's per-army
  lists. The ladder has main's `--pace` and `--research` beside `--factions`. The build-window tour
  opens Customise, then fixes the seed and the Coast map.
- **Semantic merges.** Main's new lookups read the side's army where the side is known: the
  computer's vehicle price (`vehiclePrice`), Salvage crews' payment, the bomb run's and flight's speed,
  the paced hold's armed units, the loadout names. `weaponOf(s, u)` gives the army's weapon with a
  long barrel; the General's aura copies that weapon (before, round 6's line would have dropped the
  barrel, and main's would have dropped an Ashen overlay). A squad member's speed cap comes after
  main's Motorised infantry and fuel tank, and the squad's pace counts both.
- **Development lines for both armies.** Main added no unit or structure kind, so menus, keys and the
  recruits' places are unchanged. Both armies research the same lines; modules fit the catalogue kinds
  their lists name, so an Ashen tank takes a Meridian tank's modules and the Raider Bike takes none.

**Harness.** Round 6's defaults (setup fields and each player's `faction`, all Meridian and off) are
checked and left out of the hashes main's harness keeps (`preRound6` in `drive-planet-battle.ts`, the
`strip` in `drive-size.ts`), as the naval merge did for the empty Naval queue; a planet battle with
any round 6 trace throws. `drive-planet-battle.ts` also asserts a planet battle's stated setup and,
after 3,000 ticks of the four-sided capital battle, no General, Academy, recruit or squad.
`drive-size.ts` PRE_ROUND6: the 18 advanced battles regenerated, for round 6's computer formations
alone: with the two formation moves switched off in a scratch copy of the merged tree, all 30 equal
origin/main's values. The two setup key-order checks name round 6's four after the pace.

**Numbers.** origin/main (5e91242) in a scratch worktree: `npm run drive` 397,801 assertions, 0
failed; campaign-check 7,699, 0 failures; drive:planet 35,252. Merged: `npm run drive` 401,464 assertions, 0
failed (about 18 minutes); campaign-check 7,699, 0 failures; drive:planet 35,255 (three new), 0
failed. Every mission line, the standard-tech line, every standard-tech sides line and the tier-three
battle are main's exactly. The advanced lines moved: the Hard air battle (main side 1 at 17 minutes,
0 bombs, 4 rockets; merged 30 minutes, 1 rocket, so round 6's second air battle is counted too), the
development-lines computer (Easy, Normal and Hard averages, armed counts, the replayed lines battle
and a reported Normal stand-off), Long and Epic pace battles, the air war and naval battles, the
advanced sides battles (14/14, 20.9 to 21.2 minutes), larger maps and the engineering battle, the map
types (13/14 both; 27.4 to 26.5 minutes) and the survivors count (639 to 694). With the computer's two
formation moves switched off in a scratch copy, every summary line equals main's exactly (round 6's
own formation checks then fail, as they should, and its second air battle line is its own).
`npm run test:api` 607 passed. `npm run tours -- --quick` all eight ok; `npm run tours -- fireline
fireline-touch fireline-planet` ok (build window 45 items, 6 kept off; touch on three phone layouts).
`npm run check:loading` 27/27 for Fireline. In the browser (desktop and iPhone 13, light and dark): the
lobby shows War for the Planet and the skirmish orders; an Ashen-against-Meridian lines skirmish with
Heroes and Generals on (Kade for side 0) starts with both armies, a Wedge holds, the General's drawer
shows, the Ashen Vehicles tab lists the Raider Bike; a war starts on its map; no console errors and no
horizontal scroll. `npm run check` from the root: "All checks passed", after main's #43 (Founder's
Ledger only) was merged on top too.
### 2026-11-12: The bar row no longer covers the battle feed on a phone

**Cause.** The feed was placed at a fixed `bottom` (80px, plus the command bar's lift on a touch
screen), sized for a bar row of one line, while the row (`.fl-cbar`: heroes, the recruit-again note,
powers, the General) was absolutely placed and wraps. On a phone it wraps to two to four lines, 135
to 240px tall in the console's current look, and covered the feed's lowest lines by 65 to 168px
(iPhone 13, iPhone SE and Pixel 7 upright, the iPhone on its side; even the bare advanced setup with
only the powers and the General covered 70px). The same fault showed on a desktop: at 1440 by 900 a
four-hero row wraps and covered the feed, in a skirmish and in a mission alike. On a phone the hero
bar also ran off both edges of the map once two heroes stood, so some slots could not be reached.

**Fix.** The feed and the row now sit in one absolutely placed dock (`.fl-dock`), in flow: the feed
always rests on the row's real height. This holds in every battle type, since the mission row, the
War for the Planet battle's row and the skirmish row are all `.fl-cbar` in the same dock. The dock
keeps the console's look: on the bottom edge of the battlefield on a desktop, lifted over the
command bar on a touch screen (an inline `bottom` with `data-lifted`, which the drawers' squared or
rounded lower corners now key on, where they keyed on the row's own inline style). The row keeps a
one-line minimum, 80px on the edge and 70px lifted, where the feed sat before, so a row that fits
on one line leaves the feed exactly where it was (a planet battle at 1440 by 900 and on an iPad,
checked by bounding box against origin/main); with no row the feed keeps its 10px off the edge. On
touch and narrow screens the hero bar keeps to the row's width and scrolls sideways.

**Guard.** `scripts/tours/fireline-touch.cjs` builds three advanced skirmishes with Generals on in
the page from the game's own modules (four heroes; three and a fallen Ace; heroes off) and fails if
the feed and the row intersect, if either covers the command bar, if the row runs off the map, if
the newest feed line is above the map or the page scrolls sideways. It runs on every phone the tour
plays, plus the 320px iPhone SE in the full run. On origin/main's layout it reports 20 failures; now
one, the open item below.

**Then decided: a single Heroes button on phones.** See the next entry; the row no longer wraps on a
phone at all.

**Numbers.** In the browser (iPhone SE at 320 and 375px, iPhone 13, iPad, desktop 1440 by 900; light
and dark; an advanced skirmish with heroes and Generals on, with and without a fallen hero, a
campaign mission with four heroes and a War for the Planet battle; 40 layouts): the feed and the row
never meet, nothing covers the command bar, no sideways page scroll and no console errors; the one
failure is the 320px SE case above. `npm run tours -- fireline-touch fireline fireline-planet`
(full): fireline and fireline-planet ok, fireline-touch ok on every tour and phone but that case.
`npm run check:loading -- fireline` 27/27. `npm run check` from the root: "All checks passed" (Fireline drive 401,464 assertions, campaign-check 7,699, drive:planet 35,255).

### 2026-11-12: On a phone, one line: a Heroes button and a drawer

**Why.** The previous entry kept the feed off the bar row, but on a phone the row itself (a hero bar of
wide cards, Support, General; about 65px each) took most of the map: 240px of the 320px iPhone SE's
290px map, pushing the feed above the map and under the header, and on the 375px SE the feed lay over
the low-power banner. The decision, from the options in `fireline-improvements.md`, was a single
Heroes button.

**What.** On a phone (`layout.phone`: 760px wide or narrower, the console's own phone breakpoint, or a
touch screen on its side; tablets and desktops are untouched, checked by the bounding boxes of
seventeen elements in five battles on two desktops and three iPads against f73a908: no difference)
the bar row is one 50px line (`.fl-barstrip`): a Heroes button showing how many heroes stand, with a
red dot when one is down and a green one when an ability is ready; the support powers with short
names (Recon, Barrage, Reinforce, Missile; the full name stays in the accessible name and title, a
skirmish power without its structure reads Locked); and in a skirmish the General's star with its
health or the wait for a replacement. All four powers and the Heroes button fit at 320px, so nothing
needs a second control. The Heroes button opens the hero cards in a drawer (`#fl-hero-drawer`, a
non-modal dialog) over the map just above the strip, no taller than the dock (it scrolls) and moving
nothing; a fallen hero's recruit-again note heads it. It takes focus on opening; Close, Escape, a
touch on the map, or selecting a hero or using an ability puts it away (a targeted ability then asks
for its target on the open map) and focus returns to the button. It slides in over 160ms, not at all
with reduced motion. The hero hotkeys are unchanged. On a phone the dock runs the height of the map:
the centred banners (hint, missile warning, low power) head it in flow, the feed (three lines) and
the strip keep to its foot, so the banners and the feed take separate lanes and the feed's oldest
lines are clipped at the map's top rather than running under the header. The same strip and drawer
serve skirmishes (heroes and Generals on, a fallen hero awaiting recruitment), missions and War for
the Planet battles. No guided tour rings a hero card or an ability (the first-battle tour, the War
for the Planet tour and the build-window driver were checked), so no tour needed changing.

**Guard.** `scripts/tours/fireline-touch.cjs` now plays five battles per phone (four heroes; three
and a fallen Ace; heroes off; the "fireline" mission with four heroes and four powers; a War for the
Planet battle) on the iPhone 13 upright and on its side, the Pixel 7 and, in the full run, both
iPhone SEs (320 and 375px). It fails if the row is more than one line (more than one top among its
controls, or over 64px), if the feed meets the row, the low-power banner, the header or the command
bar, if the feed runs above the map, the row meets the command bar or leaves the map, or the page
scrolls sideways; then it opens the drawer (the map must not move, the drawer must stay on the map),
fires an ability from it (the Ace's Overdrive, checked on cooldown on reopening, or a targeted one,
which must ask for a target), closes it and checks focus is back on the button. On f73a908's layout:
63 failures over all five phones; now none.


**Numbers.** In the browser at twice the pixel density (the 320px and 375px iPhone SEs, the iPhone 13
upright and on its side, the Pixel 7, an iPad and a 1440 by 900 desktop; light and dark; a skirmish
with heroes, a General and low power, the same with a fallen Ace, the "fireline" mission with four
heroes and four powers, and a War for the Planet battle; the drawer closed and open): one line on
every phone, no console errors and no sideways page scroll. `node scripts/tours/run.mjs fireline-touch
fireline fireline-planet` (full): all ok, the 320px SE included. `npm run tours -- --quick`: all eight
ok. `npm run check:loading -- fireline` 27/27. `npm run check` from the root: "All checks passed"
(Fireline drive 401,464 assertions, campaign-check 7,699, drive:planet 35,255).

### 2026-11-12: The computer's heroes act on Hard

`fireline-improvements.md` logged that on Hard the computer's heroes rarely acted before the end.
Measured on main (d441237) over 40 Hard advanced battles with heroes on (random map, development
lines, quick pace), Hard against Hard, both seats: the Tech Centre came in only 29 of 80 sides, at
minute 15.9 on average (the commander holds it back, as an extra, until the army at home is up to
the next wave's size and the opponent's, and on Hard that rarely happens), so the Academy came at
17.0 and the first hero at about 18, in a battle lasting 20.3. And the heroes that did come mostly
waited: the Engineer, Commando and Spy only acted on a target out on its own (nothing armed near it,
no gun covering it), which a Hard base seldom offers, and a Commando below 70% health never set out
again. Of 25 Engineers recruited, 8 acted.

The fix is in the computer (`aiHeroes.ts`, and `isExtra` in `ai.ts` behind B's marker), and on Hard
only; hero prices, build times and the Academy's requirements are unchanged.

- On Hard with heroes on, the Tech Centre goes up in its turn in the plan instead of being held for
  the army (`heroesNeedTechCentre`).
- On Hard, while a wave is attacking, the Engineer, Commando and Spy go with it, three tiles behind
  its middle, and use their abilities on what it has reached (within 10 tiles of its middle): the
  Engineer captures a structure nothing armed is guarding within 5 tiles (and mends the wave's
  vehicles on the way), the Commando charges the nearest structure that is not crowded by their
  troops (at 45% health or more), the Spy slips into one without waiting for the guns to be out of
  reach, since the wave keeps them busy. Between waves they behave as before.
- Normal and Easy are untouched: their battles run long enough for heroes kept at home to act. Over
  the same 40 battles at Normal with heroes on, every battle's outcome, length and hero record is
  identical to main's (a hero acts in 20, 5.08 abilities a battle), and `drive-heroes`' eight
  computer battles at Normal and at Easy end in the same state as on main, digest for digest.

| Hard, 40 battles, both seats | before (main) | after |
|---|---|---|
| Tech Centre (sides with one; mean minute) | 29/80, 15.9 | 46/80, 13.3 |
| Command Academy | 27/80, 17.0 | 45/80, 14.6 |
| Engineer / Ace / Commando / Spy recruited (mean minute) | 17.7 / 19.0 / 19.9 / 20.8 | 15.7 / 17.0 / 17.9 / 18.8 |
| Heroes recruited that acted (E / A / C / S) | 8/25, 17/21, 8/19, 6/17 | 22/45, 32/35, 12/31, 15/29 |
| Battles in which a hero acted | 20 (50%) | 27 (68%) |
| Sides in which a hero acted | 20/80 | 36/80 |
| Abilities used per battle | 2.60 | 8.53 |
| Battle length, mean (median) | 20.3 (20.7) | 23.0 (21.4) |
| Unfinished at the 100-minute cap | 0 | 1 |

Strength, `ai-ladder.ts --heroes` (new: the switch, with `--generals`; both default off, kept beside
main's `--pace`, `--research` and `--factions`), random map, 150 seeds per match, both seats:

| | before (main) | after |
|---|---|---|
| Hard beats Normal, both ways round | 198 of 300 (66.0%, 61-71%) | 214 of 300 (71.3%, 66-76%) |
| ...Hard on side 0 / on side 1 | 73 / 125 of 150 | 85 / 129 of 150 |
| Hard beats the frozen `prev` Hard, both ways round | 153 of 300 (51.0%, 45-57%) | 151 of 300 (50.3%, 45-56%) |
| Battles unfinished at the cap, of 600 | 4 | 5 |

Hard stays above Normal with heroes on, a little further than before; against the frozen Hard it
is level, within the noise, and the seat decides almost every one of those battles either way. The
default card (no setup, heroes off) is unchanged: all 1,350 battles over 150 seeds equal main's,
battle for battle. Stalls at the cap did not rise over the ladder (4 and 5 of 600). Two stalls seen
in the 40-battle runs are the end-game kind already known: Hard seed 12 ends with both sides broke
and no haulers, Normal seed 27 (before the change was confined to Hard) with the ore gone and an
army at home that never attacks.

`drive-heroes.ts`'s computer section is back on Hard (it had moved to Normal only because heroes
seldom acted there): the first four seeds keep every original assertion, and over eight seeds the
heroes must use an ability in at least five. Harness: `npm run drive:fire` 401,465 assertions
(main 401,464; the one more is that new check), 0 failed, and every summary line equals main's
(heroes are off in every other section, and both changes do nothing unless heroes are in play on
Hard). `npm run drive:planet` 35,255, 0 failed, identical to main's (a planet battle never has
round 6's heroes). `npm run campaign:fire` 7,699, 0 failures. `npm run check`: all checks passed.
`node scripts/tours/run.mjs --quick`: all eight ok.

### 2026-11-13: Return to base, Helipad repairs, and support that holds back

The player asked for a way to send aircraft back to the Helipad, how boats and aircraft are repaired,
and for Repair Trucks to stop driving into the fighting, with a way to choose which forces go in.

- **Return to base** (`{ type: 'home', ids }`, `canHome`/`doHome` in `commands.ts`): aircraft get the
  same order an empty one gives itself (`sendHome` in `air.ts`: fly to its pad or the nearest with room,
  land, rearm, stay parked) with the waypoint queue dropped; ships sail to the open water beside their
  nearest Naval Yard (`launchTile`), where the yard's mending already works. Refused for an aircraft
  already on `rearm`, one on a bomb run (it finishes and goes home anyway), a side with no Helipad (or
  Naval Yard for a ship), and anything else. A selection-panel button after Unload, so Unload stays F.
- **Helipads repair.** Aircraft had no way to be mended at all. Landed on its pad an aircraft regains
  `HELIPAD_MEND_HP` (8) every `HELIPAD_MEND_TICKS` (10), free, the Naval Yard's rate; never in the air.
  Both sides' parked aircraft get it, so the computer's air arm comes back from a strike whole.
  The status line says Returning to its Helipad, Rearming and under repair, or Under repair.
- **Support holds back** (client, `GameScreen`'s `command`; nothing in the simulation, so the
  computer's waves are unchanged). Support is the unarmed ground units bar haulers: Medic, Engineer,
  Repair Truck, Forward Base Truck (`isSupport`, `selectionActions.ts`). Given an attack or attack-move
  alongside armed units, they get a plain move to a point 6 tiles short of the target on the line from
  the fighters' centre, or stay where they are when already that close. A squad in formation is left
  whole (its box already puts support inside). Plain moves take everyone, as before.
- **Amending the selection.** With more than one kind selected, each chip in the selection panel is a
  button: click takes that kind out of the selection, Ctrl or Cmd+click keeps only that kind.

- **Forces** (asked for mid-session: calling air cover into a battle meant finding the Helipads first).
  A sidebar section above Selection (`ForcesPanel`, `Sidebar.tsx`): one button per kind of unit side 0
  has anywhere on the map, aircraft first, haulers last, and All aircraft when more than one air kind
  flies. Click selects them all, Shift adds them, a second click on a kind that is the whole selection
  centres the camera on them.
- **Harness seed.** Repairs on the pad move whole battles: `strike-8`'s first Bomber no longer came
  before side 1 won (24 minutes, was 20), so "bombers drop bombs in real battles" read 0, 0 and 0. A
  sweep of nine fresh seeds had Bombers bombing in four (6 to 18 bombs); the test now plays `strike-7`.
- **Hashes.** `drive-size.ts` PRE_ROUND6: 7 of the 30 battles moved (lines easy both seeds, lines hard
  size-a, classic easy both seeds, classic hard size-a, three easy size-b) and were regenerated. With
  the repair block alone switched off, all 30 equal the values before exactly. No other hash moved.

- **Disband** (`{ type: 'disband', ids }`, `canDisband`/`doDisband` in `commands.ts`), asked for to clear
  units wedged where no order frees them. Takes own units off the map at once, no wreck, no refund, a
  line in the log; refused for heroes, the General and any carrier with someone aboard (they would go
  with it); anyone walking to a dismissed carrier stops. A Disband button beside Stop and the Delete
  key, both behind a confirmation. `drive-air` "Orders: disband", 10 assertions.
- **Production lines** (the player's decision, after a second Barracks turned out to be only a spare:
  extra producers should each run a queue, not build faster). Every unit queue now runs one line per
  structure that works it (`productionLines`, `lineCount`, `queueCap` in `state.ts`): the first N
  items of the category's list are worked at once, item i on the i-th producer (working ones by id,
  then any a Spy has stopped), and each comes out of its own producer. Each producer adds MAX_QUEUE
  places. Structures stay one at a time. With one producer it is exactly the old single queue: the
  engine change alone left all 30 `drive-size` battles byte-identical. The UI keeps one list per
  category; build buttons show the furthest item of their kind on any line, the queue strip says how
  many are building at once, a full queue with one producer says another adds a line, the renderer
  lights every producer at work, and the stat card says what each one adds.
- **The computer plays by it.** Its queue limits scale with its producers (`lineCount`): a vehicle a
  line where it was one, infantry one more than its lines where it was two, naval and air a line each
  where it was one at a time, its anti-air cap `queueCap` where it was MAX_QUEUE, and tier three's
  "vehicle queue at most one" now at most its vehicle lines. A line beyond the first is filled only
  with `EXTRA_LINE_RESERVE` (2,000) credits in hand (`extraLine`, `aiScale.ts`). The first attempt filled
  every line at once and broke the commander's saving, which works by taking back units not yet
  started: with both lines busy there were none, so Hard's Prototype Works came at minute 34 instead of
  27.5 and its Railgun Tanks never came ("Railgun Tanks follow" in `drive-sites`). With the reserve, the
  Works is back at 27.5 and both tier-three units are fielded. With one producer of a kind, the
  computer's choices are unchanged. Hard, the one level that builds two War Factories (its description
  promises them), is the level this moves. Never in a campaign mission (`extraLine` reads
  `s.mission`): the missions were balanced on one line, and with extra lines Last Light on Hard was no
  longer won by the scripted commander (lost at 26 minutes); with the rule, campaign-check is 7,699 of
  7,699. The player's extra producers count in missions as anywhere.
- **Checks.** `drive-air` "Production lines": 24 assertions (places and lines with one and two
  Barracks, two at once from two doors, a sabotaged line, a lost Barracks, two Helipads, structures
  still single). Every recorded battle hash is unchanged: with the reserve the commander seldom holds
  2,000 spare in those battles. In Chromium with two Barracks: ten places, the eleventh refused, and
  the strip reads "2 building at once". `npm run check`: all passed.
- **Balance, before this session's changes and after all of them** (Helipad repairs, support holding
  back, production lines), same machine, same seeds. `ladder:fire` (150 seeds, no setup): Hard beats
  Normal 201 of 300 before, 200 of 300 after; every other row identical (Normal beats Easy 300/300,
  new beats old Normal 268/300, new beats old Hard 168/300). `sweep:fire`: identical, mission by
  mission and difficulty by difficulty (Hard: hold-the-ford 7/12, blackout 5, fireline 6, iron-coast
  4, firestorm 5, last-light 5). Read plainly: the computer almost never holds 2,000 spare, so its
  second War Factory is still mostly idle. Lowering `EXTRA_LINE_RESERVE`, or reserving only while it
  saves for something, would make Hard use it; that is a difficulty decision, left open.
- **The reserve lowered to 1,000** (the player: make Hard use both factories). Measured first, Hard
  against Hard, 16 battles (8 standard, 8 advanced), while two War Factories stood: share of time
  both lines were busy, at reserve 2,000 / 1,000 / 500 / 0: 0% / 1% / 3% / 3%; at least one busy about
  20% at every value. At 500 the saving broke again (no Prototype Works in `drive-sites`' 40 minutes);
  1,000 is the lowest that keeps it (Works at minute 26.7, Stealth and Railgun Tanks fielded). The
  reason the second factory stays idle is money, not the reserve: with two factories standing, Hard
  held under 300 credits 60% of the time and under 1,000 93% of it, and its infantry queue was busy
  44% of the time to the vehicles' 21%. `ladder:fire` at 1,000: Hard beats Normal 196 of 300 (200 at
  2,000, 201 before the session): no change beyond noise. Six Hard `drive-size` battles regenerated.
  Making Hard field more from two factories needs more income or a spending mix that favours
  vehicles: a difficulty decision.

Checks: `drive-air` (Return to base, refusals, repair on the pad and not in flight) and `drive-naval`
(sailing home, mended there, refused without a yard) gained 17 assertions. In Chromium: a damaged
Gunship sent home lands, rearms and repairs from 37% to 80% in 20 seconds; a mixed attack-move sent the
tanks and riflemen to the point and the Repair Truck and Medic to 6 tiles short; the chips drop and
isolate kinds; the Forces buttons select a kind anywhere on the map and Shift adds one; no console
errors.

### 2026-11-21: Industry (phase 1 of a deeper economy)

The player asked what depth the economy could take next, with production chains and resource
logistics from the settlement-building genre woven in. Phase 1 of the plan agreed then: a three-good
production chain behind a lobby toggle. Phase 2 (a supply network that can be cut) and phase 3
(territory and workforce) are not built.

- **The toggle.** `setup.industry` (Industry, Off or On, in the lobby's customise step and the orders
  summary). Absent on every older setup, which `normaliseSetup` reads as false; both presets state
  it. Either tech level. Never in a mission or a planet battle (`industryOn`, `src/sim/industry.ts`),
  even with the flag forced onto the state.
- **Fuel Well** (2x2, 600, -15 power, needs a Refinery). Must stand with at least `FUEL_WELL_MIN_ORE`
  (1,000) ore within `FUEL_WELL_REACH` (3) tiles of its footprint; the placement refusal says so.
  Every 15 ticks it takes 3 ore from the richest tile in reach and adds 1 fuel: 40 fuel a minute
  for 120 ore, ore no hauler will bring in. Dry once its reach is worked out.
- **Foundry** (3x2, 1,200, -40 power, needs a Refinery). Every 60 ticks: 60 credits and 4 fuel into
  10 alloys, while it has both, the store has room and `FOUNDRY_RESERVE` (200) credits would be left
  after it. 100 alloys a minute for 600 credits and 40 fuel. Both structures work half as often short of power, each on its own beat (tick plus id).
- **Prices.** Vehicles and ships: 70% credits, 30% in alloys at 10 credits an alloy. Aircraft: 60%
  credits, 30% alloys, 10% fuel, and each load taken on at a Helipad burns 2 fuel (without it the
  load takes twice as long and is free). Infantry, structures, heroes, the Ore Hauler and the
  Forward Base Truck stay credits only, so a side can always rebuild its economy. `costFor` returns
  the credits part; `goodsFor` (`commands.ts`) the rest. A queue item records the goods it was
  paid with (`QueueItem.alloys`, `.fuel`) and every refund returns them: the player's cancel and
  both of the computer's take-backs (`fund` in `aiAir.ts` and `aiSites.ts`).
- **Stores.** 100 fuel plus 50 a Fuel Well; 100 alloys plus 50 a Foundry. They cap what is made,
  not what is held: a side that sells a dry well keeps its fuel. A second Foundry adds speed, not
  stock. Every side starts with 60 of each, enough for a first scout.
- **The computer** (`src/sim/aiEconomy.ts`). Its plan gains a Fuel Well and a Foundry right after
  its first War Factory, one of each at every level. No well is planned while no field near its
  structures could feed one (a well it could never place held up every structure behind it). A well goes by the field with the most ore in reach,
  less a little for distance from home, among fields within 7 tiles of its own structures. A dry
  well is sold and the plan puts another by a fresh field. The first version searched every field
  on the map, picked a rich one beside the enemy's base, was refused there every decision, and two
  commanders went 30 minutes without fuel to a stalemate. Without industry every function returns
  at once, so the commander plays exactly as before.
- **Tuning: liquidity, not stock.** The first numbers (5 ore a fuel, stores growing 100 a well and
  150 a Foundry, no reserve, two wells and two Foundries on Hard) failed in a telling way. In early
  battles both commanders sat on 490 alloys with credits near nought, about 3,000 credits of value
  smelted into stock nothing could buy. The 150-seed ladder then showed Hard in seat 0 losing 144 of
  150 to Normal: its two wells drained the home field at 400 ore a minute, so the haulers brought
  nothing in, and its two Foundries turned every credit it did earn into alloys. By minute 10 it held
  400 alloys, no income and no army. Seat 1's Hard survived on the computer seat's 25% income
  bonus, which hid the fault. The fix is in the rules, not a special case for the commander: a
  Foundry never smelts the last 200 credits, a well draws 3 ore a fuel and stores grow 50 a
  structure. That lifted seat-0 Hard to 15%; the remaining gap was Hard's second Foundry, and with
  one of each at every level Hard plays as it does without industry (the ladder below).
- **Screen.** An Industry gauge under credits and power (fuel and alloys against the stores, the
  figure green when a store is full); build buttons show `560 24A` and say "560 credits and 24
  alloys" to a screen reader; stat cards give the full price; the hover note says how many alloys
  or how much fuel is missing and which structure makes them. Art for both structures (`art.ts`): a
  pump jack that nods while it pumps, a furnace that glows and a stack that smokes while it smelts;
  the renderer marks them working by the same conditions the simulation uses. How to play has an
  Industry section, every number read from `rules.ts`.
- **Saves.** `migrateIndustry` keeps fuel and alloys only with industry on, as whole numbers of at
  least nought, on stores and queue items alike; without industry a save loads byte for byte as it
  was.
- **Checks.** `scripts/drive-industry.ts`, eight sections in `npm run drive`: the setup and where it
  never applies (every campaign mission, a planet battle), prices, queueing and refunds including a
  refused action returning the same state, placement by ore, pumping (rate, ore drawn, half rate on
  low power, the store, dry), smelting (rate, each input short, the store), four whole computer
  battles (both sides build the chain, tanks fielded, every battle decided, goods never negative or
  fractional) and replays (byte-identical twice and through a save mid-battle; junk saves
  repaired). Existing tests that list every setup field or the end of the Structures menu now name
  the new ones; the hash strippers in `drive-size.ts` and `drive-planet-battle.ts` drop
  `industry: false` as they drop round 6's fields. With industry off every recorded battle hash
  is unchanged: `npm run drive` 401,776 assertions, none failed (71 of them industry's),
  `campaign-check` 7,699 of 7,699, `drive:planet` 35,255 of 35,255, `npm run check` all passed,
  `check:ui fireline` 32 of 32.
- **Ladder** (`ai-ladder.ts` takes `--industry`; `--map random`, 150 seeds, seat 0 wins shown).
  Without industry against with it, final rules: Hard v Normal 47% / 50%; Normal v Hard 15% / 9%;
  Hard v previous Normal 52% / 59%; Normal v Easy 100% / 100%; Normal v Normal 45% / 51% (the
  last from the full card before the Hard change, which moved no Normal row). Every row within the
  ±8 points 150 seeds allows. Unfinished battles at the 100-minute cap: 1 to 3 per 150 either way,
  on mined-out maps. Easy, Normal and Hard keep their order.
- **In Chromium**: the Industry field in the customise step and the orders summary; the gauge
  (Fuel 60/100, Alloys 60/100) at 1440 light and 375 dark with no sideways scroll; the Fuel Well
  and Foundry in the build window's tree after the Academy; the Battle Tank button reading "560
  credits and 24 alloys"; no console errors.
- **Not built** in this entry: phase 2 (built next, below) and phase 3 (territory and workforce).

### 2026-11-21: Supply lines (phase 2 of the economy)

The player asked for phase 2: a supply network that can be cut.

- **The toggle.** `setup.supply` (Supply lines, in the customise step under Industry, disabled
  until Industry is on; in the orders summary when Industry is). `normaliseSetup` turns it off
  without industry; absent on older setups. Industry alone, phase 1, stays exactly as it was.
- **One change from the outline.** The outline had road tiles extending a Depot's reach. Roads would
  be a new walkable, destroyable tile layer touching occupancy, pathfinding and the renderer; a chain
  of Depots gives the same decision (extend your lines, and defend them) with none of that risk.
- **The network** (`src/sim/supply.ts`, pure geometry over the structures standing). Roots: the
  Command Yard and Field Yards. Hubs: roots and Depots. Two hubs of a side link within
  `SUPPLY_LINK_RANGE` (12 tiles, centre to centre); a hub is linked when a chain reaches it from a
  root. A Refinery, Fuel Well or Foundry is supplied within `SUPPLY_SERVE_RANGE` (8) of a linked hub.
- **Cut off.** A Refinery keeps what its haulers unload on site (`Building.held`, up to
  `REFINERY_HOLD`, 1,500; then they wait with their cargo), a Fuel Well keeps what it pumps (up to
  `WELL_HOLD`, 50; then it stops, taking no ore), and a Foundry stops. Linked again, what is held comes
  home at 50 credits or 5 fuel every 10 ticks (300 credits or 30 fuel a minute). A structure lost
  with goods on site loses them. Harvest income is counted when it is unloaded, as before. A hauler
  facing a full cut-off Refinery takes its ore to another, and when choosing where to unload a
  supplied Refinery always comes first (a cut-off one counts as 1,000 tiles further).
- **Depot** (2x2, 500, -5 power, no prerequisite). Art: crates under a mast whose beacon blinks.
- **The computer** (`depotSpot`, `aiEconomy.ts`). It places Refineries, Fuel Wells and Foundries
  only where a linked hub supplies them (`findSpot` and `wellFocus`). Before anything else in its plan, a cut-off
  producer gets a Depot: a legal spot linked to a linked hub and serving the producer, nearest it;
  when no single Depot can reach, the linked spot nearest it, one step along the chain. At most six.
  No spot, no Depot queued, so it never holds its structure queue on a placement it cannot make.
- **Screen.** Your links drawn as moving dashed lines between linked hubs; a CUT badge with what is
  held over each cut-off producer; the Industry gauge counts them ("1 cut off"); the selection panel
  says whether a producer is supplied and what it holds; placing a producer shows the serving rings
  of every linked hub, placing a Depot the linking rings, blue when the spot is in reach and amber
  when it is not. How to play has a Supply lines section, every number read from `rules.ts`.
- **Saves.** `held` kept only with supply lines on, on a Refinery or Fuel Well, as a positive whole
  number; anything else is dropped.
- **Checks.** Six more sections in `drive-industry.ts`: the setup (needs industry; never in a
  mission), the network (a chain of two Depots, cutting the first cuts everything beyond, another
  side's hubs never link yours, no yard means nothing supplied), goods held and coming home (a real
  hauler unloading at a cut-off Refinery, going to another when it is full, the flow rate exactly, a cut-off
  well filling its own tank, a cut-off Foundry idle), the computer's Depot spot, four whole battles
  (held goods only where they may be and within their caps, cut off under 5% of the time, every
  battle decided or ending in the known mined-out stalemate, which one of the four does: no ore on
  the map and no army on either side at minute 50) and
  replays and saves. The hand-kept lists of setup fields and Structures-menu endings name the new
  ones. In Chromium: the field disabled until Industry is on; a staged battle with a Yard-to-Depot
  link, a cut-off well badged "CUT 22 fuel", the gauge reading "1 cut off" and the selection note in
  amber; no console errors. The first link line and badge were too faint to read at a glance and were
  strengthened.
- **Tuning: stranded capital.** The first full ladder held the difficulty order, but the frozen
  previous Normal commander, which ignores the chain entirely, beat the new Normal 61% to 39% from
  both seats; with industry alone the new one had won about two in three. Measured over 16 battles
  against it: refineries placed toward ore stood cut off, their haulers queued at a full site with
  1,500 credits stranded, and wells sat cut off 9% of the time. A player who skipped the feature did
  better than one who used it, which would have made it pointless. The fix: producers placed only
  where supplied, and haulers rerouted from a full cut-off Refinery. After it, nothing was cut off in
  those 16 battles and the new Normal won 13. The consequence is stated plainly: the computer now
  rarely needs a Depot (none in those 16), and reconnects only what becomes cut off; pushing supply
  out to a far field is a tactic for the player, not one the computer plays.
- **Cost.** Supply lines add about 12% to simulation time (20 minutes of a battle: 3.4 s without,
  3.7 s with).
- **Ladder** (`--map random --industry --supply`, 150 seeds, seat 0 wins; then off, industry alone,
  supply lines): Hard v Normal 47% / 50% / 42%; Normal v Hard 15% / 9% / 12%; Normal v Easy 100%
  throughout; Normal v Normal 45% / 51% / 55%; new Normal v previous Normal 65% / 63% / 71%. Every
  row within the ±8 points 150 seeds allows, and the commander that uses the chain beats the one
  that ignores it. Unfinished at the cap: 0 to 4 per 150 (off: 1 to 3), all on mined-out maps.

### 2026-11-21: On a phone, the objectives keep their own lane

**Why.** On a phone the mission's objectives panel still sat where it sits on a desktop, absolute at the
map's top right, `min(270px, 46%)` wide and as tall as its rows. The bar row entries (2026-11-12) gave
the banners, the feed and the strip separate lanes in the dock, but the panel was outside the dock and
lay over them until the player tapped Hide. Measured on origin/main in the "fireline" mission: on the
iPhone 13 upright the panel ran 61..245px, over the feed (201..272) by 44px; on the 320px iPhone SE,
where 46% is 138px and every row wraps, it ran 61..279px, over the feed and the 50px strip, so its
third row could not be tapped at all; on every phone, both ways up, it covered the centre of a
targeting hint ("Reinforcements: tap the map...").

**Options weighed.** Capping its height with a measured offset would have needed a ResizeObserver on
the dock and still met the centred banners, which head the same strip of map. Opening it as the pill
on phones would only defer the overlap to the moment it is opened. Chosen: on a phone the panel heads
the dock itself, in flow (`.fl-dock[data-phone] > .fl-objectives`), above the banners, the feed and the
strip. It cannot meet any of them, because it is a flex item in the same column, and it needs no
measuring. It gives way first when room is short (flex-shrink 100), down to its header with Hide; the
rows sit in one box (`.fl-objectives-body`, a plain div elsewhere) that scrolls inside the panel, so
every row stays tappable and the header stays put. It is `min(270px, 100%)` wide instead of 46%, so a
row wraps less and the panel is shorter. The pill takes the same place. The hero drawer, positioned and
later in the dock, opens over the panel. The dock already drops below the alert chip when one shows,
and the panel goes with it. The map wrapper clips its children, so the header was never at risk.

**Numbers.** Panel boxes in the same mission (top, height): iPhone SE 320px 61, 75px (header and first
row, the rest scrolls); SE 375px 61, 130px; iPhone 13 upright 61, 128px; on its side 61, 76px; Pixel 7
61, 155px (every row, no scroll). Desktop (1440 by 900) panel box unchanged at 892, 55, 270 by 155, and
its pixels identical to origin/main's in light and dark. Tablets are not phones (`layout.phone`) and
take the desktop branch.

**Guard.** `scripts/tours/fireline-touch.cjs`, in the mission case of the bar-row check, opens the
panel and fails if it meets the feed, the strip, any banner, the header or the command bar or leaves
the map; scrolls each objective row into the panel's view and fails if a tap at it would hit anything
else; taps a ready power and repeats the box checks against its targeting hint; opens the hero drawer
and fails if the panel lies over it; then hides the panel and checks the pill the same way. On
origin/main: 14 failures over all five phones; now none.

**Checks.** Screenshots at twice the pixel density on the five phones, panel open and hidden, light and
dark, plus the desktop. `node scripts/tours/run.mjs fireline-touch fireline` (full): ok.
`npm run tours -- --quick`: all eight ok. `npm run check:loading -- fireline`: 27/27.
`npm run check:ui -- fireline`: 32/32 (its game screen is a skirmish, so the panel is not in it).
`npm run check`, before and after merging main: "All checks passed" (Fireline drive 401,690
assertions, campaign-check 7,699, drive:planet 35,255). Left open: the Menu button clipped at 320px (`fireline-improvements.md`).

### 2026-11-21: The battle header fits a 320px phone

**Why.** On a phone the battle header holds the back button, the T+ clock, Pause and Menu (and "Not
saving" when the account's saves fail). The touch sizing (40px tall, 12px either side) was an inline
style on each button, and nothing gave way when the row ran out of width. Measured on the objectives
branch, header boxes at 320px (iPhone SE): in the "fireline" mission the back button ("Campaign") ran
10..122, the clock 128..199, Pause 211..293 and Menu 299..362, so 42px of Menu lay past the edge; in a
skirmish or a War for the Planet battle ("Lobby", "Planet") Menu ended at 336 or 337, 16 or 17px off.
With the save warning showing, the mission header needed 434px: Menu was clipped by 104px on the SE,
49px on the 375px SE, 34px on the iPhone 13 and 12px on the 412px Pixel 7.

**Options weighed.** Tighter padding and gaps alone would have bought about 35px at 320, short of the
42 the mission needed and far short of the save warning's case. A shorter back label ("Back") still
left the warning case over. A compact clock (no "T+") saves 15px and loses the one cue that the
numbers are battle time. Moving the save warning into the Menu would hide a failure the player needs
to see. Chosen: below 480px the back button keeps only its arrow and Pause only its glyph (the same
pause bars and play triangle it already drew), each a 40px square; their words stay in the button as
visually hidden text, so the accessible names ("Campaign", "Lobby", "Planet", "Pause", "Resume") do
not change. Menu keeps its word, because it is the way to everything else (speed, sound, the tour, the
controls). The header's side padding goes from 10 to 8px and its gap from 6 to 4px at the same widths.
The touch sizing moved from the inline style to the stylesheet (`.fl-d-top[data-touch="1"]`, with
`.fl-d-back`, `.fl-d-pause` and a new `.fl-d-menu`), which is what lets a media query change it. 480px
is above the widest phone (430px) and the 434px the worst header needs, and below every phone on its
side, so landscape phones, tablets and desktops keep the full labels. That does change the iPhone 13
and the Pixel 7 upright, which is required: both clipped with the save warning showing. No new colours.

**Numbers.** After, at 320px: back 8..48, clock 52..124, Pause 205..245, Menu 249..312, 8px clear of
the edge; with "Not saving" (145..201) and paused, the same 8px. 375px SE: Menu 304..367; iPhone 13
upright: 319..382; Pixel 7: 341..404, and with the warning the Pixel 7's runs 237..404. The iPhone 13
on its side (750px) is unchanged (back 10..122, Menu 677..740), as is the desktop at 1440 by 900: every
header box the same, and the header's pixels identical to before in light and dark on both.

**Guard.** `scripts/tours/fireline-touch.cjs`, in every case of the bar-row check (three skirmishes, the
four-hero mission and a War for the Planet battle) on all five phones, running and again paused, fails
if a header control (button, clock or save warning) leaves the window or the header, overlaps
another, is a tap target under 40px either way or cuts off its own label, or if the page scrolls
sideways. It then loads the mission signed in to an account whose saves fail (the API answered in the
page: the battle loads, every save gets a 500), waits for "Not saving" (about 16 seconds) and checks
again, running and paused. Before the fix: 21 failures (15 on the 320px SE, 2 each on the 375px SE,
the iPhone 13 and the Pixel 7); now none. The script also exports its save builders, so a one-off
screenshot script can use them.

**Checks.** Screenshots at twice the pixel density of the header on the five phones in the mission, a
skirmish and a War for the Planet battle, light and dark, plus the desktop. `node scripts/tours/run.mjs
fireline-touch fireline` (full): ok. `npm run tours -- --quick`: all eight ok. `npm run check:ui --
fireline`: 32/32. `npm run check:loading -- fireline`: 27/27. `npm run check`: "All checks passed"
(Fireline drive 401,690 assertions, campaign-check 7,699, drive:planet 35,255).

### 2026-11-21: The objectives' buttons are a finger wide

**Why.** On a phone the objectives panel heads the dock (above), but its controls were still sized for
a mouse: Hide was 57 by 17px, each objective's Show 44 by 18px, and the hidden pill 148 by 26px (26
tall in "fireline", 28 in "The Quiet Man"), all under the 40px that `npm run check:ui` asks of a
phone's tap targets. `check:ui` never saw them, because its game screen is a skirmish and never opens
a mission.

**Options weighed.** Growing the Show chip to 40px would have made it about 55 by 40px: it would take
that width from every row's text (more wrapping, a taller panel) and still leave a finger aiming at a
chip beside the words it acts on. Hiding the rows behind the header on a small phone would hide what
the panel is for. Chosen, on a phone only (`.fl-dock[data-phone]`, and a `phone` prop that GameScreen
passes to the panel it puts in the dock): a row whose target can be shown is one button, the whole
row, at least 40px tall and the panel's width less its padding, labelled "Show on the map: ..." for
screen readers, with "Show" kept as a chip inside it as the visible cue. The text keeps the width it
had, and the target is the thing the player is reading. Rows meet with a hairline between them instead
of a 4px gap, so the 40px rows pay for most of their height out of the spacing they already had. Hide
fills the header's height at its right end, a flush segment with a rule on its left rather than a
40px box inside a taller header, so the header grows from 29 to 41px and no more. The pill gets a 40px
minimum height. To give the small phones' rows back what the header took, the panel drops its 8px
padding under the rows and the 6px over the first one (the rows carry their own), and the dock's
banners drop their 6px gap while no banner is showing (the panel's own margin still parts it from the
feed). The sizing is in the stylesheet, as with the header's touch sizing. The kit's `Button` was not
used: these are HUD controls styled from the console's tokens like the header's, and the kit would
bring the lobby's look into the battle. No new colours: the row's pressed state is
`--ui-panel-raised` and the rules are `--d-groove`, both already defined for light and dark. Desktops,
tablets (`layout.phone` is false) and the desktop branch of the panel are untouched; the iPhone 13 on
its side does change, because a touch screen under 520px tall is a phone.

**Numbers.** After, on every phone: Hide 69 by 40px, each row that can be shown 248 by 40px, the pill 148 or 203 by 40px. Panel heights, before and after, in "The Quiet Man"
(three objectives, two bonus, four of them showable once the map is explored): iPhone SE 320px 75 and
81px; 375px SE 130 and 136; iPhone 13 upright 128 and 134; on its side 76 and 82; Pixel 7 225 and 232,
where every row used to fit and the last one now scrolls by about 34px. On the 320px SE the rows had
about 28px visible before (one line of the first row and the top of its second); now 36px of the first
row's 40, both its lines and its Show cue in view. The battle feed's box is the same before and after
on every phone in both missions (SE 148..219, 375px SE 203..274, iPhone 13 201..272, on its side
149..220, Pixel 7 299..370), still three lines. Desktop (1440 by 900): every panel, button and row box
unchanged in both missions, and the panel's pixels identical to before in light and dark in
"fireline" (in "The Quiet Man" only the running clock's digits differ).

**Guard.** `scripts/tours/fireline-touch.cjs`, in the mission case on all five phones, now fails if a
button in the objectives panel or the pill is under 40px either way, open and hidden. A second
mission, "The Quiet Man" with the whole map explored, runs every objectives check again (feed, strip,
banners, header, command bar, targeting hint, hero drawer, every row tappable, the pill), requires at
least one objective that can be shown so the check cannot pass on an empty panel, and taps each one,
failing unless at least one tap moves the view (a grid of the battlefield's pixels, before and after).
Before the fix: 40 failures, eight on each phone (Hide twice, the pill twice, four Shows); now none.
With the row's handler emptied the view check fails, so it is not passing on luck.

**Checks.** Screenshots at twice the pixel density on the five phones in both missions, panel open and
hidden, light and dark, plus the desktop. `node scripts/tours/run.mjs fireline-touch
fireline` (full): ok. `npm run tours -- --quick`: all eight ok. `npm run check:ui -- fireline`: 32/32 (still
a skirmish, so the panel is not in it; the touch guard is what covers it). `npm run check:loading --
fireline`: 27/27. `npm run check`: "All checks passed" (Fireline drive 401,690 assertions, campaign-check
7,699, drive:planet 35,255). Left open: a tablet keeps the desktop's small Hide and Show
(`fireline-improvements.md`).

### 2026-11-21: Territory and workforce (phase 3 of the economy)

The player asked for phase 3 once phases 1 and 2 had merged (pull request 55).

- **The toggle.** `setup.territory` ("Territory and workforce", in the customise step under Supply
  lines, disabled until Industry and Supply lines are both on; in the orders summary when they are).
  `normaliseSetup` turns it off without supply lines; absent on older setups. Phases 1 and 2 alone
  play exactly as before. Nothing new is stored in a save: territory and crews are computed from the
  structures standing (`src/sim/territory.ts`).
- **Territory.** Command Yards (11 tiles), Field Yards (9), Watchtowers (8) and Depots (5) claim the
  ground round their centres (`CLAIM_RADIUS`). Each tile goes to the side of the nearest claim; a tie
  between sides is nobody's. A structure may be placed only where every tile of its footprint is
  yours, in place of the build radius. A Forward Base Truck still deploys anywhere (its placement
  was always `anywhere`) and claims ground round it. The grid is remembered against a key of every
  claim, so placement can ask hundreds of times a decision without recomputing it.
- **Workforce.** Command Yards house 12 workers, Field Yards 6, Quarters 8 (`HOUSING`). Refinery 3,
  Fuel Well 2, Foundry 3, War Factory 4, Barracks 2, Helipad 2, Naval Yard 3 (`CREW`) need a crew,
  assigned in that order (`CREW_ORDER`, economy first), lowest id first within a kind. Without one a
  structure stops: a producer builds nothing (the same check as a Spy's sabotage), a Fuel Well or
  Foundry does nothing, and a Refinery takes no ore (its haulers look for another).
- **New structures.** Watchtower (1x1, 450, -5 power, needs a Barracks, a light machine gun) and
  Quarters (2x2, 350, -5 power). Art: a timber tower with a team pennant and a turning gun; two rows
  of huts with team roofs and lit windows.
- **Screen.** Your borders as a dashed blue line, the enemy's in red over ground you have seen,
  allies' in green; a NO CREW badge over a structure without its crew; "Workers wanted/housed" and
  an "N no crew" chip in the Industry gauge; a crew note in the selection panel; the placement ghost
  refuses ground outside your borders with "Outside your territory". How to play has a Territory and
  workforce section, every number read from `rules.ts`.
- **The computer.** Quarters before any structure whose crew would not be housed, and at once when
  something stands without one. A Watchtower when the structure it wants has no room inside its
  borders. And, with supply lines or territory, when no field it may use is left for a Fuel Well, it
  pushes out one step toward the nearest rich field: a Watchtower when the field is outside its
  borders, a Depot when it is outside its supply (`expansionStep`, `aiEconomy.ts`). This last also
  changes phase 2 play, closing the gap phase 2's entry named (the computer never pushing its lines
  out).
- **Tuning: the opponent that would not expand, then expanded too much.** The first read found
  battles undecided far more often than usual. In them the home field had run out, no Fuel Well could
  stand inside the borders and the supply, so there was no fuel, no alloys and no vehicles, and both
  sides ground on with infantry until the map was mined out. The push-out step fixed that, then
  overspent: in one battle 7 Watchtowers and 5 Depots, about 5,600 credits, and at minute 8 the
  new commander fielded a sixth of the old one's army (the old commander, which ignores the whole
  economy, won 73%). Three limits followed: expanding is an extra that waits for the army at home,
  like the Tech Centre; at most 3 Watchtowers and 3 Depots for it; and only toward a field one step
  beyond its current claims.
- **Ladder** (`--territory`, 150 seeds, seat 0 wins; classic / supply lines / territory): Hard v
  Normal 47% / 42% / 41%; Normal v Hard 15% / 12% / 15%; new Normal v previous Normal 65% / 71% /
  49%. Supply lines alone, measured again after the push-out step: Hard v Normal 37%, Normal v Hard
  17%, new v previous Normal 61%, Normal v Normal 41%. Every row within the noise 150 seeds allow.
  Read plainly: with territory on, using the economy now breaks even against ignoring it; it no
  longer loses (25% before the limits), but it does not yet win. That is the open tuning item.
- **Checks.** `scripts/drive-territory.ts`, six sections in `npm run drive` (31 assertions): the
  setup, borders (a claim's reach, a Watchtower pushing out, the nearer claim winning, a tie being
  nobody's, ground given up when a claim falls), building inside the borders and outside, crews
  (economy first, a Barracks without one training nothing and training again once housed, a
  Refinery without one turning its hauler away), four whole battles (Quarters built, something idle
  under 10% of the time, every battle decided or mined out) and replays. The supply-lines battle test
  plays `sup-e` in place of `sup-c`: with the computer pushing its lines out, `sup-c` became two
  turtled bases neither side could break, still undecided at 100 minutes; the ladder shows such
  battles at 0 to 3 in 150, before and after. The hand-kept lists of setup fields and menu endings
  name the new ones, and the build-window tour (pull request 55) already expected them absent with
  the toggle off. `npm run check` all passed bar that seed (now passing), `check:ui fireline` 32 of
  32, the Fireline tour ok. In Chromium: a battle ten minutes in with dashed borders, a Watchtower
  and Depot out toward a field, NO CREW over a War Factory and Barracks once a Quarters was removed,
  and the gauge reading "2 no crew" and "Workers 17/12"; no console errors.
- **A cap found after the pull request opened.** Probing phase 4 showed one side with 13 Watchtowers.
  The rule that builds a Watchtower when a wanted structure has no room had no limit, and a Naval
  Yard that could find no shore (its problem, not the borders') kept asking. It now applies only to
  structures the borders limit (not a Naval Yard, Fuel Well or Depot) and stops at 4 standing. Over
  30 battles no side then held more than 3 at once; the 60-seed read moved within noise (new Normal
  v previous Normal 48%, Normal v Easy 97%); all 140 industry, supply and territory assertions pass.

### 2026-11-21: The objectives are a finger wide on a tablet too

**Why.** The phone fix (above) sized the objectives for a finger only under `.fl-dock[data-phone]`,
and a tablet is not a phone: `layout.phone` is a window 760px wide or narrower, or a touch screen
under 520px tall. So on the iPad mini, the iPad (7th generation) and the iPad Pro 11 either way up,
and the Galaxy Tab S4 on its side, a mission's panel kept the desktop's Hide (57 by 17px), each
objective's Show (44 by 18px) and a pill 26px tall in "fireline" and 28px in "The Quiet Man" (148
and 203px wide). The Galaxy Tab S4 upright is 712px wide, so it is a phone by width and already had
the phone's panel. Opening a mission on a tablet also found a second fault: the centred banners start
at the map's top, where the panel sits, and on any map under about 1000px wide a targeting hint ran
under the open panel (iPad mini upright: hint 31..469px, panel from 260), and under the pill as well
on the three upright iPads. On the desktop at 1440 by 900 the hint ends well short of the panel.

**Options weighed.** Treating tablets as phones (widening `layout.phone`) would have moved the panel
into the dock and folded the bar row into the phone's strip on screens with room for the full row.
A third set of tablet rules would have copied the phone's. Chosen: the sizing is keyed on touch, not
on the phone. `ObjectivesPanel` takes `touch` (GameScreen passes `layout.touch` to the panel it puts
at the top right) and puts `data-touch` on the panel and the pill whenever `phone || touch`, and the
phone's sizing rules moved from `.fl-dock[data-phone] ...` to `.fl-objectives[data-touch] ...` and
`.fl-objectives-pill[data-touch]`, unchanged. Placing stays where it was: the phone's panel heads the
dock, the tablet's keeps the desktop's place. `phone || touch` rather than `touch` alone because a
mouse window 760px wide or narrower is a phone too and already had the 40px controls; it keeps them.
This is the same signal as the header's touch sizing (`.fl-d-top[data-touch="1"]`), which already
applied on tablets: the back button and Pause are 40px tall on all eight. For the banners, while the
panel is open on a touch screen they keep to the lane left of it (`left: 10px`, `right:
calc(min(270px, 46%) + 20px)`, the panel's own width and inset plus a 10px gap), and while the pill
shows they drop to 60px from the top, below it; the dock is excluded, since on a phone both are in
flow. Dropping the banners below the open panel instead would have put a hint 250px down the map. No
new colours: the rules reuse `--d-groove` and `--ui-panel-raised`, defined in both modes.

**Numbers.** After, on all eight tablets: Hide 69 by 40px, each showable row 208 to 248 by 40px
(the panel's width less its padding), the pill 40px tall. Panel heights, before and after: "fireline"
155 and 162px on every tablet; "The Quiet Man" with the map explored, 256 and 254 on the iPad mini and
iPad upright (narrower panels, where the rows already wrapped), 240 and 254 on the iPad Pro 11
upright, 225 and 254 on every tablet on its side. The battle feed's box is the same before and after
on every tablet in both missions and both modes. With the recon power aimed, the hint now runs
10..250px on the iPad mini upright (panel from 260) and 104..542 on the iPad Pro 11 on its side
(panel from 646). Desktop (1440 by 900, mouse): every panel, Hide and row box unchanged in both
missions, and the panel's pixels identical to before in light and dark in "fireline" (in "The Quiet
Man" only the mission clock's digits differ, since the battle runs).

**Guard.** `scripts/tours/fireline-touch.cjs` gains a tablet check (Playwright's iPad Mini, iPad (gen
7), iPad Pro 11 and Galaxy Tab S4, each both ways up; the iPad mini upright in quick mode;
`TOUR_TABLET` runs one, or "all", alone). In both missions it runs the objectives checks the phones
run: every control in the panel and the pill 40px both ways, open and hidden; the panel and the pill
clear of the feed, the bar row and each hero and power bar in it, the banners (a targeting hint with
the panel open and again with it hidden), the header, the command bar and the alert chip; every row
tappable; and in "The Quiet Man" a tap on a showable row must move the view. It also holds the
header's touch-sized buttons at 40px. The objectives check's targeting-hint step used to look for
`[data-testid^="power-"]`, which the power bar's own `power-bar` matched first, so it tapped the bar
and never aimed a power; it now looks for a power button, on phones as on tablets. Before the fix:
66 failures, 56 tap targets (eight on each of the seven tablets that are not phones: Hide twice, the
pill twice, four Shows) and 10 hints under the panel (seven) or the pill (three); now none. With the
row's handler emptied the view check fails, so it is not passing on luck.

**Checks.** Screenshots at the devices' own density (2, or 2.25 on the Galaxy Tab S4) on the eight
tablets, both missions, panel open and a hint aimed, light and dark, plus the desktop at twice the
density, before and after. `node scripts/tours/run.mjs fireline-touch fireline` (full): ok.
`npm run tours -- --quick`: all eight ok. `npm run check:ui -- fireline`: 32/32 (a skirmish, so the panel is not in it).
`npm run check:loading -- fireline`: 27/27. `npm run check`: "All checks passed" (Fireline drive 401,690 assertions, campaign-check 7,699, drive:planet 35,255). Left open: on a touch
screen 1100px wide or more the header's full row (Controls, Motion, theme, Fullscreen) is not touch
sized (`fireline-improvements.md`).

### 2026-11-21: The battle header is a finger wide on a wide tablet

**Why.** The header's touch sizing (`.fl-d-top[data-touch="1"]`) covered the back button, Pause and
Menu, which is the whole header on a window under 1100px wide. A touch screen 1100px wide or more
gets the full desktop row instead, and of the eight tablet views two are that wide: the iPad Pro 11
on its side (1194 by 834) and the Galaxy Tab S4 on its side (1138 by 712). Measured in a mission, a
skirmish and a War for the Planet battle on both: the speed buttons, Sound and Tour already took the
40px touch size inline, but the Controls button was 26 by 26px, Motion, the theme switch and
Fullscreen 72, 72 and 69 by 26px, and the volume slider 64 (52 on the Galaxy Tab S4) by 16px. In a
skirmish on the Galaxy Tab S4 the row needed about 1149px, so Fullscreen ran 1070..1139, 1px off
the window and 11px past the header's padding. The two pairs of overlapping buttons the earlier
check reported are Slow and Normal, and Normal and Fast: the speed strip (`.fl-d-seg`) joins its
buttons with `margin-left: -1px` so neighbours share one border, a 1px seam that is meant. The
other six tablet views (both iPads under 1100px either way up, the two upright) show the compact
header and were already sound.

**Options weighed.** Growing every control in place adds 14px to Controls and 14px to each of the
three display buttons, about 56px, onto a row that already overflowed at 1138 and has 38px less at
1100. Compact labels or glyphs for Sound and the speeds would save the width but make the most used
controls harder to read. Treating every touch screen as compact (back, clock, Pause, Menu) is one
line in `layout.ts`, but it takes the speeds and Sound out of reach on the two tablets with room for
them. Chosen: on a touch screen the full row's display group (motion, light or dark, fullscreen),
set once and rarely touched, gives way to the same Menu button the compact header has, and the
Menu sheet shows only what the row lacks: the battle's name and sides, the display settings and
Close (speed, sound, the save state, Tour and Controls stay in the row). The Controls button
becomes a 40px square and the slider 40px tall, in the stylesheet beside the existing touch rules.
The Menu's display buttons were 26px tall on every touch screen, phones included; since the Menu is
now their only place on a wide tablet, they take a 40px minimum height whenever `layout.touch` is
set, which also lifts them on phones and the narrower tablets (the phone header is unchanged).
Mouse windows are untouched: every change is keyed on `layout.touch` or `data-touch="1"`. No new
colours.

**Numbers.** After, in a skirmish on the Galaxy Tab S4 on its side: speeds 496..679, Pause 682..764,
Sound 776..880, slider 888..940 (52 by 40), Tour 958..1013, Controls 1016..1056 (40 by 40), Menu
1065..1128, 10px clear of the edge, with 124px of slack beside the clock. On a 1100 by 800
touch window, the narrowest full row there can be, the skirmish's Menu runs 1027..1090. iPad Pro 11
on its side, mission: Controls 1069..1109, Menu 1121..1184. The header grows from 59 to 63px on the
iPad Pro 11 and 57 to 61px on the Galaxy Tab S4, both on their sides. Menu on those two: Light or
Dark mode 78 by 40, Motion 78 by 40, Fullscreen 75 by 40, Close 65 by 40. Desktop (1440 by 900,
mouse): every header box unchanged in all three battle types, and the header's pixels byte-identical
to before in light and dark. The six compact tablet views' headers are unchanged too (the only
differing pixels are the clock's digits and the live map under the header's bottom edge).

**Guard.** `scripts/tours/fireline-touch.cjs`: the tablet check's header test (it held back, Pause
and Menu only) is replaced by the phones' full one, which now also takes sliders, on all eight tablet
views in both missions, a skirmish and a War for the Planet battle, running and paused: every button
and slider 40px both ways, inside the header and the window, none overlapping, no sideways scroll.
The one overlap allowed is two buttons of the same `.fl-d-seg` strip meeting by 1.5px or less. In
the skirmish and the planet battle it then opens the Menu and fails unless motion, theme and
fullscreen are there, every button in it is 40px both ways, the theme switch flips the page's theme
and Close shuts it. Before the fix: 121 failures (80 header tap targets and Fullscreen off the
window on the two wide tablets, 4 for no Menu button on them, and 36 Menu display buttons 26px tall
on the other six); now none. The phones' checks still pass.

**Checks.** Screenshots of the header on all eight tablet views in the three battle types, light and
dark, the open Menu on each, plus the desktop at twice the density, before and after.
`node scripts/tours/run.mjs fireline-touch fireline` (full): ok. `npm run tours -- --quick`: all
eight ok. `npm run check:ui -- fireline`: 32/32. `npm run check:loading -- fireline`: 27/27.
`npm run check`: "All checks passed" (Fireline drive 401,690 assertions, campaign-check 7,699,
drive:planet 35,255). Left open: the
Menu's volume slider on a phone or a narrower tablet is 110 by 16px (`fireline-improvements.md`).

### 2026-11-22: The Menu's volume slider is a finger wide

**Why.** The wide-tablet change (above) made the header's volume slider 40px tall on touch, but on a
phone and on a tablet under 1100px wide the slider lives in the Menu sheet instead, and there it was
still the browser's own: 110 by 16px on all five phones and the six narrower tablet views, under the
40px tap-target minimum. A taller box alone would not have been enough either: the browser's slider
keeps its 16px thumb at any height, and that thumb is what a finger has to find and hold. Nothing else
in the Menu was short: the speed buttons, Sound, the display buttons, Tour, Controls and Close are all
40px tall on touch already, the Sound button (the mute) among them.

**Options weighed.** Making the slider 40px tall in the Menu with one rule, as in the header, fixes the
target and leaves the 16px thumb. Swapping the slider for minus and plus buttons is a finger's size
but loses the drag and the at-a-glance level, and the keyboard and screen reader would meet a new
control. Chosen: on touch the Menu carries `data-touch`, like the header, and one set of rules
(`.fl-d-top[data-touch="1"] .fl-d-range` and `.fl-d-sheet[data-touch="1"] .fl-d-range`) gives both
sliders a 40px box and draws them: a 6px track and a 24px thumb ringed in the panel colour, with the
track's filled part following the volume through a `--vol` custom property set inline. The fill runs
to `12px + vol * (100% - 24px)`, which is the thumb's centre, so the two meet at every value. Muted,
the slider is disabled as before and greys out. It is still an `<input type="range">` with its
"Volume" name, 0.05 steps and the browser's own keys and focus ring, so the keyboard and screen reader
see nothing new. The header's touch slider goes from 52px (64 above 1179px) to 72px, so the bigger
thumb keeps 48px of travel. A mouse keeps the browser's slider untouched: every rule is keyed on
`data-touch="1"` and `--vol` is only set on touch. No new colours: the track, fill, ring and shadow
are `--ui-rule-strong`, `--ui-accent`, `--ui-panel` and `--ui-shadow`, and disabled `--ui-rule` and
`--ui-rule-strong`, all defined in both modes.

**Numbers.** Menu slider, before and after, in a skirmish: iPhone SE 320px 110 by 16 at 135..245,
166..182, now 110 by 40 at 133..243, 154..194; the 375px SE, the iPhone 13 and the Pixel 7 upright and
the iPhone 13 on its side, the iPad mini, the iPad (7th generation) on its side and the Galaxy Tab S4
upright, 110 by 16 at 143..159, now 110 by 40 at 131..171. The slider's centre stays on the Sound
button's, the row was already 40px tall for that button, and the Menu is the same height. On the full
row, Galaxy Tab S4 on its side, skirmish: slider 888..940 (52 by 40), now 870..942 (72 by 40), the
speeds from 496 to 480 and Menu still at 1065..1128; iPad Pro 11 on its side: 925..989 (64 by 40), now
919..991, Menu still 1121..1184. Mouse at 1440 by 900 and at 1000 by 800 (where the Menu sheet holds
the slider): the header's sound controls byte-identical to before in light and dark, and the open
Menu's pixels identical apart from 45 at its rounded corners, where the live map shows through.

**Guard.** `scripts/tours/fireline-touch.cjs`: the Menu check (`displayInReach`) now measures every
button and slider in the open Menu, and runs on the phones too: a skirmish, the mission and a War for
the Planet battle on all five phones, and both missions' Menu besides a skirmish and a planet battle on
all eight tablet views. It then works the volume slider (the Menu's, or the header's on the two
tablets with the full row): a tap near its left end must lower the volume, a one-finger drag to its
right end must raise it past 0.8, and ArrowLeft must step it down by 0.05, each read from the slider
and from the stored sound settings, so a slider that moves without reaching the sound engine fails.
Before the fix: 33 failures, every one the Menu's Volume a 110x16 tap target (three on each of the
five phones, three on each of the six narrower tablet views); now none.

**Checks.** Screenshots of the open Menu on the five phones, the iPad mini, the iPad (7th generation)
on its side and the Galaxy Tab S4 upright, light and dark, muted on the iPhone 13, the full row's header
on the two wide tablets, plus the desktop at 1440 and at 1000 wide, before and after.
`node scripts/tours/run.mjs fireline-touch fireline` (full): ok. `npm run tours -- --quick`: all eight ok.
`npm run check:ui -- fireline`: 32/32. `npm run check:loading -- fireline`: 27/27. `npm run check`: "All
checks passed" (Fireline drive 401,825 assertions, campaign-check 7,699, drive:planet 35,255).

### 2026-11-22: Vast maps, with ravines and ruined cities

The player asked for maps four times larger, with more detail and more complications: ravines and
destroyed cities. Read as four times the ground of the largest size: a fourth size, **Vast**, twice
as wide as Huge (256, 288 and 320 tiles for two, three and four sides; `MAP_TILES_MAX` 320). Standard,
large and huge are untouched, map for map: the hazards are gated on `sizeHasHazards`, which is Vast
only, so nothing round 5 balanced moves.

**The new ground** (`src/sim/hazards.ts`, laid by both generators through their symmetric brush):
- *Ravines* (`'v'`): winding gorges two to four tiles wide, impassable to ground units and ships,
  flown over. Laid after the tracks: a ravine crossing a track turns it into a bridge (`'b'`), a
  ravine that would run along a track is cut short there, and each ravine is bridged every 22 tiles.
  A final pass (`settleBridges`) turns any bridge group with no ravine beside it back into dirt (a
  track grazing a ravine's edge, or a third-of-a-turn rounding a bridge apart). Bridges are walkable
  but nothing is built on them ("Cannot build on a bridge"). In wedge maps ravines keep to one side of
  the wedge's own axis, or each one and its mirror crossed into an X.
- *Ruined cities*: a street grid (`'p'`, walkable and buildable) between blocks of rubble and gutted
  buildings (`'x'`, impassable), with collapsed squares inside and a ragged edge. Laid before the
  type's features and the tracks, so a track through a city runs down a street (`carveTile`) and a
  river or a canyon wall still has its way. Three cities a half on two-sided maps (radius 13 to 20),
  two a wedge on three and four. Plus ruined hamlets, a gutted farmstead on a paved yard.
- Kept clear of every base's clearing, the contested centre and the home field. Ore only on grass
  and dirt. More ore to match the ground: four flank pairs and six expansions on two sides
  (`MAX_ORE_FIELDS_VAST` 44), two expansions and a third border field per wedge on three and four.
- Over 42 maps (every type and side count, two seeds): ravine 2.1%, bridge 0.34%, ruins 1.5%,
  streets 4.5% of all tiles. Every draft passed the generator's own checks first time on 8 seeds of
  every type and side count (two sides 63 to 90 ms a draft, four sides 109 to 124 ms).

**The walkable set** gains `'p'` and `'b'` in two places that must agree: `isWalkable` (`map.ts`) and
`walkCode` (`grid.ts`, by character code).

**Saves** (`src/sim/pack.ts`). A four-sided vast battle's save is 420 KB before a unit is built (the
ground, the ore and the explored map are each 102,400 entries), against the portal's 512 KB limit.
Battles wider than the balanced sizes (`MAP_TILES_MAX_BALANCED`, 160) save those three fields as run
lengths: 40 to 80 KB at the start, 59 KB ten minutes in. `migrateState` unpacks before anything reads
the state, refuses a packed save that does not unpack to its own map, and every save a build before
vast maps could make stays byte-identical (huge is never packed). Packed on both write paths (local
storage and the cloud saver) and on the server's create.

**Terrain** (src/game). Painted at full resolution a 320-tile map is a 10,240 px canvas and Scars keeps
a pristine copy: about 840 MB. Maps wider than 160 tiles paint at half resolution (`terrainScale`), so
the largest canvas is 5,120 px, as huge already was; Scars and Water draw in world pixels through the
canvas transform and scale their source rectangles by hand, and the renderer scales its blit. Standard,
large and huge hash pixel-identical to before on five real maps. Ravines paint as a gorge (a lit south
lip, a streaked north wall, a dark floor with fallen stone), bridges as one span per group (abutments,
planks, girders, rails), ruins in three styles (concrete, brick, sandstone) with a standing shell or two
casting a shadow, streets as cracked asphalt with craters, burnt-out cars and faded markings. Checked on
a revealed vast battle in Chromium: a city and a bridged ravine, no page errors.

**The computer's numbers** (`aiScale.ts`). Linear growth with width would have put Normal's first attack
five and a half times later than standard on a vast two-sided map and given every side 24 more turrets.
Beyond huge's scale each number now grows at half the rate (`VAST_SCALE_RATE`): two sides play at
scale 3 rather than 4, four sides at 2.5 rather than 3.33. Large and huge are below the knee and
unchanged.

**Tick time** (`perf-fire.ts`, minutes 20 to 30). Vast, four sides, before the damping and two exact
optimisations: median 7.36 ms, p99 23.95 ms, 491 units on the field. The damping (363 units), then
target acquisition testing the square round its range before anything else (filters reordered only,
so the pick is the same), then the walkable mask worked out once per map and copied for each
occupancy grid: median 4.33 ms, p99 17.36 ms, worst 81.8 ms. Vast two sides: median 1.58 ms, p99
15.45 ms. Huge four sides for comparison: median 2.66 ms, p99 9.79 ms. Four-sided vast is still a
little over the 4 ms median the round 5 log aimed for; the p99 is inside its 25 ms.

**Whole battles**, Normal against Normal, advanced tech, map by seed (harness cap 162,000 ticks, 270
minutes). Two sides, six seeds: 32.6, 33.4, 34.9, 60.2 and 62.2 minutes, and one Coast battle
unfinished at the cap. Every side harvested in all of them. Four sides as teams, two seeds: 49.2 and
50.2 minutes. The unfinished one is a stalemate between the two computers across Coast's causeways:
over a thousand kills each by minute 120, with side 0 holding 300,000 credits it never spends. That is
the computer's existing limit, not the new ground, and it is not tuned here; a person breaks it. The
lobby says "30 to 60 minutes or more".

**Harness.** `scripts/drive-vast.ts`, inside `npm run drive:fire` (about 40 seconds, 382 assertions):
the size and its rules; 42 vast maps through the generator's checks, every tile a known ground, ore
only on grass and dirt, every bridge spanning a ravine and joining ground, nothing laid by a base, the
same seed the same map; the balanced sizes free of the new ground; streets and bridges passable,
ravines and ruins not, no ship on any of them, nothing built on a bridge, a unit walking across a
ravine by its bridge and a path across a 320-tile map; packing round trips, junk refused, huge never
packed; the damped numbers; a vast battle replayed byte-identically for ten minutes, its packed save
under the limit and playing on exactly, and units seen walking the streets or bridges with none
standing in a ravine or a ruin. The harness caps in `drive.ts`, `drive-maps.ts` and `long-games.ts`
gain vast at 162,000 ticks.

**Checks.** `npm run check`: all passed (Fireline drive 402,276 assertions, campaign-check 7,699,
drive:planet 35,255). `npm run check:ui -- fireline`: 32/32. The size picker at 375 px: four options
on one row, no sideways scroll.

### 2026-11-22: The ground is held in chunks

The ground was painted once per battle onto one canvas, and the battle marks kept a second copy of
it, so memory grew with the map's area: a Huge map 200 MB, and a Vast map at full resolution would
have been 800 MB, which is why Vast shipped at half resolution. Huge's 5,120-pixel canvas is also
past the canvas size iPhone Safari is commonly reported to refuse (not tested on a device here).

**Now** (`src/game/terrainStore.ts`), on every map size: the ground is 512-pixel chunks, painted near
the camera by a worker that lives for the battle (visible chunks first, two in flight), the furthest
dropped once the ground held passes 96 MB and painted again when the camera returns. Until a chunk
arrives the minimap's colours stand in for it. Each chunk's canvas reaches 2 pixels into its
neighbours and is drawn a pixel past its edge, so no seam can show under zoom (Chrome shows none
even without it; the overlap is for browsers that soften image edges). Vast is back at full
resolution, and `terrainScale` is gone.

**The painter** (`createTerrainPainter`, `terrain.ts`) works out everything that depends on the whole
map once (the shading fields, noise, grass patches and zones, relief, groups of ruins and bridges)
and paints any region: per-tile decoration from the tiles within 3 of the region, streams and groups
filtered by where they reach, the per-pixel passes over the region's pixels only. A whole-map paint
is byte-identical to before on six real maps (standard, large and huge). Chunks laid side by side
are within a few levels of the whole: Chrome's antialiased circle and path edges shift by a level or
two when the same drawing is moved by whole pixels (gradients, stretched images and the blade blocks
do not), so about 0.02% to 0.13% of pixels differ by more than 2 levels and the worst single pixel by
23. Exact equality across chunks cannot be had in this browser; nothing is missing or misplaced.

**Marks and water.** `Scars` draws fading marks into the loaded chunks (`paintLive`) and fades them
back from a clean copy each chunk keeps only once marked (`restore`); it now tracks only the marked
squares, so fading no longer slows on bigger maps. Rubble and craters are permanent marks with their
own seed (`permanent`, drawn with the seeded `rand`, not `Math.random`), replayed into a chunk painted
again. `Water` redraws its tiles from the clean copy a chunk with animated water keeps from the start.

**Measured** (Chromium, 1440 by 900, panning the whole map for fifteen seconds): ground held at most
32 MB on standard (as before), 96 MB on Huge four sides (200 MB before), 97 MB on Vast four sides at
full resolution (200 MB before at half). `perf-render.cjs`, minute 25, four sides, before and after
on the same battle: Huge, frame work median 4.0 to 1.3 ms, p99 14.6 to 11.2 ms; Vast (half to full
resolution), median 4.1 to 1.6 ms, p99 14.6 to 14.0 ms, though the 95th percentile gap between frames
while panning flat out rose from 21.9 to 24.2 ms (newly painted chunks being installed).

**Checks.** `scripts/terrain-check.cjs` (new, Playwright, not in `npm run check`): chunks against the
whole on three maps and a 2,048-pixel square of a Vast city; no seams under a fractional zoom over
magenta (and a deliberate one-pixel gap is seen, so the test can see one); a chunk dropped and painted
again comes back the same with its permanent mark and without its fading one; water animates and never
builds up; Vast four sides opens and pans with the worker and with no Worker at all, held under budget,
no page errors: 22/22. `npm run check`: all passed. `npm run check:ui -- fireline`: 32/32. Fireline
tour: ok.

### 2026-11-22: The computer spends what it banks (the Coast stalemate)

The vast maps entry recorded one Coast battle unfinished at the 270-minute cap. The cause was not
the ground: both commanders had one barracks and one factory (the build plan stops at the
difficulty's factories, one on Normal), side 0 had harvested 579,000 credits to side 1's 333,000,
and it held 247,000 of them unspent at minute 60. A 74% income lead bought nothing, so equal armies
met at the causeways for four and a half hours.

**The rule** (`aiScale.ts`, `surplusOn`): on a map larger than standard, never in a mission, a
commander holding SURPLUS_CREDITS (6,000) or more appends to its build plan up to SURPLUS_FACTORIES
(2) more factories and SURPLUS_BARRACKS (1) more barracks. Standard maps are untouched.

**Measured.** Vast Coast, two sides, eight seeds, old code against new: old, every battle finished
but ran 39.6 to 109.1 minutes, with the winner or loser holding 40,000 to 184,000 credits in five of
the eight (one side lost while holding 184,000); new, all eight finished in 39.6 to 74.9 minutes with
no side holding more than 2,061. The battle that stalled (seed v-2) now ends at 62.4 minutes.
`ladder:fire --map random --size large`, 150 seeds: the new code's card (Hard beats Normal 73.0%,
Normal beats Easy 97.7%, the mirror 47/53, nothing unfinished) is identical, battle for battle, to the
old code's on the same five matches. Large battles end before anyone banks 6,000 credits, so the rule
never fires there. Huge was not laddered; it sits between the two.

**Harness** (`drive-vast.ts`, "Larger maps: surplus production"): off on standard maps however rich,
off in missions, on from exactly 6,000; a commander handed 60,000 credits on a large map builds past
its plan's factories and within the cap, and on a standard map keeps its one.
