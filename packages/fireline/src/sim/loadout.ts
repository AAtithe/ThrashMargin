import {
  FUEL_TANK_SPEED,
  HAULER_CAPACITY,
  LONG_BARREL_RANGE,
  LONG_BARREL_WEAPON,
  MODULES,
  MODULE_ORDER,
  MODULE_SLOTS,
  ORE_CAGE_CARGO,
  TRACKS_HP,
  UNITS,
  type ModuleId,
  type Owner,
  type UnitKind,
  type Weapon,
} from './rules';
import { costFor, maxHpOf, researchModeOf, techAllowed } from './state';
import { unitSpecOf } from './specs';
import type { GameState, QueueItem, Unit } from './types';

/**
 * Vehicle loadouts (fireline-round5b-design.md, section 4.3). In a development-lines battle each
 * side sets, per vehicle kind, the modules every new one is built with. The loadout is copied onto
 * the queue item when it is queued (with the price paid for it) and onto the unit when it leaves
 * the factory; a unit never changes its modules after that, and changing a loadout touches only
 * what is queued afterwards. Infantry, aircraft, heroes and structures never carry modules.
 */

const isModule = (v: unknown): v is ModuleId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(MODULES, v);
const isUnitKind = (v: unknown): v is UnitKind => typeof v === 'string' && Object.prototype.hasOwnProperty.call(UNITS, v);

const sameList = (a: readonly ModuleId[], b: readonly ModuleId[]): boolean => a.length === b.length && a.every((m, i) => m === b[i]);

/** Why this side cannot set this loadout for this kind now, or null. */
export function loadoutProblem(s: GameState, owner: Owner, kind: UnitKind, modules: ModuleId[]): string | null {
  if (researchModeOf(s) !== 'lines' || !isUnitKind(kind) || !techAllowed(s, owner, kind)) return 'Not in this battle';
  const slots = MODULE_SLOTS[kind];
  if (!slots || UNITS[kind].hero) return 'No modules';
  if (!Array.isArray(modules) || modules.length > slots) return 'Bad loadout';
  for (let i = 0; i < modules.length; i++) {
    if (!isModule(modules[i]) || modules.indexOf(modules[i]) !== i) return 'Bad loadout';
  }
  if (modules.some(m => !MODULES[m].fits.includes(kind))) return 'Does not fit';
  const ups = s.players[owner].upgrades ?? [];
  if (modules.some(m => !ups.includes(MODULES[m].unlock))) return 'Not researched';
  if (sameList(modules, s.players[owner].loadouts?.[kind] ?? [])) return 'No change';
  return null;
}

/** Sets the loadout ([] is stored as [], not deleted). */
export function doLoadout(s: GameState, owner: Owner, kind: UnitKind, modules: ModuleId[]): void {
  const p = s.players[owner];
  p.loadouts = { ...(p.loadouts ?? {}), [kind]: [...modules] };
}

const NONE: ModuleId[] = [];

/** This side's loadout for this kind: [] when absent or the battle is not a lines one. Do not mutate. */
export const loadoutOf = (s: GameState, owner: Owner, kind: UnitKind): ModuleId[] =>
  researchModeOf(s) === 'lines' ? s.players[owner]?.loadouts?.[kind] ?? NONE : NONE;

/** What these modules add to a unit's price. */
export const loadoutCost = (mods: readonly ModuleId[]): number => {
  let n = 0;
  for (const m of mods) n += MODULES[m].cost;
  return n;
};

/** The full price of queuing one of this kind now: costFor plus the current loadout's modules. */
export function queueCostFor(s: GameState, owner: Owner, kind: UnitKind): number {
  const base = costFor(s, owner, kind);
  if (!isUnitKind(kind) || UNITS[kind].category !== 'vehicle') return base;
  return base + loadoutCost(loadoutOf(s, owner, kind));
}

/** Called right after upgradeNewUnit on a unit leaving the vehicle queue. */
export function fitModules(u: Unit, mods: ModuleId[] | undefined): void {
  if (!mods || !mods.length) return;
  u.modules = [...mods];
  if (mods.includes('tracks')) {
    u.maxHp = Math.max(1, Math.round(maxHpOf(u) * TRACKS_HP));
    u.hp = u.maxHp;
  }
}

/** Another army's weapon with a long barrel, built once per weapon object (constant data, as LONG_BARREL_WEAPON). */
const longBarrels = new Map<Weapon, Weapon>();

