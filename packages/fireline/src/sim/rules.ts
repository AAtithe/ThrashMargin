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

export type Armor = 'infantry' | 'light' | 'heavy' | 'building' | 'aircraft' | 'ship';
/**
 * 'flame' is the Flame Tank's short-range burst; 'missile' is the Strike Command's one huge strike
 * (a support power, never a unit's weapon). Grenadiers lob 'artillery' (it arcs and scatters).
 */
/**
 * 'rail' (round 5, workstream D: the Railgun Tank) is declared ahead of its first user so the
 * exhaustive tables (DAMAGE_VS, FLIGHT_TICKS, the build tip's weapon names) are complete; nothing
 * fires it until workstream D adds a unit that carries it.
 */
export type WeaponKind = 'bullet' | 'shell' | 'rocket' | 'artillery' | 'flame' | 'missile' | 'flak' | 'aamissile' | 'bomb' | 'rail' | 'torpedo';

/**
 * How hard each weapon hits each armour class. Riflemen shred infantry and scratch a tank. The
 * aircraft column only matters for weapons that can reach the air (hitsAir): bullets at a reduced
 * effect, flak and anti-air missiles in full. The rest never hit an aircraft, whatever it says.
 */
export const DAMAGE_VS: Record<WeaponKind, Record<Armor, number>> = {
  bullet: { infantry: 1, light: 0.6, heavy: 0.22, building: 0.15, aircraft: 0.35, ship: 0.3 },
  shell: { infantry: 0.45, light: 0.9, heavy: 1, building: 0.75, aircraft: 0, ship: 0.9 },
  rocket: { infantry: 0.3, light: 1, heavy: 1.15, building: 0.9, aircraft: 0, ship: 1 },
  artillery: { infantry: 1, light: 0.8, heavy: 0.55, building: 1, aircraft: 0, ship: 0.7 },
  flame: { infantry: 1.25, light: 0.7, heavy: 0.3, building: 1.1, aircraft: 0, ship: 0.4 },
  missile: { infantry: 1, light: 1, heavy: 0.9, building: 1, aircraft: 0, ship: 1 },
  flak: { infantry: 0, light: 0, heavy: 0, building: 0, aircraft: 1, ship: 0 },
  aamissile: { infantry: 0, light: 0, heavy: 0, building: 0, aircraft: 1, ship: 0 },
  bomb: { infantry: 0.9, light: 0.9, heavy: 0.8, building: 1.1, aircraft: 0, ship: 1 },
  // Round 5, workstream D: a hypervelocity slug. Starting numbers; D tunes them and states them.
  rail: { infantry: 0.35, light: 1, heavy: 1.25, building: 0.8, aircraft: 0, ship: 1.1 },
  // The naval war: the Submarine's torpedo reaches ships and nothing else (hitsNaval, hitsGround).
  torpedo: { infantry: 0, light: 0, heavy: 0, building: 0, aircraft: 0, ship: 1 },
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
  rail: 0,
  torpedo: 10,
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
  /** Can fire at ships. Read it through hitsNaval(): absent means whatever hitsGround says. */
  canHitNaval?: boolean;
}

/** True when this weapon can fire at an aircraft. Every ground weapon but bullets cannot. */
export const hitsAir = (w: Weapon): boolean => w.canHitAir ?? w.kind === 'bullet';
/** True when this weapon can fire at something on the ground (units and structures). */
export const hitsGround = (w: Weapon): boolean => w.canHitGround ?? true;
/** True when this weapon can fire at a ship: anything that hits the ground does, and the torpedo. */
export const hitsNaval = (w: Weapon): boolean => w.canHitNaval ?? hitsGround(w);

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
  // Air war (2026-11-10): the recon plane and the interceptor.
  | 'reconplane'
  | 'interceptor'
  | 'carrier'
  | 'heavybomber'
  // The naval war (2026-11-11): its ships.
  | 'gunboat'
  | 'destroyer'
  | 'submarine'
  | 'battleship'
  | 'landingcraft'
  // round5:C begin. Engineering vehicles (fireline-round5-design.md, workstream C): its unit kinds.
  | 'repairtruck'
  | 'basetruck'
  // round5:C end.
  // round5:D begin. Tier three (fireline-round5-design.md, workstream D): its unit kinds.
  | 'railtank'
  | 'stealthtank'
  // round5:D end.
  // round6:A begin. Two armies (fireline-round6-design.md, workstream A): its unit kinds (signature units, aircraft variants).
  | 'sapper'
  | 'raider'
  | 'kestrel'
  | 'firebrand'
  // round6:A end.
  // round6:C begin. Generals (fireline-round6-design.md, workstream C): its unit kinds (the field General).
  | 'general'
  // round6:C end.
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
  | 'researchlab'
  // The naval war (2026-11-11): the Naval Yard.
  | 'shipyard'
  // round5:C begin. Engineering vehicles (fireline-round5-design.md, workstream C): its structure kinds.
  | 'fieldyard'
  // round5:C end.
  // round5:D begin. Tier three (fireline-round5-design.md, workstream D): its structure kinds.
  | 'protoworks'
  | 'fortress'
  // round5:D end.
  // round6:A begin. Two armies (fireline-round6-design.md, workstream A): its structure kinds, if any.
  // round6:A end.
  // round6:B begin. Heroes in free play (fireline-round6-design.md, workstream B): its structure kinds (the Command Academy).
  | 'academy'
  // round6:B end.
  // round6:C begin. Generals (fireline-round6-design.md, workstream C): its structure kinds, if any.
  // round6:C end.
  ;
export type Category = 'building' | 'infantry' | 'vehicle' | 'air' | 'naval';

/** Round 6 groundwork: how an aircraft fights (UnitSpec.airRole). */
export type AirRole = 'strafe' | 'bomb' | 'scout' | 'intercept' | 'transport';

