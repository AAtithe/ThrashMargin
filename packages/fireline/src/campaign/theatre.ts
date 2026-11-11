import { MISSIONS } from './missions';

/**
 * The campaign's theatre: one fictional country, divided into provinces and city regions, that the
 * Meridian Corps takes from the Ashen Combine region by region. Story missions are fought in some
 * regions; every other region holds a side battle (an engagement) the player may fight from the
 * map once it borders held ground. Pure data and pure functions: no DOM, no clock, no Math.random.
 *
 * Map space is (fx, fy) in 0..1: west at fx 0, east at fx 1, north at fy 0, south at fy 1. The art
 * (game/campaignArt.ts) draws the polygons below; the rules (campaign/territory.ts) read only ids,
 * acts, neighbours and mission ids. Region ids are saved: never rename one.
 *
 * CONTRACT between the geometry and the rules. The geometry owner fills in theatreRegions(); the
 * rules owner codes against the types only.
 */

export type RegionKind = 'province' | 'city';

export interface TheatreRegion {
  /** Stable and saved in CampaignState.engagements. Never rename. */
  id: string;
  /** Fictional place name, shown on the map and in the engagement briefing. */
  name: string;
  /** The act whose front this region belongs to: 0 the south, 1 the north. */
  act: 0 | 1;
  kind: RegionKind;
  /** Where the region's marker (objective or engagement) sits, in map space. */
  site: [number, number];
  /** Closed outline in map space, land only. Shared borders are identical point for point on both sides. */
  polygon: [number, number][];
  /** Ids of the regions sharing a border with this one. Symmetric. */
  neighbours: string[];
  /** The story mission fought here, if any. Every mission has exactly one region. */
  missionId?: string;
  /** Held by the Meridian Corps when the campaign begins. */
  home?: boolean;
}

/** Who holds a region now, as the map shows it. `open` is enemy ground with a battle the player can fight now. */
export type RegionControl = 'held' | 'enemy' | 'open';

/** Everything the map needs to draw one campaign's theatre. Built by territory.ts from a CampaignState. */
export interface TheatreView {
  /** The act whose front the map focuses on. */
  act: 0 | 1;
  control: Record<string, RegionControl>;
  missions: {
    id: string;
    order: number;
    title: string;
    regionId: string;
    state: 'locked' | 'open' | 'won';
    stars: number;
    maxStars: number;
  }[];
  /** One per region without a mission. `locked`: not yet reachable. */
  engagements: { regionId: string; state: 'locked' | 'open' | 'won'; stars: number }[];
  /** The region whose briefing is open. */
  selected?: string;
}

// ---- The country ---------------------------------------------------------------------------------
//
// One broad landmass, shaped and divided the way a great continental country is: high plateau and
// mountain in the west (the Grey Fells), two great rivers rising there and running east to deltas,
// a long east coast with a gulf in the north (the Northern Sound) between two peninsulas, a south
// coast with a bay (the Gulf of Varne), a southern peninsula and islands offshore. The north and
// west are land frontiers with foreign country beyond.
//
// The provinces are drawn the way borders grow, not the way a board is ruled: every point of the
// country goes to its nearest seed, after the point has been pushed about by smooth noise (so the
// borders wander), with the city seeds weighted heavy (so a city's ground is a small, dense patch
// round its harbour or crossing). That is done on a fine grid; the grid's region outlines are then
// cut into chains (one chain per stretch of border between the same two neighbours), and each
// chain is simplified and smoothed once, so the two regions either side of a border share it point
// for point and nothing is left between them.

/** Map space is square 0..1 both ways, but the country is wider than it is tall: one unit of fx is this many units of fy on the ground. */
export const THEATRE_ASPECT = 1.32;

type Pt = [number, number];

interface Seed {
  id: string;
  name: string;
  act: 0 | 1;
  kind: RegionKind;
  at: Pt;
  /** Pull: above 1 shrinks the region round its seed (cities), below 1 lets it spread (the empty west). */
  weight?: number;
  missionId?: string;
  home?: boolean;
}

