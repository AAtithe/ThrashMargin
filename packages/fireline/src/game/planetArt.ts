/**
 * War for the Planet: the planet map, drawn on a canvas (fireline-planet-design.md, section 17). W4.
 *
 * Seas, continents and regions are a nearest-site raster at a quarter of the planet's resolution
 * (one cell per 4 by 4 planet units): a cell is land when its nearest site, of any continent, is
 * within 70 units and inside that continent's ellipse grown by 15 per cent, or lies on a causeway
 * along a land link (so no strait splits two regions joined by land). Each cell takes its
 * region owner's colour; a border is drawn where neighbouring cells differ. Over the raster: sea
 * links (dashed), trade routes (blockaded ones in the blockade colour), cities as squares sized by
 * level with the owner's letter, capitals ringed, field armies as numbered markers, and the
 * selection.
 *
 * Every colour comes from the --pl-* tokens in styles.css, read with getComputedStyle by
 * readPlanetPalette, so the map follows the light or dark choice. Owners are shown by a letter on
 * each city as well as by colour, never by colour alone.
 */
import { routePath } from '../planet/trade';
import { suppliedRegions } from '../planet/supply';
import { PLANET_H, PLANET_W } from '../planet/map';
import type { PlanetMap, PlanetState, RegionId } from '../planet/types';

/** Planet units per raster cell. */
const CELL = 4;
const GW = PLANET_W / CELL;
const GH = PLANET_H / CELL;
/** A cell further than this from every site is sea. */
const LAND_REACH = 70;
/** Sea further than this from every site is drawn as deep water. */
const DEEP_REACH = 150;
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
}

/** The view that fits the whole planet into a box of w by h CSS pixels. */
export function fitPlanet(w: number, h: number): { scale: number; ox: number; oy: number } {
  const scale = Math.min(w / PLANET_W, h / PLANET_H);
  return { scale, ox: (w - PLANET_W * scale) / 2, oy: (h - PLANET_H * scale) / 2 };
}

// ---- The raster (once per map) -----------------------------------------------------------------

interface Raster {
  /** Region per cell, or -1 for sea. */
  region: Int16Array;
  /** Sea cells far from land. */
  deep: Uint8Array;
}

const rasters = new WeakMap<PlanetMap, Raster>();

function rasterOf(map: PlanetMap): Raster {
  const hit = rasters.get(map);
  if (hit) return hit;
  const region = new Int16Array(GW * GH).fill(-1);
  const deep = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = (gx + 0.5) * CELL;
      const y = (gy + 0.5) * CELL;
      let best = -1;
      let bestD = Infinity;
      for (const r of map.regions) {
        const d = (r.x - x) * (r.x - x) + (r.y - y) * (r.y - y);
        if (d < bestD) {
          bestD = d;
          best = r.id;
        }
      }
      const i = gy * GW + gx;
      const d = Math.sqrt(bestD);
      if (best < 0) continue;
      if (d <= LAND_REACH) {
        const c = map.continents[map.regions[best].continent];
        const ex = (x - c.x) / (c.rx * 1.15);
        const ey = (y - c.y) / (c.ry * 1.15);
        // A site clamped to the canvas margin can sit just outside its ellipse: its own ground stays.
        if (ex * ex + ey * ey <= 1 || d <= 22) {
          region[i] = best;
          continue;
        }
      }
      if (d > DEEP_REACH) deep[i] = 1;
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
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - LINK_REACH) / CELL));
    const x1 = Math.min(GW - 1, Math.ceil((Math.max(a.x, b.x) + LINK_REACH) / CELL));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - LINK_REACH) / CELL));
    const y1 = Math.min(GH - 1, Math.ceil((Math.max(a.y, b.y) + LINK_REACH) / CELL));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const i = gy * GW + gx;
        if (region[i] >= 0) continue;
        const x = (gx + 0.5) * CELL;
        const y = (gy + 0.5) * CELL;
        const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (len * len)));
        const px = a.x + t * (b.x - a.x);
        const py = a.y + t * (b.y - a.y);
        if (Math.hypot(x - px, y - py) > LINK_REACH) continue;
        region[i] = Math.hypot(x - a.x, y - a.y) <= Math.hypot(x - b.x, y - b.y) ? a.id : b.id;
        deep[i] = 0;
      }
    }
  }
  const out = { region, deep };
  rasters.set(map, out);
  return out;
}

