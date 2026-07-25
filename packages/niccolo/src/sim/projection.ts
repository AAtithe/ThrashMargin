/**
 * Donis trapezoidal projection (Ptolemaic, Nicolaus Germanus c.1460), ported from the standalone
 * map/niccolo-map project's src/projection.js. Pure static-geometry math only — no color, no DOM,
 * no React. Called once at module load by sim/geography.ts; nothing here runs per-render or
 * depends on component state or props.
 *
 * Parallels are straight horizontal lines at even spacing. Meridians are straight lines that
 * converge toward the pole, with the east-west scale at a given parallel proportional to a
 * convergence factor. Pure cosine convergence (convergence = 1) is geometrically correct for a
 * sphere but fans the sheet out very hard at low latitudes; real Ptolemaic sheets moderate it —
 * 0.55 matches the look of the printed Ulm and Rome editions.
 */
const DEG = Math.PI / 180;

export interface GeoDomain {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ProjectorOptions {
  width?: number;
  domain?: GeoDomain;
  refLat?: number;
  convergence?: number;
  latStretch?: number;
  margin?: Margin;
}

export interface Projector {
  width: number;
  height: number;
  plot: { x: number; y: number; w: number; h: number };
  degPerPx: number;
  project(lon: number, lat: number): [number, number];
  unproject(x: number, y: number): [number, number];
  neatline(): [number, number][];
  graticule(lonStep?: number, latStep?: number): {
    meridians: [number, number][][];
    parallels: [number, number][][];
  };
  scale(v: number): number;
}

const DEFAULTS = {
  domain: { lonMin: 0, lonMax: 95, latMin: 4, latMax: 66 } as GeoDomain,
  /** Parallel at which the horizontal scale is unmodified. Ptolemy uses Rhodes. */
  refLat: 36,
  /** 0 = rectangular grid, 1 = full cosine convergence. */
  convergence: 0.55,
  /** Vertical exaggeration. Above 1 gives northern Europe more room. */
  latStretch: 1.15,
  margin: { top: 120, right: 120, bottom: 220, left: 120 } as Margin,
};

function convergenceFactor(lat: number, o: { refLat: number; convergence: number }): number {
  const c = o.convergence;
  return (1 - c) + c * (Math.cos(lat * DEG) / Math.cos(o.refLat * DEG));
}

export function createProjector(opts: ProjectorOptions = {}): Projector {
  const o = {
    refLat: opts.refLat ?? DEFAULTS.refLat,
    convergence: opts.convergence ?? DEFAULTS.convergence,
    latStretch: opts.latStretch ?? DEFAULTS.latStretch,
    domain: { ...DEFAULTS.domain, ...(opts.domain ?? {}) },
    margin: opts.margin ?? DEFAULTS.margin,
  };

  const width = opts.width ?? 1400;
  if (!opts.margin) {
    const mk = width / 1400;
    o.margin = {
      top: DEFAULTS.margin.top * mk,
      right: DEFAULTS.margin.right * mk,
      bottom: DEFAULTS.margin.bottom * mk,
      left: DEFAULTS.margin.left * mk,
    };
  }

  const { lonMin, lonMax, latMin, latMax } = o.domain;
  const lonRange = lonMax - lonMin;
  const latRange = latMax - latMin;
  const lon0 = (lonMin + lonMax) / 2;

  const plotW = width - o.margin.left - o.margin.right;

  // The widest parallel is whichever end of the domain has the larger factor.
  const widest = Math.max(convergenceFactor(latMin, o), convergenceFactor(latMax, o));
  const kLon = plotW / (lonRange * widest);
  const kLat = kLon * o.latStretch;

  const plotH = latRange * kLat;
  const height = plotH + o.margin.top + o.margin.bottom;
  const cx = o.margin.left + plotW / 2;

  const degPerPx = kLon;

  function project(lon: number, lat: number): [number, number] {
    const f = convergenceFactor(lat, o);
    return [cx + (lon - lon0) * kLon * f, o.margin.top + (latMax - lat) * kLat];
  }

  function unproject(x: number, y: number): [number, number] {
    const lat = latMax - (y - o.margin.top) / kLat;
    const f = convergenceFactor(lat, o);
    return [lon0 + (x - cx) / (kLon * f), lat];
  }

  /** The sheet border is a trapezoid, not a rectangle. That is the point. */
  function neatline(): [number, number][] {
    return [project(lonMin, latMax), project(lonMax, latMax), project(lonMax, latMin), project(lonMin, latMin)];
  }

  function graticule(lonStep = 10, latStep = 10) {
    const meridians: [number, number][][] = [];
    for (let lon = Math.ceil(lonMin / lonStep) * lonStep; lon <= lonMax; lon += lonStep) {
      meridians.push([project(lon, latMin), project(lon, latMax)]);
    }
    const parallels: [number, number][][] = [];
    for (let lat = Math.ceil(latMin / latStep) * latStep; lat <= latMax; lat += latStep) {
      parallels.push([project(lonMin, lat), project(lonMax, lat)]);
    }
    return { meridians, parallels };
  }

  /** Scale a design value authored against a 1400px canvas up or down. */
  const scale = (v: number) => (v * width) / 1400;

  return {
    width,
    height,
    plot: { x: o.margin.left, y: o.margin.top, w: plotW, h: plotH },
    degPerPx,
    project,
    unproject,
    neatline,
    graticule,
    scale,
  };
}

/** Project a ring of [lon,lat] into an SVG path string. */
export function ringToPath(ring: [number, number][], project: Projector['project'], close = true): string {
  if (!ring.length) return '';
  const pts = ring.map(([lo, la]) => project(lo, la));
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  return close ? d + ' Z' : d;
}

/** Catmull-Rom to cubic Bezier, for routes and rivers that should not look ruled. */
export function smoothPath(points: [number, number][], tension = 0.5): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)} L ${points[1][0].toFixed(2)} ${points[1][1].toFixed(2)}`;
  }
  const p = [points[0], ...points, points[points.length - 1]];
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    const [x3, y3] = p[i + 2];
    const c1x = x1 + ((x2 - x0) / 6) * tension * 2;
    const c1y = y1 + ((y2 - y0) / 6) * tension * 2;
    const c2x = x2 - ((x3 - x1) / 6) * tension * 2;
    const c2y = y2 - ((y3 - y1) / 6) * tension * 2;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return d;
}

/** Catmull-Rom to cubic Bezier for a CLOSED ring (coastlines, seas, islands) — unlike `smoothPath`,
 * which pads its open ends by duplicating the first/last point, this wraps neighbour lookups
 * cyclically so the curve flows continuously through the seam back to the start with no visible
 * kink, and closes with `Z`. Coastlines were previously drawn as straight `L` segments via
 * `ringToPath` (correct for the graticule/neatline, which really are straight lines, but wrong for a
 * coastline, which reads as a crude, low-poly outline when every vertex is a sharp corner). */
export function smoothRingPath(ring: [number, number][], project: Projector['project'], tension = 0.5): string {
  if (ring.length < 3) return ringToPath(ring, project);
  const pts = ring.map(([lo, la]) => project(lo, la));
  const n = pts.length;
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[(i - 1 + n) % n];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const [x3, y3] = pts[(i + 2) % n];
    const c1x = x1 + ((x2 - x0) / 6) * tension * 2;
    const c1y = y1 + ((y2 - y0) / 6) * tension * 2;
    const c2x = x2 - ((x3 - x1) / 6) * tension * 2;
    const c2y = y2 - ((y3 - y1) / 6) * tension * 2;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return d + ' Z';
}

/** Caterpillar mountain-hump path, ported from renderMap.js's reliefPath(). Pure geometry. */
export function reliefPath(pts: [number, number][], hump: number): string {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(2, Math.round(len / (hump * 2)));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      d += ` M ${px.toFixed(2)} ${py.toFixed(2)} q ${(hump * 0.5).toFixed(2)} ${(-hump * 1.5).toFixed(2)} ${hump.toFixed(2)} 0`;
    }
  }
  return d.trim();
}
