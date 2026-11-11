import { nearestPassable } from './grid';
import { canRide, slotsOf } from './transport';
import { BUILDINGS, NAVAL_MIN_SEA, SHIPYARD_MEND_HP, SHIPYARD_MEND_RANGE, SHIPYARD_MEND_TICKS, UNITS } from './rules';
import { maxHpOf } from './state';
import type { Building, GameState, Unit } from './types';

/**
 * The naval war (2026-11-11). Advanced tech only, like air power. Ships sail open water ('w' tiles,
 * the `sea` layer of passable, nearestPassable and findPath in grid.ts) and nothing else; every
 * other unit walks land as before. Ships are ground-level for targeting: whatever hits the ground
 * hits a ship (hitsNaval), the Submarine's torpedo hits ships alone, and flak never does.
 *
 *  - The Naval Yard must stand on the shore of open sea: at least NAVAL_MIN_SHORE water tiles round
 *    its footprint, belonging to a body of at least NAVAL_MIN_SEA tiles (a pond will not do).
 *  - Ships come out on the nearest open water to it, and ships beside it are mended, free and slow.
 *  - The Landing Craft carries infantry and vehicles (transport.ts), boarding from the shore.
 */

/** True for a ship: any unit whose category is 'naval'. */
export const isShip = (u: Unit): boolean => UNITS[u.kind].category === 'naval';

/** Water tiles round a Naval Yard's footprint it needs. */
export const NAVAL_MIN_SHORE = 3;

/**
 * Why a Naval Yard cannot stand at (x, y), as far as the water goes, or null. Counts the open-water
 * tiles in the ring round the footprint, and floods from them until NAVAL_MIN_SEA tiles of water
 * are found (no further), so a pond is refused and the check stays cheap.
 */
export function shoreProblem(s: GameState, x: number, y: number): string | null {
  const spec = BUILDINGS.shipyard;
  const W = s.mapW;
  const H = s.mapH;
  const water = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < W && ty < H && s.tiles.charCodeAt(ty * W + tx) === 119;
  const ring: number[] = [];
  for (let ty = y - 1; ty <= y + spec.h; ty++)
    for (let tx = x - 1; tx <= x + spec.w; tx++) {
      const inside = tx >= x && tx < x + spec.w && ty >= y && ty < y + spec.h;
      if (!inside && water(tx, ty)) ring.push(ty * W + tx);
    }
  if (ring.length < NAVAL_MIN_SHORE) return 'Must be built on the shore';
  const seen = new Set<number>(ring);
  const stack = ring.slice();
  while (stack.length && seen.size < NAVAL_MIN_SEA) {
    const k = stack.pop()!;
    const kx = k % W;
    const ky = (k / W) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = kx + dx;
      const ny = ky + dy;
      const n = ny * W + nx;
      if (!water(nx, ny) || seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return seen.size >= NAVAL_MIN_SEA ? null : 'Needs open sea, not a pond';
}

/** Where a new ship comes out: the open water nearest the Naval Yard's middle, or -1 (all blocked). */
export function launchTile(s: GameState, occ: Int32Array, yard: Building): number {
  const spec = BUILDINGS[yard.kind];
  return nearestPassable(s, occ, yard.x + spec.w / 2, yard.y + spec.h / 2, 4, true);
}

/**
 * Once a tick: every Naval Yard mends its side's damaged ships within SHIPYARD_MEND_RANGE of its
 * footprint, SHIPYARD_MEND_HP every SHIPYARD_MEND_TICKS, free. Works in place on the cloned state.
 */
export function navalStep(s: GameState): void {
  if (s.tick % SHIPYARD_MEND_TICKS !== 0) return;
  let yards: Building[] | null = null;
  for (const u of s.units) {
    if (u.hp <= 0 || !isShip(u) || u.hp >= maxHpOf(u)) continue;
    yards ??= s.buildings.filter(b => b.kind === 'shipyard' && b.hp > 0);
    if (!yards.length) return;
    const near = yards.some(b => {
      if (b.owner !== u.owner) return false;
      const spec = BUILDINGS[b.kind];
      const gx = Math.max(b.x - u.x, 0, u.x - (b.x + spec.w));
      const gy = Math.max(b.y - u.y, 0, u.y - (b.y + spec.h));
      return Math.sqrt(gx * gx + gy * gy) <= SHIPYARD_MEND_RANGE;
    });
    if (near) u.hp = Math.min(maxHpOf(u), u.hp + SHIPYARD_MEND_HP);
  }
}

/**
 * A save from before the naval war, or one that has been tampered with: a Landing Craft keeps the
 * passengers that may ride in it, oldest first, as many as fit; anything else is dropped. Works on
 * the copy migrateState builds (its units are already copies).
 */
export function migrateNaval(s: GameState): void {
  // A commander's landing and sea from a save: kept only when well formed.
  s.ai = s.ai.map(m => {
    const out = { ...m };
    const l = m.landing as unknown as Record<string, unknown> | null | undefined;
    if (l !== undefined && l !== null) {
      const ok =
        typeof l === 'object' &&
        Number.isInteger(l.craft) &&
        Array.isArray(l.ids) &&
        (l.ids as unknown[]).every(Number.isInteger) &&
        Number.isFinite(l.x) &&
        Number.isFinite(l.y) &&
        Number.isInteger(l.target) &&
        (l.phase === 'board' || l.phase === 'sail') &&
        Number.isFinite(l.since);
      if (!ok) out.landing = null;
    }
    const sh = m.navalShore as unknown;
    if (sh !== undefined && sh !== null && !(Array.isArray(sh) && sh.length === 2 && sh.every(Number.isFinite))) delete out.navalShore;
    return out;
  });
  for (const u of s.units) {
    if (!UNITS[u.kind] || UNITS[u.kind].category !== 'naval' || u.carried === undefined) continue;
    const cap = UNITS[u.kind].carries ?? 0;
    const kept: Unit[] = [];
    let used = 0;
    for (const r of Array.isArray(u.carried) ? u.carried : []) {
      if (!r || typeof r !== 'object' || !UNITS[r.kind] || !Number.isFinite(r.hp) || r.hp <= 0 || !Number.isInteger(r.id) || !canRide(r, u)) continue;
      if (used + slotsOf(r) > cap) continue;
      used += slotsOf(r);
      kept.push({ ...r, order: { type: 'idle' }, path: [], queue: [], engage: 0 });
    }
    if (kept.length) u.carried = kept;
    else delete u.carried;
    if (u.drop !== undefined && (u.drop !== true || !u.carried)) delete u.drop;
  }
}
