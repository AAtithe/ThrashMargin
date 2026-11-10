/**
 * War for the Planet: the numbers (fireline-planet-design.md, sections 3, 6, 7, 8.4 and 9.4). W1.
 * Constants only, so W2's resolve.ts can import this file without pulling in the strategic code.
 * Pure: no clock, no dice.
 */
import { UNITS, VET_KILLS, type BuildingKind, type Difficulty, type LineId, type MapType, type ModuleId, type OreLevel, type UnitKind, type UpgradeId } from '../sim/rules';
import {
  ADJUSTABLE_OPTIONS,
  OPTION_KEYS,
  type ArmyKind,
  type CityBuildingId,
  type LengthPreset,
  type PlanetOptions,
  type Resource,
  type Stock,
  type Temperament,
} from './types';

// ---- Presets (section 3.2) --------------------------------------------------------------------

export const LENGTH_PRESETS: LengthPreset[] = ['short', 'long', 'veryLong'];

export const PRESETS: Record<LengthPreset, PlanetOptions> = {
  short: {
    preset: 'short',
    factions: 3,
    regions: 18,
    continents: 2,
    startRegions: 2,
    openingTruce: 3,
    armyCap: 10,
    armyMove: 2,
    heroesPerBattle: 2,
    surrenderTurns: 2,
    victoryShare: 60,
    turnLimit: 40,
    alliedVictory: true,
    ironRule: false,
    simulatedAutoResolve: false,
    aiDiplomacy: true,
    battleMinutes: 20,
    neutralStrength: 1,
  },
  long: {
    preset: 'long',
    factions: 4,
    regions: 36,
    continents: 3,
    startRegions: 3,
    openingTruce: 5,
    armyCap: 14,
    armyMove: 2,
    heroesPerBattle: 2,
    surrenderTurns: 2,
    victoryShare: 65,
    turnLimit: 90,
    alliedVictory: true,
    ironRule: false,
    simulatedAutoResolve: false,
    aiDiplomacy: true,
    battleMinutes: 20,
    neutralStrength: 1.2,
  },
  veryLong: {
    preset: 'veryLong',
    factions: 5,
    regions: 60,
    continents: 4,
    startRegions: 3,
    openingTruce: 8,
    armyCap: 18,
    armyMove: 2,
    heroesPerBattle: 2,
    surrenderTurns: 3,
    victoryShare: 70,
    turnLimit: 160,
    alliedVictory: true,
    ironRule: false,
    simulatedAutoResolve: false,
    aiDiplomacy: true,
    battleMinutes: 25,
    neutralStrength: 1.4,
  },
};

export const isLengthPreset = (v: unknown): v is LengthPreset => v === 'short' || v === 'long' || v === 'veryLong';

