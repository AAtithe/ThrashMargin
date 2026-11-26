/**
 * The build window's plan (fireline-round8-build-window.md): structure groups and the hotkey lists
 * they give, where each item sits (buildable now, one step away, later), unit roles and counters,
 * and the advisor's one suggestion. Pure: reads the battle, changes nothing. No clock, no dice.
 */
import { BUILDINGS, DAMAGE_VS, PRODUCER, UNITS, hitsAir, hitsGround, hitsNaval, type Armor, type BuildingKind, type Category, type UnitKind } from '../sim/rules';
import { factionOf, unitSpecFor } from '../sim/specs';
import { hasBuilding, powerOf, techAllowed, unlocked } from '../sim/state';
import { hasUpgrade } from '../sim/research';
import type { GameState } from '../sim/types';
import { hasSea, menuFor, tabsFor, type Tab } from './Sidebar';

export type Kind = BuildingKind | UnitKind;

// ---- Structure groups ---------------------------------------------------------------------------

export type Group = 'economy' | 'production' | 'defence' | 'tech';

export const GROUPS: { key: Group; label: string }[] = [
  { key: 'economy', label: 'Economy' },
  { key: 'production', label: 'Production' },
  { key: 'defence', label: 'Defence' },
  { key: 'tech', label: 'Intel and Tech' },
];

export const groupLabel = (g: Group): string => GROUPS.find(x => x.key === g)?.label ?? g;

/** The structures this file places by hand. Anything else is placed from its data (groupOf). */
const GROUP_OF: Partial<Record<BuildingKind, Group>> = {
  power: 'economy',
  refinery: 'economy',
  supplycache: 'economy',
  fuelwell: 'economy',
  foundry: 'economy',
  depot: 'economy',
  quarters: 'economy',
  barracks: 'production',
  factory: 'production',
  helipad: 'production',
  shipyard: 'production',
  academy: 'production',
  repairbay: 'production',
  turret: 'defence',
  rocketturret: 'defence',
  flakcannon: 'defence',
  wall: 'defence',
  bunker: 'defence',
  pointdefence: 'defence',
  fortress: 'defence',
  decoy: 'defence',
  uplink: 'tech',
  techcentre: 'tech',
  researchlab: 'tech',
  protoworks: 'tech',
  strikecommand: 'tech',
  intelcentre: 'tech',
  watchtower: 'tech',
};

/** A structure's group: the table above, else from its data (a weapon or wall, a producer, power). */
export function groupOf(kind: string): Group {
  const set = GROUP_OF[kind as BuildingKind];
  if (set) return set;
  const b = BUILDINGS[kind as BuildingKind];
  if (!b) return 'tech';
  if (b.weapon || b.wall) return 'defence';
  if ((Object.values(PRODUCER) as string[]).includes(kind)) return 'production';
  if (b.power > 0) return 'economy';
  return 'tech';
}

/** The groups this battle's Structures list has anything in, in GROUPS order. */
export function groupsFor(state?: GameState): Group[] {
  const menu = menuFor('building', state);
  return GROUPS.map(g => g.key).filter(g => menu.some(k => groupOf(k) === g));
}

/**
 * The list the hotkeys act on: the active group's structures, or a unit tab's whole list, always
 * in menu order (unlocking never moves a key).
 */
export function keyedList(state: GameState | undefined, tab: Tab, group: Group): Kind[] {
  const menu = menuFor(tab, state);
  return tab === 'building' ? menu.filter(k => groupOf(k) === group) : menu;
}

/** One stop on the Tab key's walk: each structure group, then each other tab. */
export interface Stop {
  tab: Tab;
  group: Group;
}

/** The next (or, with `back`, previous) stop after the open one. */
export function nextStop(state: GameState, tab: Tab, group: Group, back: boolean): Stop {
  const stops: Stop[] = [];
  const groups = groupsFor(state);
  for (const t of tabsFor(state)) {
    if (t === 'building') for (const g of groups) stops.push({ tab: t, group: g });
    else stops.push({ tab: t, group });
  }
  if (!stops.length) return { tab, group };
  let i = stops.findIndex(s => s.tab === tab && (tab !== 'building' || s.group === group));
  if (i < 0) i = 0;
  const n = stops[(i + (back ? stops.length - 1 : 1)) % stops.length];
  // Leaving Structures keeps the group it was on, so coming back lands there again.
  return n.tab === 'building' ? n : { tab: n.tab, group };
}

// ---- Where each item sits -------------------------------------------------------------------------

/** The structures an item still needs (the Command Yard left out). */
export function missingFor(state: GameState, kind: Kind): BuildingKind[] {
  const spec = kind in BUILDINGS ? BUILDINGS[kind as BuildingKind] : UNITS[kind as UnitKind];
  return spec.requires.filter(r => r !== 'hq' && !hasBuilding(state, 0, r));
}

