import { idx } from './map';
import { BUILDINGS, MAP_H as H, MAP_W as W, type Owner } from './rules';

// Local copies: these are read in the innermost loops, where a module binding costs a lookup.
const MAP_W = W;
const MAP_H = H;
import type { Building, GameState, Unit } from './types';

/**
 * Spatial helpers: which tiles are blocked, A* pathfinding, and distances to units and structures.
 * Everything here is a pure function of the state it is given.
 */

/** Building id on each tile, 0 for none. Rebuilt whenever the reducer needs it. */
export function occupancy(s: GameState): Int32Array {
  const occ = new Int32Array(MAP_W * MAP_H);
  for (const b of s.buildings) {
    const spec = BUILDINGS[b.kind];
    for (let y = b.y; y < b.y + spec.h; y++) for (let x = b.x; x < b.x + spec.w; x++) occ[idx(x, y)] = b.id;
  }
  return occ;
}

export function passable(s: GameState, occ: Int32Array, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  const k = y * MAP_W + x;
  if (occ[k] !== 0) return false;
  const c = s.tiles.charCodeAt(k);
  return c === 103 || c === 100; // 'g' or 'd'
}

/**
 * The row in front of a structure, where its door and dock are: below it for side 0 and above it
 * for side 1. Side 0's base is in the bottom-left and side 1's in the top-right, so for both the
 * front faces away from the enemy. Until this existed every front was the south edge, which faced
 * away from the enemy for side 0 but towards it for side 1: side 1's units and haulers came out on
 * the near side of its base, and it won 78% of mirror games (the round-1 AI ladder, 150 seeds).
 */
export function frontRow(owner: Owner, y: number, h: number): number {
  return owner === 0 ? y + h : y - 1;
}

/** One row further out than the front row: kept clear so units can leave. */
export function laneRow(owner: Owner, y: number, h: number): number {
  return owner === 0 ? y + h + 1 : y - 2;
}

/** Which way a unit faces leaving a structure (the y component of its facing). */
export const frontDir = (owner: Owner) => (owner === 0 ? 1 : -1);

/** The tile a refinery's haulers dock on: centre of its front row. */
export function dockTile(b: Building): { x: number; y: number } {
  return { x: b.x + 1, y: frontRow(b.owner, b.y, BUILDINGS[b.kind].h) };
}

/** The tile in front of a structure's door, where trained units step out. */
export function doorTile(b: Building): { x: number; y: number } {
  const spec = BUILDINGS[b.kind];
  return { x: b.x + Math.floor(spec.w / 2), y: frontRow(b.owner, b.y, spec.h) };
}

export const tileOf = (u: { x: number; y: number }) => idx(Math.floor(u.x), Math.floor(u.y));

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
export function nearestPassable(s: GameState, occ: Int32Array, x: number, y: number, maxR = 8): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (passable(s, occ, cx, cy)) return idx(cx, cy);
  for (let r = 1; r <= maxR; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!passable(s, occ, nx, ny)) continue;
        const d = (nx + 0.5 - x) ** 2 + (ny + 0.5 - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = idx(nx, ny);
        }
      }
    if (best >= 0) return best;
  }
  return -1;
}

/** True when a straight walk between two tile centres crosses only passable tiles. */
export function lineClear(s: GameState, occ: Int32Array, a: number, b: number): boolean {
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
    if (!passable(s, occ, x0, y0)) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    // Moving diagonally: both orthogonal neighbours must be open, or we would clip a corner.
    if (e2 > -dy && e2 < dx) {
      if (!passable(s, occ, x0 + sx, y0) || !passable(s, occ, x0, y0 + sy)) return false;
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
 * A* over the tile grid, eight directions, no corner cutting. Returns waypoints as tile indices,
 * smoothed so a unit walks straight lines wherever it can, excluding the start tile. If the goal
 * cannot be reached the path leads to the reachable tile closest to it.
 */
export function findPath(s: GameState, occ: Int32Array, start: number, goal: number): number[] {
  if (start === goal) return [];
  const total = MAP_W * MAP_H;
  const gScore = new Float64Array(total).fill(Infinity);
  const came = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const gx = goal % MAP_W;
  const gy = (goal / MAP_W) | 0;
  const h = (k: number) => {
    const dx = Math.abs((k % MAP_W) - gx);
    const dy = Math.abs(((k / MAP_W) | 0) - gy);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };

  // Binary heap of [f, tiebreak, node].
  const heap: number[][] = [];
  let seq = 0;
  const push = (f: number, k: number) => {
    heap.push([f, seq++, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(heap[i], heap[p])) {
        [heap[i], heap[p]] = [heap[p], heap[i]];
        i = p;
      } else break;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top[2];
  };

  gScore[start] = 0;
  push(h(start), start);
  let best = start;
  let bestH = h(start);
  let expanded = 0;
  while (heap.length && expanded < 6000) {
    const k = pop();
    if (closed[k]) continue;
    closed[k] = 1;
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
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(s, occ, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!passable(s, occ, x + dx, y) || !passable(s, occ, x, y + dy))) continue;
      const n = ny * MAP_W + nx;
      if (closed[n]) continue;
      const g = gScore[k] + cost;
      if (g < gScore[n]) {
        gScore[n] = g;
        came[n] = k;
        push(g + h(n), n);
      }
    }
  }

  const raw: number[] = [];
  for (let k = best; k !== start && k !== -1; k = came[k]) raw.push(k);
  raw.reverse();
  if (!raw.length) return [];

  // String-pulling: drop any waypoint the unit can see past.
  const out: number[] = [];
  let from = start;
  let i = 0;
  while (i < raw.length) {
    let j = raw.length - 1;
    while (j > i && !lineClear(s, occ, from, raw[j])) j--;
    out.push(raw[j]);
    from = raw[j];
    i = j + 1;
  }
  return out;
}

const less = (a: number[], b: number[]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
