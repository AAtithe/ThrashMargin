import { stream } from './rng';
import { MAP_H, MAP_W, ORE_TILE_MAX } from './rules';

/**
 * Battlefield generation. The map is point-symmetric (rotated 180 degrees about its centre), so
 * both commanders start with the same ground, the same ore and the same distance to each other.
 * Only the top half is generated; the bottom half is its mirror.
 */

export interface GeneratedMap {
  /** Size in tiles; tiles and ore are w * h long. Both generators build MAP_W by MAP_H today. */
  w: number;
  h: number;
  tiles: string;
  ore: number[];
  /** Top-left tile of each side's Command Yard, one per side. */
  starts: { x: number; y: number }[];
}

export const idx = (x: number, y: number) => y * MAP_W + x;
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/** The Command Yard sites. Side 0 starts bottom-left; side 1 is its mirror, top-right. */
export const START_0 = { x: 6, y: MAP_H - 10 };
export const START_1 = { x: MAP_W - 1 - (START_0.x + 2), y: MAP_H - 1 - (START_0.y + 2) };

export function generateMap(seed: number): GeneratedMap {
  const rng = stream(seed);

  // Value noise on a coarse lattice, smoothly interpolated.
  const lattice = (step: number) => {
    const gw = Math.ceil(MAP_W / step) + 2;
    const gh = Math.ceil(MAP_H / step) + 2;
    const g: number[] = [];
    for (let i = 0; i < gw * gh; i++) g.push(rng.float() * 2 - 1);
    return (x: number, y: number) => {
      const fx = x / step;
      const fy = y / step;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const sx = fx - x0;
      const sy = fy - y0;
      const ex = sx * sx * (3 - 2 * sx);
      const ey = sy * sy * (3 - 2 * sy);
      const v = (a: number, b: number) => g[b * gw + a];
      const top = v(x0, y0) * (1 - ex) + v(x0 + 1, y0) * ex;
      const bot = v(x0, y0 + 1) * (1 - ex) + v(x0 + 1, y0 + 1) * ex;
      return top * (1 - ey) + bot * ey;
    };
  };
  const lakes = lattice(11);
  const ridges = lattice(7);
  const woods = lattice(5);
  const soil = lattice(6);

  const t: string[] = new Array(MAP_W * MAP_H).fill('g');
  const ore: number[] = new Array(MAP_W * MAP_H).fill(0);
  /** Tiles painted deliberately (clearings, tracks, ore), which win over noise when mirroring. */
  const feat = new Uint8Array(MAP_W * MAP_H);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const w = lakes(x, y);
      const r = ridges(x, y);
      const f = woods(x, y) + rng.float() * 0.25;
      const s = soil(x, y);
      let c = 'g';
      if (s > 0.3) c = 'd';
      if (w < -0.5) c = 'w';
      else if (Math.abs(r) < 0.06 && w > -0.2) c = 'r';
      else if (f > 0.62) c = 't';
      t[idx(x, y)] = c;
    }
  }

  const fill = (cx: number, cy: number, radius: number, c: string) => {
    for (let y = cy - radius; y <= cy + radius; y++)
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!inBounds(x, y)) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
          t[idx(x, y)] = c;
          feat[idx(x, y)] = 1;
        }
      }
  };

  // A clear, buildable plain around each start.
  const b0 = { x: START_0.x + 1, y: START_0.y + 1 };
  const b1 = { x: START_1.x + 1, y: START_1.y + 1 };
  fill(b0.x + 2, b0.y - 2, 9, 'g');
  fill(b1.x - 2, b1.y + 2, 9, 'g');

  // A broad track between the bases, so they can always reach each other.
  const carve = (ax: number, ay: number, bx: number, by: number, width: number) => {
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    let wob = 0;
    for (let i = 0; i <= steps; i++) {
      wob += (rng.float() - 0.5) * 0.9;
      wob = Math.max(-4, Math.min(4, wob));
      const x = Math.round(ax + ((bx - ax) * i) / steps + wob * 0.7);
      const y = Math.round(ay + ((by - ay) * i) / steps - wob * 0.7);
      for (let dy = -width; dy <= width; dy++)
        for (let dx = -width; dx <= width; dx++) {
          if (!inBounds(x + dx, y + dy)) continue;
          const k = idx(x + dx, y + dy);
          if (t[k] !== 'g') t[k] = 'd';
          feat[k] = 1;
        }
    }
  };
  carve(b0.x, b0.y, b1.x, b1.y, 1);
  carve(b0.x, b0.y - 8, MAP_W / 2, 6, 1);

  // Ore fields: one close to each base, one further out on each flank, one rich field mid-map.
  const field = (cx: number, cy: number, radius: number, rich: number) => {
    for (let y = cy - radius; y <= cy + radius; y++)
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!inBounds(x, y)) continue;
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d > radius + rng.float() * 0.8 - 0.4) continue;
        const k = idx(x, y);
        t[k] = 'g';
        feat[k] = 1;
        const amount = Math.round((ORE_TILE_MAX * rich * (1.15 - d / (radius + 1)) * (0.75 + rng.float() * 0.25)) / 10) * 10;
        ore[k] = Math.max(100, Math.min(ORE_TILE_MAX, amount));
      }
  };
  field(b0.x + 11, b0.y - 4, 3, 0.9);
  field(b0.x + 2, b0.y - 15, 3, 0.85);
  field(MAP_W / 2 - 3, MAP_H / 2 - 3, 3, 1);

  // Mirror: every tile copies its partner rotated 180 degrees about the centre. Features were
  // painted around side 0 only, so where one of a pair was painted deliberately, that one wins;
  // otherwise the top-half tile does.
  const total = MAP_W * MAP_H;
  for (let k = 0; k < total; k++) {
    const m = total - 1 - k;
    if (k > m) continue;
    const pick = feat[m] && !feat[k] ? m : feat[k] && !feat[m] ? k : ore[m] > ore[k] ? m : k;
    t[k] = t[m] = t[pick];
    ore[k] = ore[m] = ore[pick];
  }

  // Anything a unit cannot reach from side 0's base becomes rock, and loses its ore.
  const reach = new Uint8Array(total);
  const q: number[] = [idx(b0.x, b0.y)];
  reach[q[0]] = 1;
  while (q.length) {
    const k = q.pop()!;
    const x = k % MAP_W;
    const y = (k / MAP_W) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const n = idx(nx, ny);
      if (reach[n] || !isWalkable(t[n])) continue;
      reach[n] = 1;
      q.push(n);
    }
  }
  for (let k = 0; k < total; k++) {
    if (!reach[k] && isWalkable(t[k])) {
      t[k] = 'r';
      ore[k] = 0;
    }
  }

  return { w: MAP_W, h: MAP_H, tiles: t.join(''), ore, starts: [START_0, START_1] };
}

export const isWalkable = (c: string) => c === 'g' || c === 'd';
