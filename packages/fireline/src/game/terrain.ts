import { MAP_H as DEFAULT_MAP_H, MAP_W as DEFAULT_MAP_W, type MapType } from '../sim/rules';

// Every painter takes the map's size (GameState mapW, mapH); left out, the original 64 by 64.
import { ART } from '../theme';
import { TILE } from './art';

/**
 * The ground, painted once per battle onto an offscreen canvas and copied to the screen a window
 * at a time. Terrain never changes, so none of this runs per frame.
 *
 * Randomness here is decoration only, from a hash of the tile index, so the same map always
 * paints the same way. It never touches the simulation.
 *
 * Order: grass (base tone, soft patches, broad light and dry zones, blades, tufts, flowers), dirt,
 * water (sandy bank, wet sand, shallows, open water, deep water, foam, ripples), rock outcrops
 * (cast shadow, cliff face, lit rim, top, facets, cracks, scree at the foot), fords, reeds, trees.
 * Light comes from the top left, as it does on the units and structures.
 *
 * Each skirmish map type has its own look (LOOKS): highland cliffs stand taller over heather and
 * moss, the canyon's walls are banded sandstone over a dusty floor, lakes have wide beaches and
 * lily pads, river banks are thick with reeds, and the plains are bright with flowers. Fords are
 * found from the tiles alone: open ground with water on both sides of it, in a line, is shallow
 * water over a stony bed, drawn so it reads as a crossing (it is walkable, like any dirt).
 */

type Rgb = [number, number, number];

interface Look {
  /** A wash over all the grass, and how strongly. */
  tint: Rgb | null;
  tintAlpha: number;
  /** Strength of the broad dry and lush zones. */
  dry: number;
  lush: number;
  /** Chance of a flower cluster on a grass tile, and their colours. */
  flowers: number;
  flowerCols: string[];
  /** Rock top and cliff face colours, cliff height in pixels, sandstone banding, moss on the tops. */
  rockTop: Rgb;
  rockFace: Rgb;
  cliff: number;
  strata: number;
  moss: number;
  /** Boulder and scree colours: light, mid, dark. */
  stone: [string, string, string];
  /** Where the sandy bank starts, on the blurred water field (lower is a wider beach). */
  beach: number;
  /** Chance per try of a reed clump on a shore tile, and of lily pads on water by the shore. */
  reeds: number;
  lilies: number;
  /** Dirt colour, mid and dark. */
  dirt: Rgb;
  dirtDark: Rgb;
  /** Gloom on the ground at the foot of the cliffs, and scrub growing on the tops. */
  ao: number;
  scrub: number;
}

/**
 * Maps up to this many tiles wide (or tall) paint their terrain at full resolution, TILE canvas
 * pixels to a tile. Wider ones (the Vast size) paint at half that, so the canvas is never more than
 * 5120 pixels a side, as on a Huge map: at full resolution a 320-tile map would be a 10240-pixel
 * square, about 420 MB, and the battle marks (fx/scars.ts) keep a second copy of it.
 */
export const TERRAIN_FULL_RES_TILES = 160;

/** Canvas pixels per world pixel for a map's terrain: 1, or 0.5 on a map wider than TERRAIN_FULL_RES_TILES. */
export const terrainScale = (mapW: number, mapH: number): number => (Math.max(mapW, mapH) > TERRAIN_FULL_RES_TILES ? 0.5 : 1);

function hash(n: number): number {
  let h = (n * 374761393) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rnd(seed: number) {
  let i = 0;
  return () => hash(seed * 7919 + i++);
}

/** Canvas-only shades that sit between ART's tones. */
const DRY_GRASS = '#7a8440';
const LUSH_GRASS = '#3b5a28';
const FLOWERS = ['#ece6cf', '#e8c84a', '#b99ad6', '#e39bb2', '#f2f0e8'];

const CLASSIC: Look = {
  tint: null,
  tintAlpha: 0,
  dry: 0.2,
  lush: 0.26,
  flowers: 0.05,
  flowerCols: FLOWERS,
  rockTop: [124, 120, 111],
  rockFace: [70, 66, 59],
  cliff: 9,
  strata: 0,
  moss: 0,
  stone: [ART.rockLight, ART.rock, ART.rockDark],
  beach: 0.16,
  reeds: 0.35,
  lilies: 0,
  dirt: [123, 100, 70],
  dirtDark: [92, 73, 49],
  ao: 0,
  scrub: 0,
};

export const LOOKS: Record<MapType, Look> = {
  classic: CLASSIC,
  river: { ...CLASSIC, lush: 0.34, dry: 0.12, reeds: 1, lilies: 0.12 },
  highlands: {
    ...CLASSIC,
    tint: [112, 104, 66],
    tintAlpha: 0.16,
    dry: 0.28,
    lush: 0.18,
    flowers: 0.09,
    flowerCols: ['#8e5f9e', '#a874b4', '#7b4f8c', '#c9a6d4', '#e8d77a'],
    rockTop: [118, 121, 112],
    rockFace: [58, 59, 54],
    cliff: 14,
    moss: 0.45,
    ao: 0.22,
    scrub: 0.18,
    stone: ['#a9ab9f', '#777a70', '#474a43'],
    reeds: 0.25,
  },
  lakes: { ...CLASSIC, beach: 0.08, reeds: 0.8, lilies: 0.3, lush: 0.3 },
  // Sandy shores and fewer reeds: open sea, not still water.
  coast: { ...CLASSIC, beach: 0.42, reeds: 0.12, lilies: 0, lush: 0.24, dry: 0.24 },
  plains: {
    ...CLASSIC,
    tint: [168, 162, 74],
    tintAlpha: 0.14,
    dry: 0.3,
    lush: 0.2,
    flowers: 0.12,
    flowerCols: ['#f2e15a', '#ece6cf', '#e39bb2', '#f5f3ea', '#e8a640'],
    reeds: 0.4,
  },
  canyon: {
    ...CLASSIC,
    tint: [178, 150, 98],
    tintAlpha: 0.24,
    dry: 0.36,
    lush: 0.1,
    flowers: 0.015,
    flowerCols: ['#e8c84a', '#e39b6a', '#f2f0e8'],
    rockTop: [166, 124, 88],
    rockFace: [112, 66, 42],
    cliff: 16,
    strata: 1,
    moss: 0,
    ao: 0.3,
    scrub: 0.3,
    stone: ['#d2a578', '#a8764e', '#6e4630'],
    reeds: 0.2,
    dirt: [146, 112, 76],
    dirtDark: [112, 82, 54],
  },
};

/**
 * Fords: open ground (dirt) lying between water on both sides in a line, within three tiles each
 * way. Returns, per tile, 0 for none, 1 for a crossing whose water lies east and west of it, 2 for
 * one whose water lies north and south (the way the stream runs past it).
 */
export function fordsOf(tiles: string, mapW = DEFAULT_MAP_W, mapH = DEFAULT_MAP_H): Uint8Array {
  const MAP_W = mapW;
  const MAP_H = mapH;
  const out = new Uint8Array(MAP_W * MAP_H);
  const w = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && tiles[y * MAP_W + x] === 'w';
  // Water on a side counts when there is a body of it, not a puddle: three or more water tiles
  // in the three-wide band reaching out that way.
  const reach = (x: number, y: number, dx: number, dy: number) => {
    let n = 0;
    for (let i = 1; i <= 3; i++) for (let j = -1; j <= 1; j++) if (w(x + dx * i + dy * j, y + dy * i + dx * j)) n++;
    return n >= 3;
  };
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (tiles[y * MAP_W + x] !== 'd') continue;
      if (reach(x, y, -1, 0) && reach(x, y, 1, 0)) out[y * MAP_W + x] = 1;
      else if (reach(x, y, 0, -1) && reach(x, y, 0, 1)) out[y * MAP_W + x] = 2;
    }
  return out;
}

