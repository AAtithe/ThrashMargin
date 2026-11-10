# Fireline: War for the Planet (the contract)

Status (2026-11-10): W1 to W5 are built and in `npm run check` (see the build log, section 20).
Five workstreams (W1 to W5) implemented strictly from this file. Where the code and this file
disagree on a name or a number, this file wins; where this file is silent, follow the existing
pattern of round 5 (`fireline-round5-design.md`) and the campaign (`src/campaign/`), and say so in
your workstream's build log at the end of this file.

Base: the proposal `fireline-long-campaign-design.md` ("Theatre of War"). This contract keeps its
shape (a seeded strategic map, battles generated from it, a persistent army, research and heroes,
encirclement, auto-resolve, a new save kind, length presets) and extends it to a whole planet held
by three to five factions, with cities, four resources, trade and diplomacy. Where the two differ,
this file wins. The proposal's name "theatre" is not used in code: everything here is "planet".

Read first: `CLAUDE.md` (invariants), `fireline-round5-design.md` (development lines, doctrines and
loadouts, which this mode uses as its research), `src/sim/sides.ts` (teams), `src/sim/state.ts`
(`createInitialState`), `src/campaign/save.ts` (the save pattern).

All paths are relative to `packages/fireline/` unless they start with `scripts/` at the repo root,
`api/` at the repo root, `shared/`, or name a root document.

---

## 0. Rules that hold throughout

- **Sign-in.** Every game needs a signed-in account. Nothing here adds a guest, demo or local-only
  path, and nothing touches `getUser`, `requireUser` or `api/play/[kind].ts`. The planet war is one
  more save kind in Fireline's existing endpoint, behind the same 401 and 403 as every save.
- **Purity.** `src/planet/` (all of it, including the battle generator and the auto-resolve
  formula) and `src/sim/` are pure: no `Math.random`, no `Date.now`, no `performance.now`, no
  timers. Dice come from `src/sim/rng.ts` (`next`, `stream`, `seedFromString`) against a seed held
  in the state or derived from the war's seed text. Times (`createdAt`) are passed in by the
  caller. No React and no DOM in `src/planet/`.
- **Refused actions.** An illegal action returns **the very same state object** (reference
  equality). A legal action returns a new object and never mutates its input (the harness
  deep-freezes inputs).
- **Presets state every option.** Each length preset lists every key of `PlanetOptions`
  explicitly; the harness asserts the key sets are equal, so a new option cannot leak in by
  omission.
- **Old saves load and play unchanged.** Skirmish saves, campaign saves and story missions are
  untouched in behaviour. Every engine hook below is an optional field that is absent on every
  existing state, and every hook's code path is guarded by that field.
- **Story missions replay byte-identically.** The planet war does not use `MissionSpec` or
  `createMissionState` at all (section 9.1 says why), so missions see no change beyond pure
  refactors that the harness proves byte-identical.
- **Colours** are CSS tokens in both the light `:root` block and the `:root[data-theme="dark"]`
  block of `src/styles.css`, under one heading of their own. Never a hex literal in a component or
  in canvas code, never hex alpha appended to a token.
- **Queries** are read with `queryParam(req, name)`, never `req.query`.
- **Shared portal code** (`shared/portal/`) is not edited by this round. If a workstream finds it
  must, it edits the original and runs `npm run sync-shared`; never a copy.
- **Writing.** British English. No em dashes and no emojis anywhere (code comments, UI copy, docs,
  journal text, commit messages).
- **Git.** Agents do not run `git add`, `commit`, `stash`, `checkout` or `reset`. Other agents edit
  this tree at the same time: touch only the files your workstream owns (section 16).

---

## 1. Summary

A third way to play Fireline, beside skirmish and the story campaign: **War for the Planet**. The
player names a Commander, picks a length (Short, Long, Very long), a difficulty, the number of
factions (3 to 5) and a few optional rules, and a seed grows a planet:

- **The planet**: 18, 36 or 60 regions on 2, 3 or 4 continents, separated by seas. Each region has
  a terrain that is one of the six skirmish map types, an ore level, and one city.
- **Factions**: the player (the Meridian Corps) and two to four computer factions, each with a
  capital, a temperament (expansionist, mercantile or defensive) and a trust score toward every
  other faction. Unclaimed regions are held by independent militias.
- **Cities** are built up between battles: a city level (1 to 5) and up to seven kinds of building
  (refinery district, farms, factory, research institute, fortifications, port, airfield), each at
  Mk 1 to Mk 3. Buildings yield resources and science, and decide what the defender starts with
  when the region is fought over.
- **Resources**: ore, fuel, alloys, food. Produced by regions and cities, spent on cities, armies,
  research purchases, attacks and trade. A supply network links regions to the capital; regions
  cut off produce half and, after a few turns, surrender.
- **Trade**: routes between your own cities (ore and food), routes to a trading partner's city
  (fuel and alloys to both), and treaty terms that exchange resources each turn at agreed rates.
  A route whose path is lost is blockaded and pays nothing.
- **Diplomacy** among all factions, the computer factions with each other too: war, ceasefire,
  trade pact, alliance; treaties with terms (tribute, exchange, route access, a split of target
  regions, a one-off payment) and durations. Breaking a dated treaty costs trust with everyone.
  Allies bordering a contested region join the battle as a team.
- **A turn**: build, recruit, research, trade, negotiate, move the field army, and attack one
  neighbouring region. Each attack is an ordinary Fireline battle on the region's map type, with
  2 to 4 sides on 2 teams, the defender's city as its base, and both sides' research, doctrines
  and loadouts already in place. The player fights it or auto-resolves it.
- **What carries**: the field army (individual units with their kills and rank), four heroes with
  xp, the Commander and perks, research with doctrines and loadouts.
- **Saves**: one row, `kind: 'planet'`, holding the current state only (the map is regenerated
  from the seed), plus the battle in progress. Hard budgets: 48 KB for the strategic part, 256 KB
  for the whole save, against the portal's 512 KB per save.

---

## 2. The turn

One turn is one round of orders by every faction.

1. **Defence phase.** If computer factions attacked the player at the end of the last turn, each
   attack is a pending battle. The player resolves them in order (fight or auto-resolve) before
   any other order.
2. **Orders phase (the player).** Any number of economy, research, trade and diplomacy actions;
   field army moves (up to `armyMove` hops); at most one attack by the field army. An attack makes
   a pending battle, which the player resolves (fight or auto-resolve) before further orders.
3. **End turn.** The player presses End turn. Then, in one pure call:
   1. each computer faction, in faction id order, plans and applies its orders through the same
      reducer (section 12). Attacks between computer factions and on independents are resolved
      at once by the auto-resolve formula. Attacks on the player are recorded as intents;
   2. production for every faction (section 6.6);
   3. eliminations and the victory check (section 11);
   4. `turn` increases by one;
   5. each recorded intent against the player still valid becomes a pending defence battle.

Phases are derived, never stored: `'over'` when `result` is set; `'battle'` when `pending[0]` has
`fighting: true`; `'pending'` when `pending` is not empty; otherwise `'orders'`.

---

## 3. Presets and options

### 3.1 Options (`src/planet/types.ts`)

```ts
export type LengthPreset = 'short' | 'long' | 'veryLong';

export interface PlanetOptions {
  preset: LengthPreset;
  /** Factions including the player: 3, 4 or 5. Player-adjustable. */
  factions: 3 | 4 | 5;
  /** Regions on the planet. */
  regions: number;
  /** Continents. */
  continents: number;
  /** Regions each faction holds at the start, its capital included. */
  startRegions: number;
  /** Turns of ceasefire between every pair of factions at the start. */
  openingTruce: number;
  /** Most units in a field army. */
  armyCap: number;
  /** Hops a field army may move in one turn. */
  armyMove: number;
  /** Most heroes the player may bring into one battle. */
  heroesPerBattle: number;
  /** Turns a cut-off region holds out before it surrenders. */
  surrenderTurns: number;
  /** Percentage of all regions that wins the war (domination). */
  victoryShare: number;
  /** The war is decided on regions held at the end of this turn. */
  turnLimit: number;
  /** The player wins when the player's alliance holds victoryShare. Player-adjustable. */
  alliedVictory: boolean;
  /** A hero who falls is lost for the rest of the war. Player-adjustable. */
  ironRule: boolean;
  /** Offer "Simulate" (the engine plays the battle out) beside the instant auto-resolve. Player-adjustable. */
  simulatedAutoResolve: boolean;
  /** Computer factions make and break treaties with each other (they always negotiate with the player). Player-adjustable. */
  aiDiplomacy: boolean;
  /** Battle length: when it runs out, the defending team wins. */
  battleMinutes: number;
  /** Multiplier on independent militia garrisons. */
  neutralStrength: number;
}

/** Every key of PlanetOptions, in this order. The harness compares each preset's keys with it. */
export const OPTION_KEYS: (keyof PlanetOptions)[]; // every key, in the order of the interface above
/** The keys a player may change in setup; every other key is forced to the preset's value. */
export const ADJUSTABLE_OPTIONS: (keyof PlanetOptions)[] = ['factions', 'alliedVictory', 'ironRule', 'simulatedAutoResolve', 'aiDiplomacy'];
```

### 3.2 Presets (`src/planet/rules.ts`, `PRESETS: Record<LengthPreset, PlanetOptions>`)

| Option | short | long | veryLong |
|---|---|---|---|
| preset | `'short'` | `'long'` | `'veryLong'` |
| factions | 3 | 4 | 5 |
| regions | 18 | 36 | 60 |
| continents | 2 | 3 | 4 |
| startRegions | 2 | 3 | 3 |
| openingTruce | 3 | 5 | 8 |
| armyCap | 10 | 14 | 18 |
| armyMove | 2 | 2 | 2 |
| heroesPerBattle | 2 | 2 | 2 |
| surrenderTurns | 2 | 2 | 3 |
| victoryShare | 60 | 65 | 70 |
| turnLimit | 40 | 90 | 160 |
| alliedVictory | true | true | true |
| ironRule | false | false | false |
| simulatedAutoResolve | false | false | false |
| aiDiplomacy | true | true | true |
| battleMinutes | 20 | 20 | 25 |
| neutralStrength | 1 | 1.2 | 1.4 |

Typical play time (to be measured by `ladder:planet`, not asserted): Short about 3 hours, Long
about 8, Very long 15 or more, at about one fought battle in three.

```ts
/** A full option set: preset values, with ADJUSTABLE_OPTIONS taken from raw when valid. */
export function normaliseOptions(raw: unknown, preset: LengthPreset): PlanetOptions;
```

`factions` is clamped to 3..5 and to at most `floor(regions / 4)`; booleans must be booleans; any
other value falls back to the preset's.

### 3.3 Difficulty

`Difficulty` from `src/sim/rules.ts` (`'easy' | 'normal' | 'hard'`), chosen once per war, stored on
the state. It sets every battle's `s.difficulty` and these strategic numbers:

```ts
export const AI_INCOME: Record<Difficulty, number> = { easy: 0.8, normal: 1, hard: 1.25 };   // computer factions' yields
export const AI_ARMY_BONUS: Record<Difficulty, number> = { easy: -2, normal: 0, hard: 2 };    // added to armyCap for computer factions
export const QUICK_DIFFICULTY: Record<Difficulty, number> = { easy: 0.85, normal: 1, hard: 1.15 }; // computer sides' strength in a player's auto-resolve
```

---

## 4. Types (`src/planet/types.ts`)

W1 writes this file first, verbatim from this section plus section 3.1, before anything else; W2,
W3 and W4 type against it from the start. Additions later are additive and optional.

