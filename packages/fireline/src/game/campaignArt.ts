import type { HeroKind } from '../sim/rules';
import { TEAM } from '../theme';

/**
 * Campaign art, drawn with canvas paths like everything else in Fireline: the theatre map the
 * missions sit on, the Commander's rank insignia and the heroes' portraits. No image files.
 *
 * Everything here is pure drawing: same inputs, same picture (apart from `t`, which only moves the
 * subtle animation). Canvas art may use literal colours; the React chrome around it uses the CSS
 * variables in styles.css.
 */

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const GOLD = '#f2c44e';
const GOLD_DARK = '#8a6412';
const SILVER = '#d9dde2';

export interface CampaignMapNode {
  id: string;
  /** 1-based position in the campaign; decides where the node sits (campaignNodePosition). */
  order: number;
  title: string;
  state: 'locked' | 'open' | 'won';
  stars: number;
  /** Stars this mission can give (1 plus its bonus objectives); 3 when left out. */
  maxStars?: number;
  selected: boolean;
  hover: boolean;
}

/**
 * The campaign is in two acts, each on its own theatre map: act one (missions 1 to 8) on the
 * southern coast, act two (9 to 14) on the northern coast and highlands. Each act lays its own
 * missions out along its own route, counted from its first mission.
 */
const ACTS = [
  { first: 1, length: 8 },
  { first: 9, length: 6 },
] as const;

/** Which act (0 or 1) a mission of this order belongs to. */
export function campaignActOf(order: number): 0 | 1 {
  return order >= ACTS[1].first ? 1 : 0;
}

/** A mission's place along its act's route, 0-based, and that route's length. Orders beyond the end sit at the far end. */
function routeStep(order: number): { k: number; length: number } {
  const act = ACTS[campaignActOf(order)];
  return { k: Math.max(0, Math.min(act.length - 1, order - act.first)), length: act.length };
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1-D value noise, for coastlines and the front line. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i * 131 + seed) * (1 - u) + hash((i + 1) * 131 + seed) * u;
}

const portrait = (w: number, h: number) => w < h * 0.9;

/**
 * Map space: (fx, fy) in 0..1, west (Meridian) at fx 0 and east (Combine) at fx 1, the coast to the
 * south. On a wide canvas that is the canvas as it stands; on a tall one (a phone) the map turns so
 * the advance runs from the bottom up and the coast lies down the left edge.
 */
function toScreen(fx: number, fy: number, w: number, h: number): [number, number] {
  if (!portrait(w, h)) return [fx * w, fy * h];
  return [(1 - fy) * w, (1 - fx) * h];
}

/** Where a node of this order sits, in canvas pixels: the UI hit-tests clicks against this. */
export function campaignNodePosition(order: number, w: number, h: number): { x: number; y: number } {
  const { k } = routeStep(order);
  const zig = k % 2 === 0 ? 0.13 : -0.13;
  const fx = mapFx(order, portrait(w, h));
  const fy = 0.47 + zig + (hash(k * 7 + 3) - 0.5) * 0.08;
  const [x, y] = toScreen(fx, fy, w, h);
  return { x, y };
}

/** Radius of a node badge, in canvas pixels. Hit-test within this (plus a little) of the position. */
export function campaignNodeRadius(w: number, h: number): number {
  return Math.max(15, Math.min(26, Math.min(w, h) * 0.045));
}

/** How far east a node sits in map space. A tall map keeps clear of the side names top and bottom. */
function mapFx(order: number, tall: boolean): number {
  const { k, length } = routeStep(order);
  return tall ? 0.14 + (k / (length - 1)) * 0.72 : 0.09 + (k / (length - 1)) * 0.82;
}

/** The coastline in map space: a wavy edge along the south, with a bay in the middle. */
const COAST: [number, number][] = [];
for (let i = 0; i <= 80; i++) {
  const fx = -0.05 + (i / 80) * 1.1;
  const bay = Math.exp(-(((fx - 0.52) / 0.08) ** 2)) * 0.07;
  const fy = 0.86 - bay + (noise1(fx * 9, 11) - 0.5) * 0.06 + (noise1(fx * 31, 12) - 0.5) * 0.02;
  COAST.push([fx, fy]);
}

/**
 * Act two's coastline: the sea to the north this time, a ragged shore cut by two fjords running
 * south into the highlands, at fx 0.31 and 0.74.
 */
const NORTH_COAST: [number, number][] = [];
for (let i = 0; i <= 120; i++) {
  const fx = -0.05 + (i / 120) * 1.1;
  const fjord = Math.exp(-(((fx - 0.31) / 0.018) ** 2)) * 0.16 + Math.exp(-(((fx - 0.74) / 0.022) ** 2)) * 0.13;
  const fy = 0.17 + fjord + (noise1(fx * 11, 61) - 0.5) * 0.07 + (noise1(fx * 37, 62) - 0.5) * 0.025;
  NORTH_COAST.push([fx, fy]);
}

/** Traces the land as the current path: north of the coast in act one, south of it in act two. */
function traceLand(g: Ctx, w: number, h: number, act: 0 | 1 = 0) {
  g.beginPath();
  const edge = act === 0 ? -0.05 : 1.05;
  const coast = act === 0 ? COAST : NORTH_COAST;
  let [sx, sy] = toScreen(-0.05, edge, w, h);
  g.moveTo(sx, sy);
  [sx, sy] = toScreen(1.05, edge, w, h);
  g.lineTo(sx, sy);
  for (let i = coast.length - 1; i >= 0; i--) {
    const [x, y] = toScreen(coast[i][0], coast[i][1], w, h);
    g.lineTo(x, y);
  }
  g.closePath();
}

function starPath(ctx: Ctx, x: number, y: number, r: number, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 ? r * inner : r;
    if (i) ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    else ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
}

// ---- The theatre map: a staff officer's operational map ---------------------------------------
//
// Drawn in three layers. The sheet (paper, coast, contours, woods, rivers, names, grid) depends
// only on size, act and colour mode. The situation (territory, the front, arrows of advance,
// objectives, cartouche, legend, scale and stamp) depends on the missions' states as well. Both
// are painted once and kept; only the open objective's pulse and the hover and selection rings
// are drawn every frame.

/** Light or dark: a sheet on a daylit table, or the same sheet at night under a lamp. */
export type MapScheme = 'light' | 'dark';

export interface CampaignMapOptions {
  /** Defaults to the page's current mode (<html data-theme>). */
  scheme?: MapScheme;
  /** A small sheet (a preview): no legend, a one-line cartouche. Defaults to true below 640 px wide. */
  compact?: boolean;
  /** False draws the open objective's pulse as a still ring (reduced motion). Defaults to true. */
  motion?: boolean;
}

/** The two theatres' names, for the cartouche and for the screens. */
export const CAMPAIGN_THEATRES = [
  { act: 'Act I', place: 'The Southern Coast', sheet: 'Sheet 1 of 2' },
  { act: 'Act II', place: 'The Northern Front', sheet: 'Sheet 2 of 2' },
] as const;

interface Palette {
  paper: string;
  paperLit: string;
  paperEdge: string;
  mottleLight: string;
  mottleDark: string;
  fibreLight: string;
  fibreDark: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  halo: string;
  grid: string;
  contour: string;
  contourIndex: string;
  water: string;
  waterLine: string;
  river: string;
  wood: string;
  woodHatch: string;
  road: string;
  blue: string;
  blueFill: string;
  blueWash: string;
  red: string;
  redFill: string;
  redHatch: string;
  pencil: string;
  star: string;
  box: string;
  stamp: string;
  highlight: string;
  pulse: string;
  creaseLight: string;
  creaseDark: string;
}

const PALETTES: Record<MapScheme, Palette> = {
  light: {
    paper: '#ebe1c4',
    paperLit: '#f3ecd6',
    paperEdge: 'rgba(120,86,40,0.30)',
    mottleLight: 'rgba(255,250,232,0.22)',
    mottleDark: 'rgba(150,118,70,0.10)',
    fibreLight: 'rgba(255,252,238,0.45)',
    fibreDark: 'rgba(110,84,48,0.13)',
    ink: '#2a2219',
    inkSoft: 'rgba(42,34,25,0.68)',
    inkFaint: 'rgba(42,34,25,0.34)',
    halo: 'rgba(240,232,208,0.92)',
    grid: 'rgba(52,98,128,0.26)',
    contour: 'rgba(156,98,46,0.42)',
    contourIndex: 'rgba(146,88,36,0.72)',
    water: 'rgba(160,196,204,0.62)',
    waterLine: 'rgba(36,92,122,0.78)',
    river: '#3a7798',
    wood: 'rgba(160,184,120,0.3)',
    woodHatch: 'rgba(60,92,44,0.72)',
    road: 'rgba(168,74,40,0.55)',
    blue: '#1d4c9a',
    blueFill: 'rgba(29,76,154,0.12)',
    blueWash: 'rgba(40,92,176,0.065)',
    red: '#b0261d',
    redFill: 'rgba(176,38,29,0.08)',
    redHatch: 'rgba(176,38,29,0.11)',
    pencil: 'rgba(78,76,70,0.72)',
    star: '#b07d0a',
    box: 'rgba(245,239,220,0.94)',
    stamp: 'rgba(168,34,30,0.7)',
    highlight: 'rgba(242,196,40,0.5)',
    pulse: '176,38,29',
    creaseLight: 'rgba(255,252,240,0.55)',
    creaseDark: 'rgba(90,66,30,0.16)',
  },
  dark: {
    paper: '#3a3225',
    paperLit: '#57492f',
    paperEdge: 'rgba(0,0,0,0.55)',
    mottleLight: 'rgba(255,226,170,0.035)',
    mottleDark: 'rgba(0,0,0,0.12)',
    fibreLight: 'rgba(255,232,186,0.07)',
    fibreDark: 'rgba(0,0,0,0.2)',
    ink: '#ece0c2',
    inkSoft: 'rgba(236,224,194,0.7)',
    inkFaint: 'rgba(236,224,194,0.34)',
    halo: 'rgba(52,44,32,0.9)',
    grid: 'rgba(150,186,204,0.18)',
    contour: 'rgba(214,162,104,0.34)',
    contourIndex: 'rgba(224,170,110,0.6)',
    water: 'rgba(40,64,72,0.62)',
    waterLine: 'rgba(130,184,200,0.5)',
    river: '#74aac4',
    wood: 'rgba(96,120,72,0.3)',
    woodHatch: 'rgba(160,190,128,0.38)',
    road: 'rgba(222,130,92,0.5)',
    blue: '#8cb2f2',
    blueFill: 'rgba(120,160,236,0.16)',
    blueWash: 'rgba(110,150,230,0.07)',
    red: '#f0806f',
    redFill: 'rgba(240,128,111,0.1)',
    redHatch: 'rgba(240,128,111,0.15)',
    pencil: 'rgba(206,200,186,0.62)',
    star: '#e6b84a',
    box: 'rgba(44,37,27,0.94)',
    stamp: 'rgba(236,104,92,0.72)',
    highlight: 'rgba(242,196,60,0.38)',
    pulse: '240,128,111',
    creaseLight: 'rgba(255,230,180,0.08)',
    creaseDark: 'rgba(0,0,0,0.3)',
  },
};