/** Point Defence waits for its doctrine as well as its structures (round 7). */
export const doctrineLocked = (state: GameState, kind: Kind): boolean => kind === 'pointdefence' && !hasUpgrade(state, 0, 'pointdef');

/** Buildable as far as requirements go (money and queues aside). */
export const isOpen = (state: GameState, kind: Kind): boolean => unlocked(state, 0, kind) && !doctrineLocked(state, kind);

export interface NextRow {
  /** The structures to build, each buildable now. */
  needs: BuildingKind[];
  items: Kind[];
}

export interface TabPlan {
  now: Kind[];
  next: NextRow[];
  later: Kind[];
}

/**
 * Splits a list: what can be built now; what one more round of building unlocks, grouped by what
 * that round is; and the rest. Menu order is kept within each.
 */
export function planList(state: GameState, items: readonly Kind[]): TabPlan {
  const now: Kind[] = [];
  const later: Kind[] = [];
  const rows = new Map<string, NextRow>();
  for (const k of items) {
    if (isOpen(state, k)) {
      now.push(k);
      continue;
    }
    const missing = missingFor(state, k);
    const step = missing.length > 0 && missing.every(r => isOpen(state, r) && techAllowed(state, 0, r));
    if (!step) {
      later.push(k);
      continue;
    }
    const key = missing.join('+');
    const row = rows.get(key) ?? { needs: missing, items: [] };
    row.items.push(k);
    rows.set(key, row);
  }
  // Fewest structures to build first.
  const next = [...rows.values()].sort((a, b) => a.needs.length - b.needs.length);
  return { now, next, later };
}

/** Every kind buildable now on every tab this battle has, for the unlock watch. */
export function openKinds(state: GameState): Set<Kind> {
  const out = new Set<Kind>();
  for (const t of tabsFor(state)) for (const k of menuFor(t, state)) if (isOpen(state, k)) out.add(k);
  return out;
}

/** Changes only when what side 0 has standing (by kind) or has researched changes. */
export function standingKey(state: GameState): string {
  const kinds = new Set<string>();
  for (const b of state.buildings) if (b.owner === 0 && b.hp > 0) kinds.add(b.kind);
  return `${[...kinds].sort().join(',')}|${(state.players[0].upgrades ?? []).join(',')}`;
}

// ---- Roles and counters ---------------------------------------------------------------------------

export type Role = 'infantry' | 'armour' | 'air' | 'structures' | 'ships' | 'support';

export const ROLE_LABEL: Record<Role, string> = {
  infantry: 'vs infantry',
  armour: 'vs armour',
  air: 'vs air',
  structures: 'vs structures',
  ships: 'vs ships',
  support: 'Support',
};

/** Up to two things a unit is good against, from its weapon and the armour table. */
export function rolesOf(state: GameState, kind: UnitKind): Role[] {
  const w = unitSpecFor(factionOf(state, 0), kind).weapon;
  if (!w) return ['support'];
  const vs = DAMAGE_VS[w.kind];
  // Listed in the order a tie is settled: what the player most needs to know first.
  const scores: [Role, number][] = [];
  if (hitsAir(w) && w.kind !== 'bullet') scores.push(['air', vs.aircraft]);
  if (hitsGround(w)) {
    scores.push(['armour', Math.max(vs.light, vs.heavy)]);
    scores.push(['infantry', vs.infantry]);
  }
  if (hitsNaval(w) && hasSea(state)) scores.push(['ships', vs.ship]);
  if (hitsGround(w)) scores.push(['structures', vs.building * 0.9]);
  const ranked = scores.map((s, i) => ({ role: s[0], v: s[1], i })).sort((a, b) => b.v - a.v || a.i - b.i);
  const strong = ranked.filter(r => r.v >= 0.9).slice(0, 2).map(r => r.role);
  if (strong.length) return strong;
  return ranked.length && ranked[0].v > 0 ? [ranked[0].role] : ['support'];
}

/** The armour class the player has seen most of among enemy units, or null with nothing seen. */
export function scoutedArmor(seen: Readonly<Record<string, number>>): Armor | null {
  const by = new Map<Armor, number>();
  for (const [kind, n] of Object.entries(seen)) {
    const spec = UNITS[kind as UnitKind];
    if (!spec || n <= 0) continue;
    by.set(spec.armor, (by.get(spec.armor) ?? 0) + n);
  }
  let best: Armor | null = null;
  let most = 0;
  for (const [a, n] of by) if (n > most) [best, most] = [a, n];
  return best;
}

