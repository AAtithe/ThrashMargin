import { migrateAir } from './air';
import { scaledFor } from './aiScale';
import { generateMap, idx } from './map';
import { generateSkirmishMap, randomMapType } from './maps';
import { seedFromString } from './rng';
import {
  BUILDINGS,
  DEFAULT_DIFFICULTY,
  DEFAULT_SETUP,
  DIFFICULTIES,
  FORMATION_SHAPES,
  GENERAL_FACTION,
  GENERAL_IDS,
  LEGACY_SETUP,
  LONE_SIDE_CREDITS,
  MAP_H,
  MAP_SIZES,
  MAP_TYPES,
  MAP_W,
  MAX_SIDES,
  PRODUCER,
  ALSO_PRODUCES,
  SETUP_CREDITS_MAX,
  SETUP_CREDITS_MIN,
  SIDE_NAMES,
  ORDER_QUEUE_MAX,
  POWERS,
  SKIRMISH_POWERS,
  STANDARD_TECH,
  START_CREDITS,
  heroLevelFor,
  UNITS,
  vetFor,
  type BuildingKind,
  type Category,
  type Difficulty,
  type Faction,
  type FormationShape,
  type GeneralId,
  type MapSize,
  type MapType,
  type Owner,
  type SideMode,
  type SkirmishSetup,
  type SupportPower,
  type UnitKind,
} from './rules';
import { frontDir, inwardDiagonal, isAlly, normaliseTeams, sidesOf, startOf, teamsFor } from './sides';
import type { AiMemory, Building, GameState, HeroState, MissionRuntime, Perks, PlayerState, Squad, Stance, Unit } from './types';
import { buildingSpec, buildingSpecOf, factionAllows, factionOf, isFaction, kindSpec, perksFor, unitSpec, unitSpecOf } from './specs';
// round5:D. Neutral sites (fireline-round5-design.md, workstream D).
import { migrateSites, placeSites, relaysOf } from './sites';
import { RELAY_RADIUS } from './rules';

export { startOf };
// Round 6 groundwork: the per-side specs and perks live in specs.ts (no import cycle); re-exported here.
export { buildingSpec, buildingSpecOf, factionOf, kindSpec, perksFor, unitSpec, unitSpecOf };

export interface NewGameOptions {
  seed?: string;
  difficulty?: Difficulty;
  createdAt: number;
  /** Test harness only: the computer plays both sides. */
  autopilot?: boolean;
  /**
   * The skirmish setup. Absent: the original game (LEGACY_SETUP: the original map generator,
   * standard tech, 3000 credits). The lobby passes DEFAULT_SETUP or the player's choices; any
   * field left out takes DEFAULT_SETUP's value.
   */
  setup?: Partial<SkirmishSetup>;
}

/** A setup with every field valid: unknown values fall back to DEFAULT_SETUP's, credits are clamped. */
export function normaliseSetup(raw: Partial<SkirmishSetup> | null | undefined, base: SkirmishSetup = DEFAULT_SETUP): SkirmishSetup {
  const r = raw && typeof raw === 'object' ? raw : {};
  const map = r.map === 'random' || MAP_TYPES.includes(r.map as MapType) ? (r.map as SkirmishSetup['map']) : base.map;
  const tech = r.tech === 'standard' || r.tech === 'advanced' ? r.tech : base.tech;
  const ore = r.ore === 'poor' || r.ore === 'normal' || r.ore === 'rich' ? r.ore : base.ore;
  const credits = Number.isFinite(r.credits)
    ? Math.max(SETUP_CREDITS_MIN, Math.min(SETUP_CREDITS_MAX, Math.round(r.credits! / 100) * 100))
    : base.credits;
  // Sides and mode: anything but 2, 3 or 4 sides falls back to the base's; anything but 'ffa' or
  // 'teams' is 'ffa'; two sides are always 'ffa'.
  const sides = r.sides === 2 || r.sides === 3 || r.sides === 4 ? r.sides : base.sides === 3 || base.sides === 4 ? base.sides : 2;
  const mode: SideMode = sides > 2 && r.mode === 'teams' ? 'teams' : 'ffa';
  // Round 5: map size and neutral sites. Anything but a known size falls back to the base's (and a
  // base from before round 5 has none: 'standard'); sites are on only when exactly true.
  const size: MapSize = MAP_SIZES.includes(r.size as MapSize) ? (r.size as MapSize) : (base.size ?? 'standard');
  const sites = typeof r.sites === 'boolean' ? r.sites : (base.sites ?? false);
  // Round 6: one army and one doctrine General per seat; heroes and field Generals on only when
  // exactly true. Anything else falls back to the base's (a base from before round 6 has none:
  // 'meridian', off, no General). A General from the other army reads as none.
  const seats = Array.from({ length: sides }, (_, i) => i);
  const rf = Array.isArray(r.factions) ? r.factions : [];
  const factions: Faction[] = seats.map(i => (isFaction(rf[i]) ? rf[i] : isFaction(base.factions?.[i]) ? base.factions![i] : 'meridian'));
  const heroes = typeof r.heroes === 'boolean' ? r.heroes : (base.heroes ?? false);
  const generals = typeof r.generals === 'boolean' ? r.generals : (base.generals ?? false);
  const isGeneral = (v: unknown): v is GeneralId => GENERAL_IDS.includes(v as GeneralId);
  const rg = Array.isArray(r.generalPicks) ? r.generalPicks : [];
  const generalPicks = seats.map(i => {
    const pick = isGeneral(rg[i]) || rg[i] === null ? rg[i] : isGeneral(base.generalPicks?.[i]) ? base.generalPicks![i] : null;
    return pick && GENERAL_FACTION[pick] === factions[i] ? pick : null;
  });
  return { map, tech, credits, ore, sides, mode, size, sites, factions, heroes, generals, generalPicks };
}

