import { MAP_H, MAP_W } from '../sim/rules';
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
 * (cast shadow, cliff face, lit rim, top, facets, cracks, scree at the foot), trees. Light comes
 * from the top left, as it does on the units and structures.
 */

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

export function paintTerrain(tiles: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = MAP_W * TILE;
  c.height = MAP_H * TILE;
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
    ctx.globalAlpha = i % 2 ? 0.2 : 0.26;
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
      if (r() < 0.05) {
        const fx = x * TILE + 6 + r() * (TILE - 12);
        const fy = y * TILE + 6 + r() * (TILE - 12);
        const col = FLOWERS[Math.floor(r() * FLOWERS.length)];
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
    const img = ctx.createImageData(W, H);
    const px = img.data;
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
    const DIRT: [number, number, number] = [123, 100, 70];
    const DIRT_DARK: [number, number, number] = [92, 73, 49];
    const DIRT_LIGHT: [number, number, number] = [150, 128, 92];
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) {
        if (!near(dirtBin, tx, ty, 0, false)) continue;
        for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
          for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
            const v = sample(dirt, x, y) + (noise(n6, x, y) - 0.5) * 0.16 + (noise(n14, x + 900, y) - 0.5) * 0.2 + (noise(n40, x + 900, y) - 0.5) * 0.3;
            if (v < 0.36) continue;
            const i = (y * W + x) * 4;
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

    const water = fieldOf('w');
    const deep = blur(water, 2);
    const SAND: [number, number, number] = [185, 162, 119];
    const WET: [number, number, number] = [150, 134, 96];
    const SHALLOW: [number, number, number] = [64, 122, 138];
    const OPEN: [number, number, number] = [43, 90, 115];
    const DEEP: [number, number, number] = [28, 64, 85];
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) {
        if (!near(water, tx, ty, 0)) continue;
        for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
          for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
            const v = sample(water, x, y) + (noise(n6, x, y) - 0.5) * 0.12 + (noise(n40, x, y) - 0.5) * 0.22;
            if (v < 0.16) continue;
            const i = (y * W + x) * 4;
            if (v < 0.5) {
              mix(i, SAND[0], SAND[1], SAND[2], ss(0.16, 0.32, v) * (0.85 + noise(n6, x + 300, y) * 0.15));
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

    const rock = fieldOf('r');
    const CLIFF_H = 9;
    // Heights are read several times per pixel (slope, cliff depth, shadow), so each is worked
    // out once and kept.
    const hcache = new Float32Array(W * H).fill(-1);
    const height = (x: number, y: number) => {
      const inside = x >= 0 && y >= 0 && x < W && y < H;
      if (inside) {
        const v = hcache[y * W + x];
        if (v >= 0) return v;
      }
      const v = ss(0.36, 0.64, sample(rock, x, y) + (noise(n6, x, y) - 0.5) * 0.16 + (noise(n14, x, y) - 0.5) * 0.18);
      if (inside) hcache[y * W + x] = v;
      return v;
    };
    const TOP: [number, number, number] = [124, 120, 111];
    const FACE: [number, number, number] = [70, 66, 59];
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) {
        if (!near(rock, tx, ty, 1)) continue;
        for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
          for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
            const i = (y * W + x) * 4;
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
            } else if (hb > 0.4) {
              // Cliff face: vertical strata, darker toward its foot.
              const streak = noise(n6, x * 2.2, y * 0.25);
              const foot = ss(0.4, 1, hb) * 0.25 + 0.75;
              let depth = 0;
              for (let d = 1; d <= CLIFF_H; d += 2) if (height(x, y + CLIFF_H - d) > 0.45) depth = d;
              const k = (0.7 + streak * 0.45) * foot * (1 - (CLIFF_H - depth) * 0.03);
              mix(i, FACE[0] * k, FACE[1] * k, FACE[2] * k, ss(0.4, 0.5, hb));
            } else {
              // Cast shadow, down and to the right of the plateau.
              const hs = height(x - 5, y - 4);
              if (hs > 0.2) mix(i, 0, 0, 0, ss(0.2, 0.7, hs) * 0.5);
            }
          }
      }
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    layer.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(layer, 0, 0);
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
    g.addColorStop(0, ART.rockLight);
    g.addColorStop(0.55, ART.rock);
    g.addColorStop(1, ART.rockDark);
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
        ctx.fillStyle = r() < 0.5 ? ART.rock : ART.rockLight;
        ctx.beginPath();
        ctx.ellipse(sx, sy, sr, sr * 0.75, 0, 0, TAU);
        ctx.fill();
      }
    }

  // Pebbles on the dirt, each with a lit top.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== 'd' || at(x, y + 1) === 'r') continue;
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

/** One pixel per tile, for the minimap. */
export function paintMiniTerrain(tiles: string): HTMLCanvasElement {
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
    const [r, g, b] = colour[tiles[k]] ?? colour.g;
    img.data[k * 4] = r;
    img.data[k * 4 + 1] = g;
    img.data[k * 4 + 2] = b;
    img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