// Old Standard TT, bundled (main.tsx imports it; the CSP allows fonts from this origin only), so the
// lettering is the same on every device rather than whichever serif the system happens to have.
const SERIF = '"Old Standard TT", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';

let fontsLoaded = false;
let fontsPromise: Promise<void> | null = null;

/**
 * Resolves once the map's typeface is loaded (at once if it already is, or if the browser cannot
 * say). A canvas does not wait for a web font: lettering drawn before it arrives uses the fallback,
 * and the sheets are cached, so the caches are dropped here and the caller draws again.
 */
export function mapFontsReady(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) {
    fontsLoaded = true;
    fontsPromise = Promise.resolve();
    return fontsPromise;
  }
  const faces = ['400 16px "Old Standard TT"', 'italic 400 16px "Old Standard TT"', '700 16px "Old Standard TT"'];
  fontsPromise = Promise.all(faces.map(f => fonts.load(f)))
    .catch(() => undefined)
    .then(() => {
      fontsLoaded = true;
      sheetCache.clear();
      situationCache.clear();
    });
  return fontsPromise;
}

function pageScheme(): MapScheme {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** The sheet's margin, where the grid references sit; the map proper is inside the neatline. */
function marginOf(w: number, h: number): number {
  return Math.round(Math.max(13, Math.min(22, Math.min(w, h) * 0.048)));
}

interface MapText {
  size: number;
  colour: string;
  halo?: string | null;
  style?: 'roman' | 'italic' | 'caps';
  weight?: number;
  spacing?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
}

function setSpacing(g: Ctx, px: number) {
  const s = g as Ctx & { letterSpacing?: string };
  if ('letterSpacing' in s) s.letterSpacing = `${px}px`;
}

function mapFont(size: number, style: MapText['style'] = 'roman', weight = 400): string {
  const lead = style === 'italic' ? 'italic ' : style === 'caps' ? 'small-caps ' : '';
  return `${lead}${weight} ${size}px ${SERIF}`;
}

/** Map lettering: serif, optionally italic or small capitals, knocked out of the linework with a paper halo. */
function letter(g: Ctx, text: string, x: number, y: number, o: MapText) {
  g.save();
  g.font = mapFont(o.size, o.style, o.weight ?? 400);
  setSpacing(g, o.spacing ?? 0);
  g.textAlign = o.align ?? 'center';
  g.textBaseline = o.baseline ?? 'middle';
  // Letter-spacing adds space after the last letter too; centre on the letters themselves.
  if ((o.align ?? 'center') === 'center' && o.spacing) x += o.spacing / 2;
  if (o.halo) {
    g.lineJoin = 'round';
    g.strokeStyle = o.halo;
    g.lineWidth = Math.max(2, o.size * 0.32);
    g.strokeText(text, x, y);
  }
  g.fillStyle = o.colour;
  g.fillText(text, x, y);
  g.restore();
}

function measure(g: Ctx, text: string, size: number, style: MapText['style'] = 'roman', weight = 400, spacing = 0): number {
  g.save();
  g.font = mapFont(size, style, weight);
  setSpacing(g, spacing);
  const wd = g.measureText(text).width;
  g.restore();
  return wd;
}

/** Text set along a direction (river names, the sea's name). */
function letterAt(g: Ctx, text: string, x: number, y: number, angle: number, o: MapText) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  letter(g, text, 0, 0, o);
  g.restore();
}

/** The land as a list of screen points: everything on the land side of the act's coast. */
function landPoints(w: number, h: number, act: 0 | 1): [number, number][] {
  const edge = act === 0 ? -0.05 : 1.05;
  const coast = act === 0 ? COAST : NORTH_COAST;
  const pts: [number, number][] = [toScreen(-0.05, edge, w, h), toScreen(1.05, edge, w, h)];
  for (let i = coast.length - 1; i >= 0; i--) pts.push(toScreen(coast[i][0], coast[i][1], w, h));
  return pts;
}

function polyPath(g: Ctx, pts: [number, number][], close = true) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (close) g.closePath();
}

function newCanvas(w: number, h: number, res: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * res));
  c.height = Math.max(1, Math.round(h * res));
  const g = c.getContext('2d')!;
  g.scale(res, res);
  return [c, g];
}

/** A closed, slightly irregular ring, as a draughtsman draws a contour or a wood's edge. */
function wobblyRing(g: Ctx, cx: number, cy: number, rx: number, ry: number, rot: number, seed: number, wob = 0.16) {
  const p1 = hash(seed) * TAU;
  const p2 = hash(seed + 1) * TAU;
  const p3 = hash(seed + 2) * TAU;
  const p4 = hash(seed + 3) * TAU;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  g.beginPath();
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + wob * (0.55 * Math.sin(a + p1) + 0.3 * Math.sin(2 * a + p2) + 0.18 * Math.sin(3 * a + p3)) + 0.025 * Math.sin(7 * a + p4);
    const lx = Math.cos(a) * rx * k;
    const ly = Math.sin(a) * ry * k;
    const x = cx + lx * c - ly * s;
    const y = cy + lx * s + ly * c;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

// ---- The sheet --------------------------------------------------------------------------------

const sheetCache = new Map<string, HTMLCanvasElement>();

interface Hill {
  fx: number;
  fy: number;
  r: number;
  levels: number;
  step: number;
}
interface Wood {
  fx: number;
  fy: number;
  r: number;
}
interface Place {
  fx: number;
  fy: number;
  name: string;
  /** Label side: 1 east, -1 west. */
  side?: 1 | -1;
}

/**
 * What each theatre holds, in map space. Hills keep to the margins of the advance (north in act
 * one, the southern highlands in act two), and the towns sit between the objectives' labels.
 */
const THEATRE: {
  hills: Hill[];
  woods: Wood[];
  towns: Place[];
  rivers: { seed: number; fx0: number; from: number; to: number; north: boolean; name: string; at: number }[];
  sea: { name: string; fx: number; fy: number };
  region: { name: string; fx: number; fy: number };
}[] = [
  {
    hills: [
      { fx: 0.36, fy: 0.13, r: 0.11, levels: 6, step: 40 },
      { fx: 0.6, fy: 0.16, r: 0.09, levels: 5, step: 40 },
      { fx: 0.8, fy: 0.11, r: 0.1, levels: 6, step: 40 },
      { fx: 0.12, fy: 0.3, r: 0.07, levels: 3, step: 40 },
      { fx: 0.53, fy: 0.46, r: 0.06, levels: 3, step: 40 },
      { fx: 0.95, fy: 0.42, r: 0.08, levels: 4, step: 40 },
      { fx: 0.28, fy: 0.68, r: 0.05, levels: 2, step: 40 },
    ],
    woods: [
      { fx: 0.17, fy: 0.5, r: 0.035 },
      { fx: 0.45, fy: 0.26, r: 0.03 },
      { fx: 0.66, fy: 0.55, r: 0.032 },
      { fx: 0.87, fy: 0.27, r: 0.03 },
      { fx: 0.38, fy: 0.72, r: 0.026 },
      { fx: 0.72, fy: 0.08, r: 0.028 },
      { fx: 0.93, fy: 0.62, r: 0.03 },
    ],
    towns: [
      { fx: 0.45, fy: 0.76, name: 'Varne' },
      { fx: 0.9, fy: 0.75, name: 'Orrin', side: -1 },
      { fx: 0.69, fy: 0.81, name: 'Callowby' },
      { fx: 0.56, fy: 0.2, name: 'Hesketh' },
    ],
    rivers: [
      { seed: 21, fx0: 0.3, from: -0.02, to: 0.92, north: false, name: 'R. Wend', at: 0.36 },
      { seed: 22, fx0: 0.7, from: -0.02, to: 0.92, north: false, name: 'R. Callow', at: 0.24 },
    ],
    sea: { name: 'GULF OF VARNE', fx: 0.56, fy: 0.925 },
    region: { name: 'ASHBY DOWNS', fx: 0.47, fy: 0.075 },
  },
  {
    hills: [
      { fx: 0.12, fy: 0.86, r: 0.1, levels: 6, step: 100 },
      { fx: 0.4, fy: 0.84, r: 0.11, levels: 8, step: 100 },
      { fx: 0.6, fy: 0.8, r: 0.09, levels: 7, step: 100 },
      { fx: 0.8, fy: 0.82, r: 0.11, levels: 8, step: 100 },
      { fx: 0.97, fy: 0.62, r: 0.08, levels: 6, step: 100 },
      { fx: 0.22, fy: 0.48, r: 0.06, levels: 3, step: 100 },
      { fx: 0.6, fy: 0.5, r: 0.06, levels: 4, step: 100 },
      { fx: 0.45, fy: 0.3, r: 0.045, levels: 2, step: 100 },
    ],
    woods: [
      { fx: 0.09, fy: 0.4, r: 0.03 },
      { fx: 0.33, fy: 0.68, r: 0.034 },
      { fx: 0.5, fy: 0.62, r: 0.03 },
      { fx: 0.68, fy: 0.7, r: 0.032 },
      { fx: 0.86, fy: 0.42, r: 0.03 },
      { fx: 0.4, fy: 0.42, r: 0.025 },
    ],
    towns: [
      { fx: 0.05, fy: 0.25, name: 'Kellholm' },
      { fx: 0.45, fy: 0.24, name: 'Brannock', side: -1 },
      { fx: 0.66, fy: 0.23, name: 'Halsey' },
      { fx: 0.55, fy: 0.73, name: 'Tarn End' },
    ],
    rivers: [{ seed: 71, fx0: 0.74, from: 1.02, to: 0.22, north: true, name: 'R. Brann', at: 0.8 }],
    sea: { name: 'THE NORTHERN SOUND', fx: 0.56, fy: 0.088 },
    region: { name: 'THE GREY FELLS', fx: 0.53, fy: 0.9 },
  },
];

function riverPoints(r: (typeof THEATRE)[number]['rivers'][number], w: number, h: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const fy = r.from + (i / 48) * (r.to - r.from);
    const fx = r.north
      ? r.fx0 + (noise1(fy * 6, r.seed) - 0.5) * 0.16 * Math.min(1, (fy - 0.2) * 3) + Math.sin(fy * 15) * 0.01
      : r.fx0 + (noise1(fy * 6, r.seed) - 0.5) * 0.14 + Math.sin(fy * 14 + r.seed) * 0.012;
    pts.push(toScreen(fx, fy, w, h));
  }
  return pts;
}

