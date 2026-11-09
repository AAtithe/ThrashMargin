import { idx, inBounds, isWalkable, type GeneratedMap } from './map';
import { stream } from './rng';
import { MAP_H, MAP_TYPES, MAP_W, ORE_LEVELS, ORE_TILE_MAX, type MapType, type OreLevel } from './rules';

/**
 * Skirmish battlefields, one generator per map type. The campaign never comes here: its missions
 * are laid out against generateMap() in map.ts, which stays exactly as it was.
 *
 * Every map this returns is checked by mapProblem() before it is handed out:
 *  - point-symmetric (each tile equals its partner rotated 180 degrees about the centre), so both
 *    sides start with the same ground and the same ore;
 *  - side 0's Command Yard in the bottom half and side 1's, its mirror, in the top half, which the
 *    "front row" rule in grid.ts relies on; the yard's x position varies with the seed;
 *  - at least two distinct routes between the bases (cut the shortest one and another remains);
 *  - four to eight ore fields: one near each base, expansions, and a contested middle;
 *  - everything walkable reachable from both bases, and clear buildable ground round each yard.
 *
 * Everything is painted through a symmetric brush (a tile and its partner at once), so a feature
 * that crosses the middle, such as a river ford, is whole on both sides. An attempt that fails the
 * checks is thrown away and the next is drawn from the same seed, so the result is deterministic.
 */

const N = MAP_W * MAP_H;
const mirrorOf = (k: number) => N - 1 - k;

/** Buildable tiles (walkable, no ore, not the yard) required within 8 tiles (Chebyshev) of each yard's centre. */
export const MIN_BASE_GROUND = 140;
/** Ore fields: tiles with ore, 8-connected. */
export const MIN_ORE_FIELDS = 4;
export const MAX_ORE_FIELDS = 8;
/** Radius kept clear and buildable round each Command Yard. */
const CLEARING = 8.5;
const ATTEMPTS = 24;

/** The map type a 'random' setup resolves to, from the seed. */
export function randomMapType(seed: number): MapType {
  const r = stream((seed ^ 0x5bd1e995) >>> 0);
  r.float();
  return MAP_TYPES[Math.floor(r.float() * MAP_TYPES.length)];
}

export function generateSkirmishMap(seed: number, type: MapType, ore: OreLevel = 'normal'): GeneratedMap {
  const kind: MapType = MAP_TYPES.includes(type) ? type : 'classic';
  const level: OreLevel = ore in ORE_LEVELS ? ore : 'normal';
  let last: GeneratedMap | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const sub = (seed + Math.imul(attempt, 0x9e3779b1)) >>> 0;
    const m = draftSkirmishMap(sub, kind, level);
    if (mapProblem(m) === null) return m;
    last = m;
  }
  // Every type passes within a few attempts on every seed the harness sweeps; this is a guard.
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const m = draftSkirmishMap((seed + 0x51ed27 + attempt) >>> 0, 'plains', level);
    if (mapProblem(m) === null) return m;
  }
  return last!;
}

// ---------------------------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}

