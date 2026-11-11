/**
 * The build window's tree, worked out from data alone (fireline-round5-design.md, section 3).
 *
 * An item's tier is 0 when it needs nothing, or only the Command Yard; otherwise one more than the
 * highest tier among the structures it needs, where a structure's own tier comes the same way from
 * its own requirements. Nothing here names a kind: names, costs, requirements and lists all come
 * from rules.ts through a `Catalogue`, so a kind added to the rules (or, in a test, to a copy of
 * the menus) is laid out without this file changing.
 */
import { BUILDINGS, FACTIONS, MENUS, UNITS, type BuildingKind, type Category, type Faction, type UnitKind } from '../sim/rules';
import { buildingSpecFor, menuOf, unitSpecFor } from '../sim/specs';

/** What the window needs to know about one item. */
export interface ItemSpec {
  name: string;
  cost: number;
  requires: readonly string[];
}

/** Where the window reads its lists and specs: the rules, or a copy of them with test items added. */
export interface Catalogue {
  menus: Record<Category, readonly string[]>;
  spec: (kind: string) => ItemSpec | null;
  /** True for a structure (a kind other items can require). */
  isStructure: (kind: string) => boolean;
}

/** Every queue's list, the naval war's included (merge): read from MENUS so a new tab is never left out. */
const CATEGORIES = Object.keys(MENUS) as Category[];

/** The real rules, as one army fields them: its own build lists (menuOf) and its own numbers. */
function makeCatalogue(faction: Faction): Catalogue {
  const menus = {} as Record<Category, readonly string[]>;
  for (const c of CATEGORIES) menus[c] = menuOf(faction, c);
  return {
    menus,
    spec: kind =>
      kind in BUILDINGS
        ? buildingSpecFor(faction, kind as BuildingKind)
        : kind in UNITS
          ? unitSpecFor(faction, kind as UnitKind)
          : null,
    isStructure: kind => kind in BUILDINGS,
  };
}
const CATALOGUES = Object.fromEntries(FACTIONS.map(f => [f, makeCatalogue(f)])) as Record<Faction, Catalogue>;

/** The real rules for an army (round 6, workstream A). Made once per army; the same object every time. */
export const rulesCatalogue = (faction: Faction): Catalogue => CATALOGUES[faction];

/**
 * A test-only extra item (`window.__flExtraMenuItem`), honoured in development builds alone. It
 * proves the window lays out a kind it has never seen.
 */
export interface ExtraItem {
  tab: Category;
  kind: string;
  name: string;
  cost: number;
  requires: string[];
  structure?: boolean;
}

/** The rules with extra items appended to copies of their lists. */
export function withExtras(base: Catalogue, extras: readonly ExtraItem[]): Catalogue {
  if (!extras.length) return base;
  const menus = { ...base.menus } as Record<Category, readonly string[]>;
  for (const x of extras) menus[x.tab] = [...(menus[x.tab] ?? []), x.kind];
  return {
    menus,
    spec: kind => {
      const x = extras.find(e => e.kind === kind);
      return x ? { name: x.name, cost: x.cost, requires: x.requires } : base.spec(kind);
    },
    isStructure: kind => {
      const x = extras.find(e => e.kind === kind);
      return x ? !!x.structure || x.tab === 'building' : base.isStructure(kind);
    },
  };
}

/** The structures an item needs, the Command Yard left out (every base starts with one). */
export function needsOf(cat: Catalogue, kind: string): string[] {
  return (cat.spec(kind)?.requires ?? []).filter(r => r !== 'hq');
}

/** Tiers of every kind asked about, memoised per catalogue; a cycle (no data has one) counts as 0. */
export function tierFinder(cat: Catalogue): (kind: string) => number {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const tier = (kind: string): number => {
    const hit = memo.get(kind);
    if (hit !== undefined) return hit;
    if (visiting.has(kind)) return 0;
    const need = needsOf(cat, kind);
    if (!need.length) {
      memo.set(kind, 0);
      return 0;
    }
    visiting.add(kind);
    const t = 1 + Math.max(...need.map(tier));
    visiting.delete(kind);
    memo.set(kind, t);
    return t;
  };
  return tier;
}

export interface TreeColumn {
  tier: number;
  items: string[];
}

export interface TreeLayout {
  /** Structures this tab's items need that live on another tab: drawn as small ghost nodes first. */
  ghosts: string[];
  /** The tab's items by tier, lowest first; within a tier, menu order. */
  columns: TreeColumn[];
  /** One line per requirement: from the item to the structure it needs (on this tab, or a ghost). */
  edges: { from: string; to: string }[];
}

/** Lay out the given items (already filtered to what the battle allows), in menu order. */
export function layoutTree(cat: Catalogue, items: readonly string[]): TreeLayout {
  const tier = tierFinder(cat);
  const here = new Set(items);
  const byTier = new Map<number, string[]>();
  for (const k of items) {
    const t = tier(k);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t)!.push(k);
  }
  const columns = [...byTier.entries()].sort((a, b) => a[0] - b[0]).map(([t, list]) => ({ tier: t, items: list }));
  const ghosts: string[] = [];
  const edges: { from: string; to: string }[] = [];
  for (const k of items) {
    for (const r of needsOf(cat, k)) {
      if (!here.has(r) && !ghosts.includes(r)) ghosts.push(r);
      edges.push({ from: k, to: r });
    }
  }
  // Ghosts in tier order, so the left-hand column reads the way the tree does.
  ghosts.sort((a, b) => tier(a) - tier(b));
  return { ghosts, columns, edges };
}
