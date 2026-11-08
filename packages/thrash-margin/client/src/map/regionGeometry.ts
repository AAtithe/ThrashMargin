import { Delaunay } from 'd3-delaunay';
import type { Territory } from 'shared/sim';

export interface MapGeometry {
  /** Smoothed, organic SVG path per territory id — the region's fill/stroke shape. */
  cellPaths: Map<number, string>;
  /** Polygon centroid + approximate visual radius per territory id — anchor for overlays. */
  centroids: Map<number, { x: number; y: number; radius: number }>;
  /** Pairs of territory ids that are true Voronoi (geometric) neighbours, keyed "loId-hiId". */
  geometricEdgeSet: Set<string>;
  /** The board's frame: the land plus a band of sea, as an SVG viewBox string. */
  viewBox: string;
  /** The same frame as numbers. */
  bounds: { x: number; y: number; w: number; h: number };
}

type Point = [number, number];

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// Deterministic PRNG (mulberry32) seeded from a string hash. Organic jitter must be
// stable across every re-render (pan/zoom re-renders this every frame) — never Math.random().
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseViewBox(viewBox: string): [number, number, number, number] {
  const parts = viewBox.trim().split(/\s+/).map(Number);
  if (parts.length === 4 && parts.every(n => !Number.isNaN(n))) {
    return [parts[0], parts[1], parts[2], parts[3]];
  }
  return [0, 0, 800, 600];
}

/** Chaikin corner-cutting: turns a jagged closed polyline into a softer, rounder curve. */
function chaikinSmooth(points: Point[], passes: number): Point[] {
  let pts = points;
  for (let p = 0; p < passes; p++) {
    const next: Point[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % n];
      next.push([x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.25]);
      next.push([x0 + (x1 - x0) * 0.75, y0 + (y1 - y0) * 0.75]);
    }
    pts = next;
  }
  return pts;
}

function pointsToSmoothPath(points: Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let d = `M ${first[0].toFixed(2)} ${first[1].toFixed(2)}`;
  for (const [x, y] of rest) d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  d += ' Z';
  return d;
}

/**
 * Subdivide each polygon edge with a couple of deterministically-jittered midpoints
 * so straight Voronoi cell edges read as organic, irregular borders rather than
 * crisp computational-geometry lines.
 *
 * The jitter is seeded by the edge itself, not by the cell, and always measured along the edge in
 * one canonical direction: the two territories either side of a border then bend it identically,
 * so neighbours meet along one wavy line instead of leaving slivers of sea between them.
 */
function jitterPolygon(points: Point[], amount: number): Point[] {
  const out: Point[] = [];
  const n = points.length;
  const steps = 2;
  for (let i = 0; i < n; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    out.push(p0);
    const flip = p0[0] > p1[0] || (p0[0] === p1[0] && p0[1] > p1[1]);
    const [a, b] = flip ? [p1, p0] : [p0, p1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // unit normal of the canonical direction
    const rng = mulberry32(hashSeed(`${a[0].toFixed(1)},${a[1].toFixed(1)}|${b[0].toFixed(1)},${b[1].toFixed(1)}`));
    // Short edges get proportionally less wobble, or they fold over themselves.
    const amp = Math.min(amount, len * 0.18);
    const mids: Point[] = [];
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      const jitter = (rng() - 0.5) * 2 * amp;
      mids.push([a[0] + dx * t + nx * jitter, a[1] + dy * t + ny * jitter]);
    }
    out.push(...(flip ? mids.reverse() : mids));
  }
  return out;
}

function polygonCentroidAndRadius(points: Point[]): { x: number; y: number; radius: number } {
  let cx = 0, cy = 0, area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  // Approximate "visual radius" from cell area — lets overlays (troop count, name,
  // badges) scale their offsets to each cell's actual size instead of a fixed constant,
  // since Voronoi cells vary a lot in area depending on local point density.
  const radius = Math.min(40, Math.max(14, Math.sqrt(Math.abs(area) / Math.PI)));
  if (Math.abs(area) < 1e-6) {
    const avg = points.reduce((acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }), { x: 0, y: 0 });
    return { x: avg.x / n, y: avg.y / n, radius: 18 };
  }
  return { x: cx / (6 * area), y: cy / (6 * area), radius };
}

/**
 * Sutherland-Hodgman: clip a convex polygon to a convex clip polygon (both counter- or both
 * clockwise does not matter here, as the inside test uses the clip polygon's own winding).
 */
function clipConvex(subject: Point[], clip: Point[]): Point[] {
  let out = subject;
  const sign = Math.sign(polygonArea(clip)) || 1;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i];
    const [bx, by] = clip[(i + 1) % clip.length];
    const inside = ([x, y]: Point) => sign * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) >= 0;
    const cross = ([px, py]: Point, [qx, qy]: Point): Point => {
      const a1 = by - ay, b1 = ax - bx, c1 = a1 * ax + b1 * ay;
      const a2 = qy - py, b2 = px - qx, c2 = a2 * px + b2 * py;
      const det = a1 * b2 - a2 * b1 || 1e-9;
      return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cross(prev, cur));
      }
    }
  }
  return out;
}

