import type { HeroKind } from '../sim/rules';
import { TEAM } from '../theme';
import {
  THEATRE_ASPECT,
  pointInPolygon,
  theatreGeography,
  theatreRegions,
  type RegionControl,
  type TheatreRegion,
  type TheatreView,
} from '../campaign/theatre';

/**
 * Campaign art, drawn with canvas paths like everything else in Fireline: the theatre map the
 * missions sit on, the Commander's rank insignia and the heroes' portraits. No image files.
 *
 * Everything here is pure drawing: same inputs, same picture (apart from `t`, which only moves the
 * subtle animation). Canvas art may use literal colours; the React chrome around it uses the CSS
 * variables in styles.css.
 */

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
const TAU = Math.PI * 2;
const GOLD = '#f2c44e';
const GOLD_DARK = '#8a6412';
const SILVER = '#d9dde2';
const A = THEATRE_ASPECT;

/**
 * The campaign is in two acts: act one (missions 1 to 8) on the southern coast, act two (9 to 14)
 * in the north. Both are fought over the same country (campaign/theatre.ts); the map shows all of
 * it and turns to face the act in hand.
 */
const ACTS = [
  { first: 1, length: 8 },
  { first: 9, length: 6 },
] as const;

/** Which act (0 or 1) a mission of this order belongs to. */
export function campaignActOf(order: number): 0 | 1 {
  return order >= ACTS[1].first ? 1 : 0;
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1-D value noise, for the creases and the front's red pencil. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i * 131 + seed) * (1 - u) + hash((i + 1) * 131 + seed) * u;
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
// Drawn in layers. The sheet (paper, sea, the country and the lands beyond its frontier, relief,
// woods, rivers, names, grid) depends only on size, the act in view and colour mode. The territory
// (who holds each region, the province borders) depends on control as well. The marks (the front,
// arrows of advance, objectives and engagements, their names, cartouche, legend, scale and stamp)
// depend on the whole view. All three are painted once and kept; only the pulses of what is open,
// the hover and selection rings and a region changing hands are drawn every frame.

/** Light or dark: a sheet on a daylit table, or the same sheet at night under a lamp. */
export type MapScheme = 'light' | 'dark';

export interface CampaignMapOptions {
  /** Defaults to the page's current mode (<html data-theme>). */
  scheme?: MapScheme;
  /** A small sheet (a preview): no legend, a one-line cartouche, fewer names. Defaults to true below 640 px wide. */
  compact?: boolean;
  /** False draws what is open as still rings (reduced motion). Defaults to true. */
  motion?: boolean;
  /** The whole country on the sheet, rather than the act in view. */
  whole?: boolean;
  /** The region under the pointer. */
  hover?: string;
  /**
   * Regions changing hands: drawn as the enemy's, then filled from the border they share with
   * ground already held as `progress` runs 0 to 1, the front moving with the fill.
   */
  capture?: { regions: string[]; progress: number };
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
  sand: string;
  abroad: string;
  frontier: string;
  border: string;
  blue: string;
  blueFill: string;
  heldWash: string;
  heldHatch: string;
  red: string;
  redFill: string;
  redHatch: string;
  contestRed: string;
  contestBlue: string;
  veil: string;
  town: string;
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
    grid: 'rgba(52,98,128,0.2)',
    contour: 'rgba(156,98,46,0.4)',
    contourIndex: 'rgba(146,88,36,0.7)',
    water: 'rgba(160,196,204,0.62)',
    waterLine: 'rgba(36,92,122,0.78)',
    river: '#3a7798',
    wood: 'rgba(160,184,120,0.3)',
    woodHatch: 'rgba(60,92,44,0.62)',
    sand: 'rgba(150,110,60,0.42)',
    abroad: 'rgba(118,100,74,0.13)',
    frontier: 'rgba(120,60,110,0.75)',
    border: 'rgba(42,34,25,0.62)',
    blue: '#1d4c9a',
    blueFill: 'rgba(29,76,154,0.12)',
    heldWash: 'rgba(40,92,176,0.16)',
    heldHatch: 'rgba(29,76,154,0.3)',
    red: '#b0261d',
    redFill: 'rgba(176,38,29,0.08)',
    redHatch: 'rgba(176,38,29,0.3)',
    contestRed: 'rgba(176,38,29,0.17)',
    contestBlue: 'rgba(29,76,154,0.15)',
    veil: 'rgba(235,225,196,0.42)',
    town: 'rgba(42,34,25,0.62)',
    pencil: 'rgba(78,76,70,0.72)',
    star: '#b07d0a',
    box: 'rgba(245,239,220,0.94)',
    stamp: 'rgba(168,34,30,0.7)',
    highlight: 'rgba(242,196,40,0.55)',
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
    grid: 'rgba(150,186,204,0.14)',
    contour: 'rgba(214,162,104,0.32)',
    contourIndex: 'rgba(224,170,110,0.58)',
    water: 'rgba(40,64,72,0.62)',
    waterLine: 'rgba(130,184,200,0.5)',
    river: '#74aac4',
    wood: 'rgba(96,120,72,0.3)',
    woodHatch: 'rgba(160,190,128,0.34)',
    sand: 'rgba(230,190,130,0.3)',
    abroad: 'rgba(0,0,0,0.11)',
    frontier: 'rgba(214,150,206,0.7)',
    border: 'rgba(236,224,194,0.5)',
    blue: '#8cb2f2',
    blueFill: 'rgba(120,160,236,0.16)',
    heldWash: 'rgba(110,150,230,0.15)',
    heldHatch: 'rgba(140,178,242,0.28)',
    red: '#f0806f',
    redFill: 'rgba(240,128,111,0.1)',
    redHatch: 'rgba(240,128,111,0.28)',
    contestRed: 'rgba(240,128,111,0.17)',
    contestBlue: 'rgba(120,160,236,0.15)',
    veil: 'rgba(58,50,37,0.45)',
    town: 'rgba(236,224,194,0.55)',
    pencil: 'rgba(206,200,186,0.62)',
    star: '#e6b84a',
    box: 'rgba(44,37,27,0.94)',
    stamp: 'rgba(236,104,92,0.72)',
    highlight: 'rgba(242,196,60,0.42)',
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
 * and the layers are cached, so the caches are dropped here and the caller draws again.
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
      territoryCache.clear();
      marksCache.clear();
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

function polyPath(g: Ctx, pts: Pt[], close = true) {
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

// ---- Where the country sits on the canvas ------------------------------------------------------

const portrait = (w: number, h: number) => w < h * 0.9;

/**
 * Map space to canvas: one scale both ways (on the ground, an fx unit is THEATRE_ASPECT fy units),
 * fitted so the act in view fills the sheet below the cartouche. On a tall canvas (a phone) the
 * country turns a quarter to the left, east at the top, so a long act gets the long side.
 */
interface Cam {
  s: number;
  ox: number;
  oy: number;
  rot: boolean;
  key: string;
}

const actBoxes = new Map<string, [number, number, number, number]>();

function focusBox(act: 0 | 1, whole: boolean): [number, number, number, number] {
  const key = whole ? 'all' : String(act);
  const hit = actBoxes.get(key);
  if (hit) return hit;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const r of theatreRegions()) {
    if (!whole && r.act !== act) continue;
    for (const [x, y] of r.polygon) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  const box: [number, number, number, number] = [x0 - 0.01, y0 - 0.012, x1 + 0.01, y1 + 0.012];
  actBoxes.set(key, box);
  return box;
}

function cameraFor(w: number, h: number, act: 0 | 1, whole: boolean, compact: boolean): Cam {
  const rot = portrait(w, h);
  const m = marginOf(w, h);
  const k = Math.max(0.62, Math.min(1.15, Math.min(w, h) / 450));
  const [x0, y0, x1, y1] = focusBox(act, whole);
  // Room for the cartouche along the top; the furniture otherwise sits over sea or ground beyond.
  const top = m + (compact ? 22 : 40) * k;
  const bottom = h - m - (compact ? 6 : 12) * k;
  let left = m + 6 * k;
  const right = w - m - 6 * k;
  const bw = rot ? y1 - y0 : (x1 - x0) * A;
  const bh = rot ? (x1 - x0) * A : y1 - y0;
  let s = Math.min((right - left) / bw, (bottom - top) / bh);
  // Where the sheet is wider than the act, the legend gets a column of its own on the left.
  if (!compact && !rot && right - left - legendWidth(k) - 10 >= bw * s) {
    left += legendWidth(k) + 10;
    s = Math.min((right - left) / bw, (bottom - top) / bh);
  }
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const ox = rot ? cx - ((y0 + y1) / 2) * s : cx - ((x0 + x1) / 2) * A * s;
  const oy = rot ? cy - (1 - (x0 + x1) / 2) * A * s : cy - ((y0 + y1) / 2) * s;
  return { s, ox, oy, rot, key: `${w}x${h}${whole ? 'a' : act}${compact ? 'c' : ''}` };
}

/** The legend's width on a sheet of this scale: one column. */
function legendWidth(k: number): number {
  return 172 * k;
}

function toScreen(cam: Cam, fx: number, fy: number): Pt {
  return cam.rot ? [cam.ox + fy * cam.s, cam.oy + (1 - fx) * A * cam.s] : [cam.ox + fx * A * cam.s, cam.oy + fy * cam.s];
}

function fromScreen(cam: Cam, x: number, y: number): Pt {
  return cam.rot ? [1 - (y - cam.oy) / (A * cam.s), (x - cam.ox) / cam.s] : [(x - cam.ox) / (A * cam.s), (y - cam.oy) / cam.s];
}

/** Radius of an objective's badge, in canvas pixels. */
export function campaignMarkerRadius(w: number, h: number): number {
  return Math.max(12, Math.min(21, Math.min(w, h) * 0.04));
}

/**
 * The region under a canvas point (CSS pixels, a map `w` by `h` showing `act`), or null: a
 * marker first, within its badge and a little more, then whichever outline holds the point. Uses
 * exactly the mapping the drawing uses.
 */
export function campaignRegionAt(x: number, y: number, w: number, h: number, act: 0 | 1, opts: { compact?: boolean; whole?: boolean } = {}): string | null {
  if (w <= 0 || h <= 0) return null;
  const cam = cameraFor(w, h, act, !!opts.whole, opts.compact ?? w < 640);
  const R = campaignMarkerRadius(w, h);
  let best: string | null = null;
  let bestD = R + 4;
  for (const r of theatreRegions()) {
    const [sx, sy] = toScreen(cam, r.site[0], r.site[1]);
    const d = Math.hypot(sx - x, sy - y) - (r.act === act ? 2 : 0);
    if (d < bestD) {
      bestD = d;
      best = r.id;
    }
  }
  if (best) return best;
  const [fx, fy] = fromScreen(cam, x, y);
  return theatreRegions().find(r => pointInPolygon(fx, fy, r.polygon))?.id ?? null;
}

// ---- The country's furniture: relief, woods, names --------------------------------------------

interface Range {
  from: Pt;
  to: Pt;
  hills: number;
  r: number;
  levels: number;
  step: number;
  seed: number;
}

/** Mountain ranges as chains of hills: heavy in the west (the Grey Fells), lighter eastward. */
const RANGES: Range[] = [
  { from: [0.06, 0.6], to: [0.27, 0.53], hills: 6, r: 0.05, levels: 9, step: 200, seed: 1 },
  { from: [0.08, 0.72], to: [0.26, 0.85], hills: 5, r: 0.045, levels: 8, step: 200, seed: 2 },
  { from: [0.05, 0.44], to: [0.25, 0.42], hills: 5, r: 0.04, levels: 7, step: 200, seed: 3 },
  { from: [0.07, 0.22], to: [0.24, 0.19], hills: 4, r: 0.034, levels: 6, step: 200, seed: 4 },
  { from: [0.13, 0.66], to: [0.3, 0.64], hills: 3, r: 0.03, levels: 5, step: 150, seed: 5 },
  { from: [0.72, 0.07], to: [0.86, 0.17], hills: 4, r: 0.032, levels: 6, step: 100, seed: 6 },
  { from: [0.61, 0.12], to: [0.67, 0.2], hills: 2, r: 0.026, levels: 5, step: 100, seed: 7 },
  { from: [0.57, 0.695], to: [0.64, 0.73], hills: 2, r: 0.022, levels: 4, step: 80, seed: 8 },
  { from: [0.42, 0.665], to: [0.46, 0.66], hills: 1, r: 0.02, levels: 4, step: 80, seed: 9 },
  { from: [0.33, 0.44], to: [0.4, 0.5], hills: 2, r: 0.025, levels: 4, step: 100, seed: 10 },
  { from: [0.66, 0.72], to: [0.74, 0.75], hills: 2, r: 0.02, levels: 3, step: 80, seed: 11 },
  { from: [0.4, 0.27], to: [0.52, 0.31], hills: 2, r: 0.02, levels: 3, step: 100, seed: 12 },
];

const NAMES: { text: string; at: Pt; size: number; angle: number; kind: 'sea' | 'land' | 'abroad' }[] = [
  { text: 'GULF OF VARNE', at: [0.6, 0.925], size: 12, angle: 0, kind: 'sea' },
  { text: 'THE NORTHERN SOUND', at: [0.78, 0.33], size: 9.5, angle: -0.04, kind: 'sea' },
  { text: 'THE EASTERN SEA', at: [0.925, 0.515], size: 11, angle: Math.PI / 2, kind: 'sea' },
  { text: 'THE GREY FELLS', at: [0.1, 0.665], size: 13, angle: -0.3, kind: 'land' },
  { text: 'THE OUTER MARCHES', at: [0.38, 0.13], size: 10.5, angle: 0, kind: 'abroad' },
  { text: 'HOLLINMARK', at: [0.16, 0.93], size: 10.5, angle: 0, kind: 'abroad' },
];

interface Sheetish {
  w: number;
  h: number;
  res: number;
  cam: Cam;
  scheme: MapScheme;
  compact: boolean;
}

const sheetCache = new Map<string, HTMLCanvasElement>();
const territoryCache = new Map<string, HTMLCanvasElement>();
const marksCache = new Map<string, HTMLCanvasElement>();

function sheetKey(o: Sheetish): string {
  return `${o.cam.key}@${o.res}#${o.scheme}${fontsLoaded ? 'f' : ''}`;
}

function regionPath(g: Ctx, cam: Cam, r: TheatreRegion) {
  g.beginPath();
  r.polygon.forEach(([fx, fy], i) => {
    const [x, y] = toScreen(cam, fx, fy);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  g.closePath();
}

/** Close parallel lines across the whole canvas, for hatching inside a clip. */
function hatch(g: Ctx, w: number, h: number, gap: number, dir: 1 | -1, colour: string, lw: number, phase = 0) {
  g.strokeStyle = colour;
  g.lineWidth = lw;
  g.beginPath();
  for (let d = -h + phase; d < w + h; d += gap) {
    if (dir > 0) {
      g.moveTo(d, 0);
      g.lineTo(d + h, h);
    } else {
      g.moveTo(d, 0);
      g.lineTo(d - h, h);
    }
  }
  g.stroke();
}

function paintSheet(o: Sheetish): HTMLCanvasElement {
  const key = sheetKey(o);
  const hit = sheetCache.get(key);
  if (hit) return hit;
  if (sheetCache.size > 6) sheetCache.clear();
  const { w, h, res, cam, scheme, compact } = o;
  const [c, g] = newCanvas(w, h, res);
  const pal = PALETTES[scheme];
  const P = (fx: number, fy: number) => toScreen(cam, fx, fy);
  const unit = Math.min(w, h);
  const k = unit / 450;
  // Ground scale: pixels per unit of fy, so the relief keeps its size as the map zooms.
  const gs = cam.s;
  const m = marginOf(w, h);
  const geo = theatreGeography();
  const regions = theatreRegions();
  const land = geo.land.map(([x, y]) => P(x, y));
  const islands = geo.islands.map(i => i.polygon.map(([x, y]) => P(x, y)));
  const allLand = [land, ...islands];

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

  // Water: a pale wash, then the water lining, ripples drawn parallel to every shore.
  g.save();
  g.beginPath();
  g.rect(m, m, w - m * 2, h - m * 2);
  for (const poly of allLand) poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = pal.water;
  g.fill('evenodd');
  g.restore();
  {
    const [a, ga] = newCanvas(w, h, res);
    const [b, gb] = newCanvas(w, h, res);
    const ds = [2.2, 4.8, 7.8, 11.4, 15.6, 20.6, 26.4].map(d => d * Math.max(0.6, k * 0.9));
    const lw = Math.max(0.6, 0.85 * k);
    ga.lineJoin = gb.lineJoin = 'round';
    const landPath = (gg: Ctx) => {
      gg.beginPath();
      for (const poly of allLand) {
        poly.forEach(([x, y], i) => (i ? gg.lineTo(x, y) : gg.moveTo(x, y)));
        gg.closePath();
      }
    };
    ds.forEach((d, i) => {
      gb.setTransform(1, 0, 0, 1, 0, 0);
      gb.clearRect(0, 0, b.width, b.height);
      gb.setTransform(res, 0, 0, res, 0, 0);
      gb.globalCompositeOperation = 'source-over';
      landPath(gb);
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
    landPath(ga);
    ga.fill();
    ga.globalCompositeOperation = 'source-in';
    ga.fillStyle = pal.waterLine;
    ga.fillRect(0, 0, w, h);
    g.drawImage(a, 0, 0, w, h);
  }

  // Everything on land is clipped to the land.
  g.save();
  g.beginPath();
  for (const poly of allLand) {
    poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  }
  g.clip();

  // The lands beyond the frontier: a duller paper, lightly stippled.
  g.save();
  g.beginPath();
  land.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  for (const r of regions) {
    r.polygon.forEach(([fx, fy], i) => {
      const [x, y] = P(fx, fy);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.closePath();
  }
  g.fillStyle = pal.abroad;
  g.fill('evenodd');
  g.clip('evenodd');
  g.fillStyle = pal.inkFaint;
  for (let i = 0; i < (w * h) / 90; i++) {
    const x = hash(i * 3 + 7000) * w;
    const y = hash(i * 3 + 7001) * h;
    g.fillRect(x, y, 0.8, 0.8);
  }
  g.restore();

  // The Sallow Waste is desert: sand stipple, thicker towards the basin's heart.
  {
    const [cx, cy] = P(0.16, 0.29);
    const rx = 0.09 * A * gs;
    const ry = 0.055 * gs;
    g.fillStyle = pal.sand;
    const n = Math.round(rx * ry * 0.5);
    for (let i = 0; i < n; i++) {
      const a = hash(i * 2 + 4100) * TAU;
      const d = Math.sqrt(hash(i * 2 + 4101));
      if (hash(i + 4300) < d * 0.8) continue;
      g.beginPath();
      g.arc(cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, 0.65, 0, TAU);
      g.fill();
    }
  }

  // Contours, hand drawn: rings that crowd on the steeper side, every fourth one heavier, and the
  // summit's spot height beside a dot. Heavy in the west, where the Grey Fells rise.
  let hillNo = 0;
  for (const rg of RANGES) {
    const dx = (rg.to[0] - rg.from[0]) * A;
    const dy = rg.to[1] - rg.from[1];
    const along = cam.rot ? Math.atan2(-dx, dy) : Math.atan2(dy, dx);
    for (let n = 0; n < rg.hills; n++) {
      const q = rg.hills === 1 ? 0.5 : n / (rg.hills - 1);
      const i = hillNo++;
      const fx = rg.from[0] + (rg.to[0] - rg.from[0]) * q + (hash(i * 5 + 61) - 0.5) * 0.02;
      const fy = rg.from[1] + (rg.to[1] - rg.from[1]) * q + (hash(i * 5 + 62) - 0.5) * 0.03;
      const [cx, cy] = P(fx, fy);
      const r = gs * rg.r * (0.75 + hash(i * 5 + 63) * 0.5);
      const levels = Math.max(2, rg.levels - Math.floor(hash(i * 5 + 64) * 3));
      const lean = hash(i * 5 + 70) * TAU;
      const rot = along + (hash(i * 5 + 71) - 0.5) * 0.6;
      for (let j = levels; j >= 1; j--) {
        const s = j / levels;
        const ox = Math.cos(lean) * r * 0.3 * (1 - s);
        const oy = Math.sin(lean) * r * 0.22 * (1 - s);
        wobblyRing(g, cx + ox, cy + oy, r * s * 1.45, r * s * 0.62, rot, i * 31 + j * 7, 0.22);
        const index = (levels - j) % 4 === 0;
        g.strokeStyle = index ? pal.contourIndex : pal.contour;
        g.lineWidth = (index ? 1.05 : 0.6) * Math.max(0.75, k);
        g.stroke();
      }
      if (compact || r < 10 || n !== Math.floor(rg.hills / 2)) continue;
      const sx = cx + Math.cos(lean) * r * 0.3;
      const sy = cy + Math.sin(lean) * r * 0.22;
      g.fillStyle = pal.ink;
      g.beginPath();
      g.arc(sx, sy, Math.max(1, 1.3 * k), 0, TAU);
      g.fill();
      const height = levels * rg.step + Math.round(hash(i * 3 + 80) * rg.step * 0.8);
      letter(g, height.toLocaleString('en-GB'), sx + 3 * Math.max(0.8, k), sy - 1, {
        size: Math.max(7, 8.5 * k),
        colour: pal.inkSoft,
        halo: pal.halo,
        style: 'italic',
        align: 'left',
      });
    }
  }

  // Woods: an outlined edge, a green tint and close diagonal hatching. Kept off the objectives'
  // sites and out of the high west.
  for (let i = 0, placed = 0; i < 160 && placed < 34; i++) {
    const fx = 0.28 + hash(i * 3 + 1200) * 0.62;
    const fy = 0.12 + hash(i * 3 + 1201) * 0.78;
    const r0 = regions.find(r => pointInPolygon(fx, fy, r.polygon));
    if (!r0) continue;
    if (regions.some(r => Math.hypot((r.site[0] - fx) * A, r.site[1] - fy) < 0.04)) continue;
    placed++;
    const [x, y] = P(fx, fy);
    const r = gs * (0.011 + hash(i * 3 + 1202) * 0.012);
    const rot = hash(i * 9 + 40) * Math.PI;
    wobblyRing(g, x, y, r * 1.4, r, rot, i * 17 + 300, 0.3);
    g.fillStyle = pal.wood;
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = pal.woodHatch;
    g.lineWidth = 0.6;
    g.beginPath();
    const gap = Math.max(2.4, 3 * k);
    for (let d = -r * 3; d < r * 3; d += gap) {
      g.moveTo(x + d - r * 2, y - r * 2);
      g.lineTo(x + d + r * 2, y + r * 2);
    }
    g.stroke();
    g.restore();
    wobblyRing(g, x, y, r * 1.4, r, rot, i * 17 + 300, 0.3);
    g.strokeStyle = pal.woodHatch;
    g.lineWidth = 0.8;
    g.stroke();
  }

  // Rivers: a fine line in the hills that broadens towards the sea, fanning into a delta.
  for (const rv of geo.rivers) {
    const pts = rv.points.map(([x, y]) => P(x, y));
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = pal.river;
    const big = rv.name === 'R. Brenn' || rv.name === 'R. Callow';
    const top = big ? 2.6 : 1.6;
    for (let i = 1; i < pts.length; i++) {
      g.beginPath();
      g.moveTo(pts[i - 1][0], pts[i - 1][1]);
      g.lineTo(pts[i][0], pts[i][1]);
      g.lineWidth = (0.6 + (i / pts.length) * top) * Math.max(0.7, k);
      g.stroke();
    }
    if (big || rv.name === 'R. Wend') {
      const end = pts[pts.length - 1];
      const prev = pts[Math.max(0, pts.length - 6)];
      const ang = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
      const len = Math.hypot(end[0] - prev[0], end[1] - prev[1]) * 1.1;
      g.lineWidth = 0.9 * Math.max(0.7, k);
      for (const t of [-0.55, 0.5]) {
        g.beginPath();
        g.moveTo(prev[0] + (end[0] - prev[0]) * 0.35, prev[1] + (end[1] - prev[1]) * 0.35);
        g.quadraticCurveTo(end[0] + Math.cos(ang + t) * len * 0.2, end[1] + Math.sin(ang + t) * len * 0.2, end[0] + Math.cos(ang + t * 1.3) * len * 0.75, end[1] + Math.sin(ang + t * 1.3) * len * 0.75);
        g.stroke();
      }
    }
  }
  g.restore(); // land clip

  // River names, set along the water.
  if (!compact) {
    for (const rv of geo.rivers) {
      const pts = rv.points.map(([x, y]) => P(x, y));
      const at = Math.round(rv.label * (pts.length - 1));
      const [x0, y0] = pts[Math.max(0, at - 3)];
      const [x1, y1] = pts[Math.min(pts.length - 1, at + 3)];
      let ang = Math.atan2(y1 - y0, x1 - x0);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      const [lx, ly] = pts[at];
      letterAt(g, rv.name, lx + Math.cos(ang - Math.PI / 2) * 7 * k, ly + Math.sin(ang - Math.PI / 2) * 7 * k, ang, {
        size: Math.max(7.5, 9.5 * k),
        colour: pal.river,
        halo: pal.halo,
        style: 'italic',
        spacing: 0.5,
      });
    }
  }

  // The coastline, inked so it is crisp, and the islands' names.
  g.strokeStyle = pal.ink;
  g.lineWidth = 1.1 * Math.max(0.8, k);
  g.lineJoin = 'round';
  for (const poly of allLand) {
    polyPath(g, poly);
    g.stroke();
  }
  if (!compact) {
    geo.islands.forEach(il => {
      if (!il.name) return;
      const [x, y] = P(il.at[0], il.at[1]);
      letter(g, il.name, x + (cam.rot ? 0 : 14 * k), y + (cam.rot ? 12 * k : 0), { size: Math.max(7.5, 9 * k), colour: pal.ink, halo: pal.halo, style: 'italic', align: cam.rot ? 'center' : 'left' });
    });
  }

  // The frontier: a broad tinted band on the home side and a dash-dot-dot rule.
  {
    const lines = geo.chains.filter(ch => ch.left === 'abroad' || ch.right === 'abroad').map(ch => ch.points.map(([x, y]) => P(x, y)));
    g.save();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = pal.frontier;
    g.globalAlpha = 0.22;
    g.lineWidth = 5 * Math.max(0.8, k);
    for (const l of lines) {
      polyPath(g, l, false);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.lineWidth = 1.4 * Math.max(0.8, k);
    const u = Math.max(0.8, k);
    g.setLineDash([9 * u, 2.5 * u, 1.5 * u, 2.5 * u, 1.5 * u, 2.5 * u]);
    for (const l of lines) {
      polyPath(g, l, false);
      g.stroke();
    }
    g.restore();
  }

  // Names of the seas, the high country and the lands beyond, widely spaced.
  for (const nm of NAMES) {
    if (compact && nm.kind !== 'sea') continue;
    const [x, y] = P(nm.at[0], nm.at[1]);
    const size = Math.max(7.5, nm.size * Math.min(1.15, k));
    const angle = nm.angle + (cam.rot ? -Math.PI / 2 : 0);
    const upright = Math.abs(angle) > Math.PI / 2 + 0.01 ? angle + Math.PI : angle;
    const o: MapText =
      nm.kind === 'sea'
        ? { size, colour: pal.waterLine, style: 'italic', spacing: Math.max(2, 4.5 * k) }
        : nm.kind === 'land'
          ? { size, colour: pal.contourIndex, halo: pal.halo, spacing: Math.max(2, 6 * k) }
          : { size, colour: pal.inkFaint, style: 'italic', spacing: Math.max(2, 5 * k) };
    letterAt(g, nm.text, x, y, upright, o);
  }

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
    const x = w * 0.88;
    const y = h * 0.62;
    const r = unit * 0.07;
    g.strokeStyle = scheme === 'dark' ? 'rgba(0,0,0,0.16)' : 'rgba(140,100,50,0.1)';
    g.lineWidth = 2.2;
    wobblyRing(g, x, y, r, r * 0.97, 0.4, 990, 0.03);
    g.stroke();
    g.lineWidth = 0.8;
    wobblyRing(g, x + 1.5, y + 1, r * 0.95, r * 0.92, 0.4, 995, 0.04);
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

// ---- Territory ------------------------------------------------------------------------------------

function controlSig(control: Record<string, RegionControl>): string {
  return theatreRegions()
    .map(r => (control[r.id] ?? 'enemy')[0])
    .join('');
}

/**
 * Who holds what: Meridian ground in a blue wash with fine hatching, the Combine's in red hatching
 * the other way, and ground with a battle open now banded in both, as contested. Then the province
 * borders (dash and dot, as an administrative boundary is drawn) and the cities' built-up ground.
 * The act not in view sits under a paper veil.
 */
function paintTerritory(o: Sheetish, control: Record<string, RegionControl>, act: 0 | 1, whole: boolean): HTMLCanvasElement {
  const key = `${sheetKey(o)}|${controlSig(control)}${whole ? '' : act}`;
  const hit = territoryCache.get(key);
  if (hit) return hit;
  if (territoryCache.size > 6) territoryCache.clear();
  const { w, h, res, cam, scheme, compact } = o;
  const [c, g] = newCanvas(w, h, res);
  const pal = PALETTES[scheme];
  const k = Math.min(w, h) / 450;
  const m = marginOf(w, h);
  g.drawImage(paintSheet(o), 0, 0, w, h);
  const regions = theatreRegions();
  const geo = theatreGeography();

  g.save();
  g.beginPath();
  g.rect(m, m, w - m * 2, h - m * 2);
  g.clip();
  // The fills stop at the inked coast rather than a grid cell short of it or past it.
  g.beginPath();
  geo.land.forEach(([fx, fy], i) => {
    const [x, y] = toScreen(cam, fx, fy);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  g.closePath();
  g.clip();

  const fine = Math.max(4, 5.2 * k);
  for (const r of regions) {
    const ctl = control[r.id] ?? 'enemy';
    g.save();
    regionPath(g, cam, r);
    g.clip();
    if (ctl === 'held') {
      g.fillStyle = pal.heldWash;
      g.fillRect(0, 0, w, h);
      hatch(g, w, h, fine, 1, pal.heldHatch, 0.6);
    } else if (ctl === 'enemy') {
      hatch(g, w, h, fine * 1.3, -1, pal.redHatch, 0.75);
    } else {
      // Contested: broad bands, red and blue in turn.
      const band = Math.max(5, 6.5 * k);
      g.lineWidth = band;
      for (const [colour, phase] of [
        [pal.contestRed, 0],
        [pal.contestBlue, band * 2],
      ] as const) {
        g.strokeStyle = colour;
        g.beginPath();
        for (let d = -h + phase; d < w + h; d += band * 4) {
          g.moveTo(d, 0);
          g.lineTo(d - h, h);
        }
        g.stroke();
      }
      hatch(g, w, h, fine * 1.45, -1, pal.redHatch, 0.6);
    }
    g.restore();
  }

  // Province borders, each drawn once.
  g.save();
  g.lineJoin = 'round';
  const u = Math.max(0.8, k);
  for (const ch of geo.chains) {
    if (ch.left === 'sea' || ch.right === 'sea' || ch.left === 'abroad' || ch.right === 'abroad') continue;
    const pts = ch.points.map(([x, y]) => toScreen(cam, x, y));
    const a = control[ch.left] ?? 'enemy';
    const b = control[ch.right] ?? 'enemy';
    const bothHeld = a === 'held' && b === 'held';
    g.strokeStyle = bothHeld ? pal.blue : pal.border;
    g.globalAlpha = bothHeld ? 0.5 : 1;
    g.lineWidth = 0.85 * u;
    g.setLineDash([6 * u, 2.2 * u, 1.2 * u, 2.2 * u]);
    polyPath(g, pts, false);
    g.stroke();
  }
  g.restore();

  // Cities: a ring of built-up ground with its blocks.
  for (const r of regions) {
    if (r.kind !== 'city') continue;
    const [x, y] = toScreen(cam, r.site[0], r.site[1]);
    const rr = campaignMarkerRadius(w, h) * (compact ? 0.85 : 1);
    g.save();
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.fillStyle = pal.halo;
    g.globalAlpha = 0.55;
    g.fill();
    g.globalAlpha = 1;
    g.clip();
    g.fillStyle = pal.town;
    const b = Math.max(1.6, 2.1 * k);
    for (let j = 0; j < 26; j++) {
      const a = hash(j * 7 + r.id.length * 31) * TAU;
      const d = Math.sqrt(hash(j * 7 + 3 + r.id.charCodeAt(0))) * rr * 0.95;
      g.fillRect(x + Math.cos(a) * d - b / 2, y + Math.sin(a) * d - b / 2, b * (0.8 + hash(j + 5) * 0.8), b);
    }
    g.restore();
    g.strokeStyle = pal.town;
    g.lineWidth = 0.9;
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.stroke();
  }

  // The act not in view, under a veil.
  if (!whole) {
    g.fillStyle = pal.veil;
    for (const r of regions) {
      if (r.act === act) continue;
      regionPath(g, cam, r);
      g.fill();
    }
  }
  g.restore();

  territoryCache.set(key, c);
  return c;
}

// ---- The front --------------------------------------------------------------------------------

interface FrontPiece {
  /** Screen points along the border. */
  pts: Pt[];
  /** +1: the enemy is on the left of the walk; -1: on the right. */
  enemySide: 1 | -1;
  /** The two regions either side. */
  a: string;
  b: string;
}

/** The borders between held ground and the enemy's, wherever they run. */
function frontPieces(cam: Cam, control: Record<string, RegionControl>): FrontPiece[] {
  const out: FrontPiece[] = [];
  for (const ch of theatreGeography().chains) {
    if (ch.left === 'sea' || ch.right === 'sea' || ch.left === 'abroad' || ch.right === 'abroad') continue;
    const r = (control[ch.right] ?? 'enemy') === 'held';
    const l = (control[ch.left] ?? 'enemy') === 'held';
    if (r === l) continue;
    out.push({ pts: ch.points.map(([x, y]) => toScreen(cam, x, y)), enemySide: r ? 1 : -1, a: ch.right, b: ch.left });
  }
  return out;
}

/** A heavy inked line with blue teeth facing the enemy, and the enemy's own line pencilled in red beyond it. */
function drawFrontLine(g: Ctx, pts: Pt[], enemySide: 1 | -1, k: number, pal: Palette) {
  if (pts.length < 2) return;
  const u = Math.max(0.75, k);
  const normal = (i: number): Pt => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    // Left of the walk, screen y down.
    return [(dy / l) * enemySide, (-dx / l) * enemySide];
  };
  const off = 5.5 * u;
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => {
    const [nx, ny] = normal(i);
    const wob = (noise1(i * 0.35, 41) - 0.5) * 2 * u;
    if (i) g.lineTo(x + nx * (off + wob), y + ny * (off + wob));
    else g.moveTo(x + nx * (off + wob), y + ny * (off + wob));
  });
  g.setLineDash([5 * u, 3.5 * u]);
  g.strokeStyle = pal.red;
  g.lineWidth = 1.1 * u;
  g.stroke();
  g.setLineDash([]);
  polyPath(g, pts, false);
  g.strokeStyle = pal.ink;
  g.lineWidth = 2.6 * u;
  g.stroke();
  g.fillStyle = pal.blue;
  const spacing = 13 * u;
  const tooth = 3.6 * u;
  let acc = spacing / 2;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg < 1e-6) continue;
    const tx = (x1 - x0) / seg;
    const ty = (y1 - y0) / seg;
    const nx = ty * enemySide;
    const ny = -tx * enemySide;
    while (acc < seg) {
      const x = x0 + tx * acc;
      const y = y0 + ty * acc;
      g.beginPath();
      g.moveTo(x - tx * tooth, y - ty * tooth);
      g.lineTo(x + tx * tooth, y + ty * tooth);
      g.lineTo(x + nx * tooth * 1.5, y + ny * tooth * 1.5);
      g.closePath();
      g.fill();
      acc += spacing;
    }
    acc -= seg;
  }
  g.restore();
}

// ---- Marks: arrows, objectives, engagements -----------------------------------------------------

/** A point on a quadratic curve. */
function quadPoint(a: number[], c: number[], b: number[], t: number): Pt {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

type ArrowStyle = 'won' | 'planned' | 'pencil' | 'enemy';

/**
 * An arrow of advance: a curved shaft that swells from a fine tail, ending in a broad head. Trimmed
 * at each end so it stops short of the markers.
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
  const samples: Pt[] = [];
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
  const at = (s: number): { p: Pt; d: Pt } => {
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
  const left: Pt[] = [];
  const right: Pt[] = [];
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
    g.setLineDash([4, 2.5]);
    g.strokeStyle = style === 'enemy' ? pal.red : pal.blue;
    g.lineWidth = 1.3;
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

/** Two sabres crossed, the map sign for a battle: hilts below, blades curving up and out. */
function sabres(g: Ctx, x: number, y: number, s: number, colour: string, lw: number) {
  g.save();
  g.strokeStyle = colour;
  g.fillStyle = colour;
  g.lineCap = 'round';
  for (const side of [-1, 1]) {
    g.lineWidth = lw;
    g.beginPath();
    // Blade: from the hilt at lower `side`, across the centre to the far upper corner.
    g.moveTo(x + side * s * 0.62, y + s * 0.62);
    g.quadraticCurveTo(x - side * s * 0.05, y + s * 0.05, x - side * s * 0.78, y - s * 0.86);
    g.stroke();
    // Cross-guard and grip.
    const gx = x + side * s * 0.42;
    const gy = y + s * 0.42;
    g.lineWidth = lw * 1.1;
    g.beginPath();
    g.moveTo(gx - s * 0.2, gy - side * s * 0.2 * -1);
    g.lineTo(gx + s * 0.2, gy + side * s * 0.2 * -1);
    g.stroke();
    g.beginPath();
    g.arc(x + side * s * 0.7, y + s * 0.7, lw * 0.9, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** A small swallow-tailed flag on a staff: ground taken in a side battle. */
function flag(g: Ctx, x: number, y: number, s: number, colour: string) {
  g.save();
  g.strokeStyle = colour;
  g.fillStyle = colour;
  g.lineWidth = Math.max(1, s * 0.12);
  g.beginPath();
  g.moveTo(x - s * 0.35, y + s * 0.7);
  g.lineTo(x - s * 0.35, y - s * 0.75);
  g.stroke();
  g.beginPath();
  g.moveTo(x - s * 0.35, y - s * 0.75);
  g.lineTo(x + s * 0.65, y - s * 0.6);
  g.lineTo(x + s * 0.38, y - s * 0.38);
  g.lineTo(x + s * 0.65, y - s * 0.16);
  g.lineTo(x - s * 0.35, y - s * 0.12);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(x - s * 0.35, y + s * 0.72, s * 0.32, s * 0.09, 0, 0, TAU);
  g.fill();
  g.restore();
}

/** Headquarters: a square standard on a staff, as unit signs mark a command post. */
function standard(g: Ctx, x: number, y: number, s: number, pal: Palette) {
  g.save();
  g.strokeStyle = pal.blue;
  g.lineWidth = Math.max(1, s * 0.12);
  g.beginPath();
  g.moveTo(x - s * 0.6, y + s * 0.75);
  g.lineTo(x - s * 0.6, y - s * 0.75);
  g.stroke();
  g.fillStyle = pal.halo;
  g.fillRect(x - s * 0.6, y - s * 0.75, s * 1.3, s * 0.85);
  g.strokeRect(x - s * 0.6, y - s * 0.75, s * 1.3, s * 0.85);
  g.beginPath();
  g.moveTo(x - s * 0.6, y - s * 0.75);
  g.lineTo(x + s * 0.7, y + s * 0.1);
  g.moveTo(x + s * 0.7, y - s * 0.75);
  g.lineTo(x - s * 0.6, y + s * 0.1);
  g.lineWidth = Math.max(0.8, s * 0.08);
  g.stroke();
  g.restore();
}

type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function viewSig(view: TheatreView): string {
  return [
    controlSig(view.control),
    view.missions.map(m => `${m.id}${m.state[0]}${m.stars}/${m.maxStars}:${m.title}`).join(','),
    view.engagements.map(e => `${e.regionId}${e.state[0]}${e.stars}`).join(','),
  ].join('|');
}

/** Where a region with a battle open draws its arrow of advance from: the middle of its longest border with held ground, or the sea. */
function arrowFor(cam: Cam, region: TheatreRegion, control: Record<string, RegionControl>): { from: Pt; anchor: Pt } | null {
  let best: Pt[] | null = null;
  let bestLen = 0;
  let sea: Pt[] | null = null;
  for (const ch of theatreGeography().chains) {
    const other = ch.right === region.id ? ch.left : ch.left === region.id ? ch.right : null;
    if (!other) continue;
    const pts = ch.points.map(([x, y]) => toScreen(cam, x, y));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (other === 'sea') {
      if (!sea || len > 0) sea = sea && sea.length > pts.length ? sea : pts;
      continue;
    }
    if ((control[other] ?? 'enemy') === 'held' && len > bestLen) {
      bestLen = len;
      best = pts;
    }
  }
  const [sx, sy] = toScreen(cam, region.site[0], region.site[1]);
  const mid = (pts: Pt[]) => pts[Math.floor(pts.length / 2)];
  if (best) {
    const a = mid(best);
    const dx = sx - a[0];
    const dy = sy - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return { anchor: a, from: [a[0] - (dx / l) * Math.min(26, l * 0.6), a[1] - (dy / l) * Math.min(26, l * 0.6)] };
  }
  if (sea) {
    // A landing: from the water onto the shore.
    const a = mid(sea);
    const dx = a[0] - sx;
    const dy = a[1] - sy;
    const l = Math.hypot(dx, dy) || 1;
    return { anchor: a, from: [a[0] + (dx / l) * 34, a[1] + (dy / l) * 34] };
  }
  return null;
}

function paintMarks(o: Sheetish, view: TheatreView, whole: boolean, withFront: boolean): HTMLCanvasElement {
  const key = `${sheetKey(o)}|${viewSig(view)}|${view.act}${whole ? 'w' : ''}${withFront ? 'F' : ''}`;
  const hit = marksCache.get(key);
  if (hit) return hit;
  if (marksCache.size > 6) marksCache.clear();
  const { w, h, res, cam, scheme, compact } = o;
  const [c, g] = newCanvas(w, h, res);
  const pal = PALETTES[scheme];
  const unit = Math.min(w, h);
  const k = unit / 450;
  const m = marginOf(w, h);
  const R = campaignMarkerRadius(w, h);
  const regions = theatreRegions();
  const byId = new Map(regions.map(r => [r.id, r]));
  const act = view.act;
  const focus = (r: TheatreRegion) => whole || r.act === act;

  g.save();
  g.beginPath();
  g.rect(m, m, w - m * 2, h - m * 2);
  g.clip();

  if (withFront) for (const p of frontPieces(cam, view.control)) drawFrontLine(g, p.pts, p.enemySide, k, pal);

  // Arrows of advance into every region with a battle open.
  const aw = Math.max(6, Math.min(11, R * 0.55));
  const open = new Set<string>();
  for (const mi of view.missions) if (mi.state === 'open') open.add(mi.regionId);
  for (const e of view.engagements) if (e.state === 'open') open.add(e.regionId);
  for (const id of open) {
    const r = byId.get(id);
    if (!r || !focus(r)) continue;
    const a = arrowFor(cam, r, view.control);
    if (!a) continue;
    const [sx, sy] = toScreen(cam, r.site[0], r.site[1]);
    const isMission = view.missions.some(mi => mi.regionId === id);
    const reach = Math.min(Math.hypot(sx - a.from[0], sy - a.from[1]), 70 * Math.max(0.8, k));
    const dx = sx - a.from[0];
    const dy = sy - a.from[1];
    const l = Math.hypot(dx, dy) || 1;
    const to = { x: a.from[0] + (dx / l) * reach, y: a.from[1] + (dy / l) * reach };
    const trim = Math.max(0, R + 3 - (l - reach));
    advanceArrow(g, { x: a.from[0], y: a.from[1] }, to, 0.12, 0, trim, isMission ? aw : aw * 0.8, 'planned', pal);
  }

  // Markers and names. The story's objectives first, then the side battles, each name tried below,
  // above and to either side of its marker and left out where nothing fits.
  const taken: Box[] = [];
  const label = Math.max(8.5, Math.min(13, unit * 0.027));
  const small = Math.max(7.5, label * 0.84);
  const missionAt = new Map(view.missions.map(mi => [mi.regionId, mi]));
  const engagementAt = new Map(view.engagements.map(e => [e.regionId, e]));
  for (const r of regions) {
    const [x, y] = toScreen(cam, r.site[0], r.site[1]);
    const rr = missionAt.has(r.id) ? (focus(r) ? R : R * 0.72) : R * 0.6;
    taken.push([x - rr, y - rr, x + rr, y + rr]);
  }
  // Keep names off the cartouche and stamp, roughly.
  taken.push([0, 0, w * 0.42, m + 44 * Math.max(0.62, Math.min(1.15, k))]);
  const place = (x: number, y: number, r: number, tw: number, th: number, force: boolean): Pt | null => {
    const tries: Pt[] = [
      [x, y + r + 3 + th / 2],
      [x, y - r - 3 - th / 2],
      [x + r + 4 + tw / 2, y],
      [x - r - 4 - tw / 2, y],
    ];
    for (const [cx, cy] of tries) {
      const b: Box = [cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2];
      if (b[0] < m + 2 || b[2] > w - m - 2 || b[1] < m + 2 || b[3] > h - m - 2) continue;
      if (taken.some(t => overlaps(t, b))) continue;
      taken.push(b);
      return [cx, cy];
    }
    if (!force) return null;
    const [cx, cy] = tries[0];
    const cxx = Math.max(m + tw / 2 + 2, Math.min(w - m - tw / 2 - 2, cx));
    taken.push([cxx - tw / 2, cy - th / 2, cxx + tw / 2, cy + th / 2]);
    return [cxx, cy];
  };

  // Home ground: the Corps' standard.
  for (const r of regions) {
    if (!r.home || engagementAt.has(r.id) || missionAt.has(r.id) || !focus(r)) continue;
    const [x, y] = toScreen(cam, r.site[0], r.site[1]);
    standard(g, x, y, R * 0.62, pal);
  }

  const missions = [...view.missions].sort((a, b) => {
    const rank = (s: string) => (s === 'open' ? 0 : s === 'won' ? 1 : 2);
    return rank(a.state) - rank(b.state) || a.order - b.order;
  });
  const deferred: (() => void)[] = [];
  for (const e of view.engagements) {
    const r = byId.get(e.regionId);
    if (!r) continue;
    const [x, y] = toScreen(cam, r.site[0], r.site[1]);
    const inFocus = focus(r);
    const s = R * 0.62;
    g.save();
    if (!inFocus) g.globalAlpha = 0.45;
    if (e.state === 'open') {
      g.beginPath();
      g.arc(x, y, s * 1.25, 0, TAU);
      g.fillStyle = pal.halo;
      g.globalAlpha *= 0.85;
      g.fill();
      g.globalAlpha = inFocus ? 1 : 0.45;
      g.strokeStyle = pal.red;
      g.lineWidth = 1.2;
      g.stroke();
      sabres(g, x, y, s * 0.85, pal.red, Math.max(1.3, 1.6 * k));
    } else if (e.state === 'won') {
      flag(g, x, y, s * 0.95, pal.blue);
    } else {
      sabres(g, x, y, s * 0.7, pal.pencil, Math.max(0.8, 0.9 * k));
    }
    g.restore();
    if (!inFocus || compact) continue;
    const style: MapText['style'] = e.state === 'locked' ? 'italic' : r.kind === 'city' ? 'roman' : 'caps';
    const colour = e.state === 'locked' ? pal.pencil : e.state === 'open' ? pal.red : pal.ink;
    const weight = e.state === 'open' ? 700 : 400;
    const tw = measure(g, r.name, small, style, weight, style === 'caps' ? 0.6 : 0);
    const prio = e.state === 'open' ? 0 : 1;
    deferred.push(() => {
      const at = place(x, y, s * 1.1, tw + 4, small * 1.15, prio === 0);
      if (at) letter(g, r.name, at[0], at[1], { size: small, colour, halo: pal.halo, style, weight, spacing: style === 'caps' ? 0.6 : 0 });
    });
  }

  // The objectives.
  const missionLabels: (() => void)[] = [];
  for (const n of missions) {
    const r = byId.get(n.regionId);
    if (!r) continue;
    const [x, y] = toScreen(cam, r.site[0], r.site[1]);
    const inFocus = focus(r);
    const rr = inFocus ? R : R * 0.72;
    const ink = n.state === 'won' ? pal.blue : n.state === 'open' ? pal.red : pal.pencil;
    g.save();
    if (!inFocus) g.globalAlpha = 0.55;
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.fillStyle = pal.halo;
    g.globalAlpha *= n.state === 'locked' ? 0.7 : 0.9;
    g.fill();
    g.globalAlpha = inFocus ? 1 : 0.55;
    g.fillStyle = n.state === 'won' ? pal.blueFill : n.state === 'open' ? pal.redFill : 'rgba(0,0,0,0)';
    g.fill();
    if (n.state === 'locked') g.setLineDash([3, 2.5]);
    g.strokeStyle = ink;
    g.lineWidth = n.state === 'locked' ? 1.1 : 2.1;
    g.stroke();
    g.setLineDash([]);
    if (n.state === 'open') {
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(x, y, rr - 3, 0, TAU);
      g.stroke();
    }
    if (rr >= 13) letter(g, 'OBJ', x, y - rr * 0.3, { size: Math.max(6, rr * 0.36), colour: ink, weight: 700, spacing: 0.6 });
    letter(g, String(n.order), x, rr >= 13 ? y + rr * 0.24 : y + 0.5, { size: Math.max(8.5, rr * (rr >= 13 ? 0.66 : 0.8)), colour: ink, weight: 700, style: n.state === 'locked' ? 'italic' : 'roman' });
    if (n.state === 'won') {
      // Captured: a blue pennant planted on the objective's rim.
      const fx = x + rr * 0.62;
      const fy = y - rr * 0.62;
      g.strokeStyle = pal.blue;
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(fx, fy + 2);
      g.lineTo(fx, fy - rr * 0.9);
      g.stroke();
      g.fillStyle = pal.blue;
      g.beginPath();
      g.moveTo(fx, fy - rr * 0.9);
      g.lineTo(fx + rr * 0.66, fy - rr * 0.68);
      g.lineTo(fx, fy - rr * 0.46);
      g.closePath();
      g.fill();
    }
    g.restore();
    if (!inFocus) continue;
    if (compact && n.state !== 'open') continue;
    // The name, and the stars won beneath it.
    const style: MapText['style'] = n.state === 'locked' ? 'italic' : 'caps';
    const weight = n.state === 'open' ? 700 : 600;
    const spacing = n.state === 'locked' ? 0.2 : 0.8;
    const tw = measure(g, n.title, label, style, weight, spacing);
    const sr = Math.max(3.2, label * 0.34);
    const stars = n.state === 'won' ? Math.max(n.stars, n.maxStars) : 0;
    const th = label * 1.15 + (stars ? sr * 2 + 3 : 0);
    missionLabels.push(() => {
      const at = place(x, y, rr, Math.max(tw, stars * sr * 2.4) + 4, th, true);
      if (!at) return;
      const top = at[1] - th / 2;
      letter(g, n.title, at[0], top + label * 0.58, { size: label, colour: n.state === 'locked' ? pal.pencil : pal.ink, halo: pal.halo, style, weight, spacing });
      for (let s = 0; s < stars; s++) stampStar(g, at[0] + (s - (stars - 1) / 2) * sr * 2.4, top + label * 1.15 + sr + 2, sr, s < n.stars, pal);
    });
  }
  for (const f of missionLabels) f();
  for (const f of deferred) f();
  g.restore(); // neatline clip

  furniture(g, w, h, view, pal, compact, cam);
  creases(g, w, h, pal);
  marksCache.set(key, c);
  return c;
}

/** Cartouche, classification, legend, scale and north arrow. */
function furniture(g: Ctx, w: number, h: number, view: TheatreView, pal: Palette, compact: boolean, cam: Cam) {
  const m = marginOf(w, h);
  const unit = Math.min(w, h);
  const k = Math.max(0.62, Math.min(1.15, unit / 450));
  const theatre = CAMPAIGN_THEATRES[view.act];
  const inAct = view.missions.filter(n => campaignActOf(n.order) === view.act);
  const won = inAct.filter(n => n.state === 'won').length;
  const held = theatreRegions().filter(r => view.control[r.id] === 'held').length;
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
    const titleSize = (compact ? 12 : 15) * k;
    const smallSize = Math.max(7, (compact ? 7.5 : 8.5) * k);
    const title = theatre.place.toUpperCase();
    const head = compact ? `Theatre of operations, ${theatre.act}` : `Meridian Corps · Theatre of operations, ${theatre.act}`;
    const foot = `${theatre.sheet} · ${won} of ${inAct.length} objectives · ${held} of ${theatreRegions().length} regions held`;
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
    // Clear the paper under the stamp first, so ink over ink does not read as a smudge.
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
    for (let i = 0, flecks = compact ? 10 : 40; i < flecks; i++) {
      g.fillStyle = `rgba(0,0,0,${0.25 + hash(i + 77) * 0.5})`;
      g.fillRect((hash(i * 2 + 60) - 0.5) * bw, (hash(i * 2 + 61) - 0.5) * bh, 1.2, 1.2);
    }
    g.restore();
  }

  // Scale bar and north arrow, bottom right. The bar is true to the sheet: the country is about
  // 3,300 km east to west.
  const bottom = h - m - 8 * k;
  {
    const kmPerFy = 3300 / A;
    const pxPerKm = cam.s / kmPerFy;
    const steps = [50, 100, 200, 250, 500];
    const segKm = steps.find(s => s * pxPerKm >= 30 * k) ?? 500;
    const seg = segKm * pxPerKm;
    const n = compact ? 2 : 3;
    const bh = Math.max(3, 4 * k);
    const north = Math.max(16, 26 * k);
    const x1 = w - m - 12 * k - north * (cam.rot ? 1.7 : 0.9);
    const x0 = x1 - seg * n;
    const y = bottom - bh - 2;
    const ts = Math.max(7, 8.5 * k);
    g.fillStyle = pal.box;
    g.globalAlpha = 0.85;
    g.fillRect(x0 - seg * 0.4, y - ts * 2.6, seg * n + seg * 0.8 + 10 * k, ts * 2.6 + bh + 6);
    g.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? pal.box : pal.ink;
      g.fillRect(x0 + i * seg, y, seg, bh);
    }
    g.strokeStyle = pal.ink;
    g.lineWidth = 0.8;
    g.strokeRect(x0, y, seg * n, bh);
    for (let i = 0; i <= n; i++) letter(g, String(i * segKm), x0 + i * seg, y - ts * 0.75, { size: ts, colour: pal.ink, align: 'center' });
    // As printed at 96 pixels to the inch, rounded as a draughtsman would.
    const denom = Math.round(3_779_528 / pxPerKm / 250_000) * 250_000;
    if (!compact) letter(g, `Kilometres · 1 : ${denom.toLocaleString('en-GB')}`, x0 + (seg * n) / 2, y - ts * 1.95, { size: ts * 0.95, colour: pal.inkSoft, style: 'italic' });

    // North arrow: a long split point, one half inked and one left as paper, with N above.
    const cx = w - m - 10 * k - north * 0.35;
    const cy = bottom - north * 0.75;
    g.save();
    g.translate(cx, cy);
    if (cam.rot) g.rotate(-Math.PI / 2);
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
    g.translate(0, -L - Math.max(6, 8 * k));
    if (cam.rot) g.rotate(Math.PI / 2);
    letter(g, 'N', 0, 0, { size: Math.max(9, 12 * k), colour: pal.ink, weight: 700 });
    g.restore();
  }

  // Legend: what the marks mean. Bottom left, over the lands beyond the frontier.
  if (!compact) {
    const ts = Math.max(7.5, 8.4 * k);
    const sw = 22 * k;
    const rowH = ts * 1.62;
    const swatch = (x: number, y: number, fill: (gx: Ctx, bx: number, by: number, bw: number, bh: number) => void) => {
      const bw = sw;
      const bh = rowH * 0.62;
      g.save();
      g.beginPath();
      g.rect(x, y - bh / 2, bw, bh);
      g.clip();
      g.fillStyle = pal.paper;
      g.fillRect(x, y - bh / 2, bw, bh);
      fill(g, x, y - bh / 2, bw, bh);
      g.restore();
      g.strokeStyle = pal.inkSoft;
      g.lineWidth = 0.7;
      g.strokeRect(x, y - bh / 2, bw, bh);
    };
    const items: { text: string; draw: (x: number, y: number) => void }[] = [
      {
        text: 'Held by the Corps',
        draw: (x, y) =>
          swatch(x, y, (gx, bx, by, bw, bh) => {
            gx.fillStyle = pal.heldWash;
            gx.fillRect(bx, by, bw, bh);
            gx.translate(bx, by);
            hatch(gx, bw, bh, 4, 1, pal.heldHatch, 0.6);
          }),
      },
      {
        text: 'Held by the Combine',
        draw: (x, y) =>
          swatch(x, y, (gx, bx, by, bw, bh) => {
            gx.translate(bx, by);
            hatch(gx, bw, bh, 6, -1, pal.redHatch, 0.75);
          }),
      },
      {
        text: 'Contested',
        draw: (x, y) =>
          swatch(x, y, (gx, bx, by, bw, bh) => {
            gx.translate(bx, by);
            gx.lineWidth = 5;
            gx.strokeStyle = pal.contestRed;
            gx.beginPath();
            for (let d = -bh; d < bw + bh; d += 20) {
              gx.moveTo(d, 0);
              gx.lineTo(d - bh, bh);
            }
            gx.stroke();
            gx.strokeStyle = pal.contestBlue;
            gx.beginPath();
            for (let d = -bh + 10; d < bw + bh; d += 20) {
              gx.moveTo(d, 0);
              gx.lineTo(d - bh, bh);
            }
            gx.stroke();
          }),
      },
      {
        text: 'Front line',
        draw: (x, y) => drawFrontLine(g, [[x, y + 2], [x + sw, y + 2]], 1, k * 0.85, pal),
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
      { text: 'Engagement, open', draw: (x, y) => sabres(g, x + sw / 2, y, ts * 0.7, pal.red, 1.3) },
      { text: 'Engagement, won', draw: (x, y) => flag(g, x + sw / 2, y, ts * 0.8, pal.blue) },
      {
        text: 'Advance',
        draw: (x, y) => advanceArrow(g, { x, y: y + 2 }, { x: x + sw, y: y - 1 }, 0.15, 0, 0, 6 * k, 'planned', pal),
      },
      {
        text: 'Province boundary',
        draw: (x, y) => {
          g.save();
          g.strokeStyle = pal.border;
          g.lineWidth = 0.9;
          g.setLineDash([5, 2, 1.2, 2]);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + sw, y);
          g.stroke();
          g.restore();
        },
      },
    ];
    const head = ts * 1.9;
    const bw = legendWidth(k);
    const bh = head + rowH * items.length + pad * 0.6;
    const x = m + 6 * k;
    const y = h - m - 6 * k - bh;
    // Only where it fits, with room for the map above it.
    if (y > m + (h - m * 2) * 0.22) {
      box(x, y, bw, bh);
      letter(g, 'REFERENCE', x + bw / 2, y + pad * 0.6 + ts * 0.7, { size: ts, colour: pal.ink, weight: 700, spacing: 3 });
      items.forEach((it, i) => {
        const ix = x + pad;
        const iy = y + head + i * rowH + rowH * 0.5;
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

// ---- A region changing hands ------------------------------------------------------------------------

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Where a captured region's fill spreads from: the middle of its border with ground held before, or its site. */
function captureOrigin(cam: Cam, region: TheatreRegion, before: Record<string, RegionControl>): Pt {
  let best: Pt[] | null = null;
  let bestN = 0;
  for (const ch of theatreGeography().chains) {
    const other = ch.right === region.id ? ch.left : ch.left === region.id ? ch.right : null;
    if (!other || (before[other] ?? 'enemy') !== 'held') continue;
    if (ch.points.length > bestN) {
      bestN = ch.points.length;
      best = ch.points.map(([x, y]) => toScreen(cam, x, y));
    }
  }
  return best ? best[Math.floor(best.length / 2)] : toScreen(cam, region.site[0], region.site[1]);
}

/**
 * The campaign's theatre map, drawn as a staff officer's operational map of one country: aged paper
 * folded in four, a kilometre grid, contours heavy on the western fells, hatched woods, water-lined
 * coasts, rivers and the frontier; every province and city washed in the colours of whoever holds
 * it, the front with its teeth wherever held ground meets the enemy's, arrows of advance into what
 * is open, objectives and engagements, a cartouche, legend, scale, north arrow and stamp.
 *
 * Draws into (0, 0)-(w, h) in the context's current units. The layers are painted once and kept,
 * so calling this every frame costs a few image draws. `t` (seconds) drives the pulses; leave it
 * out for a still. `opts.capture` plays regions changing hands (see CampaignMapOptions).
 *
 * The map turns to the act in `view.act`, or shows the whole country with `opts.whole` (a preview).
 * Below 640 px wide the sheet drops its legend and most names.
 */
export function drawCampaignMap(ctx: Ctx, w: number, h: number, view: TheatreView, t = 0, opts: CampaignMapOptions = {}): void {
  if (w <= 0 || h <= 0) return;
  void mapFontsReady();
  const tf = ctx.getTransform();
  const res = Math.max(1, Math.min(3, Math.hypot(tf.a, tf.b)));
  const scheme = opts.scheme ?? pageScheme();
  const compact = opts.compact ?? w < 640;
  const motion = opts.motion ?? true;
  const whole = !!opts.whole;
  const pal = PALETTES[scheme];
  const cam = cameraFor(w, h, view.act, whole, compact);
  const o: Sheetish = { w, h, res, cam, scheme, compact };
  const k = Math.min(w, h) / 450;
  const m = marginOf(w, h);
  const regions = theatreRegions();
  const byId = new Map(regions.map(r => [r.id, r]));
  const R = campaignMarkerRadius(w, h);

  // A story mission open now is fought over like an engagement: its ground reads as contested.
  const openMission = view.missions.filter(mi => mi.state === 'open' && view.control[mi.regionId] !== 'held');
  if (openMission.length) {
    const control = { ...view.control };
    for (const mi of openMission) control[mi.regionId] = 'open';
    view = { ...view, control };
  }
  const capturing = (opts.capture?.regions ?? []).filter(id => byId.has(id) && view.control[id] === 'held');
  const p = opts.capture ? Math.max(0, Math.min(1, opts.capture.progress)) : 1;
  ctx.save();
  if (capturing.length && p < 1) {
    const before: Record<string, RegionControl> = { ...view.control };
    for (const id of capturing) before[id] = 'enemy';
    ctx.drawImage(paintTerritory(o, before, view.act, whole), 0, 0, w, h);
    const after = paintTerritory(o, view.control, view.act, whole);
    const e = ease(p);
    const spread = capturing.map(id => {
      const r = byId.get(id)!;
      const origin = captureOrigin(cam, r, before);
      let far = 0;
      for (const [fx, fy] of r.polygon) {
        const [x, y] = toScreen(cam, fx, fy);
        far = Math.max(far, Math.hypot(x - origin[0], y - origin[1]));
      }
      return { r, origin, radius: e * (far + 2) };
    });
    ctx.save();
    ctx.beginPath();
    ctx.rect(m, m, w - m * 2, h - m * 2);
    ctx.clip();
    for (const s of spread) {
      ctx.save();
      regionPath(ctx, cam, s.r);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(s.origin[0], s.origin[1], Math.max(0.1, s.radius), 0, TAU);
      ctx.save();
      ctx.clip();
      ctx.drawImage(after, 0, 0, w, h);
      ctx.restore();
      // The leading edge: a bright blue rim that fades as the fill completes.
      ctx.strokeStyle = pal.blue;
      ctx.globalAlpha = 0.7 * (1 - e);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    }
    // The front, moving with the fill: borders of the captured regions with ground held before
    // fade out behind the fill; their borders with the enemy draw in as the fill reaches them.
    const inside = (pt: Pt) => spread.some(s => Math.hypot(pt[0] - s.origin[0], pt[1] - s.origin[1]) < s.radius);
    const touches = (a: string, b: string) => capturing.includes(a) || capturing.includes(b);
    const runs = (pts: Pt[], keep: (q: Pt) => boolean): Pt[][] => {
      const out: Pt[][] = [];
      let cur: Pt[] = [];
      for (const q of pts) {
        if (keep(q)) cur.push(q);
        else if (cur.length) {
          out.push(cur);
          cur = [];
        }
      }
      if (cur.length > 1) out.push(cur);
      return out.filter(r => r.length > 1);
    };
    for (const f of frontPieces(cam, before)) {
      if (!touches(f.a, f.b)) drawFrontLine(ctx, f.pts, f.enemySide, k, pal);
      else for (const run of runs(f.pts, q => !inside(q))) drawFrontLine(ctx, run, f.enemySide, k, pal);
    }
    for (const f of frontPieces(cam, view.control)) {
      if (!touches(f.a, f.b)) continue;
      for (const run of runs(f.pts, inside)) drawFrontLine(ctx, run, f.enemySide, k, pal);
    }
    ctx.restore();
    ctx.drawImage(paintMarks(o, view, whole, false), 0, 0, w, h);
  } else {
    ctx.drawImage(paintTerritory(o, view.control, view.act, whole), 0, 0, w, h);
    ctx.drawImage(paintMarks(o, view, whole, true), 0, 0, w, h);
  }

  // What changes every frame: the pulse on what is open, the hover and the selection.
  const focus = (r: TheatreRegion) => whole || r.act === view.act;
  const pulse = (x: number, y: number, r: number, strength: number) => {
    if (motion) {
      for (const off of [0, 0.5]) {
        const q = (t / 2.4 + off) % 1;
        ctx.strokeStyle = `rgba(${pal.pulse},${strength * (1 - q) * (1 - q)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 2 + q * r * 0.95, 0, TAU);
        ctx.stroke();
      }
    } else {
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = `rgba(${pal.pulse},${strength})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  };
  for (const n of view.missions) {
    const r = byId.get(n.regionId);
    if (!r || n.state !== 'open' || !focus(r)) continue;
    const [x, y] = toScreen(cam, r.site[0], r.site[1]);
    pulse(x, y, R, 0.55);
  }
  for (const e of view.engagements) {
    const r = byId.get(e.regionId);
    if (!r || e.state !== 'open' || !focus(r)) continue;
    const [x, y] = toScreen(cam, r.site[0], r.site[1]);
    pulse(x, y, R * 0.75, 0.38);
  }
  for (const [id, sel] of [
    [opts.hover, false],
    [view.selected, true],
  ] as const) {
    const r = id ? byId.get(id) : undefined;
    if (!r) continue;
    ctx.save();
    regionPath(ctx, cam, r);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = sel ? pal.highlight : pal.ink;
    ctx.lineWidth = sel ? 5 : 1.2;
    if (!sel) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
    if (sel) {
      const [x, y] = toScreen(cam, r.site[0], r.site[1]);
      // A highlighter ring, as if marked up for the briefing.
      ctx.strokeStyle = pal.highlight;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(x, y, R + 5, 0, TAU);
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