function paintSheet(w: number, h: number, res: number, act: 0 | 1, scheme: MapScheme, compact: boolean): HTMLCanvasElement {
  const key = `${w}x${h}@${res}#${act}${scheme}${compact ? 'c' : ''}${fontsLoaded ? 'f' : ''}`;
  const hit = sheetCache.get(key);
  if (hit) return hit;
  if (sheetCache.size > 6) sheetCache.clear();
  const [c, g] = newCanvas(w, h, res);
  const pal = PALETTES[scheme];
  const P = (fx: number, fy: number) => toScreen(fx, fy, w, h);
  const unit = Math.min(w, h);
  const k = unit / 450;
  const m = marginOf(w, h);
  const th = THEATRE[act];
  const land = landPoints(w, h, act);

  // Paper: the base tone, the light falling on it, and a mottle of age.
  g.fillStyle = pal.paper;
  g.fillRect(0, 0, w, h);
  const lit = g.createRadialGradient(w * 0.38, h * 0.32, 0, w * 0.38, h * 0.32, Math.hypot(w, h) * (scheme === 'dark' ? 0.55 : 0.7));
  lit.addColorStop(0, pal.paperLit);
  lit.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lit;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = hash(i * 7 + 900) * w;
    const y = hash(i * 7 + 901) * h;
    const r = unit * (0.08 + hash(i * 7 + 902) * 0.22);
    const mot = g.createRadialGradient(x, y, 0, x, y, r);
    mot.addColorStop(0, i % 2 ? pal.mottleLight : pal.mottleDark);
    mot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  g.save();
  g.beginPath();
  g.rect(m, m, w - m * 2, h - m * 2);
  g.clip();

  // Water: a pale wash, then the water lining, ripples drawn parallel to the shore.
  g.save();
  g.beginPath();
  g.rect(m, m, w - m * 2, h - m * 2);
  land.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = pal.water;
  g.fill('evenodd');
  g.restore();
  {
    const [a, ga] = newCanvas(w, h, res);
    const [b, gb] = newCanvas(w, h, res);
    const ds = [2.2, 4.8, 7.8, 11.4, 15.6, 20.6, 26.4].map(d => d * Math.max(0.7, k));
    const lw = Math.max(0.7, 0.95 * k);
    ga.lineJoin = gb.lineJoin = 'round';
    ds.forEach((d, i) => {
      gb.setTransform(1, 0, 0, 1, 0, 0);
      gb.clearRect(0, 0, b.width, b.height);
      gb.setTransform(res, 0, 0, res, 0, 0);
      gb.globalCompositeOperation = 'source-over';
      polyPath(gb, land);
      gb.strokeStyle = '#000';
      gb.lineWidth = d * 2 + lw;
      gb.stroke();
      gb.globalCompositeOperation = 'destination-out';
      gb.lineWidth = d * 2 - lw;
      gb.stroke();
      ga.globalAlpha = 1 - (i / ds.length) * 0.82;
      ga.drawImage(b, 0, 0, w, h);
    });
    ga.globalAlpha = 1;
    ga.globalCompositeOperation = 'destination-out';
    polyPath(ga, land);
    ga.fill();
    ga.globalCompositeOperation = 'source-in';
    ga.fillStyle = pal.waterLine;
    ga.fillRect(0, 0, w, h);
    g.drawImage(a, 0, 0, w, h);
  }
  // Islands off the northern coast: small outlined shapes with their own ripple.
  if (act === 1) {
    for (let i = 0; i < 6; i++) {
      const ifx = 0.06 + hash(i * 19 + 4) * 0.88;
      // Clear of the sea's name.
      if (Math.abs(ifx - THEATRE[1].sea.fx) < 0.16) continue;
      const [x, y] = P(ifx, 0.04 + hash(i * 23 + 5) * 0.07);
      const r = unit * (0.008 + hash(i * 29 + 6) * 0.012);
      g.strokeStyle = pal.waterLine;
      g.lineWidth = 0.7;
      wobblyRing(g, x, y, r * 2.2, r * 1.6, hash(i) * 3, i * 13 + 500, 0.25);
      g.stroke();
      g.fillStyle = pal.paper;
      wobblyRing(g, x, y, r * 1.4, r, hash(i) * 3, i * 13 + 500, 0.25);
      g.fill();
      g.strokeStyle = pal.ink;
      g.lineWidth = 0.9;
      g.stroke();
    }
  }

  // Everything on land is clipped to the land.
  g.save();
  polyPath(g, land);
  g.clip();

  // Contours, hand drawn: rings that crowd on the steeper side, every fifth one heavier, and the
  // summit's spot height beside a dot.
  th.hills.forEach((hl, i) => {
    const [cx, cy] = P(hl.fx, hl.fy);
    const r = unit * hl.r * 1.3;
    const lean = hash(i * 5 + 70) * TAU;
    const rot = hash(i * 5 + 71) * Math.PI;
    for (let j = hl.levels; j >= 1; j--) {
      const s = j / hl.levels;
      const ox = Math.cos(lean) * r * 0.28 * (1 - s);
      const oy = Math.sin(lean) * r * 0.2 * (1 - s);
      wobblyRing(g, cx + ox, cy + oy, r * s, r * s * 0.68, rot, i * 31 + j * 7, 0.2);
      const index = (hl.levels - j) % 4 === 0;
      g.strokeStyle = index ? pal.contourIndex : pal.contour;
      g.lineWidth = (index ? 1.15 : 0.7) * Math.max(0.8, k);
      g.stroke();
    }
    const sx = cx + Math.cos(lean) * r * 0.28;
    const sy = cy + Math.sin(lean) * r * 0.2;
    g.fillStyle = pal.ink;
    g.beginPath();
    g.arc(sx, sy, Math.max(1.1, 1.4 * k), 0, TAU);
    g.fill();
    const height = hl.levels * hl.step + Math.round(hash(i * 3 + 80) * hl.step * 0.8);
    letter(g, String(height), sx + 3 * Math.max(0.8, k), sy - 1, {
      size: Math.max(7.5, 9 * k),
      colour: pal.inkSoft,
      halo: pal.halo,
      style: 'italic',
      align: 'left',
    });
  });

  // Woods: an outlined edge, a green tint and close diagonal hatching.
  th.woods.forEach((wd, i) => {
    const [x, y] = P(wd.fx, wd.fy);
    const r = unit * wd.r * 1.25;
    const rot = hash(i * 9 + 40) * Math.PI;
    wobblyRing(g, x, y, r * 1.35, r, rot, i * 17 + 300, 0.28);
    g.fillStyle = pal.wood;
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = pal.woodHatch;
    g.lineWidth = 0.7;
    g.beginPath();
    const gap = Math.max(2.6, 3.3 * k);
    const dir = act === 1 ? -1 : 1;
    for (let d = -r * 3; d < r * 3; d += gap) {
      g.moveTo(x + d - r * 2 * dir, y - r * 2);
      g.lineTo(x + d + r * 2 * dir, y + r * 2);
    }
    g.stroke();
    g.restore();
    wobblyRing(g, x, y, r * 1.35, r, rot, i * 17 + 300, 0.28);
    g.strokeStyle = pal.woodHatch;
    g.lineWidth = 0.9;
    g.stroke();
  });

  // Rivers: a fine line in the hills that broadens towards the sea.
  for (const rv of th.rivers) {
    const pts = riverPoints(rv, w, h);
    g.lineCap = 'round';
    g.strokeStyle = pal.river;
    for (let i = 1; i < pts.length; i++) {
      g.beginPath();
      g.moveTo(pts[i - 1][0], pts[i - 1][1]);
      g.lineTo(pts[i][0], pts[i][1]);
      g.lineWidth = (0.7 + (i / pts.length) * 2.1) * Math.max(0.75, k);
      g.stroke();
    }
    if (compact) continue;
    const at = Math.round(rv.at * (pts.length - 1));
    const [x0, y0] = pts[Math.max(0, at - 2)];
    const [x1, y1] = pts[Math.min(pts.length - 1, at + 2)];
    let ang = Math.atan2(y1 - y0, x1 - x0);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    const [lx, ly] = pts[at];
    letterAt(g, rv.name, lx + Math.cos(ang + Math.PI / 2) * 8 * k, ly + Math.sin(ang + Math.PI / 2) * 8 * k, ang, {
      size: Math.max(8, 10 * k),
      colour: pal.river,
      halo: pal.halo,
      style: 'italic',
      spacing: 0.5,
    });
  }

  // A coast road through the towns, red over a fine casing.
  {
    const road: [number, number][] = th.towns
      .filter(t => (act === 0 ? t.fy > 0.6 : t.fy < 0.4))
      .sort((a, b) => a.fx - b.fx)
      .map(t => P(t.fx, t.fy));
    road.unshift(P(-0.05, act === 0 ? 0.78 : 0.27));
    road.push(P(1.05, act === 0 ? 0.77 : 0.28));
    g.beginPath();
    road.forEach(([x, y], i) => {
      if (!i) g.moveTo(x, y);
      else {
        const [px, py] = road[i - 1];
        g.quadraticCurveTo(px + (x - px) * 0.5, py + (y - py) * 0.5 + (hash(i + 700) - 0.5) * 18 * k, x, y);
      }
    });
    g.strokeStyle = pal.inkFaint;
    g.lineWidth = 2.6 * Math.max(0.8, k);
    g.stroke();
    g.strokeStyle = pal.road;
    g.lineWidth = 1.4 * Math.max(0.8, k);
    g.stroke();
  }
  g.restore(); // land clip

  // Towns: a cluster of small blocks, named in roman type.
  const townSize = Math.max(8, Math.min(11, 10.5 * k));
  th.towns.forEach((t, i) => {
    const [x, y] = P(t.fx, t.fy);
    g.fillStyle = pal.ink;
    const b = Math.max(1.8, 2.4 * k);
    for (let j = 0; j < 5; j++) {
      const bx = x + (hash(i * 40 + j) - 0.5) * b * 4;
      const by = y + (hash(i * 40 + j + 9) - 0.5) * b * 3;
      g.fillRect(bx - b / 2, by - b / 2, b, b * (0.8 + hash(i * 40 + j + 20) * 0.5));
    }
    const side = t.side ?? 1;
    letter(g, t.name, x + side * b * 3.4, y, { size: townSize, colour: pal.ink, halo: pal.halo, align: side > 0 ? 'left' : 'right' });
  });

  // The sea's name and the region's, widely spaced.
  {
    const [sx, sy] = P(th.sea.fx, th.sea.fy);
    letter(g, th.sea.name, sx, sy, { size: Math.max(8.5, 12 * k), colour: pal.waterLine, style: 'italic', spacing: Math.max(2, 5 * k) });
    const [rx, ry] = P(th.region.fx, th.region.fy);
    if (!compact) letter(g, th.region.name, rx, ry, { size: Math.max(8, 10.5 * k), colour: pal.contourIndex, halo: pal.halo, spacing: Math.max(2, 6 * k) });
  }

  // The coastline itself, inked last so it is crisp.
  g.save();
  const coast = act === 0 ? COAST : NORTH_COAST;
  g.beginPath();
  coast.forEach(([fx, fy], i) => {
    const [x, y] = P(fx, fy);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  g.strokeStyle = pal.ink;
  g.lineWidth = 1.2 * Math.max(0.8, k);
  g.lineJoin = 'round';
  g.stroke();
  g.restore();

  // The kilometre grid.
  const grid = gridOf(w, h);
  g.strokeStyle = pal.grid;
  g.lineWidth = 0.7;
  g.beginPath();
  for (const x of grid.xs) {
    g.moveTo(x, m);
    g.lineTo(x, h - m);
  }
  for (const y of grid.ys) {
    g.moveTo(m, y);
    g.lineTo(w - m, y);
  }
  g.stroke();
  g.restore(); // neatline clip

  // The neatline: a fine inner rule and a heavier outer one, with fine ticks between.
  g.strokeStyle = pal.ink;
  g.lineWidth = 1;
  g.strokeRect(m + 0.5, m + 0.5, w - m * 2 - 1, h - m * 2 - 1);
  g.lineWidth = 1.8;
  g.strokeRect(m - 3, m - 3, w - m * 2 + 6, h - m * 2 + 6);
  g.lineWidth = 0.7;
  g.beginPath();
  const tickStep = grid.cell / 5;
  for (let x = grid.xs[0] - grid.cell; x < w - m; x += tickStep) {
    if (x <= m) continue;
    g.moveTo(x, m - 3);
    g.lineTo(x, m);
    g.moveTo(x, h - m);
    g.lineTo(x, h - m + 3);
  }
  for (let y = grid.ys[0] - grid.cell; y < h - m; y += tickStep) {
    if (y <= m) continue;
    g.moveTo(m - 3, y);
    g.lineTo(m, y);
    g.moveTo(w - m, y);
    g.lineTo(w - m + 3, y);
  }
  g.stroke();
  // Grid references: letters along the top and bottom, numbers down the sides.
  const refSize = Math.max(7, Math.min(10, m * 0.45));
  const cols = [m, ...grid.xs, w - m];
  for (let i = 0; i < cols.length - 1; i++) {
    const cx = (cols[i] + cols[i + 1]) / 2;
    if (cols[i + 1] - cols[i] < refSize * 1.6) continue;
    const ref = String.fromCharCode(65 + i);
    letter(g, ref, cx, (m - 3) / 2, { size: refSize, colour: pal.inkSoft });
    letter(g, ref, cx, h - (m - 3) / 2, { size: refSize, colour: pal.inkSoft });
  }
  const rows = [m, ...grid.ys, h - m];
  for (let i = 0; i < rows.length - 1; i++) {
    const cy = (rows[i] + rows[i + 1]) / 2;
    if (rows[i + 1] - rows[i] < refSize * 1.6) continue;
    const ref = String(i + 1);
    letter(g, ref, (m - 3) / 2, cy, { size: refSize, colour: pal.inkSoft });
    letter(g, ref, w - (m - 3) / 2, cy, { size: refSize, colour: pal.inkSoft });
  }

  // Fibre and grain over everything, and the paper darkening towards its edges.
  const fibres = Math.round((w * h) / 700);
  g.lineWidth = 0.6;
  for (let i = 0; i < fibres; i++) {
    const x = hash(i * 5 + 11) * w;
    const y = hash(i * 5 + 12) * h;
    const a = hash(i * 5 + 13) * TAU;
    const l = 2 + hash(i * 5 + 14) * 9;
    g.strokeStyle = i % 3 ? pal.fibreDark : pal.fibreLight;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let i = 0; i < (w * h) / 260; i++) {
    g.fillStyle = i % 2 ? pal.fibreLight : pal.fibreDark;
    const s = hash(i * 3 + 2) < 0.9 ? 0.8 : 1.6;
    g.fillRect(hash(i * 3 + 400) * w, hash(i * 3 + 401) * h, s, s);
  }
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, pal.paperEdge);
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
  // A tea ring someone set down on it, long ago.
  {
    const x = w * (act === 0 ? 0.88 : 0.12);
    const y = h * (act === 0 ? 0.58 : 0.55);
    const r = unit * 0.07;
    g.strokeStyle = scheme === 'dark' ? 'rgba(0,0,0,0.16)' : 'rgba(140,100,50,0.1)';
    g.lineWidth = 2.2;
    wobblyRing(g, x, y, r, r * 0.97, 0.4, 990 + act, 0.03);
    g.stroke();
    g.lineWidth = 0.8;
    wobblyRing(g, x + 1.5, y + 1, r * 0.95, r * 0.92, 0.4, 995 + act, 0.04);
    g.stroke();
  }

  sheetCache.set(key, c);
  return c;
}

/** The grid lines' screen positions inside the neatline, and the cell size. */
function gridOf(w: number, h: number): { xs: number[]; ys: number[]; cell: number } {
  const m = marginOf(w, h);
  const iw = w - m * 2;
  const ih = h - m * 2;
  const cell = Math.max(44, Math.min(iw, ih) / 5.2);
  const xs: number[] = [];
  const ys: number[] = [];
  const ox = m + ((iw % cell) / 2 || cell / 2);
  const oy = m + ((ih % cell) / 2 || cell / 2);
  for (let x = ox; x < w - m - 4; x += cell) if (x > m + 4) xs.push(x);
  for (let y = oy; y < h - m - 4; y += cell) if (y > m + 4) ys.push(y);
  return { xs, ys, cell };
}

// ---- The situation ------------------------------------------------------------------------------

const situationCache = new Map<string, HTMLCanvasElement>();

/** A point on a quadratic curve. */
function quadPoint(a: number[], c: number[], b: number[], t: number): [number, number] {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

type ArrowStyle = 'won' | 'planned' | 'pencil' | 'enemy';

/**
 * An arrow of advance: a curved shaft that swells from a fine tail, ending in a broad head. Trimmed
 * at each end so it stops short of the objectives' symbols.
 */
function advanceArrow(
  g: Ctx,
  from: { x: number; y: number },
  to: { x: number; y: number },
  bend: number,
  trimStart: number,
  trimEnd: number,
  width: number,
  style: ArrowStyle,
  pal: Palette,
) {
  const a = [from.x, from.y];
  const b = [to.x, to.y];
  const len0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len0 < 1) return;
  const c = [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / len0) * len0 * bend, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / len0) * len0 * bend];
  const N = 64;
  const samples: [number, number][] = [];
  const dist: number[] = [0];
  for (let i = 0; i <= N; i++) {
    samples.push(quadPoint(a, c, b, i / N));
    if (i) dist.push(dist[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  }
  const total = dist[N];
  const s0 = trimStart;
  const s1 = total - trimEnd;
  const headLen = width * 1.9;
  if (s1 - s0 < headLen * 1.4) return;
  const at = (s: number): { p: [number, number]; d: [number, number] } => {
    let i = 1;
    while (i < N && dist[i] < s) i++;
    const q = (s - dist[i - 1]) / Math.max(1e-6, dist[i] - dist[i - 1]);
    const p0 = samples[i - 1];
    const p1 = samples[i];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const l = Math.hypot(dx, dy) || 1;
    return { p: [p0[0] + dx * q, p0[1] + dy * q], d: [dx / l, dy / l] };
  };
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const shaftEnd = s1 - headLen;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const s = s0 + (shaftEnd - s0) * u;
    const { p, d } = at(s);
    const half = (width / 2) * (0.12 + 0.88 * Math.sqrt(u)) * 0.62;
    left.push([p[0] - d[1] * half, p[1] + d[0] * half]);
    right.push([p[0] + d[1] * half, p[1] - d[0] * half]);
  }
  const base = at(shaftEnd);
  const tip = at(s1).p;
  const hw = width * 0.95;
  g.beginPath();
  left.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.lineTo(base.p[0] - base.d[1] * hw, base.p[1] + base.d[0] * hw);
  g.lineTo(tip[0], tip[1]);
  g.lineTo(base.p[0] + base.d[1] * hw, base.p[1] - base.d[0] * hw);
  for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
  g.closePath();
  g.save();
  g.lineJoin = 'round';
  if (style === 'won') {
    g.fillStyle = pal.blue;
    g.globalAlpha = 0.88;
    g.fill();
  } else if (style === 'planned' || style === 'enemy') {
    g.fillStyle = style === 'enemy' ? pal.redFill : pal.blueFill;
    g.fill();
    g.setLineDash([5, 3]);
    g.strokeStyle = style === 'enemy' ? pal.red : pal.blue;
    g.lineWidth = 1.4;
    g.stroke();
  } else {
    g.setLineDash([2.5, 3]);
    g.strokeStyle = pal.pencil;
    g.lineWidth = 0.9;
    g.stroke();
  }
  g.restore();
}

