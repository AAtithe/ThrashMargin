# Fireline round 7: War for the Planet and its battles, both ways (build log)

The owner plays long desktop wars to train strategic thinking, so every link between the planet map
and the real-time battles must create a decision. This round adds **battle rules 3**: what the war
holds around a battle shapes the battle, and what happens in the battle comes back into the war.
New wars start on battle rules 3. A war on battle rules 1 (no `battleRules`, every war before larger
maps) or 2 (larger maps by stakes) keeps exactly its behaviour: the harness proves both
byte-identical to the build before this round.

Files: `src/planet/links.ts` (new: the rules of each link), `src/sim/planetLinks.ts` (new: the engine
side), additions in `src/planet/{types,rules,battleSetup,battle,resolve,turn,save,ai}.ts`, the cards
in `src/components/planet/BattleCards.tsx` and the attack preview in `RegionPanel.tsx`, and
`scripts/drive-planet-links.ts` (new harness sections, run by `npm run drive:planet`).

## How it is versioned

- `PlanetState.battleRules?: 2 | 3`; `BATTLE_RULES = 3` in `rules.ts`. `migratePlanetState` keeps 2 or
  3 as saved and never adds either. Battle rules 3 sizes the map exactly as 2 does.
- What the war brings is frozen into the setup as `BattleSetup.links` (`SetupLinks`), set only on a
  battle rules 3 war. Everything downstream (the engine, the auto-resolve, applying the report) keys
  on `setup.links`, so an older war's setup has exactly its old shape and an older war's report is
  applied exactly as before.
- What the battle sends back is `BattleReport.links` (`ReportLinks`): structures built and standing,
  credits unspent, ore harvested, wounded field army slots. The reducer refuses a report carrying
  links for a setup without them, and checks every field (built buildings among refinery, factory
  and institute, once each; whole numbers 0 to 1,000,000; wounded slots that survived and are
  vehicles).
- New optional saved fields, each absent on every older war: `RegionState.shaken` (last turn
  shaken), `CoreUnit.w` (a wounded vehicle), `BattleUnit.hp` (health on arrival, per cent). In the
  engine: `PlanetBattle.support` and `PlanetBattle.reinforce`, kept by `migrateState` when well
  formed.
- Engine edits to shared sim files are additive and wrapped in `// round7:planet begin/end`: the type
  fields (`sim/types.ts`), one line in `syncSkirmishPowers` and one call in `migratePlanetBattle`
  (`sim/state.ts`), one call in `doPower` (`sim/mission.ts`), one call in the tick (`sim/tick.ts`).

## War into battle

**1. Supply and logistics.** The attacker's supply from the region its army stands in (`supplyOf`):

| Supply | When | Credits | Harvest | Vehicles arrive |
|---|---|---|---|---|
| cut | the staging region has no route to the capital | half | 50% | at 60% health |
| short | fuel or food left below 2 once the attack is paid | four fifths | 75% | whole |
| supplied | otherwise | all | 100% | whole |
| depot | supplied, and a port there, or the capital there or next door, or a supplied neighbour with a port | all | 100% | whole, plus a wave |

The depot's **reinforcement wave** is the staging garrison's most valuable units, at most half of
it and at most 6, arriving in front of the attacker's Command Yard at a quarter of the time limit
(`planetReinforce`). It leaves the garrison when the battle is made (the stock spent in battle comes
from the war), and goes home if the battle ends before it arrives or is called off. The harvest rate
is the attacker's `harvestMul` (`s.perks` for seat 0, `s.sidePerks` otherwise; nothing else in the
perks changes). A defending city cut off from its own capital also fights with three quarters of
its credits.

**2. Support from neighbouring regions** (`supportFor`, both principals, regions within 2 hops of
the target and never the target itself): an institute of Mk 2 or more gives the recon sweep;
fortifications Mk 3 the artillery barrage, unlimited; failing that, artillery in a garrison next
to the target an off-map barrage with one use per gun, at most 3; an airfield (as before, the
helipad) also gives air strikes (the missile), one use per Mk of the best airfield. A power the
side's own structures already give is left out. In the engine the powers are granted half charged,
kept without their structure (`supportHeld`), and a limited one loses a use each call and goes with
its last (`spendSupport`). The setup card lists them under "Support from neighbouring regions" with
the region each comes from.

**3. Terrain and city.** Prepared defences: 4 sandbag posts per Mk of the defender's
fortifications, in a staggered line across the approach nine tiles in front of its Command Yard
(the opening layout keeps a lane round every structure, so the posts stand a tile apart). The
defender's research applies, as before. The time limit is `battleMinutes` times (0.8 + 0.1 x city
level): 18 minutes for a level 1 city on a 20 minute preset, 22 for a level 3, 26 for a level 5.

