# Fireline round 7: the adaptive commander (build log)

Workstream: the adaptive commander. The owner plays long desktop games and wants an opponent that
adapts, so a fixed opening stops working. This log records what was built, how it is tested, and
what the ladder measured. Read the measurement section before deciding whether the lobby should
default it on.

## What was built

### The setup field

`SkirmishSetup.adaptive?: boolean` (rules.ts). `DEFAULT_SETUP` states it `true`, `LEGACY_SETUP`
states it `false`, and `normaliseSetup` keeps exactly `true` or `false` and otherwise takes the
base's value, so a save from before round 7 (normalised against `LEGACY_SETUP`) reads off. It is the
last field of a normalised setup. `buildPlanetBattle` states it `false` (whether War for the Planet
uses it is decided later). Missions have no setup and never adapt. The lobby has an "Adaptive
commander" field (Off, On) in the Forces step, with a note under it; `readStoredSetup` reads a stored
setup without the field as on.

It runs only on Normal and Hard, in a skirmish, with the setup on (`adaptiveOn` in aiAdapt.ts). Easy
keeps its simple play.

### Where the code lives

Everything is in `src/sim/aiAdapt.ts`. ai.ts has small hooks, each inside
`// round7:adaptive begin/end`, and every hook returns its input unchanged when off:

| Hook | Where in `commander` | What it does when on |
|---|---|---|
| `adaptObserve` | after `normalise(mem)` | every 5 s: a look round, the lean moved a step, the plan reconsidered, maybe one log line |
| `adaptMix` | the vehicle and infantry weight lists in `advancedUnits` | weights shifted toward the counters, bounded |
| `adaptShare` / `adaptMix` | the standard-tech rifleman share and tank/buggy/artillery roll | the same, on standard tech |
| `adaptStage` | new `waveStage` beside `stage` | a second staging point on a flank |
| `adaptTarget` | both `pickTarget` calls of the wave | a raid's or an expansion hunt's target, from memory |
| `adaptWaveSize` | the wave `size` | larger while besieging |
| `adaptAfter` | end of `commander` | notices a broken wave and where |

The wave code's five uses of `stage` while gathering and setting off now read `waveStage`, which is
`stage` itself unless the plan is a flank or a raid. Producers still rally to `stage`, broken waves
still fall back to it.

### Scouting memory (honest information)

`AiMemory.adapt` (types.ts, `AdaptMemory`). The commander still sees the whole map for its ordinary
play (the stated rule). What it adapts to is only what its own team could see: every `ADAPT_SAMPLE`
(50) ticks it computes `teamVisibility(s, owner)` and writes down each enemy unit in view (a Stealth
Tank or Spy only when `seenBy` says it is detected) and each enemy structure with any tile in view
(defences, Tech Centre, Helipad, Research Lab, `pointdefence` if a later round adds it, refineries,
Field Yards and yards). Each sighting keeps id, owner, class, worth, tick and place.

- Fading: a unit sighting's weight halves every `ADAPT_HALF_LIFE` (1800 ticks, three minutes); a
  structure's three times slower.
- Forgetting: a unit is dropped after `ADAPT_FORGET` (four half-lives), a structure after three
  times that, and either at once when the spot it was seen at is in view again and it is gone.
- Bounded: the newest 120 unit and 80 structure sightings, the last four broken waves.
- Summary (`summarise`): faded worth per class, as shares of infantry, light vehicle, heavy armour,
  artillery and siege, air, navy and static defence; the count of defences; tech signals; enemy
  refineries or Field Yards 14 tiles or more from that enemy's yard (expansions).
- The memory is replaced on every change, never changed in place (cloneState copies AiMemory
  shallowly), and a damaged or junk memory is started afresh.

### Counter-building

The lean (`AdaptMemory.lean`) moves a share of the way toward the summary's shares at each look:
Hard 0.25, Normal 0.1 (Normal adapts more slowly). A Helipad seen sets a floor of 0.15 under air, a
Tech Centre under heavy armour. Defences only count once there are `TURTLE_DEFENCES` (8) or more seen:
every base has a few, and answering an ordinary base's turrets (see the measurements) put the mix
into siege guns all game.

The first version scored each kind by `DAMAGE_VS` against the lean. That is a poor guide on its own:
against infantry it halved tanks and doubled buggies, and the army lost. So the score now reads a
measured table, `MATCHUPS` in aiAdapt.ts, made by `scripts/adapt-matchups.ts`: equal-credit fights in
the real engine on open ground (two budgets, three placements, each kind against each class's
representatives, both sides attack-moving, or the group attacking a powered ring of turrets). The
score is the log of the share of value each side has left. Air and navy columns are not measured
(aircraft need their pads, ships the sea); classScores fills them from `DAMAGE_VS`. Some results
differ from the brief's expectations and the table follows the engine: against heavy armour, tanks
(+1.52) and rocketeers (+1.14) win but missile carriers lose badly (-2.50); against infantry,
artillery (+2.75), flame tanks (+2.51) and grenadiers (+1.69) win.