```ts
import type { Difficulty, HeroKind, LineId, MapType, ModuleId, OreLevel, UnitKind, UpgradeId, BuildingKind, SupportPower } from '../sim/rules';
import type { AiMode, Perks } from '../sim/types';
import type { PerkId } from '../campaign/types';

export type FactionId = number;          // 0..4; 0 is always the player
export const NEUTRAL = -1;               // owner of an independent region
export type RegionOwner = FactionId | -1;
export type RegionId = number;           // index into regions, 0..regions-1

export type Resource = 'ore' | 'fuel' | 'alloys' | 'food';
export const RESOURCES: Resource[] = ['ore', 'fuel', 'alloys', 'food'];
export type Stock = Record<Resource, number>;  // non-negative integers, always

export type Temperament = 'expansionist' | 'mercantile' | 'defensive';
export type CityBuildingId = 'refinery' | 'farms' | 'factory' | 'institute' | 'fortifications' | 'port' | 'airfield';
export const CITY_BUILDINGS: CityBuildingId[] = ['refinery', 'farms', 'factory', 'institute', 'fortifications', 'port', 'airfield'];

/** Unit kinds a field army or garrison may hold. No haulers, aircraft or heroes. */
export type ArmyKind = 'rifleman' | 'rocketeer' | 'grenadier' | 'medic' | 'buggy' | 'tank' | 'artillery' | 'flametank' | 'missilecarrier' | 'bastion' | 'flaktrack';
/** Fixed order: a garrison is a number[] of this length, counts in this order. */
export const ARMY_KINDS: ArmyKind[] = ['rifleman', 'rocketeer', 'grenadier', 'medic', 'buggy', 'tank', 'artillery', 'flametank', 'missilecarrier', 'bastion', 'flaktrack'];

// ---- Static geometry: regenerated from the seed, never saved ---------------------------------

export interface PlanetLink { a: RegionId; b: RegionId; sea: boolean }

export interface RegionGeo {
  id: RegionId;
  /** "Varnemere Highlands". */
  name: string;
  /** "Varnemere". */
  city: string;
  x: number;               // 0..PLANET_W
  y: number;               // 0..PLANET_H
  continent: number;
  terrain: MapType;
  ore: OreLevel;
  coastal: boolean;
  /** Neighbours by link, sorted by id. */
  links: { to: RegionId; sea: boolean }[];
}

export interface ContinentGeo { id: number; x: number; y: number; rx: number; ry: number; terrain: MapType }

export interface PlanetMap {
  w: number;
  h: number;
  name: string;            // the planet's name
  continents: ContinentGeo[];
  regions: RegionGeo[];
  links: PlanetLink[];     // each once, a < b, sorted by (a, b)
}

// ---- Dynamic state: saved ---------------------------------------------------------------------

export type BuildingLevel = 1 | 2 | 3;

export interface CityState {
  level: 1 | 2 | 3 | 4 | 5;
  /** Buildings present, by kind, at Mk 1..3. Absent: not built. */
  b: Partial<Record<CityBuildingId, BuildingLevel>>;
  /** Turn of the last build or growth here (one per city per turn), or -1. */
  built: number;
}

export interface RegionState {
  owner: RegionOwner;
  city: CityState;
  /** Counts per ARMY_KINDS index, length ARMY_KINDS.length. */
  garrison: number[];
  /** Consecutive turns this region has been cut off from its owner's capital. */
  cut: number;
}

export interface CoreUnit { kind: ArmyKind; kills: number }

export interface FieldArmy {
  region: RegionId;
  units: CoreUnit[];
  /** Hops moved this turn. */
  moved: number;
  /** Attacked this turn (one attack per turn). */
  attacked: boolean;
}

export interface FactionResearch {
  /** Upgrade being researched, or null. */
  current: UpgradeId | null;
  /** Science put into `current`. */
  points: number;
  /** Finished, in order. */
  done: UpgradeId[];
  doctrines: Partial<Record<LineId, UpgradeId>>;
  loadouts: Partial<Record<UnitKind, ModuleId[]>>;
}

export interface FactionState {
  id: FactionId;
  name: string;
  /** null for the player. */
  temperament: Temperament | null;
  alive: boolean;
  capital: RegionId;
  stock: Stock;
  research: FactionResearch;
  army: FieldArmy | null;
}

export type TreatyKind = 'ceasefire' | 'trade' | 'alliance';
export type Stance = 'war' | TreatyKind;

export type TreatyTerm =
  | { k: 'tribute'; from: FactionId; res: Resource; amount: number }                                     // each turn
  | { k: 'exchange'; from: FactionId; give: Resource; giveAmount: number; get: Resource; getAmount: number } // each turn, both ways
  | { k: 'access'; grantor: FactionId }                                                                  // grantor's regions open to the other
  | { k: 'split'; regions: [RegionId, FactionId][] }                                                     // third-party regions assigned to a signatory
  | { k: 'payment'; from: FactionId; res: Resource; amount: number };                                    // once, at signing

export interface TreatyDraft {
  kind: TreatyKind;
  /** Length in turns, or null for open-ended (trade and alliance only). */
  turns: number | null;
  terms: TreatyTerm[];
}

export interface Treaty extends TreatyDraft {
  a: FactionId;            // a < b
  b: FactionId;
  since: number;           // turn signed
  ends: number | null;     // last turn in force, or null
}

export interface TradeRoute { id: number; owner: FactionId; from: RegionId; to: RegionId }

export interface Offer { id: number; from: FactionId; draft: TreatyDraft; expires: number }

export interface PlanetHero {
  unlocked: boolean;
  xp: number;
  wounded: boolean;
  /** Iron rule only: fell and is lost for the war. */
  lost: boolean;
}

export interface JournalEntry { turn: number; text: string; tone: 'info' | 'good' | 'bad'; f?: FactionId }

export interface PlanetResult {
  won: boolean;
  how: 'domination' | 'elimination' | 'alliance' | 'turnLimit' | 'fallen' | 'rival';
  turn: number;
}

export interface PendingBattle {
  id: number;
  kind: 'attack' | 'defence';
  region: RegionId;
  attacker: FactionId;
  defender: RegionOwner;
  /** Frozen when the battle is created; the battle is built and judged from this alone. */
  setup: BattleSetup;
  /** The player chose to fight: the save's `battle` holds the GameState. */
  fighting: boolean;
}

export interface PlanetState {
  version: 1;
  seedText: string;
  /** Strategic dice; advanced and stored by the reducer whenever it draws. */
  rngSeed: number;
  createdAt: number;
  options: PlanetOptions;
  difficulty: Difficulty;
  turn: number;            // starts at 1
  regions: RegionState[];
  factions: FactionState[];
  /** trust[a][b]: how far faction a trusts faction b, integer 0..100. Diagonal 100. */
  trust: number[][];
  treaties: Treaty[];      // at most one per pair, sorted by (a, b)
  routes: TradeRoute[];
  offers: Offer[];         // to the player, at most OFFERS_MAX
  pending: PendingBattle[];
  commander: { name: string; xp: number; points: number; perks: Partial<Record<PerkId, number>> };
  heroes: Record<HeroKind, PlanetHero>;
  nextId: number;
  journal: JournalEntry[]; // newest last, at most JOURNAL_MAX
  result: PlanetResult | null;
}

// ---- The W1/W2 interface ---------------------------------------------------------------------

export interface BattleUnit { kind: ArmyKind; kills: number; /** Field army slot, or null for garrison or contingent units. */ core: number | null }

export interface BattleSide {
  faction: RegionOwner;
  role: 'attacker' | 'defender' | 'ally';
  /** 0 the attacking coalition, 1 the defending coalition. */
  team: 0 | 1;
  /** True for the player as attacker or defender (never as an ally). At most one side. */
  human: boolean;
  /** Always starts with 'hq'. */
  structures: BuildingKind[];
  /** Parallel to structures: the city building a structure stands for, or null. Defender principal only. */
  cityTags: (CityBuildingId | null)[];
  credits: number;
  units: BattleUnit[];
  heroes: { kind: HeroKind; xp: number; wounded: boolean }[];
  upgrades: UpgradeId[];
  doctrines: Partial<Record<LineId, UpgradeId>>;
  loadouts: Partial<Record<UnitKind, ModuleId[]>>;
  ai: AiMode;
  /** Ally contingents: the region the units came from and return to. */
  fromRegion: RegionId | null;
}

export interface BattleSetup {
  battleId: number;
  turn: number;
  region: RegionId;
  regionName: string;
  /** `${seedText}:t${turn}:r${region}:b${battleId}` */
  seedText: string;
  mapType: MapType;
  ore: OreLevel;
  difficulty: Difficulty;
  /** 2..4 sides. Index is the battle seat (Owner). If a side is human it is index 0. */
  sides: BattleSide[];
  /** Index into sides of the principal defender; its Command Yard falling wins it for the attackers. */
  defenderSeat: number;
  /** battleMinutes * 60 * TICKS_PER_SECOND. */
  timeLimit: number;
  /** City level and building levels of the region, for auto-resolve and damage. */
  cityLevel: number;
  cityBuildings: Partial<Record<CityBuildingId, BuildingLevel>>;
  /** Commander perks and powers for the human side; null when no side is human. */
  perks: Perks | null;
  powers: SupportPower[];
}

export interface BattleReport {
  battleId: number;
  winner: 'attacker' | 'defender';
  how: 'fought' | 'quick' | 'simulated' | 'retreat';
  ticks: number;
  /** Same order and length as setup.sides. */
  sides: {
    faction: RegionOwner;
    /** Surviving infantry and vehicles of ARMY_KINDS (haulers, aircraft and heroes excluded), at most 60. */
    survivors: BattleUnit[];
    heroes: { kind: HeroKind; xp: number; alive: boolean }[];
  }[];
  /** Levels each city building loses (0 or absent: none). */
  cityDamage: Partial<Record<CityBuildingId, number>>;
  /** 1 when the city changed hands (its level drops by one, never below 1), else 0. */
  cityLevelLost: 0 | 1;
}
```

---

## 5. The planet map (`src/planet/map.ts`, W1)

```ts
export const PLANET_W = 1200;
export const PLANET_H = 600;
export function generatePlanet(seedText: string, options: PlanetOptions): PlanetMap;
export function planetProblem(m: PlanetMap, options: PlanetOptions): string | null;
/** Memoised generatePlanet keyed on seedText, regions and continents. Pure from the caller's view. */
export function planetMapOf(s: PlanetState): PlanetMap;
```

All draws come from one `stream(seedFromString(seedText + ':planet'))`. If `planetProblem` returns
a problem, retry with seed text `seedText + '#' + attempt` (attempt 1..20) for the geometry only;
the harness asserts no seed among 200 per preset needs more than 20 and reports how many retried.

1. **Continents.** `continents` centres by rejection sampling in x 150..1050, y 130..470, at least
   320 apart (after 200 failed tries, the minimum shrinks by 10 per cent, repeatedly). Sort by x;
   ids in that order. Each gets a weight `0.7 + 0.6 * float()`; regions per continent
   `round(regions * w / sum(w))`, at least 4, the rounding remainder added to or taken from the
   heaviest. Radii `rx = 75 * sqrt(n)`, `ry = 0.65 * rx`. Each continent's primary terrain:
   `MAP_TYPES[int(0, 5)]`.
2. **Sites.** Per continent, rejection-sample `n` points inside its ellipse, clamped to a 30-unit
   margin of the canvas, at least 46 apart (shrink 5 per cent after every 100 failures).
3. **Ids.** Sort all sites by (continent, x, y); the index is the `RegionId`.
4. **Land links.** Per continent: the Euclidean minimum spanning tree (Prim, from the lowest id),
   then every other pair in ascending distance order (ties by (a, b)) added when
   `d <= 1.6 * max(nn(a), nn(b))` (nn: distance to the nearest site on the continent), both
   degrees are below 5, and the segment crosses no existing link.
5. **Sea links.** Continent distance = the closest site pair between them. Take the minimum
   spanning tree over continents; for each tree pair add its closest site pair as a sea link, and
   its second closest pair (both sites different from the first pair) when within 1.3 times the
   first. For every other continent pair whose closest pair is within 420, add that pair. Degree
   caps do not apply to sea links.
6. **Coastal.** A region is coastal if it has a sea link or its distance from its continent's
   centre is at least 0.55 times the furthest site's on that continent.
7. **Terrain.** Per region: `float() < 0.5` gives the continent's primary terrain, otherwise
   `MAP_TYPES[int(0, 5)]`. **Ore level** by weighted draw (poor, normal, rich): plains 10/40/50,
   highlands 20/50/30, canyon 30/50/20, others 25/50/25.
8. **Names.** City name `CITY_START[int] + CITY_END[int]` (tables below), redrawn on a duplicate
   up to 50 times, then suffixed " II". Region name `${city} ${TERRAIN_NOUN[terrain]}`. Planet
   name `PLANET_NAMES[int]`.

```ts
export const CITY_START = ['Ar', 'Bel', 'Cor', 'Dun', 'Esk', 'Fal', 'Gar', 'Hol', 'Ist', 'Jor', 'Kel', 'Lun', 'Mar', 'Nor', 'Ost', 'Pell', 'Quar', 'Ros', 'Sel', 'Tor', 'Ulm', 'Var', 'Wen', 'Yar'];
export const CITY_END = ['ford', 'haven', 'mere', 'gate', 'wick', 'holm', 'stead', 'ton', 'by', 'mouth', 'crest', 'fall', 'reach', 'port', 'field', 'moor'];
export const TERRAIN_NOUN: Record<MapType, string> = { classic: 'Marches', river: 'Valley', highlands: 'Highlands', lakes: 'Lakes', plains: 'Plains', canyon: 'Canyons' };
export const PLANET_NAMES = ['Meridian', 'Kessa', 'Orrin', 'Tavor', 'Halcyon', 'Brume'];
```

`planetProblem` returns a problem when: the link graph is not connected; any continent has fewer
than 4 regions; any land link crosses another; there are 2 or more continents and fewer than
`continents - 1` sea links; any sea link joins two regions of one continent; any region has no
link. Capital spacing is checked in `newPlanetState`, not here.

### 5.1 The start (`newPlanetState`, W1)

Dice: `stream(seedFromString(seedText + ':start'))`, after the map is made.

1. **Capitals.** The first is drawn uniformly among regions with at least 2 links. Each next one is
   the region maximising its least BFS hop distance to the capitals so far (ties: more links, then
   lowest id). If two capitals end up fewer than 3 hops apart, regenerate the geometry with the
   next retry seed text (section 5); the harness counts these. Capitals are then dealt to factions
   by a seeded permutation, so the player is not always the first drawn.
2. **Start regions.** In rounds, faction 0 first: each faction claims one unowned region linked to
   its holdings, the one with the highest total terrain yield (ties lowest id), until each holds
   `startRegions`.
3. **Cities.** A capital: level 3 with `refinery 1, farms 1, factory 1, fortifications 1`. Other
   start regions: level 1 with `farms 1` (if terrain food is at least 2) or else `refinery 1`.
   Independent regions: section 9.3.
4. **Forces.** Each faction's field army stands in its capital: rifleman x 4, rocketeer x 2, tank x 2,
   buggy x 1, kills 0. Capital garrison: rifleman 4, rocketeer 2, tank 1. Other start regions:
   rifleman 3, rocketeer 1.
5. **Everything else.** Stocks `STARTING_STOCK`; research empty; trust 50 (diagonal 100); a
   ceasefire between every pair of factions (`turns: openingTruce`, `since: 1`,
   `ends: openingTruce`, no terms); heroes `engineer` and `commando` unlocked, xp 0; Commander xp 0,
   points 0; `turn: 1`; `rngSeed: seedFromString(seedText + ':war')`; `nextId: 1`; one journal entry
   naming the planet and the factions.

---

## 6. Economy, cities and armies (W1)

### 6.1 Values (`src/planet/rules.ts`)

```ts
/** Trade value of one unit of each resource; used by AI judgements and exchange rates. */
export const VALUE: Record<Resource, number> = { ore: 1, food: 1, fuel: 1.5, alloys: 2.5 };
export const STARTING_STOCK: Stock = { ore: 20, fuel: 12, alloys: 12, food: 20 };
/** Region yield per turn by terrain, before the ore level. Science is never from terrain. */
export const TERRAIN_YIELD: Record<MapType, { ore: number; fuel: number; food: number }> = {
  classic:   { ore: 2, fuel: 1, food: 2 },
  river:     { ore: 1, fuel: 1, food: 3 },
  highlands: { ore: 3, fuel: 0, food: 1 },
  lakes:     { ore: 1, fuel: 2, food: 2 },
  plains:    { ore: 2, fuel: 0, food: 4 },
  canyon:    { ore: 2, fuel: 3, food: 0 },
};
/** The terrain's ore is multiplied by k / 2, rounded down. */
export const ORE_K: Record<OreLevel, number> = { poor: 1, normal: 2, rich: 3 };
/** The defending team's strength multiplier in auto-resolve, by terrain. */
export const DEFENCE_TERRAIN: Record<MapType, number> = { highlands: 1.2, canyon: 1.15, river: 1.1, lakes: 1.05, classic: 1, plains: 0.95 };
```

