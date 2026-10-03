# Thrash Margin: design document

Territory strategy where warfare and economics are one ledger. This document states the rules as
built, the numbers behind them, and the build log. Code: `packages/thrash-margin/`. Engine:
`shared/sim/`. Harness: `npm run drive:tm`.

---

## 1. The loop

Each turn a faction spends **action points** on strategic moves, recruits with gold, then ends
its turn. Ending a turn collects income and feeds the army, then every AI faction plays in id
order until the next human's turn. A round is complete when play returns to the lowest living
faction; `turn` counts rounds.

| Action | Action points | Notes |
|---|---|---|
| Attack | 2 (1 with Iron Will) | Columns from every bordering territory may join one assault |
| March | 1 next door, 2 farther | Any destination reachable through your own land |
| Build or upgrade a building | 1 | |
| Raise a settlement | 1 | |
| Research | 1 | |
| Annex a neutral | 1 | Diplomacy only |
| Spy (watch or sabotage) | 1 | Spies only |
| Ceasefire | 1 | Diplomacy only |
| Recruit | 0 | Costs gold; capped by territory capacity |
| Trade at the exchange | 0 | Needs a market; 4 lots per resource per turn |

Presets give 5 action points (6 on Easy). 99 means unlimited for humans; AI factions are capped at 7.

## 2. Economy

| Resource | Source | Spent on |
|---|---|---|
| Gold | Settlement level, capital (+2), strongholds (+3), coast (+2), markets | Recruits, buildings, upgrades, research, trade |
| Food | Settlement level (1-4), capital (+3), farms, forest (+1) | Upkeep: 1 per troop per turn |
| Materials | Capital (+2), mines, mountain and desert (+1) | Buildings, upgrades, research |
| Population | Farms (1/2/3 per tier) | Settlement levels 5 and above |
| Influence | 1 per 3 territories + 1 per market, with diplomacy or spies on | Annexation, ceasefires, spies |

**Starvation.** If food would go below zero, each missing unit kills one troop, taken from the
largest garrison first (ties to the lowest id). Supply Lines halves it.

**Settlement levels** (1-8) add slots, troop capacity, gold and food. Level costs rise steeply in
materials; level 5 onwards also needs population.

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Slots | 1 | 2 | 3 | 4 | 5 | 5 | 6 | 6 |
| Gold | 2 | 3 | 4 | 6 | 8 | 11 | 14 | 18 |
| Food | 1 | 1 | 2 | 2 | 3 | 3 | 4 | 4 |
| Troop capacity | 6 | 10 | 14 | 18 | 22 | 28 | 34 | 42 |

**Buildings** (one slot each; upgrades replace in place): Farm → Large Farm → Granary; Mine → Deep
Mine → Foundry; Barracks → Fort; Market → Grand Market; Tower → Fortress.

**The exchange.** With a market, buy 5 materials for 15 gold or 5 food for 6 gold; sell for half.

## 3. Combat

Fully deterministic. Strength = troops × (1 + human bonus) × (1.25 with Siege Craft). Defence =
garrison + capital (3) + level (the level number above 1) + towers (4/8, ×1.5 with Fortifications)
+ terrain (mountain +3, forest -1).

| Odds | Result | Attacker loses |
|---|---|---|
| 2.5 : 1 | Rout | 15% |
| 1.8 : 1 | Decisive | 35% |
| 1.3 : 1 | Costly | 55% |
| 1.0 : 1 | Pyrrhic | 80% (at least one survives) |
| 0.75 : 1 | Repelled | all; defenders lose 55% |
| 0.5 : 1 | Beaten back | all; defenders lose 25% |
| below | Slaughtered | all |

**Combined assaults.** An attack names a main column and any number of supporting columns from
other bordering territories; they fight as one force and the survivors occupy the target. Without
this, a fortified capital could out-defend the capacity of every territory next to it and never
fall (the prototype had exactly that stalemate).

**Capitals.** One per living faction. A captured capital stops being a capital; the victor
plunders 25% of the loser's gold, and the loser's court moves to its best remaining territory.

## 4. Factions, AI and difficulty

Every faction, human or AI, has its own treasury, research, treaties, spy reveals and statistics.
The AI plays through the same action handlers as a human, from its own treasury and action points.
Its planner is a priority list: fix food, reinforce a threatened border, take a fight worth having
(pricing in whether it can hold what it takes), stage troops for the next fight, raise capacity
for a siege, march idle troops to the front, then grow the economy.

Difficulty applies to AI factions only:

| | Income | Action points | Attacks from | Focus on humans |
|---|---|---|---|---|
| Easy | 70% | -1 | 1.8 : 1 | 0.5 |
| Normal | 100% | ±0 | 1.3 : 1 | 1.0 |
| Hard | 120% | ±0 | 1.3 : 1 | 1.5 |
| Brutal | 140% | ±0 | 1.0 : 1 | 0.8 |

Presets (every rule toggle stated explicitly):