export function paintTerrain(tiles: string, mapType?: MapType, mapW = DEFAULT_MAP_W, mapH = DEFAULT_MAP_H): HTMLCanvasElement {
  const MAP_W = mapW;
  const MAP_H = mapH;
  const L = (mapType && LOOKS[mapType]) || CLASSIC;
  const fords = fordsOf(tiles, MAP_W, MAP_H);
  // Everything below is drawn in world pixels (TILE to a tile). On a map wider than
  // TERRAIN_FULL_RES_TILES the canvas holds fewer pixels than that (terrainScale) and the context is
  // scaled to match; the per-pixel pass works out one world pixel in every 1 / scale each way.
  const WW = MAP_W * TILE;
  const HH = MAP_H * TILE;
  const scale = terrainScale(MAP_W, MAP_H);
  const c = newCanvas(Math.round(WW * scale), Math.round(HH * scale));
  const ctx = c.getContext('2d')!;
  if (scale !== 1) ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 'g' : tiles[y * MAP_W + x]);
  const TAU = Math.PI * 2;

  // 1. Grass everywhere: one base tone, then large soft patches of the others, so there is no
  // tile grid to see.
  ctx.fillStyle = ART.grass[0];
  ctx.fillRect(0, 0, WW, HH);
  const patches = rnd(424242);
  for (let i = 0; i < MAP_W * MAP_H * 0.7; i++) {
    const px = patches() * WW;
    const py = patches() * HH;
    const rad = 18 + patches() * 46;
    const col = ART.grass[1 + Math.floor(patches() * (ART.grass.length - 1))];
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = g;
    ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  // Broad zones of drier and lusher ground, a few hundred pixels across, so a large field reads
  // as country rather than carpet.
  const zones = rnd(90210);
  for (let i = 0; i < 46; i++) {
    const px = zones() * WW;
    const py = zones() * HH;
    const rad = 110 + zones() * 190;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, i % 2 ? DRY_GRASS : LUSH_GRASS);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = i % 2 ? L.dry : L.lush;
    ctx.fillStyle = g;
    ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  ctx.globalAlpha = 1;
  // Blades: thin, leaning a little either way, wide at the root and pointed at the tip. Two
  // blocks of BLADE_BLOCK pixels are painted (each batched into one path per shade and strength)
  // and laid over the map, block by block, each picked and mirrored by a hash of where it lies.
  // Filling a map's worth of slanted blades one by one took seconds on a large map.
  const blocks = [bladeBlock(1), bladeBlock(2)];
  for (let by = 0; by * BLADE_BLOCK < HH; by++)
    for (let bx = 0; bx * BLADE_BLOCK < WW; bx++) {
      const h = hash(by * 7919 + bx * 31 + 5);
      ctx.save();
      ctx.translate(bx * BLADE_BLOCK + (h < 0.5 ? 0 : BLADE_BLOCK), by * BLADE_BLOCK);
      if (h >= 0.5) ctx.scale(-1, 1);
      ctx.drawImage(blocks[hash(by * 31 + bx * 7919 + 9) < 0.5 ? 0 : 1], 0, 0);
      ctx.restore();
    }
  // Tufts: a fan of blades, dark at the root and lit at the tips on the side toward the light.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== 'g') continue;
      const r = rnd(y * MAP_W + x + 60606);
      const n = r() < 0.45 ? 1 + Math.floor(r() * 2) : 0;
      for (let k = 0; k < n; k++) {
        const bx = x * TILE + 3 + r() * (TILE - 6);
        const by = y * TILE + 6 + r() * (TILE - 8);
        ctx.fillStyle = 'rgba(20,30,10,0.25)';
        ctx.beginPath();
        ctx.ellipse(bx + 1.5, by + 0.8, 3.5, 1.4, 0, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 1;
        for (let b = 0; b < 6; b++) {
          const a = -Math.PI / 2 + (b - 2.5) * 0.28 + (r() - 0.5) * 0.2;
          const len = 3.5 + r() * 3.5;
          ctx.strokeStyle = b < 3 ? ART.grassLight : ART.grassDark;
          ctx.beginPath();
          ctx.moveTo(bx + (b - 2.5) * 0.5, by);
          ctx.lineTo(bx + (b - 2.5) * 0.5 + Math.cos(a) * len, by + Math.sin(a) * len);
          ctx.stroke();
        }
      }
      // Now and then a small cluster of flowers.
      if (r() < L.flowers) {
        const fx = x * TILE + 6 + r() * (TILE - 12);
        const fy = y * TILE + 6 + r() * (TILE - 12);
        const col = L.flowerCols[Math.floor(r() * L.flowerCols.length)];
        const m = 3 + Math.floor(r() * 5);
        for (let k = 0; k < m; k++) {
          const px = fx + (r() - 0.5) * 9;
          const py = fy + (r() - 0.5) * 7;
          ctx.fillStyle = 'rgba(30,45,20,0.5)';
          ctx.fillRect(px - 0.2, py, 0.8, 2);
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(px, py, 0.9 + r() * 0.5, 0, TAU);
          ctx.fill();
        }
      }
    }

  // The type's wash over the grass, blades and flowers alike (the canyon's dust, the plains' gold).
  if (L.tint) {
    ctx.globalAlpha = L.tintAlpha;
    ctx.fillStyle = `rgb(${L.tint[0]},${L.tint[1]},${L.tint[2]})`;
    ctx.fillRect(0, 0, WW, HH);
    ctx.globalAlpha = 1;
  }

  // 1b. Relief: a gentle rolling height field, lit from the top left, so open country reads as
  // ground that rises and falls rather than a flat sheet. Worked out at one sample per RELIEF
  // pixels and stretched with smoothing (it has no detail finer than that), and laid over the
  // grass only: dirt, water and rock below carry their own shading.
  relief(ctx, MAP_W * TILE, MAP_H * TILE);

  // 2, 3 and 4. Dirt, water and rock, shaded per pixel in one pass over the painted ground. Each is a field
  // sampled smoothly between tile centres and roughened with noise, so its outline follows the
  // tiles without showing them. Dirt is mottled, speckled and soft-edged. Water bands outward from open water through shallows, a foam
  // line, wet sand and a sandy bank fading into the grass. Rock is a raised plateau seen from a
  // little south: its top is drawn lifted by CLIFF_H pixels and shaded by the slope of a height
  // field (lit on the top-left rims, dark on the bottom-right), the strip it uncovers is the cliff
  // face, and it casts a shadow down and to the right.
  {
    // W and H are world pixels; CW is the canvas's own width. `st` is the step between the world
    // pixels worked out (1, or 2 at half resolution), and `cell` turns a world pixel into its index
    // in the band's image (identical to before at full resolution).
    const W = WW;
    const H = HH;
    const CW = c.width;
    const st = 1 / scale;
    const cell = (x: number, y: number) => (((y - y0) * scale) * CW + x * scale) * 4;
    // Drawn into a transparent layer and composited over the grass, rather than read back from
    // the canvas: a read-back of the whole map costs more than everything else here put together.
    // Round 5: the layer is worked a band of BAND tile rows at a time (every pass for one band,
    // then the next), so its pixels and the height cache are a band's worth rather than the whole
    // map's (on a 160-tile map, 10 MB a band against 105 MB for the whole). Each pixel goes
    // through the same passes in the same order, so the result is the same.
    const BAND = 16;
    let y0 = 0;
    let img = ctx.createImageData(CW, Math.round(Math.min(H, BAND * TILE) * scale));
    let px = img.data;
    const fieldOf = (ch: string) => {
      const f = new Float32Array(MAP_W * MAP_H);
      for (let k = 0; k < MAP_W * MAP_H; k++) f[k] = tiles[k] === ch ? 1 : 0;
      return f;
    };
    const blur = (f: Float32Array, rad: number) => {
      const o = new Float32Array(f.length);
      for (let y = 0; y < MAP_H; y++)
        for (let x = 0; x < MAP_W; x++) {
          let s = 0;
          let n = 0;
          for (let j = -rad; j <= rad; j++)
            for (let i = -rad; i <= rad; i++) {
              const xx = Math.min(MAP_W - 1, Math.max(0, x + i));
              const yy = Math.min(MAP_H - 1, Math.max(0, y + j));
              s += f[yy * MAP_W + xx];
              n++;
            }
          o[y * MAP_W + x] = s / n;
        }
      return o;
    };
    /** Smooth interpolation of a tile field at a pixel; outside the map it repeats the edge. */
    const sample = (f: Float32Array, x: number, y: number) => {
      let gx = x / TILE - 0.5;
      let gy = y / TILE - 0.5;
      gx = gx < 0 ? 0 : gx > MAP_W - 1.001 ? MAP_W - 1.001 : gx;
      gy = gy < 0 ? 0 : gy > MAP_H - 1.001 ? MAP_H - 1.001 : gy;
      const ix = gx | 0;
      const iy = gy | 0;
      let fx = gx - ix;
      let fy = gy - iy;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const k = iy * MAP_W + ix;
      const a = f[k] + (f[k + 1] - f[k]) * fx;
      const b = f[k + MAP_W] + (f[k + MAP_W + 1] - f[k + MAP_W]) * fx;
      return a + (b - a) * fy;
    };
    // Value noise on two lattices, precomputed.
    const lattice = (step: number, seed: number) => {
      const n = Math.ceil(W / step) + 2;
      const g = new Float32Array(n * n);
      for (let k = 0; k < g.length; k++) g[k] = hash(seed * 131071 + k);
      return { g, n, step };
    };
    const noise = (l: { g: Float32Array; n: number; step: number }, x: number, y: number) => {
      const gx = Math.max(0, x) / l.step;
      const gy = Math.max(0, y) / l.step;
      const m = l.n - 1;
      let fx = gx - (gx | 0);
      let fy = gy - (gy | 0);
      const ix = (gx | 0) % m;
      const iy = (gy | 0) % m;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const k = iy * l.n + ix;
      const a = l.g[k] + (l.g[k + 1] - l.g[k]) * fx;
      const b = l.g[k + l.n] + (l.g[k + l.n + 1] - l.g[k + l.n]) * fx;
      return a + (b - a) * fy;
    };
    const n6 = lattice(6, 11);
    const n14 = lattice(14, 23);
    const n40 = lattice(40, 37);
    /** Whether a tile has any of the field in it or around it (`up` more rows below, for the lifted rock). */
    const near = (f: Float32Array, x: number, y: number, up: number, diagonals = true) => {
      for (let j = -1; j <= 1 + up; j++)
        for (let i = -1; i <= 1; i++) {
          if (!diagonals && i !== 0 && j !== 0) continue;
          const xx = x + i;
          const yy = y + j;
          if (xx >= 0 && yy >= 0 && xx < MAP_W && yy < MAP_H && f[yy * MAP_W + xx] > 0) return true;
        }
      return false;
    };
    /** Paint a colour at strength `a` over whatever the layer already holds there. */
    const mix = (i: number, r: number, g: number, b: number, a: number) => {
      if (a <= 0) return;
      if (a > 1) a = 1;
      const da = px[i + 3] / 255;
      const k = da * (1 - a);
      const oa = a + k;
      px[i] = (r * a + px[i] * k) / oa;
      px[i + 1] = (g * a + px[i + 1] * k) / oa;
      px[i + 2] = (b * a + px[i + 2] * k) / oa;
      px[i + 3] = oa * 255;
    };
    const ss = (e0: number, e1: number, v: number) => {
      const t = v <= e0 ? 0 : v >= e1 ? 1 : (v - e0) / (e1 - e0);
      return t * t * (3 - 2 * t);
    };

    const dirtBin = fieldOf('d');
    const dirtBlur = blur(dirtBin, 1);
    const dirt = dirtBin.map((v, k) => v * 0.5 + dirtBlur[k] * 0.5);
    const DIRT = L.dirt;
    const DIRT_DARK = L.dirtDark;
    const DIRT_LIGHT: [number, number, number] = [150, 128, 92];
    const dirtPass = (t0: number, t1: number) => {
      for (let ty = t0; ty < t1; ty++)
        for (let tx = 0; tx < MAP_W; tx++) {
          if (!near(dirtBin, tx, ty, 0, false)) continue;
          for (let y = ty * TILE; y < (ty + 1) * TILE; y += st)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x += st) {
              const v = sample(dirt, x, y) + (noise(n6, x, y) - 0.5) * 0.16 + (noise(n14, x + 900, y) - 0.5) * 0.2 + (noise(n40, x + 900, y) - 0.5) * 0.3;
              if (v < 0.36) continue;
              const i = cell(x, y);
              const m = noise(n14, x + 200, y + 100);
              const dk = ss(0.35, 0.75, noise(n40, x + 400, y + 700)) * 0.6;
              const sh = 0.9 + m * 0.2;
              let r = (DIRT[0] + (DIRT_DARK[0] - DIRT[0]) * dk) * sh;
              let g = (DIRT[1] + (DIRT_DARK[1] - DIRT[1]) * dk) * sh;
              let b = (DIRT[2] + (DIRT_DARK[2] - DIRT[2]) * dk) * sh;
              const lt = ss(0.6, 0.9, noise(n40, x + 1300, y + 200)) * 0.5;
              r += (DIRT_LIGHT[0] - r) * lt;
              g += (DIRT_LIGHT[1] - g) * lt;
              b += (DIRT_LIGHT[2] - b) * lt;
              const speck = hash(y * W + x);
              if (speck < 0.03) (r *= 0.75), (g *= 0.75), (b *= 0.75);
              else if (speck > 0.975) (r = r * 1.2 + 10), (g = g * 1.2 + 10), (b = b * 1.2 + 8);
              // A darker rim where the dirt meets the grass, like a trodden edge.
              const rim = 1 - ss(0.4, 0.5, v) * 0.12 - (1 - ss(0.44, 0.56, v)) * 0.08;
              mix(i, r * rim, g * rim, b * rim, ss(0.36, 0.46, v));
            }
        }
    };

    const water = fieldOf('w');
    const deep = blur(water, 2);
    const SAND: [number, number, number] = [185, 162, 119];
    const WET: [number, number, number] = [150, 134, 96];
    const SHALLOW: [number, number, number] = [64, 122, 138];
    const OPEN: [number, number, number] = [43, 90, 115];
    const DEEP: [number, number, number] = [28, 64, 85];
    const waterPass = (t0: number, t1: number) => {
      for (let ty = t0; ty < t1; ty++)
        for (let tx = 0; tx < MAP_W; tx++) {
          if (!near(water, tx, ty, 0)) continue;
          for (let y = ty * TILE; y < (ty + 1) * TILE; y += st)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x += st) {
              const v = sample(water, x, y) + (noise(n6, x, y) - 0.5) * 0.12 + (noise(n40, x, y) - 0.5) * 0.22;
              if (v < L.beach) continue;
              const i = cell(x, y);
              if (v < 0.5) {
                mix(i, SAND[0], SAND[1], SAND[2], ss(L.beach, L.beach + 0.16, v) * (0.85 + noise(n6, x + 300, y) * 0.15));
                mix(i, WET[0], WET[1], WET[2], ss(0.4, 0.47, v) * 0.9);
                mix(i, 222, 236, 232, (1 - Math.abs(v - 0.485) / 0.02) * 0.7);
              } else {
                const t = ss(0.5, 0.64, v);
                const sh = 0.94 + noise(n14, x, y) * 0.12;
                let r = (SHALLOW[0] + (OPEN[0] - SHALLOW[0]) * t) * sh;
                let g = (SHALLOW[1] + (OPEN[1] - SHALLOW[1]) * t) * sh;
                let b = (SHALLOW[2] + (OPEN[2] - SHALLOW[2]) * t) * sh;
                const dd = ss(0.6, 1, sample(deep, x, y)) * 0.85;
                r += (DEEP[0] - r) * dd;
                g += (DEEP[1] - g) * dd;
                b += (DEEP[2] - b) * dd;
                mix(i, r, g, b, ss(0.5, 0.52, v) * 0.6 + 0.4);
              }
            }
        }
    };

    // Fords: shallow water over a stony bed, fading into the banks at each end and into the deep
    // water on each side, with the current's streaks running the way the stream flows.
    const fordBin = new Float32Array(MAP_W * MAP_H);
    for (let k = 0; k < fordBin.length; k++) fordBin[k] = fords[k] ? 1 : 0;
    const fordBlur = blur(fordBin, 1);
    const fordF = fordBin.map((v, k) => v * 0.6 + fordBlur[k] * 0.4);
    const BED: Rgb = [128, 116, 92];
    const SHOAL: Rgb = [86, 140, 146];
    const fordPass = (t0: number, t1: number) => {
      for (let ty = t0; ty < t1; ty++)
        for (let tx = 0; tx < MAP_W; tx++) {
          if (!near(fordBin, tx, ty, 0)) continue;
          const along = fords[ty * MAP_W + tx] || fords[ty * MAP_W + Math.min(MAP_W - 1, tx + 1)] || 1;
          for (let y = ty * TILE; y < (ty + 1) * TILE; y += st)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x += st) {
              const v = sample(fordF, x, y) + (noise(n6, x + 70, y) - 0.5) * 0.18 + (noise(n14, x, y + 40) - 0.5) * 0.24;
              if (v < 0.24) continue;
              // Fading out over the deep water's edge, so the shallows shelve into it.
              const wv = sample(water, x, y) + (noise(n14, x + 50, y) - 0.5) * 0.2;
              const a = ss(0.24, 0.5, v) * (1 - ss(0.45, 0.95, wv));
              if (a <= 0) continue;
              const i = cell(x, y);
              const m = noise(n6, x * 1.3 + 11, y * 1.3);
              const bed = 0.82 + m * 0.3;
              mix(i, BED[0] * bed, BED[1] * bed, BED[2] * bed, a);
              // The water over it, deeper toward the middle of the crossing.
              const depth = 0.35 + 0.35 * ss(0.4, 0.9, v);
              mix(i, SHOAL[0], SHOAL[1], SHOAL[2], a * depth);
              // Streaks of the current.
              const sx = along === 1 ? x * 0.25 : x * 2.4;
              const sy = along === 1 ? y * 2.4 : y * 0.25;
              const streak = noise(n14, sx + 333, sy + 777);
              if (streak > 0.68) mix(i, 205, 230, 232, a * (streak - 0.68) * 2.2);
            }
        }
    };

    const rock = fieldOf('r');
    const rockAo = blur(rock, 1);
    const CLIFF_H = L.cliff;
    // Heights are read several times per pixel (slope, cliff depth, shadow), so each is worked
    // out once and kept.
    // The cache covers the band and HMARGIN rows either side of it (every lookup reaches at most
    // CLIFF_H + 2 rows down and half that up); a lookup outside it is worked out uncached.
    const HMARGIN = 64;
    const hcache = new Float32Array(W * (BAND * TILE + 2 * HMARGIN));
    let hy0 = 0;
    let hy1 = 0;
    const height = (x: number, y: number) => {
      const inside = x >= 0 && y >= hy0 && x < W && y < hy1;
      if (inside) {
        const v = hcache[(y - hy0) * W + x];
        if (v >= 0) return v;
      }
      const v = ss(0.36, 0.64, sample(rock, x, y) + (noise(n6, x, y) - 0.5) * 0.16 + (noise(n14, x, y) - 0.5) * 0.18);
      if (inside) hcache[(y - hy0) * W + x] = v;
      return v;
    };
    const TOP = L.rockTop;
    const FACE = L.rockFace;
    const rockPass = (t0: number, t1: number) => {
      for (let ty = t0; ty < t1; ty++)
        for (let tx = 0; tx < MAP_W; tx++) {
          if (!near(rock, tx, ty, 1)) continue;
          for (let y = ty * TILE; y < (ty + 1) * TILE; y += st)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x += st) {
              const i = cell(x, y);
              const ht = height(x, y + CLIFF_H);
              const hb = height(x, y);
              if (ht > 0.45) {
                // Top: slope shading toward a light in the top left, mottling, and fine cracks.
                const gx = height(x + 2, y + CLIFF_H) - height(x - 2, y + CLIFF_H);
                const gy = height(x, y + CLIFF_H + 2) - height(x, y + CLIFF_H - 2);
                const lit = (gx + gy) * 1.6;
                const m = noise(n14, x * 1.7, y * 1.7) * 0.6 + noise(n6, x, y) * 0.4;
                const crack = Math.abs(noise(n14, x + 500, y + 500) - 0.5) < 0.012 * st ? 0.7 : 1;
                const k = (0.8 + m * 0.4 + lit) * crack;
                const a = ss(0.45, 0.55, ht);
                if (a < 1 && hb > 0.5) mix(i, FACE[0], FACE[1], FACE[2], 1);
                mix(i, TOP[0] * k, TOP[1] * k, TOP[2] * k, a);
                if (L.moss > 0) {
                  // Moss and turf in the hollows of the tops.
                  const ms = ss(0.55, 0.8, noise(n40, x + 2100, y + 900)) * ss(0.4, 0.7, noise(n6, x * 1.5, y * 1.5 + 300));
                  if (ms > 0) mix(i, 82 * k, 104 * k, 52 * k, a * ms * L.moss * 1.6);
                }
                if (L.strata > 0) {
                  // Sandstone bedding, faint across the tops.
                  const band = Math.sin((y + noise(n40, x, y + 500) * 30) * 0.42);
                  if (band > 0.6) mix(i, TOP[0] * 1.12, TOP[1] * 1.08, TOP[2] * 1.02, a * (band - 0.6) * 0.5 * L.strata);
                }
              } else if (hb > 0.4) {
                // Cliff face: vertical strata, darker toward its foot.
                const streak = noise(n6, x * 2.2, y * 0.25);
                const foot = ss(0.4, 1, hb) * 0.25 + 0.75;
                let depth = 0;
                for (let d = 1; d <= CLIFF_H; d += 2) if (height(x, y + CLIFF_H - d) > 0.45) depth = d;
                let k = (0.7 + streak * 0.45) * foot * (1 - (CLIFF_H - depth) * (0.27 / CLIFF_H));
                if (L.strata > 0) {
                  // Banded sandstone: alternating light and dark layers, wavering a little.
                  const band = Math.sin((y + noise(n40, x * 0.5, y + 200) * 18) * 0.9);
                  k *= 1 + band * 0.13 * L.strata;
                }
                mix(i, FACE[0] * k, FACE[1] * k, FACE[2] * k, ss(0.4, 0.5, hb));
              } else {
                // Cast shadow, down and to the right of the plateau, longer under taller cliffs; and
                // the gloom at the foot of the walls, on every side, where they stand tall.
                const sl = CLIFF_H / 9;
                const hs = height(Math.round(x - 5 * sl), Math.round(y - 4 * sl));
                let dark = hs > 0.2 ? ss(0.2, 0.7, hs) * 0.5 : 0;
                if (L.ao > 0) dark = Math.max(dark, ss(0.04, 0.5, sample(rockAo, x, y)) * L.ao);
                if (dark > 0) mix(i, 0, 0, 0, dark);
              }
            }
        }
    };
    // Ruined cities (Vast maps): streets ('p') and the ground the ruins ('x') stand on are cracked
    // paving, soft-edged into the country round them like the dirt; the ruins' foundations are
    // sooty concrete. The shells themselves are drawn over this (city, below the passes).
    const streetBin = new Float32Array(MAP_W * MAP_H);
    const ruinBin = new Float32Array(MAP_W * MAP_H);
    let anyCity = false;
    for (let k = 0; k < streetBin.length; k++) {
      const ch = tiles[k];
      if (ch === 'p' || ch === 'x') (streetBin[k] = 1), (anyCity = true);
      if (ch === 'x') ruinBin[k] = 1;
    }
    const cityBlur = anyCity ? blur(streetBin, 1) : streetBin;
    const cityF = streetBin.map((v, k) => v * 0.55 + cityBlur[k] * 0.45);
    const ASPHALT: Rgb = [76, 76, 72];
    const WORN: Rgb = [104, 100, 92];
    const SLAB: Rgb = [116, 110, 101];
    const cityPass = (t0: number, t1: number) => {
      if (!anyCity) return;
      for (let ty = t0; ty < t1; ty++)
        for (let tx = 0; tx < MAP_W; tx++) {
          if (!near(streetBin, tx, ty, 0)) continue;
          for (let y = ty * TILE; y < (ty + 1) * TILE; y += st)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x += st) {
              const v = sample(cityF, x, y) + (noise(n6, x + 40, y + 90) - 0.5) * 0.14 + (noise(n14, x + 610, y) - 0.5) * 0.2;
              if (v < 0.38) continue;
              const i = cell(x, y);
              const m = noise(n14, x * 1.4 + 70, y * 1.4);
              const sh = 0.88 + m * 0.24;
              let r = ASPHALT[0] * sh;
              let g = ASPHALT[1] * sh;
              let b = ASPHALT[2] * sh;
              // Worn and patched paving, lighter, in broad patches.
              const wn = ss(0.55, 0.85, noise(n40, x + 1700, y + 300)) * 0.7;
              r += (WORN[0] - r) * wn;
              g += (WORN[1] - g) * wn;
              b += (WORN[2] - b) * wn;
              // Foundations under the ruins: pale concrete, stained with soot.
              const rf = ss(0.4, 0.6, sample(ruinBin, x, y) + (noise(n6, x, y + 300) - 0.5) * 0.25);
              if (rf > 0) {
                const soot = 1 - ss(0.5, 0.85, noise(n40, x + 3100, y + 1200)) * 0.55;
                r += (SLAB[0] * soot * sh - r) * rf;
                g += (SLAB[1] * soot * sh - g) * rf;
                b += (SLAB[2] * soot * sh - b) * rf;
              }
              // Cracks: thin dark lines that wander, more of them than on the rock.
              const ck = Math.abs(noise(n14, x * 1.8 + 900, y * 1.8 + 400) - 0.5);
              const ck2 = Math.abs(noise(n40, x * 2.4 + 50, y * 2.4 + 2000) - 0.5);
              // (Widened at half resolution, so a crack stays a line rather than a row of dots.)
              if (ck < 0.014 * st || ck2 < 0.01 * st) (r *= 0.62), (g *= 0.62), (b *= 0.62);
              const speck = hash(y * W + x + 77);
              if (speck < 0.04) (r *= 0.8), (g *= 0.8), (b *= 0.8);
              else if (speck > 0.97) (r += 18), (g += 17), (b += 15);
              // Dust drifted in from the country, toward the edges.
              const dust = (1 - ss(0.42, 0.7, v)) * 0.55;
              r += (L.dirt[0] - r) * dust;
              g += (L.dirt[1] - g) * dust;
              b += (L.dirt[2] - b) * dust;
              mix(i, r, g, b, ss(0.38, 0.47, v));
            }
        }
    };

    // Ravines ('v', and the bridges over them, 'b', which the gorge runs on beneath): a chasm cut
    // into the ground. Depth is the distance to the nearest ground outside it (up to three tiles),
    // sampled smoothly and roughened, so the edge wanders. Seen from a little south, as the rock
    // is: the far (north) wall shows as a face GORGE_WALL pixels tall, the near wall is hidden
    // under its lip, the lip itself catches the light on the south rim and is dark on the north,
    // and the floor is deep, cold and shadowed under its western wall, with scree along the foot.
    const gorgeBin = new Float32Array(MAP_W * MAP_H);
    let anyGorge = false;
    for (let k = 0; k < gorgeBin.length; k++) if (tiles[k] === 'v' || tiles[k] === 'b') (gorgeBin[k] = 1), (anyGorge = true);
    const gorgeDist = new Float32Array(MAP_W * MAP_H);
    if (anyGorge) {
      for (let k = 0; k < gorgeDist.length; k++) gorgeDist[k] = gorgeBin[k] ? 3 : 0;
      for (let pass = 0; pass < 3; pass++)
        for (let y = 0; y < MAP_H; y++)
          for (let x = 0; x < MAP_W; x++) {
            const k = y * MAP_W + x;
            if (!gorgeBin[k]) continue;
            let m = gorgeDist[k];
            for (let j = -1; j <= 1; j++)
              for (let i = -1; i <= 1; i++) {
                const xx = x + i;
                const yy = y + j;
                if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) continue;
                m = Math.min(m, gorgeDist[yy * MAP_W + xx] + 1);
              }
            gorgeDist[k] = m;
          }
      // Softened a little, so the gorge's corners round off rather than following the tiles.
      const soft = blur(gorgeDist, 1);
      for (let k = 0; k < gorgeDist.length; k++) gorgeDist[k] = gorgeDist[k] * 0.55 + soft[k] * 0.45;
    }
    const GORGE_WALL = 22;
    /** How wide the side walls of a gorge running north to south show, in world pixels. */
    const GORGE_SIDE = 8;
    const depthAt = (x: number, y: number) => sample(gorgeDist, x, y) + (noise(n6, x + 1234, y) - 0.5) * 0.2 + (noise(n14, x, y + 4321) - 0.5) * 0.26;
    const LIP = L.rockTop;
    const WALLC = L.rockFace;
    const FLOOR: Rgb = [40, 35, 31];
    const ABYSS: Rgb = [18, 20, 24];
    const gorgePass = (t0: number, t1: number) => {
      if (!anyGorge) return;
      for (let ty = t0; ty < t1; ty++)
        for (let tx = 0; tx < MAP_W; tx++) {
          if (!near(gorgeBin, tx, ty, 1)) continue;
          for (let y = ty * TILE; y < (ty + 1) * TILE; y += st)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x += st) {
              const D = depthAt(x, y);
              if (D < 0.2) continue;
              const i = cell(x, y);
              if (D < 0.5) {
                if (D < 0.36) {
                  // The gloom and loose stone on the ground just short of the edge.
                  mix(i, 20, 16, 12, ((D - 0.2) / 0.16) * 0.22);
                  if (hash(y * W + x + 31) < 0.05) mix(i, LIP[0], LIP[1], LIP[2], 0.5);
                  continue;
                }
                // The lip: bare rock, lit where it looks north over the chasm (the south rim),
                // dark where it looks south (the north rim, its face below in shadow).
                const m = noise(n14, x * 1.6, y * 1.6) * 0.6 + noise(n6, x, y) * 0.4;
                const k = 0.82 + m * 0.3;
                const a = ss(0.36, 0.43, D);
                mix(i, LIP[0] * k, LIP[1] * k, LIP[2] * k, a);
                const northward = depthAt(x, y - 6) - depthAt(x, y + 6);
                if (northward > 0.05) mix(i, 214, 206, 186, a * ss(0.44, 0.5, D) * Math.min(1, northward * 2.2) * 0.75);
                else if (northward < -0.05) mix(i, 22, 20, 18, a * ss(0.45, 0.5, D) * 0.5);
                continue;
              }
              // Inside: the far wall's face if the lip is within GORGE_WALL pixels to the north.
              let face = 0;
              for (let d = 2; d <= GORGE_WALL; d += 2)
                if (depthAt(x, y - d) < 0.5) {
                  face = d;
                  break;
                }
              if (face) {
                const streak = noise(n6, x * 2.4 + 300, y * 0.22);
                let k = (0.66 + streak * 0.5) * (1 - (face / GORGE_WALL) * 0.5);
                if (L.strata > 0) k *= 1 + Math.sin((y + noise(n40, x * 0.5, y + 200) * 18) * 0.9) * 0.12 * L.strata;
                // Ledges: now and then a lighter band across the face.
                if (Math.abs(noise(n14, x * 0.5 + 77, y * 3) - 0.5) < 0.03) k *= 1.22;
                mix(i, WALLC[0] * k, WALLC[1] * k, WALLC[2] * k, 1);
                continue;
              }
              // The side walls, steep, seen almost edge-on: the east wall faces the light and is
              // lit, the west wall is in its own shadow.
              let side = 0;
              for (let d = 2; d <= GORGE_SIDE && !side; d += 2) {
                if (depthAt(x + d, y) < 0.5) side = d;
                else if (depthAt(x - d, y) < 0.5) side = -d;
              }
              if (side) {
                const streak = noise(n6, x * 0.25 + 900, y * 2.2);
                const lit = side > 0 ? 1.15 : 0.55;
                const k = (0.7 + streak * 0.4) * lit * (1 - (Math.abs(side) / GORGE_SIDE) * 0.3);
                mix(i, WALLC[0] * k, WALLC[1] * k, WALLC[2] * k, 1);
                continue;
              }
              // The floor: darker and colder the deeper the chasm.
              const deepness = ss(0.9, 2.4, D);
              const mm = 0.85 + noise(n14, x * 1.3 + 500, y * 1.3) * 0.3;
              let r = (FLOOR[0] + (ABYSS[0] - FLOOR[0]) * deepness) * mm;
              let g = (FLOOR[1] + (ABYSS[1] - FLOOR[1]) * deepness) * mm;
              let b = (FLOOR[2] + (ABYSS[2] - FLOOR[2]) * deepness) * mm;
              // Shadow of the western wall and the lip above.
              const shade = depthAt(x - 12, y - 4) < 0.5 || depthAt(x - 6, y - GORGE_WALL - 4) < 0.5 ? 0.62 : 1;
              r *= shade;
              g *= shade;
              b *= shade;
              // Gloom along the foot of every wall, deepest in the narrowest places.
              const foot = 1 - ss(0.5, 1.1, D) * 0.35;
              mix(i, r * foot, g * foot, b * foot, 1);
            }
        }
    };

    let layer = newCanvas(CW, img.height);
    for (let t0 = 0; t0 < MAP_H; t0 += BAND) {
      const t1 = Math.min(MAP_H, t0 + BAND);
      y0 = t0 * TILE;
      hy0 = y0 - HMARGIN;
      hy1 = t1 * TILE + HMARGIN;
      hcache.fill(-1);
      const rows = Math.round((t1 - t0) * TILE * scale);
      if (img.height !== rows) {
        img = ctx.createImageData(CW, rows);
        px = img.data;
        layer = newCanvas(CW, rows);
      } else px.fill(0);
      dirtPass(t0, t1);
      waterPass(t0, t1);
      fordPass(t0, t1);
      rockPass(t0, t1);
      cityPass(t0, t1);
      gorgePass(t0, t1);
      const lctx = layer.getContext('2d')!;
      lctx.clearRect(0, 0, CW, rows);
      lctx.putImageData(img, 0, 0);
      // The layer is in canvas pixels already: copied without the world-to-canvas scale.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, Math.round(y0 * scale));
      ctx.restore();
    }
  }

  // Ripples on open water.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== 'w') continue;
      const r = rnd(y * MAP_W + x + 4242);
      ctx.strokeStyle = ART.waterLight;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const wx = x * TILE + r() * 20 + 4;
      const wy = y * TILE + r() * 24 + 4;
      ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo(wx + 4, wy - 2, wx + 8, wy);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

  // Boulders sitting on the outcrops, and scree at the foot of the cliffs.
  const boulder = (bx: number, by: number, rad: number, seed: number) => {
    const r = rnd(seed);
    const pts: [number, number][] = [];
    const sides = 6 + Math.floor(r() * 3);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU + r() * 0.4;
      const d = rad * (0.75 + r() * 0.35);
      pts.push([bx + Math.cos(a) * d, by + Math.sin(a) * d * 0.85]);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    pts.forEach(([qx, qy], k) => (k ? ctx.lineTo(qx + 2, qy + 2.5) : ctx.moveTo(qx + 2, qy + 2.5)));
    ctx.fill();
    const g = ctx.createLinearGradient(bx - rad, by - rad, bx + rad * 0.6, by + rad);
    g.addColorStop(0, L.stone[0]);
    g.addColorStop(0.55, L.stone[1]);
    g.addColorStop(1, L.stone[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    pts.forEach(([qx, qy], k) => (k ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy)));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  };
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const here = at(x, y);
      const r = rnd(y * MAP_W + x + 4444);
      if (here === 'r') {
        if (r() < 0.35) boulder(x * TILE + 8 + r() * 16, y * TILE + 2 + r() * 14, 3 + r() * 3, y * MAP_W + x + 13);
        // Scrub on the tops, away from the edges (the tops are drawn lifted by the cliff height).
        if (L.scrub > 0 && at(x, y - 1) === 'r' && at(x - 1, y) === 'r' && at(x + 1, y) === 'r' && r() < L.scrub) {
          const sx = x * TILE + 6 + r() * 20;
          const sy = y * TILE - L.cliff + 6 + r() * 20;
          const n = 3 + Math.floor(r() * 3);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath();
          ctx.ellipse(sx + 2, sy + 2, 5, 3, 0, 0, TAU);
          ctx.fill();
          for (let k = 0; k < n; k++) {
            const bx = sx + (r() - 0.5) * 7;
            const by = sy + (r() - 0.5) * 5;
            const br = 1.6 + r() * 1.6;
            ctx.fillStyle = mapType === 'canyon' ? '#5f5a30' : '#46552a';
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, TAU);
            ctx.fill();
            ctx.fillStyle = mapType === 'canyon' ? '#86804a' : '#677a3a';
            ctx.beginPath();
            ctx.arc(bx - br * 0.3, by - br * 0.3, br * 0.5, 0, TAU);
            ctx.fill();
          }
        }
        continue;
      }
      if (here === 'w' || here === 'v' || here === 'x' || here === 'b' || (at(x, y - 1) !== 'r' && at(x - 1, y) !== 'r')) continue;
      const n = 2 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const sx = x * TILE + 2 + r() * (at(x - 1, y) === 'r' ? 12 : 28);
        const sy = y * TILE + 3 + r() * (at(x, y - 1) === 'r' ? 10 : 26);
        const sr = 1.1 + r() * 1.8;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(sx + 1, sy + 1.3, sr, sr * 0.75, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = r() < 0.5 ? L.stone[1] : L.stone[0];
        ctx.beginPath();
        ctx.ellipse(sx, sy, sr, sr * 0.75, 0, 0, TAU);
        ctx.fill();
      }
    }

  // Pebbles on the dirt, each with a lit top.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== 'd' || at(x, y + 1) === 'r' || fords[y * MAP_W + x]) continue;
      const r = rnd(y * MAP_W + x + 777);
      if (r() < 0.5) continue;
      const qx = x * TILE + 4 + r() * 24;
      const qy = y * TILE + 4 + r() * 24;
      ctx.fillStyle = ART.dirtDark;
      ctx.beginPath();
      ctx.ellipse(qx + 0.6, qy + 0.8, 2, 1.4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = ART.dirtLight;
      ctx.beginPath();
      ctx.ellipse(qx, qy, 1.6, 1.1, 0, 0, TAU);
      ctx.fill();
    }

  // Stepping stones and ripples on the fords.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const along = fords[y * MAP_W + x];
      if (!along) continue;
      const r = rnd(y * MAP_W + x + 5150);
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const sx = x * TILE + 4 + r() * 24;
        const sy = y * TILE + 4 + r() * 24;
        const sr = 1.6 + r() * 2.4;
        // A ripple trailing downstream of the stone, then the stone with its wet highlight.
        ctx.strokeStyle = 'rgba(225,240,240,0.45)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        if (along === 1) {
          ctx.moveTo(sx - sr - 1, sy - sr * 0.6);
          ctx.quadraticCurveTo(sx - sr - 4, sy, sx - sr - 1, sy + sr * 0.6);
        } else {
          ctx.moveTo(sx - sr * 0.6, sy + sr + 1);
          ctx.quadraticCurveTo(sx, sy + sr + 4, sx + sr * 0.6, sy + sr + 1);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(sx + 0.8, sy + 1, sr, sr * 0.75, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = r() < 0.5 ? L.stone[1] : L.stone[0];
        ctx.beginPath();
        ctx.ellipse(sx, sy, sr, sr * 0.75, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(sx - sr * 0.3, sy - sr * 0.3, sr * 0.35, sr * 0.22, 0, 0, TAU);
        ctx.fill();
      }
    }

  // Reeds along the shore, on the land side, and lily pads on the water just off it.
  const water4 = (x: number, y: number) => at(x - 1, y) === 'w' || at(x + 1, y) === 'w' || at(x, y - 1) === 'w' || at(x, y + 1) === 'w';
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const here = at(x, y);
      const r = rnd(y * MAP_W + x + 6262);
      if (here === 'w') {
        const shore = at(x - 1, y) !== 'w' || at(x + 1, y) !== 'w' || at(x, y - 1) !== 'w' || at(x, y + 1) !== 'w';
        if (L.lilies <= 0 || !shore || r() > L.lilies) continue;
        const m = 1 + Math.floor(r() * 3);
        for (let i = 0; i < m; i++) {
          const lx = x * TILE + 6 + r() * 20;
          const ly = y * TILE + 6 + r() * 20;
          const lr = 2.2 + r() * 1.8;
          const a0 = r() * TAU;
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath();
          ctx.arc(lx + 0.8, ly + 1, lr, 0, TAU);
          ctx.fill();
          ctx.fillStyle = r() < 0.5 ? '#4f7f3a' : '#5d8c42';
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.arc(lx, ly, lr, a0 + 0.35, a0 + TAU - 0.05);
          ctx.closePath();
          ctx.fill();
          if (r() < 0.25) {
            ctx.fillStyle = r() < 0.5 ? '#f3eef0' : '#e8b4c6';
            ctx.beginPath();
            ctx.arc(lx + lr * 0.2, ly - lr * 0.2, 1.1, 0, TAU);
            ctx.fill();
          }
        }
        continue;
      }
      if (here === 'r' || here === 't' || here === 'v' || here === 'x' || here === 'b' || here === 'p' || fords[y * MAP_W + x] || !water4(x, y)) continue;
      let n = 0;
      for (let k = 0; k < 4; k++) if (r() < L.reeds) n++;
      for (let k = 0; k < n; k++) {
        // Clumps sit toward the water side of the tile.
        const bx = x * TILE + 4 + r() * 24 + (at(x + 1, y) === 'w' ? 6 : at(x - 1, y) === 'w' ? -6 : 0);
        const by = y * TILE + 6 + r() * 22 + (at(x, y + 1) === 'w' ? 5 : at(x, y - 1) === 'w' ? -5 : 0);
        ctx.fillStyle = 'rgba(20,30,10,0.25)';
        ctx.beginPath();
        ctx.ellipse(bx + 2, by + 1, 4, 1.6, 0, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 0.9;
        for (let b = 0; b < 7; b++) {
          const a = -Math.PI / 2 + (b - 3) * 0.16 + (r() - 0.5) * 0.15;
          const len = 6 + r() * 6;
          const ex = bx + (b - 3) * 0.6 + Math.cos(a) * len;
          const ey = by + Math.sin(a) * len;
          ctx.strokeStyle = b % 2 ? '#3f5a2a' : '#5f7d3a';
          ctx.beginPath();
          ctx.moveTo(bx + (b - 3) * 0.6, by);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          if (b % 3 === 0) {
            ctx.fillStyle = '#6b4a2c';
            ctx.beginPath();
            ctx.ellipse(ex, ey + 1.6, 0.9, 2, a + Math.PI / 2, 0, TAU);
            ctx.fill();
          }
        }
      }
    }

  // 4b. Ruined cities and ravines (Vast maps): the street furniture, the ruins, and the bridges.
  paintCity(ctx, at, MAP_W, MAP_H);
  // Scree on the ravines' floors: stones fallen from the walls, at the foot of the far (north)
  // wall's face and along the side walls; the near wall's foot is hidden under its lip.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== 'v') continue;
      const open = (dx: number, dy: number) => {
        const ch = at(x + dx, y + dy);
        return ch !== 'v' && ch !== 'b';
      };
      const north = open(0, -1);
      const west = open(-1, 0);
      const east = open(1, 0);
      if (!north && !west && !east) continue;
      const r = rnd(y * MAP_W + x + 9191);
      const n = 3 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) {
        const side = r();
        let sx = x * TILE + 3 + r() * (TILE - 6);
        let sy = y * TILE + 3 + r() * (TILE - 6);
        if (north && (side < 0.6 || (!west && !east))) sy = y * TILE + 19 + r() * 9;
        else if (west && (side < 0.8 || !east)) sx = x * TILE + 3 + r() * 7;
        else sx = (x + 1) * TILE - 3 - r() * 7;
        const sr = 0.9 + r() * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(sx + 0.9, sy + 1.1, sr, sr * 0.75, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = r() < 0.5 ? L.stone[1] : L.stone[2];
        ctx.beginPath();
        ctx.ellipse(sx, sy, sr, sr * 0.75, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.ellipse(sx - sr * 0.3, sy - sr * 0.3, sr * 0.4, sr * 0.25, 0, 0, TAU);
        ctx.fill();
      }
    }
  paintBridges(ctx, at, MAP_W, MAP_H);

  // 5. Trees: clustered canopies, each with its shadow, drawn top to bottom so they overlap well.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== 't') continue;
      const r = rnd(y * MAP_W + x + 8080);
      const n = 2 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const cx = x * TILE + 7 + r() * 18;
        const cy = y * TILE + 7 + r() * 18;
        const rad = 7 + r() * 5;
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.arc(cx + 6, cy + 7, rad + 1.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.arc(cx + 5, cy + 6, rad, 0, TAU);
        ctx.fill();
        ctx.fillStyle = ART.treeDark;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, TAU);
        ctx.fill();
        // Leaf clumps round the rim break up the circle.
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + r();
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * rad * 0.7, cy + Math.sin(a) * rad * 0.7, rad * 0.42, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = ART.tree;
        ctx.beginPath();
        ctx.arc(cx - rad * 0.2, cy - rad * 0.2, rad * 0.75, 0, TAU);
        ctx.fill();
        ctx.fillStyle = ART.treeLight;
        ctx.beginPath();
        ctx.arc(cx - rad * 0.35, cy - rad * 0.4, rad * 0.35, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(190,220,140,0.25)';
        ctx.beginPath();
        ctx.arc(cx - rad * 0.45, cy - rad * 0.5, rad * 0.15, 0, TAU);
        ctx.fill();
      }
    }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

