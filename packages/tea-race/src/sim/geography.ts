/**
 * Chart projection. Ports and coastlines go through the SAME `project()` call, which is the whole
 * reason a port sits on its own coast without anyone hand-placing it — the lesson Niccolo's map
 * arrived at the long way round.
 *
 * The projection is plate carree (equirectangular): longitude maps linearly to x, latitude linearly
 * to y. Chosen over Mercator on purpose. Mercator is the navigator's projection because a rhumb
 * line is straight on it, which is tempting for a sailing game — but it inflates high latitudes so
 * violently that Greenland would dominate a chart whose actual subject is the tropics, and it
 * cannot show the Southern Ocean legs to Melbourne at all without an absurd aspect ratio.
 *
 * VB_WIDTH/VB_HEIGHT are the SVG viewBox. Everything downstream (icon sizes, label offsets, route
 * strokes) is authored in these units, so there is no second scale factor to keep in step — the
 * mistake that made Niccolo's city icons render sub-pixel after its own canvas changed size.
 */
import chart from '../content/worldChart.json';
import type { Port, PortId } from './types';
import { PORTS } from './content';

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

/** Inverse of `project`, for turning a click back into a position. */
export function unproject(x: number, y: number): { lon: number; lat: number } {
  return {
    lon: LON_MIN + (x / VB_WIDTH) * LON_SPAN,
    lat: LAT_MAX - (y / VB_HEIGHT) * LAT_SPAN,
  };
}

/** A port's chart position: projected, then offset by its optional legibility nudge. */
export function portPoint(port: Port): Point {
  const p = project(port.lon, port.lat);
  if (!port.nudge) return p;
  return { x: p.x + port.nudge[0], y: p.y + port.nudge[1] };
}

export const PORT_POINTS: Record<PortId, Point> = Object.fromEntries(
  PORTS.map(p => [p.id, portPoint(p)]),
);

/**
 * The chart wraps east–west, because the ocean does.
 *
 * Four sea legs cross the Pacific — San Francisco to Yokohama and to Hong Kong, and both Cape Horn
 * runs to Australia. Drawn as a plain straight line between two projected points, every one of them
 * goes the *long* way: San Francisco to Yokohama rendered as 1164px straight across Europe and Asia
 * instead of 436px across the Pacific. The route was always right in the graph; only the drawing
 * was wrong.
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
 * Lays a sequence of ports out in one continuous unwrapped run, each hop taken the short way. The
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
 * Normalises a horizontal pan into (-worldWidth, 0], so panning east or west forever stays
 * seamless instead of scrolling off into empty space. With the pan in that range, the copy at 0
 * and the copy one world to its right always cover the viewport between them.
 */
export function wrapPanX(panX: number, zoom: number): number {
  const span = VB_WIDTH * zoom;
  if (!Number.isFinite(span) || span <= 0) return 0;
  const m = panX % span;
  return m > 0 ? m - span : m;
}

function ringToPath(ring: number[][]): string {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const { x, y } = project(ring[i][0], ring[i][1]);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d + 'Z';
}

/**
 * Pre-built SVG path strings, computed once at module load. The renderer never projects anything
 * itself — if the projection changes, land, graticule and ports all move together by construction.
 */
export const CHART = {
  /** One path per landmass. */
  land: (chart.land as number[][][]).map(ringToPath),
  /** Meridians and parallels — two points each, straight under this projection. */
  graticule: (chart.graticule as number[][][]).map(line => {
    const a = project(line[0][0], line[0][1]);
    const b = project(line[1][0], line[1][1]);
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }),
  /** The equator, drawn heavier than the rest of the graticule. */
  equator: (() => {
    const a = project(LON_MIN, 0);
    const b = project(LON_MAX, 0);
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  })(),
};
