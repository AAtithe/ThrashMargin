# Fireline — improvement plan

Written after the first playable build shipped (PR #12, live on the portal). Ordered by how much each item changes what
a player sees and feels in the first ten minutes. Each item names its owner workstream; the first
round is being built by five parallel agents, one per workstream, each owning its own files.

Status key: [ ] not started, [~] in progress, [x] done.

Round 1 (2026-11-08): all five workstreams built and integrated. Round 2 (campaign): built and integrated.
Round 3 (freeplay depth, 2026-11-09): built and integrated. Round 4: foundation in, three workstreams under way.

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
- [ ] The opponent using stances and waypoints itself.

## D. Computer opponent

- [x] Raids its opponent's haulers with fast units.
- [x] Pulls badly damaged units back to base to repair.
- [x] Picks targets by threat and value (artillery and haulers first, then turrets).
- [x] Rebuilds lost economy first (refinery, hauler) and replaces lost generators before power runs short.
- [x] Difficulty stays monotonic and measured: Hard beats Normal beats Easy over 150+ seeds.

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

- [x] Eight-mission campaign with briefings, objectives, bonus stars, debriefs and a theatre map.
- [x] Commander ranks (Lieutenant to General), skill points and a three-branch skill tree.
- [x] Four heroes who level up and carry over: Spy (stealth, infiltration), Commando (demolition),
  Engineer (capture, field repair), Ace (prototype tank, overdrive).
- [x] Support powers: recon sweep, artillery barrage, reinforcements.
- [x] Mission AI modes: defend, raid, passive.

## G. Freeplay depth (round 3)

- [x] Random generated maps: six types (classic, river, highlands, lakes, plains, canyon), point-symmetric.
- [x] Advanced tech: Tech Centre, Repair Bay, Sandbag Wall, Rocket Turret, Strike Command; Grenadier,
  Medic, Flame Tank, Missile Carrier, Bastion.
- [x] Skirmish powers from structures: recon (uplink), barrage (Tech Centre), missile (Strike Command).
- [x] Lobby setup (map, tech, credits, ore), validated on the server; saves list shows the map.
- [x] Both commanders build and use the new tech.

## H. Round 4 (contract: `fireline-round4-design.md`)

- [x] Foundation: 2, 3 or 4 sides on teams, map size per battle, side colours (two-sided play unchanged).
- [x] A. Air power and research: Helipad, Flak Cannon, Research Lab; Gunship, Bomber, Flak Track, Skyhunter; five upgrades.
  - [x] Aircraft fly straight over anything, carry ammunition and rearm at their Helipad (two per pad); a Bomber's run is a line of six bombs.
  - [x] Only bullets (at about a third) and anti-air reach the air; anti-air never fires at the ground; splash keeps to its own layer.
  - [x] Research: refining, plating, engines, calibration, air frames, paid in full, refunded on cancel, half speed on low power.
  - [x] The computer: a Lab and Helipads once its base stands, gunship and bomber strikes, research by difficulty, anti-air only against aircraft.
  - [x] Air tab, Research block, hotkeys B N D for the longer Structures list, aircraft art with shadows, rotor and contrails.
  - [ ] Aircraft are not mended anywhere (no pad repair); a damaged gunship stays damaged.
- [x] B. Bigger battles: 3 and 4 sides, free for all or teams, fair maps, several-enemy commanders.
  - [x] Seat fairness measured: 4 sides free for all within two standard errors over 120 seeds.
  - [x] Two against one balanced by the lone side's starting credits (48% for the pair over 60 seeds).
  - [ ] Side 3 is out first more often than the others in a free for all (38 of 120, against 30 expected).
  - [ ] The camera opens on side 0's base only; nothing yet points at where the allies are.
- [x] C. Campaign act two: missions 9 to 14, escort and timed objectives, a second theatre map.
  - [x] Objectives escort, destroyWithin and holdZone with reset; structure powers in a mission.
  - [x] Both acts on the campaign screen; act two's northern theatre.
  - [x] A no-base mission opens on the player's units (the opening camera looked only for a Command Yard).
  - [x] Air in missions 11, 12 and 14 (integration).

## I. Round 5 (contract: `fireline-round5-design.md`)

- [x] Contract and groundwork: one menu table, extra producers, map size and sites in the setup, neutral sites in the state, selection commands (no change in play).
- [ ] A. The build window: the build lists in a pop-out tech tree, opened by a Build button or the backquote key.
- [ ] B. Larger maps and long games: large and huge maps, ore that spreads back, the computer scaled for distance, performance at 160 tiles.
- [ ] C. Engineering vehicles: Repair Truck, Forward Base Truck and Field Yard; the computer expands on large maps.
- [x] D. Neutral sites and tier three: Oil Derricks, Field Hospitals, Comms Relays; Prototype Works, Fortress, Railgun Tank, Stealth Tank.
  - [x] Sites placed by the map's own symmetry, captured by infantry, never a target or a structure; a lobby switch.
  - [x] Stealth: unseen and untargetable beyond 2.5 tiles except for 3 seconds after firing, for the computer too.
  - [x] The computer takes sites with small infantry parties and turns to tier three after 25 minutes.
  - [ ] The minimap still draws an enemy Stealth Tank in sight (and an enemy Spy): one condition in B's units loop.
  - [ ] An attack order given straight to a unit on a hidden Stealth Tank fires once before it is dropped (the player cannot give one; the computer never does).
  - [ ] Sites in the map previews, a selected site's panel line, and placement measured on large and huge maps (integration).

## Found along the way

- [x] Haulers freezing on the way home (path clipped a blocked corner, or was cut by a new structure).
- [ ] Plains map: side 0 wins 42% of mirror games.

- [x] Seat imbalance: side 1 won 78% of mirror games (structure fronts faced the enemy for side 1).
  Now 43% to 56% over 150 games.
- [ ] The last few points of that gap (fixed tie-break orders in formations and spawn searches).
- [ ] Side 1's refinery chute and factory door are drawn on the south face; its front is now north.
- [ ] A real-GPU frame-rate check of the round-1 effects (headless measurements only so far).

## Later rounds

- Skirmish options: two computer opponents, map size.
- Touch controls (tap to select, tap-and-hold for orders).
- Ambient music bed.
- A scripted "human player" in the harness so balance can be measured without hand play.
