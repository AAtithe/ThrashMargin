import { generateMap, idx } from './map';
import { seedFromString } from './rng';
import {
  BUILDINGS,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  MAP_H,
  MAP_W,
  PRODUCER,
  SIDE_NAMES,
  START_CREDITS,
  UNITS,
  type BuildingKind,
  type Category,
  type Difficulty,
  type Owner,
  type UnitKind,
} from './rules';
import type { Building, GameState, PlayerState, Unit } from './types';

export interface NewGameOptions {
  seed?: string;
  difficulty?: Difficulty;
  createdAt: number;
  /** Test harness only: the computer plays both sides. */
  autopilot?: boolean;
}

function newPlayer(owner: Owner): PlayerState {
  return {
    owner,
    name: SIDE_NAMES[owner],
    credits: START_CREDITS,
    queues: { building: [], infantry: [], vehicle: [] },
    stats: { built: 0, trained: 0, lost: 0, killed: 0, harvested: 0 },
  };
}

export function createInitialState(id: string, name: string, opts: NewGameOptions): GameState {
  const seedText = opts.seed && opts.seed.trim() ? opts.seed.trim().slice(0, 64) : `${id}`;
  const rngSeed = seedFromString(seedText);
  const map = generateMap(rngSeed);
  const difficulty = opts.difficulty && opts.difficulty in DIFFICULTIES ? opts.difficulty : DEFAULT_DIFFICULTY;
  const d = DIFFICULTIES[difficulty];

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
    explored: '0'.repeat(MAP_W * MAP_H),
    units: [],
    buildings: [],
    players: [newPlayer(0), newPlayer(1)],
    projectiles: [],
    effects: [],
    ai: [
      { nextAttack: d.firstAttack, wave: 0, hurtTick: -9999, hurtX: 0, hurtY: 0, waveIds: [], wavePhase: 0, waveTick: 0, waveSize: 0, raidIds: [], raidTarget: 0, nextRaid: 0 },
      { nextAttack: d.firstAttack, wave: 0, hurtTick: -9999, hurtX: 0, hurtY: 0, waveIds: [], wavePhase: 0, waveTick: 0, waveSize: 0, raidIds: [], raidTarget: 0, nextRaid: 0 },
    ],
    autopilot: !!opts.autopilot,
    nextId: 1,
    winner: null,
    log: [{ tick: 0, text: 'Battlefield control established. Build a Generator, then a Refinery.', tone: 'info' }],
    alarms: {},
  };

  for (const owner of [0, 1] as Owner[]) {
    const st = map.starts[owner];
    addBuilding(s, owner, 'hq', st.x, st.y, -100);
    // Three riflemen beside the yard, on the side facing the middle of the map.
    const dir = owner === 0 ? 1 : -1;
    for (let i = 0; i < 3; i++) {
      addUnit(s, owner, 'rifleman', st.x + 1.5 + dir * (i - 1) * 0.9, st.y + 1.5 - dir * 2.6);
    }
  }
  updateExplored(s);
  return s;
}

export function addBuilding(s: GameState, owner: Owner, kind: BuildingKind, x: number, y: number, placedAt = s.tick): Building {
  const b: Building = {
    id: s.nextId++,
    owner,
    kind,
    x,
    y,
    hp: BUILDINGS[kind].hp,
    placedAt,
    repairing: false,
    rally: null,
    cooldown: 0,
    engage: 0,
    tx: owner === 0 ? 0.7071 : -0.7071,
    ty: owner === 0 ? -0.7071 : 0.7071,
  };
  s.buildings.push(b);
  return b;
}

export function addUnit(s: GameState, owner: Owner, kind: UnitKind, x: number, y: number): Unit {
  const fy = owner === 0 ? -1 : 1;
  const u: Unit = {
    id: s.nextId++,
    owner,
    kind,
    x,
    y,
    hp: UNITS[kind].hp,
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
  };
  s.units.push(u);
  return u;
}