/** One attempt at a map, before the checks: exported for the harness to measure how often attempts pass. */
export function draftSkirmishMap(seed: number, type: MapType, oreLevel: OreLevel): GeneratedMap {
  const rng = stream(seed);
  const t: string[] = new Array(N).fill('g');
  const ore: number[] = new Array(N).fill(0);

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
  /** Smooth 1-D noise in [-1, 1], for wobbling lines. */
  const wobble = (step: number) => {
    const g: number[] = [];
    for (let i = 0; i < Math.ceil(MAP_W / step) + 3; i++) g.push(rng.float() * 2 - 1);
    return (x: number) => {
      const f = Math.max(0, x) / step;
      const i = Math.floor(f);
      const s = f - i;
      const e = s * s * (3 - 2 * s);
      return g[i] * (1 - e) + g[i + 1] * e;
    };
  };

  // 1. Ground from noise, by type, then made symmetric: the top half copies the bottom half.
  const P = TERRAIN[type];
  const lakes = lattice(11);
  const ridges = lattice(7);
  const woods = lattice(5);
  const soil = lattice(6);
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const w = lakes(x, y);
      const r = ridges(x, y);
      const f = woods(x, y) + rng.float() * 0.25;
      let c = soil(x, y) > 0.3 ? 'd' : 'g';
      if (w < P.water) c = 'w';
      else if (Math.abs(r) < P.ridge && w > -0.2) c = 'r';
      else if (f > P.trees) c = 't';
      t[idx(x, y)] = c;
    }
  for (let k = 0; k < N / 2; k++) t[k] = t[mirrorOf(k)];

  /** The symmetric brush. */
  const paint = (x: number, y: number, c: string) => {
    if (!inBounds(x, y)) return;
    const k = idx(x, y);
    t[k] = t[mirrorOf(k)] = c;
    if (!isWalkable(c)) ore[k] = ore[mirrorOf(k)] = 0;
  };
  const disc = (cx: number, cy: number, r: number, c: string, rough = 0) => {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
        if (d <= r + (rough ? (rng.float() - 0.5) * rough : 0)) paint(x, y, c);
      }
  };

  // 2. Where the bases go: side 0 low on the map, its x drawn from the seed; side 1 is its mirror.
  const sx = rng.int(5, MAP_W - 8);
  const sy = MAP_H - rng.int(9, 11);
  const start0 = { x: sx, y: sy };
  const start1 = { x: MAP_W - 1 - (sx + 2), y: MAP_H - 1 - (sy + 2) };
  const b0: Pt = { x: sx + 1.5, y: sy + 1.5 };
  const b1: Pt = { x: MAP_W - b0.x, y: MAP_H - b0.y };
  const CX = MAP_W / 2;
  const CY = MAP_H / 2;
  /** Which way the middle of the map lies from side 0's base, across. */
  const inward = b0.x < CX - 4 ? 1 : b0.x > CX + 4 ? -1 : rng.float() < 0.5 ? -1 : 1;
  /** Across the map at right angles to the line between the bases: every point C + k * perp is as far from one base as the other. */
  const span = dist(b0, b1);
  const perp = { x: (b0.y - b1.y) / span, y: (b1.x - b0.x) / span };

  // 3. The type's own features.
  const contested: Pt[] = [];
  let extraFields = 0;
  /** A wobbling dirt track three tiles wide (and its mirror), through whatever is in the way. */
  const carve = (ax: number, ay: number, bx: number, by: number) => {
    const steps = Math.max(1, Math.round(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
    let wob = 0;
    for (let i = 0; i <= steps; i++) {
      wob = Math.max(-4, Math.min(4, wob + (rng.float() - 0.5) * 0.9));
      // The wobble fades out at both ends, so the track arrives where it was sent.
      const fade = Math.min(1, i / 4, (steps - i) / 4);
      const x = Math.round(ax + ((bx - ax) * i) / steps + wob * 0.7 * fade);
      const y = Math.round(ay + ((by - ay) * i) / steps - wob * 0.7 * fade);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!inBounds(x + dx, y + dy)) continue;
          paint(x + dx, y + dy, t[idx(x + dx, y + dy)] === 'g' ? 'g' : 'd');
        }
    }
  };
  if (type === 'classic') {
    // Wobbling dirt tracks between the bases and up a flank, as the original map has.
    carve(b0.x, b0.y, b1.x, b1.y);
    carve(b0.x, b0.y - 8, CX + inward * rng.int(-6, 6), 6);
    contested.push({ x: CX, y: CY });
  } else if (type === 'river') {
    // A river along the middle, wobbling, narrowing to nothing at the centre column so the two
    // painted halves meet. Three crossings: a ford on each flank and an island midstream.
    const wob = wobble(9);
    const width = 2 + rng.float() * 0.8;
    const centreY = (x: number) => CY + wob(x) * 3.5 * Math.min(1, Math.max(0, (CX - (x + 0.5)) / 6));
    for (let x = 0; x < CX; x++)
      for (let y = 20; y < 44; y++) {
        const d = Math.abs(y + 0.5 - centreY(x));
        if (d < width) paint(x, y, 'w');
        else if (d < width + 1.2 && t[idx(x, y)] !== 'w') paint(x, y, 'd');
      }
    const ford = rng.int(5, 20);
    const fw = rng.int(3, 4);
    for (let x = ford; x < ford + fw; x++)
      for (let y = 20; y < 44; y++) if (Math.abs(y + 0.5 - centreY(x)) < width + 1.2) paint(x, y, 'd');
    // The island and the shallows that reach it from both banks.
    disc(CX, CY, 3.6, 'g', 0.6);
    for (let x = CX - 2; x < CX + 2; x++) for (let y = CY - 6; y < CY + 6; y++) if (t[idx(x, y)] === 'w') paint(x, y, 'd');
    contested.push({ x: CX, y: CY });
  } else if (type === 'highlands') {
    // A ridge right across the middle, broken by three narrow passes (the middle one holding the
    // contested ore), and shorter spurs of rock on each side that split the approaches.
    const wob = wobble(8);
    const passes = [rng.int(4, 19), CX - 2];
    // Painted on the left half only, its wobble fading to nothing at the centre column so the
    // brush's right half meets it.
    for (let x = 0; x < CX; x++) {
      const y = Math.round(CY - 1 + wob(x) * 3 * Math.min(1, Math.max(0, (CX - (x + 0.5)) / 6)));
      if (passes.some(p => x >= p && x < p + 3)) {
        // A pass: open ground right through, whatever the noise put there.
        for (let dy = -4; dy <= 5; dy++) paint(x, y + dy, 'd');
        continue;
      }
      for (let dy = -1; dy <= 1; dy++) paint(x, y + dy, 'r');
      if (rng.float() < 0.4) paint(x, y + 2, 'r');
    }
    // Spurs: short ridges, on side 0's half (the brush mirrors them), clear of the base.
    const spurs = rng.int(3, 5);
    for (let i = 0, tries = 0; i < spurs && tries < 40; tries++) {
      const a = { x: 2 + rng.float() * (MAP_W - 4), y: CY + 4 + rng.float() * 16 };
      const len = 7 + rng.float() * 9;
      const dx = rng.float() * 2 - 1;
      const dy = (rng.float() * 2 - 1) * 0.6;
      const m = Math.sqrt(dx * dx + dy * dy) || 1;
      const b = { x: a.x + (dx / m) * len, y: a.y + (dy / m) * len };
      if (dist(a, b0) < CLEARING + 3 || dist(b, b0) < CLEARING + 3 || dist({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b0) < CLEARING + 2) continue;
      if (b.y < CY + 3) continue;
      const nearPass = (p: Pt) => passes.some(q => dist(p, { x: q + 1.5, y: CY }) < 9 || dist(p, { x: MAP_W - q - 1.5, y: CY }) < 9);
      if (nearPass(a) || nearPass(b)) continue;
      for (let s = 0; s <= len; s++) {
        const x = Math.round(a.x + ((b.x - a.x) * s) / len);
        const y = Math.round(a.y + ((b.y - a.y) * s) / len);
        paint(x, y, 'r');
        paint(x + 1, y, 'r');
        if (rng.float() < 0.5) paint(x, y + 1, 'r');
      }
      i++;
    }
    // Tracks from both bases to each pass (the brush adds the mirrored pass's), so every pass is a
    // way through rather than a dead end behind the woods.
    for (const p of passes) {
      const c = { x: Math.min(p + 1.5, CX), y: CY };
      carve(b0.x, b0.y, c.x, c.y + 4);
      carve(c.x, c.y - 4, b1.x, b1.y);
    }
    contested.push({ x: CX, y: CY });
  } else if (type === 'lakes') {
    const pairs = rng.int(3, 4);
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < pairs; tries++) {
      const r = 2.5 + rng.float() * 3;
      const p = { x: 3 + rng.float() * (MAP_W - 6), y: CY + 2 + rng.float() * 20 };
      if (dist(p, b0) < CLEARING + r + 2 || dist(p, b1) < CLEARING + r + 2) continue;
      disc(p.x, p.y, r, 'w', 1.2);
      placed++;
    }
    if (rng.float() < 0.65) {
      // A lake in the very middle: the contested ore lies either side of it.
      disc(CX, CY, 2.5 + rng.float() * 2, 'w', 1);
      const k = rng.int(9, 13);
      const side = { x: CX + perp.x * k, y: CY + perp.y * k };
      contested.push(side);
      // Tracks from both bases to the ground beside it (the brush adds the other side's).
      carve(b0.x, b0.y, side.x, side.y);
      carve(side.x, side.y, b1.x, b1.y);
    } else {
      contested.push({ x: CX, y: CY });
      // A track between the bases (and its mirror), across the water where it must: a causeway.
      carve(b0.x, b0.y, b1.x, b1.y);
    }
  } else if (type === 'plains') {
    extraFields = 1;
    const k = rng.float() < 0.5 ? 0 : rng.int(8, 12);
    contested.push({ x: CX + perp.x * k, y: CY + perp.y * k });
  } else {
    // Canyon: cliffs fill the middle band, cut by long corridors running from one side to the other.
    const top = rng.int(16, 19);
    for (let y = top; y < MAP_H - top; y++) for (let x = 0; x < MAP_W; x++) paint(x, y, 'r');
    /**
     * One corridor down the band (the brush adds its mirror), with tracks from both bases to its
     * ends so neither end is a dead end. Returns where it crosses the middle row.
     */
    const corridor = (cx: number, amp: number, half: number) => {
      const wob = wobble(7);
      for (let y = top - 1; y <= MAP_H - top; y++) {
        const c = cx + wob(y) * amp;
        for (let x = Math.floor(c - half); x <= Math.ceil(c + half); x++)
          if (Math.abs(x + 0.5 - c) <= half) paint(x, y, rng.float() < 0.2 ? 'd' : 'g');
      }
      carve(b0.x, b0.y, cx + wob(MAP_H - top) * amp, MAP_H - top + 1);
      carve(cx + wob(top - 1) * amp, top - 2, b1.x, b1.y);
      return (y: number) => cx + wob(y) * amp;
    };
    const flankX = corridor(rng.int(9, 19), 3, 2.6);
    // Two corridors: the contested ore sits in them, where each crosses the line of points as far
    // from one base as the other. If that is outside the cliffs, or by chance, a third corridor
    // down the middle holds it instead.
    let mid: Pt | null = null;
    let best = 1.5;
    for (let y = top + 4; y <= MAP_H - top - 4; y++) {
      const x = flankX(y);
      const off = Math.abs((x - CX) * (b1.x - b0.x) + (y - CY) * (b1.y - b0.y)) / span;
      if (off < best) {
        best = off;
        mid = { x, y };
      }
    }
    if (!mid || rng.float() < 0.5) {
      corridor(CX, 1.2, 2.4);
      contested.push({ x: CX, y: CY });
    } else contested.push(mid);
  }

  // 4. Clear, buildable ground round each base.
  disc(b0.x, b0.y, CLEARING, 'g');

  // 5. Ore: a field near each base, an expansion further out, the contested middle, and on the
  // plains another pair. Ore is laid on land only, never over water or rock.
  const lv = ORE_LEVELS[oreLevel];
  const fields: Pt[] = [];
  const field = (c: Pt, radius: number, rich: number) => {
    const r = radius + lv.radius;
    for (let y = Math.floor(c.y - r - 1); y <= Math.ceil(c.y + r + 1); y++)
      for (let x = Math.floor(c.x - r - 1); x <= Math.ceil(c.x + r + 1); x++) {
        if (!inBounds(x, y)) continue;
        const d = Math.sqrt((x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2);
        if (d > r + rng.float() * 0.8 - 0.4) continue;
        const k = idx(x, y);
        if (t[k] === 'w' || t[k] === 'r') continue;
        if (t[k] === 't') paint(x, y, 'g');
        const amount = Math.round((ORE_TILE_MAX * rich * lv.amount * (1.15 - d / (r + 1)) * (0.75 + rng.float() * 0.25)) / 10) * 10;
        ore[k] = ore[mirrorOf(k)] = Math.max(60, Math.min(ORE_TILE_MAX, amount));
      }
    fields.push(c, { x: MAP_W - c.x, y: MAP_H - c.y });
  };
  /** Whether a field of radius r fits at c: clear of the bases' ground, other fields and its own mirror, mostly on land. */
  const fits = (c: Pt, r: number, nearBase = false) => {
    if (c.x < r + 1 || c.y < r + 1 || c.x > MAP_W - r - 1 || c.y > MAP_H - r - 1) return false;
    const minBase = nearBase ? CLEARING + r - 0.5 : CLEARING + r + 3;
    if (dist(c, b0) < minBase || dist(c, b1) < minBase) return false;
    const m = { x: MAP_W - c.x, y: MAP_H - c.y };
    if (!(c.x === m.x && c.y === m.y) && dist(c, m) < 2 * r + 4) return false;
    if (fields.some(f => dist(f, c) < 2 * r + 4)) return false;
    let land = 0;
    let all = 0;
    for (let y = Math.floor(c.y - r); y <= Math.ceil(c.y + r); y++)
      for (let x = Math.floor(c.x - r); x <= Math.ceil(c.x + r); x++) {
        if (!inBounds(x, y) || (x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 > r * r) continue;
        all++;
        const ch = t[idx(x, y)];
        if (ch !== 'w' && ch !== 'r') land++;
      }
    return land >= all * 0.7;
  };
  // The contested field first, so nothing else crowds it out: where the type wants it, else the
  // nearest open ground on the line of points as far from one base as from the other (the
  // perpendicular bisector of the bases, through the centre). Off the centre it comes as a pair,
  // one either side, each as far from both bases.
  const bisector = (k: number): Pt => ({ x: CX + perp.x * k, y: CY + perp.y * k });
  const middles = [...contested, ...[0, 3, -3, 6, -6, 9, -9, 12, -12].map(bisector)];
  for (const r of [3.5, 2.5]) {
    const c = middles.find(p => fits(p, r));
    if (c) {
      field(c, r, 1.1);
      break;
    }
  }
  // Near the base: toward the middle first, then the other ways round.
  const homeTries: Pt[] = [
    { x: b0.x + inward * 11, y: b0.y - 4 },
    { x: b0.x + inward * 8.5, y: b0.y - 8.5 },
    { x: b0.x, y: b0.y - 12 },
    { x: b0.x - inward * 8.5, y: b0.y - 8.5 },
    { x: b0.x - inward * 11, y: b0.y - 4 },
    { x: b0.x + inward * 12, y: b0.y + 2 },
    { x: b0.x - inward * 12, y: b0.y + 2 },
  ];
  const home = homeTries.find(p => fits(p, 3.5, true));
  if (home) field(home, 3.5, 1);
  else {
    const small = homeTries.find(p => fits(p, 2.5, true));
    if (small) field(small, 2.5, 1.2);
  }
  // Expansions: further out, still on side 0's half (the brush gives side 1 the mirror).
  for (let i = 0; i < 1 + extraFields; i++) {
    for (let tries = 0; tries < 50; tries++) {
      const p = { x: 4 + rng.float() * (MAP_W - 8), y: CY + 5 + rng.float() * (MAP_H - CY - 9) };
      const d = dist(p, b0);
      if (d < 14 || d > 30) continue;
      if (!fits(p, 3.5)) continue;
      field(p, 3.5, 0.95);
      break;
    }
  }

  // 6. Anything a unit cannot reach from the bases becomes rock, and loses its ore.
  // (From both, so the result stays symmetric even when they are cut off from each other, which
  // the checks then refuse.)
  const reach = flood(t, idx(Math.floor(b0.x), Math.floor(b0.y)));
  const reach1 = flood(t, idx(Math.floor(b1.x), Math.floor(b1.y)));
  for (let k = 0; k < N; k++) {
    if (!reach[k] && !reach1[k] && isWalkable(t[k])) {
      t[k] = 'r';
      ore[k] = 0;
    }
  }
  return { w: MAP_W, h: MAP_H, tiles: t.join(''), ore, starts: [start0, start1] };
}

/** Terrain noise thresholds by type: below `water` is water, a band `ridge` wide is rock, above `trees` is woods. */
const TERRAIN: Record<MapType, { water: number; ridge: number; trees: number }> = {
  classic: { water: -0.5, ridge: 0.06, trees: 0.62 },
  river: { water: -0.75, ridge: 0.04, trees: 0.6 },
  highlands: { water: -0.75, ridge: 0.07, trees: 0.68 },
  lakes: { water: -0.5, ridge: 0.03, trees: 0.66 },
  plains: { water: -0.85, ridge: 0.02, trees: 0.74 },
  canyon: { water: -0.8, ridge: 0.04, trees: 0.64 },
};

const dist = (a: Pt, b: Pt) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** Walkable tiles reachable from `from`, four ways (units never cut corners, so this is what they can walk). */
function flood(t: string[] | string, from: number, blocked?: Uint8Array): Uint8Array {
  const reach = new Uint8Array(N);
  if (!isWalkable(t[from]) || blocked?.[from]) return reach;
  const q: number[] = [from];
  reach[from] = 1;
  while (q.length) {
    const k = q.pop()!;
    const x = k % MAP_W;
    const y = (k / MAP_W) | 0;
    if (x > 0) visit(k - 1);
    if (x < MAP_W - 1) visit(k + 1);
    if (y > 0) visit(k - MAP_W);
    if (y < MAP_H - 1) visit(k + MAP_W);
  }
  return reach;
  function visit(n: number) {
    if (reach[n] || !isWalkable(t[n]) || blocked?.[n]) return;
    reach[n] = 1;
    q.push(n);
  }
}

/** Shortest walk between two tiles (four ways), as tile indices from `a` to `b`; empty if there is none. */
export function shortestWalk(tiles: string, a: number, b: number, blocked?: Uint8Array): number[] {
  const came = new Int32Array(N).fill(-1);
  came[a] = a;
  let q = [a];
  while (q.length && came[b] < 0) {
    const nq: number[] = [];
    for (const k of q) {
      const x = k % MAP_W;
      const y = (k / MAP_W) | 0;
      const ns = [x > 0 ? k - 1 : -1, x < MAP_W - 1 ? k + 1 : -1, y > 0 ? k - MAP_W : -1, y < MAP_H - 1 ? k + MAP_W : -1];
      for (const n of ns) {
        if (n < 0 || came[n] >= 0 || !isWalkable(tiles[n]) || blocked?.[n]) continue;
        came[n] = k;
        nq.push(n);
      }
    }
    q = nq;
  }
  if (came[b] < 0) return [];
  const out: number[] = [];
  for (let k = b; k !== a; k = came[k]) out.push(k);
  out.push(a);
  return out.reverse();
}

/**
 * Whether there are two distinct routes between the bases: block a band two tiles either side of
 * the shortest walk (outside the bases' own ground, `spare` tiles round each yard) and look for
 * another. Returns the second route, or an empty list if cutting the first leaves none.
 */
export function secondRoute(m: GeneratedMap, spare = 11): number[] {
  const a = idx(m.starts[0].x + 1, m.starts[0].y + 1);
  const b = idx(m.starts[1].x + 1, m.starts[1].y + 1);
  const first = shortestWalk(m.tiles, a, b);
  if (!first.length) return [];
  const ax = m.starts[0].x + 1.5;
  const ay = m.starts[0].y + 1.5;
  const bx = m.starts[1].x + 1.5;
  const by = m.starts[1].y + 1.5;
  const blocked = new Uint8Array(N);
  for (const k of first) {
    const x = k % MAP_W;
    const y = (k / MAP_W) | 0;
    if (Math.hypot(x + 0.5 - ax, y + 0.5 - ay) <= spare || Math.hypot(x + 0.5 - bx, y + 0.5 - by) <= spare) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inBounds(x + dx, y + dy)) blocked[idx(x + dx, y + dy)] = 1;
  }
  return shortestWalk(m.tiles, a, b, blocked);
}