### 6.2 Cities

- One city per region, level 1 to 5. A city holds at most `level + 1` distinct buildings, and no
  building above Mk `min(3, level)`.
- **Growth** (`growCity`) from level L to L + 1 costs `ore 6L, alloys 4L, food 8L`.
- **Upkeep**: each city eats `level` food per turn.
- One build or growth per city per turn (`city.built === turn` refuses a second).
- A region whose owner changes keeps its city, minus damage (section 9.5). If the city then holds
  more buildings than its slots, or a building above its level, buildings are cut back: levels
  clipped to the city level, then excess buildings removed in reverse `CITY_BUILDINGS` order.

Buildings (cost to build Mk L, from Mk L - 1; per-turn effect per Mk):

| id | Name (Mk 3 name) | Cost of Mk L | Requires | Yield per Mk | Battle (defender principal) |
|---|---|---|---|---|---|
| `refinery` | Refinery district | ore 6L, alloys 2L | | ore +2 | 1 `refinery` per Mk; side credits +500 per Mk |
| `farms` | Farms | ore 5L, alloys 1L | | food +2 | none |
| `factory` | Factory | ore 8L, alloys 3L, fuel 2L | | converts up to 2 ore into 2 alloys | `factory` at Mk 1; `repairbay` at Mk 2 |
| `institute` | Research institute | ore 6L, alloys 4L, food 2L | | science +2 | `researchlab` at Mk 1; `techcentre` at Mk 2 |
| `fortifications` | Fortifications (Citadel) | ore 6L, alloys 4L | | none | `turret` x 2 per Mk; `rocketturret` x 1 per Mk; `strikecommand` at Mk 3 |
| `port` | Port | ore 6L, alloys 2L, fuel 2L | coastal region | food +1 | none; enables sea moves, sea attacks and sea routes |
| `airfield` | Airfield (Spaceport) | ore 6L, alloys 4L, fuel 4L | | fuel -1 (upkeep) | `helipad` at Mk 1 (and a second at Mk 3); `flakcannon` x 1 per Mk |

The capital adds `ore +1, alloys +1, science +1` each turn.

Heroes unlock (once, permanently): Engineer and Commando at the start; the Spy the first time the
player holds an institute at Mk 2; the Ace the first time the player holds an airfield at Mk 2.

### 6.3 Field armies and garrisons

- Every faction has one **field army** (`FactionState.army`), capped at `armyCap` (computer
  factions `armyCap + AI_ARMY_BONUS[difficulty]`). Units are `CoreUnit`s: kind and kills; rank is
  derived with `VET_KILLS` (3 and 7) exactly as in battle.
- Every region has a **garrison** of counts. Cap: `4 + 2 * cityLevel + 3 * fortificationsMk`.
- **Recruit cost** (one unit), from `UNITS[kind].cost` (`c`):
  - infantry (rifleman, rocketeer, grenadier, medic): `food max(1, round(c / 100))`
  - vehicles: `alloys max(1, round(c / 250))`, `fuel max(1, round(c / 500))`
  - At the time of writing: rifleman food 1; rocketeer, grenadier, medic food 3; buggy alloys 2
    fuel 1; flaktrack 3 and 1; tank 3 and 2; artillery 4 and 2; flametank 4 and 2;
    missilecarrier 5 and 3; bastion 7 and 4. The formula wins over this list.
- Recruiting needs a region the recruiter owns: the army's region for the army, the garrison's own
  region for a garrison. Vehicles need a factory (any Mk) in that region. The army must stand in
  an owned region to recruit.
- **Upkeep** per turn: field army `food ceil(infantry / 3) + fuel ceil(vehicles / 2)`; garrisons
  `food ceil(total garrison units / 5)` per faction.
- **Militia**: each turn every faction's capital gains one rifleman while its garrison is below
  half its cap.
- **Movement** (`moveArmy`): along the shortest path (BFS, ties by lowest id at each step) through
  regions the faction owns or may pass (section 6.5), at most `armyMove - moved` hops. A sea link
  may be crossed only from a region with a port (any Mk) whose owner the mover may pass.

### 6.4 Research, doctrines, loadouts, perks

- The research tree is round 5's development lines (`LINES`, `UPGRADES`, `MODULES`,
  `MODULE_SLOTS` in `src/sim/rules.ts`). Science cost of an upgrade:
  `ceil(UPGRADES[id].cost / 250)`.
- One `current` project. Its prerequisites: the previous mark of its line in `done` (derived from
  `LINES`), and for a Mk III branch, the line's doctrine set to that branch. Switching `current`
  discards its points. Science each turn is added to `points`; at `points >= cost` the upgrade is
  appended to `done`, `current` becomes null and the excess is lost.
- `doctrine` commits a line to one branch, free and permanent, legal only after the line's Mk II.
- `loadout` sets modules per vehicle kind with the same rules as `loadoutProblem` in
  `src/sim/loadout.ts` (modules unlocked by `done`, fits, slots, no duplicates). W1 writes its own
  pure check against the same tables (it cannot call the GameState one).
- **Commander.** The story campaign's `PERKS` and costs. Ranks: `RANKS` from
  `src/campaign/progression.ts`, then `PLANET_EXTRA_RANKS = [{ name: 'Marshal', xp: 6500 },
  { name: 'Field Marshal', xp: 9000 }, { name: 'Supreme Commander', xp: 12500 }]`; one point per
  rank gained. Xp: a won attack `60 + 20 * cityLevel`, a won defence 50, a lost battle 15, plus
  `XP_PER_KILL` (2) per kill in fought battles only. Perks for a battle: call `perkModifiers` with
  `{ ...newCampaign(commander.name), commander }` (both exported by `progression.ts`); powers from
  `POWER_PERKS` for perks held.
- Heroes: wounded heroes start a battle at half health. A wounded hero heals at end of turn if the
  field army did not fight this turn, or at once with `healHero` for 3 food. Iron rule: a hero who
  falls is `lost` and cannot be brought again.

### 6.5 Passing, supply and encirclement (`src/planet/supply.ts`)

A faction `f` **may pass** a region owned by itself, by a faction allied with it, or by a faction
whose treaty with `f` holds an `access` term granted to `f`.

**Supply.** Each turn, BFS from `f`'s capital through regions `f` may pass (sea links only from a
passable region with a port). An owned region not reached is **cut off**: its yields are halved
(rounded down) and its `cut` counter rises by one; a reached region's `cut` returns to 0. The
capital is never cut off.

**Surrender.** A cut-off region with `cut >= surrenderTurns` that is adjacent (land or sea link)
to at least one region of a faction at war with its owner surrenders: it passes to the adjacent
enemy faction with the most adjacent garrison units (ties: lowest id), its garrison is emptied and
its city level drops by one (never below 1). A field army standing in a surrendering region
retreats (section 9.6). Journal entry for both.

**Capital lost.** The new capital is the owner's region with the highest city level (ties: larger
garrison, then lowest id).

### 6.6 Production (end of turn, every alive faction in id order)

1. **Yields** per owned region: terrain (ore `floor(base * ORE_K / 2)`), building yields, capital
   bonus; science from institutes and the capital. Cut-off regions: each value halved, rounded
   down. Computer factions: each total multiplied by `AI_INCOME[difficulty]`, rounded down.
2. **Routes** (section 7): each unblocked route pays its owner (and partner).
3. **Factories**: in region id order, each supplied factory converts `min(2 * Mk, stock.ore)` ore
   into the same number of alloys.
4. **Treaty flows** in treaty order: tributes and exchanges. A term whose payer cannot pay in full
   ends its treaty at once (not a breach; trust of the payee toward the payer -10).
5. **Upkeep**: cities (food), airfields (fuel), field army, garrisons. A shortfall leaves the
   resource at 0 and disbands one unit per unit of shortfall: food from garrisons first (the
   region with most units, ties lowest id, its last non-zero kind in `ARMY_KINDS` order is
   infantry first), then the army's last infantry; fuel from the army's last vehicles, then the
   garrisons' vehicles in the same order.
6. **Research** progress.
7. **Militia.**
8. **Supply and surrender** (section 6.5).
9. **Treaty expiry**: a treaty whose `ends` is this turn ends; trust between the two +5 each way.
   An ended ceasefire leaves the pair at war.
10. **Trust drift** (section 8.3), then offers past `expires` removed.
11. **Heroes** heal; field armies' `moved = 0`, `attacked = false`.

---

## 7. Trade (`src/planet/trade.ts`, W1)

- A **domestic route** joins two cities of its owner at least 2 hops apart. A **foreign route**
  joins one of its owner's cities to a city of a faction with which the owner has a trade pact or
  alliance.
- **Path**: the shortest path (BFS, lowest id ties) between the endpoints through regions the
  route owner may pass, plus, for a foreign route, regions the partner may pass; sea links only
  from a passable region with a port. At most `ROUTE_MAX_HOPS = 6` hops. The path is recomputed
  every turn and never stored. No path this turn: the route is **blockaded** and pays nothing. The
  path must exist when the route is opened.
- **Yield** with `y = 1 + floor((levelA + levelB) / 4)`: domestic, `y` ore and `y` food to the
  owner; foreign, `y` fuel and `y` alloys to the owner and to the partner each.
- **Cost** to open: alloys 4, fuel 2. **Cap** per faction:
  `min(8, 1 + floor(sum of city levels / 6) + sum of port Mks)`. A route whose endpoint changes
  hands, or whose foreign partner is no longer at trade or alliance, is removed at once.
- **Exchange terms** in a treaty flow only while at least one foreign route between the two
  signatories (either owner) is unblocked this turn. That is the blockade of trade deals.
- **Exchange rates.** An AI judges an exchange by `VALUE` with its temperament's
  `exchangeMargin` (section 8.4); the interface shows the fair rate `VALUE[give] / VALUE[get]`.

---

## 8. Diplomacy (`src/planet/diplomacy.ts`, W1)

### 8.1 Stance

`stanceOf(s, a, b)`: the kind of their treaty, or `'war'` with no treaty. Independents are always
at war with everyone and never negotiate. At the start every pair of factions has a ceasefire with
`ends = openingTruce` and no terms.

| Stance | May attack each other | Foreign routes and exchange | Pass each other's regions | Join battles together | Allied victory |
|---|---|---|---|---|---|
| war | yes | no | no | no | no |
| ceasefire | no | no | only with an access term | no | no |
| trade | no | yes | only with an access term | no | no |
| alliance | no | yes | yes | yes | yes |

### 8.2 Treaties

Validation of a `TreatyDraft` between `a` and `b` (both alive, `a !== b`, neither neutral):

- `ceasefire`: `turns` 3..20. `trade`: `turns` null or 5..40. `alliance`: `turns` null or 10..60.
- At most 4 terms. `tribute` and `exchange` amounts 1..20, resources valid, payer a signatory;
  `exchange` only in trade or alliance. `access` grantor a signatory, at most one per grantor.
  `split`: 1..4 entries, each region owned by a third faction or neutral, each assignee a
  signatory, no region twice. `payment`: 1..60, payer a signatory who holds it now.
- A new treaty between a pair that has one replaces it (not a breach). `since = turn`,
  `ends = turns === null ? null : turn + turns - 1`. Payments transfer at signing.
- **Split**: while the treaty stands, a signatory may not attack a region assigned to the other
  (refused unless it first cancels the treaty). When a signatory captures a region assigned to
  the other, it is handed over at the end of the turn with its garrison emptied (the capturer's
  field army steps back to the region it attacked from).
- **Breach**: `declareWar` on, or `cancelTreaty` with, a partner whose treaty has a future `ends`.
  Penalties: trust of the victim toward the breaker -30; trust of every other alive faction
  toward the breaker -10. Cancelling an open-ended treaty is not a breach: the partner's trust
  -5.

### 8.3 Trust (integers, clamped 0..100, start 50, `trust[a][a] = 100`)

| Event | Change |
|---|---|
| Each turn at trade | +1 both ways |
| Each turn at alliance | +2 both ways |
| Each turn at war | -1 both ways |
| Each turn both at war with a common faction | +1 both ways |
| Treaty runs to its end | +5 both ways |
| Tribute received (per turn) | receiver toward payer +1 |
| Payment or gift received | receiver toward giver `+min(15, floor(value / 5))` |
| Breach | victim -30, every other alive faction -10, toward the breaker |
| `b` attacks a region of `a`'s ally | `a` toward `b` -8 |
| Unpaid term ends a treaty | payee toward payer -10 |

`value` sums `amount * VALUE[res]`.

### 8.4 Temperaments (`TEMPERAMENTS: Record<Temperament, TemperamentSpec>`)

| Field | expansionist | mercantile | defensive |
|---|---|---|---|
| `attackRatio` (own / defender strength to attack a faction) | 1.2 | 1.6 | 2.0 |
| `neutralRatio` (the same against independents) | 1.0 | 1.3 | 1.5 |
| `mayBreak` | true | false | false |
| `ceasefireBias` | -15 | 15 | 20 |
| `tradeBias` | 0 | 25 | 10 |
| `allianceBias` | 5 | 5 | 15 |
| `allianceTrust` (minimum trust for an alliance) | 65 | 60 | 55 |
| `exchangeMargin` | 1.15 | 1.0 | 1.1 |
| `garrisonShare` (of recruitment spent on garrisons) | 0.3 | 0.4 | 0.6 |
| `build` (priority) | factory, refinery, farms, airfield, institute, fortifications, port, grow | refinery, farms, port, institute, grow, factory, fortifications, airfield | fortifications, farms, refinery, factory, institute, grow, airfield, port |
| `recruit` (cycle) | tank, tank, rocketeer, rifleman, artillery, flametank, buggy | rifleman, rocketeer, tank, buggy, missilecarrier | rocketeer, rifleman, tank, artillery, bastion, flaktrack |
| `research` (order) | calibration, engines, autoloaders, engines2, heat, motorised, plating, refining, plating2, reactive, airframes, avionics, munitions, refining2, assembly | refining, refining2, salvage, plating, calibration, engines, plating2, composite, autoloaders, highexplosive, engines2, fieldrepair, airframes, avionics, hardened | plating, plating2, composite, refining, calibration, autoloaders, highexplosive, engines, engines2, fieldrepair, refining2, assembly, airframes, avionics, hardened |
| `doctrines` | logistics assembly, armour reactive, engines motorised, weapons heat, air munitions | logistics salvage, armour composite, engines fieldrepair, weapons highexplosive, air hardened | logistics assembly, armour composite, engines fieldrepair, weapons highexplosive, air hardened |