// Act 0, the Southern Coast: Meridian ground in the south-west, the advance east along the coast to
// the Ashen Reach. Act 1, the Northern Front: the landing on the Northern Sound, then inland to the
// fords of the Vell, and the Kessel highlands to the fortress on the north-east cliffs.
const SEEDS: Seed[] = [
  { id: 'aldermere', name: 'Aldermere', act: 0, kind: 'province', at: [0.115, 0.63], weight: 0.82, home: true },
  { id: 'penhallow', name: 'Penhallow', act: 0, kind: 'province', at: [0.2, 0.775], home: true },
  { id: 'high-fells', name: 'The High Fells', act: 0, kind: 'province', at: [0.15, 0.47], weight: 0.82 },
  { id: 'tarrowmere', name: 'Tarrowmere', act: 0, kind: 'province', at: [0.29, 0.5] },
  { id: 'varn-valley', name: 'Varn Valley', act: 0, kind: 'province', at: [0.285, 0.715], missionId: 'first-light' },
  { id: 'ashby-downs', name: 'Ashby Downs', act: 0, kind: 'province', at: [0.37, 0.6], missionId: 'quiet-man' },
  { id: 'halden', name: 'Halden', act: 0, kind: 'city', at: [0.385, 0.8], weight: 1.55, missionId: 'hold-the-ford' },
  { id: 'ferris-cut', name: 'Ferris Cut', act: 0, kind: 'province', at: [0.445, 0.68], missionId: 'demolition' },
  { id: 'lisle-vale', name: 'Lisle Vale', act: 0, kind: 'province', at: [0.5, 0.765] },
  { id: 'carrow-point', name: 'Carrow Point', act: 0, kind: 'province', at: [0.45, 0.9] },
  { id: 'orlen-yard', name: 'Orlen Yard', act: 0, kind: 'city', at: [0.534, 0.848], weight: 1.8, missionId: 'borrowed-steel' },
  { id: 'varne', name: 'Varne', act: 0, kind: 'city', at: [0.566, 0.812], weight: 2 },
  { id: 'port-ennis', name: 'Port Ennis', act: 0, kind: 'city', at: [0.603, 0.846], weight: 1.85 },
  { id: 'hesketh', name: 'Hesketh', act: 0, kind: 'city', at: [0.478, 0.578], weight: 1.7 },
  { id: 'brackwater', name: 'Brackwater', act: 0, kind: 'province', at: [0.575, 0.6] },
  { id: 'spade-ridge', name: 'Spade Ridge', act: 0, kind: 'province', at: [0.6, 0.715], missionId: 'ace-of-spades' },
  { id: 'cinder-flats', name: 'Cinder Flats', act: 0, kind: 'province', at: [0.68, 0.775], missionId: 'blackout' },
  { id: 'ashen-reach', name: 'The Ashen Reach', act: 0, kind: 'province', at: [0.765, 0.69], missionId: 'fireline' },
  { id: 'orrin', name: 'Orrin', act: 0, kind: 'city', at: [0.778, 0.775], weight: 2 },
  { id: 'the-sedge', name: 'The Sedge', act: 0, kind: 'province', at: [0.69, 0.615] },
  { id: 'callowby', name: 'Callowby', act: 0, kind: 'city', at: [0.83, 0.575], weight: 1.9 },

  { id: 'sallow-waste', name: 'The Sallow Waste', act: 1, kind: 'province', at: [0.15, 0.275], weight: 0.72 },
  { id: 'brennhead', name: 'Brennhead', act: 1, kind: 'province', at: [0.285, 0.385] },
  { id: 'thornbury', name: 'Thornbury', act: 1, kind: 'province', at: [0.365, 0.305] },
  { id: 'kellholm', name: 'Kellholm', act: 1, kind: 'city', at: [0.468, 0.285], weight: 1.6 },
  { id: 'tarn-end', name: 'Tarn End', act: 1, kind: 'province', at: [0.585, 0.205] },
  { id: 'dunmere', name: 'Dunmere', act: 1, kind: 'province', at: [0.43, 0.43] },
  { id: 'morrow-plain', name: 'Morrow Plain', act: 1, kind: 'province', at: [0.56, 0.47] },
  { id: 'graystone-ford', name: 'Graystone Ford', act: 1, kind: 'province', at: [0.6, 0.3], missionId: 'the-long-hold' },
  { id: 'vell-crossing', name: 'Vell Crossing', act: 1, kind: 'province', at: [0.655, 0.405], missionId: 'convoy-north' },
  { id: 'brannock', name: 'Brannock', act: 1, kind: 'city', at: [0.682, 0.322], weight: 2 },
  { id: 'wexley', name: 'Wexley', act: 1, kind: 'province', at: [0.73, 0.5] },
  { id: 'harrow-sound', name: 'Harrow Sound', act: 1, kind: 'province', at: [0.83, 0.405], missionId: 'iron-coast' },
  { id: 'cinder-tor', name: 'Cinder Tor', act: 1, kind: 'province', at: [0.68, 0.17], missionId: 'firestorm' },
  { id: 'halsey', name: 'Halsey', act: 1, kind: 'city', at: [0.775, 0.268], weight: 2 },
  { id: 'kessel', name: 'The Kessel', act: 1, kind: 'province', at: [0.79, 0.12], missionId: 'bastion-line' },
  { id: 'dunlow', name: 'Dunlow', act: 1, kind: 'province', at: [0.885, 0.17] },
  { id: 'last-light', name: 'Last Light', act: 1, kind: 'city', at: [0.912, 0.238], weight: 1.9, missionId: 'last-light' },
];