/** Ore fields: groups of ore tiles touching (eight ways). Returns each field's tiles. */
export function oreFields(ore: number[]): number[][] {
  const seen = new Uint8Array(N);
  const out: number[][] = [];
  for (let k = 0; k < N; k++) {
    if (seen[k] || ore[k] <= 0) continue;
    const group: number[] = [];
    const q = [k];
    seen[k] = 1;
    while (q.length) {
      const c = q.pop()!;
      group.push(c);
      const x = c % MAP_W;
      const y = (c / MAP_W) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!inBounds(x + dx, y + dy)) continue;
          const n = idx(x + dx, y + dy);
          if (seen[n] || ore[n] <= 0) continue;
          seen[n] = 1;
          q.push(n);
        }
    }
    out.push(group);
  }
  return out;
}

/** A base's own ore field lies within this many tiles of its yard's centre. */
export const HOME_FIELD_RANGE = 16;

/** The middle of an ore field, in tile coordinates. */
export function fieldCentre(tiles: number[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const k of tiles) {
    x += (k % MAP_W) + 0.5;
    y += ((k / MAP_W) | 0) + 0.5;
  }
  return { x: x / tiles.length, y: y / tiles.length };
}

/** Buildable tiles (walkable, no ore, outside the yard) within 8 tiles of a yard placed at `st`. */
export function baseGround(m: GeneratedMap, st: { x: number; y: number }): number {
  let n = 0;
  for (let y = st.y + 1 - 8; y <= st.y + 1 + 8; y++)
    for (let x = st.x + 1 - 8; x <= st.x + 1 + 8; x++) {
      if (!inBounds(x, y)) continue;
      if (x >= st.x && x < st.x + 3 && y >= st.y && y < st.y + 3) continue;
      const k = idx(x, y);
      if (isWalkable(m.tiles[k]) && m.ore[k] === 0) n++;
    }
  return n;
}