Computer loadouts: round 5's Hard table (`tank: ['longbarrel', 'tracks']`, `bastion: ['longbarrel',
'tracks']`, `flametank: ['tracks', 'smoke']`, `buggy: ['fueltank']`), filtered to modules unlocked,
in table order. Temperaments are assigned at the start by a seeded permutation of the three; AI
faction `i` (1-based) takes `perm[(i - 1) % 3]`, so two computer factions never share one.

Faction names: player `'Meridian Corps'`; computer factions, in a seeded order, from
`['Ashen Combine', 'Tidewater League', 'Iron Concord', 'Verdant Directorate']`.

### 8.5 How a computer faction judges a proposal

```ts
export function proposalScore(s: PlanetState, judge: FactionId, other: FactionId, draft: TreatyDraft): { score: number; reasons: string[] };
export function proposalVerdict(s: PlanetState, judge: FactionId, other: FactionId, draft: TreatyDraft): { accept: boolean; score: number; reasons: string[] };
```

`P(f)` (power) = the strength (section 9.4, without modifiers) of all `f`'s garrisons plus its
field army. `borders(a, b)` = links between a region of `a` and a region of `b`. `T` = the judge's
temperament spec.

Score = kind base + terms + `(trust[judge][other] - 50) / 2`, where:

- ceasefire base: `(at war ? 10 : 0) + 25 * clamp((P(other) - P(judge)) / max(P(judge), 1), -1, 1)
  + 10 * (number of factions at war with the judge - 1) + T.ceasefireBias`
- trade base: `5 + T.tradeBias + (borders > 0 ? 5 : 0)`
- alliance base: `T.allianceBias + 20 * (factions at war with both) - 25 * (1 if other is at war
  with any faction the judge has a treaty with)`
- terms (from the judge's side): tribute to the judge `+amount * VALUE * min(turnsLeft, 10) / 4`,
  from the judge `-1.5` times that; exchange `3 * (VALUE[got] * gotAmount - T.exchangeMargin *
  VALUE[given] * givenAmount)`; payment to the judge `+VALUE * amount / 2`, from the judge
  `-VALUE * amount`; access granted by the judge `-10` (defensive `-20`), to the judge `+8`;
  split `+12` per region assigned to the judge, `-6` per region assigned to the other.
  `turnsLeft` for an open-ended treaty is 10.

Accept iff score is at least `ceasefire 0`, `trade 5`, `alliance 25`, and for an alliance
`trust[judge][other] >= T.allianceTrust`. The player's proposals to a computer faction are judged
at once: accepted, the treaty is in force; refused, the action is illegal (same state) and the
interface shows `proposalVerdict` before the player sends it.

---

## 9. Battles (W1 builds the setup, W2 builds and judges the battle)

### 9.1 Why skirmish, not MissionSpec

`createMissionState` and `evaluateMission` are two-sided throughout (`s.winner = 1`, two players,
`teams: [0, 1]`), and missions place structures and objectives by hand. Planet battles need 2 to 4
sides on 2 teams, generated maps and city-shaped bases. So W2 builds them on `createInitialState`
(the skirmish path, which already does sides, teams, starts and map types) and overlays the
planet's forces. `MissionSpec` gains nothing, so story missions are untouched by construction.

### 9.2 Who fights (`battleSetupFor`, W1)

- **Attack legality**: the attacker is alive, its army has not attacked this turn, the target is
  owned by a faction at war with the attacker or by independents, the army stands in a region the
  attacker owns that links to the target (a sea link only if that region has a port), the target
  is not assigned to a treaty partner by a split term, no pending battle exists, and the attacker
  can pay: fuel `2 + ceil(vehicles / 4)` and alloys `credits / 250` for chosen credits
  (`0 | 1000 | 2000 | 3000`).
- **Principals**: attacker (team 0), defender = the region's owner (team 1).
- **Allies** (at most one per team): a faction joins the attacker's team if it is allied with the
  attacker, at war with the defender (or the defender is independent), and owns a region linked to
  the target; similarly for the defender. Among candidates: highest trust toward the principal,
  then lowest id. A candidate that is the player joins as a computer contingent (never human).
- **Seats**: if the player is a principal, it is seat 0 and the other principal seat 1; otherwise
  the attacker is seat 0 and the defender seat 1. Allies follow: the attacker's ally, then the
  defender's ally. Three sides use a 3-sided map, four a 4-sided one.

### 9.3 What each side brings (W1)

| | Attacker principal | Defender principal | Ally contingent | Independent defender |
|---|---|---|---|---|
| structures | hq, power, power, refinery, barracks, factory; helipad if the attacker owns an airfield within 2 hops of the target | hq; power x `1 + ceil(n / 3)` where n is the count of other structures; barracks; then the city's buildings per section 6.2; uplink at city level 3 or more | hq, power, refinery, barracks | hq, power, barracks, refinery, turret x city level |
| cityTags | all null | the building each city structure stands for; null for hq, power, barracks, uplink | all null | all null |
| credits | `2500 + chosen credits + 300 * refinery Mk of the army's region` | `1500 + 500 * refinery Mk + 250 * city level` | 1500 | 1000 |
| units | the field army (core slots set) | garrison, then the field army if it stands there (core slots set), at most 40 in all | half (rounded down, at least 1) of the garrison of its linked region with most units; those leave the garrison | garrison |
| heroes | the player's chosen heroes (attack) | the player's unlocked, not lost heroes up to `heroesPerBattle`, in `HERO_KINDS` order, if the field army stands there (defence) | none | none |
| research | the faction's done, doctrines, loadouts | the same | the same | none |
| ai | `'normal'` | `'defend'` | `'normal'` | `'defend'` |

Every side's `structures[0]` is `'hq'`. Units beyond 40 per side are dropped from the end
(garrison units before core units). `perks` and `powers` are filled when a side is human.

Independent garrisons at generation: city level 1 `rifleman 3, rocketeer 1`; level 2 `rifleman 4,
rocketeer 2, tank 1`; each count multiplied by `neutralStrength`, rounded. Independent city
level: 2 with probability 0.3, else 1; a level 2 independent city has one Mk 1 building drawn from
`refinery, farms, fortifications`.

### 9.4 Strength (shared by the AI and auto-resolve)

```ts
// src/planet/rules.ts (W1)
export const unitValue = (k: ArmyKind): number => UNITS[k].cost / 100;
export const vetMul = (kills: number): number => (kills >= VET_KILLS[1] ? 1.5 : kills >= VET_KILLS[0] ? 1.25 : 1);
export const STRUCTURE_VALUE: Partial<Record<BuildingKind, number>> = { hq: 5, turret: 4, rocketturret: 6, flakcannon: 3, strikecommand: 6 }; // others 1
```

Side strength (W2, in `resolve.ts`):
`(sum unitValue * vetMul + sum 6 * heroLevel + credits / 200 + sum STRUCTURE_VALUE) * (1 + 0.03 *
upgrades.length) * diff`, where `diff` is `QUICK_DIFFICULTY[difficulty]` for computer sides in a
battle with a human side, else 1. Team A = sum of team 0; team D = sum of team 1 times
`DEFENCE_TERRAIN[mapType]`.

### 9.5 Auto-resolve (`quickResolve`, W2)

- Dice: `stream(seedFromString(setup.seedText + ':quick'))`.
- `p = A^2 / (A^2 + D^2)`; the attackers win iff `float() < p`.
- `q = min(A, D) / max(A, D)`. Loss share: losing team `0.55 + 0.35q`, winning team `0.1 + 0.4q`.
- Per side, in seat order: a seeded Fisher-Yates permutation of its unit indices; the first
  `round(share * units.length)` are lost. Each hero is lost if `float() < share / 2`. Heroes gain
  xp: winners 40, losers 10.
- Kills: each team's survivors, in seat then unit order, take one kill each round-robin until the
  number of units the other team lost is used up.
- City damage, per building at Mk L: attackers won, `round(L * q / 2)`; defenders won,
  `round(L * q / 4)`. `cityLevelLost` 1 iff the attackers won.
- `how: 'quick'`, `ticks: 0`.

**Fought battles** (`planetBattleReport`, W2): winner from `s.winner` and the teams; survivors are
units of `ARMY_KINDS` alive at the end, per seat, with `Unit.core` and `Unit.kills`; heroes alive
with their xp, fallen ones from `s.planet.fallen`. City damage per building: S structures placed for
it (from `s.planet.city`), D of those ids no longer present (destroyed or sold; one captured by an
Engineer and still standing counts as intact): levels lost `L - floor(L * (S - D) / S)`.
`cityLevelLost` 1 iff the attackers won. A **retreat** (the player leaves the battle) reports the
player's team as the loser with the survivors present at that moment, `how: 'retreat'`.

**Simulated** (`simulateBattle`, W2): `buildPlanetBattle` with `autopilot: true`, stepped until
`winner !== null` (the time limit guarantees an end), then `planetBattleReport` with
`how: 'simulated'`.

### 9.6 Applying a report (`battleResult` and `autoResolve`, W1)

Validation (any failure: same state): `report.battleId === pending[0].id`; `sides` length and
factions match the setup; each side's survivors at most 60, each kind in `ARMY_KINDS`, kills
integers 0..999; core slots unique, each one present in that side's setup with the same kind;
heroes a subset of the setup's with xp at least the starting xp; `how` is `'fought'` or
`'retreat'` only when `pending[0].fighting`, `'simulated'` only with `simulatedAutoResolve`.
`autoResolve` takes no payload: the reducer computes `quickResolve(pending[0].setup)` itself.

Effects:

- Core survivors return to their faction's field army in slot order with their reported kills;
  core units not reported are gone. Non-core survivors of a principal become the region's garrison
  if that principal holds the region afterwards (capped), else they are lost. Ally survivors
  return to `fromRegion`'s garrison (capped) if the ally still owns it.
- **Attackers won**: the region passes to the attacker; its garrison is the attacker's non-core
  survivors; the attacker's field army moves into it; city damage, then `cityLevelLost`, then the
  cut-back (section 6.2); routes touching it are removed; if it was the defender's capital, the
  defender picks a new one; if a split term assigns it to the attacker's partner, it is handed
  over at end of turn. A defending field army that stood there retreats.
- **Defenders won**: city damage applies; the region stays.
- **Retreat**: a beaten field army moves to the nearest region its faction owns (BFS over links,
  ties lowest id); with none, it is destroyed (`army.units = []`, it rebuilds from recruitment at
  the capital: `army.region = capital`).
- Heroes: xp from the report; a fallen hero is `wounded` (iron rule: `lost`). Commander xp per
  section 6.4 when the player was a principal. Journal entry. `pending.shift()`.

---

## 10. Actions (`src/planet/turn.ts`, W1)

```ts
export type PlanetAction =
  // Cities
  | { type: 'build'; region: RegionId; building: CityBuildingId }        // new at Mk 1, or one Mk up
  | { type: 'growCity'; region: RegionId }
  // Armies
  | { type: 'recruit'; region: RegionId; kind: ArmyKind; to: 'army' | 'garrison' }
  | { type: 'disband'; from: 'army'; slot: number }
  | { type: 'disband'; from: 'garrison'; region: RegionId; kind: ArmyKind }
  | { type: 'muster'; region: RegionId; kind: ArmyKind }                 // garrison unit joins the army (kills 0)
  | { type: 'station'; slot: number }                                    // army unit joins the garrison where the army stands
  | { type: 'moveArmy'; to: RegionId }
  | { type: 'attack'; target: RegionId; credits: 0 | 1000 | 2000 | 3000; heroes: HeroKind[] }
  // Battles (the player only)
  | { type: 'fight' }
  | { type: 'autoResolve' }
  | { type: 'battleResult'; report: BattleReport }
  | { type: 'healHero'; hero: HeroKind }
  // Research and Commander
  | { type: 'research'; upgrade: UpgradeId }
  | { type: 'doctrine'; line: LineId; branch: UpgradeId }
  | { type: 'loadout'; kind: UnitKind; modules: ModuleId[] }
  | { type: 'perk'; perk: PerkId }                                       // the player only
  // Trade
  | { type: 'openRoute'; from: RegionId; to: RegionId }
  | { type: 'closeRoute'; id: number }
  // Diplomacy
  | { type: 'propose'; to: FactionId; draft: TreatyDraft }
  | { type: 'answerOffer'; id: number; accept: boolean }                 // the player only
  | { type: 'declareWar'; on: FactionId }
  | { type: 'cancelTreaty'; with: FactionId }
  | { type: 'gift'; to: FactionId; res: Resource; amount: number }       // 1..60
  // Turn (the player only)
  | { type: 'endTurn' };

/** Why `actor` cannot do this now, or null if it can. Plain English for the interface. */
export function planetActionProblem(s: PlanetState, a: PlanetAction, actor?: FactionId): string | null;
/** The reducer. actor defaults to 0. Illegal: returns s itself. */
export function applyPlanetAction(s: PlanetState, a: PlanetAction, actor?: FactionId): PlanetState;
```

General refusals: `result` set; actor not alive; unknown type or malformed fields (every field is
checked: integers in range, known ids); a "player only" action from a computer actor; while any
battle is pending, everything except `fight`, `autoResolve`, `battleResult` (and `fight` only
when not already fighting; `autoResolve` only when not fighting); costs not affordable (stocks
never go negative); a region not owned by the actor where ownership is needed.

Specific rules not stated elsewhere: `build` and `growCity` set `city.built = turn`; `muster` and
`station` need the army in that region and room under the caps; `propose` from a computer actor to
the player adds an `Offer` (expires `turn + 1`, at most `OFFERS_MAX = 6`, one per faction) instead
of judging; between computer factions it is judged by `proposalVerdict` and enacted or ignored (an
ignored computer proposal returns the same state); `answerOffer` with `accept` enacts the draft if
still valid, else refuses; `declareWar` needs a treaty with that faction or refuses (no treaty is
already war); `gift` transfers at once.

