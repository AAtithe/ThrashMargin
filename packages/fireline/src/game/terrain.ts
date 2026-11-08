import { MAP_H, MAP_W } from '../sim/rules';
import { ART } from '../theme';
import { TILE } from './art';

/**
 * The ground, painted once per battle onto an offscreen canvas and copied to the screen a window
 * at a time. Terrain never changes, so none of this runs per frame.
 *
 * Randomness here is decoration only, from a hash of the tile index, so the same map always
 * paints the same way. It never touches the simulation.
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

export function paintTerrain(tiles: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = MAP_W * TILE;
  c.height = MAP_H * TILE;
  const ctx = c.getContext('2d')!;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? 'g' : tiles[y * MAP_W + x]);

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
  ctx.globalAlpha = 1;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const r = rnd(y * MAP_W + x + 99991);
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = r() < 0.5 ? ART.grassDark : ART.grassLight;
        ctx.globalAlpha = 0.35 + r() * 0.3;
        const px = x * TILE + r() * TILE;
        const py = y * TILE + r() * TILE;
        ctx.fillRect(px, py, 1.5, 2.5 + r() * 2);
      }
      ctx.globalAlpha = 1;
    }

  // 2. Dirt as overlapping blobs, so its edges are ragged rather than square.
  const blobs = (char: string, colours: string[], radius: number, jitter: number) => {
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        if (at(x, y) !== char) continue;
        const r = rnd(y * MAP_W + x + 31337);
        ctx.fillStyle = colours[Math.floor(r() * colours.length)];
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x * TILE + TILE / 2 + (r() - 0.5) * jitter, y * TILE + TILE / 2 + (r() - 0.5) * jitter, radius * (0.8 + r() * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      }
  };
  blobs('d', ART.dirt, 19, 10);
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== 'd') continue;
      const r = rnd(y * MAP_W + x + 777);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = r() < 0.5 ? ART.dirtDark : ART.dirtLight;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(x * TILE + r() * TILE, y * TILE + r() * TILE, 0.8 + r() * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

  // 3. Water: a sandy shore first, then the water over it, then a lighter shallows rim.
  blobs('w', [ART.sand], 23, 6);
  blobs('w', [ART.water], 19, 4);
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== 'w') continue;
      const deep = ['w', 'w', 'w', 'w'].every((_, i) => at(x + [1, -1, 0, 0][i], y + [0, 0, 1, -1][i]) === 'w');
      if (deep) {
        const cx = x * TILE + TILE / 2;
        const cy = y * TILE + TILE / 2;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
        g.addColorStop(0, ART.waterDeep);
        g.addColorStop(1, 'rgba(30,68,89,0)');
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = g;
        ctx.fillRect(cx - 30, cy - 30, 60, 60);
        ctx.globalAlpha = 1;
      }
      const r = rnd(y * MAP_W + x + 4242);
      ctx.strokeStyle = ART.waterLight;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const wx = x * TILE + r() * 20 + 4;
      const wy = y * TILE + r() * 24 + 4;
      ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo(wx + 4, wy - 2, wx + 8, wy);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

  // 4. Rock outcrops: faceted boulders with a lit face and a cast shadow.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (at(x, y) !== 'r') continue;
      const r = rnd(y * MAP_W + x + 5150);
      const n = 2 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const cx = x * TILE + 6 + r() * 20;
        const cy = y * TILE + 6 + r() * 20;
        const rad = 9 + r() * 7;
        const pts: [number, number][] = [];
        const sides = 6 + Math.floor(r() * 3);
        for (let k = 0; k < sides; k++) {
          const a = (k / sides) * Math.PI * 2 + r() * 0.4;
          const d = rad * (0.75 + r() * 0.35);
          pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + 4, py + 5) : ctx.moveTo(px + 4, py + 5)));
        ctx.fill();
        const g = ctx.createLinearGradient(cx - rad, cy - rad, cx + rad, cy + rad);
        g.addColorStop(0, ART.rockLight);
        g.addColorStop(0.55, ART.rock);
        g.addColorStop(1, ART.rockDark);
        ctx.fillStyle = g;
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(cx, cy);
        ctx.stroke();
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
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(cx + 5, cy + 6, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ART.treeDark;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ART.tree;
        ctx.beginPath();
        ctx.arc(cx - rad * 0.2, cy - rad * 0.2, rad * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ART.treeLight;
        ctx.beginPath();
        ctx.arc(cx - rad * 0.35, cy - rad * 0.4, rad * 0.35, 0, Math.PI * 2);
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