/** How this battle was set up. Saves from before setups, and missions, read as LEGACY_SETUP. */
export const setupOf = (s: GameState): SkirmishSetup => s.setup ?? LEGACY_SETUP;

/**
 * Whether this side may build or train this kind at all in this battle (requirements aside). A
 * mission: side 0 by its tech list, side 1 by the original game's. A skirmish: everything with
 * 'advanced' tech, the original game's with 'standard'.
 */
export function techAllowed(s: GameState, owner: Owner, kind: BuildingKind | UnitKind): boolean {
  if (owner === 0 && s.allowed && !s.allowed.includes(kind)) return false;
  // Round 6: an army fields only its own list (FACTION_MENUS); every kind for 'meridian' today.
  if (!factionAllows(factionOf(s, owner), kind)) return false;
  // round6:B begin. Heroes in free play: heroes allowed in a skirmish only with setup.heroes (and advanced tech).
  // round6:B end.
  // round6:C begin. Generals: the field General allowed only with setup.generals.
  // round6:C end.
  if (s.mission) return owner === 0 || STANDARD_TECH.includes(kind);
  return setupOf(s).tech === 'advanced' || STANDARD_TECH.includes(kind);
}

/** True for a structure that counts as one: for victory, for the build radius, for survivors. Walls do not. */
export const isStructure = (b: Building): boolean => !BUILDINGS[b.kind].wall;

/**
 * Skirmish support powers follow their structures (SKIRMISH_POWERS), for both sides: a power is
 * granted on full cooldown when the first of its structures stands, and taken away with the last.
 * Only in a skirmish on 'advanced' tech; a mission's powers are its own and are never touched.
 * Works in place, on a state the reducer has cloned.
 */
export function syncSkirmishPowers(s: GameState): void {
  if (s.mission || !s.setup || s.setup.tech !== 'advanced') return;
  const powers: NonNullable<GameState['powers']> = s.powers ?? sidesOf(s).map(() => ({}));
  for (const owner of sidesOf(s)) {
    let side = powers[owner];
    for (const [power, kind] of Object.entries(SKIRMISH_POWERS) as [SupportPower, BuildingKind][]) {
      const has = s.buildings.some(b => b.owner === owner && b.kind === kind && b.hp > 0);
      const held = side[power] !== undefined;
      if (has === held) continue;
      side = { ...side };
      if (has) side[power] = POWERS[power].cooldown;
      else delete side[power];
    }
    powers[owner] = side;
  }
  s.powers = powers;
}

function newPlayer(owner: Owner, credits = START_CREDITS, faction?: Faction): PlayerState {
  return {
    owner,
    name: SIDE_NAMES[owner],
    credits,
    queues: { building: [], infantry: [], vehicle: [], air: [] },
    stats: { built: 0, trained: 0, lost: 0, killed: 0, harvested: 0 },
    // Round 6: a skirmish records each side's army; a battle without a setup has none ('meridian').
    ...(faction ? { faction } : {}),
  };
}

