# Fireline round 7: the Fortification line, counter-battery and Point Defence

Build log for the round 7 fortification workstream. The integrator merges this into
`fireline-design.md`; this file is not that document.

## What it is for

Long and Epic games on large maps reach the point where artillery, bombers, the barrage and the
missile strike take a base apart from a distance, and until now the only answer was to go and kill
the guns. The Fortification line gives a defending side a second answer, and makes it a decision with
a cost: a research slot (and on Long and Epic about 15 minutes of Lab time for the whole line), a
doctrine that closes the other branch for the rest of the battle, and, for Point Defence, 1,200
credits and 60 power a time for emplacements that do nothing else. Volume beats Point Defence by
design, so it buys time rather than safety.

## The setup toggle

`SkirmishSetup.fortification?: boolean`, stated between `sites` and `research` in every normalised
setup and in both presets.

- `DEFAULT_SETUP` has it on, so a new advanced development-lines skirmish has the line. The lobby's
  stored setup reads on unless the player turned it off (a setup stored before round 7 gets it on).
- `normaliseSetup` turns it off unless the tech is advanced and research is development lines.
  Anything but a boolean takes the base's value, so a save without the field (its base is
  `LEGACY_SETUP`) reads off, and old saves play exactly as before.
- Every campaign mission states `fortification: false` (`MissionSpec.fortification`, checked by
  campaign-check), and missions are classic research anyway, so the line can never appear in one.
- `buildPlanetBattle` states `fortification: false`. War for the Planet's own research stays on the
  five lines (`LINE_ORDER` is unchanged); turning the line on for planet battles is left to the
  planet workstream.
- Lobby: a Fortification row (Off, On) under Research in step 3, greyed with "Development lines
  only." when it cannot apply, with a note on what each choice means.

## The sixth line

`LineId` is still the five lines War for the Planet researches. `BattleLineId` adds `fortification`;
`BATTLE_LINES` holds all six specs, `FORT_UPGRADE_LINE` the line's four upgrades, and
`upgradeLineOf(id)` answers line and mark for any line upgrade. `UPGRADE_LINE` is unchanged, so
planet research, the ladder's Mk II and Mk III depth counts and round 5's harness see the same five
lines as before.

`linesFor(s)` (src/sim/fortify.ts) is what the battle-side readers use: research legality
(`researchProblem`, `doctrineProblem`), save repair (`migrateResearch` via `migrateAir`), and the
Research tree in the build window (`ResearchBlock` in Sidebar.tsx). A battle without the line refuses
every Fortification upgrade and doctrine as "Not in this battle", and a save from one has any such
upgrade or doctrine dropped.

| Mark | Upgrade | Price, time (full) | Needs | Effect |
|---|---|---|---|---|
| Mk I | Reinforced concrete | 1,500, 60 s | Research Lab | Every structure's full health +20% |
| Mk II | Hardened shelters | 2,000, 75 s | Lab, Tech Centre | Structures take 25% less from blasts (below) |
| Mk III A | Counter-battery | 2,500, 90 s | Lab, Tech Centre | Firing batteries revealed for 8 s; Guard artillery answers them |
| Mk III B | Point Defence | 2,500, 90 s | Lab, Tech Centre | Unlocks the Point Defence emplacement |

Prices and times scale with the pace exactly as the other lines' do (`researchCostOf` and
`researchTicksOf` read `upgradeLineOf`): on Standard, Long and Epic, 50% of the price and 60% of the
time. The Mk III doctrine is free and permanent, as for every line.

### Mk I: Reinforced concrete

