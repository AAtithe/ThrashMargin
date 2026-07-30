/**
 * Donis trapezoidal projection, as used in the 1460s Ptolemy manuscripts
 * of Nicolaus Germanus.
 *
 * Parallels are straight horizontal lines at even spacing.
 * Meridians are straight lines that converge toward the pole, with the
 * east-west scale at a given parallel proportional to a convergence factor.
 *
 * Pure cosine convergence (convergence = 1) is geometrically correct for a
 * sphere but fans the sheet out very hard at low latitudes. Real Ptolemaic
 * sheets moderate it. The `convergence` option blends between rectangular
 * (0) and full cosine (1). 0.55 matches the look of the printed Ulm and Rome
 * editions reasonably well.
 *
 * Everything is derived from the domain and the canvas size, so the same data
 * renders identically at 680px or 8000px.
 */

const DEG = Math.PI / 180;

export const DEFAULTS = {
  domain: { lonMin: 0, lonMax: 95, latMin: 4, latMax: 66 },
  /** Parallel at which the horizontal scale is unmodified. Ptolemy uses Rhodes. */
  refLat: 36,
  /** 0 = rectangular grid, 1 = full cosine convergence. */
  convergence: 0.55,
  /** Vertical exaggeration. 1 = one degree of latitude equals one degree of
   *  longitude at the reference parallel. Above 1 gives northern Europe more room. */
  latStretch: 1.15,
  /** Outer padding, authored against a 1400px canvas and scaled with width
   *  so the sheet keeps its proportions at any size. Pass an explicit margin
   *  object to override. */
  margin: { top: 120, right: 120, bottom: 220, left: 120 }
};

/**
 * @param {number} lat
 * @param {{refLat:number, convergence:number}} o
 * @returns {number} horizontal scale factor at this parallel
 */
export function convergenceFactor(lat, o) {
  const c = o.convergence;
  return (1 - c) + c * (Math.cos(lat * DEG) / Math.cos(o.refLat * DEG));
}

/**
 * Build a projector for a given canvas width.
 *
 * @param {object} [opts]
 * @param {number} [opts.width]        target canvas width in pixels
 * @param {object} [opts.domain]
 * @param {number} [opts.refLat]
 * @param {number} [opts.convergence]
 * @param {number} [opts.latStretch]
 * @param {object} [opts.margin]
 * @returns {{
 *   width:number, height:number, plot:{x:number,y:number,w:number,h:number},
 *   opts:object, degPerPx:number,
 *   project:(lon:number, lat:number)=>[number,number],
 *   unproject:(x:number, y:number)=>[number,number],
 *   neatline:()=>[number,number][],
 *   graticule:(lonStep:number, latStep:number)=>{meridians:[number,number][][], parallels:[number,number][][]},
 *   scale:(v:number)=>number
 * }}
 */
export function createProjector(opts = {}) {
  const o = {
    ...DEFAULTS,
    ...opts,
    domain: { ...DEFAULTS.domain, ...(opts.domain || {}) },
    margin: { ...DEFAULTS.margin, ...(opts.margin || {}) }
  };

  const width = opts.width || 1400;
  const mk = width / 1400;
  if (!opts.margin) {
    o.margin = {
      top: DEFAULTS.margin.top * mk,
      right: DEFAULTS.margin.right * mk,
      bottom: DEFAULTS.margin.bottom * mk,
      left: DEFAULTS.margin.left * mk
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

  /** reference pixels per degree, used to scale line widths and type */
  const degPerPx = kLon;

  function project(lon, lat) {
    const f = convergenceFactor(lat, o);
    const x = cx + (lon - lon0) * kLon * f;
    const y = o.margin.top + (latMax - lat) * kLat;
    return [x, y];
  }

  function unproject(x, y) {
    const lat = latMax - (y - o.margin.top) / kLat;
    const f = convergenceFactor(lat, o);
    const lon = lon0 + (x - cx) / (kLon * f);
    return [lon, lat];
  }

  /** The sheet border is a trapezoid, not a rectangle. That is the point. */
  function neatline() {
    return [
      project(lonMin, latMax),
      project(lonMax, latMax),
      project(lonMax, latMin),
      project(lonMin, latMin)
    ];
  }

  function graticule(lonStep = 10, latStep = 10) {
    const meridians = [];
    for (let lon = Math.ceil(lonMin / lonStep) * lonStep; lon <= lonMax; lon += lonStep) {
      meridians.push([project(lon, latMin), project(lon, latMax)]);
    }
    const parallels = [];
    for (let lat = Math.ceil(latMin / latStep) * latStep; lat <= latMax; lat += latStep) {
      parallels.push([project(lonMin, lat), project(lonMax, lat)]);
    }
    return { meridians, parallels };
  }

  /** Scale a design value authored against a 1400px canvas up or down. */
  const scale = (v) => (v * width) / 1400;

  return {
    width,
    height,
    plot: { x: o.margin.left, y: o.margin.top, w: plotW, h: plotH },
    opts: o,
    degPerPx,
    project,
    unproject,
    neatline,
    graticule,
    scale
  };
}

/** Project a ring of [lon,lat] into an SVG path string. */
export function ringToPath(ring, project, close = true) {
  if (!ring.length) return '';
  const pts = ring.map(([lo, la]) => project(lo, la));
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  return close ? d + ' Z' : d;
}

/** Catmull-Rom to cubic Bezier, for routes and rivers that should not look ruled. */
export function smoothPath(points, tension = 0.5) {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)} L ${points[1][0].toFixed(2)} ${points[1][1].toFixed(2)}`;
  }
  const p = [points[0], ...points, points[points.length - 1]];
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[i + 2];
    const c1x = x1 + ((x2 - x0) / 6) * tension * 2;
    const c1y = y1 + ((y2 - y0) / 6) * tension * 2;
    const c2x = x2 - ((x3 - x1) / 6) * tension * 2;
    const c2y = y2 - ((y3 - y1) / 6) * tension * 2;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return d;
}