/** Sides 0 to n - 1. */
const sideList = (n: number): Owner[] => Array.from({ length: n }, (_, i) => i as Owner);

/**
 * A side's starting credits: the setup's, except a side alone on its team against a team of
 * several (three sides played as teams: side 1 against sides 0 and 2), which gets LONE_SIDE_CREDITS
 * times as much.
 */
function startCredits(credits: number, owner: Owner, teams: number[]): number {
  const mine = teams.filter(t => t === teams[owner]).length;
  const most = Math.max(...teams.map(t => teams.filter(u => u === t).length));
  return mine === 1 && most > 1 ? Math.round(credits * LONE_SIDE_CREDITS) : credits;
}

/** A computer commander's starting memory. The one place it is built, for skirmish and missions alike. */
export function newAiMemory(firstAttack: number): AiMemory {
  return { nextAttack: firstAttack, wave: 0, hurtTick: -9999, hurtX: 0, hurtY: 0, waveIds: [], wavePhase: 0, waveTick: 0, waveSize: 0, raidIds: [], raidTarget: 0, nextRaid: 0 };
}

export function createInitialState(id: string, name: string, opts: NewGameOptions): GameState {
  const seedText = opts.seed && opts.seed.trim() ? opts.seed.trim().slice(0, 64) : `${id}`;
  const rngSeed = seedFromString(seedText);
  // No setup: the original game, on the original map. With one: the setup's map type ('random'
  // drawn from the seed) from the skirmish generator, and the setup stored on the state.
  const setup = opts.setup ? normaliseSetup(opts.setup) : null;
  const mapType: MapType | null = setup ? (setup.map === 'random' ? randomMapType(rngSeed) : setup.map) : null;
  // Two sides (every setup before round 4, and every battle without a setup) take exactly the
  // original path. Three or four: a larger map with one start per side, and teams from teamsFor.
  const n = setup ? setup.sides : 2;
  // Round 5: a larger map when the setup asks for one; standard size takes exactly the old path.
  const size = setup?.size ?? 'standard';
  const map =
    setup && mapType
      ? size !== 'standard'
        ? generateSkirmishMap(rngSeed, mapType, setup.ore, n, size)
        : n > 2
          ? generateSkirmishMap(rngSeed, mapType, setup.ore, n)
          : generateSkirmishMap(rngSeed, mapType, setup.ore)
      : generateMap(rngSeed);
  const credits = setup ? setup.credits : START_CREDITS;
  const difficulty = opts.difficulty && opts.difficulty in DIFFICULTIES ? opts.difficulty : DEFAULT_DIFFICULTY;
  const d = DIFFICULTIES[difficulty];
  const teams = setup && n > 2 ? teamsFor(n, setup.mode) : [0, 1];

  const s: GameState = {
    version: 1,
    id,
    name: name || 'Battle',
    createdAt: opts.createdAt,
    seedText,
    rngSeed,
    difficulty,
    tick: 0,
    tiles: map.tiles,
    ore: map.ore,
    mapW: map.w,
    mapH: map.h,
    explored: '0'.repeat(map.w * map.h),
    units: [],
    buildings: [],
    players:
      n > 2
        ? sideList(n).map(o => newPlayer(o, startCredits(credits, o, teams), setup?.factions?.[o]))
        : [newPlayer(0, credits, setup?.factions?.[0]), newPlayer(1, credits, setup?.factions?.[1])],
    teams,
    projectiles: [],
    effects: [],
    ai: n > 2 ? sideList(n).map(() => newAiMemory(d.firstAttack)) : [
      newAiMemory(d.firstAttack),
      newAiMemory(d.firstAttack),
    ],
    autopilot: !!opts.autopilot,
    nextId: 1,
    winner: null,
    log: [{ tick: 0, text: 'Battlefield control established. Build a Generator, then a Refinery.', tone: 'info' }],
    alarms: {},
  };
  if (setup && mapType) {
    s.setup = setup;
    s.mapType = mapType;
    s.starts = map.starts.map(st => ({ ...st }));
    // Support powers come with their structures (SKIRMISH_POWERS); none stand yet.
    if (setup.tech === 'advanced') s.powers = sidesOf(s).map(() => ({}));
    // round5:D begin. Neutral sites (fireline-round5-design.md, workstream D): one call into sites.ts
    // when setup.sites is on, filling s.sites. Nothing else here changes.
    if (setup.sites) placeSites(s);
    // round5:D end.
    // round6:C begin. Generals: the doctrine Generals' perks (perks for side 0, sidePerks for the rest).
    // round6:C end.
    // Round 5: on a larger map the computer's first attack comes later (aiScale.ts).
    if (size !== 'standard') {
      const first = scaledFor(s, d).firstAttack;
      for (const mem of s.ai) mem.nextAttack = first;
    }
  }

  for (const owner of sidesOf(s)) {
    const st = map.starts[owner];
    addBuilding(s, owner, 'hq', st.x, st.y, -100);
    // Three riflemen beside the yard, on the side facing the middle of the map.
    const dir = frontDir(s, owner);
    for (let i = 0; i < 3; i++) {
      addUnit(s, owner, 'rifleman', st.x + 1.5 + dir * (i - 1) * 0.9, st.y + 1.5 - dir * 2.6);
    }
  }
  updateExplored(s);
  return s;
}