**4. The attacker's base** (`attackerBase`): Command Yard, two power plants and barracks always; a
refinery for a refinery district in the staging region (two at Mk 3); a War Factory for a factory
there (and a repair bay from Mk 2); the helipad as before. An army staging from a bare city brings
infantry and no harvest.

## Battle into war (applied in `battleIntoWar`, `turn.ts`)

**5. Structures held.** If the attacker wins, each refinery, War Factory or research lab its side
has standing at the end beyond what it brought seeds one Mk of the matching city building
(refinery district, factory, institute) in the captured city, within what the city may hold
(`buildBlock`). The defender's surviving structures already limit city damage.

**6. Economy.** In a fought or simulated battle, each faction side of the winning team gets one ore
per 400 credits unspent plus one per 400 credits harvested, at most 20. Not from a retreat, not
from an auto-resolve (it spends every credit), never for the loser. Neutral sites are off in planet
battles (round 6's contract states `sites: false`), so there is nothing to capture; see the gaps.

**7. Troops and wounds.** The attacker's survivors outside its field army (troops trained in the
battle, the wave) join the captured garrison up to its cap and then the field army up to its cap;
after a defeat they fall back with the army and then into the staging garrison. A field army
vehicle ending below half health comes back wounded (`w: 1`): it counts at half strength and
arrives at 50% health in the next battle until End turn repairs it for 2 ore and 1 alloys while the
stock allows (otherwise it waits). The auto-resolve wounds a surviving vehicle with half its side's
loss share, on dice of its own (`:wounds`), and the wave's survivors come from `:wave`, so the draws
of every older war are untouched.

