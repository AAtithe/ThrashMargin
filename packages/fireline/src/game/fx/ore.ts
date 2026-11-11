import { ORE_TILE_MAX } from '../../sim/rules';
import { TILE } from '../art';

/**
 * Ore fields. Each tile with ore gets a soft mineral stain wider than the tile, so neighbouring
 * tiles run together into one field with a ragged edge rather than a grid of discs, then a cluster
 * of faceted crystals that grows with what is left in it, then now and then a glint of light off a
 * facet. The stains and clusters are painted once (the clusters at the zoom they are drawn at, like
 * the unit sprites in art.ts) and stamped, so a large field costs a handful of copies a tile.
 *
 * Everything is decided by a hash of the tile index, so a field looks the same every frame and
 * shrinks crystal by crystal as it is mined.
 */

const TAU = Math.PI * 2;
/** Cluster looks per size: enough that a field does not repeat to the eye. */
const VARIANTS = 6;
/** Cluster sizes: 1 (nearly mined out) to LEVELS (full). */
const LEVELS = 6;
/** Half the side of a cluster sprite, in world pixels: crystals lean a little out of their tile. */
const HALF = 22;
/** How far a cluster may stray from its tile's middle, in world pixels, so a field has no rows. */
const JITTER = 14;
/** Half the side of a stain, in world pixels. */
const STAIN = 30;

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rnd(seed: number) {
  let i = 0;
  return () => hash(seed * 7919 + i++);
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

let stains: HTMLCanvasElement[] | null = null;
let glint: HTMLCanvasElement | null = null;
const clusters = new Map<string, HTMLCanvasElement>();

/**
 * Mineral-stained ground: an irregular blot of ochre and rust, darker in the middle, speckled with
 * grit, fading out well past the tile's edge. Four shapes, painted at twice world size.
 */
function stainSprites(): HTMLCanvasElement[] {
  if (stains) return stains;
  stains = [];
  for (let v = 0; v < 4; v++) {
    const S = STAIN * 4;
    const c = canvas(S, S);
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    const r = rnd(7100 + v);
    // A few overlapping soft lobes make the outline irregular.
    for (let i = 0; i < 7; i++) {
      const a = r() * TAU;
      const d = i === 0 ? 0 : 6 + r() * 9;
      const cx = STAIN + Math.cos(a) * d;
      const cy = STAIN + Math.sin(a) * d;
      const rad = (i === 0 ? 22 : 11 + r() * 10) * 1;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grad.addColorStop(0, i % 3 === 2 ? 'rgba(128,74,30,0.5)' : 'rgba(118,92,34,0.58)');
      grad.addColorStop(0.55, 'rgba(112,88,36,0.28)');
      grad.addColorStop(1, 'rgba(110,86,36,0)');
      g.fillStyle = grad;
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    // Grit: dark and pale specks, thicker towards the middle.
    for (let i = 0; i < 70; i++) {
      const a = r() * TAU;
      const d = Math.sqrt(r()) * 20;
      const x = STAIN + Math.cos(a) * d;
      const y = STAIN + Math.sin(a) * d;
      g.fillStyle = r() < 0.6 ? 'rgba(52,38,16,0.45)' : 'rgba(226,196,112,0.4)';
      const s = 0.6 + r() * 0.9;
      g.fillRect(x, y, s, s);
    }
    stains.push(c);
  }
  return stains;
}

/** A four-pointed glint, white at the core: drawn with 'lighter'. */
function glintSprite(): HTMLCanvasElement {
  if (glint) return glint;
  const c = canvas(32, 32);
  const g = c.getContext('2d')!;
  const halo = g.createRadialGradient(16, 16, 0, 16, 16, 9);
  halo.addColorStop(0, 'rgba(255,246,200,0.9)');
  halo.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = 'rgba(255,252,230,0.95)';
  for (const [w, h] of [
    [1.2, 15],
    [15, 1.2],
  ]) {
    g.beginPath();
    g.moveTo(16 - w, 16);
    g.lineTo(16, 16 - h);
    g.lineTo(16 + w, 16);
    g.lineTo(16, 16 + h);
    g.closePath();
    g.fill();
  }
  glint = c;
  return c;
}

/**
 * One crystal seen from above and a little south: a long six-sided shard lying at angle `a`, its
 * lit face toward the top left, its shaded face away, a pale ridge down the middle and a hard
 * highlight near the tip.
 */
function crystal(g: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, a: number) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const P = (u: number, v: number): [number, number] => [x + ca * u - sa * v, y + sa * u + ca * v];
  const tip = P(len, 0);
  const tail = P(-len * 0.45, 0);
  const l1 = P(len * 0.55, -wid);
  const l0 = P(-len * 0.3, -wid);
  const r1 = P(len * 0.55, wid);
  const r0 = P(-len * 0.3, wid);
  // Contact shadow, down and to the right.
  g.fillStyle = 'rgba(30,20,6,0.45)';
  g.beginPath();
  g.moveTo(tip[0] + 1.6, tip[1] + 2);
  g.lineTo(l1[0] + 1.6, l1[1] + 2);
  g.lineTo(l0[0] + 1.6, l0[1] + 2);
  g.lineTo(tail[0] + 1.6, tail[1] + 2);
  g.lineTo(r0[0] + 1.6, r0[1] + 2);
  g.lineTo(r1[0] + 1.6, r1[1] + 2);
  g.closePath();
  g.fill();
  // Which long face catches the light from the top left (light direction (-1, -1)).
  const leftLit = ca - sa > 0;
  const face = (pts: [number, number][], col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fill();
  };
  face([tip, l1, l0, tail], leftLit ? '#f4d566' : '#a77d1c');
  face([tip, r1, r0, tail], leftLit ? '#a77d1c' : '#f4d566');
  // The ridge.
  g.strokeStyle = 'rgba(255,244,190,0.85)';
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(tail[0], tail[1]);
  g.lineTo(tip[0], tip[1]);
  g.stroke();
  // A dark edge round the shard keeps it crisp on the stain.
  g.strokeStyle = 'rgba(70,46,8,0.75)';
  g.lineWidth = 0.6;
  g.beginPath();
  g.moveTo(tip[0], tip[1]);
  g.lineTo(l1[0], l1[1]);
  g.lineTo(l0[0], l0[1]);
  g.lineTo(tail[0], tail[1]);
  g.lineTo(r0[0], r0[1]);
  g.lineTo(r1[0], r1[1]);
  g.closePath();
  g.stroke();
  // Highlight near the tip.
  const h = P(len * 0.62, 0);
  g.fillStyle = 'rgba(255,253,235,0.95)';
  g.beginPath();
  g.arc(h[0] - 0.4, h[1] - 0.4, Math.max(0.6, wid * 0.32), 0, TAU);
  g.fill();
}

/** A cluster of `level` crystals (1..LEVELS) radiating from a common root, painted at `res`. */
function clusterSprite(variant: number, level: number, res: number): HTMLCanvasElement {
  const key = `${variant}/${level}@${res}`;
  let c = clusters.get(key);
  if (c) return c;
  const size = Math.ceil(HALF * 2 * res);
  c = canvas(size, size);
  const g = c.getContext('2d')!;
  g.scale(res, res);
  g.translate(HALF, HALF);
  const r = rnd(3300 + variant);
  // Pebbles of ore lying loose round the cluster.
  for (let i = 0; i < 4 + level; i++) {
    const a = r() * TAU;
    const d = 6 + r() * 9;
    g.fillStyle = r() < 0.5 ? '#c99a2c' : '#8a6a18';
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.7 + r() * 0.8, 0, TAU);
    g.fill();
  }
  // The shards grow upward from one or two roots, fanned like a druse: the tallest in the middle,
  // shorter ones leaning out to either side. A full tile has a second, smaller druse beside the first.
  const shards: { x: number; y: number; len: number; wid: number; a: number }[] = [];
  const roots = level >= 4 ? 2 : 1;
  for (let j = 0; j < roots; j++) {
    const n = j === 0 ? level - (roots - 1) * 2 : 2;
    const rx = j === 0 ? (r() - 0.5) * 5 : (r() < 0.5 ? -1 : 1) * (7 + r() * 3);
    const ry = (j === 0 ? 4 : 7) + (r() - 0.5) * 4;
    const scale = j === 0 ? 1 : 0.7;
    g.fillStyle = 'rgba(60,40,10,0.5)';
    g.beginPath();
    g.ellipse(rx + 1, ry + 1, (3 + n * 0.9) * scale, (1.8 + n * 0.4) * scale, 0, 0, TAU);
    g.fill();
    for (let i = 0; i < n; i++) {
      const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;
      const a = -Math.PI / 2 + spread * (0.75 + r() * 0.25) + (r() - 0.5) * 0.25;
      const len = (Math.abs(spread) < 0.35 ? 6.5 + n * 0.8 : 4 + r() * 3) * scale;
      shards.push({ x: rx + Math.cos(a) * len * 0.45, y: ry + Math.sin(a) * len * 0.45, len, wid: len * (0.26 + r() * 0.08), a });
    }
  }
  // Leaning shards behind, the upright ones in front.
  shards.sort((p, q) => Math.abs(q.a + Math.PI / 2) - Math.abs(p.a + Math.PI / 2));
  for (const s of shards) crystal(g, s.x, s.y, s.len, s.wid, s.a);
  clusters.set(key, c);
  return c;
}