`endTurn` runs section 2 step 3. It is the only action that calls the computer factions.

### 10.1 Other exports W1 provides (used by W4 and W5)

```ts
// src/planet/state.ts
export function newPlanetState(p: { seedText: string; preset: LengthPreset; options?: unknown; difficulty: Difficulty; commander: string; createdAt: number }): PlanetState;
export function phaseOf(s: PlanetState): 'orders' | 'pending' | 'battle' | 'over';
export function stanceOf(s: PlanetState, a: FactionId, b: FactionId): Stance;
// src/planet/economy.ts
export function regionYield(s: PlanetState, r: RegionId): Stock & { science: number };
export function factionIncome(s: PlanetState, f: FactionId): { income: Stock & { science: number }; upkeep: Stock; net: Stock };
export function buildCost(s: PlanetState, r: RegionId, b: CityBuildingId): Stock | null;  // null: cannot be built
export function growCost(level: number): Stock;
export function recruitCost(kind: ArmyKind): Stock;
export function garrisonCap(s: PlanetState, r: RegionId): number;
export function armyCapOf(s: PlanetState, f: FactionId): number;
// src/planet/supply.ts
export function suppliedRegions(s: PlanetState, f: FactionId): boolean[];  // per region; false for regions f does not own
export function mayPass(s: PlanetState, f: FactionId, r: RegionId): boolean;
export function armyPath(s: PlanetState, f: FactionId, to: RegionId): RegionId[] | null;
// src/planet/trade.ts
export function routePath(s: PlanetState, route: TradeRoute): RegionId[] | null;
export function routeYield(s: PlanetState, route: TradeRoute): Stock;
export function routeCap(s: PlanetState, f: FactionId): number;
// src/planet/battleSetup.ts
export function attackTargets(s: PlanetState, f: FactionId): RegionId[];
export function battleSetupFor(s: PlanetState, attacker: FactionId, target: RegionId, credits: number, heroes: HeroKind[], battleId: number): BattleSetup | null;
export function strengthOf(units: BattleUnit[] | CoreUnit[]): number;
export function power(s: PlanetState, f: FactionId): number;
// src/planet/ai.ts
export function planAiActions(s: PlanetState, f: FactionId, temperament?: Temperament): PlanetAction[];
// src/planet/victory.ts
export function regionShare(s: PlanetState, f: FactionId): number;  // 0..1
```

---

## 11. Victory and defeat (`src/planet/victory.ts`, W1)

Checked at end of turn after production, in this order:

1. A faction with no regions is eliminated: `alive = false`, `army = null`, its treaties, routes and
   offers removed. Journal entry.
2. Player eliminated: defeat, `how: 'fallen'`.
3. A computer faction holds at least `victoryShare` per cent of all regions: defeat, `'rival'`.
4. The player holds at least `victoryShare` per cent: victory, `'domination'`.
5. Every computer faction eliminated: victory, `'elimination'`.
6. `alliedVictory`, every alive computer faction allied with the player, the player plus allies
   hold at least `victoryShare` per cent, and the player holds more regions than any one ally:
   victory, `'alliance'`.
7. `turn === turnLimit`: victory if the player holds strictly more regions than every other
   faction, else defeat; `'turnLimit'`.

Independents never win and count toward the total.

---

## 12. The computer factions (`src/planet/ai.ts`, W1)

`planAiActions(s, f)` returns an ordered action list; the end-turn loop applies them one at a time
with `applyPlanetAction(state, action, f)`, skipping any that return the same state. Pure and
deterministic: the only dice are `rngSeed` draws for ties of equal score, made through the state.
Same state in, same list out (the harness calls it twice and compares).

Order of planning for faction `f` with spec `T`:

1. **Diplomacy** (toward the player always; toward computer factions only with `aiDiplomacy`). For
   each other alive faction `b` by id, at most one proposal per `b` and two per turn:
   - **Primary target**: the bordering faction with the lowest `P(b) / P(f)` and
     `trust[f][b] <= 60` (none if no border). Toward every other faction add +10 to the desire
     below.
   - **Desire** of a draft is `proposalScore(s, f, b, draft).score`. At war with `b`, not the
     primary target: propose a ceasefire of 6 turns if desire >= 15. At ceasefire: propose an
     open-ended trade pact if desire >= 15 and `trust[f][b] >= 45`. At trade since 3 or more
     turns: propose an open-ended alliance if desire >= 30 and the trust gate holds. At trade or
     alliance with a deficit resource (stock below 10 and negative net) and a surplus (stock above
     30): re-propose the same treaty with one exchange term added (give 3 of the surplus, get
     `max(1, floor(3 * VALUE[surplus] / VALUE[deficit] / T.exchangeMargin))` of the deficit).
   - **Break**: `T.mayBreak`, ceasefire with the primary target, `P(f) >= 1.6 * P(b)` and
     `trust[f][b] <= 35`: `declareWar` (a breach).
   - **Allied duty**: allied with `c`, `c` at war with `b`, and no treaty with `b`: `declareWar`
     is not needed (no treaty is war); the faction treats `b` as a valid target this turn.
2. **Research**: if `current` is null, the first item of `T.research` not done whose prerequisites
   hold; set the doctrine from `T.doctrines` first when the item is a Mk III branch. Loadouts as
   section 8.4 whenever they differ.
3. **Builds**: keep a reserve `{ ore 6, fuel 4, alloys 4, food 6 }`. Regions by total yield,
   highest first (ties lowest id); for each, the first item of `T.build` that is legal and
   affordable above the reserve. At most 3 builds per turn. A food net below 0 moves `farms` to
   the front of the list for this turn. A fuel net below 0 changes no build (fuel comes from
   terrain and trade) but stops vehicle recruitment this turn.
4. **Recruitment**: spend above the reserve, `T.garrisonShare` of the value toward garrisons of
   border regions facing a faction at war (most adjacent enemy strength first, up to 60 per cent of
   cap), the rest toward the army in `T.recruit` order (cycling, skipping kinds not affordable or
   needing a factory where the army stands), up to the army cap.
5. **Attack**: candidates are `attackTargets` from the army's region and from every region reachable
   within the remaining moves. For each, `D` = strength of the defending garrison, the city's
   structures (per section 9.3, valued by `STRUCTURE_VALUE`) and any field army there, times
   `DEFENCE_TERRAIN`; `A` = own army strength. Eligible if `A / D >= T.attackRatio`
   (`T.neutralRatio` for independents). Value = total yield of the region + `3 * cityLevel` +
   (10 if a capital) + (5 if cut off). Pick the highest value (ties lowest id), move there, attack
   with credits 1000 if alloys allow above the reserve, else 0.
6. **Otherwise move** the army one step toward its own region with the highest adjacent enemy
   strength, unless defensive and its capital's adjacent enemy strength exceeds the capital's
   garrison strength (then it stays at, or returns to, the capital).

An attack between computer factions, or on independents, is resolved at once with
`quickResolve(battleSetupFor(...))` and applied as in section 9.6. An attack on the player is
recorded as an intent `{ attacker, target, credits }` and becomes a pending defence battle at the
end of the turn (section 2), skipped if no longer legal then.

**Bot for the player.** `planAiActions(s, 0, 'expansionist')` plans the player's orders by the same
rules (the harness and the ladder use it; it never proposes to itself).

---

## 13. The W1/W2 interface (exact)

W1 never imports from `src/sim/` beyond `rules.ts`, `rng.ts` and types; W2 never edits
`src/planet/` files other than its own three. The only cross-calls:

**W1 provides, W2 consumes**: the types in section 4; `unitValue`, `vetMul`, `STRUCTURE_VALUE`,
`DEFENCE_TERRAIN`, `QUICK_DIFFICULTY` (all `src/planet/rules.ts`); `battleSetupFor` (W2's harness
section uses it to get real setups).

**W2 provides, W1 consumes**:

```ts
// src/planet/resolve.ts (W2). Pure; imports only src/planet/types.ts, src/planet/rules.ts, src/sim/rng.ts, src/sim/rules.ts.
export function sideStrength(setup: BattleSetup, seat: number): number;
export function attackOdds(setup: BattleSetup): number;           // p from section 9.5, for the interface
export function quickResolve(setup: BattleSetup): BattleReport;

// src/planet/battle.ts (W2). Pure; imports src/sim.
export function buildPlanetBattle(setup: BattleSetup, ids: { id: string; name: string; createdAt: number }, opts?: { autopilot?: boolean }): GameState;
export function planetBattleReport(setup: BattleSetup, s: GameState, opts?: { retreat?: boolean }): BattleReport | null; // null while running, unless retreat
export function simulateBattle(setup: BattleSetup, createdAt: number): BattleReport;

// src/planet/simulateClient.ts (W2). Browser only (Worker), not pure; never imported by src/planet pure files or the API.
export function simulateInWorker(setup: BattleSetup, createdAt: number): Promise<BattleReport>;
```

**Bootstrapping.** W2's first step is to create `resolve.ts` with the three signatures and a
placeholder body (`quickResolve` returning attackers-win with no losses), so W1 compiles from the
first hour; W1's first step is `types.ts` and the constants W2 reads. Neither waits on the other.

---

## 14. Engine hooks (W2; `src/sim/`)

All optional, all guarded by the new field, so every existing battle and mission runs the old path.

### 14.1 `src/sim/types.ts`

```ts
// Unit
  /** Planet battles: the field army slot this unit stands for. Absent everywhere else. */
  core?: number;

// GameState, in a new section after the campaign fields
  // ---- War for the Planet (optional: absent on every skirmish and mission) -----------------
  planet?: {
    battleId: number;
    /** At this tick, with no winner yet, the defending team wins. */
    timeLimit: number;
    /** The principal defender's seat: when it has no Command Yard left, the attacking team wins. */
    defenderSeat: Owner;
    /** Computer behaviour per seat (read by missionMode). */
    ai: AiMode[];
    /** Structures that stand for city buildings: [building id, city building id]. */
    city: [number, string][];
    /** Side 0's heroes that fell, with their xp. */
    fallen?: Partial<Record<HeroKind, number>>;
  };
```

### 14.2 `src/sim/state.ts`

- `NewGameOptions.teams?: number[]`: when present with a setup of 3 or 4 sides, `normaliseTeams(teams,
  n)` replaces `teamsFor(n, setup.mode)`. With 2 sides it is ignored (always `[0, 1]`).
- `cloneState` copies `planet` deeply (its arrays and `fallen`) and `Unit.core`.
- `migrateState` keeps a well-formed `planet` (drops it if malformed) and integer `core`.

### 14.3 `src/sim/tick.ts`

