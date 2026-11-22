/**
 * Territory and workforce (2026-11-21, `setup.territory` with supply lines and industry; phase 3 of
 * the economy, fireline-design.md). Pure: computed from the structures standing, nothing stored.
 *
 * Territory. Command Yards, Field Yards, Watchtowers and Depots claim the tiles within their
 * CLAIM_RADIUS of their centre. A tile belongs to the side whose claiming structure is nearest; a tie
 * between two sides leaves it nobody's. With territory on, a structure may be placed only where every
 * tile of its footprint is yours (in place of BUILD_RADIUS).
 *
 * Workforce. Command Yards, Field Yards and Quarters house workers (HOUSING). Each structure listed in
 * CREW needs that many to work; crews go out in CREW_ORDER (economy first), lowest id first within a
 * kind, while workers remain. A structure without its crew stops: a Refinery takes no ore, a Fuel
 * Well pumps nothing, a Foundry smelts nothing, a producer builds nothing.
 *
 * Imports rules.ts, supply.ts and types only.
 */
import { BUILDINGS, CLAIM_RADIUS, CREW, CREW_ORDER, HOUSING, type BuildingKind, type Owner } from './rules';
import { supplyOn } from './supply';
import type { Building, GameState } from './types';

/** True in a skirmish with industry, supply lines and territory all on. */
export const territoryOn = (s: GameState): boolean => supplyOn(s) && s.setup?.territory === true;

/** Nobody's tile, and a tile two sides claim equally. */
export const NO_OWNER = -1;

interface Claim {
  owner: Owner;
  cx: number;
  cy: number;
  r: number;
}

function claimsOf(s: GameState): Claim[] {
  const out: Claim[] = [];
  for (const b of s.buildings) {
    const r = CLAIM_RADIUS[b.kind];
    if (!r || b.hp <= 0) continue;
    const spec = BUILDINGS[b.kind];
    out.push({ owner: b.owner, cx: b.x + spec.w / 2, cy: b.y + spec.h / 2, r });
  }
  return out;
}

/**
 * The owner of every tile (index x + y * mapW): a side, or NO_OWNER. Each claim stamps the tiles
 * whose centre lies within its radius; the nearest claim wins, and a tie between sides is nobody's.
 */
export function territoryGrid(s: GameState): Int8Array {
  // One grid remembered: placement asks hundreds of times a decision while nothing claims anew. The
  // key is everything the grid depends on, so a different battle or a moved claim recomputes it.
  const claims = claimsOf(s);
  const key = `${s.mapW}x${s.mapH}|` + claims.map(c => `${c.owner},${c.cx},${c.cy},${c.r}`).join(';');
  if (cache && cache.key === key) return cache.grid;
  const grid = computeGrid(s, claims);
  cache = { key, grid };
  return grid;
}

let cache: { key: string; grid: Int8Array } | null = null;

function computeGrid(s: GameState, claims: Claim[]): Int8Array {
  const n = s.mapW * s.mapH;
  const owner = new Int8Array(n).fill(NO_OWNER);
  const best = new Float64Array(n).fill(Infinity);
  for (const c of claims) {
    const x0 = Math.max(0, Math.floor(c.cx - c.r));
    const x1 = Math.min(s.mapW - 1, Math.ceil(c.cx + c.r));
    const y0 = Math.max(0, Math.floor(c.cy - c.r));
    const y1 = Math.min(s.mapH - 1, Math.ceil(c.cy + c.r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = (x + 0.5 - c.cx) ** 2 + (y + 0.5 - c.cy) ** 2;
        if (d > c.r * c.r) continue;
        const k = x + y * s.mapW;
        if (d < best[k]) {
          best[k] = d;
          owner[k] = c.owner;
        } else if (d === best[k] && owner[k] !== c.owner) owner[k] = NO_OWNER;
      }
  }
  return owner;
}

/** Why a structure of this kind may not stand at (x, y) for this side under territory, or null. */
export function territoryProblem(s: GameState, owner: Owner, kind: BuildingKind, x: number, y: number, grid: Int8Array = territoryGrid(s)): string | null {
  const spec = BUILDINGS[kind];
  for (let ty = y; ty < y + spec.h; ty++)
    for (let tx = x; tx < x + spec.w; tx++) if (grid[tx + ty * s.mapW] !== owner) return 'Outside your territory';
  return null;
}

/** Workers this side houses. */
export function housed(s: GameState, owner: Owner): number {
  let n = 0;
  for (const b of s.buildings) if (b.owner === owner && b.hp > 0) n += HOUSING[b.kind] ?? 0;
  return n;
}

/** Workers this side's structures ask for, all of them. */
export function crewWanted(s: GameState, owner: Owner): number {
  let n = 0;
  for (const b of s.buildings) if (b.owner === owner && b.hp > 0) n += CREW[b.kind] ?? 0;
  return n;
}

/** The ids of this side's structures that have their crew, assigned in CREW_ORDER, lowest id first. */
export function crewed(s: GameState, owner: Owner): Set<number> {
  const out = new Set<number>();
  let left = housed(s, owner);
  const wanting = s.buildings
    .filter(b => b.owner === owner && b.hp > 0 && CREW[b.kind])
    .sort((a, b) => CREW_ORDER.indexOf(a.kind) - CREW_ORDER.indexOf(b.kind) || a.id - b.id);
  for (const b of wanting) {
    const need = CREW[b.kind]!;
    if (need > left) continue;
    left -= need;
    out.add(b.id);
  }
  return out;
}

/** True when this structure can work: always without territory, or when it needs no crew or has it. */
export function staffed(s: GameState, b: Building): boolean {
  if (!territoryOn(s) || !CREW[b.kind]) return true;
  return crewed(s, b.owner).has(b.id);
}

/** This side's structures that need a crew and have none (empty without territory). */
export function unstaffed(s: GameState, owner: Owner): Building[] {
  if (!territoryOn(s)) return [];
  const ok = crewed(s, owner);
  return s.buildings.filter(b => b.owner === owner && b.hp > 0 && CREW[b.kind] && !ok.has(b.id));
}

/** Workers free once every crew that fits is assigned. */
export function freeWorkers(s: GameState, owner: Owner): number {
  const ok = crewed(s, owner);
  let used = 0;
  for (const b of s.buildings) if (ok.has(b.id)) used += CREW[b.kind] ?? 0;
  return housed(s, owner) - used;
}
