import type { MapType } from '../sim/rules';
import { TILE } from './art';
import { createTerrainPainter, type TerrainPainter } from './terrain';

/**
 * The ground, held a chunk at a time (2026-11-22). Painting a whole map onto one canvas made memory
 * grow with the map's area: a Huge map was a 5120-pixel square and the battle marks kept a second
 * copy (about 210 MB), and a Vast map at full resolution would have been 840 MB. Here the ground is
 * cut into CHUNK-pixel squares; only those near the camera are painted and kept, the ones furthest
 * from it are dropped once the total passes BUDGET_BYTES, and a dropped chunk is painted again,
 * exactly as before, when the camera comes back. Memory follows the size of the screen, not the map.
 *
 * - Painting runs in a worker (terrainWorker.ts), visible chunks first, a couple in flight at a time;
 *   without workers, a chunk a frame on the page. Until a chunk arrives the minimap's colours stand
 *   in for it, as they did for the whole map before.
 * - Each chunk's canvas reaches PAD pixels into its neighbours, and is drawn a pixel past its own
 *   edge, so a zoomed view (whose chunk edges fall between screen pixels) shows no seams.
 * - Marks (fx/scars.ts) and the water's animation (fx/water.ts) draw into the chunks that are loaded.
 *   A chunk holds a clean copy of itself (`pristine`) only once it needs one: when it is first marked,
 *   or when it has animated water, which redraws its tiles from it.
 * - Permanent marks (a structure's rubble, a missile's crater) are kept as a short log, each with
 *   its own seed, and drawn again into a chunk painted after it was dropped, so they last.
 */

/** A chunk's side, in world pixels (16 tiles). */
export const CHUNK = 512;
/** How far each chunk's canvas reaches into its neighbours. */
const PAD = 2;
/** Chunks this close to the view are painted ahead of it. */
const PREFETCH = 256;
/** Ground kept, live chunks and clean copies together, before the furthest are dropped. */
export const BUDGET_BYTES = 96 * 1024 * 1024;
/** Chunks being painted at once (in the worker). */
const IN_FLIGHT = 2;

interface Chunk {
  /** The canvas's place and size in world pixels (the chunk's own square plus PAD round it, inside the map). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The chunk's own square. */
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  live: HTMLCanvasElement | null;
  lctx: CanvasRenderingContext2D | null;
  pristine: HTMLCanvasElement | null;
  pctx: CanvasRenderingContext2D | null;
  /** The last view that wanted it. */
  used: number;
  pending: boolean;
}

/** A mark that never fades: drawn with its own seeded random numbers, so drawing it again gives the same picture. */
export interface PermanentMark {
  /** Everything it draws lies in this box (world pixels). */
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  draw(ctx: CanvasRenderingContext2D, rand: () => number): void;
}