export function addBuilding(s: GameState, owner: Owner, kind: BuildingKind, x: number, y: number, placedAt = s.tick): Building {
  const aim = inwardDiagonal(s, owner);
  const b: Building = {
    id: s.nextId++,
    owner,
    kind,
    x,
    y,
    // round6:C begin. Generals: a doctrine's structure health (Hale), if it is applied where a structure is made.
    hp: buildingSpec(s, owner, kind).hp,
    // round6:C end.
    placedAt,
    repairing: false,
    rally: null,
    cooldown: 0,
    engage: 0,
    tx: aim.x,
    ty: aim.y,
  };
  s.buildings.push(b);
  return b;
}

export function addUnit(s: GameState, owner: Owner, kind: UnitKind, x: number, y: number): Unit {
  // Facing the middle of the map: north for a base in the bottom half, south for one in the top.
  const fy = -frontDir(s, owner);
  const perks = perksFor(s, owner);
  const hpMul = perks ? perks.unitHpMul : 1;
  // Full health is stored on the unit whenever it differs from UNITS[kind].hp (an Armour perk, an
  // army's overlay), so maxHpOf needs no side.
  const hp0 = unitSpec(s, owner, kind).hp;
  const maxHp = hpMul !== 1 ? Math.max(1, Math.round(hp0 * hpMul)) : hp0 !== UNITS[kind].hp ? hp0 : 0;
  const u: Unit = {
    id: s.nextId++,
    owner,
    kind,
    x,
    y,
    hp: maxHp || hp0,
    fx: 0,
    fy,
    tx: 0,
    ty: fy,
    order: { type: 'idle' },
    engage: 0,
    path: [],
    pathGoal: -1,
    pathTick: -999,
    cooldown: 0,
    cargo: 0,
    stuck: 0,
    kills: 0,
    vet: 0,
    queue: [],
    stance: 'guard',
  };
  if (maxHp) u.maxHp = maxHp;
  s.units.push(u);
  return u;
}

/**
 * A unit's full health: perks, hero levels and an army's overlay move it from UNITS[kind].hp, and
 * whatever does so stores it on the unit as maxHp.
 */
export const maxHpOf = (u: Unit): number => u.maxHp ?? UNITS[u.kind].hp;