Structures have no stored full health (it has always been the spec's), so the multiplier is read
where full health is read: `structureMaxHp(s, b)` in fortify.ts, which is exactly `spec.hp` without
the upgrade. When the research finishes every standing structure of the side gains the difference
and keeps its damage, as plating does for vehicles; a structure built afterwards stands at the
raised figure (`addBuilding`). Every reader of a structure's full health now goes through it:
repair (tick.ts), selling (commands.ts and the commander's sums in ai.ts), Generator output as a
share of health (state.ts, so a raised Generator makes its usual power and no more), the commander's
repair threshold, a Field Yard deploying and packing up (engineering.ts), the health bar and the
selection panel. Measured (drive-fortification): a Generator takes 7 tank shells of 100 to destroy
without, 8 with, and makes 620 of 620 power at its raised full health.

### Mk II: Hardened shelters, precisely

The reduction applies in `hit()`'s splash branch, to a structure, when the weapon kind is
`artillery`, `bomb` or `missile`. That is: an Artillery or Battleship shell, a Grenadier's grenade
(grenades fire as `artillery`), every barrage shell, a Bomber's or Heavy Bomber's bomb, and the
missile strike. It does not apply to:

- a direct hit (a projectile with no splash, aimed at the structure);
- a flame tank's or a Firebrand's burning splash (`flame`), nor the Fortress's or the Sapper's shell
  splash (`shell`);
- units standing in the blast.

Measured: a 200-damage artillery blast on a Barracks does 200 without, 150 with; a bomb 220 and 165;
a missile 200 and 150 (0.750 each) (drive-fortification
compares the same shot with and without).

### Mk III A: Counter-battery

Each tick, after every unit and structure has fired and before anything lands
(`fortificationStep`), every projectile fired that tick by a battery is checked: an Artillery, a
Missile Carrier or a Battleship (`COUNTER_BATTERY_KINDS`), or the barrage and the missile strike
(shooter 0 with splash, traced to where they were called from: the base centre the projectiles
leave from). For each enemy side with Counter-battery, if the shot lands on ground that side's team
can see (its structures always see themselves, so "at your structures" is included), the battery's
position is revealed to that side for 80 ticks (8 seconds): `GameState.reveals`, tuples of
`[x, y, radius 3, until, side, shooter]`. A battery has one reveal per side, moved and renewed by
each new shot. `visibility()` marks the revealed disc for the side that traced it, so allies share
it. Side 0's team gets the log line "Counter-battery: enemy guns located and marked." through the
alarms mechanism, at most once every 15 seconds. The renderer draws a pulsing red crosshair ring on
each reveal of side 0's team, above the fog, fading in its last second and a half.

Return fire: every fourth tick, each idle Artillery or Battleship of a side with reveals, on Guard,
turns on the nearest revealed battery within its range and outside its minimum range, ahead of
whatever it was shooting at. Hold and Aggressive stances are left alone.

### Mk III B: Point Defence

The Point Defence emplacement: 1x1, 1,200 credits, 12 s to build, 450 health, 60 power, sight 6,
needs a Research Lab, offered only in a battle with the line (`techAllowed`) and built only once the
side has researched the Point Defence doctrine (`canQueue`; the build button reads "Needs Point
Defence research" until then). It closes the Structures list, so no other item's hotkey moves. It has
no weapon and never fires at units.

Each tick, an emplacement off its cooldown (and placed at least 15 ticks ago, like a turret) picks
the enemy projectile in the air landing soonest within 4 tiles of it that it can stop: an artillery
shell (a gun's or the barrage's, never a grenade), a Missile Carrier's missile, a bomb, a Firebrand's
incendiary as it falls (and with it the fire it would have left), or the missile strike. One draw
from the battle's seed (`next` in rng.ts) decides it at 60%. Brought down, the projectile is removed
before impact; either way the shot is drawn (a tracer from the emplacement to the point in the air,
then a white flash and fragments, or a grey puff) and the emplacement turns to it. Then a 3 second
cooldown, recovering at half speed when power is short (6 seconds). A missile strike in flight for
4 seconds can draw two attempts from one emplacement.

Measured (drive-fortification): over 3,000 single shots, one attempt each, 60.6% brought down;
attempts 30 ticks apart powered and 59 short of power; an eight-shell barrage on a structure under one
emplacement drew 1 attempt and 7 shells landed.

## The computer

src/sim/aiFortification.ts, called from aiAir.ts's paced research block. Normal and Hard, Long and
Epic paces only; Easy never.

- Fire on its structures is counted while the line is in play on Long or Epic (`notePressure`,
  from `hurt()`): blasts from guns on the ground (Artillery, a Missile Carrier, a Battleship) and from
  above (bombs, the barrage, the missile strike), with the tick and place of the last.
- Once twenty blasts have landed, the line goes ahead of its paced list: Reinforced concrete, then
  Hardened shelters, then the doctrine, adopted as it goes. Counter-battery when more than twice as
  much fire came from the ground as from above and it has two Artillery or more to answer with;
  Point Defence otherwise.
- With Point Defence researched and fire landing in the last 90 seconds, it builds emplacements up to
  two (Normal) or three (Hard), each beside the structure last hit, or else beside the first core
  structure (Command Yard, War Factory, refinery, Lab, Tech Centre, Generator, Barracks) none covers.

## Harness

`scripts/drive-fortification.ts`, wired into drive.ts (and runnable alone). 174 assertions, about a
minute (most of it one whole Long battle):

- the setup: presets, normalisation, every mission and six planet battles stating it off, old saves
  (no field: off, Fortification upgrades and doctrine dropped, no reveals or counts), saves with the
  line on (kept, junk dropped, a closed branch dropped);
- off means off, for the toggle off, classic research and standard tech: five lines, every upgrade
  and doctrine refused with the same state object returned, Point Defence neither offered, queued
  nor placed; and a Quick battle played by the computer on both sides for 6,000 ticks is
  byte-identical with the toggle on and off, the setup's field aside;
- each mark measured against the same arena without it, as above;
- doctrine permanence, and the refusal and legal case for each action path (research out of order,
  a doctrine before Mk II, Mk III before a doctrine, a foreign branch, the closed branch, Point
  Defence before its research, without a Lab, queued, built and placed);
- Point Defence: the rate over 3,000 shots, the cooldown powered and short of power, what it shoots at
  and what not, units beside it untouched, range, its own side's shells ignored, volume, the
  incendiary's fire, the missile strike;
- counter-battery: the reveal on the tick of the shot, its tile in sight, exactly 80 ticks then out
  of sight again, one reveal per battery, the log rate-limited, nothing without the upgrade, the
  barrage traced to its launch point on seen ground and not on unseen ground, no trace for a tank's
  shell, and Guard artillery turning on the revealed battery ahead of a nearer rifleman;
- replay: a scene with emplacements, batteries and a barrage played twice byte-identically, and
  saved and loaded mid-battle;
- the computer: who fortifies, the order, the branch rule, the emplacement cap and placement, and a
  whole Long battle in which it turns to the line under fire.

Changed elsewhere: drive-lines.ts counts 25 upgrades (21 and the line's four);
drive-planet-battle.ts's `preSize` leaves `fortification` out of the recorded skirmish hashes after
checking it is on exactly where it can apply (no hashed battle is Long or Epic, so nobody researches
it); campaign-check.ts asserts every mission states it off and counts Point Defence as skirmish-only.

`scripts/ai-ladder.ts --fortification` turns the line on (every ladder setup now states it, off
without the flag) and adds a table: how far each difficulty took the line, emplacements a side, and
shots brought down a side.

## Ladder

LADDER_RESULTS

## Known gaps

- Not checked in a browser: Playwright is not installed in this worktree, so `check:ui`,
  `check:loading` and `tours` were not run. The lobby row, the Research tree's sixth row, the build
  button, the art, the intercept effect and the reveal marker are typechecked only. They reuse the
  existing classes and add no hooks.
- War for the Planet does not offer the line; planet battles state it off.
- Counter-battery reveals and the return fire matter most to a human: the computer already sees the
  whole map, so for it the branch is only the return-fire priority.
