/**
 * War for the Planet: every type the strategic layer saves or exchanges with the battle layer.
 * Written verbatim from fireline-planet-design.md, sections 3.1 and 4 (W1). Additions are additive
 * and optional. Pure data: no React, no DOM, no clock.
 */
import type { Difficulty, HeroKind, LineId, MapType, ModuleId, OreLevel, UnitKind, UpgradeId, BuildingKind, SupportPower } from '../sim/rules';
import type { AiMode, Perks } from '../sim/types';
import type { PerkId } from '../campaign/types';

// ---- Options (section 3.1) -------------------------------------------------------------------

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
export const OPTION_KEYS: (keyof PlanetOptions)[] = [
  'preset', 'factions', 'regions', 'continents', 'startRegions', 'openingTruce', 'armyCap', 'armyMove', 'heroesPerBattle',
  'surrenderTurns', 'victoryShare', 'turnLimit', 'alliedVictory', 'ironRule', 'simulatedAutoResolve', 'aiDiplomacy', 'battleMinutes', 'neutralStrength',
];
/** The keys a player may change in setup; every other key is forced to the preset's value. */
export const ADJUSTABLE_OPTIONS: (keyof PlanetOptions)[] = ['factions', 'alliedVictory', 'ironRule', 'simulatedAutoResolve', 'aiDiplomacy'];

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
  /** Geometry retries this seed needed (0: none). Added by W1 for the harness; not saved. */
  retries?: number;
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
  /**
   * The version of the rules this war builds its battles to (section 9.7). Absent: 1, every battle
   * on a standard map, as in every war started before larger maps; such a war keeps it for good.
   * 2: the map size by stakes (`battleMapSize`). New wars start at 2.
   */
  battleRules?: 2;
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
  /**
   * The battle's map size (section 9.7). Absent: a standard map, which is every battle of a war
   * started before larger maps, and every battle of a newer war whose stakes are small.
   */
  mapSize?: 'large' | 'huge';
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
