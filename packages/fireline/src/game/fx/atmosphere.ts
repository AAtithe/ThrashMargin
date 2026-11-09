import { MAP_H as DEFAULT_MAP_H, MAP_W as DEFAULT_MAP_W } from '../../sim/rules';
import { TILE } from '../art';

/**
 * Weather and lens: slow cloud shadows drifting across the battlefield, and a soft vignette that
 * darkens the edges of the view.
 *
 * Both are soft enough to be worked out once per tile, so they ride along in the fog canvas the
 * renderer already draws every frame (64 by 64 pixels, scaled up with smoothing): `shade()` gives
 * each tile's extra darkness, and the renderer folds it into the fog's alpha. That makes them free
 * in fill cost, where two more full-screen layers would have taken a fifth of the frame on a
 * machine without a GPU.
 */

/** Cloud noise lattice, periodic, in cells. */
const CELLS = 24;
/** Tiles per lattice cell: clouds a few hundred pixels across. */
const CELL_TILES = 3.2;

export interface View {
  x: number;
  y: number;
  zoom: number;
  w: number;
  h: number;
}

export class Atmosphere {
  private lattice = new Float32Array(CELLS * CELLS);
  private out: Uint8Array;
  /** The map's width in tiles. */
  private mapW: number;

  constructor(mapW = DEFAULT_MAP_W, mapH = DEFAULT_MAP_H) {
    this.mapW = mapW;
    this.out = new Uint8Array(mapW * mapH);
    // Value noise, part blurred (big soft masses) and part raw (ragged edges), stretched to 0..1.
    const a = new Float32Array(CELLS * CELLS).map(() => Math.random());
    const at = (x: number, y: number) => a[((y + CELLS) % CELLS) * CELLS + ((x + CELLS) % CELLS)];
    let lo = 1;
    let hi = 0;
    for (let y = 0; y < CELLS; y++)
      for (let x = 0; x < CELLS; x++) {
        let blur = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) blur += at(x + dx, y + dy);
        const v = (blur / 25) * 0.7 + at(x, y) * 0.3;
        this.lattice[y * CELLS + x] = v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    for (let i = 0; i < this.lattice.length; i++) this.lattice[i] = (this.lattice[i] - lo) / (hi - lo || 1);
  }

  private sample(fx: number, fy: number): number {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    let sx = fx - x0;
    let sy = fy - y0;
    sx = sx * sx * (3 - 2 * sx);
    sy = sy * sy * (3 - 2 * sy);
    const xa = ((x0 % CELLS) + CELLS) % CELLS;
    const ya = ((y0 % CELLS) + CELLS) % CELLS;
    const xb = (xa + 1) % CELLS;
    const yb = (ya + 1) % CELLS;
    const L = this.lattice;
    const top = L[ya * CELLS + xa] + (L[ya * CELLS + xb] - L[ya * CELLS + xa]) * sx;
    const bot = L[yb * CELLS + xa] + (L[yb * CELLS + xb] - L[yb * CELLS + xa]) * sx;
    return top + (bot - top) * sy;
  }

  /**
   * Per tile, 0..255: how much darker cloud shadow and vignette make it this frame. Only the tiles
   * from (tx0, ty0) to (tx1, ty1) are worked out; the rest are off screen and keep stale values.
   */
  shade(t: number, cam: View, tx0: number, ty0: number, tx1: number, ty1: number): Uint8Array {
    const out = this.out;
    const ox = t * 0.34; // Tiles per second the clouds drift east...
    const oy = t * 0.12; // ...and south.
    const inv = 1 / CELL_TILES;
    const halfW = cam.w / 2 || 1;
    const halfH = cam.h / 2 || 1;
    const z = cam.zoom;
    for (let y = ty0; y <= ty1; y++) {
      const syn = (((y + 0.5) * TILE - cam.y) * z - halfH) / halfH;
      for (let x = tx0; x <= tx1; x++) {
        const n = this.sample((x - ox) * inv, (y - oy) * inv);
        const cloud = n > 0.52 ? Math.min(1, (n - 0.52) * 4) * 0.22 : 0;
        const sxn = (((x + 0.5) * TILE - cam.x) * z - halfW) / halfW;
        // Elliptical distance from the middle of the view: 0 there, 1 at the middle of an edge.
        const d = Math.sqrt(sxn * sxn + syn * syn);
        const e = d > 0.7 ? Math.min(1, (d - 0.7) / 0.7) : 0;
        const vig = e * e * 0.5;
        out[y * this.mapW + x] = Math.round(255 * (1 - (1 - cloud) * (1 - vig)));
      }
    }
    return out;
  }
}