/**
 * The one copy an action makes. Everything the reducer can change is copied; `tiles` and `teams`
 * never change and are shared. Effects, projectiles and log entries are never edited after
 * creation, so copying their arrays is enough.
 */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    ore: s.ore.slice(),
    // Queued orders are never edited in place (a popped one is copied), so the array copy is enough.
    units: s.units.map(u => {
      const c = { ...u, order: { ...u.order }, path: u.path.slice(), queue: u.queue.slice() };
      if (u.hero) c.hero = u.hero.active ? { ...u.hero, active: { ...u.hero.active } } : { ...u.hero };
      return c;
    }),
    buildings: s.buildings.map(b => ({ ...b, rally: b.rally ? { ...b.rally } : null })),
    players: s.players.map(p => ({
      ...p,
      queues: {
        building: p.queues.building.map(q => ({ ...q })),
        infantry: p.queues.infantry.map(q => ({ ...q })),
        vehicle: p.queues.vehicle.map(q => ({ ...q })),
        // A mission's players and saves not yet migrated may have no air queue: none is invented.
        ...(p.queues.air ? { air: p.queues.air.map(q => ({ ...q })) } : {}),
      } as PlayerState['queues'],
      stats: { ...p.stats },
      ...(p.upgrades ? { upgrades: p.upgrades.slice() } : {}),
      ...(p.research ? { research: { ...p.research } } : {}),
    })),
    projectiles: s.projectiles.slice(),
    effects: s.effects.slice(),
    ai: s.ai.map(a => ({ ...a })),
    log: s.log.slice(),
    alarms: { ...s.alarms },
    ...(s.mission
      ? {
          mission: {
            ...s.mission,
            objectives: s.mission.objectives.map(o => ({ ...o })),
            bonus: s.mission.bonus.map(o => ({ ...o })),
            fired: s.mission.fired.slice(),
            ...(s.mission.fallen ? { fallen: { ...s.mission.fallen } } : {}),
          },
        }
      : {}),
    ...(s.powers ? { powers: s.powers.map(p => ({ ...p })) } : {}),
    ...(s.blackoutUntil ? { blackoutUntil: s.blackoutUntil.slice() } : {}),
    ...(s.recon ? { recon: s.recon.slice() } : {}),
    // round5:D begin. Neutral sites: s.sites copied one object deep, only when present.
    ...(s.sites ? { sites: s.sites.map(x => ({ ...x })) } : {}),
    // round5:D end.
    // Round 6: squads copied one level deep (their member lists too), only when present. Perks, side
    // 0's and the others' alike, are replaced whole and never edited in place, so they are shared.
    ...(s.squads ? { squads: s.squads.map(q => ({ ...q, members: q.members.slice() })) } : {}),
    // round6:D begin. Formations and squads: anything else of D's that cloneState must copy.
    // round6:D end.
  };
}

export function powerOf(s: GameState, owner: Owner): { made: number; used: number; low: boolean } {
  let made = 0;
  let used = 0;
  const blackout = !!s.blackoutUntil && s.tick < (s.blackoutUntil[owner] ?? 0);
  for (const b of s.buildings) {
    if (b.owner !== owner) continue;
    const spec = buildingSpecOf(s, b);
    const p = spec.power;
    if (p > 0) made += Math.round(p * Math.max(0.5, b.hp / spec.hp));
    else used -= p;
  }
  // A Spy on a Generator: the side's power has failed, whatever it has standing.
  if (blackout) return { made: 0, used, low: true };
  return { made, used, low: used > made };
}

export function hasBuilding(s: GameState, owner: Owner, kind: BuildingKind): boolean {
  return s.buildings.some(b => b.owner === owner && b.kind === kind);
}

export function countBuildings(s: GameState, owner: Owner, kind: BuildingKind): number {
  let n = 0;
  for (const b of s.buildings) if (b.owner === owner && b.kind === kind) n++;
  return n;
}

/** True when every structure this needs is standing. */
export function unlocked(s: GameState, owner: Owner, kind: BuildingKind | UnitKind): boolean {
  return kindSpec(s, owner, kind).requires.every(r => hasBuilding(s, owner, r));
}

export function categoryOf(kind: BuildingKind | UnitKind): Category {
  if (kind in BUILDINGS) return 'building';
  return UNITS[kind as UnitKind].category;
}

/** The catalogue's cost (Meridian's). A side's own price is costFor. */
export function costOf(kind: BuildingKind | UnitKind): number {
  return kind in BUILDINGS ? BUILDINGS[kind as BuildingKind].cost : UNITS[kind as UnitKind].cost;
}

/** What this side pays for it in this battle: its army's price, less its Procurement perk's share. */
export function costFor(s: GameState, owner: Owner, kind: BuildingKind | UnitKind): number {
  // round6:B begin. Heroes in free play: a skirmish hero's recruit price (B's constant) in place of the spec's.
  const base = kindSpec(s, owner, kind).cost;
  // round6:B end.
  const perks = perksFor(s, owner);
  // round6:C begin. Generals: a doctrine's price on some kinds alone (new optional Perks fields), folded into mul.
  const mul = perks ? perks.costMul : 1;
  // round6:C end.
  return mul === 1 ? base : Math.round(base * mul);
}

/** The catalogue's build time (Meridian's). A side's own is buildTicksFor. */
export function buildTicksOf(kind: BuildingKind | UnitKind): number {
  return kind in BUILDINGS ? BUILDINGS[kind as BuildingKind].buildTicks : UNITS[kind as UnitKind].buildTicks;
}

/** Ticks of work this side's queue needs to finish it: its army's build time. */
export function buildTicksFor(s: GameState, owner: Owner, kind: BuildingKind | UnitKind): number {
  return kindSpec(s, owner, kind).buildTicks;
}

