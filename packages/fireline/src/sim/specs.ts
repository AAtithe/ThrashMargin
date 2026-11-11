/**
 * Round 6 groundwork (fireline-round6-design.md): what a side's army is, and the specs, menus and
 * perks that follow from it. Every question about a unit's or structure's numbers that knows whose
 * it is asks here, never UNITS or BUILDINGS directly; catalogue code that knows no side (the build
 * window's layout, a kind's queue, a footprint) may still read the tables.
 *
 * Imports rules.ts and types only, so anything in src/sim/ can use it without a cycle.
 */
import {
  BUILDINGS,
  FACTION_MENUS,
  FACTION_OVERLAY,
  FACTIONS,
  MENUS,
  UNITS,
  type BuildingKind,
  type BuildingSpec,
  type Category,
  type Faction,
  type Owner,
  type UnitKind,
  type UnitSpec,
} from './rules';
import type { Building, GameState, Perks, Unit } from './types';

/** True for one of the armies. */
export const isFaction = (v: unknown): v is Faction => FACTIONS.includes(v as Faction);

/** This side's army: its player's `faction`, or 'meridian' when absent (every save before round 6, every mission). */
export function factionOf(s: GameState, owner: Owner): Faction {
  return s.players[owner]?.faction ?? 'meridian';
}

// Merged specs, made once per army and kind on first use. The overlays are constant data, so the
// cache holds no battle state and a replay reads the same numbers.
const unitCache: Record<Faction, Partial<Record<UnitKind, UnitSpec>>> = { meridian: {}, ashen: {} };
const buildingCache: Record<Faction, Partial<Record<BuildingKind, BuildingSpec>>> = { meridian: {}, ashen: {} };

/** A unit kind's spec for an army: UNITS[kind] with the army's overlay merged over it (shallowly). */
export function unitSpecFor(faction: Faction, kind: UnitKind): UnitSpec {
  const over = FACTION_OVERLAY[faction].units?.[kind];
  if (!over) return UNITS[kind];
  return (unitCache[faction][kind] ??= { ...UNITS[kind], ...over });
}

/** A structure kind's spec for an army: BUILDINGS[kind] with the army's overlay merged over it (shallowly). */
export function buildingSpecFor(faction: Faction, kind: BuildingKind): BuildingSpec {
  const over = FACTION_OVERLAY[faction].buildings?.[kind];
  if (!over) return BUILDINGS[kind];
  return (buildingCache[faction][kind] ??= { ...BUILDINGS[kind], ...over });
}

/** This side's spec for a unit kind. */
export const unitSpec = (s: GameState, owner: Owner, kind: UnitKind): UnitSpec => unitSpecFor(factionOf(s, owner), kind);
/** This side's spec for a structure kind. */
export const buildingSpec = (s: GameState, owner: Owner, kind: BuildingKind): BuildingSpec => buildingSpecFor(factionOf(s, owner), kind);
/** A unit's own spec, by its owner's army. */
export const unitSpecOf = (s: GameState, u: Unit): UnitSpec => unitSpecFor(factionOf(s, u.owner), u.kind);
/** A structure's own spec, by its owner's army. */
export const buildingSpecOf = (s: GameState, b: Building): BuildingSpec => buildingSpecFor(factionOf(s, b.owner), b.kind);

/** What any kind costs, takes to build and needs, for this side (structure or unit alike). */
export function kindSpec(s: GameState, owner: Owner, kind: BuildingKind | UnitKind): { cost: number; buildTicks: number; requires: BuildingKind[] } {
  return kind in BUILDINGS ? buildingSpec(s, owner, kind as BuildingKind) : unitSpec(s, owner, kind as UnitKind);
}

// Kinds some army adds to its lists: those belong to the armies that add them alone.
const added: Record<Faction, Set<BuildingKind | UnitKind>> = { meridian: new Set(), ashen: new Set() };
const removed: Record<Faction, Set<BuildingKind | UnitKind>> = { meridian: new Set(), ashen: new Set() };
const exclusive = new Set<BuildingKind | UnitKind>();
for (const f of FACTIONS) {
  for (const list of Object.values(FACTION_MENUS[f].add ?? {})) {
    for (const k of list ?? []) {
      added[f].add(k);
      exclusive.add(k);
    }
  }
  for (const k of FACTION_MENUS[f].remove ?? []) removed[f].add(k);
}

/** True when this army may field this kind at all (its menus); tech and requirements are techAllowed's and unlocked's. */
export function factionAllows(faction: Faction, kind: BuildingKind | UnitKind): boolean {
  if (removed[faction].has(kind)) return false;
  return !exclusive.has(kind) || added[faction].has(kind);
}

/** An army's build list for a queue: MENUS[category] less what it never builds, then its own additions. */
export function menuOf(faction: Faction, category: Category): readonly (BuildingKind | UnitKind)[] {
  const extra = FACTION_MENUS[faction].add?.[category];
  if (!extra?.length && !removed[faction].size) return MENUS[category];
  return [...MENUS[category].filter(k => !removed[faction].has(k)), ...(extra ?? [])];
}

/**
 * The perks this side plays with, or undefined for none. Side 0's are `s.perks` (the campaign's
 * Commander perks, and the field every save before round 6 has); sides 1 to 3 keep theirs in
 * `s.sidePerks` (round 6, workstream C's doctrine Generals), which never holds side 0.
 */
export function perksFor(s: GameState, owner: Owner): Perks | undefined {
  return owner === 0 ? s.perks : s.sidePerks?.[owner];
}
