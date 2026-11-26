/**
 * War for the Planet: the planet map, drawn on a canvas (fireline-planet-design.md, section 17). W4.
 *
 * Seas, continents and regions are a nearest-site raster: a cell is land when its nearest site, of
 * any continent, is within 70 units and inside that continent's ellipse grown by 15 per cent, or
 * lies on a causeway along a land link (so no strait splits two regions joined by land). Two
 * rasters are built once per map from the same rule: a coarse one (one cell per 4 by 4 planet
 * units) that answers regionAt, so what a click selects never depends on the drawing, and a fine
 * one (2 by 2) that is only drawn. The fine raster carries each cell's distance from the coast (the
 * sea shades from shallow to deep, with a shoreline and a depth contour) and from its region's
 * edge (each region is shaded towards its border, so regions read as raised tiles).
 *
 * Layers, from the bottom: the ground (sea, land by owner, hatching for cut-off regions, borders),
 * small terrain marks, sea links (dashed): all cached, the ground per map, owners, supply and
 * palette, the whole layer per canvas size as well, so a redraw for a hover or the selection's
 * pulse is one drawImage plus the markers. Over that: trade routes (blockaded ones in the blockade
 * colour), the hovered region, move and attack rings, the selection, cities (a rounded tile in the
 * owner's colour band with the owner's letter, level pips, a star on capitals, a mark when cut
 * off) and field armies (a pennant with the unit count).
 *
 * Every colour comes from the --pl-* tokens in styles.css, read with getComputedStyle by
 * readPlanetPalette, so the map follows the light or dark choice. Owners are shown by a letter on
 * each city as well as by colour, never by colour alone.
 */
import { routePath } from '../planet/trade';
import { suppliedRegions } from '../planet/supply';
import { PLANET_H, PLANET_W } from '../planet/map';
import type { PlanetMap, PlanetState, RegionId } from '../planet/types';

/** Planet units per raster cell of the hit-testing raster. */
const CELL = 4;
const GW = PLANET_W / CELL;
const GH = PLANET_H / CELL;
/** Planet units per raster cell of the drawn raster. */
const DRAW_CELL = 2;
const FW = PLANET_W / DRAW_CELL;
const FH = PLANET_H / DRAW_CELL;
/** A cell further than this from every site is sea. */
const LAND_REACH = 70;
/** Half the width of the causeway of land drawn along a long land link. */
const LINK_REACH = 26;

export interface PlanetPalette {
  sea: string;
  seaDeep: string;
  landNeutral: string;
  border: string;
  borderStrong: string;
  faction: string[];
  route: string;
  routeBlocked: string;
  select: string;
  cut: string;
  city: string;
  capital: string;
  label: string;
  name: string;
  halo: string;
  war: string;
  shore: string;
  relief: string;
  terrain: string;
  shadow: string;
}

const TOKENS: Record<Exclude<keyof PlanetPalette, 'faction'>, string> = {
  sea: '--pl-sea',
  seaDeep: '--pl-sea-deep',
  landNeutral: '--pl-land-neutral',
  border: '--pl-border',
  borderStrong: '--pl-border-strong',
  route: '--pl-route',
  routeBlocked: '--pl-route-blocked',
  select: '--pl-select',
  cut: '--pl-cut',
  city: '--pl-city',
  capital: '--pl-capital',
  label: '--pl-label',
  name: '--pl-name',
  halo: '--pl-halo',
  war: '--pl-war',
  shore: '--pl-shore',
  relief: '--pl-relief',
  terrain: '--pl-terrain',
  shadow: '--pl-shadow',
};

/** The map's colours, read from the CSS tokens on `el` (call again when the theme changes). */
export function readPlanetPalette(el: Element): PlanetPalette {
  const cs = getComputedStyle(el);
  const get = (name: string) => cs.getPropertyValue(name).trim() || 'gray';
  const out = { faction: [0, 1, 2, 3, 4].map(i => get(`--pl-f${i}`)) } as PlanetPalette;
  for (const [k, v] of Object.entries(TOKENS)) (out as unknown as Record<string, string>)[k] = get(v);
  return out;
}