/** The region under a point in planet units, or null over open sea. */
export function regionAt(map: PlanetMap, x: number, y: number): RegionId | null {
  const gx = Math.floor(x / CELL);
  const gy = Math.floor(y / CELL);
  if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) {
    const r = rasterOf(map).region[gy * GW + gx];
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
  const a = (top[3] / 255) * k;
  return [base[0] + (top[0] - base[0]) * a, base[1] + (top[1] - base[1]) * a, base[2] + (top[2] - base[2]) * a, 255];
}

// ---- Drawing ----------------------------------------------------------------------------------

const ground = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();

/** The owner's letter on a city: the faction name's initial, N for the independents. */
export function ownerLetter(s: PlanetState, owner: number): string {
  if (owner < 0) return 'N';
  return (s.factions[owner]?.name ?? '?').charAt(0).toUpperCase();
}

export function drawPlanetMap(ctx: CanvasRenderingContext2D, map: PlanetMap, s: PlanetState, view: PlanetView): void {
  const P = view.palette;
  const raster = rasterOf(map);
  const owners = s.regions.map(r => r.owner);
  const cut = s.regions.map(() => false);
  for (const f of s.factions) {
    if (!f.alive) continue;
    const sup = suppliedRegions(s, f.id);
    s.regions.forEach((r, i) => {
      if (r.owner === f.id && !sup[i]) cut[i] = true;
    });
  }

  // 1. The raster: sea, land by owner, hatching for cut-off regions, borders.
  let off = ground.get(ctx);
  if (!off) {
    off = document.createElement('canvas');
    off.width = GW;
    off.height = GH;
    ground.set(ctx, off);
  }
  const g = off.getContext('2d')!;
  const img = g.createImageData(GW, GH);
  const data = img.data;
  const sea = rgba(P.sea);
  const seaDeep = rgba(P.seaDeep);
  const neutral = rgba(P.landNeutral);
  const border = rgba(P.border);
  const strong = rgba(P.borderStrong);
  const hatch = rgba(P.cut);
  const fill = P.faction.map(c => over(neutral, rgba(c), 0.62));
  const ownerAt = (i: number) => {
    const r = raster.region[i];
    return r < 0 ? -2 : owners[r];
  };
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx;
      const r = raster.region[i];
      let c: Rgba;
      if (r < 0) c = raster.deep[i] ? seaDeep : sea;
      else {
        const o = owners[r];
        c = o >= 0 ? fill[o] ?? neutral : neutral;
        if (cut[r] && (gx + gy) % 4 === 0) c = over(c, hatch);
        // Borders against the right and lower neighbours (and the left and upper, so lines are two cells wide at owner changes).
        const nb = [gx + 1 < GW ? i + 1 : -1, gy + 1 < GH ? i + GW : -1, gx > 0 ? i - 1 : -1, gy > 0 ? i - GW : -1];
        let edge: 0 | 1 | 2 = 0;
        for (let k = 0; k < nb.length; k++) {
          const j = nb[k];
          if (j < 0) continue;
          const rj = raster.region[j];
          if (rj === r) continue;
          if (rj < 0 || ownerAt(j) !== owners[r]) {
            edge = 2;
            break;
          }
          if (k < 2) edge = 1;
        }
        if (edge === 2) c = over(c, strong, 0.85);
        else if (edge === 1) c = over(c, border);
      }
      const p = i * 4;
      data[p] = c[0];
      data[p + 1] = c[1];
      data[p + 2] = c[2];
      data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.seaDeep;
  ctx.fillRect(0, 0, cw, ch);
  ctx.restore();
  const X = (x: number) => x * view.scale + view.ox;
  const Y = (y: number) => y * view.scale + view.oy;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, X(0), Y(0), PLANET_W * view.scale, PLANET_H * view.scale);
  ctx.imageSmoothingEnabled = true;

  // 2. Sea links, dashed.
  ctx.save();
  ctx.strokeStyle = P.borderStrong;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  for (const l of map.links) {
    if (!l.sea) continue;
    const a = map.regions[l.a];
    const b = map.regions[l.b];
    ctx.beginPath();
    ctx.moveTo(X(a.x), Y(a.y));
    ctx.lineTo(X(b.x), Y(b.y));
    ctx.stroke();
  }
  ctx.restore();

  // 3. Trade routes: the path this turn, or a dashed blockade line when there is none.
  for (const route of s.routes) {
    const path = routePath(s, route);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (path) {
      ctx.strokeStyle = P.halo;
      ctx.lineWidth = 5;
      ctx.beginPath();
      path.forEach((r, k) => (k ? ctx.lineTo(X(map.regions[r].x), Y(map.regions[r].y)) : ctx.moveTo(X(map.regions[r].x), Y(map.regions[r].y))));
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
  }

  // 4. Move and attack rings.
  const ring = (r: RegionId, colour: string, radius: number, width: number, dash: number[]) => {
    const g2 = map.regions[r];
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(X(g2.x), Y(g2.y), radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
  for (const r of view.moves) ring(r, P.select, 13, 1.5, [3, 3]);
  for (const r of view.targets) ring(r, P.war, 15, 2.5, [5, 3]);

  // The selection, under the cities so their letters and names stay readable.
  if (view.selected !== null && map.regions[view.selected]) {
    ring(view.selected, P.halo, 20, 5, []);
    ring(view.selected, P.select, 20, 2.5, []);
  }

  // 5. Cities: a square sized by level, the owner's letter on it, capitals ringed.
  const capitals = new Set(s.factions.filter(f => f.alive).map(f => f.capital));
  const small = view.scale < 0.45;
  for (const geo of map.regions) {
    const st = s.regions[geo.id];
    const size = (small ? 7 : 9) + st.city.level * (small ? 1.5 : 2);
    const x = X(geo.x);
    const y = Y(geo.y);
    if (capitals.has(geo.id)) {
      ctx.save();
      ctx.strokeStyle = P.capital;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = P.city;
    ctx.strokeStyle = st.owner >= 0 ? P.faction[st.owner] ?? P.borderStrong : P.borderStrong;
    ctx.lineWidth = 2;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    ctx.fillStyle = P.label;
    ctx.font = `700 ${Math.round(size * 0.72)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ownerLetter(s, st.owner), x, y + 0.5);
    if (view.names) {
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = P.halo;
      ctx.strokeText(geo.city, x, y + size / 2 + 2);
      ctx.fillStyle = P.name;
      ctx.fillText(geo.city, x, y + size / 2 + 2);
    }
  }

  // 6. Field armies: a marker with the unit count, beside the city.
  for (const f of s.factions) {
    if (!f.alive || !f.army) continue;
    const geo = map.regions[f.army.region];
    if (!geo) continue;
    const r = small ? 7 : 9;
    const x = X(geo.x) + (small ? 10 : 15) + (f.id % 2) * 2;
    const y = Y(geo.y) - (small ? 10 : 15) - Math.floor(f.id / 2) * 3;
    ctx.save();
    ctx.fillStyle = P.faction[f.id] ?? P.borderStrong;
    ctx.strokeStyle = P.halo;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.halo;
    ctx.font = `700 ${small ? 8 : 10}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(f.army.units.length), x, y + 0.5);
    ctx.restore();
  }

}