/** A full option set: preset values, with ADJUSTABLE_OPTIONS taken from raw when valid. */
export function normaliseOptions(raw: unknown, preset: LengthPreset): PlanetOptions {
  const base = PRESETS[isLengthPreset(preset) ? preset : 'short'];
  const out: PlanetOptions = { ...base };
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const key of ADJUSTABLE_OPTIONS) {
    const v = r[key];
    if (key === 'factions') {
      if (typeof v === 'number' && Number.isFinite(v)) {
        const n = Math.max(3, Math.min(5, Math.floor(base.regions / 4), Math.round(v)));
        out.factions = n as 3 | 4 | 5;
      }
    } else if (typeof v === 'boolean') {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  // Key order exactly as OPTION_KEYS, so the JSON of every save lists them the same way.
  const ordered = {} as Record<string, unknown>;
  for (const k of OPTION_KEYS) ordered[k] = out[k];
  return ordered as unknown as PlanetOptions;
}

// ---- Difficulty (section 3.3) -----------------------------------------------------------------

export const AI_INCOME: Record<Difficulty, number> = { easy: 0.8, normal: 1, hard: 1.25 };
export const AI_ARMY_BONUS: Record<Difficulty, number> = { easy: -2, normal: 0, hard: 2 };
export const QUICK_DIFFICULTY: Record<Difficulty, number> = { easy: 0.85, normal: 1, hard: 1.15 };

// ---- Values (section 6.1) ---------------------------------------------------------------------

export const VALUE: Record<Resource, number> = { ore: 1, food: 1, fuel: 1.5, alloys: 2.5 };
export const STARTING_STOCK: Stock = { ore: 20, fuel: 12, alloys: 12, food: 20 };
export const TERRAIN_YIELD: Record<MapType, { ore: number; fuel: number; food: number }> = {
  classic: { ore: 2, fuel: 1, food: 2 },
  river: { ore: 1, fuel: 1, food: 3 },
  highlands: { ore: 3, fuel: 0, food: 1 },
  lakes: { ore: 1, fuel: 2, food: 2 },
  plains: { ore: 2, fuel: 0, food: 4 },
  canyon: { ore: 2, fuel: 3, food: 0 },
};
export const ORE_K: Record<OreLevel, number> = { poor: 1, normal: 2, rich: 3 };
export const DEFENCE_TERRAIN: Record<MapType, number> = { highlands: 1.2, canyon: 1.15, river: 1.1, lakes: 1.05, classic: 1, plains: 0.95 };

/** Weighted ore level draw by terrain: [poor, normal, rich] (section 5, step 7). */
export const ORE_WEIGHTS: Record<MapType, [number, number, number]> = {
  plains: [10, 40, 50],
  highlands: [20, 50, 30],
  canyon: [30, 50, 20],
  classic: [25, 50, 25],
  river: [25, 50, 25],
  lakes: [25, 50, 25],
};

// ---- Cities (section 6.2) ---------------------------------------------------------------------

export interface CityBuildingSpec {
  name: string;
  /** The name at Mk 3, where it differs. */
  name3?: string;
  /** Cost of Mk L, per unit of L. */
  cost: Partial<Stock>;
  coastal?: true;
  /** Per-turn yield per Mk. */
  yieldPerMk: Partial<Record<Resource | 'science', number>>;
  blurb: string;
}

export const CITY_BUILDING_SPECS: Record<CityBuildingId, CityBuildingSpec> = {
  refinery: { name: 'Refinery district', cost: { ore: 6, alloys: 2 }, yieldPerMk: { ore: 2 }, blurb: 'Ore +2 per Mk. In battle: a refinery per Mk and 500 more credits per Mk.' },
  farms: { name: 'Farms', cost: { ore: 5, alloys: 1 }, yieldPerMk: { food: 2 }, blurb: 'Food +2 per Mk.' },
  factory: { name: 'Factory', cost: { ore: 8, alloys: 3, fuel: 2 }, yieldPerMk: {}, blurb: 'Turns up to 2 ore per Mk into alloys each turn. Needed to recruit vehicles. In battle: a factory, and a repair bay from Mk 2.' },
  institute: { name: 'Research institute', cost: { ore: 6, alloys: 4, food: 2 }, yieldPerMk: { science: 2 }, blurb: 'Science +2 per Mk. In battle: a research lab, and a tech centre from Mk 2.' },
  fortifications: { name: 'Fortifications', name3: 'Citadel', cost: { ore: 6, alloys: 4 }, yieldPerMk: {}, blurb: 'Garrison room +3 per Mk. In battle: two turrets and a rocket turret per Mk, and a strike command at Mk 3.' },
  port: { name: 'Port', cost: { ore: 6, alloys: 2, fuel: 2 }, coastal: true, yieldPerMk: { food: 1 }, blurb: 'Food +1 per Mk. Opens sea moves, sea attacks and sea routes. Coastal regions only.' },
  airfield: { name: 'Airfield', name3: 'Spaceport', cost: { ore: 6, alloys: 4, fuel: 4 }, yieldPerMk: {}, blurb: 'Costs 1 fuel per Mk each turn. In battle: a helipad (two at Mk 3) and a flak cannon per Mk.' },
};

/** The capital's bonus each turn. */
export const CAPITAL_BONUS = { ore: 1, alloys: 1, science: 1 };

// ---- Strength (section 9.4) -------------------------------------------------------------------

export const unitValue = (k: ArmyKind): number => UNITS[k].cost / 100;
export const vetMul = (kills: number): number => (kills >= VET_KILLS[1] ? 1.5 : kills >= VET_KILLS[0] ? 1.25 : 1);
export const STRUCTURE_VALUE: Partial<Record<BuildingKind, number>> = { hq: 5, turret: 4, rocketturret: 6, flakcannon: 3, strikecommand: 6 };
export const structureValue = (b: BuildingKind): number => STRUCTURE_VALUE[b] ?? 1;

// ---- Armies (section 6.3) ---------------------------------------------------------------------

export const INFANTRY_KINDS: ArmyKind[] = ['rifleman', 'rocketeer', 'grenadier', 'medic'];
export const isInfantry = (k: ArmyKind): boolean => UNITS[k].category === 'infantry';
export const isVehicle = (k: ArmyKind): boolean => UNITS[k].category === 'vehicle';

/** Field army at the start, and garrisons at the start (section 5.1). */
export const START_ARMY: [ArmyKind, number][] = [['rifleman', 4], ['rocketeer', 2], ['tank', 2], ['buggy', 1]];
export const START_CAPITAL_GARRISON: [ArmyKind, number][] = [['rifleman', 4], ['rocketeer', 2], ['tank', 1]];
export const START_REGION_GARRISON: [ArmyKind, number][] = [['rifleman', 3], ['rocketeer', 1]];
export const NEUTRAL_GARRISON: Record<1 | 2, [ArmyKind, number][]> = {
  1: [['rifleman', 3], ['rocketeer', 1]],
  2: [['rifleman', 4], ['rocketeer', 2], ['tank', 1]],
};
export const NEUTRAL_BUILDINGS: CityBuildingId[] = ['refinery', 'farms', 'fortifications'];

export const ATTACK_CREDITS = [0, 1000, 2000, 3000] as const;

// ---- Trade and diplomacy (sections 7, 8) ------------------------------------------------------

export const ROUTE_MAX_HOPS = 6;
export const ROUTE_COST: Stock = { ore: 0, fuel: 2, alloys: 4, food: 0 };
export const ROUTE_CAP_MAX = 8;
export const OFFERS_MAX = 6;
export const JOURNAL_MAX = 40;
export const GIFT_MAX = 60;
export const HEAL_FOOD = 3;

export const PLAYER_NAME = 'Meridian Corps';
export const AI_FACTION_NAMES = ['Ashen Combine', 'Tidewater League', 'Iron Concord', 'Verdant Directorate'];
export const TEMPERAMENT_LIST: Temperament[] = ['expansionist', 'mercantile', 'defensive'];

export type AiBuild = CityBuildingId | 'grow';

export interface TemperamentSpec {
  attackRatio: number;
  neutralRatio: number;
  mayBreak: boolean;
  ceasefireBias: number;
  tradeBias: number;
  allianceBias: number;
  allianceTrust: number;
  exchangeMargin: number;
  garrisonShare: number;
  build: AiBuild[];
  recruit: ArmyKind[];
  research: UpgradeId[];
  doctrines: Record<LineId, UpgradeId>;
}

export const TEMPERAMENTS: Record<Temperament, TemperamentSpec> = {
  expansionist: {
    attackRatio: 1.2,
    neutralRatio: 1.0,
    mayBreak: true,
    ceasefireBias: -15,
    tradeBias: 0,
    allianceBias: 5,
    allianceTrust: 65,
    exchangeMargin: 1.15,
    garrisonShare: 0.3,
    build: ['factory', 'refinery', 'farms', 'airfield', 'institute', 'fortifications', 'port', 'grow'],
    recruit: ['tank', 'tank', 'rocketeer', 'rifleman', 'artillery', 'flametank', 'buggy'],
    research: ['calibration', 'engines', 'autoloaders', 'engines2', 'heat', 'motorised', 'plating', 'refining', 'plating2', 'reactive', 'airframes', 'avionics', 'munitions', 'refining2', 'assembly'],
    doctrines: { logistics: 'assembly', armour: 'reactive', engines: 'motorised', weapons: 'heat', air: 'munitions' },
  },
  mercantile: {
    attackRatio: 1.6,
    neutralRatio: 1.3,
    mayBreak: false,
    ceasefireBias: 15,
    tradeBias: 25,
    allianceBias: 5,
    allianceTrust: 60,
    exchangeMargin: 1.0,
    garrisonShare: 0.4,
    build: ['refinery', 'farms', 'port', 'institute', 'grow', 'factory', 'fortifications', 'airfield'],
    recruit: ['rifleman', 'rocketeer', 'tank', 'buggy', 'missilecarrier'],
    research: ['refining', 'refining2', 'salvage', 'plating', 'calibration', 'engines', 'plating2', 'composite', 'autoloaders', 'highexplosive', 'engines2', 'fieldrepair', 'airframes', 'avionics', 'hardened'],
    doctrines: { logistics: 'salvage', armour: 'composite', engines: 'fieldrepair', weapons: 'highexplosive', air: 'hardened' },
  },
  defensive: {
    attackRatio: 2.0,
    neutralRatio: 1.5,
    mayBreak: false,
    ceasefireBias: 20,
    tradeBias: 10,
    allianceBias: 15,
    allianceTrust: 55,
    exchangeMargin: 1.1,
    garrisonShare: 0.6,
    build: ['fortifications', 'farms', 'refinery', 'factory', 'institute', 'grow', 'airfield', 'port'],
    recruit: ['rocketeer', 'rifleman', 'tank', 'artillery', 'bastion', 'flaktrack'],
    research: ['plating', 'plating2', 'composite', 'refining', 'calibration', 'autoloaders', 'highexplosive', 'engines', 'engines2', 'fieldrepair', 'refining2', 'assembly', 'airframes', 'avionics', 'hardened'],
    doctrines: { logistics: 'assembly', armour: 'composite', engines: 'fieldrepair', weapons: 'highexplosive', air: 'hardened' },
  },
};

/** Round 5's Hard loadouts for computer sides, in table order (section 8.4). */
export const AI_LOADOUTS: [UnitKind, ModuleId[]][] = [
  ['tank', ['longbarrel', 'tracks']],
  ['bastion', ['longbarrel', 'tracks']],
  ['flametank', ['tracks', 'smoke']],
  ['buggy', ['fueltank']],
];

/** Kept by every computer faction above its spending (section 12, step 3). */
export const AI_RESERVE: Stock = { ore: 6, fuel: 4, alloys: 4, food: 6 };
export const AI_MAX_BUILDS = 3;
export const AI_MAX_PROPOSALS = 2;

// ---- Commander (section 6.4) ------------------------------------------------------------------

export const PLANET_EXTRA_RANKS: { name: string; xp: number }[] = [
  { name: 'Marshal', xp: 6500 },
  { name: 'Field Marshal', xp: 9000 },
  { name: 'Supreme Commander', xp: 12500 },
];
export const XP_WON_ATTACK_BASE = 60;
export const XP_WON_ATTACK_PER_LEVEL = 20;
export const XP_WON_DEFENCE = 50;
export const XP_LOST_BATTLE = 15;

// ---- Treaty limits (section 8.2) --------------------------------------------------------------

export const TREATY_TURNS: Record<'ceasefire' | 'trade' | 'alliance', { min: number; max: number; open: boolean }> = {
  ceasefire: { min: 3, max: 20, open: false },
  trade: { min: 5, max: 40, open: true },
  alliance: { min: 10, max: 60, open: true },
};
export const TREATY_TERMS_MAX = 4;
export const TERM_AMOUNT_MAX = 20;
export const PAYMENT_MAX = 60;
export const ACCEPT_AT: Record<'ceasefire' | 'trade' | 'alliance', number> = { ceasefire: 0, trade: 5, alliance: 25 };

/** Most units a side brings to one battle, and most survivors a report may carry. */
export const SIDE_UNITS_MAX = 40;
export const REPORT_SURVIVORS_MAX = 60;