// The coast, from off the sheet in the north-east round to off the sheet in the south-west. Land
// lies to the north and west of it.
const COAST_CONTROL: Pt[] = [
  [1.6, 0.2], [1.1, 0.2], [0.99, 0.205], [0.955, 0.235], [0.93, 0.262],
  // The northern arm of the Sound, pointing south-west.
  [0.895, 0.278], [0.862, 0.302], [0.832, 0.312], [0.8, 0.298],
  // The Northern Sound.
  [0.772, 0.282], [0.738, 0.276], [0.708, 0.29], [0.686, 0.31], [0.676, 0.338], [0.688, 0.365], [0.716, 0.378],
  [0.752, 0.374], [0.79, 0.366], [0.83, 0.364],
  // Harrow's peninsula, pointing east.
  [0.865, 0.37], [0.888, 0.384], [0.892, 0.402], [0.872, 0.418], [0.84, 0.43], [0.81, 0.445],
  // The east coast and the Callow's delta.
  [0.796, 0.47], [0.802, 0.505], [0.822, 0.535], [0.846, 0.56], [0.856, 0.582], [0.846, 0.605], [0.851, 0.632],
  [0.848, 0.668], [0.83, 0.706], [0.806, 0.744], [0.778, 0.776], [0.745, 0.8],
  // The south coast and the Gulf of Varne.
  [0.705, 0.82], [0.66, 0.832], [0.632, 0.85], [0.612, 0.874], [0.592, 0.864], [0.578, 0.842], [0.565, 0.826],
  [0.55, 0.836], [0.536, 0.856], [0.515, 0.87], [0.492, 0.872], [0.476, 0.88],
  // Carrow Point.
  [0.47, 0.905], [0.464, 0.936], [0.452, 0.952], [0.44, 0.936], [0.435, 0.9], [0.415, 0.884], [0.39, 0.885],
  [0.37, 0.895], [0.352, 0.912], [0.338, 0.945], [0.332, 1.0], [0.33, 1.1], [0.33, 1.6],
];

// The frontier: the country is inside it. Where it runs out to sea, the coast is the edge.
const FRONTIER_CONTROL: Pt[] = [
  [0.028, 0.37], [0.045, 0.28], [0.085, 0.2], [0.14, 0.15], [0.2, 0.135], [0.255, 0.165], [0.3, 0.205], [0.36, 0.228],
  [0.42, 0.238], [0.48, 0.228], [0.525, 0.205], [0.565, 0.165], [0.605, 0.118], [0.65, 0.078], [0.7, 0.045], [0.75, 0.025],
  [0.8, 0.02], [0.845, 0.04], [0.885, 0.08], [0.925, 0.125], [0.96, 0.168], [0.99, 0.2], [1.1, 0.21], [1.2, 0.6],
  [1.1, 1.2], [0.36, 1.2], [0.348, 0.93], [0.325, 0.955], [0.29, 0.962], [0.262, 0.935], [0.235, 0.89], [0.19, 0.845],
  [0.14, 0.8], [0.095, 0.745], [0.06, 0.68], [0.038, 0.6], [0.035, 0.5], [0.025, 0.43],
];