/** True when a unit hits that armour class at full effect or better. */
export function counters(state: GameState, kind: UnitKind, armor: Armor | null): boolean {
  if (!armor) return false;
  const w = unitSpecFor(factionOf(state, 0), kind).weapon;
  if (!w) return false;
  const reach = armor === 'aircraft' ? hitsAir(w) : armor === 'ship' ? hitsNaval(w) : hitsGround(w);
  return reach && DAMAGE_VS[w.kind][armor] >= 1;
}

/** Plain words for an armour class, for the counter badge's title. */
export const ARMOR_WORDS: Record<Armor, string> = {
  infantry: 'infantry',
  light: 'light vehicles',
  heavy: 'heavy armour',
  building: 'structures',
  aircraft: 'aircraft',
  ship: 'ships',
};

// ---- Advisor ------------------------------------------------------------------------------------

export interface Advice {
  kind: Kind;
  tab: Category;
  reason: string;
}

/**
 * One sensible next item, or null. Only something buildable now, allowed in this battle and not
 * already queued; a structure only while no structure is under way.
 */
export function advise(state: GameState, seen: Readonly<Record<string, number>>): Advice | null {
  const p = state.players[0];
  const can = (kind: Kind, tab: Category) =>
    menuFor(tab, state).includes(kind) && isOpen(state, kind) && techAllowed(state, 0, kind) && !p.queues[tab].some(q => q.kind === kind);
  const structureFree = p.queues.building.length === 0;
  const build = (kind: BuildingKind, reason: string): Advice | null => (structureFree && can(kind, 'building') ? { kind, tab: 'building', reason } : null);
  const own = (k: string) => state.buildings.filter(b => b.owner === 0 && b.hp > 0 && b.kind === k).length;
  if (!state.buildings.some(b => b.owner === 0 && b.kind === 'hq')) return null;

  const pw = powerOf(state, 0);
  const tips: (() => Advice | null)[] = [
    () => (pw.low || pw.made - pw.used < 25 ? build('power', pw.low ? 'Power is short: everything builds at half speed.' : 'Power is nearly used up.') : null),
    () => (!own('refinery') ? build('refinery', 'No refinery: nothing turns ore into credits.') : null),
    () => (!own('barracks') ? build('barracks', 'No barracks: you cannot train infantry.') : null),
    () => {
      const refineries = own('refinery');
      const haulers = state.units.filter(u => u.owner === 0 && u.kind === 'hauler').length + p.queues.vehicle.filter(q => q.kind === 'hauler').length;
      return refineries > haulers && can('hauler', 'vehicle') ? { kind: 'hauler', tab: 'vehicle', reason: 'More refineries than haulers: one would sit idle.' } : null;
    },
    () => {
      const air = Object.entries(seen).some(([k, n]) => n > 0 && UNITS[k as UnitKind]?.armor === 'aircraft');
      if (!air) return null;
      const covered =
        own('flakcannon') > 0 ||
        state.units.some(u => {
          if (u.owner !== 0) return false;
          const w = unitSpecFor(factionOf(state, 0), u.kind as UnitKind).weapon;
          return !!w && hitsAir(w) && w.kind !== 'bullet';
        });
      if (covered) return null;
      const flak = build('flakcannon', 'Enemy aircraft seen and nothing of yours fires at them.');
      if (flak) return flak;
      for (const tab of ['infantry', 'vehicle', 'air'] as Category[]) {
        for (const k of menuFor(tab, state)) {
          if (k in BUILDINGS) continue;
          const w = unitSpecFor(factionOf(state, 0), k as UnitKind).weapon;
          if (w && hitsAir(w) && w.kind !== 'bullet' && can(k, tab)) return { kind: k, tab, reason: 'Enemy aircraft seen and nothing of yours fires at them.' };
        }
      }
      return null;
    },
    () => (!own('factory') ? build('factory', 'No war factory: no tanks, and no more haulers.') : null),
    () => (p.credits >= 2500 && !own('techcentre') ? build('techcentre', 'Credits are piling up: a Tech Centre opens stronger units.') : null),
  ];
  for (const t of tips) {
    const a = t();
    if (a) return a;
  }
  return null;
}

/** "in 14s", "in 2m 5s", or "no income" for a shortfall at a rate in credits per second. */
export function affordWords(short: number, perSecond: number | null): string | null {
  if (short <= 0) return null;
  if (perSecond === null) return null;
  if (perSecond <= 0) return 'no income';
  const s = Math.ceil(short / perSecond);
  if (s > 600) return 'in 10m+';
  return s >= 60 ? `in ${Math.floor(s / 60)}m ${s % 60}s` : `in ${s}s`;
}