/**
 * The structure a queue's finished item comes out of (lowest id wins when there are several). One
 * stopped by a Spy is passed over while another is working; if all are stopped, the first is
 * returned and `sabotaged(s, b)` says so.
 */
export function producerFor(s: GameState, owner: Owner, category: Category): Building | undefined {
  const kind = PRODUCER[category];
  let found: Building | undefined;
  let working: Building | undefined;
  for (const b of s.buildings) {
    if (b.owner !== owner || (b.kind !== kind && ALSO_PRODUCES[b.kind] !== category)) continue;
    if (!found || b.id < found.id) found = b;
    if (!sabotaged(s, b) && (!working || b.id < working.id)) working = b;
  }
  return working ?? found;
}

/**
 * True when this side has something standing that works this queue: its PRODUCER, or a structure
 * that also does (ALSO_PRODUCES; round 5's Field Yard works Structures). Sabotaged or not. The
 * build window greys a list on this, never on PRODUCER alone.
 */
export const hasProducer = (s: GameState, owner: Owner, category: Category): boolean => !!producerFor(s, owner, category);

/** True while a Spy's sabotage keeps this producer idle. */
export const sabotaged = (s: GameState, b: Building): boolean => b.sabotagedUntil !== undefined && s.tick < b.sabotagedUntil;

/** A finished structure waiting to be placed, if any. */
export function readyStructure(s: GameState, owner: Owner): BuildingKind | null {
  const head = s.players[owner].queues.building[0];
  if (!head) return null;
  return head.progress >= buildTicksFor(s, owner, head.kind) ? (head.kind as BuildingKind) : null;
}

/** Every tile within sight of something side `owner` owns. */
export function visibility(s: GameState, owner: Owner): Uint8Array {
  const MW = s.mapW;
  const MH = s.mapH;
  const vis = new Uint8Array(MW * MH);
  const mark = (cx: number, cy: number, r: number) => {
    const r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(MH - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(MW - 1, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) vis[y * MW + x] = 1;
      }
  };
  for (const u of s.units) if (u.owner === owner) mark(u.x, u.y, unitSpecOf(s, u).sight);
  // Recon sweeps are side 0's, and show their area until they run out.
  if (owner === 0 && s.recon) for (const r of s.recon) if (s.tick < r[3]) mark(r[0], r[1], r[2]);
  for (const b of s.buildings)
    if (b.owner === owner) {
      const spec = buildingSpecOf(s, b);
      mark(b.x + spec.w / 2, b.y + spec.h / 2, spec.sight + Math.max(spec.w, spec.h) / 2);
    }
  // round5:D begin. A Comms Relay this side holds reveals its area (one loop calling mark).
  if (s.sites) for (const c of relaysOf(s, owner)) mark(c.x, c.y, RELAY_RADIUS);
  // round5:D end.
  return vis;
}

/**
 * Every tile within sight of `owner` or any ally: what a side sees, since allies share their sight.
 * With no ally (every two-sided battle) this is exactly visibility(s, owner).
 */
export function teamVisibility(s: GameState, owner: Owner): Uint8Array {
  const vis = visibility(s, owner);
  for (const o of sidesOf(s)) {
    if (o === owner || !isAlly(s, owner, o)) continue;
    const more = visibility(s, o);
    for (let k = 0; k < vis.length; k++) vis[k] |= more[k];
  }
  return vis;
}

/** Folds what side 0 (with its allies) can currently see into the explored map. */
export function updateExplored(s: GameState): void {
  const vis = teamVisibility(s, 0);
  const e = s.explored;
  let k = 0;
  for (; k < vis.length; k++) if (vis[k] && e.charCodeAt(k) === 48) break;
  if (k === vis.length) return; // Nothing new: the common case.
  const chars = e.split('');
  for (; k < chars.length; k++) if (vis[k]) chars[k] = '1';
  s.explored = chars.join('');
}

export function log(s: GameState, text: string, tone: 'info' | 'good' | 'bad' = 'info'): void {
  s.log.push({ tick: s.tick, text, tone });
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
}

/** Logs at most once per `gap` ticks for a given key. */
export function alarm(s: GameState, key: string, text: string, gap: number, tone: 'info' | 'good' | 'bad' = 'bad'): void {
  const last = s.alarms[key] ?? -Infinity;
  if (s.tick - last < gap) return;
  s.alarms[key] = s.tick;
  log(s, text, tone);
}

