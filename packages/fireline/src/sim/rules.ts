/**
 * Every number the battle runs on, in one place. The simulation reads these and nothing else, so a
 * balance change is an edit here and a run of `npm run drive`.
 *
 * Units of measure: distances in tiles, time in ticks (TICKS_PER_SECOND per second of play at
 * normal speed), money in credits.
 */

export const TICKS_PER_SECOND = 10;
export const MAP_W = 64;
export const MAP_H = 64;

export type Owner = 0 | 1;

export type Armor = 'infantry' | 'light' | 'heavy' | 'building';
export type WeaponKind = 'bullet' | 'shell' | 'rocket' | 'artillery';

/** How hard each weapon hits each armour class. Riflemen shred infantry and scratch a tank. */
export const DAMAGE_VS: Record<WeaponKind, Record<Armor, number>> = {
  bullet: { infantry: 1, light: 0.6, heavy: 0.22, building: 0.15 },
  shell: { infantry: 0.45, light: 0.9, heavy: 1, building: 0.75 },
  rocket: { infantry: 0.3, light: 1, heavy: 1.15, building: 0.9 },
  artillery: { infantry: 1, light: 0.8, heavy: 0.55, building: 1 },
};

/** Ticks a projectile of each kind spends in the air before it lands. Bullets are instant. */
export const FLIGHT_TICKS: Record<WeaponKind, number> = { bullet: 0, shell: 2, rocket: 4, artillery: 9 };

export interface Weapon {
  kind: WeaponKind;
  damage: number;
  range: number;
  /** Ticks between shots. */
  cooldown: number;
  /** Radius, in tiles, of damage around the point of impact. */
  splash?: number;
  /** Cannot fire at anything closer than this. */
  minRange?: number;
}

/** Named special characters. Campaign-only: never in a build menu, never in a skirmish. */
export type HeroKind = 'spy' | 'commando' | 'engineer' | 'ace';
export const HERO_KINDS: HeroKind[] = ['spy', 'commando', 'engineer', 'ace'];
export type UnitKind = 'rifleman' | 'rocketeer' | 'hauler' | 'buggy' | 'tank' | 'artillery' | HeroKind;
export type BuildingKind = 'hq' | 'power' | 'refinery' | 'barracks' | 'factory' | 'turret' | 'uplink';
export type Category = 'building' | 'infantry' | 'vehicle';

export interface UnitSpec {
  name: string;
  category: 'infantry' | 'vehicle';
  cost: number;
  buildTicks: number;
  hp: number;
  armor: Armor;
  /** Tiles per tick. */
  speed: number;
  sight: number;
  weapon?: Weapon;
  requires: BuildingKind[];
  blurb: string;
  /** True for the four named heroes (campaign only). */
  hero?: true;
}

export interface BuildingSpec {
  name: string;
  w: number;
  h: number;
  cost: number;
  buildTicks: number;
  hp: number;
  /** Positive generates, negative draws. */
  power: number;
  sight: number;
  weapon?: Weapon;
  requires: BuildingKind[];
  blurb: string;
}

