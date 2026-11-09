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
  selected: boolean;
  hover: boolean;
}

/** The campaign's length, for laying out the route. Orders beyond it sit at the far end. */
const ROUTE_LENGTH = 8;

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
  const k = Math.max(0, Math.min(ROUTE_LENGTH - 1, order - 1));
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
  const k = Math.max(0, Math.min(ROUTE_LENGTH - 1, order - 1));
  return tall ? 0.14 + (k / (ROUTE_LENGTH - 1)) * 0.72 : 0.09 + (k / (ROUTE_LENGTH - 1)) * 0.82;
}

/** The coastline in map space: a wavy edge along the south, with a bay in the middle. */
const COAST: [number, number][] = [];
for (let i = 0; i <= 80; i++) {
  const fx = -0.05 + (i / 80) * 1.1;
  const bay = Math.exp(-(((fx - 0.52) / 0.08) ** 2)) * 0.07;
  const fy = 0.86 - bay + (noise1(fx * 9, 11) - 0.5) * 0.06 + (noise1(fx * 31, 12) - 0.5) * 0.02;
  COAST.push([fx, fy]);
}

/** Traces the land (everything north of the coast) as the current path. */
function traceLand(g: Ctx, w: number, h: number) {
  g.beginPath();
  let [sx, sy] = toScreen(-0.05, -0.05, w, h);
  g.moveTo(sx, sy);
  [sx, sy] = toScreen(1.05, -0.05, w, h);
  g.lineTo(sx, sy);
  for (let i = COAST.length - 1; i >= 0; i--) {
    const [x, y] = toScreen(COAST[i][0], COAST[i][1], w, h);
    g.lineTo(x, y);
  }
  g.closePath();
}

// ---- The terrain, painted once per size and kept ---------------------------------------------

const terrainCache = new Map<string, HTMLCanvasElement>();

