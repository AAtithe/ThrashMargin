import { Delaunay } from 'd3-delaunay';
import type { Territory } from 'shared/types';

export interface MapGeometry {
  /** Smoothed, organic SVG path per territory id — the region's fill/stroke shape. */
  cellPaths: Map<number, string>;
  /** Polygon centroid + approximate visual radius per territory id — anchor for overlays. */
  centroids: Map<number, { x: number; y: number; radius: number }>;
  /** Pairs of territory ids that are true Voronoi (geometric) neighbours, keyed "loId-hiId". */
  geometricEdgeSet: Set<string>;
  /** Smoothed landmass silhouette, used as a clip-path + coastline stroke. */
  coastlinePath: string;
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
 */
function jitterPolygon(points: Point[], rng: () => number, amount: number): Point[] {
  const out: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    out.push([x0, y0]);
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // unit normal, perpendicular to this edge
    const steps = 2;
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      const mx = x0 + dx * t, my = y0 + dy * t;
      const jitter = (rng() - 0.5) * 2 * amount;
      out.push([mx + nx * jitter, my + ny * jitter]);
    }
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
 * Computes organic territory-region geometry from the engine's flat node/edge lists.
 * Pure and deterministic — same (nodes, edges, viewBox) always produces the same shapes,
 * so callers should memoize this per map instance rather than recomputing every render.
 */
export function computeMapGeometry(nodes: Territory[], edges: [number, number][], viewBox: string): MapGeometry {
  void edges; // gameplay adjacency is consumed by the caller for route-connector rendering, not here
  const [vx, vy, vw, vh] = parseViewBox(viewBox);
  // Boundary territories get open-ended Voronoi cells that Voronoi.cellPolygon clips to
  // these bounds. They must match the SVG's own viewBox exactly (not a larger margin) or
  // those cells — and the labels anchored to their centroids — render past the visible
  // canvas and get cut off by the viewBox itself.
  const bounds: [number, number, number, number] = [vx, vy, vx + vw, vy + vh];

  const points: Point[] = nodes.map(n => [n.x, n.y]);
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi(bounds);

  const cellPaths = new Map<number, string>();
  const centroids = new Map<number, { x: number; y: number; radius: number }>();
  const geometricEdgeSet = new Set<string>();
  // Every cell's own vertices, collected so the coastline can hug the actual rendered
  // territory extent — a hull of just the node centres would sit well inside the cells
  // once boundary cells are bounded by the viewBox (see below), leaving a mismatched
  // coastline floating in the middle of the map instead of around its edge.
  const allCellPoints: Point[] = [];

  nodes.forEach((n, i) => {
    const cell = voronoi.cellPolygon(i);
    if (!cell) {
      // Degenerate/duplicate point — fall back to a small square so rendering never breaks.
      const half = 20;
      cellPaths.set(n.id, `M ${n.x - half} ${n.y - half} L ${n.x + half} ${n.y - half} L ${n.x + half} ${n.y + half} L ${n.x - half} ${n.y + half} Z`);
      centroids.set(n.id, { x: n.x, y: n.y, radius: 18 });
      allCellPoints.push([n.x - half, n.y - half], [n.x + half, n.y + half]);
      return;
    }
    const raw = cell.slice(0, -1) as Point[]; // cellPolygon repeats the first point at the end
    allCellPoints.push(...raw);
    const rng = mulberry32(hashSeed(String(n.id)));
    const jittered = jitterPolygon(raw, rng, 6);
    const smoothed = chaikinSmooth(jittered, 2);
    cellPaths.set(n.id, pointsToSmoothPath(smoothed));

    // Boundary territories can get large, lopsided open-ended cells whose true geometric
    // centroid sits very close to (or past) the viewBox edge — fine for the fill, but it
    // would clip the name/troop-count text anchored there. Keep the overlay anchor a safe
    // distance inside the frame regardless of how skewed the underlying cell is.
    const labelMargin = 28;
    const centroid = polygonCentroidAndRadius(raw);
    centroids.set(n.id, {
      ...centroid,
      x: Math.min(vx + vw - labelMargin, Math.max(vx + labelMargin, centroid.x)),
      y: Math.min(vy + vh - labelMargin, Math.max(vy + labelMargin, centroid.y)),
    });
  });

  for (let i = 0; i < nodes.length; i++) {
    for (const j of voronoi.neighbors(i)) {
      if (j > i) geometricEdgeSet.add(edgeKey(nodes[i].id, nodes[j].id));
    }
  }

  // The coastline just needs to loosely enclose every cell — a true convex hull over every
  // cell vertex is fragile here (many vertices sit exactly on the viewBox edge once boundary
  // cells are bounded to it, and that many collinear points made a hull-based shape prone to
  // self-crossing once smoothed). A padded bounding box, jittered and Chaikin-smoothed the
  // same way as the territory cells, gives a robust, always-simple, still-organic silhouette.
  const pad = 20;
  const minX = Math.min(...allCellPoints.map(p => p[0])) - pad;
  const maxX = Math.max(...allCellPoints.map(p => p[0])) + pad;
  const minY = Math.min(...allCellPoints.map(p => p[1])) - pad;
  const maxY = Math.max(...allCellPoints.map(p => p[1])) + pad;
  const margin = 4;
  const clampX = (x: number) => Math.min(vx + vw - margin, Math.max(vx + margin, x));
  const clampY = (y: number) => Math.min(vy + vh - margin, Math.max(vy + margin, y));
  const box: Point[] = [
    [clampX(minX), clampY(minY)], [clampX(maxX), clampY(minY)],
    [clampX(maxX), clampY(maxY)], [clampX(minX), clampY(maxY)],
  ];
  const coastRng = mulberry32(hashSeed('coastline'));
  const jitteredBox = jitterPolygon(box, coastRng, 16);
  const smoothedHull = chaikinSmooth(jitteredBox, 3);
  const coastlinePath = pointsToSmoothPath(smoothedHull);

  return { cellPaths, centroids, geometricEdgeSet, coastlinePath };
}