export const UNITS: Record<UnitKind, UnitSpec> = {
  rifleman: {
    name: 'Rifleman',
    category: 'infantry',
    cost: 100,
    buildTicks: 50,
    hp: 60,
    armor: 'infantry',
    speed: 0.065,
    sight: 5,
    weapon: { kind: 'bullet', damage: 9, range: 3.5, cooldown: 10 },
    requires: ['barracks'],
    blurb: 'Cheap and quick to train. Cuts down infantry; barely dents armour.',
  },
  rocketeer: {
    name: 'Rocketeer',
    category: 'infantry',
    cost: 300,
    buildTicks: 80,
    hp: 50,
    armor: 'infantry',
    speed: 0.055,
    sight: 6,
    weapon: { kind: 'rocket', damage: 42, range: 5, cooldown: 30 },
    requires: ['barracks'],
    blurb: 'Shoulder-launched rockets. The answer to tanks and turrets, helpless against riflemen.',
  },
  hauler: {
    name: 'Ore Hauler',
    category: 'vehicle',
    cost: 1200,
    buildTicks: 140,
    hp: 700,
    armor: 'heavy',
    speed: 0.075,
    sight: 4,
    requires: ['factory', 'refinery'],
    blurb: 'Gathers ore and carries it to a refinery. Every credit you spend starts here.',
  },
  buggy: {
    name: 'Raider Buggy',
    category: 'vehicle',
    cost: 500,
    buildTicks: 70,
    hp: 180,
    armor: 'light',
    speed: 0.17,
    sight: 7,
    weapon: { kind: 'bullet', damage: 14, range: 4, cooldown: 8 },
    requires: ['factory'],
    blurb: 'Fast scout with a machine gun. Finds the enemy and harasses haulers.',
  },
  tank: {
    name: 'Battle Tank',
    category: 'vehicle',
    cost: 800,
    buildTicks: 110,
    hp: 420,
    armor: 'heavy',
    speed: 0.1,
    sight: 5,
    weapon: { kind: 'shell', damage: 50, range: 4.75, cooldown: 25 },
    requires: ['factory'],
    blurb: 'The backbone of any army. Solid against everything, best against armour.',
  },
  artillery: {
    name: 'Artillery',
    category: 'vehicle',
    cost: 1000,
    buildTicks: 130,
    hp: 150,
    armor: 'light',
    speed: 0.07,
    sight: 6,
    weapon: { kind: 'artillery', damage: 90, range: 9, cooldown: 55, splash: 1.2, minRange: 2 },
    requires: ['factory', 'uplink'],
    blurb: 'Long-range shells that land with splash. Outranges turrets; needs an escort.',
  },
  // ---- Heroes (campaign only). Numbers are at level 1; HERO_LEVELS scales them. ----------------
  spy: {
    name: 'The Spy',
    category: 'infantry',
    cost: 0,
    buildTicks: 0,
    hp: 80,
    armor: 'infantry',
    speed: 0.075,
    sight: 7,
    weapon: { kind: 'bullet', damage: 6, range: 2.5, cooldown: 14 },
    requires: [],
    blurb: 'Unseen by the enemy unless their troops come within two tiles. Infiltrates enemy structures.',
    hero: true,
  },
  commando: {
    name: 'The Commando',
    category: 'infantry',
    cost: 0,
    buildTicks: 0,
    hp: 160,
    armor: 'infantry',
    speed: 0.07,
    sight: 7,
    weapon: { kind: 'bullet', damage: 30, range: 4.5, cooldown: 9 },
    requires: [],
    blurb: 'A one-man army against infantry. Plants demolition charges that bring a structure down.',
    hero: true,
  },
  engineer: {
    name: 'The Engineer',
    category: 'infantry',
    cost: 0,
    buildTicks: 0,
    hp: 90,
    armor: 'infantry',
    speed: 0.065,
    sight: 5,
    requires: [],
    blurb: 'Repairs damaged vehicles beside them and captures enemy structures (not a Command Yard).',
    hero: true,
  },
  ace: {
    name: 'The Ace',
    category: 'vehicle',
    cost: 0,
    buildTicks: 0,
    hp: 650,
    armor: 'heavy',
    speed: 0.11,
    sight: 6,
    weapon: { kind: 'shell', damage: 70, range: 5.25, cooldown: 22 },
    requires: [],
    blurb: 'A veteran tank commander in a prototype tank. Overdrive: faster and firing faster for a while.',
    hero: true,
  },
};

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  hq: {
    name: 'Command Yard',
    w: 3,
    h: 3,
    cost: 3000,
    buildTicks: 0,
    hp: 1800,
    power: 20,
    sight: 6,
    requires: [],
    blurb: 'Builds every other structure. Lose all your structures and the battle is lost.',
  },
  power: {
    name: 'Generator',
    w: 2,
    h: 2,
    cost: 300,
    buildTicks: 100,
    hp: 500,
    power: 100,
    sight: 3,
    requires: [],
    blurb: 'Supplies 100 power. Run short and production halves, turrets slow and the uplink goes dark.',
  },
  refinery: {
    name: 'Refinery',
    w: 3,
    h: 2,
    cost: 1500,
    buildTicks: 150,
    hp: 900,
    power: -30,
    sight: 4,
    requires: ['power'],
    blurb: 'Turns ore into credits. Arrives with a free hauler, which docks on the pad below it.',
  },
  barracks: {
    name: 'Barracks',
    w: 2,
    h: 2,
    cost: 400,
    buildTicks: 80,
    hp: 500,
    power: -20,
    sight: 4,
    requires: ['power'],
    blurb: 'Trains infantry.',
  },
  factory: {
    name: 'War Factory',
    w: 3,
    h: 3,
    cost: 1800,
    buildTicks: 180,
    hp: 1000,
    power: -40,
    sight: 4,
    requires: ['refinery'],
    blurb: 'Builds vehicles: haulers, buggies, tanks and artillery.',
  },
  turret: {
    name: 'Gun Turret',
    w: 1,
    h: 1,
    cost: 600,
    buildTicks: 90,
    hp: 450,
    power: -25,
    sight: 6,
    weapon: { kind: 'shell', damage: 40, range: 5.5, cooldown: 22 },
    requires: ['barracks'],
    blurb: 'Fixed defence. Fires half as fast when power is short.',
  },
  uplink: {
    name: 'Comms Uplink',
    w: 2,
    h: 2,
    cost: 1000,
    buildTicks: 120,
    hp: 600,
    power: -50,
    sight: 8,
    requires: ['refinery'],
    blurb: 'Brings the minimap online while powered, and unlocks artillery.',
  },
};