| | Rivals | Rival start | Garrison scale | Neutrals | Your bonus | Rules on |
|---|---|---|---|---|---|---|
| Easy | 1 | 1 territory | 0.75 | 2 | +25% | events, tech |
| Normal | 1 | 1 territory | 1.0 | 3 | 0 | events, tech |
| Hard | 2 | 2 territories, built | 1.0 | 4 | 0 | everything |
| Brutal | 3 | 2 territories, built | 1.25 | 5 | 0 | everything |

**Balance, 150 seeds on Heartlands, the AI standing in for the player** (a regression signal, not
a prediction of human results; a person who plans sieges should do better):

| Easy | Normal | Hard | Brutal |
|---|---|---|---|
| 100% (avg 23 turns) | 79% (27) | 20% (22) | 11% (24) |

## 5. Victory

- **Conquest:** the last faction standing. In single player the game ends the moment faction 1
  falls; in hot seat it continues while either human lives.
- **Economic** (alternative victories on): hold the target in gold at the end of your own turn.
  AI factions' target scales by their income multiplier, so the race is the same effort for all.
- **Research** (alternative victories and tech tree on): complete any branch.

Rivals can win all three ways.

## 6. Maps

Each map declares a start layout per rival count, and a rival never starts next to the player's
capital. The lobby caps rivals at what a map seats.

| Map | Territories | Rivals | Character |
|---|---|---|---|
| Tutorial | 8 | 1 | Coached first game |
| Heartlands | 20 | 1-3 | Balanced grid |
| The Narrows | 14 | 1-2 | Two flanks, a two-territory pass |
| Crossroads | 16 | 1-3 | Four arms, a mountain centre |
| Frontier | 18 | 1-3 | Open staggered grid |
| Grand Continent | 34 | 1-3 | Long economic game |
| Random | 28 | 1-3 | Generated from the seed: terrain, names, strongholds, missing roads |

## 7. Events, diplomacy, spies, tech

**Events** are drawn from a weighted pool at the start of a human's turn from turn 2, through the
seeded stream. A choice event must be answered before anything else; an unaffordable choice is
refused, and every choice set has a free option.

**Diplomacy:** annex an adjacent neutral for 20 influence (12 with Colonisation; half its militia
joins you); buy a 4-round ceasefire with any faction for 30 influence, binding both sides.

**Spies:** watch a territory for 3 turns (15 influence, fog of war only); sabotage an adjacent
rival territory's best building down a tier (25 influence).

**Tech tree:** three branches of four. Military: Iron Will, Siege Craft, War Doctrine, Total War.
Economic: Trade Routes, Industrialisation, Supply Lines, Market Dominance. Expansion: Cartography,
Colonisation, Fortifications, Grand Strategy.

## 8. Saves

State is `version: 2`. `migrateState` upgrades a version 1 (prototype) save: factions built from its
single treasury, a seed derived from its id, duplicate capitals resolved, its log and history
reshaped, a pending event rebuilt from the current definition. The cloud hook saves every change
(debounced 700 ms, flushed on End Turn and on page hide).

---

## Build log

### The overhaul (October 2026)

The prototype engine was a single 1,700-line file with a 1,800-line game screen. An audit found:

1. **Rival factions were mostly fake.** Five of seven maps hard-coded every rival slot to faction
   2, so Hard and Brutal's "2-3 factions" on the default map produced one faction with two capitals.
2. **Hot seat shared one treasury and one research list**, and player 2 never earned income.
3. **The AI conjured troops from gold** every turn, paid nothing for buildings, ignored food and
   attacked without limit, so difficulty had nothing to do with the economy the player managed.
4. **Capturing a capital gave the captor a second capital.**
5. **Choice events auto-paid on End Turn** (the merchant and the rebels took gold unasked).
6. **Influence never accrued with spies alone**, so the spy panel was unusable without diplomacy.
7. **Achievements grepped a capped log**, so a long game could forget what it had counted.
8. **Illegal clicks wrote complaints into the battle log.**
9. **Cloud saves happened only on End Turn**: a reload mid-turn lost the turn.
10. **Non-deterministic**: Math.random and Date.now throughout.

The rebuild split the engine by concern under the Tea Race's purity rule, gave every faction its
own state, and made the AI play by the human's rules. Measuring it then surfaced four structural
problems the prototype also had, each fixed and re-measured:

- **Fortified capitals could never fall.** No single territory can hold enough troops to beat a
  capital with towers on a mountain. Fixed with combined assaults.
- **Armies starved by turn 3.** Settlements produced no food, so a new player's eight troops ate
  eight against a capital that grew two. Every settlement level now yields food.
- **Border territories flipped back and forth every turn**, bleeding both sides into stalemate.
  The AI now prices in being retaken, and leaving a column too thin to hold.
- **Action points went on bookkeeping.** With recruiting at 1 action, the AI (and a player) spent
  turns on two-troop recruits while materials piled up. Recruiting now costs gold only, and presets
  give 5 actions; median game length on Normal fell from over 60 turns to 27.

The economic victory, scaled for AI income, stopped being the rivals' main route to winning.

New: the exchange, marches through friendly land, per-player turn dispatches, the ledger,
undo within a turn, a seeded random map, a coached tutorial, version 1 save migration, and a rules
harness of about 12,000 assertions.
