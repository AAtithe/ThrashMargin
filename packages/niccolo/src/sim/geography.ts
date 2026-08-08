/**
 * Chart projection. Cities and coastlines go through the SAME `project()` call, which is the whole
 * reason a city sits on its own coast without anyone hand-placing it.
 *
 * The projection is plate carree (equirectangular): longitude maps linearly to x, latitude linearly
 * to y. This replaced a Ptolemaic chart — real coordinates warped onto Ptolemy's own positions and
 * drawn on his Donis trapezoidal projection. That was historically authentic but read as visibly
 * skewed, and being a bounded rectangle rather than a globe it could not wrap, so there was no way
 * to scroll round the world.
 *
 * VB_WIDTH/VB_HEIGHT are the SVG viewBox. Everything downstream (icon sizes, label offsets, route
 * strokes) is authored directly in these units, so there is no second scale factor to keep in
 * step — the mistake that made this game's own city icons need an `ICON_SCALE` fudge after its
 * canvas changed size.
 */
import chart from '../content/worldChart.json';
import { CITIES } from './content';
import type { City } from './types';

export const VB_WIDTH = 1600;
export const VB_HEIGHT = 900;

export const LON_MIN = -180;
export const LON_MAX = 180;
export const LAT_MAX = chart.latMax;
export const LAT_MIN = chart.latMin;

const LON_SPAN = LON_MAX - LON_MIN;
const LAT_SPAN = LAT_MAX - LAT_MIN;

export interface Point {
  x: number;
  y: number;
}

export function project(lon: number, lat: number): Point {
  return {
    x: ((lon - LON_MIN) / LON_SPAN) * VB_WIDTH,
    y: ((LAT_MAX - lat) / LAT_SPAN) * VB_HEIGHT,
  };
}

/** Inverse of `project`, for turning a click back into a position on the globe. */
export function unproject(x: number, y: number): { lon: number; lat: number } {
  return {
    lon: LON_MIN + (x / VB_WIDTH) * LON_SPAN,
    lat: LAT_MAX - (y / VB_HEIGHT) * LAT_SPAN,
  };
}

export const CITY_POINTS: Record<string, Point> = Object.fromEntries(
  (CITIES as City[]).map(c => [c.id, project(c.lon, c.lat)]),
);

/**
 * The chart wraps east–west, because the ocean does.
 *
 * `wrapDx` returns the signed x-offset by the shorter way round, which may run off one edge of the
 * sheet. `WORLD_COPIES` is how that is made to look continuous: the whole chart is drawn three
 * times side by side, so a line leaving the right edge is picked up by the copy beyond it.
 */
export function wrapDx(fromX: number, toX: number): number {
  let dx = toX - fromX;
  if (dx > VB_WIDTH / 2) dx -= VB_WIDTH;
  if (dx < -VB_WIDTH / 2) dx += VB_WIDTH;
  return dx;
}

/** Offsets, in viewBox units, at which the whole chart is repeated. */
export const WORLD_COPIES = [-VB_WIDTH, 0, VB_WIDTH];

/**
 * Lays a sequence of points out in one continuous unwrapped run, each hop taken the short way. The
 * result can extend past either edge of the sheet; the repeated copies make that read correctly.
 */
export function unwrapRun(points: Point[]): Point[] {
  if (points.length === 0) return [];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[i - 1];
    out.push({ x: prev.x + wrapDx(points[i - 1].x, points[i].x), y: points[i].y });
  }
  return out;
}

/**
 * Normalises a horizontal pan into (-worldWidth, 0], so panning east or west forever stays seamless
 * instead of scrolling off into empty space. With the pan in that range, the copy at 0 and the copy
 * one world to its right always cover the viewport between them.
 */
export function wrapPanX(panX: number, zoom: number): number {
  const span = VB_WIDTH * zoom;
  if (!Number.isFinite(span) || span <= 0) return 0;
  const m = panX % span;
  return m > 0 ? m - span : m;
}

/** Vertical pan is clamped so the sheet's top and bottom edges never scroll into view. Latitude
 * does not wrap — only longitude does. */
export const clampPanY = (panY: number, zoom: number) =>
  Math.min(0, Math.max(VB_HEIGHT * (1 - zoom), panY));

function ringToPath(ring: number[][]): string {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const { x, y } = project(ring[i][0], ring[i][1]);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d + 'Z';
}

function lineToPath(line: number[][]): string {
  let d = '';
  for (let i = 0; i < line.length; i++) {
    const { x, y } = project(line[i][0], line[i][1]);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

/** A mountain ridge drawn as a row of little humps along its line, the old chart's "caterpillar". */
function reliefPath(line: number[][], hump: number): string {
  const pts = line.map(([lo, la]) => project(lo, la));
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / (hump * 1.6)));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const x0 = a.x + (b.x - a.x) * t0;
      const y0 = a.y + (b.y - a.y) * t0;
      const x1 = a.x + (b.x - a.x) * t1;
      const y1 = a.y + (b.y - a.y) * t1;
      d += `M${x0.toFixed(1)} ${y0.toFixed(1)}Q${((x0 + x1) / 2).toFixed(1)} ${(Math.min(y0, y1) - hump).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
  }
  return d;
}

export interface ChartLabel {
  text: string;
  kind: 'region' | 'sea';
  x: number;
  y: number;
}

/**
 * Pre-built SVG path strings, computed once at module load (ES modules are singletons, so this runs
 * once per page load, not per render). The renderer never projects anything itself — if the
 * projection changes, land, graticule, rivers and cities all move together by construction.
 */
export const CHART = {
  width: VB_WIDTH,
  height: VB_HEIGHT,
  land: (chart.land as number[][][]).map(ringToPath),
  /** Enclosed water that sits inside a landmass (the Caspian), drawn over the land. */
  seas: (chart.seas as number[][][]).map(ringToPath),
  rivers: (chart.rivers as { name: string; line: number[][] }[]).map(r => lineToPath(r.line)).join(' '),
  mountains: (chart.mountains as { id: string; line: number[][] }[])
    .map(m => reliefPath(m.line, 4))
    .join(' '),
  graticule: (chart.graticule as number[][][])
    .map(seg => {
      const a = project(seg[0][0], seg[0][1]);
      const b = project(seg[1][0], seg[1][1]);
      return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    })
    .join(' '),
  equator: (() => {
    const a = project(LON_MIN, 0);
    const b = project(LON_MAX, 0);
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  })(),
  labels: (chart.labels as { text: string; at: number[]; kind: string }[]).map((lb): ChartLabel => {
    const p = project(lb.at[0], lb.at[1]);
    return { text: lb.text, kind: lb.kind as 'region' | 'sea', x: p.x, y: p.y };
  }),
};
