# Fireline — improvement plan

Written after the first playable build shipped (PR #12, live on the portal). Ordered by how much each item changes what
a player sees and feels in the first ten minutes. Each item names its owner workstream; the first
round is being built by five parallel agents, one per workstream, each owning its own files.

Status key: [ ] not started, [~] in progress, [x] done.

## A. Battlefield effects (renderer)

- [~] Persistent battle scars: tank tread marks on dirt and grass that fade over a minute; burnt-out
  vehicle wrecks that smoulder and fade; fallen infantry that fade.
- [~] Bigger, better explosions: shockwave ring, flying debris with gravity and bounce, a fireball
  that blooms then rolls into a rising smoke column, a brief light flash on the ground.
- [~] Muzzle light: each shot briefly lights the ground around the gun.
- [~] Living water: animated shimmer and moving foam along shorelines.
- [~] Atmosphere: a soft vignette, drifting cloud shadows across the map, dust from moving vehicles.
- [~] Structure destruction: a structure collapses into a rubble footprint that stays.
- [~] Order feedback: waypoint lines for selected units heading somewhere.

## B. Unit and structure art

- [~] Richer vehicles: panel lines, hatches, antennae, exhaust, turret detail, team decals.
- [~] Infantry that read at a glance: clearer silhouettes, firing pose, a muzzle on the weapon.
- [~] Structures with life: blinking lights, working machinery, smoke from chimneys, a hauler-dock
  arm on the refinery, a vehicle bay door that opens when a unit rolls out.
- [~] Damage states drawn on the structures themselves: scorch, holes, sparks below half health.
- [~] Richer terrain: cliff-like edges on rock, flowers and grass tufts, sand banks.

## C. Gameplay (simulation)

- [~] Veterancy: units promote at kill thresholds (more damage, faster fire, self-repair at elite),
  chevrons shown on the unit.
- [~] Waypoint queues: shift with an order appends instead of replacing.
- [~] Unit stances: aggressive (chase), guard (default), hold fire.
- [~] Infantry survivors run out of a destroyed or sold structure.
- [~] Scout and harass AI hooks the opponent can use (see D).

## D. Computer opponent

- [~] Raids its opponent's haulers with fast units.
- [~] Pulls badly damaged units back to base to repair.
- [~] Picks targets by threat and value (artillery and haulers first, then turrets).
- [~] Rebuilds lost economy first (refinery, hauler) and replaces lost generators before power runs short.
- [~] Difficulty stays monotonic and measured: Hard beats Normal beats Easy over 150+ seeds.

## E. Interface

- [~] Build hotkeys (Q W E R T Y for the current tab's items) and shift-click to queue five.
- [~] Combat alerts: a ping on the minimap where something is attacked; Space jumps to the last alert.
- [~] Credits that count up and down rather than jump; low-funds and low-power warnings.
- [~] Group badges: a small number on units in a control group.
- [~] Unit and structure tooltips with real numbers (damage, range, speed, armour).
- [~] Stance and veterancy shown in the selection panel (with C).

## Later rounds

- Campaign: a handful of scripted missions with objectives and briefings.
- Skirmish options: two computer opponents, starting credits, map size.
- Touch controls (tap to select, tap-and-hold for orders).
- Ambient music bed.
- A scripted "human player" in the harness so balance can be measured without hand play.
- Engineers that capture structures; walls and sandbags.
