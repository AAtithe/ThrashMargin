/**
 * Every number the battle runs on, in one place. The simulation reads these and nothing else, so a
 * balance change is an edit here and a run of `npm run drive`.
 *
 * Units of measure: distances in tiles, time in ticks (TICKS_PER_SECOND per second of play at
 * normal speed), money in credits.
 */

export const TICKS_PER_SECOND = 10;
/**
 * The size of every map before map size became a state property, and still the size of every
 * two-sided map. A battle's own size is `s.mapW` by `s.mapH`: read that, never these, in the
 * simulation and the renderer. Generators that know no state (map.ts, maps.ts) still build 64 by 64.
 */
export const MAP_W = 64;
export const MAP_H = 64;

/**
 * A side in the battle. Side 0 is always the human player; sides 1 to 3 are computer commanders.
 * A battle has 2, 3 or 4 sides (`s.players.length`), each on a team (`s.teams`). Ask who is whose
 * enemy through `src/sim/sides.ts` (isEnemy, isAlly, enemiesOf), never with `1 - owner`.
 */
export type Owner = 0 | 1 | 2 | 3;
/** The most sides a battle can have. */
export const MAX_SIDES = 4;

export type Armor = 'infantry' | 'light' | 'heavy' | 'building' | 'aircraft';
/**
 * 'flame' is the Flame Tank's short-range burst; 'missile' is the Strike Command's one huge strike
 * (a support power, never a unit's weapon). Grenadiers lob 'artillery' (it arcs and scatters).
 */
export type WeaponKind = 'bullet' | 'shell' | 'rocket' | 'artillery' | 'flame' | 'missile' | 'flak' | 'aamissile' | 'bomb';

/**
 * How hard each weapon hits each armour class. Riflemen shred infantry and scratch a tank. The
 * aircraft column only matters for weapons that can reach the air (hitsAir): bullets at a reduced
 * effect, flak and anti-air missiles in full. The rest never hit an aircraft, whatever it says.
 */
export const DAMAGE_VS: Record<WeaponKind, Record<Armor, number>> = {
  bullet: { infantry: 1, light: 0.6, heavy: 0.22, building: 0.15, aircraft: 0.35 },
  shell: { infantry: 0.45, light: 0.9, heavy: 1, building: 0.75, aircraft: 0 },
  rocket: { infantry: 0.3, light: 1, heavy: 1.15, building: 0.9, aircraft: 0 },
  artillery: { infantry: 1, light: 0.8, heavy: 0.55, building: 1, aircraft: 0 },
  flame: { infantry: 1.25, light: 0.7, heavy: 0.3, building: 1.1, aircraft: 0 },
  missile: { infantry: 1, light: 1, heavy: 0.9, building: 1, aircraft: 0 },
  flak: { infantry: 0, light: 0, heavy: 0, building: 0, aircraft: 1 },
  aamissile: { infantry: 0, light: 0, heavy: 0, building: 0, aircraft: 1 },
  bomb: { infantry: 0.9, light: 0.9, heavy: 0.8, building: 1.1, aircraft: 0 },
};

/** Ticks a projectile of each kind spends in the air before it lands. Bullets are instant. */
export const FLIGHT_TICKS: Record<WeaponKind, number> = {
  bullet: 0,
  shell: 2,
  rocket: 4,
  artillery: 9,
  flame: 0,
  missile: 40,
  flak: 3,
  aamissile: 5,
  bomb: 6,
};

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
  /** Can fire at aircraft. Read it through hitsAir(): absent means bullets only. */
  canHitAir?: boolean;
  /** Can fire at ground units and structures. Read it through hitsGround(): absent means yes. */
  canHitGround?: boolean;
}

/** True when this weapon can fire at an aircraft. Every ground weapon but bullets cannot. */
export const hitsAir = (w: Weapon): boolean => w.canHitAir ?? w.kind === 'bullet';
/** True when this weapon can fire at something on the ground (units and structures). */
export const hitsGround = (w: Weapon): boolean => w.canHitGround ?? true;