export interface UnitSpec {
  name: string;
  category: 'infantry' | 'vehicle' | 'air' | 'naval';
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
  /** Round 5, workstream C: mends its own side's vehicles nearby (the Repair Truck). Absent on the rest. */
  mender?: true;
  /** Round 5, workstream C: deploys into this structure where it stands (the Forward Base truck). */
  deploysTo?: BuildingKind;
  /**
   * Round 5, workstream D: unseen and untargetable by enemies except close up or just after it
   * fires (the Stealth Tank). Absent on the rest; the Spy keeps its own rule in mission.ts.
   */
  stealth?: true;
  /**
   * Round 6 groundwork: how an aircraft fights. 'strafe' (the Gunship) hovers and rockets what it
   * finds; 'bomb' (the Bomber) flies over its mark dropping a line of bombs. The air war (merged after
   * round 6) adds 'scout' (the Recon Plane: unarmed, fuelled, circles), 'intercept' (the Interceptor:
   * air-to-air, scrambles from its pad) and 'transport' (the Troop Carrier). air.ts and aiAir.ts
   * branch on this, never on a kind's name, so a faction's variant aircraft needs no new branch.
   * Absent off aircraft.
   */
  airRole?: AirRole;
  /**
   * Air war: sees Stealth Tanks and Spies within DETECTOR_RANGE (the Recon Plane), where any other
   * unit sees them only close up. Absent on the rest.
   */
  detector?: true;
  /** Air war: infantry it can carry (the Troop Carrier). Absent on the rest. */
  carries?: number;
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
  /**
   * Round 5, workstream C: structures may be placed within this many tiles of it, instead of
   * BUILD_RADIUS (the Field Yard). Absent: BUILD_RADIUS.
   */
  buildRadius?: number;
  /** Round 5, workstream C: packs up into this unit where it stands (the Field Yard). */
  undeploysTo?: UnitKind;
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
    hp: 240,
    armor: 'infantry',
    speed: 0.07,
    sight: 7,
    weapon: { kind: 'bullet', damage: 30, range: 5, cooldown: 7 },
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
    airRole: 'strafe',
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
    airRole: 'bomb',
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
  // ---- Air war (2026-11-10): advanced tech only --------------------------------------------
  reconplane: {
    name: 'Recon Plane',
    category: 'air',
    cost: 700,
    buildTicks: 90,
    hp: 170,
    armor: 'aircraft',
    speed: 0.24,
    sight: 11,
    requires: ['helipad'],
    airRole: 'scout',
    blurb: 'Unarmed scout. Sees far, uncovers Stealth Tanks and Spies, circles where it is sent until its fuel runs low.',
    detector: true,
  },
  interceptor: {
    name: 'Interceptor',
    category: 'air',
    cost: 1200,
    buildTicks: 130,
    hp: 240,
    armor: 'aircraft',
    speed: 0.27,
    sight: 8,
    weapon: { kind: 'aamissile', damage: 55, range: 5, cooldown: 10, canHitAir: true, canHitGround: false },
    requires: ['helipad', 'researchlab'],
    airRole: 'intercept',
    blurb: 'Air-to-air fighter. Scrambles from its Helipad at enemy aircraft nearby; cannot fire at the ground.',
  },
  carrier: {
    name: 'Troop Carrier',
    category: 'air',
    cost: 1000,
    buildTicks: 120,
    hp: 380,
    armor: 'aircraft',
    speed: 0.17,
    sight: 7,
    requires: ['helipad', 'barracks'],
    airRole: 'transport',
    blurb: 'Unarmed transport for six infantry. Right-click it with infantry to board; Unload sets them down wherever it hovers.',
    carries: 6,
  },
  heavybomber: {
    name: 'Heavy Bomber',
    category: 'air',
    cost: 3000,
    buildTicks: 280,
    hp: 640,
    armor: 'aircraft',
    speed: 0.15,
    sight: 6,
    weapon: { kind: 'bomb', damage: 160, range: 3.5, cooldown: 4, splash: 1.8, canHitAir: false },
    requires: ['helipad', 'techcentre', 'researchlab'],
    airRole: 'bomb',
    blurb: 'Slow and armoured. Ten heavy bombs in one long run. Takes a whole Helipad to itself.',
  },
  // ---- The naval war (2026-11-11): advanced tech only; ships sail open water ------------------
  gunboat: {
    name: 'Patrol Boat',
    category: 'naval',
    cost: 600,
    buildTicks: 80,
    hp: 300,
    armor: 'ship',
    speed: 0.16,
    sight: 8,
    weapon: { kind: 'bullet', damage: 16, range: 5, cooldown: 7 },
    requires: ['shipyard'],
    blurb: 'Fast and cheap. Machine guns that reach aircraft too. Good against boats and infantry on the shore.',
  },
  destroyer: {
    name: 'Destroyer',
    category: 'naval',
    cost: 1400,
    buildTicks: 150,
    hp: 720,
    armor: 'ship',
    speed: 0.11,
    sight: 9,
    weapon: { kind: 'shell', damage: 55, range: 6.5, cooldown: 24 },
    requires: ['shipyard'],
    blurb: 'The line of battle. A deck gun for ships and the shore, and sonar that finds Submarines seven tiles off.',
    detector: true,
  },
  submarine: {
    name: 'Submarine',
    category: 'naval',
    cost: 1200,
    buildTicks: 140,
    hp: 360,
    armor: 'ship',
    speed: 0.09,
    sight: 6,
    weapon: { kind: 'torpedo', damage: 130, range: 5.5, cooldown: 45, canHitGround: false, canHitNaval: true },
    requires: ['shipyard', 'researchlab'],
    blurb: 'Unseen except close up, by a Destroyer or Recon Plane, or just after it fires. Torpedoes hit ships only.',
    stealth: true,
  },
  battleship: {
    name: 'Battleship',
    category: 'naval',
    cost: 3200,
    buildTicks: 300,
    hp: 1500,
    armor: 'ship',
    speed: 0.065,
    sight: 8,
    weapon: { kind: 'artillery', damage: 120, range: 11, minRange: 3, cooldown: 70, splash: 1.3 },
    requires: ['shipyard', 'techcentre'],
    blurb: 'Slow and enormous. Big guns that shell the shore from eleven tiles out; nothing close.',
  },
  landingcraft: {
    name: 'Landing Craft',
    category: 'naval',
    cost: 900,
    buildTicks: 110,
    hp: 480,
    armor: 'ship',
    speed: 0.12,
    sight: 6,
    requires: ['shipyard'],
    blurb: 'Carries six infantry or three vehicles. Right-click it from the shore to board; Unload sets them on the nearest beach.',
    carries: 6,
  },
  // round5:C begin. Engineering vehicles: its units, appended here.
  repairtruck: {
    name: 'Repair Truck',
    category: 'vehicle',
    cost: 900,
    buildTicks: 110,
    hp: 300,
    armor: 'light',
    speed: 0.085,
    sight: 6,
    requires: ['factory', 'repairbay'],
    blurb:
      'Unarmed. Mends your vehicles beside it, free, and drives to damaged ones nearby when idle. Free play\'s engineering units are this and the Forward Base Truck; the Engineer is a hero, recruited only with heroes on.',
    mender: true,
  },
  basetruck: {
    name: 'Forward Base Truck',
    category: 'vehicle',
    cost: 2500,
    buildTicks: 250,
    hp: 900,
    armor: 'heavy',
    speed: 0.055,
    sight: 5,
    requires: ['factory', 'uplink'],
    blurb:
      'Unarmed. Deploys where it stands into a Field Yard: a second base that builds structures. Three at most. Free play\'s engineering units are this and the Repair Truck; the Engineer is a hero, recruited only with heroes on.',
    deploysTo: 'fieldyard',
  },
  // round5:C end.
  // round5:D begin. Tier three: its units, appended here.
  // ---- Tier three (round 5, workstream D): advanced tech only, from the Prototype Works ----------
  railtank: {
    name: 'Railgun Tank',
    category: 'vehicle',
    cost: 1800,
    buildTicks: 200,
    hp: 650,
    armor: 'heavy',
    speed: 0.085,
    sight: 6,
    weapon: { kind: 'rail', damage: 150, range: 6.5, cooldown: 45 },
    requires: ['factory', 'protoworks'],
    blurb: 'A magnetic slug that lands the instant it fires. Breaks heavy armour; poor against infantry.',
  },
  stealthtank: {
    name: 'Stealth Tank',
    category: 'vehicle',
    cost: 1400,
    buildTicks: 160,
    hp: 380,
    armor: 'light',
    speed: 0.11,
    sight: 6,
    weapon: { kind: 'rocket', damage: 45, range: 5, cooldown: 30 },
    requires: ['factory', 'protoworks'],
    blurb: 'Unseen and untargetable unless the enemy is within two and a half tiles, or for three seconds after it fires.',
    stealth: true,
  },
  // round5:D end.
  // round6:A begin. Two armies (fireline-round6-design.md, workstream A): its units (signature units, aircraft variants), appended here.
  // ---- Two armies (round 6, workstream A): advanced tech only, each fielded by one army alone ----
  sapper: {
    name: 'Sapper',
    category: 'infantry',
    cost: 400,
    buildTicks: 90,
    hp: 90,
    armor: 'infantry',
    speed: 0.055,
    sight: 5,
    weapon: { kind: 'shell', damage: 80, range: 1.75, cooldown: 40, splash: 0.5 },
    requires: ['barracks', 'techcentre'],
    blurb: 'Meridian combat engineer with satchel charges. Must get close; wrecks structures and armour, falls fast to rifles.',
  },
  raider: {
    name: 'Raider Bike',
    category: 'vehicle',
    cost: 450,
    buildTicks: 60,
    hp: 140,
    armor: 'light',
    speed: 0.2,
    sight: 7,
    weapon: { kind: 'rocket', damage: 28, range: 4, cooldown: 22 },
    requires: ['factory'],
    blurb: 'Ashen rocket bike, fast and fragile. Hits haulers and armour, then gets away.',
  },
  kestrel: {
    name: 'Kestrel',
    category: 'air',
    cost: 1200,
    buildTicks: 130,
    hp: 260,
    armor: 'aircraft',
    speed: 0.16,
    sight: 7,
    weapon: { kind: 'rocket', damage: 32, range: 4.25, cooldown: 15, canHitAir: false },
    requires: ['helipad'],
    airRole: 'strafe',
    blurb: "Ashen light gunship. Faster and frailer than a Gunship, with more rockets and a quicker rearm.",
  },
  firebrand: {
    name: 'Firebrand',
    category: 'air',
    cost: 1800,
    buildTicks: 180,
    hp: 250,
    armor: 'aircraft',
    speed: 0.24,
    sight: 6,
    weapon: { kind: 'flame', damage: 75, range: 3.5, cooldown: 4, splash: 0.9, canHitAir: false },
    requires: ['helipad', 'techcentre'],
    airRole: 'bomb',
    blurb: 'Ashen bomber. Drops incendiaries in a line: a smaller blast than a Bomber\'s, but the ground keeps burning.',
  },
  // round6:A end.
  // round6:B begin. Heroes in free play: the heroes above keep their campaign specs; anything B adds goes here.
  // round6:B end.
  // round6:C begin. Generals (fireline-round6-design.md, workstream C): the field General, appended here.
  general: {
    name: 'General',
    category: 'infantry',
    cost: 1200,
    buildTicks: 180,
    hp: 320,
    armor: 'infantry',
    speed: 0.06,
    sight: 7,
    weapon: { kind: 'bullet', damage: 12, range: 4, cooldown: 12 },
    requires: ['barracks', 'uplink'],
    blurb: 'Your field commander, one at a time (Generals on). Your units within six tiles hit 10% harder and fire 10% faster. If the General falls, the doctrine weakens until a replacement arrives.',
  },
  // round6:C end.
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
  // round5:C begin. Engineering vehicles: its structures, appended here.
  fieldyard: {
    name: 'Field Yard',
    w: 2,
    h: 2,
    cost: 2500,
    buildTicks: 250,
    hp: 1000,
    power: 0,
    sight: 5,
    requires: [],
    blurb: 'A deployed Forward Base Truck. Builds structures within six tiles of itself; packs up to move on.',
    buildRadius: 6,
    undeploysTo: 'basetruck',
  },
  // round5:C end.
  // ---- The naval war (2026-11-11): advanced tech only ----------------------------------------
  shipyard: {
    name: 'Naval Yard',
    w: 3,
    h: 3,
    cost: 1500,
    buildTicks: 150,
    hp: 1000,
    power: -40,
    sight: 6,
    requires: ['factory'],
    blurb: 'Builds ships, and must be built on the shore of open sea. Mends ships beside it.',
  },
  // round5:D begin. Tier three: its structures, appended here (neutral sites are not structures).
  protoworks: {
    name: 'Prototype Works',
    w: 3,
    h: 3,
    cost: 2500,
    buildTicks: 240,
    hp: 1200,
    power: -100,
    sight: 4,
    requires: ['researchlab', 'techcentre'],
    blurb: 'Tier three. Unlocks the Railgun Tank, the Stealth Tank and the Fortress. Draws heavy power.',
  },
  fortress: {
    name: 'Fortress',
    w: 2,
    h: 2,
    cost: 2400,
    buildTicks: 220,
    hp: 2200,
    power: -70,
    sight: 8,
    weapon: { kind: 'shell', damage: 75, range: 7, cooldown: 24, splash: 0.8 },
    requires: ['protoworks'],
    blurb: 'A heavy gun emplacement: long range, splash and a great deal of armour. Slows when power is short.',
  },
  // round5:D end.
  // round6:A begin. Two armies: its structures, if any, appended here.
  // round6:A end.
  // round6:B begin. Heroes in free play: its structures (the Command Academy), appended here.
  academy: {
    name: 'Command Academy',
    w: 2,
    h: 2,
    cost: 1500,
    buildTicks: 160,
    hp: 900,
    power: -40,
    sight: 5,
    requires: ['techcentre'],
    blurb:
      'Heroes on only. Once it stands, the Spy, Commando and Engineer join the Infantry list and the Ace the Vehicles list: one of each at a time, and a fallen hero can be recruited again after 90 seconds at half price.',
  },
  // round6:B end.
  // round6:C begin. Generals: its structures, if any, appended here.
  // round6:C end.
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
  // round5:D begin. Tier three: its structures, appended here (data only; the build window reads them).
  'protoworks',
  'fortress',
  // round5:D end.
  // The naval war (2026-11-11): after tier three, which keeps its places in the list. Ahead of round 6's
  // Academy (merge), so turning Heroes on moves no item already listed.
  'shipyard',
  // round6:B begin. Heroes in free play: its structures, appended here.
  'academy',
  // round6:B end.
  // round6:C begin. Generals: its structures, if any, appended here.
  // round6:C end.
];
export const INFANTRY_MENU: UnitKind[] = [
  'rifleman',
  'rocketeer',
  'grenadier',
  'medic',
  'skyhunter',
  // round6:B begin. Heroes in free play: the heroes, if B lists them here (techAllowed keeps them out unless setup.heroes).
  'spy',
  'commando',
  'engineer',
  // round6:B end.
  // round6:C begin. Generals: the field General, if C lists it here.
  'general',
  // round6:C end.
];
export const VEHICLE_MENU: UnitKind[] = [
  'hauler',
  'buggy',
  'tank',
  'artillery',
  'missilecarrier',
  'flametank',
  'bastion',
  'flaktrack',
  // round5:C begin. Engineering vehicles: its units, appended here.
  'repairtruck',
  'basetruck',
  // round5:C end.
  // round5:D begin. Tier three: its units, appended here.
  'railtank',
  'stealthtank',
  // round5:D end.
  // round6:B begin. Heroes in free play: the Ace, if B lists it here.
  'ace',
  // round6:B end.
];
/** Aircraft in the order the Air tab offers them. */
export const AIR_MENU: UnitKind[] = ['reconplane', 'gunship', 'interceptor', 'carrier', 'bomber', 'heavybomber'];
/** Ships in the order the Naval tab offers them. */
export const NAVAL_MENU: UnitKind[] = ['gunboat', 'destroyer', 'landingcraft', 'submarine', 'battleship'];

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

