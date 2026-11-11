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
  const c = newCanvas(MAP_W * TILE, MAP_H * TILE);
  const ctx = c.getContext('2d')!;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 'g' : tiles[y * MAP_W + x]);
  const TAU = Math.PI * 2;

  // 1. Grass everywhere: one base tone, then large soft patches of the others, so there is no
  // tile grid to see.
  ctx.fillStyle = ART.grass[0];
  ctx.fillRect(0, 0, c.width, c.height);
  const patches = rnd(424242);
  for (let i = 0; i < MAP_W * MAP_H * 0.7; i++) {
    const px = patches() * c.width;
    const py = patches() * c.height;
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
    const px = zones() * c.width;
    const py = zones() * c.height;
    const rad = 110 + zones() * 190;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, i % 2 ? DRY_GRASS : LUSH_GRASS);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = i % 2 ? L.dry : L.lush;
    ctx.fillStyle = g;
    ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  ctx.globalAlpha = 1;
  // Blades, batched into one path per shade and strength: tens of thousands of fills become eight.
  const blades: Path2D[] = Array.from({ length: 8 }, () => new Path2D());
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const r = rnd(y * MAP_W + x + 99991);
      for (let i = 0; i < 14; i++) {
        const dark = r() < 0.5 ? 0 : 4;
        const strength = Math.min(3, Math.floor(r() * 4));
        const px = x * TILE + r() * TILE;
        const py = y * TILE + r() * TILE;
        blades[dark + strength].rect(px, py, 1.5, 2.5 + r() * 2);
      }
    }
  blades.forEach((path, k) => {
    ctx.fillStyle = k < 4 ? ART.grassDark : ART.grassLight;
    ctx.globalAlpha = 0.39 + (k % 4) * 0.075;
    ctx.fill(path);
  });
  ctx.globalAlpha = 1;
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
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalAlpha = 1;
  }

  // 2, 3 and 4. Dirt, water and rock, shaded per pixel in one pass over the painted ground. Each is a field
  // sampled smoothly between tile centres and roughened with noise, so its outline follows the
  // tiles without showing them. Dirt is mottled, speckled and soft-edged. Water bands outward from open water through shallows, a foam
  // line, wet sand and a sandy bank fading into the grass. Rock is a raised plateau seen from a
  // little south: its top is drawn lifted by CLIFF_H pixels and shaded by the slope of a height
  // field (lit on the top-left rims, dark on the bottom-right), the strip it uncovers is the cliff
  // face, and it casts a shadow down and to the right.
  {
    const W = c.width;
    const H = c.height;
    // Drawn into a transparent layer and composited over the grass, rather than read back from
    // the canvas: a read-back of the whole map costs more than everything else here put together.
    // Round 5: the layer is worked a band of BAND tile rows at a time (every pass for one band,
    // then the next), so its pixels and the height cache are a band's worth rather than the whole
    // map's (on a 160-tile map, 10 MB a band against 105 MB for the whole). Each pixel goes
    // through the same passes in the same order, so the result is the same.
    const BAND = 16;
    let y0 = 0;
    let img = ctx.createImageData(W, Math.min(H, BAND * TILE));
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
          for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
              const v = sample(dirt, x, y) + (noise(n6, x, y) - 0.5) * 0.16 + (noise(n14, x + 900, y) - 0.5) * 0.2 + (noise(n40, x + 900, y) - 0.5) * 0.3;
              if (v < 0.36) continue;
              const i = ((y - y0) * W + x) * 4;
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
          for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
              const v = sample(water, x, y) + (noise(n6, x, y) - 0.5) * 0.12 + (noise(n40, x, y) - 0.5) * 0.22;
              if (v < L.beach) continue;
              const i = ((y - y0) * W + x) * 4;
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
          for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
              const v = sample(fordF, x, y) + (noise(n6, x + 70, y) - 0.5) * 0.18 + (noise(n14, x, y + 40) - 0.5) * 0.24;
              if (v < 0.24) continue;
              // Fading out over the deep water's edge, so the shallows shelve into it.
              const wv = sample(water, x, y) + (noise(n14, x + 50, y) - 0.5) * 0.2;
              const a = ss(0.24, 0.5, v) * (1 - ss(0.45, 0.95, wv));
              if (a <= 0) continue;
              const i = ((y - y0) * W + x) * 4;
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
          for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
            for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
              const i = ((y - y0) * W + x) * 4;
              const ht = height(x, y + CLIFF_H);
              const hb = height(x, y);
              if (ht > 0.45) {
                // Top: slope shading toward a light in the top left, mottling, and fine cracks.
                const gx = height(x + 2, y + CLIFF_H) - height(x - 2, y + CLIFF_H);
                const gy = height(x, y + CLIFF_H + 2) - height(x, y + CLIFF_H - 2);
                const lit = (gx + gy) * 1.6;
                const m = noise(n14, x * 1.7, y * 1.7) * 0.6 + noise(n6, x, y) * 0.4;
                const crack = Math.abs(noise(n14, x + 500, y + 500) - 0.5) < 0.012 ? 0.7 : 1;
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
    let layer = newCanvas(W, img.height);
    for (let t0 = 0; t0 < MAP_H; t0 += BAND) {
      const t1 = Math.min(MAP_H, t0 + BAND);
      y0 = t0 * TILE;
      hy0 = y0 - HMARGIN;
      hy1 = t1 * TILE + HMARGIN;
      hcache.fill(-1);
      const rows = (t1 - t0) * TILE;
      if (img.height !== rows) {
        img = ctx.createImageData(W, rows);
        px = img.data;
        layer = newCanvas(W, rows);
      } else px.fill(0);
      dirtPass(t0, t1);
      waterPass(t0, t1);
      fordPass(t0, t1);
      rockPass(t0, t1);
      const lctx = layer.getContext('2d')!;
      lctx.clearRect(0, 0, W, rows);
      lctx.putImageData(img, 0, 0);
      ctx.drawImage(layer, 0, y0);
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
      if (here === 'w' || (at(x, y - 1) !== 'r' && at(x - 1, y) !== 'r')) continue;
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
      if (here === 'r' || here === 't' || fords[y * MAP_W + x] || !water4(x, y)) continue;
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
  return c;
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
