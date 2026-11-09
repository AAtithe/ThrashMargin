import type { BuildingKind, Category, Difficulty, HeroKind, MapType, Owner, SkirmishSetup, SupportPower, UnitKind, UpgradeId, WeaponKind } from './rules';

/**
 * Positions are in tiles, as floats: the centre of tile (3, 7) is (3.5, 7.5). Tile indices are
 * `y * s.mapW + x` (tileAt in grid.ts). Every list here is replaced, never mutated in place, by the reducer: an action
 * clones the state once and works on the clone, so the state passed in is never touched.
 */

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'attackMove'; x: number; y: number }
  | { type: 'attack'; target: number }
  | {
      type: 'harvest';
      phase: 'seek' | 'gather' | 'return' | 'unload';
      /** The ore tile being worked, or -1. */
      tile: number;
      /** The refinery being returned to, or 0. */
      refinery: number;
    }
  /**
   * Aircraft only: fly to this Helipad, land and take on ammunition. Once full it stays parked on
   * the pad with this order until given another (or runs the next queued one).
   */
  | { type: 'rearm'; pad: number };

/** Orders a unit can hold in its waypoint queue, run one after another. */
export type QueuedOrder = Extract<Order, { type: 'move' } | { type: 'attackMove' } | { type: 'attack' }>;

/**
 * What an idle unit does about enemies. Guard (the default) fires at anything in range and answers
 * fire from close by; aggressive chases anything in sight; hold fires only when ordered to.
 * Explicit orders (attack, attack-move) work the same under every stance.
 */
export type Stance = 'aggressive' | 'guard' | 'hold';

export interface Unit {
  id: number;
  owner: Owner;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  /** Hull facing, a unit vector. */
  fx: number;
  fy: number;
  /** Turret facing, a unit vector. */
  tx: number;
  ty: number;
  order: Order;
  /** Id of what this unit is currently shooting at, or 0. */
  engage: number;
  /** Waypoints still to visit, as tile indices. */
  path: number[];
  /** Tile index the current path leads to, or -1. */
  pathGoal: number;
  /** Tick the path was last computed, for throttled re-pathing. */
  pathTick: number;
  cooldown: number;
  /** Ore carried (haulers only). */
  cargo: number;
  /** Ticks spent unable to make progress, which triggers a re-path. */
  stuck: number;
  kills: number;
  /** Rank from kills: 0 rookie, 1 veteran, 2 elite (thresholds in rules.ts VET_KILLS). */
  vet: number;
  /** Orders to run after the current one, oldest first (shift-click). */
  queue: QueuedOrder[];
  stance: Stance;
  /** Present on the four named heroes only (campaign). */
  hero?: HeroState;
  /**
   * Full health, when it differs from UNITS[kind].hp: Commander perks (Armour) on side 0's units,
   * and hero levels. Absent means UNITS[kind].hp. Read it through maxHpOf() in state.ts.
   */
  maxHp?: number;
  /** Aircraft only: loads left (AIR_AMMO); 0 means it must rearm. */
  ammo?: number;
  /** Aircraft only: the Helipad it belongs to, or 0 for none. */
  pad?: number;
  /** Bombers only: present while a bomb run is under way (it always finishes the run). */
  bombRun?: true;
}

/** A hero's progress and ability state. Level and xp carry between campaign missions. */
export interface HeroState {
  level: number;
  xp: number;
  /** Ticks until the ability can be used again; 0 means ready. */
  abilityCd: number;
  /**
   * What the hero is doing with the ability right now, if anything. Overdrive lasts until a tick;
   * a capture's progress runs from 0 to 1 (owned at 1).
   */
  active?:
    | { kind: 'overdrive'; until: number }
    | { kind: 'capture'; target: number; progress: number };
}

export interface Building {
  id: number;
  owner: Owner;
  kind: BuildingKind;
  /** Top-left tile. */
  x: number;
  y: number;
  hp: number;
  placedAt: number;
  repairing: boolean;
  /** Where units leaving this building head, if set. */
  rally: { x: number; y: number } | null;
  cooldown: number;
  engage: number;
  /** Turret facing, for buildings with a weapon. */
  tx: number;
  ty: number;
  /** A demolition charge planted on it: explodes at this tick. */
  chargeAt?: number;
  /** Id of the Commando who planted the charge, credited with the kill. */
  chargedBy?: number;
  /** Production stopped (spy on a factory or barracks) until this tick. */
  sabotagedUntil?: number;
}

export interface QueueItem {
  kind: BuildingKind | UnitKind;
  /** Ticks of work done. Halves its rate while power is short. */
  progress: number;
}

