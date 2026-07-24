import geographyData from '../content/geography.json';
import { createProjector, ringToPath, smoothPath, reliefPath } from './projection';

/**
 * Real-geography map backdrop (the Donis-trapezoidal Ptolemaic projection, ported from the
 * standalone map/niccolo-map project), computed once at module load — ES modules are singletons,
 * so this runs exactly once per page load, not once per MapView mount or render. No build step, no
 * generated file to keep in sync: geography.json's domain/rings never change at runtime, so a
 * small module of computed constants is cheaper and simpler than either a codegen script or
 * recomputing on every render.
 */

/** Canvas width the backdrop is projected at. Chosen so every city's own dock-slot fan-out
 * (MapView.tsx's DOCK_RADIUS, unchanged by this migration) clears its neighbours with real margin
 * — at this width, the tightest city pair in the game (Bruges-Ghent) lands at ~1.5x the hard
 * overlap floor, not just barely over it. City x/y in content/cities/chapter*.json were projected
 * at this exact same width for 1:1 alignment with this backdrop; changing this constant without
 * re-migrating every city's coordinates would visibly misalign them. */
export const BACKDROP_WIDTH = 10000;

const mk = BACKDROP_WIDTH / 1400;
// Uniform margins, not the source project's default asymmetric {top,right,bottom:220*mk,left} —
// the extra bottom band only exists there to leave room for a cartouche/legend/compass band this
// game draws itself, elsewhere. Dropping the asymmetry saves dead canvas height with zero effect
// on any city's projected (x,y): verified directly (dx/dy = 0.0000 for every city checked) since
// margin.bottom affects only the total canvas height, not the project() function's output.
const MARGIN = { top: 120 * mk, right: 120 * mk, bottom: 120 * mk, left: 120 * mk };

interface GeographyData {
  domain: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  landmass: [number, number][];
  seas: { id: string; name: string; ring: [number, number][] }[];
  islands: { id: string; name: string; ring: [number, number][] }[];
  rivers: { id: string; name: string; line: [number, number][] }[];
  lakes?: { id: string; centre: [number, number]; rLon: number; rLat: number }[];
  mountains: { id: string; name: string; line: [number, number][] }[];
  labels: { text: string; at: [number, number]; kind: 'region' | 'sea' }[];
}

const geo = geographyData as unknown as GeographyData;

const P = createProjector({
  width: BACKDROP_WIDTH,
  domain: geo.domain,
  convergence: 0.55,
  latStretch: 1.15,
  margin: MARGIN,
});

/** Design values, authored against the source project's own 1400px reference and scaled by
 * P.scale() — the same "authored small, scaled up" pattern MapView.tsx's own castle icons and
 * vessel glyphs don't use (those are fixed pixel sizes, deliberately, see MapView.tsx), but which
 * is exactly right here since this backdrop's linework should scale with the projection the way
 * ink strokes on a real chart of any size would. */
export const GEO_STROKE = {
  coast: Math.max(0.8, P.scale(1.5)),
  ghost: Math.max(0.4, P.scale(0.8)),
  ghostOffsetX: Math.max(1, P.scale(2.4)),
  ghostOffsetY: Math.max(1, P.scale(2.4)) * 0.7,
  grid: Math.max(0.3, P.scale(0.55)),
  river: Math.max(0.5, P.scale(1.2)),
  relief: Math.max(0.5, P.scale(1.2)) * 0.9,
  hatchLine: Math.max(0.35, P.scale(0.9)),
  hatchGap: Math.max(4, P.scale(11)),
};
const HUMP = Math.max(3, P.scale(9));

export interface BackdropLabel {
  text: string;
  kind: 'region' | 'sea';
  x: number;
  y: number;
}

export const BACKDROP = {
  width: BACKDROP_WIDTH,
  height: P.height,
  neatline: P.neatline(),
  land: ringToPath(geo.landmass, P.project),
  seas: geo.seas.map(s => ({ id: s.id, d: ringToPath(s.ring, P.project) })),
  islands: geo.islands.map(i => ({ id: i.id, d: ringToPath(i.ring, P.project) })),
  rivers: geo.rivers.map(r => smoothPath(r.line.map(([lo, la]) => P.project(lo, la)), 0.4)).join(' '),
  lakes: (geo.lakes ?? []).map(lk => {
    const [cx, cy] = P.project(lk.centre[0], lk.centre[1]);
    const [ex] = P.project(lk.centre[0] + lk.rLon, lk.centre[1]);
    const [, ey] = P.project(lk.centre[0], lk.centre[1] - lk.rLat);
    return { id: lk.id, cx, cy, rx: Math.abs(ex - cx), ry: Math.abs(ey - cy) };
  }),
  mountains: geo.mountains.map(m => reliefPath(m.line.map(([lo, la]) => P.project(lo, la)), HUMP)).join(' '),
  graticule: (() => {
    const g = P.graticule(10, 10);
    return [...g.meridians, ...g.parallels]
      .map(seg => `M ${seg[0][0].toFixed(2)} ${seg[0][1].toFixed(2)} L ${seg[1][0].toFixed(2)} ${seg[1][1].toFixed(2)}`)
      .join(' ');
  })(),
  labels: geo.labels.map((lb): BackdropLabel => {
    const [x, y] = P.project(lb.at[0], lb.at[1]);
    return { text: lb.text, kind: lb.kind, x, y };
  }),
};