**8. Morale and diplomacy.** A loser that lost more than 75% of the army value it brought is beaten
decisively: every faction allied with the winner trusts it 5 more, every faction allied with the
loser trusts the loser 5 less, and the loser's regions next to the battle are shaken until the end
of the next turn (their garrisons bring three quarters of their units to a battle, and the computer
factions' defence estimate counts the same). There is no stability concept in the planet war, so
"shaken" is that status.

**9. The other workstreams' battle features.** `buildPlanetBattle` has `const rules3 = setup.links
!== undefined;` in a `round7:planet` block whose comment tells the integrator to set `fortification`,
`structureUpgrades`, `strategicBuildings` and `adaptive` to `rules3` instead of false. The fields
themselves are not added here.

**10. Interface.** The attack preview and the pending battle card show "What the war brings"
(supply, credits lost, battered vehicles, the base the staging region fields, the wave expected and
when) and "Support from neighbouring regions" for each principal, and prepared defences or a cut-off
defender. The debrief shows "What the battle sends back" (buildings seeded, ore returned, troops
joining, wounded vehicles, trust changes, shaken regions). The journal records the march ("Supplied
from a depot; 3 reinforcements to follow; 1 support power from nearby regions"), what came back, and
each End turn's repairs. Colours are the existing `--ui-*` tokens (`.fl-pl-links`).

**11. Computer factions.** On battle rules 3 the planet AI counts an attack's strength from where it
would be made: credits times the supply's share, plus the support and the wave as the auto-resolve
counts them; it does not attack from a cut-off region unless it is down to 2 regions; and a target's
value gains +2 from a depot, -2 short, -6 cut, plus up to 3 for support. The defence estimate counts
a shaken garrison and the sandbag posts.

## Measurements

`npm run ladder:planet` at its default seed counts (Short 150, Long 50, Very long 50 per difficulty)
and with `-- --prefix holdout`, before this round (battle rules 2) and after (battle rules 3). Every
one of the 49 targets passes on both seed sets, before and after.

| Preset, seed set | Decisive endings before / after | Battles per faction-turn | Median length | Bot win easy / normal / hard before | after |
|---|---|---|---|---|---|
| Short, ladder | 81.6% / 84.4% | 0.424 / 0.433 | 57.5% / 50.0% | 80.0 / 50.0 / 32.0 | 78.7 / 46.0 / 26.0 |
| Short, holdout | 84.7% / 84.2% | 0.434 / 0.441 | 52.5% / 52.5% | 81.3 / 48.7 / 31.3 | 77.3 / 38.7 / 22.7 |
| Long, ladder | 69.3% / 72.0% | 0.480 / 0.463 | 65.6% / 71.1% | 62.0 / 38.0 / 18.0 | 52.0 / 26.0 / 16.0 |
| Long, holdout | 68.7% / 74.0% | 0.504 / 0.470 | 64.4% / 53.3% | 46.0 / 34.0 / 24.0 | 54.0 / 18.0 / 10.0 |
| Very long, ladder | 76.7% / 73.3% | 0.485 / 0.436 | 51.3% / 60.6% | 22.0 / 14.0 / 16.0 | 12.0 / 16.0 / 6.0 |
| Very long, holdout | 80.7% / 84.0% | 0.506 / 0.456 | 58.8% / 55.6% | 22.0 / 16.0 / 4.0 | 22.0 / 12.0 / 4.0 |

Long at 50 seeds per difficulty is noisy (about +-13 points), so Long on Normal was rerun at 150
seeds: before, 69.3% decisive and the bot winning 27.3%; with the first cut of battle rules 3,
64.0% and 22.0% (decisive endings under the 65% target). The cause was the sandbag posts counting
as a full structure each in the auto-resolve (a citadel's 12 posts were worth three turrets), which
made every fortified city much harder to take. A post now counts a quarter (`WALL_VALUE`), after
which Long on Normal at 150 seeds read 66.7% decisive and 26.0% for the bot, inside the noise of
the base. The bot (the player seat, the expansionist plan) wins somewhat less on Normal and Hard in
Short and Long: the computer factions get the same links, and their larger armies on Hard (the army
bonus) take more of the raised troops and waves. It stays inside every target.

`npm run drive:planet` peak strategic save over its whole bot-played wars on battle rules 3: Short
14,150 B, Long 20,731 B, Very long 26,232 B against the 49,152 B budget.

## Tests (`npm run drive:planet`)

`scripts/drive-planet-links.ts`, seven sections run by `drive-planet.ts`. Each link has a measured
case and a refusal case:

- Supply: supplied, short of fuel, short of food, cut (credits, harvest 50% in the engine, tanks
  placed at 60% health, infantry whole, auto-resolve strength falls), depot by port and by the
  capital next door, the wave's make-up and tick, the wave leaving the garrison, marching in at its
  tick in the engine, going home when the battle ends first; battle rules 1 and 2 setups have no
  links, full credits, the plain time limit and take no wave.
- Support: each grant and its source; refused for an institute Mk 1, fortifications Mk 2, artillery
  two hops away, buildings three hops away, a side with an uplink; in the engine granted, kept without
  a structure, a one-use barrage spent and refused afterwards, a two-use barrage keeping one use.
- City: the time limit by level, sandbag posts by Mk (placed, in front of the Command Yard), none
  without fortifications, the AI counting them, a shaken garrison and one no longer shaken, the
  attacker base by staging city and the fixed base on battle rules 2, a cut-off defender's credits.
- Battle into war: seeding (and refused when lost, for farms, twice, with no room), the engine
  reporting a refinery built and not reporting what was brought; ore returned and capped, refused
  for the loser, a retreat, junk numbers and an auto-resolve; raised troops on a win and a loss and
  the old loss on battle rules 2; a report with links refused for a setup without them; wounds,
  refused for infantry or a dead unit, the half-health arrival, repair and waiting for stock;
  decisive trust and shaken regions through the next turn and cleared after, and nothing for a
  close result.
- The flag spot, the round 7 markers balanced in each shared sim file, and no clock or dice in
  `sim/planetLinks.ts`.
- The computer factions: no attack from a cut-off region with more than 2 regions (where battle
  rules 2 would attack), an attack when down to 2, and the edge values.
- Older wars: a war on battle rules 2 on each preset, 25 turns with every open attack set up, and
  another played to its end on Hard, give the hashes recorded from this branch's base (f0c993e);
  the v1 fixture hashes in `drive-planet-battle.ts` still hold. A battle rules 3 war replays
  byte-identically on Short and Long and meets depots, support, walls, shaken regions and wounds.
  A save with a battle rules 3 setup, a shaken region and a wounded tank migrates to itself; junk
  links drop the setup; a battle in progress keeps its support and wave through a save; a
  simulated battle rules 3 battle gives a valid report the reducer accepts.

The existing whole-war checks (every turn, the 48 KB budget, all three presets, replay) now play
battle rules 3 wars, since new wars start on it.

## Results

- `npx tsc --noEmit -p packages/fireline/tsconfig.json`: clean.
- `npm run drive:planet`: 33,556 assertions, 0 failed (134 of them in the new sections).
- `npm run campaign:fire`: 7,699 assertions, 0 failures.
- `npm run drive:fire`: 401,689 assertions, 0 failed (1,466 s on a shared machine).

## Known gaps

- Neutral sites stay off in planet battles (round 6 states `sites: false`), so link 6's site bonus
  has nothing to read.
- The time limit and the wave's tick do not move the instant auto-resolve, which reads strength only;
  they matter in fought and simulated battles.
- The sandbag posts stand a tile apart (the opening layout's lane rule), a staggered line rather than
  a wall.
- The planet AI does not yet build institutes, citadels or ports to earn support and depots; it
  only values them where they already stand.
- Recon support for a computer seat does nothing (the computer already sees the whole map), as with
  every skirmish recon.