function stampStar(g: Ctx, x: number, y: number, r: number, filled: boolean, pal: Palette) {
  starPath(g, x, y, r, 0.42);
  if (filled) {
    g.fillStyle = pal.star;
    g.fill();
  } else {
    g.strokeStyle = pal.inkFaint;
    g.lineWidth = 0.9;
    g.stroke();
  }
}

/** Whether a node's label goes above its symbol: the upper row of the zigzag, on a wide map. */
function labelAbove(order: number, w: number, h: number): boolean {
  return !portrait(w, h) && routeStep(order).k % 2 === 1;
}

/** Where the front stands, in map-space east: just past the furthest mission won in this act. */
function frontOf(sorted: CampaignMapNode[], act: 0 | 1, tall: boolean): number {
  let furthest = 0;
  for (const n of sorted) if (n.state === 'won') furthest = Math.max(furthest, n.order);
  const lastOrder = sorted.length ? sorted[sorted.length - 1].order : ACTS[act].first + ACTS[act].length - 1;
  if (furthest < ACTS[act].first) furthest = 0;
  if (furthest >= lastOrder) return 1.08;
  if (furthest === 0) return tall ? 0.065 : 0.045;
  return (mapFx(furthest, tall) + mapFx(furthest + 1, tall)) / 2;
}