function paintTerrain(w: number, h: number, res: number): HTMLCanvasElement {
  const key = `${w}x${h}@${res}`;
  const hit = terrainCache.get(key);
  if (hit) return hit;
  if (terrainCache.size > 6) terrainCache.clear();
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * res));
  c.height = Math.max(1, Math.round(h * res));
  const g = c.getContext('2d')!;
  g.scale(res, res);
  const P = (fx: number, fy: number) => toScreen(fx, fy, w, h);
  const unit = Math.min(w, h);

  // Sea.
  const sea = g.createLinearGradient(0, 0, w, h);
  sea.addColorStop(0, '#244a5e');
  sea.addColorStop(1, '#1a3647');
  g.fillStyle = sea;
  g.fillRect(0, 0, w, h);

  const coast = COAST;
  const landPath = () => traceLand(g, w, h);
  // Shallows, then the land.
  landPath();
  g.strokeStyle = 'rgba(120,180,200,0.35)';
  g.lineWidth = unit * 0.035;
  g.stroke();
  g.strokeStyle = 'rgba(150,200,215,0.3)';
  g.lineWidth = unit * 0.014;
  g.stroke();
  landPath();
  const land = g.createLinearGradient(0, 0, w, h);
  land.addColorStop(0, '#5d6b43');
  land.addColorStop(0.5, '#6b7148');
  land.addColorStop(1, '#6e6544');
  g.fillStyle = land;
  g.fill();
  g.save();
  landPath();
  g.clip();
  // Beach along the coast.
  g.beginPath();
  for (let i = 0; i < coast.length; i++) {
    const [x, y] = P(coast[i][0], coast[i][1]);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.strokeStyle = 'rgba(214,196,146,0.55)';
  g.lineWidth = unit * 0.016;
  g.stroke();

  // Uplands to the north: soft brown blobs with contour rings.
  for (let i = 0; i < 9; i++) {
    const fx = 0.05 + hash(i * 3 + 1) * 0.9;
    const fy = 0.06 + hash(i * 5 + 2) * 0.42;
    const r = unit * (0.06 + hash(i * 7 + 3) * 0.06);
    const [x, y] = P(fx, fy);
    const hill = g.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
    hill.addColorStop(0, 'rgba(150,128,88,0.55)');
    hill.addColorStop(1, 'rgba(120,104,70,0)');
    g.fillStyle = hill;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(60,48,30,0.22)';
    g.lineWidth = 0.8;
    for (let k = 1; k <= 3; k++) {
      g.beginPath();
      g.ellipse(x, y, r * 0.28 * k, r * 0.2 * k, hash(i) * 3, 0, TAU);
      g.stroke();
    }
  }
  // Forests: clusters of dark canopy dots.
  for (let i = 0; i < 14; i++) {
    const fx = hash(i * 11 + 5) * 0.96 + 0.02;
    const fy = 0.08 + hash(i * 13 + 6) * 0.68;
    const [x, y] = P(fx, fy);
    const n = 8 + Math.floor(hash(i * 17) * 10);
    for (let k = 0; k < n; k++) {
      const a = hash(i * 100 + k) * TAU;
      const d = Math.sqrt(hash(i * 100 + k + 50)) * unit * 0.045;
      const r = unit * (0.006 + hash(i * 100 + k + 77) * 0.006);
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d * 0.8;
      g.fillStyle = 'rgba(28,46,24,0.55)';
      g.beginPath();
      g.arc(px + r * 0.3, py + r * 0.3, r, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(52,80,40,0.85)';
      g.beginPath();
      g.arc(px, py, r, 0, TAU);
      g.fill();
    }
  }
  // Two rivers from the uplands to the sea.
  for (const [seed, fx0] of [
    [21, 0.3],
    [22, 0.7],
  ] as const) {
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const fy = -0.02 + (i / 40) * 0.92;
      const fx = fx0 + (noise1(fy * 6, seed) - 0.5) * 0.14 + Math.sin(fy * 14 + seed) * 0.012;
      const [x, y] = P(fx, fy);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.strokeStyle = 'rgba(30,60,78,0.5)';
    g.lineWidth = unit * 0.011;
    g.lineCap = 'round';
    g.stroke();
    g.strokeStyle = '#4f8aa6';
    g.lineWidth = unit * 0.006;
    g.stroke();
  }
  g.restore();

  // Map grid and a paper grain over everything.
  g.strokeStyle = 'rgba(240,230,200,0.07)';
  g.lineWidth = 1;
  g.beginPath();
  const step = Math.max(40, unit / 7);
  for (let x = step / 2; x < w; x += step) {
    g.moveTo(x, 0);
    g.lineTo(x, h);
  }
  for (let y = step / 2; y < h; y += step) {
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  g.stroke();
  for (let i = 0; i < (w * h) / 900; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,245,220,0.04)' : 'rgba(0,0,0,0.05)';
    g.fillRect(hash(i * 3) * w, hash(i * 3 + 1) * h, 1.5, 1.5);
  }
  const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
  terrainCache.set(key, c);
  return c;
}

function haloText(ctx: Ctx, text: string, x: number, y: number, size: number, colour: string, weight = 700) {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(10,14,12,0.85)';
  ctx.lineWidth = Math.max(2.5, size * 0.28);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
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

function padlock(ctx: Ctx, x: number, y: number, s: number) {
  ctx.strokeStyle = '#a7aca8';
  ctx.lineWidth = s * 0.16;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.15, s * 0.32, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#a7aca8';
  ctx.fillRect(x - s * 0.48, y - s * 0.15, s * 0.96, s * 0.7);
  ctx.fillStyle = '#2a2e2c';
  ctx.beginPath();
  ctx.arc(x, y + s * 0.12, s * 0.1, 0, TAU);
  ctx.fill();
  ctx.fillRect(x - s * 0.04, y + s * 0.12, s * 0.08, s * 0.24);
}

/**
 * The campaign's theatre map: coast, rivers and uplands, Meridian blue territory in the west and
 * the Combine's red in the east with the front line between them (it moves east with each won
 * mission), dashed routes from mission to mission, and a badge per mission with its stars.
 * Draws into (0, 0)-(w, h) in the context's current units; `t` (seconds) drives the subtle
 * animation and can be left out for a still.
 */
export function drawCampaignMap(ctx: Ctx, w: number, h: number, nodes: CampaignMapNode[], t = 0): void {
  if (w <= 0 || h <= 0) return;
  const m = ctx.getTransform();
  const res = Math.max(1, Math.min(3, Math.hypot(m.a, m.b)));
  ctx.save();
  ctx.drawImage(paintTerrain(w, h, res), 0, 0, w, h);
  const P = (fx: number, fy: number) => toScreen(fx, fy, w, h);
  const unit = Math.min(w, h);
  const tall = portrait(w, h);

  // Where the front stands: just past the furthest mission won.
  const sorted = [...nodes].sort((a, b) => a.order - b.order);
  let furthest = 0;
  for (const n of sorted) if (n.state === 'won') furthest = Math.max(furthest, n.order);
  const lastOrder = sorted.length ? sorted[sorted.length - 1].order : ROUTE_LENGTH;
  const frontFx = furthest >= lastOrder ? 1.08 : furthest === 0 ? (tall ? 0.065 : 0.035) : (mapFx(furthest, tall) + mapFx(furthest + 1, tall)) / 2;
  const frontAt = (fy: number) => frontFx + (noise1(fy * 7, 41) - 0.5) * 0.05 + Math.sin(fy * 23 + t * 0.6) * 0.003;

  // Territory: a wash of each side's colour either side of the front.
  const sidePath = (west: boolean) => {
    ctx.beginPath();
    const edge = west ? -0.1 : 1.1;
    let [x, y] = P(edge, -0.1);
    ctx.moveTo(x, y);
    for (let i = 0; i <= 50; i++) {
      const fy = -0.1 + (i / 50) * 1.2;
      [x, y] = P(frontAt(fy), fy);
      ctx.lineTo(x, y);
    }
    [x, y] = P(edge, 1.1);
    ctx.lineTo(x, y);
    ctx.closePath();
  };
  ctx.save();
  traceLand(ctx, w, h);
  ctx.clip();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = TEAM[0].main;
  sidePath(true);
  ctx.fill();
  ctx.fillStyle = TEAM[1].main;
  sidePath(false);
  ctx.fill();
  ctx.globalAlpha = 1;

  // The front line: a red and blue double line with teeth facing the enemy.
  if (frontFx < 1.05) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 60; i++) {
      const fy = -0.05 + (i / 60) * 1.1;
      pts.push(P(frontAt(fy), fy));
    }
    const line = (dx: number, dy: number, colour: string, width: number) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    // Offset perpendicular to the front: towards the enemy is +x on a wide map, -y on a tall one.
    const [ex, ey] = tall ? [0, -1] : [1, 0];
    line(0, 0, 'rgba(10,12,12,0.55)', 6);
    line(-ex * 1.6, -ey * 1.6, TEAM[0].light, 2);
    line(ex * 1.6, ey * 1.6, '#ff8a7a', 2);
    // Teeth: small triangles along it, pointing at the Combine, drifting gently.
    ctx.fillStyle = TEAM[0].light;
    const spacing = Math.max(14, unit * 0.035);
    let acc = (t * 4) % spacing;
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
        ctx.beginPath();
        ctx.moveTo(x - tx * 3.5 + ex * 2.5, y - ty * 3.5 + ey * 2.5);
        ctx.lineTo(x + tx * 3.5 + ex * 2.5, y + ty * 3.5 + ey * 2.5);
        ctx.lineTo(x + ex * 7, y + ey * 7);
        ctx.closePath();
        ctx.fill();
        acc += spacing;
      }
      acc -= seg;
    }
  }
  ctx.restore();

  // Side names, faint and large.
  const nameSize = Math.max(11, Math.min(22, unit * 0.04));
  ctx.globalAlpha = 0.75;
  {
    const [x0, y0] = P(0.05, 0.08);
    const [x1, y1] = P(0.95, 0.08);
    ctx.save();
    ctx.font = `800 ${nameSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = tall ? 'center' : 'left';
    ctx.fillStyle = TEAM[0].light;
    ctx.fillText('MERIDIAN CORPS', tall ? w / 2 : x0, tall ? h - nameSize * 1.2 : y0);
    ctx.textAlign = tall ? 'center' : 'right';
    ctx.fillStyle = '#ffab9c';
    ctx.fillText('ASHEN COMBINE', tall ? w / 2 : x1, tall ? nameSize * 1.2 : y1);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Compass rose in a corner.
  {
    const r = Math.max(12, unit * 0.04);
    const cx = w - r * 1.8;
    const cy = h - r * 1.8 - (tall ? nameSize * 1.6 : 0);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(240,230,200,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    // North is up on the screen in both layouts: the map turns, the compass turns with it.
    const north = tall ? Math.PI / 2 : 0;
    ctx.rotate(north);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i === 0 ? 'rgba(255,214,120,0.9)' : 'rgba(240,230,200,0.6)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.lineTo(r * 0.2, 0);
      ctx.lineTo(-r * 0.2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(Math.PI / 2);
    }
    ctx.restore();
    haloText(ctx, 'N', cx + (tall ? r * 1.35 : 0), cy - (tall ? 0 : r * 1.35), Math.max(9, r * 0.6), 'rgba(255,230,170,0.9)');
  }

  // Routes between consecutive missions.
  const R = campaignNodeRadius(w, h);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const pa = campaignNodePosition(a.order, w, h);
    const pb = campaignNodePosition(b.order, w, h);
    const mx = (pa.x + pb.x) / 2 + (pb.y - pa.y) * 0.12;
    const my = (pa.y + pb.y) / 2 - (pb.x - pa.x) * 0.12;
    const travelled = a.state === 'won';
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.quadraticCurveTo(mx, my, pb.x, pb.y);
    ctx.strokeStyle = 'rgba(8,10,10,0.5)';
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash(travelled ? [9, 5] : [4, 6]);
    ctx.lineDashOffset = travelled && b.state === 'open' ? -t * 12 : 0;
    ctx.strokeStyle = travelled ? (b.state === 'locked' ? 'rgba(200,210,220,0.7)' : '#bcd9ff') : 'rgba(170,170,160,0.5)';
    ctx.lineWidth = travelled ? 2.2 : 1.6;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  // Mission badges.
  const label = Math.max(10, Math.min(13, unit * 0.026));
  for (const n of sorted) {
    const { x, y } = campaignNodePosition(n.order, w, h);
    // Selection and hover rings.
    if (n.selected) {
      const glow = ctx.createRadialGradient(x, y, R * 0.6, x, y, R * 2.1);
      glow.addColorStop(0, 'rgba(255,220,120,0.45)');
      glow.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, R * 2.1, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 0.8);
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, R + 7, k * (Math.PI / 2) + 0.2, k * (Math.PI / 2) + Math.PI / 2 - 0.2);
        ctx.stroke();
      }
      ctx.restore();
    } else if (n.hover && n.state !== 'locked') {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, R + 5, 0, TAU);
      ctx.stroke();
    }
    if (n.state === 'open') {
      // A beacon pulse on the mission waiting to be played.
      const q = (t * 0.7) % 1;
      ctx.strokeStyle = `rgba(156,200,255,${0.8 * (1 - q)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, R + 2 + q * R * 0.9, 0, TAU);
      ctx.stroke();
    }
    // Shadow, then the badge.
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 3, R, 0, TAU);
    ctx.fill();
    const face = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
    if (n.state === 'locked') {
      face.addColorStop(0, '#585d5a');
      face.addColorStop(1, '#2e3230');
    } else {
      face.addColorStop(0, TEAM[0].light);
      face.addColorStop(0.35, TEAM[0].main);
      face.addColorStop(1, TEAM[0].dark);
    }
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.fill();
    ctx.lineWidth = n.state === 'won' ? 3 : 2;
    ctx.strokeStyle = n.state === 'won' ? GOLD : n.state === 'open' ? '#e6f0ff' : '#777c78';
    ctx.stroke();
    if (n.state === 'locked') padlock(ctx, x, y, R * 0.8);
    else haloText(ctx, String(n.order), x, y + 0.5, R * 0.95, '#ffffff', 800);
    if (n.state === 'won') {
      // A small tick on the rim.
      const cx = x + R * 0.72;
      const cy = y - R * 0.72;
      ctx.fillStyle = '#2c8a3e';
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.34, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.4, R * 0.1);
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.15, cy);
      ctx.lineTo(cx - R * 0.03, cy + R * 0.13);
      ctx.lineTo(cx + R * 0.17, cy - R * 0.12);
      ctx.stroke();
    }
    // Three star slots under the badge.
    const sr = Math.max(4, R * 0.26);
    for (let k = 0; k < 3; k++) {
      const sx = x + (k - 1) * sr * 2.3;
      const sy = y + R + sr + 3;
      starPath(ctx, sx, sy, sr);
      ctx.fillStyle = k < n.stars ? GOLD : 'rgba(20,24,22,0.7)';
      ctx.fill();
      ctx.strokeStyle = k < n.stars ? GOLD_DARK : 'rgba(200,200,190,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    haloText(ctx, n.title, x, y + R + sr * 2 + 6 + label * 0.7, label, n.state === 'locked' ? '#b9bdb6' : '#fff6dc');
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