/**
 * Every build list by queue, in menu (and hotkey) order: the one table the build window, How to
 * play and the harness read. A new item joins a list above (BUILD_MENU, INFANTRY_MENU,
 * VEHICLE_MENU, AIR_MENU) and nowhere else; the build window lays out any item from its spec's
 * `requires`, including ones it has never seen (fireline-round5-design.md).
 */
export const MENUS: Record<Category, readonly (BuildingKind | UnitKind)[]> = {
  building: BUILD_MENU,
  infantry: INFANTRY_MENU,
  vehicle: VEHICLE_MENU,
  air: AIR_MENU,
  naval: NAVAL_MENU,
};

/** Which structure each queue needs before it will make progress. */
export const PRODUCER: Record<Category, BuildingKind> = {
  building: 'hq',
  infantry: 'barracks',
  vehicle: 'factory',
  air: 'helipad',
  naval: 'shipyard',
};

/**
 * Structures that also work a queue besides its PRODUCER. Empty before round 5; workstream C adds
 * the Field Yard (Structures) between its markers. Read through producerFor and hasProducer.
 */
export const ALSO_PRODUCES: Partial<Record<BuildingKind, Category>> = {
  // round5:C begin. The Field Yard works the Structures queue.
  fieldyard: 'building',
  // round5:C end.
  // round6:B begin. Heroes in free play: the Command Academy's queue, if it works one.
  // round6:B end.
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

export type MapType = 'classic' | 'river' | 'highlands' | 'lakes' | 'plains' | 'canyon' | 'coast';
export const MAP_TYPES: MapType[] = ['classic', 'river', 'highlands', 'lakes', 'plains', 'canyon', 'coast'];
export const MAP_TYPE_NAMES: Record<MapType, string> = {
  classic: 'Classic',
  river: 'River',
  highlands: 'Highlands',
  lakes: 'Lakes',
  plains: 'Plains',
  canyon: 'Canyon',
  coast: 'Coast',
};
export const MAP_TYPE_BLURBS: Record<MapType, string> = {
  classic: 'Mixed ground: woods, ridges and ponds, with tracks between the bases.',
  river: 'A river across the middle, crossed at three fords, with an island of ore midstream.',
  highlands: 'Rock ridges cut the field; armies meet in narrow passes.',
  lakes: 'Lakes all over, with land corridors between them.',
  plains: 'Open country and plenty of ore. Few places to hide.',
  canyon: 'Cliffs split the middle into two or three long corridors.',
  coast: 'A sea between the bases: armies go round it by land, navies fight across it.',
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
  /** 'classic': the five flat upgrades. 'lines': development lines, doctrines and loadouts. Advanced tech only. */
  research: ResearchMode;
  /**
   * The game's pace (round 6, fireline-round6b-design.md; called "game size" on the cards): the
   * commander's attack timing, and in development lines research cost and time and how the
   * commander researches. 'quick' is the game before round 6 exactly, and a setup saved without a
   * pace reads as 'quick'. Independent of `size`, which is the map's size.
   */
  pace: GamePace;
  /**
   * Round 5, workstream B: how big the map is for the number of sides (MAP_SIZE_TILES). Absent on
   * setups saved before round 5, which normaliseSetup reads as 'standard': the size they always had.
   */
  size?: MapSize;
  /**
   * Round 5, workstream D: neutral sites (Oil Derricks, Field Hospitals, Comms Relays) on the map.
   * Absent on setups saved before round 5, which normaliseSetup reads as false.
   */
  sites?: boolean;
  /**
   * Round 6, workstream A: each seat's army, one per side (index = Owner). Absent on setups saved
   * before round 6, which normaliseSetup reads as every seat 'meridian': the army every side always had.
   */
  factions?: Faction[];
  /**
   * Round 6, workstream B: the campaign's heroes may be recruited in this skirmish (advanced tech
   * only). Absent on older setups, which normaliseSetup reads as false.
   */
  heroes?: boolean;
  /**
   * Round 6, workstream C: each side fields a General unit with a command aura. Absent on older
   * setups, which normaliseSetup reads as false.
   */
  generals?: boolean;
  /**
   * Round 6, workstream C: each seat's doctrine General (a perks bundle), one per side, or null for
   * none. A pick that does not belong to its seat's army (GENERAL_FACTION) reads as null. Absent on
   * older setups, which normaliseSetup reads as every seat null.
   */
  generalPicks?: (GeneralId | null)[];
}

/** How the sides of a battle of three or four are grouped. */
export type SideMode = 'ffa' | 'teams';

/** What the lobby offers a new skirmish by default. */
export const DEFAULT_SETUP: SkirmishSetup = {
  map: 'random',
  tech: 'advanced',
  credits: 3000,
  ore: 'normal',
  sides: 2,
  mode: 'ffa',
  size: 'standard',
  sites: false,
  research: 'lines',
  pace: 'quick',
  factions: ['meridian', 'meridian'],
  heroes: false,
  generals: false,
  generalPicks: [null, null],
};
/**
 * A battle with no setup recorded: saves from before setups, and createInitialState called without
 * one. The original game exactly: the original map generator, standard tech, no skirmish powers.
 */
export const LEGACY_SETUP: SkirmishSetup = {
  map: 'classic',
  tech: 'standard',
  credits: 3000,
  ore: 'normal',
  sides: 2,
  mode: 'ffa',
  size: 'standard',
  sites: false,
  research: 'classic',
  pace: 'quick',
  factions: ['meridian', 'meridian'],
  heroes: false,
  generals: false,
  generalPicks: [null, null],
};
/** A skirmish map's width and height in tiles, by the number of sides: square, larger for more. */
export const MAP_SIZE_FOR: Record<2 | 3 | 4, number> = { 2: 64, 3: 80, 4: 96 };

// round5:B begin. Larger maps (fireline-round5-design.md, workstream B): the numbers below are the
// contract's starting points; B measures, may lower them (never raise past MAP_TILES_MAX without a
// stated measurement), and adds its constants inside this block.
export type MapSize = 'standard' | 'large' | 'huge';
/** The sizes the lobby offers, smallest first. */
export const MAP_SIZES: MapSize[] = ['standard', 'large', 'huge'];
export const MAP_SIZE_NAMES: Record<MapSize, string> = { standard: 'Standard', large: 'Large', huge: 'Huge' };
/** A skirmish map's width and height in tiles, by size and number of sides. 'standard' is MAP_SIZE_FOR exactly. */
export const MAP_SIZE_TILES: Record<MapSize, Record<2 | 3 | 4, number>> = {
  standard: MAP_SIZE_FOR,
  large: { 2: 96, 3: 112, 4: 128 },
  huge: { 2: 128, 3: 144, 4: 160 },
};
/** No map is wider or taller than this (pathfinding, fog and the terrain prerender are sized for it). */
export const MAP_TILES_MAX = 160;
/** A setup's map width and height in tiles. Setups from before round 5 have no size: 'standard'. */
export const mapTilesFor = (setup: Pick<SkirmishSetup, 'sides' | 'size'>): number => MAP_SIZE_TILES[setup.size ?? 'standard'][setup.sides];
/** What the lobby says about each size: roughly how long a battle against the computer runs (measured, round 5 build log). */
export const MAP_SIZE_BLURBS: Record<MapSize, string> = {
  standard: 'The original size. Battles run about 20 minutes.',
  large: 'Half as wide again, with more ore and room to expand. Battles run about 30 to 40 minutes.',
  huge: 'Twice as wide, with ore all over. Battles run 45 minutes or more.',
};
/**
 * Ore that spreads back (large and huge maps only): every ORE_SPREAD_TICKS, a tile of an ore field
 * that has been worked out, beside a tile that still holds ore and with nothing standing on it,
 * regains ORE_SPREAD_AMOUNT. A field never vanishes while one tile of it is left. Standard maps:
 * none, exactly as before.
 */
export const ORE_SPREAD_TICKS = 300;
export const ORE_SPREAD_AMOUNT = 60;
/**
 * Path searches allowed per tick. Standard maps: 24, as always. On larger maps a walk is longer and
 * each search costs more, so fewer are allowed per tick, but each may expand further
 * (pathExpandLimitFor) so a long walk still finds its way rather than stopping short and searching
 * again.
 */
export const pathBudgetFor = (size: MapSize): number => (size === 'standard' ? 24 : 16);
/** How many tiles one path search may expand: 6000 on standard maps, as always; on larger maps 60% of the map. */
export const pathExpandLimitFor = (size: MapSize, tiles: number): number => (size === 'standard' ? 6000 : Math.max(6000, Math.round(tiles * 0.6)));
/** Ticks between fog updates (the explored map): 5 on standard maps, as always; 10 on larger maps. */
export const exploreTicksFor = (size: MapSize): number => (size === 'standard' ? 5 : 10);
// round5:B end.
/** What each map type looks like with three or four sides, where the two-sided blurb does not fit. */
export const MAP_TYPE_BLURBS_SIDES: Record<MapType, string> = {
  classic: 'Mixed ground: woods, ridges and ponds, with tracks to every neighbour and the centre.',
  river: 'Rivers between neighbours, each crossed at two fords, meeting at an island of ore in the centre.',
  highlands: 'Ridges between neighbours and a ring of them round the centre; armies meet in narrow passes.',
  lakes: 'Lakes all over, with land corridors and causeways between them.',
  plains: 'Open country and plenty of ore. Few places to hide.',
  canyon: 'A ring of cliffs round the centre, cut by wide corridors from every base.',
  coast: 'An inland sea round a central island, crossed by causeways; every shore faces its neighbours.',
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

/** How many aircraft one Helipad serves: it builds for them and rearms them. */
export const HELIPAD_SLOTS = 2;
/** A Helipad mends the aircraft landed on it, this much every this many ticks, free (as a Naval Yard its ships). */
export const HELIPAD_MEND_HP = 8;
export const HELIPAD_MEND_TICKS = 10;

/** True for an aircraft: any unit whose category is 'air'. */
export const isAirKind = (kind: UnitKind): boolean => UNITS[kind].category === 'air';

/**
 * Loads an aircraft carries. A Gunship fires one rocket per load; a Bomber drops one bomb per load,
 * all of them in one run. With none left it flies back to its Helipad to rearm.
 */
export const AIR_AMMO: Partial<Record<UnitKind, number>> = { gunship: 8, bomber: 6, interceptor: 6, reconplane: 12, heavybomber: 10,
  kestrel: 10,
  firebrand: 6,
};
/** Ticks on its Helipad to put back one load (Air frames shortens it). */
export const REARM_TICKS: Partial<Record<UnitKind, number>> = { gunship: 12, bomber: 25, interceptor: 14, reconplane: 10, heavybomber: 30,
  kestrel: 9,
  firebrand: 22,
};
/** Ticks between bombs in a run: with the Bomber's speed, a bomb about every 0.9 tiles. */
export const BOMB_GAP = 4;
/** Aircraft keep at least this far from the map's edge. */
export const AIR_EDGE = 0.5;

// ---- Air war (2026-11-10) ------------------------------------------------------------------------
//
// The Recon Plane carries fuel, not ammunition: its AIR_AMMO loads are fuel, one burnt every
// FUEL_TICKS while it is off its pad (12 loads, about a minute aloft), and it heads home with
// FUEL_RESERVE left. Sent somewhere it circles there (an orbit of about two tiles) until then.
// The Interceptor scrambles: parked full on its pad, not on hold, it goes for any enemy aircraft
// within SCRAMBLE_RANGE of the pad, chases no further than SCRAMBLE_LEASH from it, and comes home.

/** Ticks of flight a load of the Recon Plane's fuel lasts. */
export const FUEL_TICKS = 50;
/** Fuel loads at which a Recon Plane turns for home. */
export const FUEL_RESERVE = 2;
/** Tiles within which a detector (the Recon Plane) sees Stealth Tanks and Spies. */
export const DETECTOR_RANGE = 7;
/** A Recon Plane circling: its heading turns by this angle each tick (cos and sin as constants, so replays never depend on Math.cos). */
export const ORBIT_COS = 0.9928086358538663; // cos(0.12)
export const ORBIT_SIN = 0.11971220728891936; // sin(0.12)
/** Tiles from its Helipad within which a parked Interceptor scrambles at an enemy aircraft. */
export const SCRAMBLE_RANGE = 14;
/** Tiles from its Helipad beyond which a scrambled Interceptor breaks off and goes home. */
export const SCRAMBLE_LEASH = 20;
// ---- The naval war (2026-11-11) -----------------------------------------------------------------
//
// Ships, the Naval Yard and the Coast map. The simulation is in naval.ts (ships, the yard) and
// transport.ts (the Landing Craft); the computer's side in aiNaval.ts.

/** Tiles of open water a Naval Yard's shore must belong to: a pond will not do. */
export const NAVAL_MIN_SEA = 60;
/** A Naval Yard mends its side's ships within this many tiles of it, this much every this many ticks. */
export const SHIPYARD_MEND_RANGE = 2;
export const SHIPYARD_MEND_HP = 8;
export const SHIPYARD_MEND_TICKS = 10;
/** Places aboard a Landing Craft a unit takes: an infantryman one, a vehicle two. */
export const RIDE_SLOTS: Record<'infantry' | 'vehicle', number> = { infantry: 1, vehicle: 2 };

/** Countermeasures (research): what anti-air weapons do to this side's aircraft. */
export const COUNTERMEASURES_DAMAGE = 0.75;
/** Helipad places an aircraft takes (HELIPAD_SLOTS each): one, but the Heavy Bomber takes a whole pad. */
export const AIR_SLOTS: Partial<Record<UnitKind, number>> = { heavybomber: 2 };
export const airSlotsOf = (kind: UnitKind): number => AIR_SLOTS[kind] ?? 1;
/** Tiles from a Troop Carrier within which infantry ordered aboard climb in. */
export const BOARD_RANGE = 2.3;
/** Tiles round a Troop Carrier within which it sets its infantry down; nowhere to stand within it, it cannot unload. */
export const UNLOAD_RADIUS = 3;

export type UpgradeId =
  // Classic, and Mk I of each line (unchanged):
  | 'plating' | 'calibration' | 'engines' | 'refining' | 'airframes'
  // Classic only (the air war, 2026-11-10); a lines battle's counterpart is Armoured cockpits:
  | 'countermeasures'
  // Mk II:
  | 'plating2' | 'engines2' | 'refining2' | 'autoloaders' | 'avionics'
  // Mk III fork branches:
  | 'reactive' | 'composite' // armour
  | 'fieldrepair' | 'motorised' // engines
  | 'assembly' | 'salvage' // logistics
  | 'heat' | 'highexplosive' // weapons
  | 'hardened' | 'munitions'; // air

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
  countermeasures: {
    name: 'Countermeasures',
    blurb: 'Flares and chaff: flak and anti-air missiles do a quarter less to your aircraft.',
    cost: 1500,
    ticks: 600,
    requires: ['researchlab', 'helipad'],
  },
  // Development lines only (round 5): Mk II and the Mk III doctrine branches.
  refining2: { name: 'Ore processing', blurb: 'Every load of ore pays 25% more, instead of 15%.', cost: 2400, ticks: 800, requires: ['researchlab', 'techcentre'] },
  assembly: { name: 'Assembly lines', blurb: 'Infantry, vehicles, aircraft and ships are built 15% faster.', cost: 2500, ticks: 900, requires: ['researchlab', 'techcentre'] },
  salvage: { name: 'Salvage crews', blurb: 'Every enemy vehicle or aircraft you destroy pays a tenth of its cost.', cost: 2500, ticks: 900, requires: ['researchlab', 'techcentre'] },
  plating2: { name: 'Heavy plating', blurb: 'Vehicles have over a third more health than standard, instead of a fifth.', cost: 2000, ticks: 750, requires: ['researchlab', 'techcentre'] },
  reactive: { name: 'Reactive armour', blurb: 'Vehicles take a fifth less damage from rockets, bombs and missiles.', cost: 2500, ticks: 900, requires: ['researchlab', 'techcentre'] },
  composite: { name: 'Composite armour', blurb: 'Vehicles take a fifth less damage from tank shells and artillery.', cost: 2500, ticks: 900, requires: ['researchlab', 'techcentre'] },
  engines2: { name: 'Turbochargers', blurb: 'Vehicles move 25% faster, instead of 15%.', cost: 1800, ticks: 700, requires: ['researchlab', 'techcentre'] },
  fieldrepair: { name: 'Field workshops', blurb: 'Every vehicle patches itself up out of combat, as elite units do.', cost: 2200, ticks: 800, requires: ['researchlab', 'techcentre'] },
  motorised: { name: 'Motorised infantry', blurb: 'Infantry move 15% faster.', cost: 2200, ticks: 800, requires: ['researchlab', 'techcentre'] },
  autoloaders: { name: 'Autoloaders', blurb: 'Vehicle weapons reload 10% faster.', cost: 2400, ticks: 800, requires: ['researchlab', 'techcentre'] },
  heat: { name: 'HEAT rounds', blurb: 'Your shells and rockets hit 10% harder, on top of calibration.', cost: 2800, ticks: 1000, requires: ['researchlab', 'techcentre'] },
  highexplosive: { name: 'High-explosive fill', blurb: 'Every weapon with a blast hits a quarter wider.', cost: 2800, ticks: 1000, requires: ['researchlab', 'techcentre'] },
  avionics: { name: 'Avionics', blurb: 'Aircraft fly 15% faster.', cost: 2000, ticks: 750, requires: ['researchlab', 'helipad', 'techcentre'] },
  hardened: { name: 'Armoured cockpits', blurb: 'Aircraft take a quarter less damage from flak, anti-air missiles and machine guns.', cost: 2500, ticks: 900, requires: ['researchlab', 'helipad', 'techcentre'] },
  munitions: { name: 'Heavy munitions', blurb: 'Gunship rockets, Interceptor missiles and every bomb hit 15% harder.', cost: 2500, ticks: 900, requires: ['researchlab', 'helipad', 'techcentre'] },
};

/** The six upgrades a 'classic' battle offers, in the order the Research block lists them (Countermeasures since the air war). */
export const UPGRADE_ORDER: UpgradeId[] = ['refining', 'plating', 'engines', 'calibration', 'airframes', 'countermeasures'];
/** True for an id a 'classic' battle offers. */
export const isClassicUpgrade = (id: UpgradeId): boolean => UPGRADE_ORDER.includes(id);

/** What each upgrade does to the number it changes. */
export const PLATING_HP = 1.2;
export const CALIBRATION_DAMAGE = 1.15;
export const ENGINES_SPEED = 1.15;
export const REFINING_INCOME = 1.15;
export const AIRFRAMES_HP = 1.25;
export const AIRFRAMES_REARM = 0.6;

// ---- Development lines and loadouts (round 5b; fireline-round5b-design.md) ----

export type ResearchMode = 'classic' | 'lines';
export const RESEARCH_MODES: ResearchMode[] = ['classic', 'lines'];

export type LineId = 'logistics' | 'armour' | 'engines' | 'weapons' | 'air';
/** Lines in the order the Research tree lists them (rows, top to bottom). */
export const LINE_ORDER: LineId[] = ['logistics', 'armour', 'engines', 'weapons', 'air'];

export interface LineSpec {
  name: string;
  /** Mk I, Mk II, then the two Mk III branches [left, right] as drawn. */
  marks: [UpgradeId, UpgradeId];
  fork: [UpgradeId, UpgradeId];
}

export const LINES: Record<LineId, LineSpec> = {
  logistics: { name: 'Logistics', marks: ['refining', 'refining2'], fork: ['assembly', 'salvage'] },
  armour: { name: 'Armour', marks: ['plating', 'plating2'], fork: ['reactive', 'composite'] },
  engines: { name: 'Engines', marks: ['engines', 'engines2'], fork: ['fieldrepair', 'motorised'] },
  weapons: { name: 'Weapons', marks: ['calibration', 'autoloaders'], fork: ['heat', 'highexplosive'] },
  air: { name: 'Air', marks: ['airframes', 'avionics'], fork: ['hardened', 'munitions'] },
};

/**
 * Which line an upgrade belongs to and its mark (1, 2 or 3). Derived from LINES once at load.
 * Countermeasures (classic only, the air war) belongs to no line, so it has no entry.
 */
export const UPGRADE_LINE: Partial<Record<UpgradeId, { line: LineId; mark: 1 | 2 | 3 }>> = (() => {
  const out: Partial<Record<UpgradeId, { line: LineId; mark: 1 | 2 | 3 }>> = {};
  for (const line of LINE_ORDER) {
    const l = LINES[line];
    out[l.marks[0]] = { line, mark: 1 };
    out[l.marks[1]] = { line, mark: 2 };
    out[l.fork[0]] = { line, mark: 3 };
    out[l.fork[1]] = { line, mark: 3 };
  }
  return out;
})();

export const PLATING2_HP = 1.125; // a step on top of PLATING_HP (applied by raiseHealth, as plating is)
export const ENGINES2_SPEED = 1.25; // the total, replacing ENGINES_SPEED
export const REFINING2_INCOME = 1.25; // the total, replacing REFINING_INCOME
export const REACTIVE_TAKEN = 0.8;
export const REACTIVE_KINDS: WeaponKind[] = ['rocket', 'bomb', 'missile'];
export const COMPOSITE_TAKEN = 0.8;
export const COMPOSITE_KINDS: WeaponKind[] = ['shell', 'artillery'];
export const MOTORISED_SPEED = 1.15;
export const ASSEMBLY_RATE = 1.15;
export const SALVAGE_SHARE = 0.1;
export const AUTOLOADER_RELOAD = 0.9;
export const HEAT_DAMAGE = 1.1;
export const HEAT_KINDS: WeaponKind[] = ['shell', 'rocket'];
export const HE_SPLASH = 1.25;
export const AVIONICS_SPEED = 1.15;
export const HARDENED_TAKEN = 0.75;
export const HARDENED_KINDS: WeaponKind[] = ['flak', 'aamissile', 'bullet'];
export const MUNITIONS_DAMAGE = 1.15;

/** Vehicle modules. Vehicles only: infantry, aircraft and heroes never carry them. */
export type ModuleId = 'longbarrel' | 'smoke' | 'fueltank' | 'tracks' | 'orecage';
export const MODULE_ORDER: ModuleId[] = ['longbarrel', 'smoke', 'fueltank', 'tracks', 'orecage'];

export interface ModuleSpec {
  name: string;
  blurb: string;
  /** Added to the unit's price when it is queued with this module. */
  cost: number;
  /** The upgrade that unlocks it. */
  unlock: UpgradeId;
  /** Vehicle kinds it may be fitted to. */
  fits: UnitKind[];
}

/**
 * The vehicles that take modules: the vehicle list as round 5b found it. Main's round 5 vehicles
 * (Repair Truck, Forward Base Truck, Railgun Tank, Stealth Tank) came in at the merge and are played
 * in development lines exactly as main defines them, without modules.
 */
export const MODULE_VEHICLES: UnitKind[] = ['hauler', 'buggy', 'tank', 'artillery', 'missilecarrier', 'flametank', 'bastion', 'flaktrack'];

export const MODULES: Record<ModuleId, ModuleSpec> = {
  longbarrel: { name: 'Long barrel', blurb: 'Reaches three quarters of a tile further.', cost: 150, unlock: 'calibration', fits: ['buggy', 'tank', 'missilecarrier', 'bastion', 'flaktrack'] },
  smoke: { name: 'Smoke launchers', blurb: 'Takes a quarter less damage while on a move order.', cost: 100, unlock: 'plating', fits: [...MODULE_VEHICLES] },
  fueltank: { name: 'Extra fuel tank', blurb: 'Moves 10% faster.', cost: 75, unlock: 'engines', fits: [...MODULE_VEHICLES] },
  tracks: { name: 'Reinforced tracks', blurb: 'A tenth more health.', cost: 100, unlock: 'plating2', fits: [...MODULE_VEHICLES] },
  orecage: { name: 'Ore cage', blurb: 'Carries a quarter more ore each trip.', cost: 150, unlock: 'refining', fits: ['hauler'] },
};

export const LONG_BARREL_RANGE = 0.75;
export const SMOKE_TAKEN = 0.75;
export const FUEL_TANK_SPEED = 1.1;
export const TRACKS_HP = 1.1;
export const ORE_CAGE_CARGO = 1.25;

/** Module slots per vehicle kind. A kind not listed takes no modules. */
export const MODULE_SLOTS: Partial<Record<UnitKind, 1 | 2>> = {
  hauler: 1, buggy: 1, tank: 2, artillery: 1, missilecarrier: 1, flametank: 2, bastion: 2, flaktrack: 1,
};

/**
 * Each kind's weapon with a long barrel fitted: built once here, so the tick never allocates and a
 * unit's weapon object is stable from tick to tick. Only kinds that `longbarrel` fits.
 */
export const LONG_BARREL_WEAPON: Partial<Record<UnitKind, Weapon>> = (() => {
  const out: Partial<Record<UnitKind, Weapon>> = {};
  for (const k of MODULES.longbarrel.fits) {
    const w = UNITS[k].weapon;
    if (w) out[k] = { ...w, range: w.range + LONG_BARREL_RANGE };
  }
  return out;
})();

// ---- Game pace (round 6; fireline-round6b-design.md) ----
//
// The cards call this "game size". In code it is the pace (SkirmishSetup.pace) because main's
// round 5 had already given SkirmishSetup.size to the map's size (MapSize); a card's preset sets
// the map size too (preset.size).

export type GamePace = 'quick' | 'standard' | 'long' | 'epic';
/** Paces in the order the game size screen shows them, left to right. */
export const GAME_PACE_ORDER: GamePace[] = ['quick', 'standard', 'long', 'epic'];
/** The pace the lobby selects for a player who has never chosen one. */
export const LOBBY_DEFAULT_PACE: GamePace = 'standard';

export interface GamePaceSpec {
  name: string;
  /** One line under the name on the card. */
  tagline: string;
  /** Expected battle length in minutes against a Normal commander, as the card states it. */
  minutes: [number, number];
  /** What picking the card writes into the setup besides the pace: credits, ore and map size. Nothing else is touched. */
  preset: { credits: number; ore: OreLevel; size: MapSize };
  /** What a player typically reaches, as the card states it (development lines). */
  reach: string;
  /** Multiplier on the commander's firstAttack and attackInterval (1 = unchanged). */
  attackMul: number;
  /** Development lines only: multipliers on research cost and ticks by mark [Mk I, Mk II, Mk III]. */
  researchCost: [number, number, number];
  researchTicks: [number, number, number];
  /** Development lines only: the commander uses paced research (round 6, section 5). False: round 5's research step. */
  paced: boolean;
}

export const GAME_PACES: Record<GamePace, GamePaceSpec> = {
  quick: {
    name: 'Quick',
    tagline: 'A straight fight: build, mass and strike.',
    minutes: [15, 35],
    preset: { credits: 3000, ore: 'normal', size: 'standard' },
    reach: 'Research rarely gets past Mk I. Doctrines almost never.',
    attackMul: 1,
    researchCost: [1, 1, 1],
    researchTicks: [1, 1, 1],
    paced: false,
  },
  standard: {
    name: 'Standard',
    tagline: 'Room to tech up before the big waves.',
    minutes: [15, 35],
    preset: { credits: 3000, ore: 'normal', size: 'standard' },
    reach: 'Mk II in most battles; a doctrine in about half.',
    attackMul: 1.25,
    researchCost: [0.5, 0.5, 0.5],
    researchTicks: [0.6, 0.6, 0.6],
    paced: true,
  },
  long: {
    name: 'Long',
    tagline: 'A larger map, richer fields and a slower enemy: the whole tree is in play.',
    minutes: [20, 45],
    preset: { credits: 5000, ore: 'rich', size: 'large' },
    reach: 'Mk II in almost every battle; a doctrine in most, sometimes two.',
    attackMul: 2,
    researchCost: [0.5, 0.5, 0.5],
    researchTicks: [0.6, 0.6, 0.6],
    paced: true,
  },
  epic: {
    name: 'Epic',
    tagline: 'The largest map, deep pockets and a patient enemy: the deepest tech.',
    minutes: [45, 85],
    preset: { credits: 10000, ore: 'rich', size: 'huge' },
    reach: 'Mk II in every battle; a doctrine in almost every battle, more than one in most.',
    attackMul: 3,
    researchCost: [0.5, 0.5, 0.5],
    researchTicks: [0.6, 0.6, 0.6],
    paced: true,
  },
};

/** Paced research (round 6, section 5): ore left on the map below which the commander starts no research. */
export const PACED_ORE_FLOOR = 12000;
/** Paced research: armed units (haulers aside) the commander keeps before it holds unit spending for research. */
export const PACED_HOLD_ARMY = 6;
/** Paced research: an armed enemy unit this close (tiles) to the commander's home ends the hold. */
export const PACED_HOLD_RADIUS = 20;
/** Credits a researched upgrade's price is rounded to, after a pace multiplier. */
export const RESEARCH_COST_STEP = 50;

/** The setup with a pace's preset applied: pace, credits, ore and map size. Everything else kept. */
export const applyPace = (setup: SkirmishSetup, pace: GamePace): SkirmishSetup => ({
  ...setup,
  pace,
  credits: GAME_PACES[pace].preset.credits,
  ore: GAME_PACES[pace].preset.ore,
  size: GAME_PACES[pace].preset.size,
});
/** True when the setup's credits, ore and map size are its pace's preset (the card shows "Customised" otherwise). */
export const isPresetSetup = (setup: SkirmishSetup): boolean => {
  const p = GAME_PACES[setup.pace].preset;
  return setup.credits === p.credits && setup.ore === p.ore && (setup.size ?? 'standard') === p.size;
};

/**
 * A difficulty's numbers for a pace. 'quick' (and any pace whose attackMul is 1) returns the
 * DIFFICULTIES entry itself, the same object, so nothing downstream can differ by a rounding.
 * Otherwise a copy with firstAttack and attackInterval multiplied by attackMul and rounded.
 */
export function difficultyForPace(diff: Difficulty, pace: GamePace): DifficultySpec {
  const base = DIFFICULTIES[diff];
  const mul = (GAME_PACES[pace] ?? GAME_PACES.quick).attackMul;
  if (mul === 1) return base;
  return { ...base, firstAttack: Math.round(base.firstAttack * mul), attackInterval: Math.round(base.attackInterval * mul) };
}

/** "Research" line on a card: 'Full price and time' for 1, otherwise e.g. '50% price, 60% time'. */
export function researchPaceText(pace: GamePace): string {
  const spec = GAME_PACES[pace];
  if ([...spec.researchCost, ...spec.researchTicks].every(m => m === 1)) return 'Full price and time';
  const pct = (m: number) => `${Math.round(m * 100)}%`;
  return `${pct(spec.researchCost[1])} price, ${pct(spec.researchTicks[1])} time`;
}

// ---- Round 5 (fireline-round5-design.md) --------------------------------------------------------
//
// Each workstream appends its constants inside its own block below and nowhere else in this
// section. Its specs go at the end of UNITS and BUILDINGS, its kinds in the unions and its items in
// the menus, each between its own round5 markers above.

// round5:C begin. Engineering vehicles: the Repair Truck, the Forward Base truck and the Field Yard.
//
// Advanced tech, skirmish only (none of the three is in STANDARD_TECH). The simulation is in
// engineering.ts, the computer's side of it in aiEngineering.ts.

/** Repair Truck: mends the most damaged of its side's vehicles within this many tiles, centre to centre. */
export const REPAIR_TRUCK_RANGE = 2;
/** Hit points each mend gives back. */
export const REPAIR_TRUCK_HP = 8;
/** Ticks between mends: 16 health a second (the Repair Bay gives 12, and is paid for). */
export const REPAIR_TRUCK_TICKS = 5;
/** How far an idle Repair Truck looks for a damaged vehicle to drive to. */
export const REPAIR_TRUCK_SEEK = 8;
/** Field Yards a side may have, counting Forward Base Trucks standing and queued. */
export const MAX_FIELD_YARDS = 3;
// round5:C end.

// round5:D begin. Neutral sites and tier three.
/** A neutral site's kind (Site in types.ts): Oil Derrick, Field Hospital, Comms Relay. D adds SITES, their numbers. */
export type SiteKind = 'derrick' | 'hospital' | 'relay';
export const SITE_KINDS: SiteKind[] = ['derrick', 'hospital', 'relay'];

/** A neutral site's look and footprint. Every site is 2 by 2 and blocks the ground under it. */
export interface SiteSpec {
  name: string;
  w: number;
  h: number;
  blurb: string;
}
export const SITES: Record<SiteKind, SiteSpec> = {
  derrick: { name: 'Oil Derrick', w: 2, h: 2, blurb: 'Pays its holder 25 credits every five seconds: 300 a minute.' },
  hospital: { name: 'Field Hospital', w: 2, h: 2, blurb: "Heals its holder's infantry within three tiles." },
  relay: { name: 'Comms Relay', w: 2, h: 2, blurb: 'Shows its holder and allies everything within ten tiles.' },
};
/** Ticks of one team's infantry beside a site, alone, to take it: 10 seconds. */
export const SITE_CAPTURE_TICKS = 100;
/** How close infantry must stand to capture: tiles from the footprint's edge. */
export const SITE_CAPTURE_RANGE = 1.5;
/** An Oil Derrick pays its holder this much every DERRICK_TICKS: 300 a minute (a Hauler's load is 600). */
export const DERRICK_INCOME = 25;
export const DERRICK_TICKS = 50;
/** A Field Hospital heals each of its holder's infantry within this many tiles of its footprint. */
export const HOSPITAL_RANGE = 3;
export const HOSPITAL_HEAL = 5;
export const HOSPITAL_TICKS = 10;
/** Tiles a Comms Relay reveals round its centre, to its holder and the holder's allies. */
export const RELAY_RADIUS = 10;
/** Sites of each kind in every side's share of the map, by map size. */
export const SITES_PER_SIDE: Record<MapSize, Record<SiteKind, number>> = {
  standard: { derrick: 1, hospital: 0, relay: 0 },
  large: { derrick: 2, hospital: 1, relay: 1 },
  huge: { derrick: 3, hospital: 1, relay: 2 },
};
/** Placement: a site's centre is at least this far from every start's yard centre, and from every other site's. */
export const SITE_YARD_GAP = 10;
export const SITE_GAP = 6;

/** An enemy unit or structure within this many tiles sees a Stealth Tank (and can then target it). */
export const STEALTH_DETECT_RANGE = 2.5;
/** A Stealth Tank is seen by everyone for this many ticks after it fires. */
export const STEALTH_REVEAL_TICKS = 30;
/** The computer turns to tier three no sooner than this: 25 minutes. */
export const TIER3_AI_TICKS = 15000;
// round5:D end.

// ---- Round 6 (fireline-round6-design.md) --------------------------------------------------------
// The groundwork: armies, per-side specs, generals' ids and formation shapes, declared here and read
// through specs.ts. Each workstream adds its numbers between its own round6 markers below.

/**
 * The two armies. Every side plays 'meridian' unless its setup says otherwise: Meridian Corps is
 * today's army exactly, so every mission, old save and older setup plays as it always did.
 */
export type Faction = 'meridian' | 'ashen';
export const FACTIONS: Faction[] = ['meridian', 'ashen'];
export const FACTION_NAMES: Record<Faction, string> = { meridian: 'Meridian Corps', ashen: 'Ashen Combine' };

/**
 * The spec fields an army may change. A kind's identity (its queue, whether it is a hero, a medic,
 * a mender, a truck that deploys, stealthy, how it fights in the air, a detector, how many it
 * carries; a structure's footprint, and whether it is a wall or packs up) is the same for every army, so code that asks only those
 * questions may keep reading UNITS and BUILDINGS directly. A different role is a different kind.
 */
export type UnitOverlay = Partial<Omit<UnitSpec, 'category' | 'hero' | 'medic' | 'mender' | 'deploysTo' | 'stealth' | 'airRole' | 'detector' | 'carries'>>;
export type BuildingOverlay = Partial<Omit<BuildingSpec, 'w' | 'h' | 'wall' | 'undeploysTo'>>;
export interface FactionOverlay {
  units?: Partial<Record<UnitKind, UnitOverlay>>;
  buildings?: Partial<Record<BuildingKind, BuildingOverlay>>;
}
/**
 * An army's build lists against MENUS: kinds added to a list (its signature items, appended in
 * order) and kinds it never builds. A kind any army adds belongs to the armies that add it alone.
 */
export interface FactionMenu {
  add?: Partial<Record<Category, readonly (BuildingKind | UnitKind)[]>>;
  remove?: readonly (BuildingKind | UnitKind)[];
}

// round6:A begin. Two armies (fireline-round6-design.md, workstream A): FACTION_OVERLAY and
// FACTION_MENUS filled in, the doctrine lines, and its constants. Meridian's overlay stays empty.
//
// The doctrines, on paper first (fireline-round6-design.md, section 3):
//  - Meridian Corps: heavier and slower. Armour and range; strong static defence, the Bastion and
//    the Fortress as its identity. Its signature unit is the Sapper (satchel charges, close in). Air:
//    the Gunship and the Bomber. It is today's army exactly: its overlay is empty, and its lists
//    are MENUS with the Sapper appended to Infantry.
//  - Ashen Combine: lighter, faster, cheaper. About 13% less health and 6% more speed across the
//    army, infantry and light vehicles 5% cheaper, its heavy guns half a tile shorter, its turrets
//    and Fortress cheaper and frailer. Its signature unit is the Raider Bike (fast, fragile,
//    rockets). Air: the Kestrel (a lighter, faster gunship with more rockets and a quicker rearm)
//    and the Firebrand (a bomber whose incendiaries burn on after they land, BOMB_PATCH below).
//    Tuned on the ladder (npm run ladder:fire -- --factions): the plan's first numbers (10% less
//    health, 12% faster, 10% cheaper) won 62% for Ashen over 150 seeds from each seat; these 53%.

/** One line on each army, for the setup screen and How to play. */
export const FACTION_DOCTRINES: Record<Faction, string> = {
  meridian: 'Heavier and slower: armour, range and strong defences. Signature: the Sapper. Air: Gunship and Bomber.',
  ashen: 'Lighter, faster and cheaper, with shorter heavy guns. Signature: the Raider Bike. Air: Kestrel and Firebrand in place of the Gunship and Bomber.',
};

/** Ashen's numbers against the catalogue's (Meridian's), kind by kind. */
const ASHEN_UNITS: Partial<Record<UnitKind, UnitOverlay>> = {
  rifleman: { cost: 95, hp: 52, speed: 0.069 },
  rocketeer: { cost: 285, hp: 44, speed: 0.058 },
  grenadier: { cost: 235, hp: 57, speed: 0.064 },
  medic: { cost: 285, hp: 61, speed: 0.069 },
  skyhunter: { cost: 330, hp: 48, speed: 0.064 },
  buggy: { cost: 475, hp: 157, speed: 0.18 },
  flaktrack: { cost: 665, hp: 226, speed: 0.106 },
  tank: { hp: 360, speed: 0.106, weapon: { ...UNITS.tank.weapon!, range: 4.25 } },
  artillery: { cost: 900, hp: 131, speed: 0.074, weapon: { ...UNITS.artillery.weapon!, range: 8.5 } },
  missilecarrier: { hp: 209, speed: 0.085, weapon: { ...UNITS.missilecarrier.weapon!, range: 7.5 } },
  flametank: { hp: 410, speed: 0.096 },
  bastion: { hp: 770, speed: 0.064, weapon: { ...UNITS.bastion.weapon!, range: 5 } },
  railtank: { hp: 566, speed: 0.09, weapon: { ...UNITS.railtank.weapon!, range: 6 } },
  stealthtank: { cost: 1260, hp: 331, speed: 0.117 },
};
const ASHEN_BUILDINGS: Partial<Record<BuildingKind, BuildingOverlay>> = {
  turret: { cost: 540, hp: 405 },
  rocketturret: { cost: 810, hp: 450 },
  fortress: { cost: 2200, hp: 1980, weapon: { ...BUILDINGS.fortress.weapon!, range: 6.5 } },
};

/** Each army's changes to UNITS and BUILDINGS, merged by unitSpec and buildingSpec (specs.ts). */
export const FACTION_OVERLAY: Record<Faction, FactionOverlay> = {
  meridian: {},
  ashen: { units: ASHEN_UNITS, buildings: ASHEN_BUILDINGS },
};
/** Each army's changes to MENUS, read by menuOf and factionAllows (specs.ts). */
export const FACTION_MENUS: Record<Faction, FactionMenu> = {
  meridian: {
    add: { infantry: ['sapper'] },
  },
  ashen: {
    add: { vehicle: ['raider'], air: ['kestrel', 'firebrand'] },
    remove: ['gunship', 'bomber'],
  },
};
// Meridian's one addition is its signature Sapper, after Infantry's own items (the round's recruits,
// the General and the heroes, close every list: menuOf), so every kind of today keeps its place and
// hotkey and Meridian's specs, prices and lists are otherwise MENUS.

/**
 * The Firebrand's incendiary patch: a bomb of a 'bomb' role aircraft whose weapon is listed here
 * keeps burning where it lands, `pulses` more times, `gap` ticks apart, each at `share` of the
 * bomb's damage over its splash. Keyed by weapon kind, so air.ts names no aircraft.
 */
export const BOMB_PATCH: Partial<Record<WeaponKind, { pulses: number; gap: number; share: number }>> = {
  flame: { pulses: 3, gap: 10, share: 0.3 },
};
// round6:A end.

// round6:B begin. Heroes in free play (fireline-round6-design.md, workstream B): recruit costs,
// limits and the revive cooldown.
//
// A skirmish set up with heroes on (and advanced tech) may recruit the campaign's four heroes once a
// Command Academy stands: the Spy, Commando and Engineer at the Barracks, the Ace at the War Factory,
// through the ordinary queues. The heroes' entries in UNITS keep their campaign numbers (a mission
// never prices or trains a hero), so the skirmish price and training time are these, read by costFor
// and buildTicksFor. One of each per side, standing or queued; a fallen hero may be recruited again
// after HERO_REVIVE_TICKS at HERO_REVIVE_SHARE of the price, and comes back wounded (half health)
// with the experience it had, as a campaign hero does in the next mission.
/** What each hero costs to recruit in a skirmish. */
export const HERO_RECRUIT_COST: Record<HeroKind, number> = { engineer: 1000, spy: 1200, commando: 1800, ace: 2500 };
/** Ticks of training each hero takes in a skirmish (at full power). */
export const HERO_RECRUIT_TICKS: Record<HeroKind, number> = { engineer: 200, spy: 220, commando: 300, ace: 360 };
/** Ticks after a hero falls before it may be recruited again: 90 seconds. */
export const HERO_REVIVE_TICKS = 900;
/** A fallen hero's price to recruit again, as a share of HERO_RECRUIT_COST. */
export const HERO_REVIVE_SHARE = 0.5;
/** The structure that opens hero recruitment. */
export const HERO_ACADEMY = 'academy' as const satisfies BuildingKind;

/** A hero's skirmish price: full, or HERO_REVIVE_SHARE of it for one that has fallen in this battle. */
export function heroRecruitCost(kind: HeroKind, fallen: boolean): number {
  return fallen ? Math.round(HERO_RECRUIT_COST[kind] * HERO_REVIVE_SHARE) : HERO_RECRUIT_COST[kind];
}
// round6:B end.

/** The four doctrine Generals, two to an army. Their perks and powers are workstream C's GENERALS. */
export type GeneralId = 'hale' | 'voss' | 'kade' | 'ilse';
export const GENERAL_IDS: GeneralId[] = ['hale', 'voss', 'kade', 'ilse'];
/** Which army each General serves: a seat may pick only its own army's. */
export const GENERAL_FACTION: Record<GeneralId, Faction> = { hale: 'meridian', voss: 'meridian', kade: 'ashen', ilse: 'ashen' };

// round6:C begin. Generals (fireline-round6-design.md, workstream C): GENERALS (names, perks, power
// tweaks), the aura's numbers and the replacement cooldown.

/**
 * A doctrine General: a bundle of perks for one side, chosen at setup (setup.generalPicks). The
 * three multipliers become that side's Perks (generals.ts, read through perksFor); `costs` and
 * `rearmMul` are read by generals.ts where a price is set and where aircraft rearm. A multiplier
 * below 1 on a price or a time is a saving; above 1 on a rate is a gain.
 */
export interface GeneralSpec {
  name: string;
  /** The doctrine in a word or two. */
  doctrine: string;
  faction: Faction;
  blurb: string;
  /** The refinery's take (Perks.harvestMul). */
  harvestMul: number;
  /** Production speed in every queue (Perks.buildSpeedMul). */
  buildSpeedMul: number;
  /** The support-power tweak: every power's cooldown (Perks.powerCooldownMul). */
  powerCooldownMul: number;
  /** Price multipliers on some kinds alone. */
  costs: Partial<Record<BuildingKind | UnitKind, number>>;
  /** Price multiplier on every aircraft (any kind with an airRole, whatever its army). */
  airCostMul: number;
  /** Time each load takes to rearm at a Helipad. 1: unchanged. */
  rearmMul: number;
}

export const GENERALS: Record<GeneralId, GeneralSpec> = {
  hale: {
    name: 'General Hale',
    doctrine: 'Fortress',
    faction: 'meridian',
    blurb: 'Defences (Gun and Rocket Turrets, Flak Cannons, the Fortress and walls) 20% cheaper; support powers recharge 10% sooner.',
    harvestMul: 1,
    buildSpeedMul: 1,
    powerCooldownMul: 0.9,
    costs: { turret: 0.8, rocketturret: 0.8, flakcannon: 0.8, fortress: 0.8, wall: 0.8 },
    airCostMul: 1,
    rearmMul: 1,
  },
  voss: {
    name: 'General Voss',
    doctrine: 'Armour',
    faction: 'meridian',
    blurb: 'Tanks, Flame Tanks, Rail Tanks and Bastions 15% cheaper; support powers recharge 5% sooner; but harvesting is 10% slower.',
    harvestMul: 0.9,
    buildSpeedMul: 1,
    powerCooldownMul: 0.95,
    costs: { tank: 0.85, flametank: 0.85, railtank: 0.85, bastion: 0.85 },
    airCostMul: 1,
    rearmMul: 1,
  },
  kade: {
    name: 'General Kade',
    doctrine: 'Blitz',
    faction: 'ashen',
    blurb: 'Every queue works 10% faster; support powers recharge 15% sooner.',
    harvestMul: 1,
    buildSpeedMul: 1.1,
    powerCooldownMul: 0.85,
    costs: {},
    airCostMul: 1,
    rearmMul: 1,
  },
  ilse: {
    name: 'General Ilse',
    doctrine: 'Air',
    faction: 'ashen',
    blurb: 'Helipads 25% cheaper and aircraft 10% cheaper; aircraft rearm 20% faster; support powers recharge 5% sooner.',
    harvestMul: 1,
    buildSpeedMul: 1,
    powerCooldownMul: 0.95,
    costs: { helipad: 0.75 },
    airCostMul: 0.9,
    rearmMul: 0.8,
  },
};

/** The field General's command aura: its reach in tiles, and how often it is worked out (ticks). */
export const GENERAL_AURA_RANGE = 6;
export const GENERAL_AURA_TICKS = 10;
/** Inside an aura: damage times this, and the time between shots times GENERAL_AURA_RELOAD. Never stacks. */
export const GENERAL_AURA_DAMAGE = 1.1;
export const GENERAL_AURA_RELOAD = 0.9;
/** After a General falls, a replacement may be queued this many ticks later (two minutes). */
export const GENERAL_REPLACE_TICKS = 1200;
/** The computer pulls its General back home below this share of its health, and sends it out again at GENERAL_RETURN_AT. */
export const GENERAL_RETREAT_BELOW = 0.4;
export const GENERAL_RETURN_AT = 0.75;
// round6:C end.

/** Round 6, workstream D: the shapes a group can move in. */
export type FormationShape = 'line' | 'column' | 'wedge' | 'box';
export const FORMATION_SHAPES: FormationShape[] = ['line', 'column', 'wedge', 'box'];

// round6:D begin. Formations and squads (fireline-round6-design.md, workstream D): names, slot
// spacing, the leader's refresh interval and its constants.
export const FORMATION_NAMES: Record<FormationShape, string> = { line: 'Line', column: 'Column', wedge: 'Wedge', box: 'Box' };
export const FORMATION_BLURBS: Record<FormationShape, string> = {
  line: 'Side by side, facing the way you send them: every gun can fire forward.',
  column: 'Two files, one behind the other: narrow, for roads, bridges and gaps.',
  wedge: 'An arrowhead with the armour at its tip: for driving into the enemy.',
  box: 'A tight block, guns all round and the Medics and Repair Trucks inside: for holding or regrouping.',
};
/** Tiles between neighbouring slots facing straight up, down or across. */
export const SLOT_SPACING = 1;
/**
 * Facing a diagonal, slot tables are turned with unnormalised diagonal steps (one tile across and
 * one down), which are 1.41 tiles long; this scale brings them back to about one tile (1.06).
 */
export const SLOT_SPACING_DIAGONAL = 0.75;
/** Ticks between the leader re-aiming its squad's members at their slots beside it. */
export const SQUAD_REFRESH_TICKS = 8;
/** On the march, members aim this many tiles ahead of their slot beside the leader, so they keep walking. */
export const SQUAD_LEAD = 2;
/** Once the leader is this close to its goal, members head for their own final slots. */
export const SQUAD_FINAL = 4;
/** A member further than this from its slot beside the leader may go at its own speed to catch up. */
export const SQUAD_SLACK = 1.5;
/** The largest group the line keeps in one rank; more go in further ranks behind. */
export const LINE_RANK_MAX = 10;
// round6:D end.

// round6:integration. The General leads a formation (fireline-round6-design.md section 7): a squad
// with a field General among its members is led by the General, and keeps tighter.
/** Ticks between a General's re-aiming of its squad (half SQUAD_REFRESH_TICKS). */
export const GENERAL_SQUAD_REFRESH_TICKS = 4;
/** In a General's squad, a member further than this from its slot may catch up at its own speed. */
export const GENERAL_SQUAD_SLACK = 1;
/** A General holds to half the squad's pace while any member is further than this from its slot (and not ahead of it). */
export const GENERAL_SQUAD_HOLD = 1.5;