const ISLAND_CONTROL: { name: string; at: Pt; rx: number; ry: number; rot: number }[] = [
  { name: 'Skerra', at: [0.905, 0.722], rx: 0.016, ry: 0.052, rot: 0.25 },
  { name: 'Haddon Isle', at: [0.478, 0.982], rx: 0.03, ry: 0.022, rot: -0.2 },
  { name: '', at: [0.928, 0.648], rx: 0.006, ry: 0.009, rot: 0.4 },
  { name: '', at: [0.9, 0.44], rx: 0.007, ry: 0.006, rot: 0 },
  { name: '', at: [0.632, 0.885], rx: 0.006, ry: 0.004, rot: 0.6 },
  { name: '', at: [0.86, 0.33], rx: 0.006, ry: 0.004, rot: 0.2 },
  { name: '', at: [0.825, 0.81], rx: 0.007, ry: 0.005, rot: 0.9 },
];

// Rivers rise in the west and run east to the sea. Control points from source to mouth.
const RIVER_CONTROL: { name: string; seed: number; pts: Pt[]; label: number }[] = [
  {
    name: 'R. Brenn',
    seed: 3,
    pts: [[0.205, 0.44], [0.27, 0.41], [0.33, 0.36], [0.38, 0.3], [0.44, 0.27], [0.49, 0.28], [0.51, 0.34], [0.55, 0.375], [0.6, 0.37], [0.645, 0.345], [0.69, 0.33]],
    label: 0.22,
  },
  {
    name: 'R. Callow',
    seed: 5,
    pts: [[0.16, 0.56], [0.24, 0.585], [0.31, 0.565], [0.38, 0.555], [0.44, 0.575], [0.5, 0.585], [0.56, 0.555], [0.62, 0.56], [0.68, 0.575], [0.74, 0.56], [0.8, 0.566], [0.86, 0.575]],
    label: 0.3,
  },
  {
    name: 'R. Wend',
    seed: 7,
    pts: [[0.25, 0.66], [0.31, 0.74], [0.36, 0.785], [0.41, 0.8], [0.46, 0.81], [0.51, 0.82], [0.545, 0.83], [0.565, 0.835]],
    label: 0.42,
  },
  {
    name: 'R. Vell',
    seed: 9,
    pts: [[0.64, 0.1], [0.625, 0.16], [0.605, 0.22], [0.592, 0.28], [0.585, 0.33], [0.578, 0.372]],
    label: 0.35,
  },
  {
    name: 'R. Lisle',
    seed: 11,
    pts: [[0.43, 0.76], [0.455, 0.7], [0.47, 0.64], [0.48, 0.585]],
    label: 0.4,
  },
];

// ---- Noise ---------------------------------------------------------------------------------------

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Two octaves, centred on 0, roughly -1..1. */
function fbm(x: number, y: number, seed: number): number {
  return (vnoise(x, y, seed) - 0.5) * 1.4 + (vnoise(x * 2.3, y * 2.3, seed + 17) - 0.5) * 0.6;
}

/** A polyline through control points, cut into short steps and pushed sideways by noise. */
function wander(ctrl: Pt[], step: number, amp: number, freq: number, seed: number, closed = false): Pt[] {
  const out: Pt[] = [];
  const pts = closed ? [...ctrl, ctrl[0]] : ctrl;
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = (x1 - x0) * THEATRE_ASPECT;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / step));
    // Far off the sheet nothing shows: keep those legs straight.
    const off = Math.max(Math.abs(x0 - 0.5), Math.abs(y0 - 0.5), Math.abs(x1 - 0.5), Math.abs(y1 - 0.5)) > 0.62;
    for (let k = 0; k < n; k++) {
      const q = k / n;
      const s = run + len * q;
      // Fades to nothing at each control point so the shape keeps its corners where they were put.
      const taper = closed ? 1 : Math.min(1, Math.sin(Math.PI * q) * 1.6);
      const d = off ? 0 : (amp * taper * fbm(s * freq, 0.5, seed));
      const nx = -dy / len;
      const ny = dx / len;
      out.push([x0 + (x1 - x0) * q + (nx * d) / THEATRE_ASPECT, y0 + (y1 - y0) * q + ny * d]);
    }
    run += len;
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