/** Structures in the order the build menu offers them. */
export const BUILD_MENU: BuildingKind[] = ['power', 'refinery', 'barracks', 'factory', 'turret', 'uplink'];
export const INFANTRY_MENU: UnitKind[] = ['rifleman', 'rocketeer'];
export const VEHICLE_MENU: UnitKind[] = ['hauler', 'buggy', 'tank', 'artillery'];

/** Which structure each queue needs before it will make progress. */
export const PRODUCER: Record<Category, BuildingKind> = {
  building: 'hq',
  infantry: 'barracks',
  vehicle: 'factory',
};

export const MAX_QUEUE = 5;
export const START_CREDITS = 3000;

/** Ore economy. */
export const HAULER_CAPACITY = 600;
export const HARVEST_PER_SCOOP = 30;
export const SCOOP_TICKS = 5;
export const UNLOAD_PER_TICK = 50;
export const ORE_TILE_MAX = 500;
/** Every this many ticks, each ore tile that still holds some grows back a little. */
export const ORE_REGROW_TICKS = 60;
export const ORE_REGROW_AMOUNT = 8;

/** A new structure must sit within this many tiles (Chebyshev) of one you already own. */
export const BUILD_RADIUS = 4;

/** Veterancy. Kills needed for each rank above rookie: veteran, then elite. */
export const VET_KILLS = [3, 7];
export const VET_NAMES = ['Rookie', 'Veteran', 'Elite'];
/** Damage multiplier by rank. */
export const VET_DAMAGE = [1, 1.15, 1.3];
/** Reload time multiplier by rank (lower is faster). */
export const VET_RELOAD = [1, 0.85, 0.75];
/** Elite units out of combat regain this share of full health every VET_REPAIR_TICKS. */
export const VET_REPAIR_SHARE = 0.01;
export const VET_REPAIR_TICKS = 20;

