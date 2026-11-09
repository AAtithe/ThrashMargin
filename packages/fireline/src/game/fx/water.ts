import { TILE } from '../art';

/**
 * Water that moves: glints of light that drift and twinkle over the water, and foam lapping along
 * the shore.
 *
 * Everything is painted once, when the battle opens, into a small atlas: for each of the sixteen
 * ways a water tile can border land, sixteen frames of a four-second loop, each exactly one tile in
 * size. The animation then lives in the terrain canvas itself: when a tile in view is due its next
 * frame (about four times a second, each tile at its own point in the loop), the tile's untouched
 * ground is copied back from a saved copy and the new frame drawn over it. That is a few dozen
 * one-tile copies a frame, offscreen, and nothing at all added to the frame's fill: the water
 * arrives with the terrain blit the renderer does anyway. Drawing it per frame instead (paths, or
 * a sprite per tile) cost three to five milliseconds a frame on a machine without a GPU.
 *
 * The foam sits a few pixels inside the waterline the terrain painted (each water tile is a blob of
 * radius about 19 around its centre), so it stays within its own tile.
 */

const FRAMES = 16;
const LOOP_SECONDS = 4;

function hash(n: number): number {
  let h = Math.imul(n ^ 0x27d4eb2d, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Bit for each side facing land: east 1, south 2, west 4, north 8. */
const SIDES: [number, number, number, number][] = [
  [1, 0, 0, 1],
  [0, 1, Math.PI / 2, 2],
  [-1, 0, Math.PI, 4],
  [0, -1, -Math.PI / 2, 8],
];

function paintAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE * FRAMES;
  c.height = TILE * 16;
  const ctx = c.getContext('2d')!;
  ctx.lineCap = 'round';
  const H = TILE / 2;
  for (let mask = 0; mask < 16; mask++) {
    // Glints, fewer near the shore, at fixed spots that each fade in and out on their own phase.
    const glints: { x: number; y: number; len: number; phase: number }[] = [];
    const n = mask ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(hash(mask * 31 + i * 7 + 1)) * (mask ? 6 : 9);
      const a = hash(mask * 17 + i * 13 + 2) * Math.PI * 2;
      glints.push({ x: Math.cos(a) * r - 3, y: Math.sin(a) * r, len: 3 + hash(mask * 5 + i + 3) * 4, phase: i / n + hash(mask + i * 3) * 0.2 });
    }
    for (let f = 0; f < FRAMES; f++) {
      const ox = f * TILE + H;
      const oy = mask * TILE + H;
      const p = f / FRAMES;
      ctx.save();
      ctx.beginPath();
      ctx.rect(f * TILE, mask * TILE, TILE, TILE);
      ctx.clip();
      for (const g of glints) {
        const c2 = (p + g.phase) % 1;
        const a = Math.sin(c2 * Math.PI);
        if (a < 0.15) continue;
        const gx = ox + g.x + (c2 - 0.5) * 5;
        ctx.strokeStyle = `rgba(205,235,248,${(a * 0.5).toFixed(3)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(gx, oy + g.y);
        ctx.quadraticCurveTo(gx + g.len / 2, oy + g.y - 1.2, gx + g.len, oy + g.y);
        ctx.stroke();
      }
      // Foam: an outer line and an inner one lapping in and out of step, broken into pieces that
      // drift along the shore.
      for (const [, , ang, bit] of SIDES) {
        if (!(mask & bit)) continue;
        for (let pass = 0; pass < 2; pass++) {
          const wave = Math.sin((p + pass * 0.3 + bit * 0.13) * Math.PI * 2);
          const r = (pass ? 10.5 : 13.8) + wave * 1.2;
          ctx.strokeStyle = pass ? 'rgba(215,238,245,0.3)' : 'rgba(235,248,250,0.55)';
          ctx.lineWidth = pass ? 1 : 1.5;
          const pieces = pass ? 4 : 3;
          const span = 1.7 / pieces;
          const drift = (pass ? -p : p) * span;
          for (let k = -1; k <= pieces; k++) {
            const a0 = Math.max(ang - 0.85, ang - 0.85 + (k + drift) * span);
            const a1 = Math.min(ang + 0.85, ang - 0.85 + (k + drift) * span + span * (pass ? 0.35 : 0.6));
            if (a1 <= a0) continue;
            ctx.beginPath();
            ctx.arc(ox, oy, r, a0, a1);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
  }
  return c;
}

export class Water {
  /** Per tile: -1 not animated, else the land mask (which sides face land). */
  private mask: Int8Array;
  private phase: Float32Array;
  /** Per tile: the frame now painted into the terrain, or -1. */
  private shown: Int8Array;
  /** Per tile: where its untouched ground sits in `base`, or -1. */
  private slot: Int32Array;
  /** The map's size in tiles, read from the terrain canvas. */
  private mapW: number;
  private mapH: number;
  private base: HTMLCanvasElement | null = null;
  private atlas: HTMLCanvasElement | null = null;
  private terrain: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;
  private count = 0;

  constructor(tiles: string, terrain: HTMLCanvasElement) {
    this.terrain = terrain;
    this.tctx = terrain.getContext('2d')!;
    const MAP_W = (this.mapW = Math.round(terrain.width / TILE));
    const MAP_H = (this.mapH = Math.round(terrain.height / TILE));
    this.mask = new Int8Array(MAP_W * MAP_H).fill(-1);
    this.phase = new Float32Array(MAP_W * MAP_H);
    this.shown = new Int8Array(MAP_W * MAP_H).fill(-1);
    this.slot = new Int32Array(MAP_W * MAP_H).fill(-1);
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 'w' : tiles[y * MAP_W + x]);
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        const k = y * MAP_W + x;
        if (tiles[k] !== 'w') continue;
        let m = 0;
        for (const [dx, dy, , bit] of SIDES) if (at(x + dx, y + dy) !== 'w') m |= bit;
        // Open water away from the shore twinkles on only some tiles, so it does not look tiled.
        if (m === 0 && hash(k * 7 + 3) < 0.4) continue;
        this.mask[k] = m;
        this.slot[k] = this.count++;
        // Neighbours along a shore start close together in the loop, so the foam seems to travel.
        this.phase[k] = (((x * 0.07 + y * 0.05) % 1) + hash(k) * 0.25) % 1;
      }
  }

  /** Something repainted this region of the terrain: its water tiles must redraw. */
  invalidate(x: number, y: number, w: number, h: number): void {
    const MAP_W = this.mapW;
    const MAP_H = this.mapH;
    const x0 = Math.max(0, Math.floor(x / TILE));
    const y0 = Math.max(0, Math.floor(y / TILE));
    const x1 = Math.min(MAP_W - 1, Math.floor((x + w - 1) / TILE));
    const y1 = Math.min(MAP_H - 1, Math.floor((y + h - 1) / TILE));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.shown[ty * MAP_W + tx] = -1;
  }

  /** Brings the water tiles in the given window up to date, in the terrain canvas. */
  update(t: number, tx0: number, ty0: number, tx1: number, ty1: number): void {
    if (!this.count) return;
    const MAP_W = this.mapW;
    const MAP_H = this.mapH;
    if (!this.atlas) {
      this.atlas = paintAtlas();
      // Save every animated tile's ground before the first frame is drawn over it.
      const cols = 32;
      const b = document.createElement('canvas');
      b.width = cols * TILE;
      b.height = Math.ceil(this.count / cols) * TILE;
      const bctx = b.getContext('2d')!;
      for (let k = 0; k < MAP_W * MAP_H; k++) {
        const s = this.slot[k];
        if (s < 0) continue;
        bctx.drawImage(this.terrain, (k % MAP_W) * TILE, Math.floor(k / MAP_W) * TILE, TILE, TILE, (s % cols) * TILE, Math.floor(s / cols) * TILE, TILE, TILE);
      }
      this.base = b;
    }
    const atlas = this.atlas;
    const base = this.base!;
    const c = this.tctx;
    const loop = t / LOOP_SECONDS;
    for (let y = ty0; y <= ty1; y++)
      for (let x = tx0; x <= tx1; x++) {
        const k = y * MAP_W + x;
        const m = this.mask[k];
        if (m < 0) continue;
        const f = Math.floor((((loop + this.phase[k]) % 1) + 1) % 1 * FRAMES) % FRAMES;
        if (this.shown[k] === f) continue;
        this.shown[k] = f;
        const s = this.slot[k];
        const px = x * TILE;
        const py = y * TILE;
        c.drawImage(base, (s % 32) * TILE, Math.floor(s / 32) * TILE, TILE, TILE, px, py, TILE, TILE);
        c.drawImage(atlas, f * TILE, m * TILE, TILE, TILE, px, py, TILE, TILE);
      }
  }
}