type TileAt = (x: number, y: number) => string;

/** The tiles of each group of `ch` tiles touching four ways, each list starting at its lowest index. */
function groupsOf(at: TileAt, ch: string, MAP_W: number, MAP_H: number): number[][] {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const out: number[][] = [];
  for (let k0 = 0; k0 < MAP_W * MAP_H; k0++) {
    if (seen[k0] || at(k0 % MAP_W, (k0 / MAP_W) | 0) !== ch) continue;
    const group: number[] = [];
    const q = [k0];
    seen[k0] = 1;
    while (q.length) {
      const k = q.pop()!;
      group.push(k);
      const x = k % MAP_W;
      const y = (k / MAP_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const n = ny * MAP_W + nx;
        if (seen[n] || at(nx, ny) !== ch) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    group.sort((a, b) => a - b);
    out.push(group);
  }
  return out;
}

/** An irregular polygon round (x, y): a chunk of rubble or a boulder's outline. */
function shard(r: () => number, x: number, y: number, rad: number, flat = 0.8): [number, number][] {
  const pts: [number, number][] = [];
  const sides = 3 + Math.floor(r() * 4);
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2 + r() * 0.9;
    const d = rad * (0.55 + r() * 0.55);
    pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d * flat]);
  }
  return pts;
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: [number, number][], dx = 0, dy = 0) {
  ctx.beginPath();
  pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
  ctx.closePath();
  ctx.fill();
}