/** Where the planet sits on the canvas, in CSS pixels: screen = planet * scale + offset. */
export interface PlanetView {
  scale: number;
  ox: number;
  oy: number;
  palette: PlanetPalette;
  selected: RegionId | null;
  /** Regions the field army could attack now: ringed in the war colour. */
  targets: RegionId[];
  /** Regions the field army could move to now: ringed lightly. */
  moves: RegionId[];
  /** Draw city names (off on small screens). */
  names: boolean;
  /** The region under the pointer, lightly filled (null: none). */
  hover?: RegionId | null;
  /** The selection ring's pulse, 0..1 (absent or 0 with motion off: a still ring). */
  pulse?: number;
}

/** The part of the planet worth showing: every site, padded by how far land reaches, as a box. */
export interface LandBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxes = new WeakMap<PlanetMap, LandBox>();

export function landBounds(map: PlanetMap): LandBox {
  const hit = boxes.get(map);
  if (hit) return hit;
  const pad = LAND_REACH + 20;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of map.regions) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x);
    y1 = Math.max(y1, r.y);
  }
  const out: LandBox = map.regions.length
    ? (() => {
        const bx = Math.max(0, x0 - pad);
        const by = Math.max(0, y0 - pad);
        return { x: bx, y: by, w: Math.min(PLANET_W, x1 + pad) - bx, h: Math.min(PLANET_H, y1 + pad) - by };
      })()
    : { x: 0, y: 0, w: PLANET_W, h: PLANET_H };
  boxes.set(map, out);
  return out;
}

/** The canvas's width over height that suits this planet's land (between 1.4 and 2.2). */
export function planetAspect(map: PlanetMap): number {
  const b = landBounds(map);
  return Math.max(1.4, Math.min(2.2, b.w / b.h));
}

/** The view that fits the planet's land into a box of w by h CSS pixels (clicks use the same). */
export function fitPlanet(w: number, h: number, map: PlanetMap): { scale: number; ox: number; oy: number } {
  const b = landBounds(map);
  const scale = Math.min(w / b.w, h / b.h);
  return { scale, ox: (w - b.w * scale) / 2 - b.x * scale, oy: (h - b.h * scale) / 2 - b.y * scale };
}

// ---- The rasters (once per map) ----------------------------------------------------------------

/** Region per cell, or -1 for sea, on a grid of `cell` planet units. */
function regionGrid(map: PlanetMap, cell: number): Int16Array {
  const w = PLANET_W / cell;
  const h = PLANET_H / cell;
  const region = new Int16Array(w * h).fill(-1);
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const x = (gx + 0.5) * cell;
      const y = (gy + 0.5) * cell;
      let best = -1;
      let bestD = Infinity;
      for (const r of map.regions) {
        const d = (r.x - x) * (r.x - x) + (r.y - y) * (r.y - y);
        if (d < bestD) {
          bestD = d;
          best = r.id;
        }
      }
      if (best < 0) continue;
      const d = Math.sqrt(bestD);
      if (d <= LAND_REACH) {
        const c = map.continents[map.regions[best].continent];
        const ex = (x - c.x) / (c.rx * 1.15);
        const ey = (y - c.y) / (c.ry * 1.15);
        // A site clamped to the canvas margin can sit just outside its ellipse: its own ground stays.
        if (ex * ex + ey * ey <= 1 || d <= 22) region[gy * w + gx] = best;
      }
    }
  }
  // A long land link can leave a strait between regions that march on each other by land: a
  // causeway along every land link closes it (sea cells within LINK_REACH of the link take the
  // nearer end's region).
  for (const l of map.links) {
    if (l.sea) continue;
    const a = map.regions[l.a];
    const b = map.regions[l.b];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - LINK_REACH) / cell));
    const x1 = Math.min(w - 1, Math.ceil((Math.max(a.x, b.x) + LINK_REACH) / cell));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - LINK_REACH) / cell));
    const y1 = Math.min(h - 1, Math.ceil((Math.max(a.y, b.y) + LINK_REACH) / cell));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const i = gy * w + gx;
        if (region[i] >= 0) continue;
        const x = (gx + 0.5) * cell;
        const y = (gy + 0.5) * cell;
        const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (len * len)));
        const px = a.x + t * (b.x - a.x);
        const py = a.y + t * (b.y - a.y);
        if (Math.hypot(x - px, y - py) > LINK_REACH) continue;
        region[i] = Math.hypot(x - a.x, y - a.y) <= Math.hypot(x - b.x, y - b.y) ? a.id : b.id;
      }
    }
  }
  return region;
}