/** A small seeded generator (mulberry32) for permanent marks. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class TerrainStore {
  readonly worldW: number;
  readonly worldH: number;
  private cols: number;
  private rows: number;
  private chunks: Chunk[] = [];
  private queue: number[] = [];
  private inFlight = 0;
  private worker: Worker | null = null;
  private painter: TerrainPainter | null = null;
  private marks: PermanentMark[] = [];
  private frame = 0;
  private bytes = 0;
  private nextId = 1;
  private requests = new Map<number, number>();
  private disposed = false;
  /** Told about each chunk that arrives, so the water there redraws. */
  onChunkReady: ((x: number, y: number, w: number, h: number) => void) | null = null;
  /** Whether a region needs a clean copy kept from the start (it has animated water). */
  needsPristine: ((x: number, y: number, w: number, h: number) => boolean) | null = null;
  /** Ground held now, and the most held at once (for the measurements in the build log). */
  get heldBytes(): number {
    return this.bytes;
  }
  peakBytes = 0;
  /** Chunks painted so far, including those painted again after being dropped. */
  painted = 0;

  constructor(
    private tiles: string,
    private mapType: MapType | undefined,
    private mapW: number,
    private mapH: number,
    private budget = BUDGET_BYTES,
  ) {
    this.worldW = mapW * TILE;
    this.worldH = mapH * TILE;
    this.cols = Math.ceil(this.worldW / CHUNK);
    this.rows = Math.ceil(this.worldH / CHUNK);
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cx0 = c * CHUNK;
        const cy0 = r * CHUNK;
        const cx1 = Math.min(this.worldW, cx0 + CHUNK);
        const cy1 = Math.min(this.worldH, cy0 + CHUNK);
        const x = Math.max(0, cx0 - PAD);
        const y = Math.max(0, cy0 - PAD);
        this.chunks.push({
          x,
          y,
          w: Math.min(this.worldW, cx1 + PAD) - x,
          h: Math.min(this.worldH, cy1 + PAD) - y,
          cx0,
          cy0,
          cx1,
          cy1,
          live: null,
          lctx: null,
          pristine: null,
          pctx: null,
          used: -1,
          pending: false,
        });
      }
    this.startWorker();
  }

  private startWorker() {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return;
    try {
      const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => this.received(e.data);
      w.onerror = () => this.workerFailed();
      w.postMessage({ type: 'init', tiles: this.tiles, mapType: this.mapType, mapW: this.mapW, mapH: this.mapH });
      this.worker = w;
    } catch {
      this.worker = null;
    }
  }

  /** The worker broke: everything it had in hand goes back on the queue for the page to paint. */
  private workerFailed() {
    this.worker?.terminate();
    this.worker = null;
    for (const k of this.requests.values()) this.chunks[k].pending = false;
    this.requests.clear();
    this.inFlight = 0;
  }

  private received(msg: { id: number; bitmap?: ImageBitmap; error?: string }) {
    const k = this.requests.get(msg.id);
    if (k === undefined) {
      msg.bitmap?.close();
      return;
    }
    this.requests.delete(msg.id);
    this.inFlight--;
    const ch = this.chunks[k];
    ch.pending = false;
    if (!msg.bitmap) {
      this.workerFailed();
      return;
    }
    if (this.disposed) {
      msg.bitmap.close();
      return;
    }
    const c = newCanvas(ch.w, ch.h);
    c.getContext('2d')!.drawImage(msg.bitmap, 0, 0);
    msg.bitmap.close();
    this.install(k, c);
  }

  /** A freshly painted chunk: its permanent marks drawn back in, a clean copy kept if it needs one. */
  private install(k: number, canvas: HTMLCanvasElement) {
    const ch = this.chunks[k];
    ch.live = canvas;
    ch.lctx = canvas.getContext('2d')!;
    this.bytes += ch.w * ch.h * 4;
    this.painted++;
    let marked = false;
    for (const m of this.marks) {
      if (!meets(ch, m.x, m.y, m.w, m.h)) continue;
      drawMark(ch.lctx, ch, m);
      marked = true;
    }
    if (marked || this.needsPristine?.(ch.x, ch.y, ch.w, ch.h)) this.keepPristine(ch);
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
    this.onChunkReady?.(ch.x, ch.y, ch.w, ch.h);
  }

  private keepPristine(ch: Chunk) {
    if (ch.pristine || !ch.live) return;
    ch.pristine = newCanvas(ch.w, ch.h);
    ch.pctx = ch.pristine.getContext('2d')!;
    ch.pctx.drawImage(ch.live, 0, 0);
    this.bytes += ch.w * ch.h * 4;
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
  }

  private drop(ch: Chunk) {
    if (ch.live) this.bytes -= ch.w * ch.h * 4;
    if (ch.pristine) this.bytes -= ch.w * ch.h * 4;
    // Zero-sized, so the browser lets the memory go now rather than at the next collection.
    if (ch.live) ch.live.width = ch.live.height = 0;
    if (ch.pristine) ch.pristine.width = ch.pristine.height = 0;
    ch.live = ch.pristine = null;
    ch.lctx = ch.pctx = null;
  }

  /**
   * Called each frame with the view (world pixels): wants the chunks it covers and those just past
   * it, paints what is missing (nearest the middle of the view first) and drops the furthest
   * chunks no longer wanted while the ground held is over budget.
   */
  view(x0: number, y0: number, x1: number, y1: number): void {
    const f = ++this.frame;
    const c0 = Math.max(0, Math.floor((x0 - PREFETCH) / CHUNK));
    const r0 = Math.max(0, Math.floor((y0 - PREFETCH) / CHUNK));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 + PREFETCH) / CHUNK));
    const r1 = Math.min(this.rows - 1, Math.floor((y1 + PREFETCH) / CHUNK));
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const missing: [number, number][] = [];
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const k = r * this.cols + c;
        const ch = this.chunks[k];
        ch.used = f;
        if (ch.live || ch.pending) continue;
        // Inside the view itself first, then by distance from its middle.
        const inside = ch.cx1 > x0 && ch.cx0 < x1 && ch.cy1 > y0 && ch.cy0 < y1;
        missing.push([k, (inside ? 0 : 1e9) + Math.hypot((ch.cx0 + ch.cx1) / 2 - mx, (ch.cy0 + ch.cy1) / 2 - my)]);
      }
    missing.sort((a, b) => a[1] - b[1]);
    this.queue = missing.map(m => m[0]);
    this.pump();
    this.evict(f);
  }

  private pump() {
    if (this.worker) {
      while (this.inFlight < IN_FLIGHT && this.queue.length) {
        const k = this.queue.shift()!;
        const ch = this.chunks[k];
        const id = this.nextId++;
        ch.pending = true;
        this.requests.set(id, k);
        this.inFlight++;
        this.worker.postMessage({ type: 'paint', id, x: ch.x, y: ch.y, w: ch.w, h: ch.h });
      }
      return;
    }
    // No worker: one chunk a frame, on the page.
    const k = this.queue.shift();
    if (k === undefined) return;
    if (!this.painter) this.painter = createTerrainPainter(this.tiles, this.mapType, this.mapW, this.mapH);
    const ch = this.chunks[k];
    this.install(k, this.painter.paint(ch.x, ch.y, ch.w, ch.h));
  }

  private evict(f: number) {
    if (this.bytes <= this.budget) return;
    const held = this.chunks.filter(c => c.live && c.used < f).sort((a, b) => a.used - b.used);
    for (const ch of held) {
      if (this.bytes <= this.budget) break;
      this.drop(ch);
    }
  }

  /**
   * Draws the ground in the region (world pixels) with the context's own transform: each loaded
   * chunk's square, a pixel past its edges to cover the seam, or the stand-in for one not painted yet.
   */
  draw(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, placeholder: HTMLCanvasElement | null): void {
    const c0 = Math.max(0, Math.floor(sx / CHUNK));
    const r0 = Math.max(0, Math.floor(sy / CHUNK));
    const c1 = Math.min(this.cols - 1, Math.floor((sx + sw - 1) / CHUNK));
    const r1 = Math.min(this.rows - 1, Math.floor((sy + sh - 1) / CHUNK));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const ch = this.chunks[r * this.cols + c];
        if (!ch.live) {
          if (placeholder) {
            const T = TILE;
            ctx.drawImage(placeholder, ch.cx0 / T, ch.cy0 / T, (ch.cx1 - ch.cx0) / T, (ch.cy1 - ch.cy0) / T, ch.cx0, ch.cy0, ch.cx1 - ch.cx0, ch.cy1 - ch.cy0);
          }
          continue;
        }
        // The chunk's square grown by a pixel (never past its canvas), cut to the region drawn.
        const ax = Math.max(sx, ch.cx0 - 1, ch.x);
        const ay = Math.max(sy, ch.cy0 - 1, ch.y);
        const bx = Math.min(sx + sw, ch.cx1 + 1, ch.x + ch.w);
        const by = Math.min(sy + sh, ch.cy1 + 1, ch.y + ch.h);
        if (bx <= ax || by <= ay) continue;
        ctx.drawImage(ch.live, ax - ch.x, ay - ch.y, bx - ax, by - ay, ax, ay, bx - ax, by - ay);
      }
  }

  /** Whether the ground under a world pixel is painted and held. */
  loadedAt(x: number, y: number): boolean {
    const c = Math.floor(x / CHUNK);
    const r = Math.floor(y / CHUNK);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return !!this.chunks[r * this.cols + c].live;
  }

  /** Each loaded chunk meeting a box (world pixels). */
  private each(x: number, y: number, w: number, h: number, fn: (ch: Chunk) => void) {
    const c0 = Math.max(0, Math.floor((x - PAD) / CHUNK));
    const r0 = Math.max(0, Math.floor((y - PAD) / CHUNK));
    const c1 = Math.min(this.cols - 1, Math.floor((x + w + PAD) / CHUNK));
    const r1 = Math.min(this.rows - 1, Math.floor((y + h + PAD) / CHUNK));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const ch = this.chunks[r * this.cols + c];
        if (ch.live && meets(ch, x, y, w, h)) fn(ch);
      }
  }

  /**
   * Draws onto the live ground in a box, in world pixels, in every loaded chunk it meets. `mark`:
   * something that will fade (a clean copy is kept first, to fade back to). Chunks not loaded are
   * skipped: a passing mark is not worth painting ground for.
   */
  paintLive(x: number, y: number, w: number, h: number, fn: (ctx: CanvasRenderingContext2D) => void, mark = false): void {
    this.each(x, y, w, h, ch => {
      if (mark) this.keepPristine(ch);
      const g = ch.lctx!;
      g.save();
      g.translate(-ch.x, -ch.y);
      fn(g);
      g.restore();
    });
  }

  /** Copies the clean ground back over a box, at `alpha` (1 replaces it, less blends towards it). */
  restore(x: number, y: number, w: number, h: number, alpha = 1): void {
    this.each(x, y, w, h, ch => {
      if (!ch.pristine) return;
      const ax = Math.max(x, ch.x);
      const ay = Math.max(y, ch.y);
      const bx = Math.min(x + w, ch.x + ch.w);
      const by = Math.min(y + h, ch.y + ch.h);
      if (bx <= ax || by <= ay) return;
      const g = ch.lctx!;
      g.globalAlpha = alpha;
      g.drawImage(ch.pristine, ax - ch.x, ay - ch.y, bx - ax, by - ay, ax - ch.x, ay - ch.y, bx - ax, by - ay);
      g.globalAlpha = 1;
    });
  }

  /** A mark that lasts the battle: drawn into the clean ground and the live ground, and remembered. */
  permanent(m: PermanentMark): void {
    this.marks.push(m);
    this.each(m.x, m.y, m.w, m.h, ch => {
      this.keepPristine(ch);
      drawMark(ch.pctx!, ch, m);
    });
    this.restore(m.x, m.y, m.w, m.h, 1);
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const ch of this.chunks) this.drop(ch);
  }
}

function meets(ch: Chunk, x: number, y: number, w: number, h: number): boolean {
  return x < ch.x + ch.w && y < ch.y + ch.h && x + w > ch.x && y + h > ch.y;
}

function drawMark(g: CanvasRenderingContext2D, ch: Chunk, m: PermanentMark) {
  g.save();
  g.translate(-ch.x, -ch.y);
  m.draw(g, seeded(m.seed));
  g.restore();
}