/** The rank a unit with this many kills has earned. */
export function vetFor(kills: number): number {
  let v = 0;
  while (v < VET_KILLS.length && kills >= VET_KILLS[v]) v++;
  return v;
}

/** Most orders a unit may hold in its waypoint queue, after the current one. */
export const ORDER_QUEUE_MAX = 12;

/** Riflemen who walk out of a structure that is destroyed or sold, by footprint area. */
export function survivorsFor(w: number, h: number): number {
  const area = w * h;
  return area >= 9 ? 3 : area >= 6 ? 2 : 1;
}

/** Selling returns this share of the cost, scaled by remaining health. */
export const SELL_RETURN = 0.5;
/** Repair costs this share of the cost per hit point restored, relative to cost/hp. */
export const REPAIR_COST_SHARE = 0.4;

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultySpec {
  label: string;
  blurb: string;
  /** Ticks between AI decisions. */
  period: number;
  firstAttack: number;
  attackInterval: number;
  firstWave: number;
  waveGrowth: number;
  waveCap: number;
  /** Multiplier on the AI's refinery income. */
  income: number;
  refineries: number;
  factories: number;
  turrets: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultySpec> = {
  easy: {
    label: 'Easy',
    blurb: 'A slow, cautious commander. First attack after about ten minutes, in small numbers.',
    period: 24,
    firstAttack: 6000,
    attackInterval: 3600,
    firstWave: 5,
    waveGrowth: 1,
    waveCap: 10,
    income: 0.8,
    refineries: 1,
    factories: 1,
    turrets: 2,
  },
  normal: {
    label: 'Normal',
    blurb: 'A fair fight. First attack around six minutes in; each wave larger than the last.',
    period: 12,
    firstAttack: 3600,
    attackInterval: 2400,
    firstWave: 7,
    waveGrowth: 2,
    waveCap: 16,
    income: 1,
    refineries: 2,
    factories: 1,
    turrets: 3,
  },
  hard: {
    label: 'Hard',
    blurb:
      'Quick decisions, two factories and early pressure from about four minutes. Its refineries pay a quarter more than yours.',
    period: 6,
    firstAttack: 2400,
    attackInterval: 1800,
    firstWave: 8,
    waveGrowth: 2,
    waveCap: 22,
    income: 1.25,
    refineries: 2,
    factories: 2,
    turrets: 4,
  },
};

export const DEFAULT_DIFFICULTY: Difficulty = 'normal';

export const SIDE_NAMES: Record<Owner, string> = { 0: 'Meridian Corps', 1: 'Ashen Combine' };

// ---- Heroes, abilities and support powers (campaign) ------------------------------------------
//
// The contract every campaign workstream codes against; see fireline-campaign-design.md.

export type AbilityTarget = 'none' | 'building';

export interface AbilitySpec {
  name: string;
  blurb: string;
  /** Ticks before it can be used again, at hero level 1. */
  cooldown: number;
  target: AbilityTarget;
  /** Tiles from the hero to the target's footprint. */
  range: number;
}

export const HERO_ABILITY: Record<HeroKind, AbilitySpec> = {
  spy: {
    name: 'Infiltrate',
    blurb:
      'Slip into an enemy structure (the Spy is not lost). Refinery: steal half their credits, up to 1500. Generator: their power fails for 60s. Comms Uplink: reveal the whole map. War Factory or Barracks: their production stops for 45s. Command Yard: reveal their base and halve their next attack wave.',
    cooldown: 450,
    target: 'building',
    range: 1,
  },
  commando: {
    name: 'Demolition charge',
    blurb: 'Plant a charge on an enemy structure. It goes off 3 seconds later: destroys anything but a Command Yard, which loses 60% of its health.',
    cooldown: 300,
    target: 'building',
    range: 1,
  },
  engineer: {
    name: 'Capture',
    blurb: 'Take over an enemy structure (not a Command Yard) after 5 seconds beside it. Interrupted if the Engineer moves or is hurt.',
    cooldown: 200,
    target: 'building',
    range: 1,
  },
  ace: {
    name: 'Overdrive',
    blurb: 'For 10 seconds the Ace moves half again as fast and reloads in two thirds of the time.',
    cooldown: 450,
    target: 'none',
    range: 0,
  },
};

/** Ticks from planting a charge to its explosion; from starting a capture to owning the structure. */
export const CHARGE_FUSE = 30;
export const CAPTURE_TICKS = 50;
export const OVERDRIVE_TICKS = 100;
/** Enemy units or structures within this many tiles see a Spy. */
export const SPY_DETECT_RANGE = 2;
/** The Engineer repairs own vehicles within this range by this many hp per tick. */
export const ENGINEER_REPAIR_RANGE = 1.5;
export const ENGINEER_REPAIR_PER_TICK = 2;

/** Hero experience: total xp needed for each level, level 1 at index 0. Kills give xp in battle. */
export const HERO_LEVEL_XP = [0, 100, 250, 500, 900];
export const HERO_MAX_LEVEL = HERO_LEVEL_XP.length;
/** Per level above 1: health and damage up, ability cooldown down. */
export const HERO_HP_PER_LEVEL = 0.08;
export const HERO_DAMAGE_PER_LEVEL = 0.08;
export const HERO_COOLDOWN_PER_LEVEL = 0.06;
/** Xp a hero earns for a kill: a unit is worth its cost / 20 (min 5), a structure 40. */
export const HERO_XP_STRUCTURE = 40;

export function heroLevelFor(xp: number): number {
  let l = 1;
  while (l < HERO_MAX_LEVEL && xp >= HERO_LEVEL_XP[l]) l++;
  return l;
}

export type SupportPower = 'recon' | 'barrage' | 'reinforce';

export interface PowerSpec {
  name: string;
  blurb: string;
  cooldown: number;
  /** Tiles. For barrage, the blast radius; for recon, how far it reveals. */
  radius: number;
}

export const POWERS: Record<SupportPower, PowerSpec> = {
  recon: { name: 'Recon sweep', blurb: 'Reveal a wide area of the map, and any Spies in it, for 15 seconds.', cooldown: 1200, radius: 9 },
  barrage: { name: 'Artillery barrage', blurb: 'Eight shells land across the target area over four seconds.', cooldown: 1800, radius: 3 },
  reinforce: { name: 'Reinforcements', blurb: 'Four riflemen and a tank arrive at the map edge nearest your base.', cooldown: 2400, radius: 0 },
};
/** How long a recon sweep keeps its area revealed. */
export const RECON_TICKS = 150;

/** Ticks a Spy's sabotage of a Generator, and of a War Factory or Barracks, lasts. */
export const SPY_BLACKOUT_TICKS = 600;
export const SPY_SABOTAGE_TICKS = 450;
/** Most a Spy steals from a Refinery, and the share of the enemy's credits taken. */
export const SPY_STEAL_MAX = 1500;
export const SPY_STEAL_SHARE = 0.5;
/** Share of a Command Yard's full health a demolition charge takes (anything else is destroyed). */
export const CHARGE_HQ_SHARE = 0.6;
/** Overdrive: speed multiplier and reload multiplier while it lasts. */
export const OVERDRIVE_SPEED = 1.5;
export const OVERDRIVE_RELOAD = 2 / 3;
/** Artillery barrage: shells, damage of each, splash radius, and ticks between landings. */
export const BARRAGE_SHELLS = 8;
export const BARRAGE_DAMAGE = 110;
export const BARRAGE_SPLASH = 1.5;
export const BARRAGE_GAP = 5;
/** Reinforcements: who arrives. */
export const REINFORCEMENTS: UnitKind[] = ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'tank'];
/** Xp a hero earns for a successful infiltration or capture (the same as destroying a structure). */
export const HERO_XP_ABILITY = HERO_XP_STRUCTURE;
