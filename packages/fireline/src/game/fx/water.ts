import { TILE } from '../art';
import type { TerrainStore } from '../terrainStore';

/**
 * Water that moves: glints of light that drift and twinkle over the water, and foam lapping along
 * the shore.
 *
 * Everything is painted into small strips, one per way a water tile can border land (which of its
 * eight neighbours are land), each sixteen frames of a four-second loop, exactly one tile tall.
 * A strip is painted the first time a tile of its shape comes into view, so only the shapes the
 * map actually has cost anything. The animation then lives in the ground's chunks themselves
 * (terrainStore.ts): when a tile in view is due its next frame (about four times a second, each
 * tile at its own point in the loop), the tile's clean ground is copied back from its chunk's clean
 * copy and the new frame drawn over it. That is a few dozen one-tile copies a frame, offscreen, and nothing at all added to the
 * frame's fill: the water arrives with the terrain blit the renderer does anyway. Drawing it per
 * frame instead (paths, or a sprite per tile) cost three to five milliseconds a frame on a machine
 * without a GPU.
 *
 * The foam follows the coast terrain.ts painted. That shoreline is the contour of a smooth field
 * (1 at water tile centres, 0 at land, sampled with smoothstepped bilinear interpolation between
 * centres, then roughened a little by noise), so each strip rebuilds the same field from the
 * tile's 3x3 neighbourhood, leaving out the noise, and lays its foam as bands a pixel or two wide
 * just offshore of the waterline, measured in pixels by dividing by the field's slope. The bands
 * lap in and out and are broken into pieces that drift along the shore.
 */

const FRAMES = 16;
const LOOP_SECONDS = 4;

function hash(n: number): number {
  let h = Math.imul(n ^ 0x27d4eb2d, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The eight neighbours, with the bit each sets in a land mask when it is land: N, NE, E, SE, S, SW, W, NW. */
const NEIGHBOURS: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

const ss = (v: number) => v * v * (3 - 2 * v);

/**
 * The field for one land mask, per pixel of a tile, and its slope in field units per pixel. Same
 * sampling as terrain.ts's `sample`: pixel x maps to x / TILE - 0.5 in tile-centre coordinates.
 */
function fieldFor(mask: number): { v: Float32Array; slope: Float32Array } {
  const g = new Float32Array(9);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) g[(j + 1) * 3 + i + 1] = 1;
  NEIGHBOURS.forEach(([dx, dy], b) => {
    if (mask & (1 << b)) g[(dy + 1) * 3 + dx + 1] = 0;
  });
  const at = (x: number, y: number) => {
    const gx = x / TILE - 0.5;
    const gy = y / TILE - 0.5;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = ss(gx - ix);
    const fy = ss(gy - iy);
    const k = (iy + 1) * 3 + ix + 1;
    const a = g[k] + (g[k + 1] - g[k]) * fx;
    const b = g[k + 3] + (g[k + 4] - g[k + 3]) * fx;
    return a + (b - a) * fy;
  };
  const v = new Float32Array(TILE * TILE);
  const slope = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const c = at(x, y);
      v[y * TILE + x] = c;
      const sx = (at(x + 0.5, y) - at(x - 0.5, y));
      const sy = (at(x, y + 0.5) - at(x, y - 0.5));
      slope[y * TILE + x] = Math.max(0.012, Math.hypot(sx, sy));
    }
  return { v, slope };
}