/**
 * A save from an older build is passed through this before use. Anything that does not look like
 * a battle is refused rather than crashing the reducer. Saves from before veterancy, waypoint
 * queues and stances get those fields filled with their defaults (rookie, empty queue, guard), so
 * a battle in progress keeps loading. Returns a new object; the input is not modified.
 */
export function migrateState(raw: unknown): GameState | null {
  const s = raw as Partial<GameState> | null;
  if (!s || typeof s !== 'object' || s.version !== 1) return null;
  if (typeof s.tiles !== 'string' || !Array.isArray(s.ore) || typeof s.explored !== 'string') return null;
  if (!Array.isArray(s.units) || !Array.isArray(s.buildings) || !Array.isArray(s.players)) return null;
  if (!Array.isArray(s.projectiles) || !Array.isArray(s.effects) || !Array.isArray(s.ai)) return null;
  const units = s.units.map(raw => {
    const u = raw as Partial<Unit> & Unit;
    const kills = Number.isFinite(u.kills) ? u.kills : 0;
    const vet = u.vet === 0 || u.vet === 1 || u.vet === 2 ? u.vet : vetFor(kills);
    const queue = Array.isArray(u.queue)
      ? u.queue.filter(o => o && (o.type === 'move' || o.type === 'attackMove' || o.type === 'attack')).slice(0, ORDER_QUEUE_MAX)
      : [];
    const stance: Stance = u.stance === 'aggressive' || u.stance === 'hold' ? u.stance : 'guard';
    const out: Unit = { ...u, kills, vet, queue, stance };
    if (u.hero !== undefined) {
      const h = u.hero as Partial<HeroState> | null;
      if (!h || typeof h !== 'object' || !UNITS[u.kind]?.hero) delete out.hero;
      else {
        const xp = Number.isFinite(h.xp) && h.xp! > 0 ? h.xp! : 0;
        const abilityCd = Number.isFinite(h.abilityCd) && h.abilityCd! > 0 ? Math.round(h.abilityCd!) : 0;
        const active = h.active && (h.active.kind === 'overdrive' || h.active.kind === 'capture') ? { ...h.active } : undefined;
        out.hero = { level: heroLevelFor(xp), xp, abilityCd, ...(active ? { active } : {}) };
      }
    }
    if (u.maxHp !== undefined && !(Number.isFinite(u.maxHp) && u.maxHp > 0)) delete out.maxHp;
    return out;
  });
  // Sides: saves from before 3 and 4 sides have two players, no teams and a 64 by 64 map.
  const n = s.players.length;
  if (n < 2 || n > MAX_SIDES) return null;
  const mapW = Number.isInteger(s.mapW) && s.mapW! > 0 ? s.mapW! : MAP_W;
  const mapH = Number.isInteger(s.mapH) && s.mapH! > 0 ? s.mapH! : MAP_H;
  if (s.tiles.length !== mapW * mapH || s.ore.length !== mapW * mapH || s.explored.length !== mapW * mapH) return null;
  const ai = s.ai.slice(0, n);
  for (let i = ai.length; i < n; i++) ai.push(newAiMemory(DIFFICULTIES[DEFAULT_DIFFICULTY].firstAttack));
  const out: GameState = { ...(s as GameState), units, mapW, mapH, teams: normaliseTeams(s.teams, n), ai };
  migrateAir(out);
  if (s.powers !== undefined) {
    if (Array.isArray(s.powers)) {
      out.powers = sidesOf(out).map(o => (s.powers![o] && typeof s.powers![o] === 'object' ? { ...s.powers![o] } : {}));
    } else delete out.powers;
  }
  if (s.blackoutUntil !== undefined) {
    if (Array.isArray(s.blackoutUntil)) out.blackoutUntil = sidesOf(out).map(o => (Number.isFinite(s.blackoutUntil![o]) ? s.blackoutUntil![o] : 0));
    else delete out.blackoutUntil;
  }
  // A skirmish setup, its map type and its start sites: repaired or dropped, never trusted blind.
  // A save without a setup plays as it always did (LEGACY_SETUP).
  if (s.setup !== undefined) {
    if (s.setup && typeof s.setup === 'object') out.setup = normaliseSetup(s.setup, LEGACY_SETUP);
    else delete out.setup;
  }
  if (s.mapType !== undefined && !MAP_TYPES.includes(s.mapType)) delete out.mapType;
  if (s.starts !== undefined) {
    const okSite = (p: unknown) =>
      !!p && typeof p === 'object' && Number.isInteger((p as { x: number }).x) && Number.isInteger((p as { y: number }).y);
    if (Array.isArray(s.starts) && s.starts.length === n && s.starts.every(okSite)) out.starts = s.starts.map(p => ({ ...p }));
    else delete out.starts;
  }
  // round5:D begin. Neutral sites: s.sites repaired or dropped, never trusted blind.
  if (s.sites !== undefined) {
    const sites = migrateSites(s.sites, out);
    if (sites) out.sites = sites;
    else delete out.sites;
  }
  // round5:D end.
  // Round 6: a side's army, its perks, and squads, repaired or dropped, never trusted blind.
  migrateRound6(s, out);
  // Only two sides may fall back on the original start sites.
  if (n > 2 && !out.starts) return null;
  // A campaign battle: its mission must at least have its objective lists, or it is not trusted.
  if (s.mission !== undefined && s.mission !== null) {
    const m = s.mission as Partial<MissionRuntime>;
    if (typeof m !== 'object' || !Array.isArray(m.objectives) || !Array.isArray(m.bonus)) return null;
    out.mission = {
      ...(m as MissionRuntime),
      fired: Array.isArray(m.fired) ? m.fired.filter(n => Number.isInteger(n)) : [],
      timeLimit: Number.isFinite(m.timeLimit) ? m.timeLimit! : null,
      result: m.result === 'won' || m.result === 'lost' ? m.result : null,
    };
  }
  return out;
}

