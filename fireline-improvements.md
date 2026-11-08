# Fireline — improvement plan

Written after the first playable build shipped (PR #12, live on the portal). Ordered by how much each item changes what
a player sees and feels in the first ten minutes. Each item names its owner workstream; the first
round is being built by five parallel agents, one per workstream, each owning its own files.

Status key: [ ] not started, [~] in progress, [x] done.

Round 1 (2026-11-08): workstreams A, B, C and E built and integrated; D (computer opponent) re-running after it hit a usage limit.

## A. Battlefield effects (renderer)

- [x] Persistent battle scars: tank tread marks on dirt and grass that fade over a minute; burnt-out
  vehicle wrecks that smoulder and fade; fallen infantry that fade.
- [x] Bigger, better explosions: shockwave ring, flying debris with gravity and bounce, a fireball
  that blooms then rolls into a rising smoke column, a brief light flash on the ground.
- [x] Muzzle light: each shot briefly lights the ground around the gun.
- [x] Living water: animated shimmer and moving foam along shorelines.
- [x] Atmosphere: a soft vignette, drifting cloud shadows across the map, dust from moving vehicles.
- [x] Structure destruction: a structure collapses into a rubble footprint that stays.
- [x] Order feedback: waypoint lines for selected units heading somewhere.

## B. Unit and structure art

- [x] Richer vehicles: panel lines, hatches, antennae, exhaust, turret detail, team decals.
- [x] Infantry that read at a glance: clearer silhouettes, firing pose, a muzzle on the weapon.
- [x] Structures with life: blinking lights, working machinery, smoke from chimneys, a hauler-dock
  arm on the refinery, a vehicle bay door that opens when a unit rolls out.
- [x] Damage states drawn on the structures themselves: scorch, holes, sparks below half health.
- [x] Richer terrain: cliff-like edges on rock, flowers and grass tufts, sand banks.

## C. Gameplay (simulation)

- [x] Veterancy: units promote at kill thresholds (more damage, faster fire, self-repair at elite),
  chevrons shown on the unit.
- [x] Waypoint queues: shift with an order appends instead of replacing.
- [x] Unit stances: aggressive (chase), guard (default), hold fire.
- [x] Infantry survivors run out of a destroyed or sold structure.
- [~] The opponent using stances and waypoints itself (with D).

## D. Computer opponent

- [~] Raids its opponent's haulers with fast units.
- [~] Pulls badly damaged units back to base to repair.
- [~] Picks targets by threat and value (artillery and haulers first, then turrets).
- [~] Rebuilds lost economy first (refinery, hauler) and replaces lost generators before power runs short.
- [~] Difficulty stays monotonic and measured: Hard beats Normal beats Easy over 150+ seeds.

## E. Interface

- [x] Build hotkeys (Q W E R T Y for the current tab's items) and shift-click to queue five.
- [x] Combat alerts: a ping on the minimap where something is attacked; Space jumps to the last alert.
- [x] Credits that count up and down rather than jump; low-funds and low-power warnings.
- [x] Group badges: a small number on units in a control group.
- [x] Unit and structure tooltips with real numbers (damage, range, speed, armour).
- [x] Stance and veterancy shown in the selection panel (with C).

## F. Campaign, Commander career and heroes (round 2)

Spec and code contract: `fireline-campaign-design.md`. Four builders in parallel, then the
mission AI once the round-1 opponent work lands.

- [~] Eight-mission campaign with briefings, objectives, bonus stars, debriefs and a theatre map.
- [~] Commander ranks (Lieutenant to General), skill points and a three-branch skill tree.
- [~] Four heroes who level up and carry over: Spy (stealth, infiltration), Commando (demolition),
  Engineer (capture, field repair), Ace (prototype tank, overdrive).
- [~] Support powers: recon sweep, artillery barrage, reinforcements.
- [ ] Mission AI modes: defend, raid, passive.

## Later rounds

- Skirmish options: two computer opponents, starting credits, map size.
- Touch controls (tap to select, tap-and-hold for orders).
- Ambient music bed.
- A scripted "human player" in the harness so balance can be measured without hand play.
- Engineers that capture structures; walls and sandbags.
