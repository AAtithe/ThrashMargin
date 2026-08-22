/**
 * Chart projection. Depots and coastline go through the SAME `project()` call, which is the whole
 * reason a depot sits on its own coast without anyone hand-placing it.
 *
 * The projection is plate carree (equirectangular): longitude maps linearly to x, latitude linearly
 * to y. Fine at this scale — a single country spans too little latitude for Mercator's high-latitude
 * inflation to matter, so there is no reason to reach for it.
 *
 * VB_WIDTH/VB_HEIGHT are the SVG viewBox, chosen portrait to match Britain's own shape (taller than
 * it is wide) rather than reusing The Tea Race's wide world-chart box. Everything downstream (icon
 * sizes, label offsets, route strokes) is authored in these units, so there is no second scale
 * factor to keep in step.
 *
 * Unlike The Tea Race's world chart, this map does not wrap. That game needed `wrapDx`/`unwrapRun`/
 * `wrapPanX` because four legs crossed the antimeridian on a 360°-wide chart; no leg here comes
 * anywhere near half of a single country's width, so panning simply clamps to the chart's edges.
 */
import chart from '../content/worldChart.json';
import type { Depot, DepotId } from './types';
import { DEPOTS } from './content';

export const VB_WIDTH = 900;
export const VB_HEIGHT = 1100;

/** A GB bounding box with a little margin — Land's End to just past Glasgow, coast to coast. */
export const LON_MIN = -6.5;
export const LON_MAX = 2.2;
export const LAT_MAX = 59.0;
export const LAT_MIN = 49.8;

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

/** A depot's chart position: projected, then offset by its optional legibility nudge. */
export function depotPoint(depot: Depot): Point {
  const p = project(depot.lon, depot.lat);
  if (!depot.nudge) return p;
  return { x: p.x + depot.nudge[0], y: p.y + depot.nudge[1] };
}

export const DEPOT_POINTS: Record<DepotId, Point> = Object.fromEntries(
  DEPOTS.map(p => [p.id, depotPoint(p)]),
);

/** Clamps a horizontal pan so the chart cannot be dragged off into empty space either side. */
export function clampPanX(panX: number, zoom: number): number {
  const span = VB_WIDTH * zoom;
  const maxPan = Math.max(0, span - VB_WIDTH);
  return Math.min(0, Math.max(-maxPan, panX));
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
 * itself — if the projection changes, land, graticule and depots all move together by construction.
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
};