/**
 * This unit's weapon, its army's (round 6: unitSpecOf, so an army's overlay counts), a long barrel
 * included. Meridian's weapon is the catalogue's own object, so it takes LONG_BARREL_WEAPON exactly
 * as before; another army's weapon for a kind the barrel fits gets the same range added to its own.
 */
export const weaponOf = (s: GameState, u: Unit): Weapon | undefined => {
  const w = unitSpecOf(s, u).weapon;
  if (!w || !u.modules || !u.modules.includes('longbarrel')) return w;
  if (w === UNITS[u.kind].weapon) return LONG_BARREL_WEAPON[u.kind] ?? w;
  if (!MODULES.longbarrel.fits.includes(u.kind)) return w;
  let lb = longBarrels.get(w);
  if (!lb) {
    lb = { ...w, range: w.range + LONG_BARREL_RANGE };
    longBarrels.set(w, lb);
  }
  return lb;
};

/** Multiplier on this unit's speed from its modules (Extra fuel tank). */
export const moduleSpeedOf = (u: Unit): number => (u.modules && u.modules.includes('fueltank') ? FUEL_TANK_SPEED : 1);

/** Ore this hauler can carry (Ore cage). */
export const cargoMaxOf = (u: Unit): number =>
  u.modules && u.modules.includes('orecage') ? Math.round(HAULER_CAPACITY * ORE_CAGE_CARGO) : HAULER_CAPACITY;

/** Known, deduplicated modules that fit this kind, in the order given, capped at its slots. */
function cleanModules(kind: unknown, raw: unknown): ModuleId[] {
  if (!isUnitKind(kind) || !Array.isArray(raw)) return [];
  const slots = UNITS[kind].hero ? 0 : MODULE_SLOTS[kind] ?? 0;
  const out: ModuleId[] = [];
  for (const m of raw) {
    if (out.length >= slots) break;
    if (isModule(m) && !out.includes(m) && MODULES[m].fits.includes(kind)) out.push(m);
  }
  return out;
}

/**
 * Repairs loadouts, queue items' modules and units' modules from a save. Called from migrateAir
 * once the players are repaired, on the copy migrateState builds. A 'classic' battle carries none of
 * them; it never re-applies Reinforced tracks (the unit's saved maxHp already holds it).
 */
export function migrateLoadouts(s: GameState): void {
  const lines = researchModeOf(s) === 'lines';
  for (const u of s.units) {
    if (u.modules === undefined) continue;
    const mods = lines ? cleanModules(u.kind, u.modules) : [];
    if (mods.length) u.modules = mods;
    else delete u.modules;
  }
  s.players = s.players.map(p => {
    let changed = false;
    const fixQueue = (list: QueueItem[]): QueueItem[] =>
      list.map(q => {
        if (!q || typeof q !== 'object' || (q.modules === undefined && q.extra === undefined)) return q;
        changed = true;
        const out: QueueItem = { ...q };
        const mods = lines ? cleanModules(q.kind, q.modules) : [];
        if (mods.length) {
          out.modules = mods;
          if (!(Number.isFinite(q.extra) && (q.extra as number) >= 0)) out.extra = loadoutCost(mods);
        } else {
          delete out.modules;
          delete out.extra;
        }
        return out;
      });
    const queues = {
      ...p.queues,
      building: fixQueue(p.queues.building),
      infantry: fixQueue(p.queues.infantry),
      vehicle: fixQueue(p.queues.vehicle),
      air: fixQueue(p.queues.air),
    };
    const out = changed ? { ...p, queues } : { ...p };
    if (p.loadouts !== undefined) {
      if (lines && p.loadouts && typeof p.loadouts === 'object') {
        const fixed: Partial<Record<UnitKind, ModuleId[]>> = {};
        for (const [kind, mods] of Object.entries(p.loadouts as Record<string, unknown>)) {
          if (!isUnitKind(kind) || !MODULE_SLOTS[kind] || !Array.isArray(mods)) continue;
          fixed[kind] = cleanModules(kind, mods);
        }
        out.loadouts = fixed;
      } else delete out.loadouts;
    }
    return out;
  });
}

/** Modules in MODULE_ORDER, for display and for the toggling the interface does. */
export const inModuleOrder = (mods: readonly ModuleId[]): ModuleId[] => MODULE_ORDER.filter(m => mods.includes(m));