/** Named special characters. Campaign-only: never in a build menu, never in a skirmish. */
export type HeroKind = 'spy' | 'commando' | 'engineer' | 'ace';
export const HERO_KINDS: HeroKind[] = ['spy', 'commando', 'engineer', 'ace'];
export type UnitKind =
  | 'rifleman'
  | 'rocketeer'
  | 'hauler'
  | 'buggy'
  | 'tank'
  | 'artillery'
  | 'grenadier'
  | 'medic'
  | 'flametank'
  | 'missilecarrier'
  | 'bastion'
  | 'gunship'
  | 'bomber'
  | 'flaktrack'
  | 'skyhunter'
  | HeroKind;
export type BuildingKind =
  | 'hq'
  | 'power'
  | 'refinery'
  | 'barracks'
  | 'factory'
  | 'turret'
  | 'uplink'
  | 'techcentre'
  | 'repairbay'
  | 'wall'
  | 'rocketturret'
  | 'strikecommand'
  | 'helipad'
  | 'flakcannon'
  | 'researchlab';
export type Category = 'building' | 'infantry' | 'vehicle' | 'air';

export interface UnitSpec {
  name: string;
  category: 'infantry' | 'vehicle' | 'air';
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
  /** Heals own infantry nearby (the Medic): see MEDIC_* below. */
  medic?: true;
  /** Hit points regained every SELF_REPAIR_TICKS while not fighting (the Bastion). */
  selfRepair?: number;
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
  /**
   * A wall: blocks movement and may stand against other walls, but is not a structure for victory,
   * for the build radius, or for the crew that walks out when one falls. Absent on the rest.
   */
  wall?: true;
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
  grenadier: {
    name: 'Grenadier',
    category: 'infantry',
    cost: 250,
    buildTicks: 70,
    hp: 65,
    armor: 'infantry',
    speed: 0.06,
    sight: 6,
    weapon: { kind: 'artillery', damage: 34, range: 4.5, cooldown: 32, splash: 1, minRange: 1.25 },
    requires: ['barracks'],
    blurb: 'Lobs grenades over a short arc. The splash breaks up infantry and cracks structures.',
  },
  medic: {
    name: 'Medic',
    category: 'infantry',
    cost: 300,
    buildTicks: 70,
    hp: 70,
    armor: 'infantry',
    speed: 0.065,
    sight: 6,
    requires: ['barracks'],
    blurb: 'Unarmed. Patches up wounded infantry within two tiles, and goes to them when idle.',
    medic: true,
  },
  flametank: {
    name: 'Flame Tank',
    category: 'vehicle',
    cost: 1100,
    buildTicks: 120,
    hp: 480,
    armor: 'heavy',
    speed: 0.09,
    sight: 5,
    weapon: { kind: 'flame', damage: 26, range: 2.75, cooldown: 7, splash: 0.9 },
    requires: ['factory', 'techcentre'],
    blurb: 'Short-range jets of fire with splash. Deadly to infantry and structures; must get close.',
  },
  missilecarrier: {
    name: 'Missile Carrier',
    category: 'vehicle',
    cost: 1300,
    buildTicks: 130,
    hp: 240,
    armor: 'light',
    speed: 0.08,
    sight: 7,
    weapon: { kind: 'rocket', damage: 75, range: 8, cooldown: 60, minRange: 2.5 },
    requires: ['factory', 'uplink'],
    blurb: 'Long-range anti-armour rockets. Cannot fire at anything closer than two and a half tiles.',
  },
  bastion: {
    name: 'Bastion',
    category: 'vehicle',
    cost: 1800,
    buildTicks: 190,
    hp: 900,
    armor: 'heavy',
    speed: 0.06,
    sight: 6,
    weapon: { kind: 'shell', damage: 85, range: 5.5, cooldown: 32 },
    requires: ['factory', 'techcentre'],
    blurb: 'A slow, heavy siege tank with a great cannon. Mends its own armour out of combat.',
    selfRepair: 3,
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
  // ---- Air power (round 4, workstream A): advanced tech only --------------------------------
  gunship: {
    name: 'Gunship',
    category: 'air',
    cost: 1400,
    buildTicks: 150,
    hp: 320,
    armor: 'aircraft',
    speed: 0.13,
    sight: 7,
    weapon: { kind: 'rocket', damage: 38, range: 4.5, cooldown: 18, canHitAir: false },
    requires: ['helipad'],
    blurb: 'Attack helicopter. Flies over anything and rockets ground targets, then returns to its Helipad to rearm.',
  },
  bomber: {
    name: 'Bomber',
    category: 'air',
    cost: 2000,
    buildTicks: 200,
    hp: 280,
    armor: 'aircraft',
    speed: 0.22,
    sight: 6,
    weapon: { kind: 'bomb', damage: 110, range: 3.5, cooldown: 4, splash: 1.3, canHitAir: false },
    requires: ['helipad', 'techcentre'],
    blurb: 'Fast. Flies over its target dropping a line of bombs, then returns to its Helipad to rearm.',
  },
  flaktrack: {
    name: 'Flak Track',
    category: 'vehicle',
    cost: 700,
    buildTicks: 90,
    hp: 260,
    armor: 'light',
    speed: 0.1,
    sight: 8,
    weapon: { kind: 'flak', damage: 26, range: 6.5, cooldown: 10, splash: 0.8, canHitAir: true, canHitGround: false },
    requires: ['factory'],
    blurb: 'Mobile anti-air guns. Shreds aircraft; cannot fire at anything on the ground.',
  },
  skyhunter: {
    name: 'Skyhunter',
    category: 'infantry',
    cost: 350,
    buildTicks: 80,
    hp: 55,
    armor: 'infantry',
    speed: 0.06,
    sight: 7,
    weapon: { kind: 'aamissile', damage: 60, range: 6, cooldown: 32, canHitAir: true, canHitGround: false },
    requires: ['barracks'],
    blurb: 'Shoulder-launched anti-air missiles. Brings down aircraft; helpless against anything on the ground.',
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
  techcentre: {
    name: 'Tech Centre',
    w: 2,
    h: 2,
    cost: 2000,
    buildTicks: 180,
    hp: 900,
    power: -60,
    sight: 4,
    requires: ['factory', 'uplink'],
    blurb: 'Unlocks the heaviest arms: Flame Tanks, Bastions and the Strike Command. Grants the artillery barrage.',
  },
  repairbay: {
    name: 'Repair Bay',
    w: 2,
    h: 2,
    cost: 800,
    buildTicks: 100,
    hp: 700,
    power: -30,
    sight: 4,
    requires: ['factory'],
    blurb: 'Mends your vehicles parked on or beside it, paid as it goes.',
  },
  wall: {
    name: 'Sandbag Wall',
    w: 1,
    h: 1,
    cost: 50,
    buildTicks: 15,
    hp: 350,
    power: 0,
    sight: 1,
    requires: ['barracks'],
    blurb: 'Blocks the way. Walls may be laid side by side; they do not count as structures.',
    wall: true,
  },
  rocketturret: {
    name: 'Rocket Turret',
    w: 1,
    h: 1,
    cost: 900,
    buildTicks: 110,
    hp: 500,
    power: -40,
    sight: 8,
    weapon: { kind: 'rocket', damage: 60, range: 7.5, cooldown: 40 },
    requires: ['uplink'],
    blurb: 'Long-range anti-armour defence. Weak against infantry; slows when power is short.',
  },
  strikecommand: {
    name: 'Strike Command',
    w: 3,
    h: 3,
    cost: 3500,
    buildTicks: 300,
    hp: 1400,
    power: -150,
    sight: 5,
    requires: ['techcentre'],
    blurb: 'Draws heavy power. Grants the missile strike: one huge blast, every eight minutes.',
  },
  // ---- Air power and research (round 4, workstream A): advanced tech only -------------------
  helipad: {
    name: 'Helipad',
    w: 2,
    h: 2,
    cost: 1500,
    buildTicks: 150,
    hp: 700,
    power: -40,
    sight: 5,
    requires: ['factory', 'uplink'],
    blurb: 'Builds aircraft and rearms them. Each Helipad serves two aircraft.',
  },
  flakcannon: {
    name: 'Flak Cannon',
    w: 1,
    h: 1,
    cost: 700,
    buildTicks: 90,
    hp: 450,
    power: -25,
    sight: 8,
    weapon: { kind: 'flak', damage: 30, range: 7.5, cooldown: 9, splash: 0.8, canHitAir: true, canHitGround: false },
    requires: ['barracks'],
    blurb: 'Anti-air turret. Shreds aircraft; cannot fire at anything on the ground. Slows when power is short.',
  },
  researchlab: {
    name: 'Research Lab',
    w: 2,
    h: 2,
    cost: 1500,
    buildTicks: 150,
    hp: 650,
    power: -50,
    sight: 4,
    requires: ['factory'],
    blurb: 'Researches upgrades that last the rest of the battle, one at a time.',
  },
};

/** Structures in the order the build menu offers them. */
export const BUILD_MENU: BuildingKind[] = [
  'power',
  'refinery',
  'barracks',
  'factory',
  'turret',
  'uplink',
  'wall',
  'repairbay',
  'rocketturret',
  'techcentre',
  'strikecommand',
  'flakcannon',
  'helipad',
  'researchlab',
];
export const INFANTRY_MENU: UnitKind[] = ['rifleman', 'rocketeer', 'grenadier', 'medic', 'skyhunter'];
export const VEHICLE_MENU: UnitKind[] = ['hauler', 'buggy', 'tank', 'artillery', 'missilecarrier', 'flametank', 'bastion', 'flaktrack'];

/**
 * The original game: six structures (and the Command Yard) and six units. A skirmish set up with
 * 'standard' tech offers these alone, and a mission's enemy is held to them.
 */
export const STANDARD_TECH: readonly (BuildingKind | UnitKind)[] = [
  'power',
  'refinery',
  'barracks',
  'factory',
  'turret',
  'uplink',
  'rifleman',
  'rocketeer',
  'hauler',
  'buggy',
  'tank',
  'artillery',
];

/** Which structure each queue needs before it will make progress. */
export const PRODUCER: Record<Category, BuildingKind> = {
  building: 'hq',
  infantry: 'barracks',
  vehicle: 'factory',
  air: 'helipad',
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

/** Medic: heals the most hurt own infantry (not itself) within range, this much every so often. */
export const MEDIC_RANGE = 2;
export const MEDIC_HEAL = 4;
export const MEDIC_HEAL_TICKS = 5;
/** How far an idle Medic looks for wounded infantry to walk to. */
export const MEDIC_SEEK = 6;

/** The Bastion: UnitSpec.selfRepair hit points every this many ticks, out of combat. */
export const SELF_REPAIR_TICKS = 10;

/**
 * Repair Bay: own vehicles within this distance of its footprint regain REPAIR_BAY_HP every
 * REPAIR_BAY_TICKS (half as often when power is short), paying REPAIR_COST_SHARE of their cost per
 * hit point, as structure repair does.
 */
export const REPAIR_BAY_RANGE = 1;
export const REPAIR_BAY_HP = 6;
export const REPAIR_BAY_TICKS = 5;

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

/**
 * Each side's name. Sides 2 and 3 exist for battles of three or four sides; no lobby option creates
 * them yet (see fireline-round4-design.md, workstream B), but every system handles them.
 */
export const SIDE_NAMES: Record<Owner, string> = { 0: 'Meridian Corps', 1: 'Ashen Combine', 2: 'Verdant Front', 3: 'Ochre Legion' };

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

export type SupportPower = 'recon' | 'barrage' | 'reinforce' | 'missile';

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
  missile: {
    name: 'Missile strike',
    blurb: 'One missile, one huge blast. The target is marked for everyone to see four seconds before it lands.',
    cooldown: 4800,
    radius: 4,
  },
};

/** Missile strike: damage at the centre (half at the edge of POWERS.missile.radius). Lands FLIGHT_TICKS.missile after the call. */
export const MISSILE_DAMAGE = 800;

/**
 * Skirmish support powers, for both sides, with 'advanced' tech: each is held while a structure of
 * this kind stands, and lost with the last of them. A power is granted on cooldown (it charges
 * first). Missions keep their own powers and ignore this.
 */
export const SKIRMISH_POWERS: Partial<Record<SupportPower, BuildingKind>> = {
  recon: 'uplink',
  barrage: 'techcentre',
  missile: 'strikecommand',
};

// ---- Skirmish setup ---------------------------------------------------------------------------

export type MapType = 'classic' | 'river' | 'highlands' | 'lakes' | 'plains' | 'canyon';
export const MAP_TYPES: MapType[] = ['classic', 'river', 'highlands', 'lakes', 'plains', 'canyon'];
export const MAP_TYPE_NAMES: Record<MapType, string> = {
  classic: 'Classic',
  river: 'River',
  highlands: 'Highlands',
  lakes: 'Lakes',
  plains: 'Plains',
  canyon: 'Canyon',
};
export const MAP_TYPE_BLURBS: Record<MapType, string> = {
  classic: 'Mixed ground: woods, ridges and ponds, with tracks between the bases.',
  river: 'A river across the middle, crossed at three fords, with an island of ore midstream.',
  highlands: 'Rock ridges cut the field; armies meet in narrow passes.',
  lakes: 'Lakes all over, with land corridors between them.',
  plains: 'Open country and plenty of ore. Few places to hide.',
  canyon: 'Cliffs split the middle into two or three long corridors.',
};

export type TechLevel = 'standard' | 'advanced';
export type OreLevel = 'poor' | 'normal' | 'rich';

export interface SkirmishSetup {
  map: MapType | 'random';
  /** 'standard': the original six structures and six units, no support powers. 'advanced': everything. */
  tech: TechLevel;
  /** Each side's starting credits. */
  credits: number;
  ore: OreLevel;
  /** How many sides fight: side 0 (the player) and one, two or three computer commanders. */
  sides: 2 | 3 | 4;
  /** 'ffa': every side for itself. 'teams': two teams (see teamsFor in sides.ts). Always 'ffa' with 2 sides. */
  mode: SideMode;
}

/** How the sides of a battle of three or four are grouped. */
export type SideMode = 'ffa' | 'teams';

/** What the lobby offers a new skirmish by default. */
export const DEFAULT_SETUP: SkirmishSetup = { map: 'random', tech: 'advanced', credits: 3000, ore: 'normal', sides: 2, mode: 'ffa' };
/**
 * A battle with no setup recorded: saves from before setups, and createInitialState called without
 * one. The original game exactly: the original map generator, standard tech, no skirmish powers.
 */
export const LEGACY_SETUP: SkirmishSetup = { map: 'classic', tech: 'standard', credits: 3000, ore: 'normal', sides: 2, mode: 'ffa' };
/** A skirmish map's width and height in tiles, by the number of sides: square, larger for more. */
export const MAP_SIZE_FOR: Record<2 | 3 | 4, number> = { 2: 64, 3: 80, 4: 96 };
/** What each map type looks like with three or four sides, where the two-sided blurb does not fit. */
export const MAP_TYPE_BLURBS_SIDES: Record<MapType, string> = {
  classic: 'Mixed ground: woods, ridges and ponds, with tracks to every neighbour and the centre.',
  river: 'Rivers between neighbours, each crossed at two fords, meeting at an island of ore in the centre.',
  highlands: 'Ridges between neighbours and a ring of them round the centre; armies meet in narrow passes.',
  lakes: 'Lakes all over, with land corridors and causeways between them.',
  plains: 'Open country and plenty of ore. Few places to hide.',
  canyon: 'A ring of cliffs round the centre, cut by wide corridors from every base.',
};
/** The number of sides the lobby offers. */
export const SIDE_COUNTS: (2 | 3 | 4)[] = [2, 3, 4];
/**
 * Three sides played as teams is two against one: side 1, alone, starts with this many times the
 * setup's credits (the rest of the rules are the same for every side). Measured over whole
 * computer battles (fireline-design.md, round 4 build log).
 */
export const LONE_SIDE_CREDITS = 2.25;
export const SETUP_CREDITS_MIN = 1000;
export const SETUP_CREDITS_MAX = 20000;
/** Starting-credit choices for the lobby. */
export const SETUP_CREDIT_CHOICES = [2000, 3000, 5000, 10000];
/** Ore per tile and field size by setting. */
export const ORE_LEVELS: Record<OreLevel, { amount: number; radius: number }> = {
  poor: { amount: 0.55, radius: 0 },
  normal: { amount: 1, radius: 0 },
  rich: { amount: 1.3, radius: 1 },
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

// ---- Air power and research (round 4, workstream A; fireline-round4-design.md) ------------------
//
// Advanced tech only: on standard tech and in a mission none of this is offered. The simulation is
// in air.ts (aircraft) and research.ts (upgrades); the computer's side of it in aiAir.ts.

/** Aircraft in the order the Air tab offers them. */
export const AIR_MENU: UnitKind[] = ['gunship', 'bomber'];

/** How many aircraft one Helipad serves: it builds for them and rearms them. */
export const HELIPAD_SLOTS = 2;

/** True for an aircraft: any unit whose category is 'air'. */
export const isAirKind = (kind: UnitKind): boolean => UNITS[kind].category === 'air';

/**
 * Loads an aircraft carries. A Gunship fires one rocket per load; a Bomber drops one bomb per load,
 * all of them in one run. With none left it flies back to its Helipad to rearm.
 */
export const AIR_AMMO: Partial<Record<UnitKind, number>> = { gunship: 8, bomber: 6 };
/** Ticks on its Helipad to put back one load (Air frames shortens it). */
export const REARM_TICKS: Partial<Record<UnitKind, number>> = { gunship: 12, bomber: 25 };
/** Ticks between bombs in a run: with the Bomber's speed, a bomb about every 0.9 tiles. */
export const BOMB_GAP = 4;
/** Aircraft keep at least this far from the map's edge. */
export const AIR_EDGE = 0.5;

export type UpgradeId = 'plating' | 'calibration' | 'engines' | 'refining' | 'airframes';

export interface UpgradeSpec {
  name: string;
  blurb: string;
  cost: number;
  ticks: number;
  /** Always includes 'researchlab'. */
  requires: BuildingKind[];
}

export const UPGRADES: Record<UpgradeId, UpgradeSpec> = {
  plating: {
    name: 'Armour plating',
    blurb: 'Vehicles have a fifth more health.',
    cost: 1500,
    ticks: 600,
    requires: ['researchlab'],
  },
  calibration: {
    name: 'Weapon calibration',
    blurb: 'Every weapon you field, units and structures alike, hits 15% harder.',
    cost: 2000,
    ticks: 750,
    requires: ['researchlab', 'techcentre'],
  },
  engines: {
    name: 'Engine tuning',
    blurb: 'Vehicles move 15% faster.',
    cost: 1200,
    ticks: 500,
    requires: ['researchlab'],
  },
  refining: {
    name: 'Refinery efficiency',
    blurb: 'Every load of ore pays 15% more.',
    cost: 2000,
    ticks: 700,
    requires: ['researchlab'],
  },
  airframes: {
    name: 'Air frames',
    blurb: 'Aircraft have a quarter more health and rearm 40% sooner.',
    cost: 1500,
    ticks: 600,
    requires: ['researchlab', 'helipad'],
  },
};

/** Upgrades in the order the Research block lists them. */
export const UPGRADE_ORDER: UpgradeId[] = ['refining', 'plating', 'engines', 'calibration', 'airframes'];

/** What each upgrade does to the number it changes. */
export const PLATING_HP = 1.2;
export const CALIBRATION_DAMAGE = 1.15;
export const ENGINES_SPEED = 1.15;
export const REFINING_INCOME = 1.15;
export const AIRFRAMES_HP = 1.25;
export const AIRFRAMES_REARM = 0.6;