function paintSituation(w: number, h: number, res: number, act: 0 | 1, scheme: MapScheme, compact: boolean, sorted: CampaignMapNode[]): HTMLCanvasElement {
  const sig = sorted.map(n => `${n.order}${n.state[0]}${n.stars}/${n.maxStars ?? 3}:${n.title}`).join(',');
  const key = `${w}x${h}@${res}#${act}${scheme}${compact ? 'c' : ''}${fontsLoaded ? 'f' : ''}|${sig}`;
  const hit = situationCache.get(key);
  if (hit) return hit;
  if (situationCache.size > 4) situationCache.clear();
  const [c, g] = newCanvas(w, h, res);
  const pal = PALETTES[scheme];
  g.drawImage(paintSheet(w, h, res, act, scheme, compact), 0, 0, w, h);
  const P = (fx: number, fy: number) => toScreen(fx, fy, w, h);
  const unit = Math.min(w, h);
  const k = unit / 450;
  const tall = portrait(w, h);
  const m = marginOf(w, h);
  const land = landPoints(w, h, act);
  const frontFx = frontOf(sorted, act, tall);
  const frontAt = (fy: number) => frontFx + (noise1(fy * 7, 41) - 0.5) * 0.05;

  g.save();
  g.beginPath();
  g.rect(m, m, w - m * 2, h - m * 2);
  g.clip();

  // The ground each side holds: a blue wash behind the front, red hatching ahead of it.
  const sidePath = (west: boolean) => {
    g.beginPath();
    const edgeFx = west ? -0.1 : 1.1;
    let [x, y] = P(edgeFx, -0.1);
    g.moveTo(x, y);
    for (let i = 0; i <= 60; i++) {
      const fy = -0.1 + (i / 60) * 1.2;
      [x, y] = P(frontAt(fy), fy);
      g.lineTo(x, y);
    }
    [x, y] = P(edgeFx, 1.1);
    g.lineTo(x, y);
    g.closePath();
  };
  g.save();
  polyPath(g, land);
  g.clip();
  g.fillStyle = pal.blueWash;
  sidePath(true);
  g.fill();
  if (frontFx < 1.05) {
    g.save();
    sidePath(false);
    g.clip();
    g.strokeStyle = pal.redHatch;
    g.lineWidth = 0.8;
    g.beginPath();
    const gap = Math.max(6, 8 * k);
    for (let d = -h; d < w + h; d += gap) {
      g.moveTo(d, 0);
      g.lineTo(d - h, h);
    }
    g.stroke();
    g.restore();

    // The front: a heavy inked line with blue teeth facing the enemy, and the enemy's own forward
    // line pencilled in red just beyond it.
    const pts: [number, number][] = [];
    for (let i = 0; i <= 80; i++) {
      const fy = -0.05 + (i / 80) * 1.1;
      pts.push(P(frontAt(fy), fy));
    }
    const [ex, ey] = tall ? [0, -1] : [1, 0];
    const off = 7 * Math.max(0.8, k);
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x + ex * off, y + ey * off) : g.moveTo(x + ex * off, y + ey * off)));
    g.setLineDash([6, 4]);
    g.strokeStyle = pal.red;
    g.lineWidth = 1.2;
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = pal.ink;
    g.lineWidth = 3.2 * Math.max(0.8, k);
    g.lineJoin = 'round';
    g.stroke();
    g.fillStyle = pal.blue;
    const spacing = Math.max(13, 17 * k);
    const tooth = Math.max(3.5, 4.6 * k);
    let acc = spacing / 2;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      while (acc < seg) {
        const q = acc / seg;
        const x = x0 + (x1 - x0) * q;
        const y = y0 + (y1 - y0) * q;
        const tx = (x1 - x0) / seg;
        const ty = (y1 - y0) / seg;
        g.beginPath();
        g.moveTo(x - tx * tooth, y - ty * tooth);
        g.lineTo(x + tx * tooth, y + ty * tooth);
        g.lineTo(x + ex * tooth * 1.5, y + ey * tooth * 1.5);
        g.closePath();
        g.fill();
        acc += spacing;
      }
      acc -= seg;
    }
  }
  g.restore(); // land clip

  // Arrows of advance between the objectives, and an enemy counter-thrust on the next one.
  const R = campaignNodeRadius(w, h);
  const aw = Math.max(7, Math.min(14, R * 0.62));
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const pa = campaignNodePosition(a.order, w, h);
    const pb = campaignNodePosition(b.order, w, h);
    const style: ArrowStyle = b.state === 'won' ? 'won' : b.state === 'open' ? 'planned' : 'pencil';
    advanceArrow(g, pa, pb, 0.16, R + 4, R + 5, style === 'pencil' ? aw * 0.7 : aw, style, pal);
  }
  const open = sorted.find(n => n.state === 'open');
  if (open) {
    const po = campaignNodePosition(open.order, w, h);
    // From the enemy's side, on the flank away from the objective's label.
    const out = labelAbove(open.order, w, h) ? 1 : -1;
    const from = tall ? { x: po.x + w * 0.2, y: po.y - h * 0.11 } : { x: po.x + w * 0.12, y: po.y + out * h * 0.05 };
    advanceArrow(g, from, po, -0.2 * out, 0, R + 6, aw * 0.75, 'enemy', pal);
  }

  // The objectives.
  const label = Math.max(9, Math.min(13.5, unit * 0.029));
  for (const n of sorted) {
    const { x, y } = campaignNodePosition(n.order, w, h);
    const r = R;
    const ink = n.state === 'won' ? pal.blue : n.state === 'open' ? pal.red : pal.pencil;
    // A paper ground so the arrows do not run through the lettering.
    g.fillStyle = n.state === 'won' ? pal.blueFill : n.state === 'open' ? pal.redFill : 'rgba(0,0,0,0)';
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.save();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = pal.halo;
    g.globalAlpha = n.state === 'locked' ? 0.55 : 0.8;
    g.fill();
    g.restore();
    g.fill();
    g.save();
    if (n.state === 'locked') g.setLineDash([3, 2.5]);
    g.strokeStyle = ink;
    g.lineWidth = n.state === 'locked' ? 1.1 : 2.2;
    g.stroke();
    g.restore();
    if (n.state === 'open') {
      g.strokeStyle = ink;
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(x, y, r - 3.2, 0, TAU);
      g.stroke();
    }
    letter(g, 'OBJ', x, y - r * 0.3, { size: Math.max(6.5, r * 0.36), colour: ink, weight: 700, spacing: 0.6 });
    letter(g, String(n.order), x, y + r * 0.24, { size: Math.max(9, r * 0.66), colour: ink, weight: 700, style: n.state === 'locked' ? 'italic' : 'roman' });
    if (n.state === 'won') {
      // Captured: a blue pennant planted on the objective's rim.
      const fx = x + r * 0.62;
      const fy = y - r * 0.62;
      g.strokeStyle = pal.blue;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(fx, fy + 2);
      g.lineTo(fx, fy - r * 0.95);
      g.stroke();
      g.fillStyle = pal.blue;
      g.beginPath();
      g.moveTo(fx, fy - r * 0.95);
      g.lineTo(fx + r * 0.7, fy - r * 0.72);
      g.lineTo(fx, fy - r * 0.48);
      g.closePath();
      g.fill();
    }
    // The name, and the stars won, on the side away from the route.
    const up = labelAbove(n.order, w, h);
    const dir = up ? -1 : 1;
    let cursor = y + dir * (r + 3);
    if (n.state === 'won') {
      const max = Math.max(n.stars, n.maxStars ?? 3);
      const sr = Math.max(3.4, label * 0.36);
      cursor += dir * (sr + 1);
      for (let s = 0; s < max; s++) stampStar(g, x + (s - (max - 1) / 2) * sr * 2.4, cursor, sr, s < n.stars, pal);
      cursor += dir * (sr + 2);
    }
    cursor += dir * (label * 0.62);
    const style = n.state === 'locked' ? 'italic' : 'caps';
    const weight = n.state === 'open' ? 700 : 600;
    const spacing = n.state === 'locked' ? 0.2 : 0.8;
    // Kept inside the neatline: the first and last objectives sit close to the sheet's edges.
    const half = measure(g, n.title, label, style, weight, spacing) / 2 + 3;
    const lx = Math.max(m + half, Math.min(w - m - half, x));
    letter(g, n.title, lx, cursor, { size: label, colour: n.state === 'locked' ? pal.pencil : pal.ink, halo: pal.halo, style, weight, spacing });
  }
  g.restore(); // neatline clip

  furniture(g, w, h, act, pal, compact, sorted);
  creases(g, w, h, pal);
  situationCache.set(key, c);
  return c;
}