/** Brick and concrete: wall top, wall face, shadowed recess, and rubble shades. */
const RUIN_STYLES = [
  { ground: '#5e5a54', top: '#a09a90', face: '#6e6960', dark: '#36332f', rubble: ['#8f897f', '#77726a', '#5a564f', '#a9a398', '#4a4640'] },
  { ground: '#5c4a40', top: '#9a6650', face: '#683f2f', dark: '#33221b', rubble: ['#8a5a44', '#6e4434', '#a3735b', '#5a5049', '#857d72'] },
  { ground: '#6a6253', top: '#b0a58e', face: '#7a705e', dark: '#3c372e', rubble: ['#a59a84', '#867c69', '#6a6253', '#c0b59e', '#514b41'] },
];

/**
 * A ruined city: the streets' faded markings, craters, burnt-out cars and spilled debris, then
 * each block of ruins ('x' tiles touching) as broken walls round a heap of rubble and fallen
 * roof, scorched, with now and then a taller shell still standing, windows gaping, throwing its
 * shadow over the rubble. Decoration only: the pattern comes from a hash of the tiles.
 */
function paintCity(ctx: CanvasRenderingContext2D, at: TileAt, MAP_W: number, MAP_H: number) {
  const TAU = Math.PI * 2;
  const T = TILE;
  const street = (x: number, y: number) => at(x, y) === 'p';
  const run = (x: number, y: number, dx: number, dy: number) => {
    let n = 0;
    while (n < 8 && street(x + dx * (n + 1), y + dy * (n + 1))) n++;
    return n;
  };
  let any = false;
  // Streets.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (!street(x, y)) continue;
      any = true;
      const k = y * MAP_W + x;
      const r = rnd(k + 31337);
      const left = run(x, y, -1, 0);
      const right = run(x, y, 1, 0);
      const up = run(x, y, 0, -1);
      const down = run(x, y, 0, 1);
      const across = left + right >= up + down;
      // A faded dash down the middle of the street, where this tile is its middle.
      if ((across ? up === down : left === right) && Math.min(across ? left + right : up + down, 8) >= 2 && r() > 0.3) {
        ctx.strokeStyle = 'rgba(222,210,160,0.32)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        const o = 6 + r() * 4;
        if (across) {
          ctx.moveTo(x * T + o, y * T + T / 2);
          ctx.lineTo(x * T + o + 12, y * T + T / 2);
        } else {
          ctx.moveTo(x * T + T / 2, y * T + o);
          ctx.lineTo(x * T + T / 2, y * T + o + 12);
        }
        ctx.stroke();
      }
      const roll = r();
      if (roll < 0.035) {
        // A shell crater: scorch, dark bowl, a lit far rim and thrown-up clods.
        const cx = x * T + 10 + r() * 12;
        const cy = y * T + 10 + r() * 12;
        const cr = 4 + r() * r() * 9;
        const g = ctx.createRadialGradient(cx, cy, cr * 0.5, cx, cy, cr * 2.2);
        g.addColorStop(0, 'rgba(18,14,10,0.6)');
        g.addColorStop(1, 'rgba(18,14,10,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - cr * 2.2, cy - cr * 2.2, cr * 4.4, cr * 4.4);
        const bowl = ctx.createRadialGradient(cx + cr * 0.2, cy + cr * 0.2, 0, cx, cy, cr);
        bowl.addColorStop(0, '#16120e');
        bowl.addColorStop(0.7, '#2e2720');
        bowl.addColorStop(1, '#5a5046');
        ctx.fillStyle = bowl;
        ctx.beginPath();
        ctx.ellipse(cx, cy, cr, cr * 0.82, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(190,176,150,0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(cx, cy, cr * 0.95, cr * 0.78, 0, Math.PI * 0.95, Math.PI * 1.75);
        ctx.stroke();
        for (let i = 0; i < 9; i++) {
          const a = r() * TAU;
          const d = cr * (1 + r() * 0.5);
          ctx.fillStyle = r() < 0.5 ? '#4a443c' : '#7c766c';
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.82, 0.8 + r() * 1.3, 0, TAU);
          ctx.fill();
        }
      } else if (roll < 0.07) {
        // A burnt-out car, along the street, a little askew.
        const cx = x * T + 10 + r() * 12;
        const cy = y * T + 10 + r() * 12;
        const ang = (across ? 0 : Math.PI / 2) + (r() - 0.5) * 0.6;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.roundRect(-8.5 + 2, -4.5 + 2.5, 17, 9, 3);
        ctx.fill();
        ctx.fillStyle = '#2a2622';
        ctx.beginPath();
        ctx.roundRect(-8.5, -4.5, 17, 9, 3);
        ctx.fill();
        ctx.fillStyle = r() < 0.5 ? '#6e3a22' : '#5a4632';
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.ellipse(-3 + r() * 6, -1 + r() * 2, 3 + r() * 2, 2, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        // The cabin: an empty frame, its glass gone.
        ctx.fillStyle = '#121010';
        ctx.fillRect(-3.5, -3, 7, 6);
        ctx.strokeStyle = '#4a4440';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-3.5, -3, 7, 6);
        ctx.strokeStyle = 'rgba(150,140,128,0.5)';
        ctx.beginPath();
        ctx.moveTo(-8, -4);
        ctx.lineTo(8, -4);
        ctx.stroke();
        ctx.restore();
      }
      // Loose debris: chips of concrete and brick, more beside the ruins.
      let besideRuin = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(x + dx, y + dy) === 'x') besideRuin++;
      const bits = 2 + Math.floor(r() * 3) + besideRuin * 5;
      for (let i = 0; i < bits; i++) {
        let bx = x * T + 2 + r() * (T - 4);
        let by = y * T + 2 + r() * (T - 4);
        // Spilled rubble lies toward the ruin it fell from.
        if (besideRuin && i >= 3) {
          if (at(x - 1, y) === 'x') bx = x * T + r() * 9;
          else if (at(x + 1, y) === 'x') bx = (x + 1) * T - r() * 9;
          if (at(x, y - 1) === 'x') by = y * T + r() * 9;
          else if (at(x, y + 1) === 'x') by = (y + 1) * T - r() * 9;
        }
        const pts = shard(r, bx, by, 0.9 + r() * 2.2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        fillPoly(ctx, pts, 0.8, 1);
        ctx.fillStyle = ['#8f897f', '#6e6960', '#8a5a44', '#a9a398', '#4f4a44'][Math.floor(r() * 5)];
        fillPoly(ctx, pts);
      }
    }

  // Ruins.
  const blocks = groupsOf(at, 'x', MAP_W, MAP_H);
  if (!blocks.length && !any) return;
  for (const block of blocks) {
    const inBlock = new Set(block);
    const has = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && inBlock.has(y * MAP_W + x);
    const r = rnd(block[0] * 13 + 977);
    const style = RUIN_STYLES[Math.floor(r() * RUIN_STYLES.length)];
    let bx0 = MAP_W;
    let by0 = MAP_H;
    let bx1 = -1;
    let by1 = -1;
    for (const k of block) {
      bx0 = Math.min(bx0, k % MAP_W);
      by0 = Math.min(by0, (k / MAP_W) | 0);
      bx1 = Math.max(bx1, k % MAP_W);
      by1 = Math.max(by1, (k / MAP_W) | 0);
    }
    // The footprint: rubble over the whole of it, inset from the street, and soot across it.
    const IN = 2;
    const foot = (x: number, y: number) =>
      [x * T + (has(x - 1, y) ? 0 : IN), y * T + (has(x, y - 1) ? 0 : IN), (x + 1) * T - (has(x + 1, y) ? 0 : IN), (y + 1) * T - (has(x, y + 1) ? 0 : IN)] as const;
    ctx.fillStyle = style.ground;
    ctx.globalAlpha = 0.75;
    for (const k of block) {
      const [a, b, c, d] = foot(k % MAP_W, (k / MAP_W) | 0);
      ctx.fillRect(a, b, c - a, d - b);
    }
    ctx.globalAlpha = 1;
    {
      const cx = ((bx0 + bx1 + 1) / 2) * T;
      const cy = ((by0 + by1 + 1) / 2) * T;
      const rad = Math.max(bx1 - bx0 + 1, by1 - by0 + 1) * T * 0.7;
      const g = ctx.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad);
      g.addColorStop(0, 'rgba(14,11,9,0.5)');
      g.addColorStop(1, 'rgba(14,11,9,0.12)');
      ctx.fillStyle = g;
      for (const k of block) {
        const [a, b, c, d] = foot(k % MAP_W, (k / MAP_W) | 0);
        ctx.fillRect(a, b, c - a, d - b);
      }
    }
    // Heaps of rubble, fallen slabs with their rebar, charred beams.
    for (const k of block) {
      const x = k % MAP_W;
      const y = (k / MAP_W) | 0;
      const heaps = 10 + Math.floor(r() * 8);
      for (let i = 0; i < heaps; i++) {
        const hx = x * T + 3 + (r() + r()) * 0.5 * (T - 6);
        const hy = y * T + 3 + (r() + r()) * 0.5 * (T - 6);
        const pts = shard(r, hx, hy, 1.4 + r() * (r() < 0.2 ? 4.5 : 2.4));
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        fillPoly(ctx, pts, 1.2, 1.6);
        ctx.fillStyle = style.rubble[Math.floor(r() * style.rubble.length)];
        fillPoly(ctx, pts);
      }
      if (r() < 0.45) {
        ctx.save();
        ctx.translate(x * T + 8 + r() * 16, y * T + 8 + r() * 16);
        ctx.rotate((r() - 0.5) * 1.4);
        const sw = 10 + r() * 10;
        const sh = 6 + r() * 7;
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        ctx.fillRect(-sw / 2 + 2, -sh / 2 + 2.5, sw, sh);
        ctx.fillStyle = style.top;
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(-sw / 2, sh / 2 - 1.5, sw, 1.5);
        ctx.strokeStyle = 'rgba(80,44,28,0.9)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const ex = sw / 2 - i * 3 - 1;
          ctx.moveTo(ex, sh / 2);
          ctx.lineTo(ex + (r() - 0.3) * 3, sh / 2 + 2 + r() * 2);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (r() < 0.5) {
        const bx = x * T + 6 + r() * 20;
        const by = y * T + 6 + r() * 20;
        const a = r() * Math.PI;
        const l = 8 + r() * 12;
        ctx.strokeStyle = 'rgba(24,19,15,0.9)';
        ctx.lineWidth = 2 + r() * 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx - (Math.cos(a) * l) / 2, by - (Math.sin(a) * l) / 2);
        ctx.lineTo(bx + (Math.cos(a) * l) / 2, by + (Math.sin(a) * l) / 2);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }
    // Scorch: fire went through it.
    for (let i = 0; i < Math.ceil(block.length / 2); i++) {
      const k = block[Math.floor(r() * block.length)];
      const sx = (k % MAP_W) * T + r() * T;
      const sy = ((k / MAP_W) | 0) * T + r() * T;
      const sr = 8 + r() * 12;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, 'rgba(12,10,8,0.45)');
      g.addColorStop(1, 'rgba(12,10,8,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
    // The outer walls, broken off low: a stub with its face toward us, a lit top, and a shadow.
    const WALL = 4;
    for (const k of block) {
      const x = k % MAP_W;
      const y = (k / MAP_W) | 0;
      const edges: [number, number, number, number][] = [];
      if (!has(x, y - 1)) edges.push([x * T + IN, y * T + IN, (x + 1) * T - IN, y * T + IN]);
      if (!has(x, y + 1)) edges.push([x * T + IN, (y + 1) * T - IN - WALL, (x + 1) * T - IN, (y + 1) * T - IN - WALL]);
      if (!has(x - 1, y)) edges.push([x * T + IN, y * T + IN, x * T + IN, (y + 1) * T - IN]);
      if (!has(x + 1, y)) edges.push([(x + 1) * T - IN - WALL, y * T + IN, (x + 1) * T - IN - WALL, (y + 1) * T - IN]);
      for (const [ax, ay, bx, by] of edges) {
        const horiz = ay === by;
        for (let half = 0; half < 2; half++) {
          if (r() < 0.25) continue;
          const t0 = half * 0.5 + (r() < 0.35 ? r() * 0.25 : 0);
          const t1 = half * 0.5 + 0.5 - (r() < 0.35 ? r() * 0.25 : 0);
          const x0 = ax + (bx - ax) * t0;
          const y0 = ay + (by - ay) * t0;
          const x1 = ax + (bx - ax) * t1;
          const y1 = ay + (by - ay) * t1;
          const w = horiz ? x1 - x0 : WALL;
          const h = horiz ? WALL : y1 - y0;
          const tall = 3 + r() * 4;
          ctx.fillStyle = 'rgba(0,0,0,0.38)';
          ctx.fillRect(x0 + tall * 0.6, y0 + tall * 0.5, w, h + tall * 0.5);
          // Lifted by its height: the face below the top, seen from the south.
          ctx.fillStyle = style.face;
          ctx.fillRect(x0, y0 + h - tall, w, tall);
          ctx.fillStyle = style.top;
          ctx.fillRect(x0, y0 - tall, w, h);
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          if (horiz) ctx.fillRect(x0, y0 - tall, w, 1);
          else ctx.fillRect(x0, y0 - tall, 1, h);
          ctx.fillStyle = style.dark;
          ctx.globalAlpha = 0.55;
          for (let jx = x0 + 3 + r() * 3; jx < x0 + w - 1; jx += 4 + r() * 3) ctx.fillRect(jx, y0 + h - tall, 0.8, tall);
          ctx.globalAlpha = 1;
        }
      }
    }
    // What still stands: one or two sections of the building, each a gutted box of one or two
    // tiles, drawn as the rock is, its roof lifted by its height over the face it uncovers, one
    // corner of the roof fallen in, windows gaping, and its shadow down and to the right.
    const masses: [number, number, number, number][] = [];
    const tries = block.length >= 4 ? 2 : 1;
    for (let i = 0; i < tries; i++) {
      if (r() < 0.25) continue;
      const k = block[Math.floor(r() * block.length)];
      const x = k % MAP_W;
      const y = (k / MAP_W) | 0;
      const w = r() < 0.5 && has(x + 1, y) ? 2 : 1;
      let h = r() < 0.5 && has(x, y + 1) ? 2 : 1;
      if (w === 2 && h === 2 && !has(x + 1, y + 1)) h = 1;
      if (masses.some(([mx, my, mw, mh]) => x < mx + mw && x + w > mx && y < my + mh && y + h > my)) continue;
      masses.push([x, y, w, h]);
    }
    masses.sort((a, b) => a[1] - b[1]);
    for (const [mx, my, mw, mh] of masses) {
      const x0 = mx * T + (has(mx - 1, my) ? 3 : IN + 1);
      const y0 = my * T + (has(mx, my - 1) ? 3 : IN + 1);
      const x1 = (mx + mw) * T - (has(mx + mw, my) ? 3 : IN + 1);
      const y1 = (my + mh) * T - (has(mx, my + mh) ? 3 : IN + 1);
      const H = 14 + r() * 16;
      const sx = H * 0.6;
      const sy = H * 0.45;
      ctx.fillStyle = 'rgba(0,0,0,0.36)';
      ctx.beginPath();
      ctx.moveTo(x0, y1);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1 + sx, y0 + sy);
      ctx.lineTo(x1 + sx, y1 + sy);
      ctx.lineTo(x0 + sx, y1 + sy);
      ctx.closePath();
      ctx.fill();
      // The south face.
      const fy = y1 - H;
      const fg = ctx.createLinearGradient(0, fy, 0, y1);
      fg.addColorStop(0, style.face);
      fg.addColorStop(1, style.dark);
      ctx.fillStyle = fg;
      ctx.fillRect(x0, fy, x1 - x0, H);
      // Windows: rows of gaping holes, soot licking up from some.
      for (let wy = fy + 4; wy + 5 <= y1 - 2; wy += 9)
        for (let wx = x0 + 3; wx + 4 <= x1 - 2; wx += 7) {
          if (r() < 0.2) continue;
          if (r() < 0.35) {
            ctx.fillStyle = 'rgba(10,8,7,0.45)';
            ctx.fillRect(wx - 0.5, wy - 4, 4.5, 4);
          }
          ctx.fillStyle = '#0d0b0a';
          ctx.fillRect(wx, wy, 3.5, 5);
        }
      // The roof, its far corner fallen in to show the dark inside.
      const rt = y0 - H;
      const rb = y1 - H;
      const cut = r() < 0.5 ? 1 : -1;
      const cw = (x1 - x0) * (0.3 + r() * 0.3);
      const ch = (rb - rt) * (0.35 + r() * 0.35);
      ctx.fillStyle = style.top;
      ctx.beginPath();
      if (cut > 0) {
        ctx.moveTo(x0, rt);
        ctx.lineTo(x1 - cw, rt);
        ctx.lineTo(x1 - cw * 0.4, rt + ch * 0.5);
        ctx.lineTo(x1, rt + ch);
        ctx.lineTo(x1, rb);
        ctx.lineTo(x0, rb);
      } else {
        ctx.moveTo(x0 + cw, rt);
        ctx.lineTo(x1, rt);
        ctx.lineTo(x1, rb);
        ctx.lineTo(x0, rb);
        ctx.lineTo(x0, rt + ch);
        ctx.lineTo(x0 + cw * 0.4, rt + ch * 0.5);
      }
      ctx.closePath();
      ctx.fill();
      // Inside the broken corner: the gutted dark, a little rubble catching the light.
      ctx.fillStyle = '#16120f';
      ctx.beginPath();
      if (cut > 0) {
        ctx.moveTo(x1 - cw, rt);
        ctx.lineTo(x1, rt);
        ctx.lineTo(x1, rt + ch);
        ctx.lineTo(x1 - cw * 0.4, rt + ch * 0.5);
      } else {
        ctx.moveTo(x0, rt);
        ctx.lineTo(x0 + cw, rt);
        ctx.lineTo(x0 + cw * 0.4, rt + ch * 0.5);
        ctx.lineTo(x0, rt + ch);
      }
      ctx.closePath();
      ctx.fill();
      // Parapet: lit on the top and left edges, dark on the right.
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(x0, rb - 1, x1 - x0, 1);
      ctx.fillRect(x0, rt + (cut < 0 ? ch : 0), 1.2, rb - rt - (cut < 0 ? ch : 0));
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x1 - 1.2, rt + (cut > 0 ? ch : 0), 1.2, rb - rt - (cut > 0 ? ch : 0));
      // Cracks and a scorch across the roof, and a little debris left lying on it.
      ctx.strokeStyle = 'rgba(30,26,22,0.45)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        let cx = x0 + 3 + r() * (x1 - x0 - 6);
        let cy = rt + 2 + r() * (rb - rt - 4);
        ctx.moveTo(cx, cy);
        for (let j = 0; j < 3; j++) {
          cx = Math.max(x0 + 1, Math.min(x1 - 1, cx + (r() - 0.5) * 9));
          cy = Math.max(rt + 1, Math.min(rb - 1, cy + (r() - 0.5) * 9));
          ctx.lineTo(cx, cy);
        }
      }
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const pts = shard(r, x0 + 3 + r() * (x1 - x0 - 6), rt + 3 + r() * Math.max(1, rb - rt - 6), 0.8 + r() * 1.6);
        ctx.fillStyle = style.rubble[Math.floor(r() * style.rubble.length)];
        fillPoly(ctx, pts);
      }
    }
  }
}