export { idx };

const isPerks = (p: unknown): p is Perks =>
  !!p &&
  typeof p === 'object' &&
  (['harvestMul', 'buildSpeedMul', 'costMul', 'unitHpMul', 'powerCooldownMul', 'extraStartCredits'] as const).every(k =>
    Number.isFinite((p as Perks)[k]),
  );

/**
 * Round 6 groundwork, on the copy migrateState builds: an unknown army on a player is dropped (it
 * reads as 'meridian'); `sidePerks` keeps well-formed perks for sides 1 to n - 1 only; `squads` keeps
 * well-formed squads (known shape, integer ids, its leader among its members) and a unit's `squad`
 * is dropped unless it names one of them. A state without any of these is left exactly as it was.
 */
function migrateRound6(raw: Partial<GameState>, out: GameState): void {
  if (out.players.some(p => p.faction !== undefined && !isFaction(p.faction))) {
    out.players = out.players.map(p => {
      if (p.faction === undefined || isFaction(p.faction)) return p;
      const { faction: _junk, ...rest } = p;
      return rest;
    });
  }
  if (raw.sidePerks !== undefined) {
    const kept: Partial<Record<Owner, Perks>> = {};
    let any = false;
    if (raw.sidePerks && typeof raw.sidePerks === 'object') {
      for (const o of sidesOf(out)) {
        const p = (raw.sidePerks as Record<number, unknown>)[o];
        if (o === 0 || !isPerks(p)) continue;
        kept[o] = { ...p };
        any = true;
      }
    }
    if (any) out.sidePerks = kept;
    else delete out.sidePerks;
  }
  const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
  const squadIds = new Set<number>();
  if (raw.squads !== undefined) {
    const squads: Squad[] = [];
    if (Array.isArray(raw.squads)) {
      for (const q of raw.squads as Partial<Squad>[]) {
        if (!q || typeof q !== 'object' || !isId(q.id) || !isId(q.leader) || squadIds.has(q.id)) continue;
        if (!FORMATION_SHAPES.includes(q.shape as FormationShape) || !Array.isArray(q.members)) continue;
        const members = q.members.filter(isId);
        if (!members.includes(q.leader)) continue;
        squads.push({ ...(q as Squad), members });
        squadIds.add(q.id);
      }
    }
    if (squads.length) out.squads = squads;
    else delete out.squads;
  }
  if (out.units.some(u => u.squad !== undefined && !squadIds.has(u.squad))) {
    out.units = out.units.map(u => {
      if (u.squad === undefined || squadIds.has(u.squad)) return u;
      const c = { ...u };
      delete c.squad;
      return c;
    });
  }
  // round6:B begin. Heroes in free play: its PlayerState and Unit fields repaired or dropped.
  // round6:B end.
  // round6:C begin. Generals: its PlayerState and Unit fields repaired or dropped.
  // round6:C end.
  // round6:D begin. Formations and squads: anything more on squads (dead members, a fallen leader).
  // round6:D end.
}