/**
 * Draws every explored ore tile in the window from (tx0, ty0) to (tx1, ty1): stains first, all of
 * them, so a cluster is never covered by its neighbour's stain, then clusters, then glints.
 * `sparkle` false (motion off) holds the glints still.
 */
export function drawOreField(
  ctx: CanvasRenderingContext2D,
  ore: ArrayLike<number>,
  explored: string,
  mapW: number,
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
  t: number,
  sparkle: boolean,
): void {
  const st = stainSprites();
  const m = ctx.getTransform();
  const res = Math.max(1, Math.min(4, Math.ceil(Math.hypot(m.a, m.b) * 2) / 2));
  const ys: number[] = [];
  for (let y = ty0; y <= ty1; y++)
    for (let x = tx0; x <= tx1; x++) {
      const k = y * mapW + x;
      if (ore[k] > 0 && explored.charCodeAt(k) === 49) ys.push(k);
    }
  if (!ys.length) return;
  for (const k of ys) {
    const x = (k % mapW) * TILE + TILE / 2;
    const y = ((k / mapW) | 0) * TILE + TILE / 2;
    const h = hash(k * 17 + 5);
    ctx.globalAlpha = 0.6 + 0.4 * Math.min(1, ore[k] / ORE_TILE_MAX);
    // A tile on the field's edge keeps its stain closer, so the field does not spill onto a cliff
    // top or a structure beside it.
    const inner = ore[k - 1] > 0 && ore[k + 1] > 0 && ore[k - mapW] > 0 && ore[k + mapW] > 0;
    const s = STAIN * (inner ? 0.9 + h * 0.25 : 0.62 + h * 0.1);
    const j = inner ? 6 : 0;
    ctx.drawImage(st[(k * 7 + (h * 4) | 0) & 3], x - s + (h - 0.5) * j, y - s + (hash(k) - 0.5) * j, s * 2, s * 2);
  }
  ctx.globalAlpha = 1;
  for (const k of ys) {
    const x = (k % mapW) * TILE + TILE / 2 + (hash(k * 3 + 1) - 0.5) * JITTER;
    const y = ((k / mapW) | 0) * TILE + TILE / 2 + (hash(k * 5 + 2) - 0.5) * JITTER;
    const level = Math.max(1, Math.min(LEVELS, Math.ceil((ore[k] / ORE_TILE_MAX) * LEVELS)));
    const half = HALF * (0.85 + hash(k * 19 + 7) * 0.3);
    ctx.drawImage(clusterSprite(Math.floor(hash(k * 11 + 3) * VARIANTS), level, res), x - half, y - half, half * 2, half * 2);
  }
  // Glints: each tile has one facet that catches the sun every few seconds, at its own moment.
  const gl = glintSprite();
  let lit = false;
  for (const k of ys) {
    const ph = hash(k * 13 + 9);
    const w = sparkle ? Math.sin(t * (0.9 + ph * 0.8) + ph * 40) : ph > 0.85 ? 1 : 0;
    if (w < 0.94) continue;
    if (!lit) {
      ctx.globalCompositeOperation = 'lighter';
      lit = true;
    }
    const a = (w - 0.94) / 0.06;
    const x = (k % mapW) * TILE + TILE / 2 + (hash(k * 3 + 1) - 0.5) * JITTER + (ph - 0.5) * 6;
    const y = ((k / mapW) | 0) * TILE + TILE / 2 + (hash(k * 5 + 2) - 0.5) * JITTER - 4;
    const s = 5 + a * 4;
    ctx.globalAlpha = Math.min(1, a * 1.2);
    ctx.drawImage(gl, x - s, y - s, s * 2, s * 2);
  }
  if (lit) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