export interface PlayerState {
  owner: Owner;
  name: string;
  credits: number;
  /** One queue per category, 'air' included (migrateAir gives older saves an empty one). */
  queues: Record<Category, QueueItem[]>;
  stats: { built: number; trained: number; lost: number; killed: number; harvested: number };
  /** Upgrades researched, in the order they were finished. Absent: none. */
  upgrades?: UpgradeId[];
  /** The upgrade being researched, already paid for; ticks of work done. Absent or null: none. */
  research?: { id: UpgradeId; progress: number } | null;
}

export interface Projectile {
  id: number;
  owner: Owner;
  weapon: WeaponKind;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  firedAt: number;
  hitAt: number;
  target: number;
  damage: number;
  splash: number;
  /** Id of the unit that fired it, or 0 (structures, and saves from before this field). */
  shooter?: number;
}

/** Things that happened, kept for a few seconds so the renderer can draw them. Never read back. */
export interface Effect {
  id: number;
  kind:
    | 'muzzle'
    | 'boom'
    | 'sold'
    | 'infiltrate'
    | 'captured'
    | 'charge'
    | 'levelup'
    | 'recon'
    | 'barrage'
    | 'reinforce'
    | 'missile'
    | 'heal'
    | 'repair'
    /** A bomb's impact in a Bomber's line; size is the splash radius. */
    | 'bomb';
  x: number;
  y: number;
  at: number;
  /**
   * Explosion size: 0 small hit, 1 vehicle, 2 structure. For 'missile' (the warning marker at the
   * target, from the call until impact FLIGHT_TICKS.missile later), 'recon' and 'barrage': the
   * radius in tiles. 'heal' (a Medic at work) and 'repair' (a Repair Bay at work) sit on the unit
   * being mended, with size 0.
   */
  size: number;
  weapon?: WeaponKind;
  /** For muzzle flashes: where the shot is going. */
  x2?: number;
  y2?: number;
}

export interface LogEntry {
  tick: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

/** What the computer side remembers between decisions. Lives in state so replays stay exact. */
export interface AiMemory {
  nextAttack: number;
  wave: number;
  /** The last time and place one of its structures was hit. */
  hurtTick: number;
  hurtX: number;
  hurtY: number;
  /** The attack wave: its members, and 0 forming, 1 gathering at the staging point, 2 attacking. */
  waveIds: number[];
  wavePhase: number;
  /** Tick the wave entered its current phase, or last regrouped. */
  waveTick: number;
  /** How many set out, so the wave knows when it has been broken. */
  waveSize: number;
  /** The hauler raid: its buggies, the hauler being hunted (0 for none), and when the next may go. */
  raidIds: number[];
  raidTarget: number;
  nextRaid: number;
  /** Aircraft out on a strike (aiAir.ts), and the tick the next strike may go. */
  airIds?: number[];
  nextAirStrike?: number;
}

export interface GameState {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  seedText: string;
  rngSeed: number;
  difficulty: Difficulty;
  tick: number;
  /** One character per tile: g grass, d dirt, r rock, w water, t trees. Never changes. */
  tiles: string;
  /** Ore held by each tile, 0 for none. */
  ore: number[];
  /**
   * Map size in tiles. Every per-tile string and array (tiles, ore, explored) is mapW * mapH long.
   * Saves from before this field are 64 by 64 (migrateState fills it in). Never changes.
   */
  mapW: number;
  mapH: number;
  /**
   * Tiles side 0 (the human) has ever seen, one character each: '1' seen, '0' not. Side 0 sees
   * what its whole team sees. Computer sides see the whole map (a stated rule), so they need none.
   */
  explored: string;
  units: Unit[];
  buildings: Building[];
  /** One per side, indexed by Owner. Its length is the number of sides: 2, 3 or 4. */
  players: PlayerState[];
  /**
   * The team each side is on, indexed by Owner, one entry per side. Sides on the same team are
   * allies: they never target or splash each other and win or lose together. Two sides: [0, 1].
   * Free-for-all: side i on team i. Saves from before this field get the free-for-all default
   * (migrateState). Never changes during a battle. Read it through teamOf/isEnemy in sides.ts.
   */
  teams: number[];
  projectiles: Projectile[];
  effects: Effect[];
  /** One per side, indexed by Owner. Side 0's is used only when the computer plays it (autopilot). */
  ai: AiMemory[];
  /** When true the computer also plays side 0. Used by the test harness only. */
  autopilot: boolean;
  nextId: number;
  /**
   * Who won, once the battle is over. With teams, the lowest-numbered side of the winning team
   * (side 0 whenever the human's team won, even if side 0 itself was wiped out). Ask
   * `wonBy(s, owner)` in sides.ts rather than comparing this to a side.
   */
  winner: Owner | null;
  log: LogEntry[];
  /** Last tick each kind of warning was logged, so alarms do not flood the log. */
  alarms: Record<string, number>;
  /** Difficulty the computer plays side 0 with in the harness; defaults to s.difficulty. */
  autopilotDifficulty?: Difficulty;