Each weight is multiplied by `exp(strength * (0.4 * (score - mean) + doctrine))`, where strength is
1 on Hard and 0.5 on Normal and the doctrines add fast raiders against artillery, siege against a
turtle and anti-air against aircraft (Flak Tracks and Skyhunters join the lists in proportion to the
air lean). Bounds: no weight below 0.5 or above 2.5 times what it was, and no kind above 50 per cent
of the mix, or its share before adapting where that was already higher. So the army never becomes
one kind and no kind drops out.

The counter-battery doctrine of another builder was not in this tree, so it is not valued yet; the
`doctrine` function in `mixFor` is where it would go.

### Strategic adaptation

`AdaptMemory.plan` is one of `direct`, `flank`, `raid`, `expand`, `siege`, reconsidered after it has
been held `hold` ticks (Hard 600, Normal 1200):

- **Flank**: two of the recent breaks (within six minutes) lie within 12 tiles of each other. A
  second staging point 42 per cent of the way to the enemy and 8 to 18 tiles off the direct line, on
  the side away from the breaks, on 5 by 5 open ground and reachable over land from the staging
  point (`flankPoint`), kept in memory. None possible: back to direct.
- **Raid** (Hard only): broken twice again since the flank began. The wave goes the flank's way
  and aims at the nearest remembered enemy refinery or Field Yard. Broken twice again: direct.
  Normal instead works out a fresh flank.
- **Expand** (Hard only): an enemy expansion seen. The wave aims at the nearest one remembered.
- **Siege** (Normal and Hard): `TURTLE_DEFENCES` or more defences seen and defences at least 35 per
  cent of what it has seen. The wave waits for 2 (Normal) or 4 (Hard) more units, and the mix leans
  into missile carriers, artillery and Bastions. The overdue rule still sends a wave after an extra
  interval, so a siege never stalls the game.
- A wave is "broken" when it was attacking at the last decision and is not now (`adaptAfter`); its
  middle while attacking is remembered each decision.

### The log line to side 0

When the lean toward answering one class reaches 0.4 and side 0's team can see at least two of the
units that answer it (for example two rocketeers), side 0's log gets one line, such as "The enemy is
massing rocket infantry against your armour." At most one every five minutes per enemy, never the
same news twice running, never about an ally. Three whole battles in the harness produced one line.

## Harness

`scripts/drive-adaptive.ts`, wired into `scripts/drive.ts` (also runs alone with
`tsx scripts/drive-adaptive.ts`, about 90 s; 159 assertions):

- The setup field: presets, absent, junk, a pre-round-7 save, the planet battle, three missions, Easy.
- Off is off: three battles with the toggle off never write the memory or a log line, and play
  byte-identically to the same battles with the toggle on but every side forced off; Easy with it
  on plays exactly as off; every hook returns its very input when off.
- Sight: units in sight written down, tanks out of sight not (while the commander's ordinary play
  sees them), an undetected Stealth Tank not, only enemies; fading to half after one half-life;
  forgotten when old; forgotten at once when its spot is in view and it is gone; memory replaced,
  never mutated.
- The mix: 2000 random leans, lists and closed kinds: never above the share cap, never outside
  the factor bounds but by the cap, never narrowed to one kind; the counters by class at both
  difficulties, and Hard at least as far as Normal.
- Gradual change: the lean never rises more than the difficulty's rate a look; Hard reaches half
  within 25 seconds, Normal more slowly.