// ---- Geometry helpers ------------------------------------------------------------------------------

/** Even-odd point in polygon, map space. */
export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** For one row of the grid, which cells' centres fall inside the polygon. */
function scanRow(poly: Pt[], y: number, nx: number, out: Uint8Array, rowStart: number, value: number) {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  xs.sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const a = Math.max(0, Math.ceil(xs[k] * nx - 0.5));
    const b = Math.min(nx - 1, Math.floor(xs[k + 1] * nx - 0.5));
    for (let i = a; i <= b; i++) out[rowStart + i] = value;
  }
}

/** Douglas-Peucker in ground units, keeping both ends. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a][0] * THEATRE_ASPECT;
    const ay = pts[a][1];
    const bx = pts[b][0] * THEATRE_ASPECT;
    const by = pts[b][1];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * THEATRE_ASPECT;
      const py = pts[i][1];
      const d = len < 1e-8 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > eps && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Corner cutting, ends held. */
function chaikin(pts: Pt[], rounds: number): Pt[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    if (p.length < 3) return p;
    const out: Pt[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[i + 1];
      if (i > 0) out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
      if (i < p.length - 2) out.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

// ---- Building the country ------------------------------------------------------------------------

/** A stretch of border between two neighbours (or a region and the sea, or the frontier), right and left as walked. */
export interface TheatreChain {
  /** Region id on the right of the walk (screen y down), or 'sea' / 'abroad'. */
  right: string;
  left: string;
  points: Pt[];
}

/** Everything the map draws besides the regions themselves. */
export interface TheatreGeography {
  /** The mainland's coast as one closed outline (it runs off the sheet to the north and west). */
  land: Pt[];
  islands: { name: string; polygon: Pt[]; at: Pt }[];
  rivers: { name: string; points: Pt[]; label: number }[];
  /** Every border, each once. Province borders have two region ids; the coast has 'sea', the frontier 'abroad'. */
  chains: TheatreChain[];
}

const NY = 300;
const NX = Math.round(NY * THEATRE_ASPECT);
const SEA = -1;
const ABROAD = -2;

let geo: TheatreGeography | null = null;

function build(): { regions: TheatreRegion[]; geography: TheatreGeography } {
  const land = wander(COAST_CONTROL, 0.006, 0.009, 34, 101);
  const landPoly: Pt[] = [[-0.6, -0.6], [1.6, -0.6], ...land, [-0.6, 1.6]];
  const frontier = wander(FRONTIER_CONTROL, 0.006, 0.012, 26, 202, true);

  // 1. Every cell of the grid: sea, abroad, or the nearest (warped, weighted) seed.
  const N = NX * NY;
  const onLand = new Uint8Array(N);
  const inside = new Uint8Array(N);
  for (let j = 0; j < NY; j++) {
    const y = (j + 0.5) / NY;
    scanRow(landPoly, y, NX, onLand, j * NX, 1);
    scanRow(frontier, y, NX, inside, j * NX, 1);
  }
  const lab = new Int16Array(N);
  const S = SEEDS.length;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const c = j * NX + i;
      if (!onLand[c]) {
        lab[c] = SEA;
        continue;
      }
      if (!inside[c]) {
        lab[c] = ABROAD;
        continue;
      }
      const fx = (i + 0.5) / NX;
      const fy = (j + 0.5) / NY;
      const gx = fx * THEATRE_ASPECT;
      const wx = gx + 0.05 * fbm(gx * 6, fy * 6, 31) + 0.018 * fbm(gx * 17, fy * 17, 37) + 0.007 * fbm(gx * 45, fy * 45, 39);
      const wy = fy + 0.05 * fbm(gx * 6, fy * 6, 41) + 0.018 * fbm(gx * 17, fy * 17, 43) + 0.007 * fbm(gx * 45, fy * 45, 47);
      let best = 0;
      let bestD = Infinity;
      for (let s = 0; s < S; s++) {
        const sd = SEEDS[s];
        const d = Math.hypot(wx - sd.at[0] * THEATRE_ASPECT, wy - sd.at[1]) * (sd.weight ?? 1);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      lab[c] = best;
    }
  }

  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= NX || j >= NY ? SEA : lab[j * NX + i]);

  // 2. Tidy: a majority filter to take the burrs off, then each region kept to one piece.
  for (let pass = 0; pass < 2; pass++) {
    const next = lab.slice();
    const count = new Int16Array(S);
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const c = j * NX + i;
        if (lab[c] < 0) continue;
        count.fill(0);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const l = at(i + di, j + dj);
          if (l >= 0) count[l]++;
        }
        let best = lab[c];
        for (let s = 0; s < S; s++) if (count[s] > count[best]) best = s;
        next[c] = best;
      }
    }
    lab.set(next);
  }

  const onePiece = () => {
    const seen = new Int32Array(N).fill(-1);
    const pieces: { label: number; cells: number[] }[] = [];
    for (let c = 0; c < N; c++) {
      if (lab[c] < 0 || seen[c] >= 0) continue;
      const cells: number[] = [];
      const q = [c];
      seen[c] = pieces.length;
      while (q.length) {
        const k = q.pop()!;
        cells.push(k);
        const i = k % NX;
        const j = (k - i) / NX;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue;
          const n = nj * NX + ni;
          if (seen[n] < 0 && lab[n] === lab[c]) {
            seen[n] = pieces.length;
            q.push(n);
          }
        }
      }
      pieces.push({ label: lab[c], cells });
    }
    const biggest = new Map<number, number>();
    pieces.forEach((p, k) => {
      const b = biggest.get(p.label);
      if (b === undefined || pieces[b].cells.length < p.cells.length) biggest.set(p.label, k);
    });
    let changed = false;
    pieces.forEach((p, k) => {
      if (biggest.get(p.label) === k) return;
      const votes = new Map<number, number>();
      for (const cell of p.cells) {
        const i = cell % NX;
        const j = (cell - i) / NX;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const l = at(i + di, j + dj);
          if (l >= 0 && l !== p.label) votes.set(l, (votes.get(l) ?? 0) + 1);
        }
      }
      let to = SEA;
      let most = 0;
      votes.forEach((v, l) => {
        if (v > most) {
          most = v;
          to = l;
        }
      });
      for (const cell of p.cells) lab[cell] = to;
      changed = true;
    });
    return changed;
  };

  // A region touching itself only corner to corner would make its outline cross itself: fill one of
  // the two cells across the corner.
  const unpinch = () => {
    let changed = false;
    for (let j = 0; j < NY - 1; j++) {
      for (let i = 0; i < NX - 1; i++) {
        const a = lab[j * NX + i];
        const b = lab[j * NX + i + 1];
        const c = lab[(j + 1) * NX + i];
        const d = lab[(j + 1) * NX + i + 1];
        if (a >= 0 && a === d && b !== a && c !== a) {
          lab[j * NX + i + 1] = a;
          changed = true;
        } else if (b >= 0 && b === c && a !== b && d !== b) {
          lab[j * NX + i] = b;
          changed = true;
        }
      }
    }
    return changed;
  };
  for (let round = 0; round < 8; round++) {
    const a = onePiece();
    const b = unpinch();
    if (!a && !b) break;
  }

  // 3. The borders: grid edges between different labels, cut into chains at the corners where three
  // labels meet or the pair changes.
  const VX = NX + 1;
  type Edge = { v0: number; v1: number; right: number; left: number; used: boolean };
  const edges: Edge[] = [];
  const incident = new Map<number, number[]>();
  const addEdge = (v0: number, v1: number, right: number, left: number) => {
    if (right === left || (right < 0 && left < 0)) return;
    const k = edges.length;
    edges.push({ v0, v1, right, left, used: false });
    (incident.get(v0) ?? incident.set(v0, []).get(v0)!).push(k);
    (incident.get(v1) ?? incident.set(v1, []).get(v1)!).push(k);
  };
  for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) addEdge(j * VX + i, j * VX + i + 1, at(i, j), at(i, j - 1));
  for (let i = 0; i <= NX; i++) for (let j = 0; j < NY; j++) addEdge(j * VX + i, (j + 1) * VX + i, at(i - 1, j), at(i, j));

  const pairOf = (e: Edge) => (e.right < e.left ? `${e.right},${e.left}` : `${e.left},${e.right}`);
  const isJunction = (v: number) => {
    const inc = incident.get(v)!;
    return inc.length !== 2 || pairOf(edges[inc[0]]) !== pairOf(edges[inc[1]]);
  };

  interface RawChain {
    verts: number[];
    right: number;
    left: number;
  }
  const raw: RawChain[] = [];
  const walk = (start: number, first: number) => {
    const verts = [start];
    let v = start;
    let k = first;
    let right = -9;
    let left = -9;
    for (;;) {
      const e = edges[k];
      e.used = true;
      const forward = e.v0 === v;
      if (right === -9) {
        right = forward ? e.right : e.left;
        left = forward ? e.left : e.right;
      }
      v = forward ? e.v1 : e.v0;
      verts.push(v);
      if (v === start || isJunction(v)) break;
      const inc = incident.get(v)!;
      k = inc[0] === k ? inc[1] : inc[0];
    }
    raw.push({ verts, right, left });
  };
  incident.forEach((inc, v) => {
    if (!isJunction(v)) return;
    for (const k of inc) if (!edges[k].used) walk(v, k);
  });
  edges.forEach((e, k) => {
    if (!e.used) walk(e.v0, k);
  });

  const nameOf = (l: number) => (l === SEA ? 'sea' : l === ABROAD ? 'abroad' : SEEDS[l].id);
  const cell = 1 / NY;
  const chains: TheatreChain[] = raw.map(r => {
    const pts: Pt[] = r.verts.map(v => {
      const i = v % VX;
      return [i / NX, (v - i) / VX / NY];
    });
    const smooth = chaikin(simplify(pts, cell * 0.85), 2);
    return { right: nameOf(r.right), left: nameOf(r.left), points: smooth };
  });

  // 4. Each region's outline: its chains turned so it lies on the right, joined end to start.
  const regions: TheatreRegion[] = SEEDS.map((sd, s) => {
    const mine: { from: number; to: number; pts: Pt[] }[] = [];
    raw.forEach((r, k) => {
      if (r.right === s) mine.push({ from: r.verts[0], to: r.verts[r.verts.length - 1], pts: chains[k].points });
      else if (r.left === s) mine.push({ from: r.verts[r.verts.length - 1], to: r.verts[0], pts: [...chains[k].points].reverse() });
    });
    const byStart = new Map<number, number>();
    mine.forEach((m, k) => byStart.set(m.from, k));
    const polygon: Pt[] = [];
    if (mine.length) {
      let k = 0;
      const used = new Set<number>();
      while (!used.has(k)) {
        used.add(k);
        const m = mine[k];
        for (let p = 0; p < m.pts.length - 1; p++) polygon.push(m.pts[p]);
        const nk = byStart.get(m.to);
        if (nk === undefined) break;
        k = nk;
      }
      if (used.size !== mine.length) polygon.length = 0; // more than one loop: reported by the checks
    }
    const neighbours = new Set<string>();
    raw.forEach(r => {
      if (r.right === s && r.left >= 0) neighbours.add(SEEDS[r.left].id);
      if (r.left === s && r.right >= 0) neighbours.add(SEEDS[r.right].id);
    });
    return {
      id: sd.id,
      name: sd.name,
      act: sd.act,
      kind: sd.kind,
      site: sd.at,
      polygon,
      neighbours: [...neighbours].sort(),
      ...(sd.missionId ? { missionId: sd.missionId } : {}),
      ...(sd.home ? { home: true } : {}),
    };
  });

  // 5. Sites: deep inside each region (clear of its borders), as near its seed as that allows.
  const depth = new Int16Array(N).fill(-1);
  let ring: number[] = [];
  for (let c = 0; c < N; c++) {
    if (lab[c] < 0) continue;
    const i = c % NX;
    const j = (c - i) / NX;
    if (at(i + 1, j) !== lab[c] || at(i - 1, j) !== lab[c] || at(i, j + 1) !== lab[c] || at(i, j - 1) !== lab[c]) {
      depth[c] = 0;
      ring.push(c);
    }
  }
  for (let d = 1; ring.length; d++) {
    const next: number[] = [];
    for (const c of ring) {
      const i = c % NX;
      const j = (c - i) / NX;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (j + dj) * NX + i + di;
        if (depth[n] < 0 && lab[n] === lab[c]) {
          depth[n] = d;
          next.push(n);
        }
      }
    }
    ring = next;
  }
  const deepest = new Int16Array(S);
  for (let c = 0; c < N; c++) if (lab[c] >= 0 && depth[c] > deepest[lab[c]]) deepest[lab[c]] = depth[c];
  const bestSite = new Float64Array(S).fill(Infinity);
  for (let c = 0; c < N; c++) {
    const s = lab[c];
    if (s < 0) continue;
    const need = SEEDS[s].kind === 'city' ? Math.min(deepest[s], 3) : Math.max(3, Math.min(9, Math.round(deepest[s] * 0.55)));
    if (depth[c] < need) continue;
    const i = c % NX;
    const j = (c - i) / NX;
    const fx = (i + 0.5) / NX;
    const fy = (j + 0.5) / NY;
    const d = Math.hypot((fx - SEEDS[s].at[0]) * THEATRE_ASPECT, fy - SEEDS[s].at[1]);
    if (d < bestSite[s]) {
      bestSite[s] = d;
      regions[s].site = [fx, fy];
    }
  }

  const islands = ISLAND_CONTROL.map((il, n) => {
    const pts: Pt[] = [];
    const c = Math.cos(il.rot);
    const sn = Math.sin(il.rot);
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const r = 1 + 0.22 * fbm(Math.cos(a) * 1.6 + n * 5, Math.sin(a) * 1.6, 300 + n);
      const lx = Math.cos(a) * il.rx * r;
      const ly = Math.sin(a) * il.ry * r;
      pts.push([il.at[0] + (lx * c - ly * sn) / THEATRE_ASPECT, il.at[1] + lx * sn + ly * c]);
    }
    return { name: il.name, polygon: pts, at: il.at };
  });

  const rivers = RIVER_CONTROL.map(r => ({ name: r.name, points: wander(r.pts, 0.005, 0.012, 40, 500 + r.seed), label: r.label }));

  return { regions, geography: { land: landPoly, islands, rivers, chains } };
}