/** Cartouche, classification, legend, scale and north arrow. */
function furniture(g: Ctx, w: number, h: number, act: 0 | 1, pal: Palette, compact: boolean, sorted: CampaignMapNode[]) {
  const m = marginOf(w, h);
  const unit = Math.min(w, h);
  const k = Math.max(0.62, Math.min(1.15, unit / 450));
  const theatre = CAMPAIGN_THEATRES[act];
  const won = sorted.filter(n => n.state === 'won').length;
  const pad = 7 * k;

  const box = (x: number, y: number, bw: number, bh: number) => {
    g.fillStyle = pal.box;
    g.fillRect(x, y, bw, bh);
    g.strokeStyle = pal.ink;
    g.lineWidth = 1.4;
    g.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    g.lineWidth = 0.6;
    g.strokeRect(x + 3, y + 3, bw - 6, bh - 6);
  };

  // Title cartouche, top left.
  {
    const titleSize = (compact ? 12.5 : 16) * k;
    const smallSize = Math.max(7, (compact ? 7.5 : 8.5) * k);
    const title = theatre.place.toUpperCase();
    const head = compact ? `Theatre of operations, ${theatre.act}` : `Meridian Corps · Theatre of operations, ${theatre.act}`;
    const foot = `${theatre.sheet} · ${won} of ${sorted.length} objectives taken`;
    const tw = Math.max(
      measure(g, title, titleSize, 'roman', 700, 2.5 * k),
      measure(g, head, smallSize, 'caps', 600, 1),
      compact ? 0 : measure(g, foot, smallSize, 'italic'),
    );
    const bw = tw + pad * 2 + 8;
    const bh = (compact ? smallSize * 1.5 + titleSize * 1.25 : smallSize * 3 + titleSize * 1.35) + pad * 1.6;
    const x = m + 6 * k;
    const y = m + 6 * k;
    box(x, y, bw, bh);
    let cy = y + pad * 0.9 + smallSize * 0.7;
    letter(g, head, x + bw / 2, cy, { size: smallSize, colour: pal.inkSoft, style: 'caps', weight: 600, spacing: 1 });
    cy += smallSize * 0.7 + titleSize * 0.68;
    letter(g, title, x + bw / 2, cy, { size: titleSize, colour: pal.ink, weight: 700, spacing: 2.5 * k });
    if (!compact) {
      cy += titleSize * 0.62 + 2;
      g.strokeStyle = pal.inkFaint;
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(x + bw * 0.25, cy);
      g.lineTo(x + bw * 0.75, cy);
      g.stroke();
      cy += smallSize * 0.95;
      letter(g, foot, x + bw / 2, cy, { size: smallSize, colour: pal.inkSoft, style: 'italic' });
    }
  }

  // Classification stamp, top right, set down a little crooked.
  {
    const size = (compact ? 10 : 13) * k;
    const text = 'SECRET';
    const tw = measure(g, text, size, 'roman', 800, 3 * k);
    const bw = tw + 14 * k;
    // A little more air on a small map, where the inner rule otherwise crowds the letters.
    const bh = size * (compact ? 2 : 1.7);
    g.save();
    g.translate(w - m - bw / 2 - 10 * k, m + bh / 2 + 8 * k);
    g.rotate(-0.06);
    // Clear the paper under the stamp first: on a narrow map it lands on a hill's contours and
    // spot height, and ink over ink read as a smudge.
    const clear = 4 * k;
    const below = compact ? 0 : size * 0.85;
    g.fillStyle = pal.halo;
    g.fillRect(-bw / 2 - clear, -bh / 2 - clear, bw + clear * 2, bh + clear * 2 + below);
    g.strokeStyle = pal.stamp;
    g.lineWidth = 2;
    g.strokeRect(-bw / 2, -bh / 2, bw, bh);
    g.lineWidth = 0.8;
    g.strokeRect(-bw / 2 + 3, -bh / 2 + 3, bw - 6, bh - 6);
    letter(g, text, 0, 0.5, { size, colour: pal.stamp, weight: 800, spacing: 3 * k });
    if (!compact) letter(g, 'COPY No. 4 OF 9', 0, bh / 2 + size * 0.55, { size: size * 0.48, colour: pal.stamp, weight: 700, spacing: 1 });
    // Worn ink: flecks of paper showing through.
    g.globalCompositeOperation = 'destination-out';
    // Fewer on a small stamp: at 40 the letters of a phone-sized one read as hollow.
    for (let i = 0, flecks = compact ? 10 : 40; i < flecks; i++) {
      g.fillStyle = `rgba(0,0,0,${0.25 + hash(i + 77) * 0.5})`;
      g.fillRect((hash(i * 2 + 60) - 0.5) * bw, (hash(i * 2 + 61) - 0.5) * bh, 1.2, 1.2);
    }
    g.restore();
  }

  // Scale bar and north arrow, bottom right.
  const bottom = h - m - 8 * k;
  let scaleLeft = w - m;
  {
    const seg = Math.max(14, 22 * k);
    const n = compact ? 3 : 4;
    const bh = Math.max(3, 4 * k);
    const north = Math.max(16, 26 * k);
    const x1 = w - m - 12 * k - north * 0.9;
    const x0 = x1 - seg * n;
    scaleLeft = x0 - seg * 0.6;
    const y = bottom - bh - 2;
    // A paper ground for legibility over the sea's ripples.
    g.fillStyle = pal.box;
    g.globalAlpha = 0.85;
    const ts = Math.max(7, 8.5 * k);
    g.fillRect(x0 - seg * 0.4, y - ts * 2.6, seg * n + seg * 0.8, ts * 2.6 + bh + 6);
    g.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? pal.box : pal.ink;
      g.fillRect(x0 + i * seg, y, seg, bh);
    }
    g.strokeStyle = pal.ink;
    g.lineWidth = 0.8;
    g.strokeRect(x0, y, seg * n, bh);
    for (let i = 0; i <= n; i++) letter(g, i === n ? `${i * 5} km` : String(i * 5), x0 + i * seg + (i === n ? 6 * k : 0), y - ts * 0.75, { size: ts, colour: pal.ink, align: i === n ? 'left' : 'center' });
    if (!compact) letter(g, 'Scale 1 : 250 000', x0 + (seg * n) / 2, y - ts * 1.95, { size: ts * 0.95, colour: pal.inkSoft, style: 'italic' });

    // North arrow: a long split point, one half inked and one left as paper, with N above.
    const tall = portrait(w, h);
    const cx = w - m - 10 * k - north * 0.35;
    const cy = bottom - north * 0.75;
    g.save();
    g.translate(cx, cy);
    if (tall) g.rotate(Math.PI / 2);
    const L = north * 0.85;
    const W = north * 0.2;
    g.fillStyle = pal.box;
    g.beginPath();
    g.ellipse(0, -L * 0.12, W * 2.3, L * 0.95, 0, 0, TAU);
    g.globalAlpha = 0.85;
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.moveTo(0, -L);
    g.lineTo(W, L * 0.45);
    g.lineTo(0, L * 0.22);
    g.closePath();
    g.fillStyle = pal.box;
    g.fill();
    g.strokeStyle = pal.ink;
    g.lineWidth = 0.9;
    g.stroke();
    g.beginPath();
    g.moveTo(0, -L);
    g.lineTo(-W, L * 0.45);
    g.lineTo(0, L * 0.22);
    g.closePath();
    g.fillStyle = pal.ink;
    g.fill();
    g.stroke();
    letter(g, 'N', 0, -L - Math.max(6, 8 * k), { size: Math.max(9, 12 * k), colour: pal.ink, weight: 700 });
    g.restore();
  }

  // Legend, bottom left: what the marks mean.
  if (!compact) {
    const ts = Math.max(7.5, 9 * k);
    const sw = 26 * k;
    const rowH = ts * 1.7;
    const items: { text: string; draw: (x: number, y: number) => void }[] = [
      {
        text: 'Advance, completed',
        draw: (x, y) => advanceArrow(g, { x, y: y + 2 }, { x: x + sw, y: y - 1 }, 0.15, 0, 0, 7 * k, 'won', pal),
      },
      {
        text: 'Advance, planned',
        draw: (x, y) => advanceArrow(g, { x, y: y + 2 }, { x: x + sw, y: y - 1 }, 0.15, 0, 0, 7 * k, 'planned', pal),
      },
      {
        text: 'Enemy movement',
        draw: (x, y) => advanceArrow(g, { x: x + sw, y: y + 2 }, { x, y: y - 1 }, -0.15, 0, 0, 7 * k, 'enemy', pal),
      },
      {
        text: 'Front line',
        draw: (x, y) => {
          g.strokeStyle = pal.ink;
          g.lineWidth = 2.6 * k;
          g.beginPath();
          g.moveTo(x + sw * 0.4, y - rowH * 0.42);
          g.lineTo(x + sw * 0.4, y + rowH * 0.42);
          g.stroke();
          g.fillStyle = pal.blue;
          for (const dy of [-0.2, 0.2]) {
            g.beginPath();
            g.moveTo(x + sw * 0.4, y + dy * rowH - 3 * k);
            g.lineTo(x + sw * 0.4, y + dy * rowH + 3 * k);
            g.lineTo(x + sw * 0.4 + 5 * k, y + dy * rowH);
            g.closePath();
            g.fill();
          }
        },
      },
      {
        text: 'Objective, next',
        draw: (x, y) => {
          g.strokeStyle = pal.red;
          g.lineWidth = 1.6;
          g.beginPath();
          g.arc(x + sw / 2, y, ts * 0.62, 0, TAU);
          g.stroke();
        },
      },
      {
        text: 'Objective, intelligence only',
        draw: (x, y) => {
          g.save();
          g.setLineDash([2.5, 2]);
          g.strokeStyle = pal.pencil;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(x + sw / 2, y, ts * 0.62, 0, TAU);
          g.stroke();
          g.restore();
        },
      },
    ];
    const colW = Math.max(...items.map(it => measure(g, it.text, ts, 'roman'))) + sw + 12 * k;
    const head = ts * 1.9;
    const bw = colW * 2 + pad * 2;
    const bh = head + rowH * 3 + pad * 0.8;
    const x = m + 6 * k;
    const y = h - m - 6 * k - bh;
    // Only where it fits clear of the scale bar.
    if (x + bw < scaleLeft - 8) {
      box(x, y, bw, bh);
      letter(g, 'REFERENCE', x + bw / 2, y + pad * 0.6 + ts * 0.7, { size: ts, colour: pal.ink, weight: 700, spacing: 3 });
      items.forEach((it, i) => {
        const col = Math.floor(i / 3);
        const row = i % 3;
        const ix = x + pad + col * colW;
        const iy = y + head + row * rowH + rowH * 0.5;
        it.draw(ix, iy);
        letter(g, it.text, ix + sw + 6 * k, iy, { size: ts, colour: pal.ink, align: 'left' });
      });
    }
  }
}

/** The sheet was folded in four for the map case: a crease down the middle and one across. */
function creases(g: Ctx, w: number, h: number, pal: Palette) {
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    const nx = -dy / l;
    const ny = dx / l;
    for (const [o, colour, lw] of [
      [-1, pal.creaseDark, 1.2],
      [0.6, pal.creaseLight, 1],
    ] as const) {
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.08, colour);
      grad.addColorStop(0.92, colour);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.strokeStyle = grad;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x0 + nx * o, y0 + ny * o);
      for (let i = 1; i <= 12; i++) {
        const q = i / 12;
        const wob = (noise1(q * 6, Math.round(x0 + y0)) - 0.5) * 1.2;
        g.lineTo(x0 + dx * q + nx * (o + wob), y0 + dy * q + ny * (o + wob));
      }
      g.stroke();
    }
    // A soft shadow band either side of the fold.
    const band = 10;
    const shade = g.createLinearGradient(x0 - nx * band, y0 - ny * band, x0 + nx * band, y0 + ny * band);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(0.5, pal.creaseDark);
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.globalAlpha = 0.35;
    g.fillStyle = shade;
    g.beginPath();
    g.moveTo(x0 - nx * band, y0 - ny * band);
    g.lineTo(x1 - nx * band, y1 - ny * band);
    g.lineTo(x1 + nx * band, y1 + ny * band);
    g.lineTo(x0 + nx * band, y0 + ny * band);
    g.closePath();
    g.fill();
    g.restore();
  };
  line(w * 0.5, 0, w * 0.5 + 1.5, h);
  line(0, h * 0.5, w, h * 0.5 - 1);
}

/**
 * The campaign's theatre map, drawn as a staff officer's operational map: aged paper folded in
 * four, a kilometre grid, contours, hatched woods and water-lined coasts, the front with its teeth
 * (it moves east with each mission won), arrows of advance between the objectives, a cartouche,
 * legend, scale, north arrow and a classification stamp.
 *
 * Draws into (0, 0)-(w, h) in the context's current units. Everything but the next objective's
 * pulse and the hover and selection rings is painted once and kept, so calling this every frame
 * costs one image draw. `t` (seconds) drives the pulse; leave it out for a still.
 *
 * A preview (the lobby's card, say) can call it at any size with the act's nodes; below 640 px wide
 * the sheet drops its legend and shortens its cartouche.
 */
