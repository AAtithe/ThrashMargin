import { BUILDINGS, pathExpandLimitFor, type Owner } from './rules';
import { frontDir as sideFront } from './sides';
import type { Building, GameState, Unit } from './types';
// round5:D. Neutral sites (fireline-round5-design.md, workstream D).
import { occupySites } from './sites';

/**
 * Spatial helpers: which tiles are blocked, A* pathfinding, and distances to units and structures.
 * Everything here is a pure function of the state it is given.
 */

/** The index of tile (x, y) in this battle's per-tile strings and arrays. */
export const tileAt = (s: GameState, x: number, y: number): number => y * s.mapW + x;

/** True for a tile on this battle's map. */
export const onMap = (s: GameState, x: number, y: number): boolean => x >= 0 && y >= 0 && x < s.mapW && y < s.mapH;

/** Building id on each tile, 0 for none. Rebuilt whenever the reducer needs it. */
export function occupancy(s: GameState): Int32Array {
  const MAP_W = s.mapW;
  const occ = new Int32Array(MAP_W * s.mapH);
  for (const b of s.buildings) {
    const spec = BUILDINGS[b.kind];
    for (let y = b.y; y < b.y + spec.h; y++) for (let x = b.x; x < b.x + spec.w; x++) occ[y * MAP_W + x] = b.id;
  }
  // round5:D begin. Neutral sites block their tiles with their own id (fireline-round5-design.md).
  if (s.sites) occupySites(s, occ);
  // round5:D end.
  return occ;
}

export function passable(s: GameState, occ: Int32Array, x: number, y: number, sea = false): boolean {
  const MAP_W = s.mapW;
  if (x < 0 || y < 0 || x >= MAP_W || y >= s.mapH) return false;
  const k = y * MAP_W + x;
  if (occ[k] !== 0) return false;
  const c = s.tiles.charCodeAt(k);
  // Ships (`sea`, the naval layer) sail open water and nothing else.
  if (sea) return c === 119; // 'w'
  return c === 103 || c === 100; // 'g' or 'd'
}

/**
 * The row in front of a structure, where its door and dock are: below it for a side whose base is
 * in the bottom half of the map and above it for one in the top half (frontDir in sides.ts), so
 * the front faces away from the fighting. In a two-sided battle that is side 0 south and side 1
 * north. Until this existed every front was the south edge, which faced away from the enemy for
 * side 0 but towards it for side 1: side 1's units and haulers came out on the near side of its
 * base, and it won 78% of mirror games (the round-1 AI ladder, 150 seeds).
 */
export function frontRow(s: GameState, owner: Owner, y: number, h: number): number {
  return sideFront(s, owner) === 1 ? y + h : y - 1;
}

/** One row further out than the front row: kept clear so units can leave. */
export function laneRow(s: GameState, owner: Owner, y: number, h: number): number {
  return sideFront(s, owner) === 1 ? y + h + 1 : y - 2;
}

/** Which way a unit faces leaving a structure (the y component of its facing). */
export const frontDir = (s: GameState, owner: Owner): 1 | -1 => sideFront(s, owner);

/** The tile a refinery's haulers dock on: centre of its front row. */
export function dockTile(s: GameState, b: Building): { x: number; y: number } {
  return { x: b.x + 1, y: frontRow(s, b.owner, b.y, BUILDINGS[b.kind].h) };
}

/** The tile in front of a structure's door, where trained units step out. */
export function doorTile(s: GameState, b: Building): { x: number; y: number } {
  const spec = BUILDINGS[b.kind];
  return { x: b.x + Math.floor(spec.w / 2), y: frontRow(s, b.owner, b.y, spec.h) };
}

/** The index of the tile a unit stands on. */
export const tileOf = (s: GameState, u: { x: number; y: number }) => Math.floor(u.y) * s.mapW + Math.floor(u.x);

/** Distance from a point to the nearest point of a structure's footprint. */
export function distToBuilding(px: number, py: number, b: Building): number {
  const spec = BUILDINGS[b.kind];
  const cx = Math.max(b.x, Math.min(px, b.x + spec.w));
  const cy = Math.max(b.y, Math.min(py, b.y + spec.h));
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

export function buildingCentre(b: Building): { x: number; y: number } {
  const spec = BUILDINGS[b.kind];
  return { x: b.x + spec.w / 2, y: b.y + spec.h / 2 };
}

export const dist = (ax: number, ay: number, bx: number, by: number) => Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);