  // ---- Skirmish setup (optional: absent on older saves and missions; read it through setupOf) ---
  /** How this skirmish was set up. Absent means LEGACY_SETUP: the original game. */
  setup?: SkirmishSetup;
  /** The map type actually generated (setup.map may say 'random'). Absent: the original map. */
  mapType?: MapType;
  /**
   * Top-left tile of each side's starting Command Yard, one per side. Absent: START_0 and START_1
   * (map.ts), which only a two-sided battle may rely on. Read it through startOf in sides.ts.
   */
  starts?: { x: number; y: number }[];

  // ---- Campaign (all optional: a skirmish has none of these) ------------------------------------
  /** The mission being played, with its objectives; null or absent in a skirmish. */
  mission?: MissionRuntime | null;
  /** Commander perks applied to side 0 for this battle. */
  perks?: Perks;
  /**
   * Support powers per side: ticks until each is ready again (absent means not available). A
   * mission sets its own; a skirmish on advanced tech gets them from its structures (SKIRMISH_POWERS,
   * kept in step by syncSkirmishPowers in state.ts).
   */
  powers?: Partial<Record<SupportPower, number>>[];
  /** Kinds side 0 may queue in this battle; null or absent means everything. */
  allowed?: (BuildingKind | UnitKind)[] | null;
  /** Power cut for each side until this tick (spy on a generator), one entry per side. */
  blackoutUntil?: number[];
  /** Tiles revealed to side 0 by a recon sweep until a tick: [centre x, centre y, radius, until]. */
  recon?: [number, number, number, number][];
}

// ---- Missions --------------------------------------------------------------------------------

export type ObjectiveSpec =
  | { kind: 'destroyAll' }
  | { kind: 'destroy'; building: BuildingKind; count: number }
  | { kind: 'survive'; ticks: number }
  | { kind: 'keepAlive'; hero: HeroKind }
  | { kind: 'infiltrate'; building: BuildingKind }
  | { kind: 'capture'; building: BuildingKind }
  | { kind: 'reach'; who: HeroKind | 'any'; x: number; y: number; r: number }
  | {
      kind: 'holdZone';
      x: number;
      y: number;
      r: number;
      ticks: number;
      /** False (the default): progress pauses while the zone is contested. True: it drops to 0 whenever an enemy stands in it with none of ours. */
      reset?: boolean;
    }
  | { kind: 'harvest'; credits: number }
  | { kind: 'build'; building: BuildingKind; count: number }
  /** The mission's convoy (MissionSpec.convoy): done when `count` of its units are within `r` of (x, y); failed when fewer than `count` are left alive. */
  | { kind: 'escort'; x: number; y: number; r: number; count: number }
  /** Like destroy, and failed once the battle passes `ticks` with it not done. */
  | { kind: 'destroyWithin'; building: BuildingKind; count: number; ticks: number };

export interface ObjectiveRuntime {
  spec: ObjectiveSpec;
  /** Words shown to the player, e.g. "Destroy the enemy War Factory". */
  label: string;
  done: boolean;
  failed: boolean;
  /** 0..1 for the progress bar. */
  progress: number;
}

export interface SpawnSpec {
  owner: Owner;
  kind: UnitKind;
  count: number;
  x: number;
  y: number;
  /** What they do on arrival: attack-move to (tx, ty), or stand guard. */
  order: 'attackMove' | 'guard';
  tx?: number;
  ty?: number;
}

export type TriggerSpec =
  | { at: number; spawn: SpawnSpec; say?: string }
  | { afterObjective: number; spawn?: SpawnSpec; say?: string };

/** How the computer behaves in a mission. 'normal' is the skirmish commander. */
export type AiMode = 'normal' | 'defend' | 'raid' | 'passive';

export interface MissionSpec {
  id: string;
  /** 1-based position in the campaign. */
  order: number;
  title: string;
  /** Paragraphs read before the mission. */
  briefing: string[];
  /** One line for the campaign map. */
  summary: string;
  seed: string;
  difficulty: Difficulty;
  player: {
    credits: number;
    /** Structures besides nothing at all; include 'hq' for a base mission. */
    structures: BuildingKind[];
    units: UnitKind[];
    /** Heroes the player brings, if the campaign has them unlocked. */
    heroes: HeroKind[];
  };
  enemy: {
    credits: number;
    /** 'full': a Command Yard that builds; 'outpost': these structures only, no Command Yard. */
    base: 'full' | 'outpost';
    structures: BuildingKind[];
    units: UnitKind[];
    ai: AiMode;
  };
  /** What side 0 may build or train. */
  tech: (BuildingKind | UnitKind)[];
  powers: SupportPower[];
  objectives: ObjectiveSpec[];
  /** Optional objectives: each one done earns a star (the mission itself earns the first). */
  bonus: ObjectiveSpec[];
  /** Lose if the primary objectives are not done by this tick. */
  timeLimit?: number;
  triggers: TriggerSpec[];
  rewards: { xp: number; unlockHeroes?: HeroKind[]; unlockTech?: (BuildingKind | UnitKind)[] };
  /** Side 0's convoy for an escort objective: placed at (x, y) and sent along `route` (queued moves). */
  convoy?: { kinds: UnitKind[]; x: number; y: number; route: { x: number; y: number }[] };
  /**
   * Structures grant support powers in this mission as they do in an advanced skirmish
   * (SKIRMISH_POWERS), for both sides; the computer side calls its barrage and missile when charged.
   */
  structurePowers?: boolean;
}

export interface MissionRuntime {
  id: string;
  ai: AiMode;
  objectives: ObjectiveRuntime[];
  bonus: ObjectiveRuntime[];
  timeLimit: number | null;
  /** Indexes into the spec's triggers that have fired. */
  fired: number[];
  result: 'won' | 'lost' | null;
  /** Why it was lost, for the debrief. */
  lostBecause?: string;
  /** The spec's triggers, copied in so the battle can fire them without the mission list. */
  triggers?: TriggerSpec[];
  /** Heroes that fell in this battle, with the experience they had: out for the rest of it. */
  fallen?: Partial<Record<HeroKind, number>>;
  /** Ids of the convoy's units, set when the mission is built. */
  convoy?: number[];
  /** The convoy's way: where it started, then each point of its route. Escort progress is measured along it. */
  convoyRoute?: { x: number; y: number }[];
  /** Copied from the spec. Per side, the powers its structures currently grant (never one the mission gave at the start). */
  structurePowers?: SupportPower[][];
}

/** What the campaign layer is told when a mission ends. */
export interface MissionOutcome {
  missionId: string;
  won: boolean;
  /** 1 for winning, +1 per bonus objective done; 0 when lost. */
  stars: number;
  ticks: number;
  kills: number;
  losses: number;
  /** Experience each hero ended the battle with (level is derived), and whether it survived. */
  heroes: Partial<Record<HeroKind, { xp: number; alive: boolean }>>;
}

/** Commander perks turned into numbers the simulation applies to side 0. */
export interface Perks {
  harvestMul: number;
  buildSpeedMul: number;
  costMul: number;
  unitHpMul: number;
  /** Shorter support power cooldowns. */
  powerCooldownMul: number;
  extraStartCredits: number;
}

/** Everything a mission needs from the campaign to set itself up. */
export interface MissionContext {
  id: string;
  name: string;
  createdAt: number;
  perks: Perks;
  /** Heroes brought into this mission and their carried-over xp. Wounded heroes start at half health. */
  heroes: Partial<Record<HeroKind, { xp: number; wounded: boolean }>>;
  /** Tech the campaign has unlocked so far, added to the mission's own list. */
  extraTech: (BuildingKind | UnitKind)[];
  extraPowers: SupportPower[];
}

export type GameAction =
  | { type: 'tick'; n?: number }
  | { type: 'move'; ids: number[]; x: number; y: number; attackMove?: boolean; queue?: boolean }
  | { type: 'attack'; ids: number[]; target: number; queue?: boolean }
  | { type: 'stance'; ids: number[]; stance: 'aggressive' | 'guard' | 'hold' }
  | { type: 'stop'; ids: number[] }
  | { type: 'harvest'; ids: number[]; tile?: number; refinery?: number }
  | { type: 'queue'; category: Category; kind: BuildingKind | UnitKind }
  | { type: 'cancel'; category: Category; kind: BuildingKind | UnitKind }
  | { type: 'place'; kind: BuildingKind; x: number; y: number }
  | { type: 'sell'; id: number }
  | { type: 'repair'; id: number }
  | { type: 'rally'; id: number; x: number; y: number }
  | { type: 'ability'; id: number; target?: number }
  | { type: 'power'; power: SupportPower; x: number; y: number }
  | { type: 'research'; upgrade: UpgradeId }
  | { type: 'cancelResearch' };