/** Chamfer distance (in cells) from every cell to the nearest cell flagged in `src`. */
function chamfer(src: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : 1e6;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
        if (x > 0) v = Math.min(v, d[i + w - 1] + D);
      }
      d[i] = v;
    }
  }
  return d;
}

interface Fine {
  region: Int16Array;
  /** Sea cells: distance from the nearest land cell, in fine cells. */
  seaDist: Float32Array;
  /** Land cells: distance from the nearest cell of another region or the sea, in fine cells. */
  edgeDist: Float32Array;
}

const coarse = new WeakMap<PlanetMap, Int16Array>();
const fines = new WeakMap<PlanetMap, Fine>();

function coarseOf(map: PlanetMap): Int16Array {
  let r = coarse.get(map);
  if (!r) {
    r = regionGrid(map, CELL);
    coarse.set(map, r);
  }
  return r;
}

function fineOf(map: PlanetMap): Fine {
  const hit = fines.get(map);
  if (hit) return hit;
  const region = regionGrid(map, DRAW_CELL);
  const land = new Uint8Array(FW * FH);
  const edge = new Uint8Array(FW * FH);
  for (let gy = 0; gy < FH; gy++) {
    for (let gx = 0; gx < FW; gx++) {
      const i = gy * FW + gx;
      const r = region[i];
      if (r < 0) {
        edge[i] = 1;
        continue;
      }
      land[i] = 1;
      if (
        (gx + 1 < FW && region[i + 1] !== r) ||
        (gx > 0 && region[i - 1] !== r) ||
        (gy + 1 < FH && region[i + FW] !== r) ||
        (gy > 0 && region[i - FW] !== r)
      )
        edge[i] = 1;
    }
  }
  const out = { region, seaDist: chamfer(land, FW, FH), edgeDist: chamfer(edge, FW, FH) };
  fines.set(map, out);
  return out;
}

/** The region under a point in planet units, or null over open sea. */
export function regionAt(map: PlanetMap, x: number, y: number): RegionId | null {
  const gx = Math.floor(x / CELL);
  const gy = Math.floor(y / CELL);
  if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) {
    const r = coarseOf(map)[gy * GW + gx];
    if (r >= 0) return r;
  }
  let best: RegionId | null = null;
  let bestD = 30;
  for (const r of map.regions) {
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) {
      bestD = d;
      best = r.id;
    }
  }
  return best;
}

// ---- Colour arithmetic (canvas only: token values parsed once) --------------------------------

type Rgba = [number, number, number, number];
const parsed = new Map<string, Rgba>();
let probe: CanvasRenderingContext2D | null = null;

function rgba(colour: string): Rgba {
  const hit = parsed.get(colour);
  if (hit) return hit;
  if (!probe) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    probe = c.getContext('2d', { willReadFrequently: true });
  }
  let out: Rgba = [128, 128, 128, 255];
  if (probe) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#808080';
    probe.fillStyle = colour;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    out = [d[0], d[1], d[2], d[3]];
  }
  parsed.set(colour, out);
  return out;
}

/** `top` laid over `base` with its own alpha times k. */
function over(base: Rgba, top: Rgba, k = 1): Rgba {
  const a = Math.max(0, Math.min(1, (top[3] / 255) * k));
  return [base[0] + (top[0] - base[0]) * a, base[1] + (top[1] - base[1]) * a, base[2] + (top[2] - base[2]) * a, 255];
}

function lerp(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 255];
}

// ---- Per-state facts (cached: a pulse redraw must not re-run supply or routing) ---------------

const cuts = new WeakMap<PlanetState, boolean[]>();

function cutOf(s: PlanetState): boolean[] {
  const hit = cuts.get(s);
  if (hit) return hit;
  const cut = s.regions.map(() => false);
  for (const f of s.factions) {
    if (!f.alive) continue;
    const sup = suppliedRegions(s, f.id);
    s.regions.forEach((r, i) => {
      if (r.owner === f.id && !sup[i]) cut[i] = true;
    });
  }
  cuts.set(s, cut);
  return cut;
}

const routeCache = new WeakMap<PlanetState, (RegionId[] | null)[]>();