export type Target = { unit: Unit; building?: undefined } | { building: Building; unit?: undefined };

export function distToTarget(px: number, py: number, t: Target): number {
  return t.unit ? dist(px, py, t.unit.x, t.unit.y) : distToBuilding(px, py, t.building!);
}

export function targetPoint(t: Target): { x: number; y: number } {
  return t.unit ? { x: t.unit.x, y: t.unit.y } : buildingCentre(t.building!);
}

/** The nearest passable tile to (x, y), searching outward ring by ring. -1 if none within range. */
export function nearestPassable(s: GameState, occ: Int32Array, x: number, y: number, maxR = 8, sea = false): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (passable(s, occ, cx, cy, sea)) return tileAt(s, cx, cy);
  for (let r = 1; r <= maxR; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!passable(s, occ, nx, ny, sea)) continue;
        const d = (nx + 0.5 - x) ** 2 + (ny + 0.5 - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = tileAt(s, nx, ny);
        }
      }
    if (best >= 0) return best;
  }
  return -1;
}

/** True when a straight walk between two tile centres crosses only passable tiles. */
export function lineClear(s: GameState, occ: Int32Array, a: number, b: number, sea = false): boolean {
  const MAP_W = s.mapW;
  let x0 = a % MAP_W;
  let y0 = (a / MAP_W) | 0;
  const x1 = b % MAP_W;
  const y1 = (b / MAP_W) | 0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (!passable(s, occ, x0, y0, sea)) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    // Moving diagonally: both orthogonal neighbours must be open, or we would clip a corner.
    if (e2 > -dy && e2 < dx) {
      if (!passable(s, occ, x0 + sx, y0, sea) || !passable(s, occ, x0, y0 + sy, sea)) return false;
    }
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * Scratch space for findPath, kept between searches so a search allocates nothing per tile (round
 * 5: on a 160-tile map each search used to allocate and fill three arrays of 25,600). A tile's
 * entries are valid only while its `stamp` equals the current search's; any other tile reads as
 * unvisited (no g score, no parent, not closed). The heap holds (f, order of insertion, tile) in
 * three parallel arrays and is compared exactly as before, f first and then insertion order, so a
 * search expands the same tiles in the same order and returns the same path. Pure: nothing here
 * outlives a call in any way that changes a result.
 */
let scratchSize = 0;
let stamp = new Int32Array(0);
let gScore = new Float64Array(0);
let came = new Int32Array(0);
let closedAt = new Int32Array(0);
let search = 0;
let heapF = new Float64Array(1024);
let heapSeq = new Float64Array(1024);
let heapK = new Int32Array(1024);

/**
 * Per occupancy grid: 1 on each tile a unit may walk (passable, below), 0 elsewhere. Built once per
 * grid the first time a search uses it, so a search reads one array rather than calling passable
 * for every neighbour. A grid is never changed after occupancy() builds it.
 */
const openCache = new WeakMap<Int32Array, Uint8Array>();
/** The same for ships: 1 on each tile of open water (the naval layer). */
const seaCache = new WeakMap<Int32Array, Uint8Array>();
function openTiles(s: GameState, occ: Int32Array, sea = false): Uint8Array {
  const cache = sea ? seaCache : openCache;
  let open = cache.get(occ);
  if (!open || open.length !== occ.length) {
    open = new Uint8Array(occ.length);
    const tiles = s.tiles;
    for (let k = 0; k < open.length; k++) {
      if (occ[k] !== 0) continue;
      const c = tiles.charCodeAt(k);
      if (sea ? c === 119 : c === 103 || c === 100) open[k] = 1;
    }
    cache.set(occ, open);
  }
  return open;
}

function scratchFor(total: number): void {
  if (total > scratchSize) {
    scratchSize = total;
    stamp = new Int32Array(total);
    gScore = new Float64Array(total);
    came = new Int32Array(total);
    closedAt = new Int32Array(total);
    search = 0;
  }
  search++;
  if (search > 0x3fffffff) {
    stamp.fill(0);
    closedAt.fill(0);
    search = 1;
  }
}

/**
 * A* over the tile grid, eight directions, no corner cutting. `sea`: over open water instead (ships). Returns waypoints as tile indices,
 * smoothed so a unit walks straight lines wherever it can, excluding the start tile. If the goal
 * cannot be reached the path leads to the reachable tile closest to it.
 */
export function findPath(s: GameState, occ: Int32Array, start: number, goal: number, sea = false): number[] {
  if (start === goal) return [];
  const MAP_W = s.mapW;
  const total = MAP_W * s.mapH;
  scratchFor(total);
  const run = search;
  const gx = goal % MAP_W;
  const gy = (goal / MAP_W) | 0;
  const h = (k: number) => {
    const dx = Math.abs((k % MAP_W) - gx);
    const dy = Math.abs(((k / MAP_W) | 0) - gy);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
  const g = (k: number) => (stamp[k] === run ? gScore[k] : Infinity);
  const open = openTiles(s, occ, sea);
  const MAP_H = s.mapH;
  const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && open[y * MAP_W + x] === 1;
  const parent = (k: number) => (stamp[k] === run ? came[k] : -1);

  // Binary heap of (f, tiebreak, node), in three parallel arrays.
  let size = 0;
  let seq = 0;
  const less = (i: number, j: number) => heapF[i] < heapF[j] || (heapF[i] === heapF[j] && heapSeq[i] < heapSeq[j]);
  const swap = (i: number, j: number) => {
    const f = heapF[i];
    heapF[i] = heapF[j];
    heapF[j] = f;
    const q = heapSeq[i];
    heapSeq[i] = heapSeq[j];
    heapSeq[j] = q;
    const k = heapK[i];
    heapK[i] = heapK[j];
    heapK[j] = k;
  };
  const push = (f: number, k: number) => {
    if (size === heapF.length) {
      const nf = new Float64Array(size * 2);
      nf.set(heapF);
      heapF = nf;
      const ns = new Float64Array(size * 2);
      ns.set(heapSeq);
      heapSeq = ns;
      const nk = new Int32Array(size * 2);
      nk.set(heapK);
      heapK = nk;
    }
    heapF[size] = f;
    heapSeq[size] = seq++;
    heapK[size] = k;
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(i, p)) {
        swap(i, p);
        i = p;
      } else break;
    }
  };
  const pop = () => {
    const top = heapK[0];
    size--;
    if (size > 0) {
      heapF[0] = heapF[size];
      heapSeq[0] = heapSeq[size];
      heapK[0] = heapK[size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < size && less(l, m)) m = l;
        if (r < size && less(r, m)) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    return top;
  };

  stamp[start] = run;
  gScore[start] = 0;
  came[start] = -1;
  push(h(start), start);
  let best = start;
  let bestH = h(start);
  let expanded = 0;
  const limit = pathExpandLimitFor(s.setup?.size ?? 'standard', total);
  while (size && expanded < limit) {
    const k = pop();
    if (closedAt[k] === run) continue;
    closedAt[k] = run;
    expanded++;
    if (k === goal) {
      best = k;
      break;
    }
    const hk = h(k);
    if (hk < bestH) {
      bestH = hk;
      best = k;
    }
    const x = k % MAP_W;
    const y = (k / MAP_W) | 0;
    const gk = gScore[k];
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!walk(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!walk(x + dx, y) || !walk(x, y + dy))) continue;
      const n = ny * MAP_W + nx;
      if (closedAt[n] === run) continue;
      const gn = gk + cost;
      if (gn < g(n)) {
        stamp[n] = run;
        gScore[n] = gn;
        came[n] = k;
        push(gn + h(n), n);
      }
    }
  }

  const raw: number[] = [];
  for (let k = best; k !== start && k !== -1; k = parent(k)) raw.push(k);
  raw.reverse();
  if (!raw.length) return [];

  // String-pulling: drop any waypoint the unit can see past.
  const out: number[] = [];
  let from = start;
  let i = 0;
  while (i < raw.length) {
    let j = raw.length - 1;
    while (j > i && !lineClear(s, occ, from, raw[j], sea)) j--;
    out.push(raw[j]);
    from = raw[j];
    i = j + 1;
  }
  return out;
}