/** Paints one land mask's strip: FRAMES frames side by side, each one tile. */
function paintStrip(mask: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE * FRAMES;
  c.height = TILE;
  const ctx = c.getContext('2d')!;
  ctx.lineCap = 'round';
  const { v, slope } = fieldFor(mask);
  const shore = mask !== 0;
  // Glints, fewer near the shore, at fixed spots well out on the water that each fade in and out on
  // their own phase.
  const glints: { x: number; y: number; len: number; phase: number }[] = [];
  const want = shore ? 2 : 3;
  for (let i = 0; i < 8 && glints.length < want; i++) {
    const gx = 4 + hash(mask * 31 + i * 7 + 1) * (TILE - 14);
    const gy = 4 + hash(mask * 17 + i * 13 + 2) * (TILE - 8);
    if (v[Math.floor(gy) * TILE + Math.floor(gx)] < 0.85) continue;
    glints.push({ x: gx, y: gy, len: 3 + hash(mask * 5 + i + 3) * 4, phase: glints.length / want + hash(mask + i * 3) * 0.2 });
  }
  const img = shore ? ctx.createImageData(TILE, TILE) : null;
  for (let f = 0; f < FRAMES; f++) {
    const p = f / FRAMES;
    if (img) {
      const d = img.data;
      const w1 = Math.sin(p * Math.PI * 2);
      const w2 = Math.sin((p + 0.45) * Math.PI * 2);
      // Where each band sits, in pixels offshore of the waterline (field 0.5), as it laps.
      const off1 = 2.2 + w1 * 1.1;
      const off2 = 5.2 + w2 * 1.4;
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const k = y * TILE + x;
          const val = v[k];
          const i = k * 4;
          d[i + 3] = 0;
          if (val < 0.42 || val > 0.97) continue;
          // Distance offshore of the waterline, in pixels.
          const dist = (val - 0.5) / slope[k];
          // Pieces drifting along the shore: two travelling waves whose periods divide the tile, so
          // the pattern meets itself across tile edges.
          const ph = p * Math.PI * 2;
          const gap1 = Math.sin(((x + y) / 16) * Math.PI * 2 + ph) * 0.6 + Math.sin(((x - y) / 32) * Math.PI * 2 - ph) * 0.4;
          const gap2 = Math.sin(((x - y) / 16) * Math.PI * 2 - ph) * 0.6 + Math.sin(((x + y) / 32) * Math.PI * 2 + ph) * 0.4;
          const a1 = Math.max(0, 1 - Math.abs(dist - off1) / 1.1) * Math.min(1, Math.max(0, (gap1 + 0.35) * 1.8)) * (0.62 - 0.12 * w1);
          const a2 = Math.max(0, 1 - Math.abs(dist - off2) / 0.9) * Math.min(1, Math.max(0, (gap2 + 0.1) * 1.6)) * 0.3;
          const a = Math.min(1, a1 + a2);
          if (a <= 0.01) continue;
          d[i] = 236;
          d[i + 1] = 248;
          d[i + 2] = 250;
          d[i + 3] = Math.round(a * 255);
        }
      ctx.putImageData(img, f * TILE, 0);
    }
    for (const g of glints) {
      const c2 = (p + g.phase) % 1;
      const a = Math.sin(c2 * Math.PI);
      if (a < 0.15) continue;
      const gx = f * TILE + g.x + (c2 - 0.5) * 5;
      ctx.strokeStyle = `rgba(205,235,248,${(a * 0.5).toFixed(3)})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(gx, g.y);
      ctx.quadraticCurveTo(gx + g.len / 2, g.y - 1.2, gx + g.len, g.y);
      ctx.stroke();
    }
  }
  return c;
}

export class Water {
  /** Per tile: -1 not animated, else the land mask (which of its eight neighbours are land). */
  private mask: Int16Array;
  private phase: Float32Array;
  /** Per tile: the frame now painted into the ground, or -1. */
  private shown: Int8Array;
  /** The map's size in tiles. */
  private mapW: number;
  private mapH: number;
  /** Each land mask's strip of frames, painted on first sight (paintStrip). */
  private strips: (HTMLCanvasElement | undefined)[] = new Array(256);
  /** The ground, held a chunk at a time; a chunk with animated water keeps a clean copy to redraw its tiles from. */
  private store: TerrainStore;
  private count = 0;

  constructor(store: TerrainStore, tiles: string, mapW: number, mapH: number) {
    this.store = store;
    const MAP_W = (this.mapW = mapW);
    const MAP_H = (this.mapH = mapH);
    this.mask = new Int16Array(MAP_W * MAP_H).fill(-1);
    this.phase = new Float32Array(MAP_W * MAP_H);
    this.shown = new Int8Array(MAP_W * MAP_H).fill(-1);
    // Off the map the ground repeats its edge, as terrain.ts's sampling does.
    const at = (x: number, y: number) => tiles[Math.min(MAP_H - 1, Math.max(0, y)) * MAP_W + Math.min(MAP_W - 1, Math.max(0, x))];
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        const k = y * MAP_W + x;
        if (tiles[k] !== 'w') continue;
        let m = 0;
        NEIGHBOURS.forEach(([dx, dy], b) => {
          if (at(x + dx, y + dy) !== 'w') m |= 1 << b;
        });
        // Open water away from the shore twinkles on only some tiles, so it does not look tiled.
        if (m === 0 && hash(k * 7 + 3) < 0.4) continue;
        this.mask[k] = m;
        this.count++;
        // Neighbours along a shore start close together in the loop, so the foam seems to travel.
        this.phase[k] = (((x * 0.07 + y * 0.05) % 1) + hash(k) * 0.25) % 1;
      }
  }

  /** Whether any animated tile lies in a region (world pixels): its chunk keeps a clean copy from the start. */
  animatedIn(x: number, y: number, w: number, h: number): boolean {
    if (!this.count) return false;
    const x0 = Math.max(0, Math.floor(x / TILE));
    const y0 = Math.max(0, Math.floor(y / TILE));
    const x1 = Math.min(this.mapW - 1, Math.floor((x + w - 1) / TILE));
    const y1 = Math.min(this.mapH - 1, Math.floor((y + h - 1) / TILE));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.mask[ty * this.mapW + tx] >= 0) return true;
    return false;
  }

  /** Something repainted this region of the ground (a fade, a chunk arriving): its water tiles must redraw. */
  invalidate(x: number, y: number, w: number, h: number): void {
    const MAP_W = this.mapW;
    const MAP_H = this.mapH;
    const x0 = Math.max(0, Math.floor(x / TILE));
    const y0 = Math.max(0, Math.floor(y / TILE));
    const x1 = Math.min(MAP_W - 1, Math.floor((x + w - 1) / TILE));
    const y1 = Math.min(MAP_H - 1, Math.floor((y + h - 1) / TILE));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.shown[ty * MAP_W + tx] = -1;
  }

  /**
   * Brings the water tiles in the given window up to date in the ground: each due its next frame
   * has its clean ground copied back and the frame drawn over it. Tiles whose chunk is not painted
   * yet wait (the chunk's arrival invalidates them).
   */
  update(t: number, tx0: number, ty0: number, tx1: number, ty1: number): void {
    if (!this.count) return;
    const MAP_W = this.mapW;
    const strips = this.strips;
    const loop = t / LOOP_SECONDS;
    for (let y = ty0; y <= ty1; y++)
      for (let x = tx0; x <= tx1; x++) {
        const k = y * MAP_W + x;
        const m = this.mask[k];
        if (m < 0) continue;
        const px = x * TILE;
        const py = y * TILE;
        if (!this.store.loadedAt(px, py)) continue;
        const f = Math.floor((((loop + this.phase[k]) % 1) + 1) % 1 * FRAMES) % FRAMES;
        if (this.shown[k] === f) continue;
        this.shown[k] = f;
        this.store.restore(px, py, TILE, TILE, 1);
        const strip = strips[m] ?? (strips[m] = paintStrip(m));
        this.store.paintLive(px, py, TILE, TILE, c => c.drawImage(strip, f * TILE, 0, TILE, TILE, px, py, TILE, TILE));
      }
  }
}