- Side 0 fields one category (a scripted side 0 that builds only infantry, then only heavy armour,
  and walks it at side 1's base): within fifteen minutes the adaptive Hard commander leans toward it,
  and trains more of the measured answers relative to what loses than the same commander fixed.
- Plans: a flank after two breaks in one place, off the direct line on open ground, kept; held for
  its hold time; then Hard raids and Normal re-flanks; an ordinary base's six defences are not a
  turtle; ten are, with the larger wave and more siege; Hard hunts an expansion, Normal does not.
- Replay, saves and junk: an adaptive battle replays byte-identically; saved and loaded mid-battle it
  plays on exactly as straight through; junk memories are started afresh.
- Whole battles: three adaptive battles (Hard quick, Hard long, Normal standard tech with three
  sides) finish, memory stays bounded, no em dash in the log.

The strongest evidence for "off plays as before" is outside this file: drive-planet-battle.ts holds
hashes recorded before round 7 for 34 skirmishes, the original game and 14 missions, and
drive-size.ts holds pre-round-6 hashes for 15 battles. All match with the toggle off. Those
setups, and two seed-pinned sections (drive-air's bomber seeds, drive-lines' loadout seeds), now state
`adaptive: false`, since they record the established commander's play. With the toggle on, strike-1
built no Bomber in its 26 minutes (strike-7 still built two): a seed race, as the section's own
notes describe.

`scripts/ai-ladder.ts`: a side marker `adaptive` or `fixed` after the difficulty
(`new:hard:adaptive`, `new:normal:ashen:fixed`) forces a side, through `setAdaptiveOverride`.
Unmarked sides follow `--adaptive on|off` (default off, so the standard card reads as before).
`ADAPT_PARTS=mix` or `ADAPT_PARTS=plans` in the environment adapts only that half (ablations).

## Measurements

All at `--map random`, advanced tech, development lines, `--jobs 2`.

### Long pace, 150 seeds per match (the brief's measurement)

`npm run ladder:fire -- --map random --pace long --seeds 150 --jobs 2` with the four matches below.
3077 s.

| side 0 | side 1 | side 0 wins | side 1 wins | unfinished | avg min | median min |
|---|---|---|---|---|---|---|
| hard adaptive | hard fixed | 5 (3%) | 145 (97%) | 0 | 21.3 | 20.6 |
| hard fixed | hard adaptive | 4 (3%) | 146 (97%) | 0 | 20.8 | 20.1 |
| normal adaptive | normal fixed | 60 (40%) | 89 (59%) | 1 | 27.4 | 26.0 |
| normal fixed | normal adaptive | 72 (48%) | 77 (51%) | 1 | 27.7 | 25.9 |

- Hard adaptive beats Hard fixed in 151 of 300 (50.3%, 95% interval 45 to 56%), both ways round.
- Normal adaptive beats Normal fixed in 137 of 300 (45.7%, 95% interval 40 to 51%), both ways round.
- Two of 600 unfinished (seeds 83 and 4, Normal), against 90,000 ticks: no stalling.

**The target was not met.** Adaptive does not win clearly more than half against non-adaptive at
the same level. At Hard the seat decides almost everything (side 1's Hard income is a quarter
higher: 97 per cent for side 1 whichever commander sits there), so the Hard row cannot show an
effect of this size either way. At Normal adaptive is, if anything, slightly worse (45.7 per cent,
interval just reaching 51).

### Development, 30 seeds (noisy, about plus or minus 18 points; for direction only)

Before the turtle threshold and the gentler mix, side 0 Hard against side 1 Normal fixed, long pace:

| side 0 | wins |
|---|---|
| hard fixed | 13 of 30 (43%) |
| hard adaptive (both halves) | 8 of 30 (27%) |
| hard adaptive, mix only | 9 of 30 (30%) |
| hard adaptive, plans only | 12 of 30 (40%) |

The mix was the half that hurt. Watching battles showed why: every base has four to six defences,
the waves saw them on every attack, and the static lean sat at 0.3 to 0.5 all game, steering the mix
into artillery and missile carriers (which lose most open fights) and turning the plan to a siege
(a larger wave, so later attacks). The fix (defences count only from eight, factors 0.5 to 2.5, gain
0.4) is what the 150-seed table measures; it brought Hard back to even and Normal to 45.7.

### Quick pace, once

`npm run ladder:fire -- --map random --seeds 20 --jobs 2`, the same four matches at the Quick pace
(20 seeds: a check that nothing breaks, not a measurement). 299 s, nothing unfinished.

| side 0 | side 1 | side 0 wins | side 1 wins | unfinished | avg min |
|---|---|---|---|---|---|
| hard adaptive | hard fixed | 0 (0%) | 20 (100%) | 0 | 17.8 |
| hard fixed | hard adaptive | 1 (5%) | 19 (95%) | 0 | 20.4 |
| normal adaptive | normal fixed | 5 (25%) | 15 (75%) | 0 | 27.3 |
| normal fixed | normal adaptive | 8 (40%) | 12 (60%) | 0 | 27.4 |

Both ways round: Hard 19 of 40 (47.5%), Normal 17 of 40 (42.5%); both intervals wide.

## Why it does not beat its own fixed self, and what to try next

- The opponent in the ladder is the same commander, which already answers what it fields with
  whole-map information (the `infantryHeavy`, `armourHeavy` and `fortified` weights in
  `advancedUnits`, and `airPlan`'s anti-air). A sight-limited counter on top of an omniscient one has
  little room to add, and its sightings are few (often under ten units) and come late (the first
  wave), so the lean swings.
- Against a human who opens the same way every game, the memory and the plans are the part that
  matters, and the ladder cannot measure that. A scripted-opening ladder (side 0 a scripted build,
  such as the harness's one-category players, against adaptive and fixed) would; it is the natural
  next measurement.
- Candidates: carry the lean across waves only from units seen fighting (not passing), weight
  sightings by how much damage they did to its waves, raise the flank's trigger to three breaks,
  and let the plans run with the mix off (plans alone measured nearest to even).

**Recommendation for the coordinator**: the brief has `DEFAULT_SETUP` turn it on, and it is on.
It makes the commander behave differently and visibly (flanks, raids, the log line) without making
it stronger; at Normal it may be a few points weaker. If the lobby should only offer what measures
at least even, default it off until a scripted-opening ladder shows it working.

## Verification

- `npx tsc --noEmit -p packages/fireline/tsconfig.json`: clean.
- `npm run drive:fire`: 393114 assertions, 0 failed, 1082 s (the adaptive sections included).
- `npm run campaign:fire`: 7699 assertions, 0 failures.
- `npm run drive:planet`: 35255 assertions passed, 0 failed (the recorded pre-round-7 hashes match
  with the toggle off).

## The scripted-opening test (2026-11-25)

The measurement above pits the adaptive commander against its own fixed self, which cannot show
what the feature is for: punishing a player who repeats one plan. This test can.

**How it works.** `src/sim/aiOpening.ts` gives a side one fixed opening, for testing only (nothing
sets one in a real game, and nothing about it is saved). The side is played by the ordinary Normal
commander: the same economy, research, attack timing and waves, nothing extra earned, never adapting.
It trains only its plan's units (`openingMix`, ahead of `adaptMix`), takes back anything else the
commander queues, and keeps its lines busy from credits beyond a reserve of 600 (`openingGuard`, run
after every decision). Without that, the commander banked its credits for research: a first "tank
column" built one tank in 38 minutes.

| Opening | Vehicles | Infantry | Infantry cap |
|---|---|---|---|
| Tank column | Tank | Rocketeer | 6 |
| Infantry flood | Buggy | Rifleman 2, Grenadier 2, Rocketeer 1 | none |
| Artillery siege | Artillery 2, Tank 1 | Rifleman | 6 |

`npm run ladder:fire -- --map random --pace long --opening-card normal,hard` plays each opening from
seat 0 against the fixed and then the adaptive commander at each level. Seat 0 is the same in both
rows of a pair, so the seat cancels. `drive-adaptive.ts` checks each opening fields only its plan
(crews walking out of fallen structures as riflemen aside), trains its main unit, and keeps to its cap.

**Result, Long pace, random maps, 150 seeds per match (1,800 battles, 24 minutes on four cores).**
The scripted opening's wins:

| Opening | v Normal fixed | v Normal adaptive | v Hard fixed | v Hard adaptive |
|---|---|---|---|---|
| Tank column | 150 (100%) | 150 (100%) | 101 (67%) | 95 (63%) |
| Infantry flood | 1 (1%) | 1 (1%) | 1 (1%) | 1 (1%) |
| Artillery siege | 139 (93%) | 132 (88%) | 20 (13%) | 27 (18%) |

**What it says.**

- **The adaptive commander does not punish a repeated plan.** No row moves by more than the noise of
  150 seeds (about plus or minus 5 to 8 points), and against Hard the siege does slightly better
  against the adaptive commander, not worse.
- **At Normal it barely acts in time.** Battles end in about 15 minutes, and 70 of the 150 tank-column
  battles against the adaptive Normal commander were tick for tick the same battle as against the fixed
  one: the adaptation never changed a decision that mattered. Against Hard, 28 of 150 were identical.
- **A tank column beats the Normal commander every time, adaptive or not.** That is a hole in the
  Normal commander itself, found by this test: a player who learns it can win every Normal battle with
  one plan, which is the opposite of what the game should teach.
- **The infantry flood is not a viable plan** (1 win in 600), so its rows say nothing about adapting.

**Next.** The test is the yardstick for the fixes: the adaptive commander should start reading and
answering much earlier (its Normal tuning is half strength and slow, which in a 15-minute battle is no
adaptation at all), and the Normal commander needs an answer to massed tanks before minute 10
(rocketeers and missile carriers earlier, from what it sees). A fix succeeds when the tank column's
win rate against the adaptive commander falls well below its rate against the fixed one, at 150 seeds.

## The fix (2026-11-25, same day)

**Normal's hole was a set of habits, not one bug.** Traced battle by battle at the Long pace:

1. Paced research held credits back for the next tier while a tank column was already at the gate.
2. It spent on extra structures and aircraft while its army was behind.
3. It read the enemy by head count, so six rocketeers made a tank column look like infantry.
4. It launched waves into an army it could not beat.
5. Its vehicle answer to armour was artillery and missile carriers, which lose to tanks (matchup
   score against heavy: tank +1.52, rocketeer +1.14, artillery -2.66, missile carrier -2.5).
6. It built too few tanks of its own.

**What changed** (all in paced games only, Standard, Long and Epic, so Quick and the campaign are untouched):

- `src/sim/aiStrength.ts` (new) values each side's fielded army by cost. `outmatched(s, owner, ratio)`
  says the enemy's army is worth more than ours times the ratio.
- When outmatched: no savings hold and no extras or aircraft (from level, ratio 1); no new research
  (1.25); no wave and no gather to attack (1.1). It builds the army first.
- The enemy is read by value, not head count.
- Against a mostly armoured enemy (`armourThreat`, 55% of its value): tanks weighted 8, Bastions 1, other
  vehicles 0.2, fewer grenadiers, infantry held at 6 so credits reach the factory, and two War
  Factories and two rocket turrets added to the build order after the uplink.

**The adaptive commander.** Its sight-only memory knew less than the base commander's whole-map
read, which is why it never added anything. Changes: it reads the whole map (`ADAPT_WHOLE_MAP`;
stealth still hides), Normal runs at full strength and rate (1 and 0.25), a one-sided enemy widens its
limits (`adaptLimits`: when one class is over 60% of the lean, a factor up to 5 and a share up to 80%).
Three further attempts were taken out: extra factories and turrets for the adaptive side only (worse);
sending fast units at artillery only when no armour screens it (55 to 56 siege wins, no effect); and
attacking at once when its army was worth 1.4 times the enemy's (`adaptSeize`), which was what made the
siege row worse (37%, back to 24% without it) and also launched waves through a held attack timer.

The full check then found three behaviours the fix had broken, all mended: enemy aircraft counted
towards "outmatched", so a commander facing Gunships stopped building the Interceptors that answer them
(aircraft now left out); an outmatched commander stopped all research, including the Fortification line
that answers shelling (that line is now exempt); and two harness tests read the new behaviour wrongly
(fallen squad members counted as a second owner; the airlift test now runs with the adaptive layer off,
since that layer answers its two parked Gunships with Skyhunters).


**Result, Long pace, random maps, 150 seeds per match.** The scripted opening's wins, before and after:

| Opening | v Normal fixed | v Normal adaptive | v Hard fixed | v Hard adaptive |
|---|---|---|---|---|
| Tank column | 100% to 75% | 100% to 74% | 67% to 13% | 63% to 17% |
| Infantry flood | 1% to 2% | 1% to 3% | 1% to 0% | 1% to 0% |
| Artillery siege | 93% to 25% | 88% to 37% | 13% to 0% | 18% to 1% |

Final build (seize removed, the three fixes in), Normal, 150 seeds: tank column 73% against fixed and 75%
against adaptive; infantry flood 2% and 3%; artillery siege 25% and 24%. The Hard columns and the
standard card above were measured with seize in; seize touched only adaptive sides.

Standard card (Long, 150 seeds each seat): the new Normal beats the previous Normal 92% from either
seat; Easy loses every battle to Normal; the new Normal beats the new Hard 3% of the time from seat 0.
Hard from seat 0 now wins 45% against the new Normal (the previous pair: 30%) and 88% against the previous Normal.

**What it says.**

- **Normal now has an answer.** The tank column still wins three in four at Normal, so the gap is
  narrowed, not closed; a player who wants a sure win must move up to Hard, where the same column wins
  one battle in eight.
- **The adaptive commander still does not punish a repeated plan.** Against the tank column it matches
  the fixed commander, and against the siege too once seize was removed (24% against 25%).
  It no longer adds nothing because it knows less; it now adds nothing because the base commander
  already answers what it sees. Its distinct value has to come from the memory across waves and the
  plans (flanks, raids), not from the mix, and no measurement yet shows that.

**Verification (final build).** `npm run check`: all checks passed. `npm run campaign-sweep`: 279 battles,
every mission won at every difficulty by at least one plan (Hard: hold-the-ford 7/12, blackout 5/12, fireline
6/12, iron-coast 4/12, firestorm 5/12, last-light 5/12). `drive-adaptive.ts`: 168 assertions, 0 failed.