let cache: TheatreRegion[] | null = null;

function ensure() {
  if (cache && geo) return;
  const built = build();
  cache = built.regions;
  geo = built.geography;
}

/** Every region of the theatre, both acts. Deterministic; the same array on every call. */
export function theatreRegions(): TheatreRegion[] {
  ensure();
  return cache!;
}

/** The coast, islands, rivers and every border, for the map. Same object on every call. */
export function theatreGeography(): TheatreGeography {
  ensure();
  return geo!;
}

export function regionById(id: string): TheatreRegion | undefined {
  return theatreRegions().find(r => r.id === id);
}

/** The region a story mission is fought in. */
export function regionOfMission(missionId: string): TheatreRegion | undefined {
  return theatreRegions().find(r => r.missionId === missionId);
}

/** The region under a point in map space, if any. */
export function regionAtMap(fx: number, fy: number): TheatreRegion | undefined {
  return theatreRegions().find(r => pointInPolygon(fx, fy, r.polygon));
}

/**
 * A view of the theatre from no more than a count of missions won, for a preview that has only a
 * saves list to go on (the lobby's card): the regions of the missions won so far are held with the
 * home ground, the next mission's region is open, everything else is the enemy's. No engagements.
 */
export function previewView(missionsWon: number): TheatreView {
  const control: Record<string, RegionControl> = {};
  const sorted = [...MISSIONS].sort((a, b) => a.order - b.order);
  const won = new Set(sorted.filter(m => m.order <= missionsWon).map(m => m.id));
  const next = sorted.find(m => m.order === missionsWon + 1);
  for (const r of theatreRegions()) {
    control[r.id] = r.home || (r.missionId && won.has(r.missionId)) ? 'held' : r.missionId && r.missionId === next?.id ? 'open' : 'enemy';
  }
  const act2 = sorted.find(m => regionOfMission(m.id)?.act === 1);
  return {
    act: act2 && missionsWon >= act2.order - 1 ? 1 : 0,
    control,
    missions: sorted.flatMap(m => {
      const r = regionOfMission(m.id);
      if (!r) return [];
      const state = won.has(m.id) ? 'won' : m.id === next?.id ? 'open' : 'locked';
      return [{ id: m.id, order: m.order, title: m.title, regionId: r.id, state, stars: state === 'won' ? 1 : 0, maxStars: 1 + m.bonus.length }];
    }),
    engagements: [],
  };
}