/** What is wrong with a skirmish map, or null if it meets every rule above. */
export function mapProblem(m: GeneratedMap): string | null {
  if (m.tiles.length !== N || m.ore.length !== N) return 'wrong size';
  for (let k = 0; k < N / 2; k++) if (m.tiles[k] !== m.tiles[mirrorOf(k)] || m.ore[k] !== m.ore[mirrorOf(k)]) return 'not symmetric';
  const [s0, s1] = m.starts;
  if (s1.x !== MAP_W - 1 - (s0.x + 2) || s1.y !== MAP_H - 1 - (s0.y + 2)) return 'starts not mirrored';
  if (s0.y < MAP_H / 2 || s1.y + 3 > MAP_H / 2) return 'side 0 must start in the bottom half, side 1 in the top';
  for (const st of m.starts)
    for (let y = st.y; y < st.y + 3; y++)
      for (let x = st.x; x < st.x + 3; x++) {
        if (!inBounds(x, y)) return 'yard off the map';
        const k = idx(x, y);
        if (!isWalkable(m.tiles[k]) || m.ore[k] > 0) return 'yard not on clear ground';
      }
  for (const st of m.starts) if (baseGround(m, st) < MIN_BASE_GROUND) return 'too little buildable ground by a base';
  const a = idx(s0.x + 1, s0.y + 1);
  const reach = flood(m.tiles, a);
  if (!reach[idx(s1.x + 1, s1.y + 1)]) return 'bases not connected';
  for (let k = 0; k < N; k++) {
    if (isWalkable(m.tiles[k]) && !reach[k]) return 'unreachable ground';
    if (m.ore[k] > 0 && !isWalkable(m.tiles[k])) return 'ore on unwalkable ground';
  }
  const fields = oreFields(m.ore).filter(f => f.length >= 5);
  if (fields.length < MIN_ORE_FIELDS || fields.length > MAX_ORE_FIELDS) return `${fields.length} ore fields`;
  // One near each base, an expansion of each side's own, and one contested between them.
  const c0 = { x: s0.x + 1.5, y: s0.y + 1.5 };
  const c1 = { x: s1.x + 1.5, y: s1.y + 1.5 };
  const centres = fields.map(fieldCentre);
  if (!centres.some(p => dist(p, c0) < HOME_FIELD_RANGE)) return 'no ore field near the bases';
  if (centres.filter(p => dist(p, c0) < dist(p, c1) - 3).length < 2) return 'no expansion';
  if (!centres.some(p => Math.abs(dist(p, c0) - dist(p, c1)) < 3)) return 'no contested ore field';
  if (!secondRoute(m).length) return 'only one route between the bases';
  return null;
}