- Heroes: `if (s.mission || s.planet) heroes(s, ctx);`
- `checkVictory`: first, when `s.planet` is set: if the defender seat has no `hq` with `hp > 0`, the
  attacking team wins; else if `s.tick >= s.planet.timeLimit`, the defending team wins; `winner` is
  the lowest seat of the winning team (so 0 whenever the human's team won, as today); log
  "Victory. The Command Yard has fallen." / "Defeat. The defenders held." (or the mirror for a human
  defender: "Victory. The defenders held." / "Defeat. Our Command Yard has fallen."). Otherwise the
  existing rule runs unchanged.

### 14.4 `src/sim/ai.ts`

`missionMode`: `s.mission ? (owner !== 0 ? s.mission.ai : 'normal') : s.planet ? (s.planet.ai[owner]
?? 'normal') : 'normal'`. For every state without `planet` this returns exactly what it returns today.

### 14.5 `src/sim/mission.ts`

- `noteFallen` also records into `s.planet.fallen` when `s.planet` is set.
- Export `placeNear`, `placeUnits`, `focusFor`, `startCentre` and `toward` (no change in behaviour).
- Factor hero placement out of `createMissionState` into
  `export function placeHeroes(s, owner, heroes: { kind; xp; wounded }[], x, y): Unit[]` and call it
  from `createMissionState` so that every mission state is byte-identical (the harness hashes them,
  section 18).

### 14.6 `buildPlanetBattle` (W2, `src/planet/battle.ts`)

1. `createInitialState(ids.id, ids.name, { seed: setup.seedText, difficulty, createdAt, autopilot:
   no side human || opts.autopilot, setup: { map: mapType, tech: 'advanced', credits: 3000, ore,
   sides: n, mode: n > 2 ? 'teams' : 'ffa', research: 'lines' }, teams: sides.map(x => x.team) })`.
2. Remove every unit (the three riflemen per side); keep each side's Command Yard.
3. Per side: `players[i].credits = credits`; `upgrades`, `doctrines`, `loadouts` set; structures
   after `hq` placed with `placeNear`/`focusFor` toward the map centre, one `hauler` per refinery;
   `s.planet.city` records each tagged structure's id; units placed with `placeUnits` on the side's
   muster point, then for each: `kills` and `vet` set, `core` set, `upgradeNewUnit`, and for
   vehicles `fitModules` with the side's loadout; heroes with `placeHeroes`.
4. `s.perks` and side 0's powers from `setup.perks` and `setup.powers` when side 0 is human.
5. `s.planet = { battleId, timeLimit, defenderSeat, ai: sides.map(x => x.ai), city }`;
   `allowed` stays null (full advanced tech).
6. `syncSkirmishPowers` and `updateExplored` as `createInitialState` does.

Same setup and ids: byte-identical GameState (harness).

---

## 15. Saves and server (W3)

### 15.1 The save (`src/planet/save.ts`, W3)

```ts
export interface PlanetSave {
  version: 1;
  kind: 'planet';
  id: string;
  name: string;            // at most 40 characters
  createdAt: number;
  planet: PlanetState;
  battle: GameState | null; // the battle in progress, when pending[0].fighting
}
export const PLANET_STRATEGIC_MAX_BYTES = 48 * 1024;  // JSON of the save with battle: null
export const PLANET_SAVE_MAX_BYTES = 256 * 1024;      // JSON of the whole save
export function isPlanetSave(raw: unknown): raw is PlanetSave;
export function migratePlanetSave(raw: unknown): PlanetSave | null;
export function newPlanetSave(id: string, name: string, p: Parameters<typeof newPlanetState>[0]): PlanetSave;
export function planetSaveStatus(s: PlanetSave): 'active' | 'victory' | 'defeated';
export function planetSaveTurn(s: PlanetSave): number;
export function planetSaveBytes(s: PlanetSave): { strategic: number; total: number };
```

`migratePlanetSave` follows `migrateCampaignSave`: every field read defensively, unknown values
dropped, defaults for anything missing. It regenerates the map from `seedText` and `options`, and
returns null if `regions.length` or `factions.length` disagree with them (a corrupt save is not
silently reshaped). `battle` goes through `migrateState`, and is dropped (set null, `fighting`
false) if `pending[0]` is not fighting. Stocks clamped to non-negative integers; trust to 0..100;
treaties, routes, offers and pending battles that fail validation dropped.

**Budget.** The whole save must stay under 256 KB, half the portal's 512 KB, and the strategic part
under 48 KB. Estimates for a Very long war: regions 60 x 110 B; factions 5 x 600 B; armies 5 x 18 x
30 B; trust 25 numbers; treaties at most 10 x 200 B; routes at most 40 x 45 B; offers 6 x 200 B;
journal 40 x 90 B; a pending setup up to 8 KB: about 25 KB in all. A 4-sided battle on a 96 by 96
map measured at about 130 KB. What keeps it small: no geometry (regenerated), no history (journal
capped at `JOURNAL_MAX = 40`, newest last), garrisons as counts, routes as endpoints, paths
recomputed, one treaty per pair.

### 15.2 Server (`api/game/index.ts`, W3)

- `POST` with `mode: 'planet'`: body `{ name, commander, seed, preset, options, difficulty }`, all
  untrusted: `cleanName` for names, seed sliced to 64 characters (empty: the new id), preset one
  of the three (else `'short'`), `normaliseOptions`, `readDifficulty` (else `'normal'`).
  `createdAt: Date.now()` is the server's call into a pure function, as for campaigns. Creates
  with `createGame`, `status: 'active'`, `turn: 1`; 201 `{ gameId, state, version: 0 }`.
- `rowFields`: a planet save gives `planetSaveStatus` and `planetSaveTurn` (through
  `migratePlanetSave`; null gives `active`, 0).
- `PUT` of a state with `kind: 'planet'`: 400 `{ message: 'Not a valid war save' }` if
  `migratePlanetSave` returns null; 413 `{ message: 'This war is too large to save. Please report
  it.' }` if `JSON.stringify(state).length > PLANET_SAVE_MAX_BYTES`. Otherwise as today.
- `GET` list: rows with `kind = 'planet'` carry `kind: 'planet'` and `preset`
  (`state->'planet'->'options'->>'preset'`, one of the three or omitted).
- Unchanged: `requireUser`, game access in `api/play/[kind].ts`, rate limits, the shared
  `saves.ts` limits, the `games` table. No schema change.
- `scripts/api-test.ts`: a Fireline planet block: create (201, kind, turn 1, options normalised from
  junk), list (kind and preset), save round trip, malformed planet save 400, oversize planet save
  413, delete. Run `npm run test:api` (needs `API_TEST_DATABASE_URL`).

### 15.3 Client saves (W3)

- `src/hooks/useSaves.ts`: `LoadedSave = GameState | CampaignSave | PlanetSave`; `metaOf` and
  migration handle planet saves; `SaveMeta.kind?: 'campaign' | 'planet'`, `preset?: LengthPreset`;
  `createPlanet(p: { name; commander; seed; preset; options; difficulty }): Promise<string | null>`
  for cloud and local storage alike (local builds `newPlanetSave` with `Date.now()` in the hook).
  `save` refuses (sets the error "This war is too large to save.") a planet save over the budget
  instead of sending it.
- `src/pages/campaignSaves.ts`: `isPlanetMeta`, and `load` typed to include `PlanetSave`.
- Fixture `scripts/fixtures/planet-save-v1.json` (in `packages/fireline/scripts/`): a short war
  saved at turn 6 with a pending battle, produced once by `newPlanetState` plus scripted actions;
  the harness asserts it migrates and plays on.

---

## 16. File ownership

| Workstream | Owns (creates or edits) | Must not edit |
|---|---|---|
| **W1 strategic core** | `src/planet/types.ts`, `rules.ts`, `map.ts`, `state.ts`, `economy.ts`, `cities.ts`, `army.ts`, `research.ts`, `supply.ts`, `trade.ts`, `diplomacy.ts`, `battleSetup.ts`, `ai.ts`, `turn.ts`, `victory.ts`, `journal.ts` | `src/sim/`, anything W2 to W5 own |
| **W2 battles and hooks** | `src/planet/resolve.ts`, `src/planet/battle.ts`, `src/planet/simulateClient.ts`, `src/workers/planetResolve.worker.ts`; in `src/sim/`: `types.ts`, `state.ts`, `tick.ts`, `ai.ts`, `mission.ts` (section 14 only); `scripts/drive-planet-battle.ts` (exports `sections`) | `src/planet/` W1 files |
| **W3 saves and server** | `src/planet/save.ts`, `api/game/index.ts`, `src/hooks/useSaves.ts`, `src/pages/campaignSaves.ts`, `scripts/fixtures/planet-save-v1.json`; root `scripts/api-test.ts` (the planet block only) | `api/play/[kind].ts`, `shared/portal/`, `api/_lib/` copies |
| **W4 interface** | `src/pages/Planet.tsx` (new), `src/components/planet/*.tsx` (new), `src/game/planetArt.ts` (new), `src/pages/Lobby.tsx` (the new panel), `src/pages/GameScreen.tsx` (the planet branch and the `Battle` end hook), `src/pages/HowToPlay.tsx` (new section), `src/styles.css` (one new heading block), `src/theme.ts` (token names only) | `src/planet/`, `src/sim/` |
| **W5 harness** | `scripts/drive-planet.ts` (new, in `packages/fireline/`), `scripts/planet-ladder.ts` (new), `packages/fireline/package.json` (scripts `drive:planet`, `ladder:planet`), root `package.json` (`drive:planet`, `ladder:planet`), root `scripts/check.sh` (one step) | everything else |

Each workstream appends to its own subsection of section 20 of this file and to nothing else of it.
`fireline-design.md` gets one build log entry, written by W5 after the others land.

---

## 17. Interface (W4)

- **Lobby** (`Lobby.tsx`, inside the signed-in branch only, after the Campaign panel): a panel
  "War for the Planet" with name, Commander, length (Short, Long, Very long, each with its regions,
  factions and typical hours), factions 3 to 5, difficulty, seed (optional), and the four optional
  rules as checkboxes showing the preset's defaults; "Begin the war" calls `createPlanet` and
  navigates to `/game/:id`. The saves list labels planet saves "War" with the preset and turn.
  The `if (!user)` gate is unchanged and wraps this panel like every other.
- **Routing** (`GameScreen.tsx`): `isPlanetSave(state)` renders `<PlanetFlow>` from `Planet.tsx`
  (beside the existing campaign branch). `Battle` gains an optional `campaign.endWhen?: 'mission' |
  'winner'` (default `'mission'`, today's behaviour) so `renderEnd` is drawn once `s.winner !== null`
  in a planet battle.
- **PlanetFlow** holds the `PlanetSave`; every action goes through `applyPlanetAction`; a returned
  same object shows `planetActionProblem` as a toast and saves nothing; any other result is saved
  at once (whole save, through the existing save queue). During a fought battle the save's `battle`
  is saved every 15 seconds of play as campaigns are.
- **Planet map** (`planetArt.ts`, `drawPlanetMap(ctx, map, state, view)`): seas, continents and
  regions drawn as a nearest-site raster at quarter resolution (a pixel is land if its nearest
  site of any continent is within 70 units and inside that continent's ellipse grown by 15 per
  cent), each cell filled with its owner's token colour, borders where neighbouring cells differ,
  sea links as dashed lines, cities as squares sized by level, capitals marked, the field armies
  as numbered markers, routes as lines (blockaded routes in the blockade token), cut-off regions
  hatched. Colours are read from CSS tokens (`getComputedStyle`), re-read when the theme changes.
  Owners are also shown by a letter on each city, never by colour alone.
- **Region panel**: name, terrain, ore, owner, yields, supply state and `cut`, city level and
  buildings with Build and Grow buttons (cost, effect, disabled with the problem as its title),
  garrison with recruit and muster, routes, and for a target: "Attack" with credits choice, heroes
  picker, allies who would join, and the odds from `attackOdds`.
- **Screens** (tabs): Map, Army (roster with ranks and kills, recruit, station, heroes, heal),
  Research (the five lines, doctrines, loadouts, current project and science per turn), Commander
  (perks, reusing the campaign's perk cards), Diplomacy (each faction: stance, temperament, their
  trust in you as a bar with a number, treaty terms and turns left; Propose dialog building a
  `TreatyDraft` with live `proposalVerdict` text; offers with Accept and Decline; Declare war and
  Cancel with the breach cost stated), Trade (routes with yields and blockades, open route picker,
  exchange terms in force), Journal.
- **Header**: planet name, turn and turn limit, the four stocks with net per turn, science, End
  turn (disabled while a battle is pending, with the reason).
- **Pending battle card**: who, where, sides and teams, odds; "Fight" (dispatch `fight`, then
  `buildPlanetBattle` into `battle`, save, render `<Battle>`), "Auto-resolve" (`autoResolve`), and
  "Simulate" when `simulatedAutoResolve` (`simulateInWorker` with `BusyLabel`, then `battleResult`).
  After a battle, a debrief card: result, survivors with promotions in rank, heroes, city damage,
  Commander xp.
- **End of war**: a result card with how it was decided and the final shares.
- **Tokens** in `src/styles.css`, under `/* ---- War for the Planet (fireline-planet-design.md, W4) ---- */`,
  a light `:root` block and a `:root[data-theme="dark"]` block with the same names: `--pl-sea`,
  `--pl-sea-deep`, `--pl-land-neutral`, `--pl-border`, `--pl-border-strong`, `--pl-f0` to `--pl-f4`,
  `--pl-route`, `--pl-route-blocked`, `--pl-select`, `--pl-cut`, `--pl-city`, `--pl-capital`,
  `--pl-war`, `--pl-ceasefire`, `--pl-trade`, `--pl-alliance`, `--pl-trust-track`, `--pl-trust-fill`.
  `--pl-f0` matches `--ui-team`.
- **Layout**: at 760px wide or less the panel goes below the map; no horizontal scroll at 360px.
- **How to play**: a section "War for the Planet" (the turn, cities, resources, trade, diplomacy,
  battles, encirclement, winning).
- **Loading**: the existing `LoadingScreen` covers the load; buttons with requests in flight use
  `BusyLabel`. No new tour this round (a later round adds one with `npm run tours`).
- **Check** in the browser, light and dark, desktop and phone width: lobby, new war, every tab, a
  fought battle and its debrief, an auto-resolve, a defence, a treaty, the end card. Load the page
  after adding any hook.

---

## 18. Harness (W5; W2 supplies its own sections)

`npm run drive:planet` (`packages/fireline/scripts/drive-planet.ts`), in `npm run check` as a new
step in `scripts/check.sh` after the Fireline campaign step:

```
step "Test suite: fireline War for the Planet"
npm run drive:planet --workspace=packages/fireline --silent | tail -3
```

Target: under 90 seconds. Prints `N assertions passed` like the other drives. Sections:

1. **Presets**: each preset's keys equal `OPTION_KEYS` in order; values in range; `normaliseOptions`
   forces non-adjustable keys and clamps `factions`.
2. **Map**: 200 seeds per preset: `planetProblem` null; region and continent counts exact; connected;
   no crossing land links; sea links join different continents and coastal endpoints; land degree
   at most 5; deterministic (two calls JSON-equal); retries counted and at most 20.
3. **New war**: factions, capitals owned, capitals at least 3 hops apart, ceasefire between every
   pair ending at `openingTruce`, stocks `STARTING_STOCK`, temperaments distinct among the first
   three computer factions, strategic JSON under 48 KB.
4. **Refusals**: at least 40 crafted illegal actions return the same object, covering every action
   type (unknown type, bad ids, unaffordable, attack during the truce, attack not adjacent, sea
   attack without a port, split-protected target, build over slots, port inland, Mk above city
   level, second build in a city this turn, vehicle without factory, move too far, research without
   prerequisite, doctrine twice, illegal loadout, perk without points, route too long or over cap,
   proposal the AI refuses, offer expired, declare war with no treaty, end turn with a pending
   battle, battle result with the wrong id, an invented core slot, a hero not in the setup, fought
   result when not fighting, simulated result with the option off, any action after the result,
   player-only actions from a computer actor).
5. **Purity**: every legal action tested on a deep-frozen state; the reducer never throws on
   frozen input and returns a new object. A source scan of `src/planet/` (except
   `simulateClient.ts`) for `Math.random`, `Date.now`, `performance`, `setTimeout`, `window`,
   `document` fails on any hit.
6. **Whole wars**: Short preset, 20 seeds, normal difficulty, the player played by
   `planAiActions(s, 0, 'expansionist')`, every battle auto-resolved. Every war ends by `turnLimit`.
   Every turn: stocks non-negative integers; garrisons and armies within caps; owners valid; trust
   0..100 integers; at most one treaty per pair; treaty parties alive; routes valid; no NaN
   anywhere (`JSON.stringify` round trip equal); strategic JSON under 48 KB; `migratePlanetSave` of
   the save JSON-equals it.
7. **Replay**: for 5 of those wars, the action log replayed from `newPlanetState` gives a
   byte-identical final state.
8. **Long and Very long**: 5 Long and 3 Very long wars with the same checks (size every turn).
9. **Diplomacy**: a breach lowers every other alive faction's trust in the breaker by exactly 10
   and the victim's by 30; mercantile and defensive factions never breach (count over all war
   runs = 0); `planAiActions` called twice on the same state gives equal lists; a crafted state with
   an allied neighbour gives a 3-sided setup with teams `[0, 1, 0]` (or `[0, 1, 1]`), and with allies
   on both sides a 4-sided one; exchange terms pause when every foreign route is blockaded.
10. **Encirclement**: a crafted region cut off for `surrenderTurns` turns surrenders to the
    strongest adjacent enemy; one cut off with no adjacent enemy does not; a capital never counts as
    cut off; losing a capital moves it.
11. **W2's sections** (`scripts/drive-planet-battle.ts`): 60 setups taken from the war runs (every
    map type, 2, 3 and 4 sides, human attacker, human defender, none): `buildPlanetBattle` builds,
    teams equal the setup's, units and heroes placed match, core tags and kills kept, upgrades and
    loadouts applied, every city tag's id present; deterministic (two builds JSON-equal); 2,000
    autopilot ticks run; 6 battles simulated to the end give reports the reducer accepts; a time
    limit of 50 gives the defenders the win at tick 50; destroying the defender's Command Yard
    gives the attackers the win; `quickResolve` deterministic and its survivors a subset of the
    setup; whole save with a 4-sided battle at ticks 0 and 3,000 under 256 KB.