/**
 * Bridges over the ravines: each group of 'b' tiles is one span, its deck running across the
 * gorge (which lies to either side of the group, left and right or above and below). Stone
 * abutments on the banks, steel girders along the deck's edges, planking across it, railings
 * with posts, and the whole span's shadow cast down and to the right into the chasm. A span
 * seen side-on (running east to west) shows its truss below the deck.
 */
function paintBridges(ctx: CanvasRenderingContext2D, at: TileAt, MAP_W: number, MAP_H: number) {
  const T = TILE;
  for (const span of groupsOf(at, 'b', MAP_W, MAP_H)) {
    let x0 = MAP_W;
    let y0 = MAP_H;
    let x1 = -1;
    let y1 = -1;
    for (const k of span) {
      const x = k % MAP_W;
      const y = (k / MAP_W) | 0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    let sides = 0;
    let ends = 0;
    for (let y = y0; y <= y1; y++) sides += (at(x0 - 1, y) === 'v' ? 1 : 0) + (at(x1 + 1, y) === 'v' ? 1 : 0);
    for (let x = x0; x <= x1; x++) ends += (at(x, y0 - 1) === 'v' ? 1 : 0) + (at(x, y1 + 1) === 'v' ? 1 : 0);
    // The gorge either side of the span, left and right: the deck runs north to south.
    const vertical = sides >= ends;
    const r = rnd(span[0] * 17 + 4049);
    const over = 12;
    const bx0 = x0 * T + (vertical ? 3 : -over);
    const by0 = y0 * T + (vertical ? -over : 3);
    const bx1 = (x1 + 1) * T - (vertical ? 3 : -over);
    const by1 = (y1 + 1) * T - (vertical ? -over : 3);
    // Shadow in the chasm (and only there: on the banks the deck sits on the ground).
    ctx.save();
    ctx.beginPath();
    for (let y = y0 - 2; y <= y1 + 2; y++)
      for (let x = x0 - 2; x <= x1 + 2; x++) {
        const ch = at(x, y);
        if (ch === 'v' || ch === 'b') ctx.rect(x * T, y * T, T, T);
      }
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(bx0 + 9, by0 + 14, bx1 - bx0, by1 - by0);
    ctx.restore();
    ctx.save();
    // Local frame: the deck runs along x from 0 to len, `wid` across, centred on y = 0.
    const len = vertical ? by1 - by0 : bx1 - bx0;
    const wid = vertical ? bx1 - bx0 : by1 - by0;
    if (vertical) {
      ctx.translate(bx0 + wid / 2, by0);
      ctx.rotate(Math.PI / 2);
    } else ctx.translate(bx0, by0 + wid / 2);
    const hw = wid / 2;
    if (!vertical) {
      // The truss, seen from the south below the deck.
      const TH = 9;
      ctx.fillStyle = '#2c2f33';
      ctx.fillRect(over, hw, len - 2 * over, 2);
      ctx.fillRect(over, hw + TH, len - 2 * over, 2);
      ctx.strokeStyle = '#3d4247';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let x = over, up = true; x < len - over; x += 8, up = !up) {
        ctx.moveTo(x, up ? hw + 1 : hw + TH + 1);
        ctx.lineTo(Math.min(len - over, x + 8), up ? hw + TH + 1 : hw + 1);
      }
      ctx.stroke();
    }
    // Abutments: dressed stone on each bank.
    for (const ax of [0, len - over - 2]) {
      ctx.fillStyle = '#7d776d';
      ctx.fillRect(ax, -hw - 3, over + 2, wid + 6);
      ctx.strokeStyle = 'rgba(40,36,30,0.6)';
      ctx.lineWidth = 0.8;
      for (let yy = -hw - 3 + 5; yy < hw + 3; yy += 5) {
        ctx.beginPath();
        ctx.moveTo(ax, yy);
        ctx.lineTo(ax + over + 2, yy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(ax, -hw - 3, over + 2, 1.2);
    }
    // Planking, plank by plank, each its own shade.
    for (let x = 2; x < len - 2; x += 4) {
      const v = 0.85 + r() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(132 * v)},${Math.round(102 * v)},${Math.round(66 * v)})`;
      ctx.fillRect(x, -hw + 2, 3.2, wid - 4);
      ctx.fillStyle = 'rgba(40,28,16,0.55)';
      ctx.fillRect(x + 3.2, -hw + 2, 0.8, wid - 4);
      if (r() < 0.12) {
        // A scorched or missing plank: the war has been over this one too.
        ctx.fillStyle = r() < 0.5 ? 'rgba(20,16,12,0.7)' : 'rgba(10,10,12,0.85)';
        ctx.fillRect(x, -hw + 2 + r() * (wid - 12), 3.2, 4 + r() * 6);
      }
    }
    // Wheel ruts worn along the deck.
    ctx.fillStyle = 'rgba(30,22,14,0.22)';
    ctx.fillRect(2, -hw * 0.45 - 2, len - 4, 4);
    ctx.fillRect(2, hw * 0.45 - 2, len - 4, 4);
    // Girders along both edges, riveted, lit on top.
    for (const gy of [-hw, hw - 3]) {
      ctx.fillStyle = '#41464c';
      ctx.fillRect(over - 2, gy, len - 2 * over + 4, 3);
      ctx.fillStyle = 'rgba(200,210,220,0.28)';
      ctx.fillRect(over - 2, gy, len - 2 * over + 4, 0.9);
      ctx.fillStyle = '#23262a';
      for (let x = over; x < len - over; x += 5) ctx.fillRect(x, gy + 1.4, 1, 1);
    }
    // Railings: posts and a rail on each side.
    for (const ry of [-hw + 1.5, hw - 1.5]) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let x = over; x <= len - over; x += 8) ctx.fillRect(x + 0.8, ry - 0.2, 2, 2);
      ctx.fillStyle = '#5a5f66';
      for (let x = over; x <= len - over; x += 8) ctx.fillRect(x - 0.6, ry - 1.2, 2, 2);
      ctx.strokeStyle = '#b4b8bb';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(over - 1, ry - 0.6);
      ctx.lineTo(len - over + 1, ry - 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** The side of a block of grass blades, in world pixels (see paintTerrain, step 1). */
const BLADE_BLOCK = 512;

/** A block of grass blades on a transparent canvas: fourteen to a tile's area, as before. */
function bladeBlock(seed: number): HTMLCanvasElement {
  const c = newCanvas(BLADE_BLOCK, BLADE_BLOCK);
  const ctx = c.getContext('2d')!;
  const blades: Path2D[] = Array.from({ length: 8 }, () => new Path2D());
  const r = rnd(seed * 99991);
  const n = (BLADE_BLOCK / TILE) * (BLADE_BLOCK / TILE) * 14;
  for (let i = 0; i < n; i++) {
    const dark = r() < 0.5 ? 0 : 4;
    const strength = Math.min(3, Math.floor(r() * 4));
    const px = r() * BLADE_BLOCK;
    const py = r() * (BLADE_BLOCK - 5);
    const len = 2.5 + r() * 2.5;
    const lean = (r() - 0.45) * 1.8;
    const path = blades[dark + strength];
    path.moveTo(px - 0.8, py + len);
    path.lineTo(px + lean, py);
    path.lineTo(px + 0.8, py + len);
    path.closePath();
  }
  blades.forEach((path, k) => {
    ctx.fillStyle = k < 4 ? ART.grassDark : ART.grassLight;
    ctx.globalAlpha = 0.39 + (k % 4) * 0.075;
    ctx.fill(path);
  });
  return c;
}

/** World pixels per relief sample. */
const RELIEF = 8;

/**
 * Hill shading for the grass (see paintTerrain, step 1b). Three octaves of value noise make the
 * height; the light is the same top-left light as everything else; lit slopes get a little pale
 * gold, slopes turned away a little blue-green shade, and hollows are a touch darker and lusher.
 */
function relief(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const w = Math.ceil(W / RELIEF) + 1;
  const h = Math.ceil(H / RELIEF) + 1;
  const octave = (cell: number, seed: number) => {
    const n = Math.ceil(Math.max(w, h) / cell) + 2;
    const g = new Float32Array(n * n);
    for (let k = 0; k < g.length; k++) g[k] = hash(seed * 104729 + k);
    return (x: number, y: number) => {
      const gx = x / cell;
      const gy = y / cell;
      const ix = gx | 0;
      const iy = gy | 0;
      let fx = gx - ix;
      let fy = gy - iy;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const k = iy * n + ix;
      const a = g[k] + (g[k + 1] - g[k]) * fx;
      const b = g[k + n] + (g[k + n + 1] - g[k + n]) * fx;
      return a + (b - a) * fy;
    };
  };
  // Cells in samples: hills about 300, 130 and 55 world pixels across.
  const o1 = octave(300 / RELIEF, 71);
  const o2 = octave(130 / RELIEF, 73);
  const o3 = octave(55 / RELIEF, 79);
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) height[y * w + x] = o1(x, y) * 0.6 + o2(x, y) * 0.3 + o3(x, y) * 0.1;
  const c = newCanvas(w, h);
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const d = img.data;
  // Height in world pixels per unit of noise: enough for soft slopes, never cliffs.
  const LIFT = 70;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const hl = height[y * w + Math.max(0, x - 1)];
      const hr = height[y * w + Math.min(w - 1, x + 1)];
      const hu = height[Math.max(0, y - 1) * w + x];
      const hd = height[Math.min(h - 1, y + 1) * w + x];
      // Slope toward the light (up and left) is lit.
      const lit = (((hr - hl) * -1 + (hd - hu) * -1) * LIFT) / (2 * RELIEF);
      const low = 0.5 - height[k];
      const i = k * 4;
      if (lit > 0) {
        d[i] = 206;
        d[i + 1] = 214;
        d[i + 2] = 128;
        d[i + 3] = Math.min(46, lit * 90);
      } else {
        d[i] = 8;
        d[i + 1] = 26;
        d[i + 2] = 22;
        d[i + 3] = Math.min(90, -lit * 150 + Math.max(0, low) * 60);
      }
    }
  g.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, w * RELIEF, h * RELIEF);
  ctx.restore();
}

/**
 * A canvas to paint on: a page's, or an OffscreenCanvas in the worker that paints the terrain off
 * the main thread (terrainWorker.ts). Both take the same 2D drawing calls.
 */
function newCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement;
}

/**
 * Paints the terrain in a worker, so a large map opens without the page stalling while it paints
 * (fireline-round5-design.md, workstream B: a 160-tile map takes seconds). Resolves to a page
 * canvas holding the painted ground, the same pixels paintTerrain would give. Null where workers
 * or OffscreenCanvas are missing; the promise rejects if the worker fails. Either way the caller
 * paints on the main thread instead.
 */
export function paintTerrainOffThread(tiles: string, mapType: MapType | undefined, mapW: number, mapH: number): Promise<HTMLCanvasElement> | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<ImageBitmap | { error: string }>) => {
      worker.terminate();
      const bmp = e.data;
      if (!(bmp instanceof ImageBitmap)) return reject(new Error((bmp as { error: string }).error));
      const c = newCanvas(bmp.width, bmp.height);
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
      resolve(c);
    };
    worker.onerror = e => {
      worker.terminate();
      reject(new Error(e.message || 'terrain worker failed'));
    };
    worker.postMessage({ tiles, mapType, mapW, mapH });
  });
}

/** One pixel per tile, for the minimap. */
export function paintMiniTerrain(tiles: string, mapW = DEFAULT_MAP_W, mapH = DEFAULT_MAP_H): HTMLCanvasElement {
  const MAP_W = mapW;
  const MAP_H = mapH;
  const fords = fordsOf(tiles, MAP_W, MAP_H);
  const c = document.createElement('canvas');
  c.width = MAP_W;
  c.height = MAP_H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(MAP_W, MAP_H);
  const colour: Record<string, [number, number, number]> = {
    g: [77, 106, 50],
    d: [123, 100, 70],
    w: [43, 90, 115],
    r: [110, 107, 100],
    t: [36, 65, 31],
    // Vast maps: ravines dark, bridges timber, ruins pale rubble, streets grey paving.
    v: [34, 30, 28],
    b: [140, 108, 70],
    x: [150, 140, 128],
    p: [92, 92, 88],
  };
  for (let k = 0; k < MAP_W * MAP_H; k++) {
    const [r, g, b] = fords[k] ? [96, 132, 130] : (colour[tiles[k]] ?? colour.g);
    img.data[k * 4] = r;
    img.data[k * 4 + 1] = g;
    img.data[k * 4 + 2] = b;
    img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