function routesOf(s: PlanetState): (RegionId[] | null)[] {
  let r = routeCache.get(s);
  if (!r) {
    r = s.routes.map(route => routePath(s, route));
    routeCache.set(s, r);
  }
  return r;
}

// ---- The ground (fine raster coloured by owner, cached per map and key) -----------------------

interface GroundCache {
  key: string;
  canvas: HTMLCanvasElement;
}
const grounds = new WeakMap<PlanetMap, GroundCache>();

function paletteKey(P: PlanetPalette): string {
  return [P.sea, P.seaDeep, P.landNeutral, P.border, P.borderStrong, P.cut, P.shore, P.relief, ...P.faction].join('|');
}

function groundOf(map: PlanetMap, owners: number[], cut: boolean[], P: PlanetPalette, pKey: string): { key: string; canvas: HTMLCanvasElement } {
  const key = `${owners.join(',')}/${cut.map(c => (c ? 1 : 0)).join('')}/${pKey}`;
  const hit = grounds.get(map);
  if (hit && hit.key === key) return hit;
  const canvas = hit?.canvas ?? document.createElement('canvas');
  canvas.width = FW;
  canvas.height = FH;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(FW, FH);
  const data = img.data;
  const fine = fineOf(map);
  const sea = rgba(P.sea);
  const seaDeep = rgba(P.seaDeep);
  const shore = rgba(P.shore);
  const relief = rgba(P.relief);
  const neutral = rgba(P.landNeutral);
  const border = rgba(P.border);
  const strong = rgba(P.borderStrong);
  const hatch = rgba(P.cut);
  const fill = P.faction.map(c => over(neutral, rgba(c), 0.62));
  const region = fine.region;
  const ownerAt = (j: number) => {
    const r = region[j];
    return r < 0 ? -2 : owners[r];
  };
  for (let gy = 0; gy < FH; gy++) {
    for (let gx = 0; gx < FW; gx++) {
      const i = gy * FW + gx;
      const r = region[i];
      let c: Rgba;
      if (r < 0) {
        // Sea: shallow by the coast, deep in open water, with a shoreline and one depth contour.
        const d = fine.seaDist[i];
        const t = Math.min(1, Math.max(0, (d - 1) / 26));
        c = lerp(sea, seaDeep, t * t * (3 - 2 * t));
        if (d < 1.5) c = over(c, shore, 0.7);
        else if (d < 2.5) c = over(c, shore, 0.3);
        else if (Math.abs(d - 9) < 0.6) c = over(c, shore, 0.14);
      } else {
        const o = owners[r];
        c = o >= 0 ? fill[o] ?? neutral : neutral;
        // Relief: each region darkens towards its edge.
        const e = fine.edgeDist[i];
        if (e < 7) c = over(c, relief, 1 - e / 7);
        if (cut[r] && (gx + gy) % 8 < 2) c = over(c, hatch);
        // Borders: strong at coasts and owner changes (both sides), light between one owner's regions.
        let edge: 0 | 1 | 2 = 0;
        const nb0 = gx + 1 < FW ? i + 1 : -1;
        const nb1 = gy + 1 < FH ? i + FW : -1;
        const nb2 = gx > 0 ? i - 1 : -1;
        const nb3 = gy > 0 ? i - FW : -1;
        const nbs = [nb0, nb1, nb2, nb3];
        for (let k = 0; k < 4; k++) {
          const j = nbs[k];
          if (j < 0) continue;
          const rj = region[j];
          if (rj === r) continue;
          if (rj < 0 || ownerAt(j) !== o) {
            edge = 2;
            break;
          }
          if (k < 2) edge = 1;
        }
        if (edge === 2) c = over(c, strong, 0.8);
        else if (edge === 1) c = over(c, border, 1.3);
      }
      const p = i * 4;
      data[p] = c[0];
      data[p + 1] = c[1];
      data[p + 2] = c[2];
      data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const out = { key, canvas };
  grounds.set(map, out);
  return out;
}

// ---- Terrain marks (placed once per map) -------------------------------------------------------

interface Mark {
  x: number;
  y: number;
  kind: string;
}
const markCache = new WeakMap<PlanetMap, Mark[]>();

/** A deterministic fraction in [0, 1) from two integers (presentation only: no dice here). */
function hash01(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function marksOf(map: PlanetMap): Mark[] {
  const hit = markCache.get(map);
  if (hit) return hit;
  const fine = fineOf(map);
  const out: Mark[] = [];
  for (const geo of map.regions) {
    let placed = 0;
    for (let k = 0; k < 10 && placed < 3; k++) {
      const ang = hash01(geo.id + 1, k * 2 + 1) * Math.PI * 2;
      const dist = 20 + hash01(geo.id + 1, k * 2 + 2) * 24;
      const x = geo.x + Math.cos(ang) * dist;
      const y = geo.y + Math.sin(ang) * dist;
      const gx = Math.floor(x / DRAW_CELL);
      const gy = Math.floor(y / DRAW_CELL);
      if (gx < 0 || gy < 0 || gx >= FW || gy >= FH) continue;
      const i = gy * FW + gx;
      if (fine.region[i] !== geo.id || fine.edgeDist[i] < 5) continue;
      // Clear of the other marks, and of the army pennant's corner (up and to the right of the city).
      if (out.some(m => Math.hypot(m.x - x, m.y - y) < 14)) continue;
      if (x > geo.x && y < geo.y - 4 && dist < 34) continue;
      // Clear of every city's tile, pips and name below it.
      if (map.regions.some(o => Math.abs(o.x - x) < 34 && y > o.y - 26 && y < o.y + 34)) continue;
      out.push({ x, y, kind: geo.terrain });
      placed++;
    }
  }
  markCache.set(map, out);
  return out;
}

function drawMark(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, g: number): void {
  switch (kind) {
    case 'river':
      ctx.moveTo(x - 6 * g, y);
      ctx.quadraticCurveTo(x - 3 * g, y - 3 * g, x, y);
      ctx.quadraticCurveTo(x + 3 * g, y + 3 * g, x + 6 * g, y);
      ctx.moveTo(x - 4 * g, y + 4 * g);
      ctx.quadraticCurveTo(x - 1 * g, y + 1.5 * g, x + 2 * g, y + 4 * g);
      break;
    case 'highlands':
      ctx.moveTo(x - 6 * g, y + 3 * g);
      ctx.lineTo(x - 2 * g, y - 3 * g);
      ctx.lineTo(x + 1 * g, y + 1 * g);
      ctx.lineTo(x + 3 * g, y - 1 * g);
      ctx.lineTo(x + 6 * g, y + 3 * g);
      break;
    case 'lakes':
      ctx.moveTo(x + 4 * g, y);
      ctx.ellipse(x, y, 4 * g, 2.2 * g, 0, 0, Math.PI * 2);
      break;
    case 'plains':
      ctx.moveTo(x - 3 * g, y + 2 * g);
      ctx.lineTo(x - 4 * g, y - 1.5 * g);
      ctx.moveTo(x, y + 2 * g);
      ctx.lineTo(x, y - 2.5 * g);
      ctx.moveTo(x + 3 * g, y + 2 * g);
      ctx.lineTo(x + 4 * g, y - 1.5 * g);
      break;
    case 'canyon':
      ctx.moveTo(x - 6 * g, y - 2 * g);
      ctx.lineTo(x - 2 * g, y);
      ctx.lineTo(x + 2 * g, y - 2 * g);
      ctx.lineTo(x + 6 * g, y);
      ctx.moveTo(x - 6 * g, y + 2 * g);
      ctx.lineTo(x - 2 * g, y + 4 * g);
      ctx.lineTo(x + 2 * g, y + 2 * g);
      ctx.lineTo(x + 6 * g, y + 4 * g);
      break;
    default:
      // Woods: two small crowns.
      ctx.moveTo(x - 0.5 * g, y);
      ctx.arc(x - 2.5 * g, y, 2 * g, 0, Math.PI * 2);
      ctx.moveTo(x + 4.5 * g, y + 1 * g);
      ctx.arc(x + 2.5 * g, y + 1 * g, 2 * g, 0, Math.PI * 2);
  }
}

// ---- The static layer (ground, marks, sea links), cached per canvas --------------------------

interface Layer {
  key: string;
  canvas: HTMLCanvasElement;
}
const layers = new WeakMap<CanvasRenderingContext2D, Layer>();

function layerOf(ctx: CanvasRenderingContext2D, map: PlanetMap, s: PlanetState, view: PlanetView): HTMLCanvasElement {
  const P = view.palette;
  const pKey = paletteKey(P);
  const owners = s.regions.map(r => r.owner);
  const ground = groundOf(map, owners, cutOf(s), P, pKey);
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const t = ctx.getTransform();
  const key = `${ground.key}#${map.name}#${cw}x${ch}#${view.scale.toFixed(4)},${view.ox.toFixed(2)},${view.oy.toFixed(2)}#${t.a}#${P.terrain}`;
  let layer = layers.get(ctx);
  if (layer && layer.key === key) return layer.canvas;
  const canvas = layer?.canvas ?? document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const c = canvas.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = P.seaDeep;
  c.fillRect(0, 0, cw, ch);
  c.setTransform(t);
  const X = (x: number) => x * view.scale + view.ox;
  const Y = (y: number) => y * view.scale + view.oy;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  // A touch of blur, about half a raster cell, takes the stair steps out of coasts and borders
  // (where the canvas filter is not supported the ground is drawn unblurred).
  const soft = Math.min(1, 0.38 * DRAW_CELL * view.scale);
  c.save();
  if ('filter' in c && soft >= 0.3) c.filter = `blur(${soft.toFixed(2)}px)`;
  c.drawImage(ground.canvas, X(0), Y(0), PLANET_W * view.scale, PLANET_H * view.scale);
  c.restore();

  // Terrain marks, faint, under everything else.
  const g = Math.max(0.6, Math.min(1.3, view.scale * 1.1));
  c.save();
  c.strokeStyle = P.terrain;
  c.globalAlpha = 0.42;
  c.lineWidth = Math.max(1, 1.2 * g);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  for (const m of marksOf(map)) drawMark(c, m.kind, X(m.x), Y(m.y), g);
  c.stroke();
  c.restore();

  // Sea links, dashed.
  c.save();
  c.strokeStyle = P.borderStrong;
  c.globalAlpha = 0.55;
  c.lineWidth = 1.2;
  c.setLineDash([4, 4]);
  c.beginPath();
  for (const l of map.links) {
    if (!l.sea) continue;
    const a = map.regions[l.a];
    const b = map.regions[l.b];
    c.moveTo(X(a.x), Y(a.y));
    c.lineTo(X(b.x), Y(b.y));
  }
  c.stroke();
  c.restore();
  layer = { key, canvas };
  layers.set(ctx, layer);
  return canvas;
}

// ---- The hovered region's fill (one small canvas per region and colour) ----------------------

const masks = new WeakMap<PlanetMap, Map<string, { canvas: HTMLCanvasElement; x: number; y: number }>>();

function maskOf(map: PlanetMap, r: RegionId, colour: string): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  let byKey = masks.get(map);
  if (!byKey) {
    byKey = new Map();
    masks.set(map, byKey);
  }
  const key = `${r}|${colour}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const fine = fineOf(map);
  let x0 = FW;
  let y0 = FH;
  let x1 = -1;
  let y1 = -1;
  for (let gy = 0; gy < FH; gy++) {
    for (let gx = 0; gx < FW; gx++) {
      if (fine.region[gy * FW + gx] !== r) continue;
      if (gx < x0) x0 = gx;
      if (gx > x1) x1 = gx;
      if (gy < y0) y0 = gy;
      if (gy > y1) y1 = gy;
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(w, h);
  const col = rgba(colour);
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const i = (y0 + gy) * FW + (x0 + gx);
      if (fine.region[i] !== r) continue;
      const p = (gy * w + gx) * 4;
      // Brighter at the region's edge, so the highlight reads as an outline with a soft fill.
      const e = fine.edgeDist[i];
      data4(img.data, p, col, e < 1.5 ? 255 : e < 2.5 ? 140 : 50);
    }
  }
  g.putImageData(img, 0, 0);
  const out = { canvas, x: x0 * DRAW_CELL, y: y0 * DRAW_CELL };
  byKey.set(key, out);
  return out;
}

function data4(d: Uint8ClampedArray, p: number, c: Rgba, a: number): void {
  d[p] = c[0];
  d[p + 1] = c[1];
  d[p + 2] = c[2];
  d[p + 3] = a;
}

// ---- Drawing ----------------------------------------------------------------------------------

/** The owner's letter on a city: the faction name's initial, N for the independents. */
export function ownerLetter(s: PlanetState, owner: number): string {
  if (owner < 0) return 'N';
  return (s.factions[owner]?.name ?? '?').charAt(0).toUpperCase();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    if (k) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

const FONT_NAME = '600 10px system-ui, sans-serif';
const letterFonts = new Map<number, string>();
const letterFont = (px: number) => {
  let f = letterFonts.get(px);
  if (!f) {
    f = `700 ${px}px system-ui, sans-serif`;
    letterFonts.set(px, f);
  }
  return f;
};

export function drawPlanetMap(ctx: CanvasRenderingContext2D, map: PlanetMap, s: PlanetState, view: PlanetView): void {
  const P = view.palette;
  const cut = cutOf(s);

  // 1. The static layer: sea, land, terrain marks, sea links.
  const layer = layerOf(ctx, map, s, view);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
  const X = (x: number) => x * view.scale + view.ox;
  const Y = (y: number) => y * view.scale + view.oy;

  // 2. The hovered region, softly filled with a brighter rim.
  if (view.hover != null && view.hover !== view.selected && map.regions[view.hover]) {
    const m = maskOf(map, view.hover, P.select);
    if (m) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(m.canvas, X(m.x), Y(m.y), m.canvas.width * DRAW_CELL * view.scale, m.canvas.height * DRAW_CELL * view.scale);
      ctx.restore();
    }
  }

  // 3. Trade routes: the path this turn, or a dashed blockade line when there is none.
  const paths = routesOf(s);
  s.routes.forEach((route, k) => {
    const path = paths[k];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (path) {
      ctx.strokeStyle = P.halo;
      ctx.lineWidth = 5;
      ctx.beginPath();
      path.forEach((r, n) => (n ? ctx.lineTo(X(map.regions[r].x), Y(map.regions[r].y)) : ctx.moveTo(X(map.regions[r].x), Y(map.regions[r].y))));
      ctx.stroke();
      ctx.strokeStyle = P.route;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      const a = map.regions[route.from];
      const b = map.regions[route.to];
      ctx.strokeStyle = P.routeBlocked;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
      ctx.stroke();
    }
    ctx.restore();
  });

  // 4. Move and attack rings.
  const ring = (r: RegionId, colour: string, radius: number, width: number, dash: number[], alpha = 1) => {
    const g2 = map.regions[r];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(X(g2.x), Y(g2.y), radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
  const small = view.scale < 0.45;
  const rk = small ? 0.72 : 1;
  for (const r of view.moves) ring(r, P.select, 15 * rk, 1.5, [3, 3]);
  for (const r of view.targets) {
    ring(r, P.halo, 17 * rk, 5, [5, 3], 0.7);
    ring(r, P.war, 17 * rk, 2.5, [5, 3]);
  }

  // The selection, under the cities so their letters and names stay readable; it breathes when
  // motion is on (the caller passes the pulse), and stands still otherwise.
  if (view.selected !== null && map.regions[view.selected]) {
    const p = view.pulse ?? 0;
    const rad = (21 + 2 * p) * rk;
    if (p > 0) ring(view.selected, P.select, rad + 4 + 6 * p, 2, [], 0.45 * (1 - p));
    ring(view.selected, P.halo, rad, 5, []);
    ring(view.selected, P.select, rad, 2.5, []);
  }

  // 5. Cities: a rounded tile sized by level, the owner's colour band, the owner's letter, level
  // pips, a star on capitals and a mark when cut off from the capital.
  const capitals = new Set(s.factions.filter(f => f.alive).map(f => f.capital));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Round joins on the text halos: a mitred stroke spikes off letters such as M.
  ctx.lineJoin = 'round';
  for (const geo of map.regions) {
    const st = s.regions[geo.id];
    const size = Math.round((small ? 9 : 12) + st.city.level * (small ? 1.4 : 1.8));
    const x = X(geo.x);
    const y = Y(geo.y);
    const left = x - size / 2;
    const top = y - size / 2;
    const rad = Math.max(2, size * 0.18);
    const own = st.owner >= 0 ? P.faction[st.owner] ?? P.borderStrong : P.borderStrong;
    // Shadow, then the tile.
    ctx.fillStyle = P.shadow;
    ctx.beginPath();
    roundRectPath(ctx, left + 1.2, top + 1.8, size, size, rad);
    ctx.fill();
    ctx.beginPath();
    roundRectPath(ctx, left, top, size, size, rad);
    ctx.fillStyle = P.city;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = own;
    ctx.fillRect(left, top, size, Math.round(size * 0.3));
    ctx.restore();
    ctx.strokeStyle = own;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = P.label;
    ctx.font = letterFont(Math.round(size * 0.56));
    ctx.fillText(ownerLetter(s, st.owner), x, y + size * 0.16);

    // Level: pips under the tile (a numeral on small screens from level 4).
    const lv = st.city.level;
    const pipY = y + size / 2 + 4;
    if (small && lv >= 4) {
      ctx.font = letterFont(8);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = P.halo;
      ctx.strokeText(String(lv), x, pipY + 1);
      ctx.fillStyle = P.name;
      ctx.fillText(String(lv), x, pipY + 1);
    } else {
      const gap = small ? 3.4 : 4.2;
      const pr = small ? 1.1 : 1.4;
      ctx.beginPath();
      for (let k = 0; k < lv; k++) {
        const px = x + (k - (lv - 1) / 2) * gap;
        ctx.moveTo(px + pr, pipY);
        ctx.arc(px, pipY, pr, 0, Math.PI * 2);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = P.halo;
      ctx.stroke();
      ctx.fillStyle = P.name;
      ctx.fill();
    }

    if (capitals.has(geo.id)) {
      const sr = small ? 4.5 : 5.5;
      ctx.beginPath();
      starPath(ctx, left, top, sr);
      ctx.lineWidth = 2;
      ctx.strokeStyle = P.halo;
      ctx.stroke();
      ctx.fillStyle = P.capital;
      ctx.fill();
    }
    if (cut[geo.id]) {
      const cx = left + size;
      const cy = top;
      const cr = small ? 3.6 : 4.4;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fillStyle = P.city;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = P.cut;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - cr * 0.6, cy + cr * 0.6);
      ctx.lineTo(cx + cr * 0.6, cy - cr * 0.6);
      ctx.stroke();
    }
    if (view.names) {
      ctx.font = FONT_NAME;
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = P.halo;
      const ny = pipY + 4;
      ctx.strokeText(geo.city, x, ny);
      ctx.fillStyle = P.name;
      ctx.fillText(geo.city, x, ny);
      ctx.textBaseline = 'middle';
    }
  }

  // 6. Field armies: a pennant in the faction's colour with the unit count beside it; a second
  // army in the same region stands further along.
  const stacked = new Map<RegionId, number>();
  for (const f of s.factions) {
    if (!f.alive || !f.army) continue;
    const geo = map.regions[f.army.region];
    if (!geo) continue;
    const n = stacked.get(geo.id) ?? 0;
    stacked.set(geo.id, n + 1);
    const k = small ? 0.8 : 1;
    const bx = X(geo.x) + (small ? 9 : 12) + n * 15 * k;
    const by = Y(geo.y) - (small ? 3 : 4);
    const poleTop = by - 16 * k;
    const col = P.faction[f.id] ?? P.borderStrong;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Pole.
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx, poleTop);
    ctx.strokeStyle = P.halo;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = P.borderStrong;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Flag.
    ctx.beginPath();
    ctx.moveTo(bx, poleTop);
    ctx.lineTo(bx + 11 * k, poleTop + 4 * k);
    ctx.lineTo(bx, poleTop + 8 * k);
    ctx.closePath();
    ctx.strokeStyle = P.halo;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fill();
    // Count, in a pill under the flag.
    const label = String(f.army.units.length);
    ctx.font = letterFont(small ? 8 : 9);
    const tw = ctx.measureText(label).width;
    const pw = tw + 6;
    const ph = small ? 10 : 11;
    const px = bx + 1;
    const py = poleTop + 8 * k + 1;
    ctx.beginPath();
    roundRectPath(ctx, px, py, pw, ph, ph / 2);
    ctx.fillStyle = P.halo;
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = P.name;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + pw / 2, py + ph / 2 + 0.5);
    ctx.restore();
  }
}