12. **Story untouched**: a hash of `JSON.stringify` of every story mission's state at tick 0 and after
    600 ticks (all 14 missions, default context), recorded by W2 before any engine edit and stored
    as constants in `drive-planet-battle.ts`; asserted equal. `npm run drive:fire` and
    `npm run campaign:fire` pass with the same assertion counts as before.
13. **Old saves**: the fixture `planet-save-v1.json` migrates, its pending battle resolves, and the
    war plays 5 more turns; a campaign save and a skirmish save from the existing fixtures still
    load through `useSaves`' migration helper (pure part).

`npm run ladder:planet` (`scripts/planet-ladder.ts`, not in check): 150 Short wars per difficulty
with the bot player: win rate (must fall from easy to normal to hard), turns to finish, how wars
end, breaches by temperament; and 40 setups comparing `quickResolve` with `simulateBattle`
(agreement on the winner is reported; tune section 9.5 if below 65 per cent). Use it for any
balance change; 150 seeds is the project's minimum for win-rate comparisons.

---

## 19. Acceptance

- `npm run check` passes, including the new step.
- `npm run test:api` passes with the planet block.
- `npm run drive:fire` and `npm run campaign:fire` show the same assertion counts as before this
  round; story mission hashes unchanged.
- `npm run ladder:planet` run once and its numbers recorded in the W5 build log.
- Browser check of section 17 in both themes and at phone width.
- `grep` finds no em dash in any file this round created or edited.

---

## 20. Build log

Each workstream appends dated entries under its own heading only.

### W1 strategic core

**2026-11-10: the strategic core is in.** The 16 W1 files in `src/planet/` (`types.ts`, `rules.ts`,
`map.ts`, `state.ts`, `economy.ts`, `cities.ts`, `army.ts`, `research.ts`, `supply.ts`, `trade.ts`,
`diplomacy.ts`, `battleSetup.ts`, `ai.ts`, `turn.ts`, `victory.ts`, `journal.ts`). `types.ts` is
sections 3.1 and 4 verbatim, plus one optional field (below). Every export named in sections 3, 5,
6.1, 8.5, 9.4, 10 and 10.1 exists with the stated signature. W1 calls W2 only through
`quickResolve` (in `autoResolve`, and for battles between computer factions or on independents).