function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** A wobbly, roughly circular convex-ish blob around a site: the most land a territory can hold. */
function siteBlob(cx: number, cy: number, r: number, rng: () => number): Point[] {
  const sides = 28;
  const out: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2;
    // Small wobble only: a large one would make the blob concave and break the convex clip.
    const rr = r * (0.94 + rng() * 0.08);
    out.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]);
  }
  return out;
}

/**
 * Computes organic territory-region geometry from the engine's flat node/edge lists.
 * Pure and deterministic: same (nodes, edges) always produces the same shapes, so callers
 * should memoize this per map instance rather than recomputing every render.
 *
 * The land is not a rectangle. Each Voronoi cell is clipped to a blob round its own site, sized
 * from how far apart territories sit, so interior cells keep their shared borders while the ones
 * on the edge round off into headlands with sea bays between them: the board reads as a
 * continent with water wrapping round it. The returned viewBox frames that land, so the board
 * can be fitted to the land rather than to a rectangle drawn round it.
 */
export function computeMapGeometry(nodes: Territory[], edges: [number, number][], viewBox: string): MapGeometry {
  void edges; // gameplay adjacency is consumed by the caller for route-connector rendering, not here
  const [vx, vy, vw, vh] = parseViewBox(viewBox);

  const points: Point[] = nodes.map(n => [n.x, n.y]);
  const delaunay = Delaunay.from(points);

  // Typical spacing: the median distance from a territory to its nearest neighbour.
  const nearest = nodes.map((_, i) => {
    let best = Infinity;
    for (const j of delaunay.neighbors(i)) best = Math.min(best, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
    return Number.isFinite(best) ? best : 120;
  }).sort((a, b) => a - b);
  const spacing = nearest[Math.floor(nearest.length / 2)] ?? 120;
  // Big enough that interior cells are untouched, small enough that edge cells become headlands.
  const reach = spacing * 0.78;

  const minNX = Math.min(...points.map(p => p[0])), maxNX = Math.max(...points.map(p => p[0]));
  const minNY = Math.min(...points.map(p => p[1])), maxNY = Math.max(...points.map(p => p[1]));
  const outer = reach * 2;
  const voronoi = delaunay.voronoi([minNX - outer, minNY - outer, maxNX + outer, maxNY + outer]);

  const cellPaths = new Map<number, string>();
  const centroids = new Map<number, { x: number; y: number; radius: number }>();
  const geometricEdgeSet = new Set<string>();
  const allCellPoints: Point[] = [];

  nodes.forEach((n, i) => {
    const cell = voronoi.cellPolygon(i);
    if (!cell) {
      // Degenerate/duplicate point: fall back to a small square so rendering never breaks.
      const half = 20;
      cellPaths.set(n.id, `M ${n.x - half} ${n.y - half} L ${n.x + half} ${n.y - half} L ${n.x + half} ${n.y + half} L ${n.x - half} ${n.y + half} Z`);
      centroids.set(n.id, { x: n.x, y: n.y, radius: 18 });
      allCellPoints.push([n.x - half, n.y - half], [n.x + half, n.y + half]);
      return;
    }
    const raw = cell.slice(0, -1) as Point[]; // cellPolygon repeats the first point at the end
    const blob = siteBlob(n.x, n.y, reach, mulberry32(hashSeed(`blob-${n.id}`)));
    const clipped = clipConvex(raw, blob);
    const shape = clipped.length >= 3 ? clipped : raw;
    allCellPoints.push(...shape);
    const jittered = jitterPolygon(shape, 6);
    const smoothed = chaikinSmooth(jittered, 2);
    cellPaths.set(n.id, pointsToSmoothPath(smoothed));
    centroids.set(n.id, polygonCentroidAndRadius(shape));
  });

  for (let i = 0; i < nodes.length; i++) {
    for (const j of voronoi.neighbors(i)) {
      if (j > i) geometricEdgeSet.add(edgeKey(nodes[i].id, nodes[j].id));
    }
  }

  // Frame the land with a band of sea. Fall back to the map's declared viewBox if anything
  // degenerate leaves no points to measure.
  const pad = Math.max(24, spacing * 0.35);
  let frame: [number, number, number, number] = [vx, vy, vw, vh];
  if (allCellPoints.length) {
    const x0 = Math.min(...allCellPoints.map(p => p[0])) - pad;
    const x1 = Math.max(...allCellPoints.map(p => p[0])) + pad;
    const y0 = Math.min(...allCellPoints.map(p => p[1])) - pad;
    const y1 = Math.max(...allCellPoints.map(p => p[1])) + pad;
    frame = [x0, y0, x1 - x0, y1 - y0];
  }

  return {
    cellPaths, centroids, geometricEdgeSet,
    viewBox: frame.map(v => v.toFixed(1)).join(' '),
    bounds: { x: frame[0], y: frame[1], w: frame[2], h: frame[3] },
  };
}
