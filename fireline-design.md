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