Measured with a scratch script (not part of the tree; W5's `drive-planet.ts` is the real harness):
the Short, Long and Very long presets played by `planAiActions(s, 0, 'expansionist')` with every
battle auto-resolved, 11 wars of 25 to 40 turns, about 97,600 assertions with no failure: the same
seed and actions give byte-identical JSON; the action log replayed from `newPlanetState` gives the
same final state; `planAiActions` twice on one state gives equal lists; 28 crafted illegal actions
on a deep-frozen state return the same object with a problem text; legal actions on frozen states
return new objects; stocks, garrisons, armies, trust, treaties and the journal stay in bounds; the
strategic JSON peaks at about 17 KB (Very long, turn 26) and 21 KB over a whole 160-turn Very long
war, well under 48 KB. A whole Short war takes about 70 ms, a whole Very long war about 0.7 s.
Maps: 200 seeds per preset all valid; Short needed one retry on 4 seeds, Long and Very long none;
land degree never above 5. Crafted checks: an alliance on each side gives a 4-sided setup with teams
`[0, 1, 0, 1]` and contingents leaving and returning to their garrisons; fought, wrong-id,
invented-core, foreign-hero and simulated-when-off reports are refused; a region cut off for
`surrenderTurns` surrenders to the adjacent enemy.

Where this file was silent or could not hold as written (each is the smallest change that works):

- **Sites keep to their own continent.** Ellipses with `rx = 75 * sqrt(n)` and centres 320 apart
  overlap on a 1200 by 600 canvas (Very long's are about 290 wide each), so sites interleaved and
  land links of different continents crossed on almost every seed. A site is now also accepted
  only when its ellipse-normalised distance to its own centre is below that to every other centre.
  The 46-unit spacing is checked against every site already placed, on any continent.
- **Capital spacing lives in `generatePlanet`.** Section 5.1 regenerates the geometry when capitals
  fall under 3 hops apart, but `planetMapOf(s)` must rebuild the same map from the state alone. So
  `generatePlanet` checks capitals for each attempt (with the start stream, which depends only on
  the seed text) and keeps the first attempt that passes both checks; the memo key adds `factions`.
  `PlanetMap.retries?: number` (optional, never saved) records the attempt for the harness.
- **Independent garrisons are trimmed to the garrison cap.** Very long's `neutralStrength` 1.4 gives
  a level 2 independent 10 units against a cap of 8; the cap wins (dropped from the last kind).
- **No strategic dice are drawn.** Every AI tie goes to the lowest id, so `rngSeed` never moves;
  section 12 allows dice for ties but does not need them.
- **Intents.** A computer attack on the player during End turn marks the army as attacked and is
  charged when it becomes a defence battle after production (skipped if no longer legal or not
  affordable). At most one defence battle per region per turn. A later pending battle whose region
  changed hands, or whose attacker is gone, is dropped with a journal line. A computer attack on the
  player made outside End turn becomes a pending defence battle at once.
- **Production runs phase by phase** across the alive factions (all yields, then all routes, all
  factories, the treaty flows once in treaty order, all upkeep, and so on), so no faction's step 1
  sees another's step 5.
- **The war's last turn.** When the victory check sets `result`, `turn` stays at the turn decided
  (so `result.turn === turn`) and pending battles are cleared.
- **Smaller readings.** `battleResult` refuses `how: 'quick'` (that is `autoResolve`'s job). A
  hero heals at end of turn when the player's army did not attack that turn. A split handover
  sends the capturer's army back by the retreat rule (the region it attacked from is not stored).
  Breach means `ends >= turn`. Upkeep shortfalls take garrison infantry first (region with most
  infantry, its last infantry kind), then the army's last infantry, then any garrison unit; fuel takes
  the army's last vehicle, then garrison vehicles. The player answering an offer, and the bot's own
  judgements, use the expansionist spec (the player has no temperament). Two payments by one payer
  in one resource must be covered together.

For W5 (balance, not asserted here): with the section 12 rules every pair signs an open-ended trade
pact within a few turns (trade desire is always at least 15 and nothing in section 12 ever leaves a
trade pact), so wars between factions are rare after the truce and almost every Short war ends on
`turnLimit`. With `aiDiplomacy` off and the bot refusing offers, defence battles and breaches appear
as expected. `ladder:planet` should measure this before anyone tunes it.

**2026-11-10: the two defects W5's harness found are fixed.** Files: `src/planet/map.ts`,
`src/planet/state.ts`, `src/planet/turn.ts`.

- **Start regions can no longer run short.** Section 5.1 step 2 claims only unowned regions linked
  to what a faction holds, so a capital whose only neighbour another faction took first stopped
  below `startRegions` (`new-long-5-16`, Long with 5 factions, faction 3 on 2 of 3; about 3 seeds in
  600). Treated like capitals closer than 3 hops: the capital placement, the seeded deal and the
  claims now live in `map.ts` (`permutation`, `terrainYieldTotal`, `claimStarts`, `startDeal`;
  `state.ts` re-exports `terrainYieldTotal`), and `generatePlanet` keeps the first geometry attempt
  where `startDeal` succeeds, so `planetMapOf` still rebuilds the map from the state alone. The memo
  key adds `startRegions`, since it now decides which attempt is kept. `newPlanetState` takes the
  same start stream draws in the same order as before, so every seed that already worked starts
  exactly as it did; only the affected seeds move to a later attempt. A seed whose every attempt
  fails takes the old fallback, redrawn from the top of the stream. No released save depends on the
  changed seeds.
- **A treaty ended by an unpaid term takes its foreign routes with it.** `unpaid` in `turn.ts` now
  calls `pruneRoutes(d)`, so section 7's "removed at once" holds in the turn the pact ends, not only
  in a later turn where some other treaty expires. Pruning inside the treaty flow touches only
  routes between the two former partners, and a pair has one treaty, so no later flow that turn
  reads a different answer from `exchangeFlows`.

`npx tsx scripts/drive-planet.ts`: 38,470 assertions, 0 failed (both W5 failures pass).

### W2 battles and engine hooks


**2026-11-10. W2 built: battle generator, engine hooks, auto-resolve.**

Files: `src/planet/resolve.ts`, `src/planet/battle.ts`, `src/planet/simulateClient.ts`,
`src/workers/planetResolve.worker.ts`, `scripts/drive-planet-battle.ts` (new); `src/sim/types.ts`,
`state.ts`, `tick.ts`, `ai.ts`, `mission.ts` (section 14 hooks only). `resolve.ts` went in first as
a stub so W1 compiled from the start.

API as section 13, exactly: `sideStrength`, `attackOdds`, `quickResolve` (resolve.ts);
`buildPlanetBattle`, `planetBattleReport`, `simulateBattle` (battle.ts); `simulateInWorker`
(simulateClient.ts, falls back to the main thread after one yield when workers are unavailable).
Extra exports: `REPORT_SURVIVORS_MAX` (battle.ts); in `drive-planet-battle.ts`, `sections` (the
`[name, (ok) => void][]` shape of the other drive files), `craftSetup(i)` and `reportProblem(setup,
report)` (section 9.6's checks, so W5 can reuse them). Run alone it prints its own count.

Engine hooks (all guarded by the new optional field): `Unit.core`; `GameState.planet` (typed as a
named interface `PlanetBattle`); `NewGameOptions.teams`; `cloneState` and `migrateState` copy and
validate both (a malformed `planet` is dropped, a non-integer `core` is dropped); the Command Yard
and time-limit rule in `checkVictory`, with the four messages of 14.3; hero ticks when `s.planet`;
`missionMode` per seat; `noteFallen` records into `s.planet.fallen`; `placeNear`, `placeUnits`,
`focusFor`, `startCentre`, `toward` exported and `placeHeroes` factored out of
`createMissionState`.

Proof that nothing existing changed: before any engine edit, HEAD (7814d9c) was exported with
`git archive` into a scratch folder and hashed (sha256 of `JSON.stringify`) for all 14 story
missions at tick 0 and after 600 ticks, both with the default context and with every hero
brought (one wounded, so `placeHeroes` is exercised), and for 31 skirmishes (2, 3 and 4 sides,
ffa and teams, every map type, both techs, both research modes) plus the original game at tick 0
and after 1,500 autopilot ticks: 118 hashes, stored as constants in `drive-planet-battle.ts` and
asserted equal after the hooks. `npm run drive:fire`: 345,131 assertions before and after, 0
failed. `npm run campaign:fire`: 2,609 before and after, 0 failures. Typecheck clean.

`drive-planet-battle.ts`: 5,219 assertions, 0 failed, about 50 to 60 seconds. Sections: 60 crafted
setups (every map type, 2, 3 and 4 sides, human attacker, human defender, none, independents,
allies on either team, perks and powers) built and checked (teams, units and heroes placed, core
tags, kills and ranks, upgrades, doctrines, loadouts, credits, a hauler per refinery, every city
tag present, deterministic, unchanged through `migrateState`, `cloneState` independent); the hooks
(time limit 50 gives the defenders the win at tick 50, the defender's Command Yard falling gives
the attackers the win, an ally's falling does not, fallen heroes recorded and reported, hero
ticks, the city damage formula for every D, a captured structure counts as intact, saves round
trip and play on exactly, malformed runtimes dropped, teams option rules); 2,000 autopilot ticks
on 12 setups; 6 setups simulated to the end; `quickResolve` deterministic, valid, survivors a
subset, one kill per enemy lost shared round-robin, odds monotone in strength, terrain and rank,
the favoured team winning most of 200 seeds, `QUICK_DIFFICULTY` on computer sides only; save size
(a 4-sided battle measured 52 KB at tick 0 and 94 KB at tick 3,000, so 48 KB + battle stays far
under 256 KB; a setup is about 3 KB); the 118 hashes; a source scan of resolve.ts and battle.ts;
and setups from W1's `battleSetupFor` on real wars (dozens of attacks auto-resolved; a four-sided
allied defence of the player's capital simulated; fought, retreat, simulated and auto-resolve
reports all accepted by `applyPlanetAction`, a fought report refused when not fighting and a
simulated one refused with the option off).

Deviations and choices where the contract is silent:
- Two-sided battles keep the engine's teams `[0, 1]` (section 14.2) even when the setup says
  `[1, 0]` (the player defending at seat 0). Only the grouping matters, and every planet rule reads
  teams through `teamOf` of the defender seat, so the harness compares the partition for two sides
  and the exact list for three and four.
- `s.planet.perkPowers?: SupportPower[]` (optional, additive): side 0's perk powers. Without it
  `syncSkirmishPowers` would delete the Recon and Barrage perk powers each tick in a battle with no
  Uplink or Tech Centre. `syncSkirmishPowers` skips those powers only when `s.planet` is set.
- Side 0's `extraStartCredits` perk is added to its credits, as missions do.
- Perks are set on the state before units are placed, so the Armour perk reaches them.
- Units are placed one at a time with `placeUnits` so each placed unit is matched to its setup
  entry; a unit with no room is skipped (none were in any harness setup).
- `p.doctrines` is set only when a doctrine is chosen (the shape `migrateState` gives), so a
  fresh planet battle survives a save round trip byte for byte.
- Reports: survivors are core units first (by slot), then the rest by id, capped at 60. A hero
  not standing at the end is reported fallen with its fallen xp (side 0) or its starting xp.
  `planetBattleReport` with `retreat` on a battle already decided gives the ordinary report.
  `simulateBattle` stops at twice the time limit as a guard; with a valid setup the time limit
  always ends it first.
- Section 18 item 11 asks for 2,000 autopilot ticks on 60 setups: the harness builds all 60 and
  runs the ticks on 12 (and the six simulations use a ten-minute limit) to keep the section near
  a minute inside the 90-second target for `drive:planet`; the full-length battles run in the war
  section. A simulated full-length battle takes about 4 to 6 seconds on this machine.
- Quick-resolve heroes gain their xp (40 or 10) whether or not they fall.

### W3 saves and server

**2026-11-10: saves and server are in.** Files: `src/planet/save.ts` and
`scripts/fixtures/planet-save-v1.json` (new); `api/game/index.ts`, `src/hooks/useSaves.ts`,
`src/pages/campaignSaves.ts` and the planet block of root `scripts/api-test.ts` (edited); one guard
line in `src/pages/GameScreen.tsx` (below). No schema change, nothing in `api/play/[kind].ts`,
`shared/portal/` or any `api/_lib/` copy.

`save.ts` exports section 15.1 exactly (`PlanetSave`, both budgets, `isPlanetSave`,
`migratePlanetSave`, `newPlanetSave`, `planetSaveStatus`, `planetSaveTurn`, `planetSaveBytes`), plus
`migratePlanetState` (the state alone), `planetSaveTooLarge` (the server's 413 test) and
`readPreset`. Migration reads every field defensively and rebuilds every object in the order the W1
code writes it, so a save this build wrote comes back byte for byte (asserted below); anything
unknown is dropped. Refused outright (null): not `kind: 'planet'`, no id, a seed text that is not a
non-empty string of at most 64 characters, a version other than 1, or region and faction counts
that disagree with the map regenerated from `seedText` and the options (`normaliseOptions` with
the saved preset, so fixed keys come back as the preset's). Repaired: stocks, garrisons, kills and
counters to non-negative integers; city level 1..5 and buildings Mk 1..3; trust to an F by F
integer grid in 0..100 with 100 on the diagonal (missing cells 50); research to known upgrades,
doctrine forks and fitting modules; perks to their maximum levels; the journal to its last 40
entries of at most 400 characters; missing heroes, temperaments, names and capitals from the war the
same seed would have started. Dropped when malformed: a treaty (a bad term spoils the whole
treaty; at most one per pair, kept sorted), a route, an offer (at most `OFFERS_MAX`), a pending
battle (its setup is frozen, so it is checked whole: 2 to 4 sides, every field typed, the shape
`battleSetupFor` makes, that is one attacker that is a faction on team 0, one defender on team 1 at
the defender seat, allies that are factions with a home region, each faction once, `human` exactly
on the player's non-ally side and only at seat 0; `battleId`, region, attacker and defender matching
the pending battle). The shape check came from the fuzz below: a setup whose attacker was junked to
the independents passed field checks and threw in `applyReport`. Only `pending[0]` may be fighting. `nextId` is raised above every id still in
use. `battle` goes through `migrateState` and is kept only when `pending[0]` is fighting and the
battle's `planet.battleId` and side count match it; otherwise it is null and `fighting` false.

Where the contract was silent:
- Stored treaties and offers are checked structurally, not with `draftProblem`: a treaty in force
  has already paid its payments and enacted its splits, so "can pay now" and "a third party's
  region" do not apply. Accepting an offer still runs `draftProblem` in the reducer.
- A result clears pending battles on load (W1 clears them when the war is decided), but offers and
  everything else are kept as saved.
- The client refuses a save only on the 256 KB total, the same test as the server's 413, and
  clears that error on the next save that fits. The 48 KB strategic budget is for the harness to
  assert: refusing a save loses progress, so it is not a refusal anywhere.
- `createPlanet` (local and cloud) and the server both treat a blank seed as the new id.
- `src/pages/GameScreen.tsx` (W4's file) gets one guard so the client still typechecks with
  `load` now returning `PlanetSave` too: a planet save opened at `/game/:id` shows the load error
  instead of being treated as a battle. W4's planet branch replaces that line. The lobby's skirmish
  list still filters only campaigns, so wars show there until W4's panel takes them
  (`isPlanetMeta`).
- `CampaignSavesApi` also passes `createPlanet` through, for W4.

The fixture is the Short war of seed `fixture-4` (Normal, every option at its preset value,
created at 1767225600000), played by `planAiActions(s, 0, 'expansionist')` with every battle
auto-resolved and the first domestic trade route the player can open opened on turn 1, to turn 6;
then the bot's turn 6 orders up to the first attack. It holds a pending two-sided attack, a route
and three trade pacts; 9.2 KB. It migrates byte for byte and plays on to a result (turn limit, won).

Measured (scratch scripts, not in the tree; W5's harness is the real test): five wars (Short with
defaults, Short with iron rule, simulated auto-resolve and no AI diplomacy, Long with 5 factions,
Very long and Short without AI diplomacy) saved at every pending battle and every turn, 402 round
trips all byte-identical, four of them with a battle in progress after 50 ticks (a fighting save
without its battle comes back not fighting; a battle without fighting is dropped); peak 16.6 KB
strategic and 38 KB with a battle. A fuzz of 12,000 mutated saves (one to four fields of three real
mid-war saves, each holding a pending battle, set to junk or deleted, then through JSON): migration
never threw, 208 came back null, every save that came back migrates to itself and plays two more
turns of the bot, pending battles auto-resolved, without throwing. Migration of
a Very long save takes about 0.6 ms with the map memoised.

`npm run test:api` against a throwaway local Postgres 16: 607 passed, 0 failed (both passes), the
planet block included: create (201, kind, turn 1, junk options normalised, preset forced keys,
blank seed is the id, unknown preset is Short), list (kind, preset, turn, status), save round trip
(compared by content, since jsonb reorders keys), status and turn from the war's result, malformed
and wrong-shaped saves 400, an 800-line journal 413 with the contract's message, refused saves
change nothing, delete. Typecheck clean for the Fireline client and API tsconfigs, the root
`tsconfig.api.json` and Thrash Margin; shared copies all match. `npm run drive:fire`: 345,131
assertions, 0 failed. `npm run campaign:fire`: 2,609 assertions, 0 failures (both unchanged). The
full `npm run check` was not run.

### W4 interface

**2026-11-10: the war screens are in.** New: `src/pages/Planet.tsx` (`PlanetFlow`, the whole war
and the battle in progress), `src/game/planetArt.ts` (`drawPlanetMap`, `readPlanetPalette`,
`fitPlanet`, `regionAt`, `ownerLetter`), and in `src/components/planet/`: `common.tsx`,
`PlanetMapCanvas.tsx`, `RegionPanel.tsx`, `ArmyTab.tsx`, `ResearchTab.tsx`, `CommanderTab.tsx`,
`DiplomacyTab.tsx`, `TradeTab.tsx`, `JournalTab.tsx`, `BattleCards.tsx` (pending card, debrief, end
card) and `WarSetup.tsx` (the lobby form). Edited: `src/pages/Lobby.tsx` (the War for the Planet
panel after the Campaign panel, inside the signed-in branch; wars listed there as "War" with
length and turn and no longer among battles; one What is new line), `src/pages/GameScreen.tsx`
(the planet branch replaces W3's guard line; `CampaignBattle.endWhen`), `src/pages/HowToPlay.tsx`
(a War for the Planet section, presets and buildings generated from the rules tables),
`src/styles.css` (one block under the section 17 heading, light and dark) and `src/theme.ts` (`PL`,
token names only). Nothing in `src/planet/`, `src/sim/`, `shared/portal/` or the API was touched.
The lobby's `if (!user)` gate is unchanged and wraps the new panel like every other.

How it works: every order goes through `applyPlanetAction`; a refused order (same object) shows
`planetActionProblem` as a toast and saves nothing, anything else is saved whole at once through
the existing save queue. Buttons are disabled with the reducer's own problem as their title, so
the toast is a backstop. Fight dispatches `fight`, builds the battle with `buildPlanetBattle` (the
clock read in the screen) and opens `<Battle>`, saved every 15 seconds of play as campaign
battles are; at `s.winner` a card returns to the planet with `planetBattleReport` as a
`battleResult`. Leaving a battle keeps it in the save: the pending card then offers Return or
Retreat (`planetBattleReport` with `retreat`). Auto-resolve dispatches `autoResolve`; Simulate
(only with the option) runs `simulateInWorker` under a `BusyLabel`. Every result opens a debrief
(region change, survivors and promotions, heroes, city damage, Commander xp), computed from the
state before and after and the report. The end card gives how the war was decided and every
side's share.

Where the contract was silent, or the smallest change that works:
- **Causeways on the map.** With section 17's raster rule alone (nearest site within 70 units and
  inside its continent's ellipse grown by 15 per cent) two regions joined by a long land link were
  drawn with a strait between them on several seeds. Cells within 26 units of a land link now count
  as land of the nearer end. Drawing only; nothing in the rules reads it.
- **Two extra tokens**, `--pl-label` (letters on the city squares, which are light in both modes)
  and `--pl-name` (city names on the map), plus `--pl-halo` (the outline behind names, routes and
  army markers). Both blocks carry every name. Faction land is the faction token blended over
  `--pl-land-neutral` at 62 per cent in the canvas (no hex alpha anywhere).
- **Planet battles in `<Battle>`:** no guided tour and no Tour button (`!initial.planet`, as for
  missions); the hero bar and the power bar (every power held, perk powers included) instead of
  the skirmish power bar; the hero keys (Z X C V, F) work as in missions. All guarded by
  `s.planet`, so skirmishes and missions take exactly their old paths.
- **Region choice by list as well as by map**: the region panel opens with a select of every
  region, so the map is never the only way in (keyboard and small screens).
- **Phone layout**: the panel goes below the map at 760px or less; the tabs wrap rather than
  scroll. No horizontal scroll at 390px on any tab or the lobby (checked).
- **Commander screen** uses the campaign's perk card classes and `PERKS`, with the war's own rank
  ladder (`PLANET_RANKS`); the insignia is clamped to the campaign's highest drawn rank.
- **Trade picker** opens on the selected region if it is yours and has a city in reach, else on the
  first of your cities that has one; the "to" list holds only cities `routeProblem` accepts.

Verified in Chromium (Playwright, deviceScaleFactor 1, `tm_user` set as CLAUDE.md describes, no
token so saves are local, every `/api` request stubbed to 401; scripts and screenshots in the
session scratchpad, not the tree): lobby panel; a Short war started from it; a build in the capital
(and the second build that turn refused with its reason); a trade pact proposed with the live
verdict and signed; a domestic route opened on turn 2; an attack on an independent region with
credits, heroes, sides and odds; a fought battle (the saved battle had its defender's Command Yard
removed by the test script, then the page reloaded straight into it) won, its region changing
hands, debrief shown; an auto-resolved attack; a second war (Hard, Simulate on, rival diplomacy
off): a fought battle with two heroes showing the hero bar and no Tour button, a retreat, a
simulated battle, war declared on every faction and a defence battle on turn 3, auto-resolved;
the end card (a result written into the save by the test script); every tab in light and dark at
1280 by 900, and the map, Diplomacy, Research, Trade, Army and the lobby at 390 wide in both modes.
No page errors. `npm run tours -- --quick fireline`: ok. `npm run check:loading -- fireline`: 27 of
27. Fireline typecheck clean. `npm run check`: all checks passed (drive:fire 345,131 assertions and
campaign:fire 2,609, both unchanged).

Not done: a full-length battle fought by hand to its end (the end hook was driven by the test
above); a tour for the war (section 17 leaves it to a later round).

### W5 harness

**2026-11-10: `drive-planet.ts` is in and wired into the check.** Files: `packages/fireline/scripts/drive-planet.ts`
(new), `drive:planet` in `packages/fireline/package.json` and the root `package.json`, one step in
`scripts/check.sh` after the campaign step, one bullet in `CLAUDE.md`. About 38,500 assertions in
about 62 seconds (W2's sections are about 57 of them); every section of 18 except the ladder.

What it covers: presets against the 3.2 table and `normaliseOptions` with junk; 200 maps per preset
(counts, connected, no crossing land links, sea links between coastal regions of different
continents, land degree at most 5, link lists consistent, unique city names, capital spacing,
retries at most 20, determinism on every other seed); new wars for every faction count of every
preset (20 seeds each) with the start fairness measured; 150 or so crafted refusals covering every
action type and 32 legal cases covering every action type, all on deep-frozen states; a source scan
of `src/planet/`; recruit costs by the formula, building yields, upkeep, cut-back, halved cut-off
yields; trade conservation (a tribute and an exchange between two computer factions, compared with
the same state without the terms), blockade (exchange paused, tribute flowing), unpaid terms, gifts
and payments; every treaty transition, breach (-30 and -10 exactly), open-ended cancellation (-5),
expiry (+5), offers, computer talks with and without `aiDiplomacy`, -8 for attacking an ally;
allied setups `[0,1]`, `[0,1,0]`, `[0,1,1]`, `[0,1,0,1]`, contingents leaving and returning, the
player defending from seat 0, the player as a computer contingent; encirclement and capitals; every
way a war ends; 20 Short wars, 6 Short wars with rival diplomacy off and a bot that makes no
treaties, 5 Long and 3 Very long, all played to the end with every invariant of item 6 checked every
turn; replay of 5; setups from the wars built as battles; a Very long save with a battle at ticks 0
and 600; junk saves and a seeded fuzz of 400; the v1 fixture; campaign and skirmish saves.

Choices: section 13's "load through `useSaves`' migration helper" is done by the same dispatch
(`isCampaignSave`, `isPlanetSave`, `migrateState`) because `migrateAny` is not exported and
`useSaves.ts` reads `import.meta.env`, which `tsx` does not provide. The start army (9 units) is over
an Easy computer faction's cap on Short (10 - 2), so the cap check allows the start army's size.

Found (left failing, for W1): start regions can run short (a capital in a pocket whose only
neighbour another faction claims first, Long with 5 factions, seed `new-long-5-16`; about 3 in 600
seeds); a treaty ended by an unpaid term keeps its foreign routes (`unpaid` in `turn.ts` does not
call `pruneRoutes`). Measured, not asserted: on Short every war ended on the turn limit, with no
defence battles while rival diplomacy is on (W1's balance note stands); with it off and a bot that
makes no treaties, 16 defence battles in 6 wars; no breaches by any temperament.