/**
 * The one copy an action makes. Everything the reducer can change is copied; `tiles` never changes
 * and is shared. Effects, projectiles and log entries are never edited after creation, so copying
 * their arrays is enough.
 */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    ore: s.ore.slice(),
    units: s.units.map(u => ({ ...u, order: { ...u.order }, path: u.path.slice() })),
    buildings: s.buildings.map(b => ({ ...b, rally: b.rally ? { ...b.rally } : null })),
    players: s.players.map(p => ({
      ...p,
      queues: {
        building: p.queues.building.map(q => ({ ...q })),
        infantry: p.queues.infantry.map(q => ({ ...q })),
        vehicle: p.queues.vehicle.map(q => ({ ...q })),
      },
      stats: { ...p.stats },
    })) as [PlayerState, PlayerState],
    projectiles: s.projectiles.slice(),
    effects: s.effects.slice(),
    ai: s.ai.map(a => ({ ...a })) as GameState['ai'],
    log: s.log.slice(),
    alarms: { ...s.alarms },
  };
}

export function powerOf(s: GameState, owner: Owner): { made: number; used: number; low: boolean } {
  let made = 0;
  let used = 0;
  for (const b of s.buildings) {
    if (b.owner !== owner) continue;
    const p = BUILDINGS[b.kind].power;
    if (p > 0) made += Math.round(p * Math.max(0.5, b.hp / BUILDINGS[b.kind].hp));
    else used -= p;
  }
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
  const req = kind in BUILDINGS ? BUILDINGS[kind as BuildingKind].requires : UNITS[kind as UnitKind].requires;
  return req.every(r => hasBuilding(s, owner, r));
}

export function categoryOf(kind: BuildingKind | UnitKind): Category {
  if (kind in BUILDINGS) return 'building';
  return UNITS[kind as UnitKind].category;
}

export function costOf(kind: BuildingKind | UnitKind): number {
  return kind in BUILDINGS ? BUILDINGS[kind as BuildingKind].cost : UNITS[kind as UnitKind].cost;
}

export function buildTicksOf(kind: BuildingKind | UnitKind): number {
  return kind in BUILDINGS ? BUILDINGS[kind as BuildingKind].buildTicks : UNITS[kind as UnitKind].buildTicks;
}

/** The structure a queue's finished item comes out of (lowest id wins when there are several). */
export function producerFor(s: GameState, owner: Owner, category: Category): Building | undefined {
  const kind = PRODUCER[category];
  let found: Building | undefined;
  for (const b of s.buildings) if (b.owner === owner && b.kind === kind && (!found || b.id < found.id)) found = b;
  return found;
}

/** A finished structure waiting to be placed, if any. */
export function readyStructure(s: GameState, owner: Owner): BuildingKind | null {
  const head = s.players[owner].queues.building[0];
  if (!head) return null;
  return head.progress >= buildTicksOf(head.kind) ? (head.kind as BuildingKind) : null;
}

/** Every tile within sight of something side `owner` owns. */
export function visibility(s: GameState, owner: Owner): Uint8Array {
  const MW = MAP_W;
  const MH = MAP_H;
  const vis = new Uint8Array(MW * MH);
  const mark = (cx: number, cy: number, r: number) => {
    const r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(MH - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(MW - 1, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) vis[y * MW + x] = 1;
      }
  };
  for (const u of s.units) if (u.owner === owner) mark(u.x, u.y, UNITS[u.kind].sight);
  for (const b of s.buildings)
    if (b.owner === owner) {
      const spec = BUILDINGS[b.kind];
      mark(b.x + spec.w / 2, b.y + spec.h / 2, spec.sight + Math.max(spec.w, spec.h) / 2);
    }
  return vis;
}

/** Folds what side 0 can currently see into the explored map. */
export function updateExplored(s: GameState): void {
  const vis = visibility(s, 0);
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
 * A save from an older build is passed through this before use. There is only one shape so far;
 * anything that does not look like it is refused rather than crashing the reducer.
 */
export function migrateState(raw: unknown): GameState | null {
  const s = raw as Partial<GameState> | null;
  if (!s || typeof s !== 'object' || s.version !== 1) return null;
  if (typeof s.tiles !== 'string' || !Array.isArray(s.ore) || typeof s.explored !== 'string') return null;
  if (!Array.isArray(s.units) || !Array.isArray(s.buildings) || !Array.isArray(s.players)) return null;
  if (!Array.isArray(s.projectiles) || !Array.isArray(s.effects) || !Array.isArray(s.ai)) return null;
  return s as GameState;
}

export { idx };