export function drawCampaignMap(ctx: Ctx, w: number, h: number, nodes: CampaignMapNode[], t = 0, opts: CampaignMapOptions = {}): void {
  if (w <= 0 || h <= 0) return;
  void mapFontsReady();
  const m = ctx.getTransform();
  const res = Math.max(1, Math.min(3, Math.hypot(m.a, m.b)));
  const scheme = opts.scheme ?? pageScheme();
  const compact = opts.compact ?? w < 640;
  const motion = opts.motion ?? true;
  const pal = PALETTES[scheme];
  const sorted = [...nodes].sort((a, b) => a.order - b.order);
  const act = campaignActOf(sorted.length ? sorted[0].order : 1);
  ctx.save();
  ctx.drawImage(paintSituation(w, h, res, act, scheme, compact, sorted), 0, 0, w, h);

  const R = campaignNodeRadius(w, h);
  for (const n of sorted) {
    const { x, y } = campaignNodePosition(n.order, w, h);
    if (n.state === 'open') {
      if (motion) {
        // Two soft rings spreading from the next objective, out of step.
        for (const off of [0, 0.5]) {
          const q = (t / 2.4 + off) % 1;
          ctx.strokeStyle = `rgba(${pal.pulse},${0.55 * (1 - q) * (1 - q)})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(x, y, R + 2 + q * R * 0.95, 0, TAU);
          ctx.stroke();
        }
      } else {
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = `rgba(${pal.pulse},0.6)`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, R + 6, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (n.selected) {
      // A highlighter ring, as if marked up for the briefing.
      ctx.strokeStyle = pal.highlight;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(x, y, R + 5, 0, TAU);
      ctx.stroke();
    } else if (n.hover && n.state !== 'locked') {
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, R + 4, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}


// ---- Rank insignia -----------------------------------------------------------------------------

/** An original stylised leaf: a pointed blade with lobes and a midrib. */
function leaf(ctx: Ctx, x: number, y: number, s: number, colour: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -s);
  for (let i = 0; i < 4; i++) {
    const yy = -s + (i + 1) * s * 0.42;
    ctx.quadraticCurveTo(s * (0.62 - i * 0.04), yy - s * 0.3, s * (0.32 - i * 0.02), yy);
  }
  ctx.lineTo(s * 0.08, s * 0.75);
  ctx.lineTo(s * 0.06, s);
  ctx.lineTo(-s * 0.06, s);
  ctx.lineTo(-s * 0.08, s * 0.75);
  for (let i = 3; i >= 0; i--) {
    const yy = -s + (i + 1) * s * 0.42;
    ctx.lineTo(-s * (0.32 - i * 0.02), yy);
    ctx.quadraticCurveTo(-s * (0.62 - i * 0.04), yy - s * 0.3, 0, -s + i * s * 0.42);
  }
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,45,5,0.8)';
  ctx.lineWidth = s * 0.06;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.8);
  ctx.lineTo(0, s * 0.8);
  ctx.stroke();
  ctx.restore();
}

/** An original winged emblem: a shield between two swept wings, a star above. */
function wings(ctx: Ctx, x: number, y: number, s: number, colour: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = colour;
  ctx.strokeStyle = 'rgba(40,44,50,0.85)';
  ctx.lineWidth = s * 0.05;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * s * 0.18, -s * 0.1);
    ctx.quadraticCurveTo(dir * s * 0.7, -s * 0.6, dir * s * 1.25, -s * 0.5);
    for (let k = 0; k < 4; k++) {
      const fx = 1.25 - k * 0.24;
      ctx.lineTo(dir * s * (fx - 0.06), -s * (0.32 - k * 0.12));
      ctx.lineTo(dir * s * (fx - 0.2), -s * (0.36 - k * 0.12) + s * 0.04);
    }
    ctx.quadraticCurveTo(dir * s * 0.4, s * 0.25, dir * s * 0.18, s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Shield.
  ctx.beginPath();
  ctx.moveTo(-s * 0.26, -s * 0.36);
  ctx.lineTo(s * 0.26, -s * 0.36);
  ctx.lineTo(s * 0.26, s * 0.1);
  ctx.quadraticCurveTo(s * 0.2, s * 0.42, 0, s * 0.55);
  ctx.quadraticCurveTo(-s * 0.2, s * 0.42, -s * 0.26, s * 0.1);
  ctx.closePath();
  ctx.fillStyle = TEAM[0].main;
  ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = s * 0.08;
  ctx.stroke();
  starPath(ctx, 0, -s * 0.66, s * 0.2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.restore();
}

/** Six ranks' names, lowest first; matches the campaign's rank table. For labels only. */
export const RANK_INSIGNIA_NAMES = ['Lieutenant', 'Captain', 'Major', 'Colonel', 'Brigadier', 'General'];

/**
 * A rank's insignia on a shoulder board: Lieutenant one bar, Captain two, Major a gold leaf,
 * Colonel a silver winged shield, Brigadier one star, General three. (x, y) is the top left of a
 * size-by-size box; the board fills its width and sits in the middle.
 */
export function drawRankInsignia(ctx: Ctx, rankIndex: number, x: number, y: number, size: number): void {
  const r = Math.max(0, Math.min(5, Math.floor(rankIndex)));
  const s = size;
  ctx.save();
  ctx.translate(x, y);
  // The board: dark cloth, a rounded button end, gold piping.
  const bw = s * 0.96;
  const bh = s * 0.6;
  const bx = (s - bw) / 2;
  const by = (s - bh) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, bx + s * 0.02, by + s * 0.03, bw, bh, bh * 0.22);
  ctx.fill();
  const cloth = ctx.createLinearGradient(0, by, 0, by + bh);
  cloth.addColorStop(0, '#2f3c4c');
  cloth.addColorStop(1, '#1b2430');
  ctx.fillStyle = cloth;
  roundRect(ctx, bx, by, bw, bh, bh * 0.22);
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(1, s * 0.03);
  roundRect(ctx, bx + s * 0.03, by + s * 0.03, bw - s * 0.06, bh - s * 0.06, bh * 0.18);
  ctx.stroke();
  // Button at the collar end.
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(bx + bw - s * 0.1, s / 2, s * 0.05, 0, TAU);
  ctx.fill();
  const cx = s * 0.45;
  const cy = s / 2;
  const metal = (light: string, dark: string, x0: number, y0: number, x1: number, y1: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, light);
    g.addColorStop(1, dark);
    return g;
  };
  if (r <= 1) {
    const n = r + 1;
    const barW = s * 0.1;
    const barH = bh * 0.62;
    for (let i = 0; i < n; i++) {
      const x0 = cx - ((n - 1) * barW * 1.6) / 2 + i * barW * 1.6 - barW / 2;
      ctx.fillStyle = metal('#fbe6a2', '#b8892a', x0, cy - barH / 2, x0 + barW, cy + barH / 2);
      roundRect(ctx, x0, cy - barH / 2, barW, barH, barW * 0.2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,50,5,0.8)';
      ctx.lineWidth = Math.max(0.8, s * 0.015);
      ctx.stroke();
    }
  } else if (r === 2) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0.75);
    leaf(ctx, 0, 0, bh * 0.4, GOLD);
    ctx.restore();
  } else if (r === 3) {
    wings(ctx, cx, cy + bh * 0.04, bh * 0.42, SILVER);
  } else {
    const n = r === 4 ? 1 : 3;
    const sr = r === 4 ? bh * 0.32 : bh * 0.19;
    for (let i = 0; i < n; i++) {
      const sx = cx - (n > 1 ? s * 0.03 : 0) + (i - (n - 1) / 2) * sr * 2.15;
      starPath(ctx, sx, cy, sr);
      ctx.fillStyle = metal('#ffffff', '#a9b0b8', sx - sr, cy - sr, sx + sr, cy + sr);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,34,40,0.85)';
      ctx.lineWidth = Math.max(0.8, s * 0.015);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.arcTo(x + w, y, x + w, y + h, q);
  ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q);
  ctx.arcTo(x, y, x + w, y, q);
  ctx.closePath();
}

// ---- Hero portraits ----------------------------------------------------------------------------

const PORTRAIT: Record<HeroKind, { bg: [string, string]; skin: string; skinShade: string }> = {
  spy: { bg: ['#36465a', '#141c26'], skin: '#dcb391', skinShade: '#b48868' },
  commando: { bg: ['#4d5a36', '#1d2414'], skin: '#a97a58', skinShade: '#83593d' },
  engineer: { bg: ['#7a5a2a', '#2c1e0c'], skin: '#c99068', skinShade: '#a06c4a' },
  ace: { bg: ['#355a5e', '#11252a'], skin: '#e4bb98', skinShade: '#bf9472' },
};

/**
 * A head-and-shoulders portrait of a hero on a coloured card, with the gold hero star and five
 * level pips; a bandage and a red cross tag when wounded. (x, y) is the top left of a size-by-size
 * square. Drawn in a 100-unit box and scaled, so it is crisp at any size from 32 px up.
 */
export function drawHeroPortrait(ctx: Ctx, hero: HeroKind, level: number, x: number, y: number, size: number, wounded: boolean): void {
  const look = PORTRAIT[hero];
  const team = TEAM[0];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  // Card.
  roundRect(ctx, 0, 0, 100, 100, 10);
  ctx.save();
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, 0, 100);
  bg.addColorStop(0, look.bg[0]);
  bg.addColorStop(1, look.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 100, 100);
  // A soft light behind the head.
  const halo = ctx.createRadialGradient(50, 40, 4, 50, 40, 52);
  halo.addColorStop(0, 'rgba(255,240,210,0.28)');
  halo.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 100, 100);
  // Diagonal hatching for texture.
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -100; i < 100; i += 6) {
    ctx.moveTo(i, 100);
    ctx.lineTo(i + 100, 0);
  }
  ctx.stroke();

  const ink = 'rgba(25,18,12,0.85)';
  // Shoulders and body, by hero.
  const body = (fill: string | CanvasGradient) => {
    ctx.beginPath();
    ctx.moveTo(8, 104);
    ctx.quadraticCurveTo(10, 74, 32, 70);
    ctx.lineTo(68, 70);
    ctx.quadraticCurveTo(90, 74, 92, 104);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  const neck = () => {
    ctx.fillStyle = look.skinShade;
    ctx.fillRect(42, 56, 16, 18);
  };
  const head = () => {
    ctx.beginPath();
    ctx.ellipse(50, 44, 15.5, 19, 0, 0, TAU);
    ctx.fillStyle = look.skin;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Ears.
    ctx.fillStyle = look.skinShade;
    ctx.beginPath();
    ctx.ellipse(34.5, 46, 2.6, 4.5, 0, 0, TAU);
    ctx.ellipse(65.5, 46, 2.6, 4.5, 0, 0, TAU);
    ctx.fill();
  };
  const face = (o: { brows?: number; smile?: number; shadow?: boolean }) => {
    // Shading down the right cheek.
    ctx.fillStyle = 'rgba(80,40,20,0.18)';
    ctx.beginPath();
    ctx.ellipse(56, 47, 8, 15, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    ctx.fillStyle = '#20160f';
    ctx.beginPath();
    ctx.ellipse(44, 44, 2, 1.6, 0, 0, TAU);
    ctx.ellipse(56, 44, 2, 1.6, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#2a1c12';
    ctx.lineWidth = 1.8;
    const b = o.brows ?? 0;
    ctx.beginPath();
    ctx.moveTo(40, 39.5 - b);
    ctx.lineTo(47, 39 + b);
    ctx.moveTo(53, 39 + b);
    ctx.lineTo(60, 39.5 - b);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(60,30,15,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(50, 45);
    ctx.lineTo(48.5, 52);
    ctx.lineTo(51, 52.5);
    ctx.stroke();
    const sm = o.smile ?? 0;
    ctx.strokeStyle = '#5a2a1c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(44.5, 57);
    ctx.quadraticCurveTo(50, 57 + sm * 3, 55.5, 57 - sm * 0.6);
    ctx.stroke();
    if (o.shadow) {
      ctx.fillStyle = 'rgba(10,8,6,0.35)';
      ctx.fillRect(34, 34, 32, 8);
    }
  };

  if (hero === 'spy') {
    // Trench coat with the collar up, a tie, a fedora shading the eyes.
    const coat = ctx.createLinearGradient(0, 70, 0, 100);
    coat.addColorStop(0, '#8d8371');
    coat.addColorStop(1, '#4d463b');
    neck();
    body(coat);
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    ctx.moveTo(42, 70);
    ctx.lineTo(50, 86);
    ctx.lineTo(58, 70);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = team.dark;
    ctx.beginPath();
    ctx.moveTo(48, 72);
    ctx.lineTo(52, 72);
    ctx.lineTo(53, 90);
    ctx.lineTo(50, 94);
    ctx.lineTo(47, 90);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6e6656';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(50 + dir * 8, 62);
      ctx.lineTo(50 + dir * 20, 66);
      ctx.lineTo(50 + dir * 16, 86);
      ctx.lineTo(50 + dir * 6, 72);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    head();
    face({ brows: 0.8, smile: 0.2, shadow: true });
    // A thin moustache.
    ctx.strokeStyle = '#3a2618';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(45, 54.6);
    ctx.quadraticCurveTo(50, 53.2, 55, 54.6);
    ctx.stroke();
    // Fedora: brim, crown with a pinch, team band.
    ctx.fillStyle = '#2b2722';
    ctx.beginPath();
    ctx.ellipse(50, 33, 27, 6, -0.04, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#3c362f';
    ctx.beginPath();
    ctx.moveTo(35, 33);
    ctx.quadraticCurveTo(34, 16, 44, 14);
    ctx.quadraticCurveTo(50, 18, 56, 14);
    ctx.quadraticCurveTo(66, 16, 65, 33);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = team.main;
    ctx.fillRect(35.2, 27, 29.6, 4.5);
  } else if (hero === 'commando') {
    // Olive fatigues, bandolier across the chest, camo paint, a beret at an angle.
    const kit = ctx.createLinearGradient(0, 70, 0, 100);
    kit.addColorStop(0, '#73804f');
    kit.addColorStop(1, '#3b4428');
    neck();
    ctx.beginPath();
    ctx.moveTo(4, 104);
    ctx.quadraticCurveTo(4, 72, 30, 67);
    ctx.lineTo(70, 67);
    ctx.quadraticCurveTo(96, 72, 96, 104);
    ctx.closePath();
    ctx.fillStyle = kit;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = '#3d2b19';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(22, 72);
    ctx.lineTo(74, 104);
    ctx.stroke();
    ctx.fillStyle = '#e0b04a';
    for (let i = 0; i < 6; i++) ctx.fillRect(26 + i * 8, 72.5 + i * 4.9, 3, 5);
    ctx.fillStyle = team.main;
    ctx.fillRect(78, 78, 9, 6);
    head();
    // Square jaw.
    ctx.fillStyle = look.skin;
    ctx.fillRect(38, 50, 24, 10);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(36, 52);
    ctx.lineTo(39, 61);
    ctx.lineTo(61, 61);
    ctx.lineTo(64, 52);
    ctx.stroke();
    ctx.fillStyle = 'rgba(40,30,20,0.25)';
    ctx.fillRect(39, 53, 22, 7.5);
    face({ brows: -0.8, smile: -0.3 });
    // Camo stripes under the eyes.
    ctx.fillStyle = 'rgba(40,52,26,0.75)';
    ctx.fillRect(38, 47, 8, 2.2);
    ctx.fillRect(54, 47, 8, 2.2);
    // A scar through one brow.
    ctx.strokeStyle = '#d9a088';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(57, 35);
    ctx.lineTo(60, 43);
    ctx.stroke();
    // Beret: slumped to one side, cap badge in gold.
    ctx.fillStyle = team.dark;
    ctx.beginPath();
    ctx.ellipse(46, 28, 20, 9, -0.25, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.fillRect(34, 31, 32, 3);
    ctx.fillStyle = GOLD;
    starPath(ctx, 58, 29, 3.6);
    ctx.fill();
  } else if (hero === 'engineer') {
    // Hi-vis vest with reflective stripes over team-colour overalls, a hard hat with goggles.
    neck();
    body(team.main);
    const vest = ctx.createLinearGradient(0, 70, 0, 100);
    vest.addColorStop(0, '#ffc43a');
    vest.addColorStop(1, '#d77d10');
    ctx.fillStyle = vest;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(50 + dir * 7, 70);
      ctx.lineTo(50 + dir * 22, 71);
      ctx.quadraticCurveTo(50 + dir * 38, 78, 50 + dir * 40, 104);
      ctx.lineTo(50 + dir * 9, 104);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.fillStyle = '#eef3f4';
    ctx.fillRect(12, 88, 28, 4);
    ctx.fillRect(60, 88, 28, 4);
    ctx.fillRect(14, 80, 26, 3);
    ctx.fillRect(60, 80, 26, 3);
    // A pencil in the vest pocket.
    ctx.fillStyle = '#f0d040';
    ctx.fillRect(66, 72, 2.2, 10);
    head();
    face({ brows: 0.4, smile: 1 });
    // Hard hat: dome, brim, ridge; goggles on the brim.
    ctx.fillStyle = '#e8b51f';
    ctx.beginPath();
    ctx.ellipse(50, 33, 25, 5, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const dome = ctx.createLinearGradient(36, 12, 64, 32);
    dome.addColorStop(0, '#ffe066');
    dome.addColorStop(1, '#d9a414');
    ctx.fillStyle = dome;
    ctx.beginPath();
    ctx.moveTo(33, 32);
    ctx.quadraticCurveTo(34, 12, 50, 11);
    ctx.quadraticCurveTo(66, 12, 67, 32);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(150,100,0,0.5)';
    ctx.fillRect(48, 12, 4, 20);
    ctx.fillStyle = '#2b3438';
    ctx.fillRect(36, 27, 28, 4);
    ctx.fillStyle = '#9fd6ff';
    ctx.beginPath();
    ctx.ellipse(43, 29, 4.5, 3.4, 0, 0, TAU);
    ctx.ellipse(57, 29, 4.5, 3.4, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#1b2124';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else {
    // Tank crew jacket with a spade patch, a scarf, a padded crew helmet with headset and goggles.
    neck();
    const jacket = ctx.createLinearGradient(0, 70, 0, 100);
    jacket.addColorStop(0, '#6b4a30');
    jacket.addColorStop(1, '#3a2617');
    body(jacket);
    ctx.fillStyle = '#d9d2bf';
    ctx.beginPath();
    ctx.moveTo(36, 66);
    ctx.quadraticCurveTo(50, 76, 64, 66);
    ctx.lineTo(62, 74);
    ctx.quadraticCurveTo(50, 82, 38, 74);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(56, 78);
    ctx.lineTo(62, 96);
    ctx.lineTo(54, 94);
    ctx.closePath();
    ctx.fill();
    // Shoulder patch: a gold spade on team blue.
    ctx.fillStyle = team.main;
    roundRect(ctx, 16, 78, 13, 13, 2);
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    const sx = 22.5;
    const sy = 84.5;
    const s = 4.4;
    ctx.moveTo(sx, sy - s);
    ctx.bezierCurveTo(sx + s * 0.4, sy - s * 0.5, sx + s * 1.05, sy - s * 0.15, sx + s * 0.85, sy + s * 0.35);
    ctx.bezierCurveTo(sx + s * 0.7, sy + s * 0.7, sx + s * 0.25, sy + s * 0.65, sx + s * 0.08, sy + s * 0.35);
    ctx.lineTo(sx + s * 0.3, sy + s);
    ctx.lineTo(sx - s * 0.3, sy + s);
    ctx.lineTo(sx - s * 0.08, sy + s * 0.35);
    ctx.bezierCurveTo(sx - s * 0.25, sy + s * 0.65, sx - s * 0.7, sy + s * 0.7, sx - s * 0.85, sy + s * 0.35);
    ctx.bezierCurveTo(sx - s * 1.05, sy - s * 0.15, sx - s * 0.4, sy - s * 0.5, sx, sy - s);
    ctx.fill();
    head();
    face({ brows: 0.2, smile: 0.9 });
    // Padded crew helmet with ribs, earcups and a mic boom; goggles up on the forehead.
    ctx.fillStyle = '#3a3026';
    ctx.beginPath();
    ctx.moveTo(33, 42);
    ctx.quadraticCurveTo(31, 16, 50, 15);
    ctx.quadraticCurveTo(69, 16, 67, 42);
    ctx.quadraticCurveTo(62, 30, 50, 29);
    ctx.quadraticCurveTo(38, 30, 33, 42);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.moveTo(43, 16.5);
    ctx.quadraticCurveTo(41, 24, 42, 30);
    ctx.moveTo(57, 16.5);
    ctx.quadraticCurveTo(59, 24, 58, 30);
    ctx.stroke();
    ctx.fillStyle = '#26201a';
    ctx.beginPath();
    ctx.ellipse(33.5, 46, 5, 7, 0, 0, TAU);
    ctx.ellipse(66.5, 46, 5, 7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(33, 51);
    ctx.quadraticCurveTo(34, 58, 42, 58);
    ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(43, 58, 1.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#5a4a38';
    ctx.fillRect(36, 24, 28, 4);
    ctx.fillStyle = '#c9e6f2';
    ctx.strokeStyle = '#7a6a50';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(43, 25.5, 5, 4, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(57, 25.5, 5, 4, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(40.5, 23.5, 2, 1.4);
    ctx.fillRect(54.5, 23.5, 2, 1.4);
  }

  if (wounded) {
    // A bandage round the head with blood showing through, and a grey cast over the card.
    ctx.fillStyle = 'rgba(40,40,46,0.28)';
    ctx.fillRect(0, 0, 100, 100);
    ctx.save();
    ctx.translate(50, 38);
    ctx.rotate(-0.18);
    ctx.fillStyle = '#efebe0';
    ctx.fillRect(-19, -3.5, 38, 7);
    ctx.strokeStyle = 'rgba(120,110,90,0.7)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-19, -3.5, 38, 7);
    ctx.beginPath();
    ctx.moveTo(-10, -3.5);
    ctx.lineTo(-7, 3.5);
    ctx.moveTo(4, -3.5);
    ctx.lineTo(7, 3.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(178,40,32,0.85)';
    ctx.beginPath();
    ctx.ellipse(9, 0, 3.4, 2.4, 0.3, 0, TAU);
    ctx.fill();
    ctx.restore();
    // A plaster on the cheek.
    ctx.save();
    ctx.translate(41, 52);
    ctx.rotate(0.6);
    ctx.fillStyle = '#e2c49c';
    ctx.fillRect(-4, -1.6, 8, 3.2);
    ctx.restore();
    // Red cross tag in the corner.
    ctx.fillStyle = '#f4f1ea';
    roundRect(ctx, 76, 6, 18, 18, 3);
    ctx.fill();
    ctx.fillStyle = '#c8302a';
    ctx.fillRect(83, 9, 4, 12);
    ctx.fillRect(79, 13, 12, 4);
  }
  ctx.restore();

  // Frame, hero star and level pips (outside the clip so they sit on the edge cleanly).
  roundRect(ctx, 1, 1, 98, 98, 9.5);
  ctx.strokeStyle = level >= 5 ? GOLD : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  starPath(ctx, 13, 13, 8);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  const lv = Math.max(1, Math.min(5, Math.round(level)));
  ctx.fillStyle = 'rgba(8,10,12,0.72)';
  roundRect(ctx, 26, 86, 48, 10, 5);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const px = 33 + i * 8.5;
    ctx.beginPath();
    ctx.arc(px, 91, 2.8, 0, TAU);
    ctx.fillStyle = i < lv ? GOLD : 'rgba(255,255,255,0.18)';
    ctx.fill();
  }
  ctx.restore();
}
