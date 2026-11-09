import type { BuildingKind, Owner, UnitKind } from '../sim/rules';
import { BUILDINGS } from '../sim/rules';
import { ART, TEAM } from '../theme';

/**
 * Every unit and structure, drawn with canvas paths. No image files: the same functions draw the
 * battlefield and the build menu's icons, at any scale and in either team's colours.
 *
 * Conventions: (x, y) is the centre of a unit, or the top-left of a structure, in pixels at
 * scale 1 where a tile is TILE pixels. Angles are radians, 0 pointing east.
 *
 * Light always comes from the top left of the screen, whatever way a vehicle faces: shading on a
 * rotated hull or turret is computed against the world light direction (litGrad), and shadows
 * fall down and to the right. Damage (pose.hp) is drawn onto the art itself: scorching from 70%,
 * broken panels and sparks below 50%, heavy damage and embers below 25%.
 *
 * Animation is a pure function of pose.t, so nothing here keeps state between frames.
 */

export const TILE = 32;

type Ctx = CanvasRenderingContext2D;
type Team = (typeof TEAM)[Owner];

const TAU = Math.PI * 2;

/** The globalAlpha the caller drew with (the placement ghost draws at 0.55); every fade multiplies it. */
let baseAlpha = 1;
function alpha(ctx: Ctx, a: number) {
  ctx.globalAlpha = baseAlpha * a;
}

const frac = (v: number) => v - Math.floor(v);
const clamp01 = (v: number | undefined, d: number) => (v === undefined || Number.isNaN(v) ? d : Math.max(0, Math.min(1, v)));

function hash(n: number): number {
  let h = (n * 374761393) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function circle(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function shade(ctx: Ctx, x: number, y: number, w: number, h: number, light: string, dark: string) {
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  return g;
}

/**
 * A gradient lit from the world's top left, for a frame rotated by `ang`: the world direction
 * (1, 1) seen from inside the rotated frame is that vector rotated by -ang.
 */
function litGrad(ctx: Ctx, ang: number, r: number, light: string, dark: string) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const dx = (c + s) * 0.7071 * r;
  const dy = (c - s) * 0.7071 * r;
  const g = ctx.createLinearGradient(-dx, -dy, dx, dy);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  return g;
}

/** A soft shadow under a rotated body: two passes, the outer one fainter. */
function bodyShadow(ctx: Ctx, ang: number, w: number, h: number, r: number, ox = 3, oy = 4) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  rrect(ctx, -w / 2 - 2, -h / 2 - 2, w + 4, h + 4, r + 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  rrect(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fill();
  ctx.restore();
}

/** A small team mark: Meridian's is a diamond with a bar, the Combine's an inverted triangle. */
function emblem(ctx: Ctx, team: Team, x: number, y: number, s: number) {
  ctx.fillStyle = team.light;
  ctx.beginPath();
  if (team.name === TEAM[0].name) {
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.8, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s * 0.8, y);
  } else {
    ctx.moveTo(x - s, y - s * 0.7);
    ctx.lineTo(x + s, y - s * 0.7);
    ctx.lineTo(x, y + s * 0.9);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = team.dark;
  ctx.fillRect(x - s * 0.35, y - s * 0.12, s * 0.7, s * 0.24);
}

/** Sparks spitting from a point, flickering on pose.t. */
function sparks(ctx: Ctx, x: number, y: number, t: number, n: number, seed: number) {
  for (let i = 0; i < n; i++) {
    const ph = frac(t * 2.1 + i * 0.37 + seed * 0.61);
    if (ph > 0.5) continue;
    const a = i * 2.4 + seed;
    const d = ph * 8;
    alpha(ctx, 1 - ph * 1.8);
    ctx.fillStyle = ph < 0.18 ? '#fff4c2' : '#ffae3c';
    ctx.fillRect(x + Math.cos(a) * d - 0.6, y + Math.sin(a) * d * 0.6 - ph * 4 - 0.6, 1.3, 1.3);
  }
  alpha(ctx, 1);
}

function scorch(ctx: Ctx, x: number, y: number, r: number, a = 0.6) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(18,13,9,${a})`);
  g.addColorStop(0.6, `rgba(30,22,14,${a * 0.5})`);
  g.addColorStop(1, 'rgba(30,22,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** A jagged hole in plating, with a bent girder showing through and a lit lip. */
function brokenPanel(ctx: Ctx, x: number, y: number, r: number, seed: number) {
  scorch(ctx, x + r * 0.3, y + r * 0.3, r * 2.1, 0.55);
  // Bent plate around the hole, catching the light on its upper-left lip.
  ctx.fillStyle = 'rgba(205,200,188,0.45)';
  ctx.beginPath();
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + hash(seed + k) * 0.5;
    const d = r * (0.55 + hash(seed * 3 + k) * 0.5) + 1.2;
    const px = x + Math.cos(a) * d - 0.8;
    const py = y + Math.sin(a) * d - 0.8;
    if (k) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a2622';
  ctx.beginPath();
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + hash(seed + k) * 0.5;
    const d = r * (0.55 + hash(seed * 3 + k) * 0.5);
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (k) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.strokeStyle = '#7d807a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.7, y - r * 0.2);
  ctx.lineTo(x + r * 0.1, y + r * 0.15);
  ctx.lineTo(x + r * 0.6, y - r * 0.35);
  ctx.stroke();
}

/** Flickering embers in a hole. */
function embers(ctx: Ctx, x: number, y: number, r: number, t: number, seed: number) {
  const f = 0.55 + 0.45 * Math.sin(t * 11 + seed) * Math.sin(t * 7.3 + seed * 2);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,190,80,${0.75 * f + 0.2})`);
  g.addColorStop(0.5, `rgba(230,90,30,${0.5 * f + 0.1})`);
  g.addColorStop(1, 'rgba(160,40,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Damage drawn on a vehicle hull, inside the hull's rotated frame. */
function hullDamage(ctx: Ctx, hp: number, t: number, len: number, wid: number, part: 'static' | 'live' | 'both') {
  if (hp >= 0.7) return;
  if (part !== 'live') {
    ctx.fillStyle = 'rgba(15,12,10,0.5)';
    circle(ctx, -len * 0.22, -wid * 0.18, wid * 0.22);
    ctx.fill();
    if (hp < 0.5) {
      circle(ctx, len * 0.18, wid * 0.22, wid * 0.18);
      ctx.fill();
      ctx.fillStyle = '#1a1917';
      ctx.beginPath();
      ctx.moveTo(len * 0.05, -wid * 0.42);
      ctx.lineTo(len * 0.2, -wid * 0.2);
      ctx.lineTo(len * 0.1, -wid * 0.05);
      ctx.lineTo(-len * 0.04, -wid * 0.25);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (part === 'static') return;
  if (hp < 0.5) sparks(ctx, len * 0.1, -wid * 0.22, t, 3, len);
  if (hp < 0.25) {
    const f = 0.5 + 0.5 * Math.sin(t * 13) * Math.sin(t * 5.1);
    ctx.fillStyle = `rgba(255,120,40,${0.35 + 0.4 * f})`;
    circle(ctx, -len * 0.3, wid * 0.15, wid * 0.16);
    ctx.fill();
    ctx.fillStyle = `rgba(255,220,120,${0.3 + 0.5 * f})`;
    circle(ctx, -len * 0.3, wid * 0.15, wid * 0.07);
    ctx.fill();
    sparks(ctx, -len * 0.3, wid * 0.1, t + 0.4, 4, len * 2);
  }
}

// ---------------------------------------------------------------------------------------------
// Units

export interface UnitPose {
  hull: number;
  turret: number;
  /** Seconds, for animation. */
  t: number;
  moving: boolean;
  /** 0..1, haulers only. */
  cargo: number;
  /** Seconds since this unit last fired, for recoil. */
  sinceShot: number;
  /** Health fraction 0..1, for drawn damage. Missing means unhurt. */
  hp?: number;
  /** Fired within the last ~0.15s. Missing means "work it out from sinceShot". */
  firing?: boolean;
  /** Heroes: the Spy's cloak shimmer (drawn live over the stamp). */
  shimmer?: boolean;
  /** Heroes: the Engineer is welding something right now (a live spark at his torch). */
  repairing?: boolean;
}

export function drawUnit(ctx: Ctx, kind: UnitKind, owner: Owner, x: number, y: number, pose: UnitPose): void {
  const team = TEAM[owner];
  baseAlpha = ctx.globalAlpha;
  ctx.save();
  ctx.translate(x, y);
  switch (kind) {
    case 'rifleman':
    case 'rocketeer':
    case 'spy':
    case 'commando':
    case 'engineer':
      drawTrooperCached(ctx, kind, owner, team, pose);
      break;
    case 'ace':
      drawVehicleCached(ctx, kind, owner, team, pose, drawAce);
      break;
    case 'tank':
      drawVehicleCached(ctx, kind, owner, team, pose, drawTank);
      break;
    case 'buggy':
      drawVehicleCached(ctx, kind, owner, team, pose, drawBuggy);
      break;
    case 'hauler':
      drawVehicleCached(ctx, kind, owner, team, pose, drawHauler);
      break;
    case 'artillery':
      drawVehicleCached(ctx, kind, owner, team, pose, drawArtillery);
      break;
  }
  ctx.restore();
  ctx.globalAlpha = baseAlpha;
}

// ---------------------------------------------------------------------------------------------
// Sprite cache. A large battle puts a couple of hundred units on screen, so each distinct look is
// drawn once into a small canvas at the resolution the screen is using and stamped from then on:
// infantry by kind, side, facing, stride, firing and hurt; vehicles as two layers, the hull (by
// facing, track frame, damage, load) and the turret (by facing, recoil, firing). Lighting stays
// right because it is baked per facing. Only sparks and flames are drawn live, over the stamp.

type Layer = 'all' | 'hull' | 'turret';
type VehicleKind = 'tank' | 'artillery' | 'buggy' | 'hauler' | 'ace';
type TrooperKind = 'rifleman' | 'rocketeer' | 'spy' | 'commando' | 'engineer';
type VehicleFn = (ctx: Ctx, team: Team, p: UnitPose, layer: Layer) => void;

const ANGLES = 48;
const VANGLES = 64;
/** Hull length and width, for placing live damage effects. */
const HULL: Record<VehicleKind, [number, number]> = { tank: [22, 13], artillery: [20, 10], buggy: [17, 9], hauler: [26, 14], ace: [27, 15] };
/** Half the side of a vehicle's sprite canvas: the Ace's twin barrels and pennant reach further. */
const VHALF: Record<VehicleKind, number> = { tank: 26, artillery: 26, buggy: 26, hauler: 26, ace: 31 };
const SPRITE_BUDGET = 12_000_000;
const sprites = new Map<string, HTMLCanvasElement>();
let spritePixels = 0;

function sprite(ctx: Ctx, key: string, half: number, draw: (g: Ctx) => void) {
  const m = ctx.getTransform();
  const res = Math.max(1, Math.min(4, Math.ceil(Math.hypot(m.a, m.b) * 2) / 2));
  const k = `${key}@${res}`;
  let c = sprites.get(k);
  if (!c) {
    const size = Math.ceil(half * 2 * res);
    if (spritePixels + size * size > SPRITE_BUDGET) {
      sprites.clear();
      spritePixels = 0;
    }
    c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.scale(res, res);
    g.translate(half, half);
    const outer = baseAlpha;
    baseAlpha = 1;
    draw(g);
    baseAlpha = outer;
    sprites.set(k, c);
    spritePixels += size * size;
  }
  ctx.drawImage(c, -half, -half, half * 2, half * 2);
}

function drawTrooperCached(ctx: Ctx, kind: TrooperKind, owner: Owner, team: Team, p: UnitPose) {
  const hp = clamp01(p.hp, 1);
  const firing = p.firing ?? p.sinceShot < 0.15;
  const flash = firing && p.sinceShot < 0.1;
  const step = p.moving ? Math.round(Math.sin(p.t * 16) * 2) / 2 : 0;
  const facing = Math.round(frac(p.turret / TAU) * ANGLES) % ANGLES;
  const hurt = hp < 0.5;
  const key = `${kind}${owner}${firing ? 1 : 0}${flash ? 1 : 0}${hurt ? 1 : 0}${p.moving ? 1 : 0}/${facing}/${step}`;
  sprite(ctx, key, kind in HERO_SCALE ? 30 : 22, g =>
    drawTrooper(g, kind, team, {
      hull: 0,
      turret: (facing / ANGLES) * TAU,
      t: Math.asin(step) / 16,
      moving: p.moving,
      cargo: 0,
      sinceShot: flash ? 0 : firing ? 0.12 : 9,
      hp: hurt ? 0.4 : 1,
      firing,
    }),
  );
  if (hp < 0.25) sparks(ctx, 0, -2, p.t, 2, 3);
  if (p.shimmer) cloakShimmer(ctx, p.t);
  if (p.repairing && kind === 'engineer') weldSpark(ctx, p.turret, p.t);
}

function drawVehicleCached(ctx: Ctx, kind: VehicleKind, owner: Owner, team: Team, p: UnitPose, fn: VehicleFn) {
  const hp = clamp01(p.hp, 1);
  const firing = p.firing ?? p.sinceShot < 0.15;
  const hurt = hp < 0.25 ? 3 : hp < 0.5 ? 2 : hp < 0.7 ? 1 : 0;
  const hpq = [1, 0.6, 0.4, 0.2][hurt];
  // Six track frames looping every half second while moving.
  const frame = p.moving ? Math.floor(frac(p.t * 2) * 6) : 0;
  const tq = frame / 12;
  const hf = Math.round(frac(p.hull / TAU) * VANGLES) % VANGLES;
  const cargo = kind === 'hauler' ? Math.round(clamp01(p.cargo, 0) * 8) : 0;
  sprite(ctx, `${kind}${owner}h${hf}/${p.moving ? frame : 'i'}/${hurt}/${cargo}`, VHALF[kind], g =>
    fn(g, team, { hull: (hf / VANGLES) * TAU, turret: 0, t: tq, moving: p.moving, cargo: cargo / 8, sinceShot: 9, hp: hpq, firing: false }, 'hull'),
  );
  if (hp < 0.5) {
    ctx.save();
    ctx.rotate(p.hull);
    hullDamage(ctx, hp, p.t, HULL[kind][0], HULL[kind][1], 'live');
    ctx.restore();
  }
  if (kind === 'hauler') return;
  const tf = Math.round(frac(p.turret / TAU) * VANGLES) % VANGLES;
  const rq = Math.min(8, Math.floor(p.sinceShot / 0.05));
  sprite(ctx, `${kind}${owner}t${tf}/${rq}/${firing ? 1 : 0}/${p.moving ? frame : 'i'}`, VHALF[kind], g =>
    fn(g, team, { hull: 0, turret: (tf / VANGLES) * TAU, t: tq, moving: p.moving, cargo: 0, sinceShot: rq === 8 ? 9 : rq * 0.05, hp: hpq, firing }, 'turret'),
  );
}

function treads(ctx: Ctx, len: number, off: number, w: number, t: number, moving: boolean) {
  const phase = moving ? frac(t * 4.5) * 3 : 0;
  for (const side of [-1, 1]) {
    const y = side * off - w / 2;
    ctx.fillStyle = '#1b1d1d';
    rrect(ctx, -len / 2, y, len, w, 1.8);
    ctx.fill();
    // Track links.
    ctx.strokeStyle = '#3d4140';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -len / 2 + 1 + phase; i < len / 2 - 0.5; i += 3) {
      ctx.moveTo(i, y + 0.6);
      ctx.lineTo(i, y + w - 0.6);
    }
    ctx.stroke();
    // Road wheels showing through, lit on the upper side.
    ctx.fillStyle = side < 0 ? '#4a4e4d' : '#353837';
    for (let i = -len / 2 + 3; i < len / 2 - 1; i += len / 4.2) ctx.fillRect(i, y + w / 2 - 0.7, 1.6, 1.4);
  }
}

function barrel(ctx: Ctx, x0: number, len: number, w: number, recoil: number, hot: boolean) {
  const x = x0 - recoil;
  ctx.fillStyle = '#262a2b';
  ctx.fillRect(x, -w / 2, len, w);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x, -w / 2, len, w * 0.3);
  // Bore evacuator band and muzzle brake.
  ctx.fillStyle = '#1a1c1d';
  ctx.fillRect(x + len * 0.45, -w / 2 - 0.4, 1.6, w + 0.8);
  ctx.fillRect(x + len - 2.4, -w / 2 - 0.7, 2.6, w + 1.4);
  if (hot) {
    ctx.fillStyle = 'rgba(255,160,70,0.8)';
    ctx.fillRect(x + len - 0.6, -w / 2 + 0.3, 1, w - 0.6);
  }
}

function drawTank(ctx: Ctx, team: Team, p: UnitPose, layer: Layer = 'all') {
  const hp = clamp01(p.hp, 1);
  const firing = p.firing ?? p.sinceShot < 0.15;
  if (layer !== 'turret') {
    bodyShadow(ctx, p.hull, 25, 20, 4);
    ctx.save();
    ctx.rotate(p.hull);
    treads(ctx, 25, 7.6, 5.4, p.t, p.moving);
    // Hull with sponsons over the tracks.
    ctx.fillStyle = litGrad(ctx, p.hull, 11, team.main, team.dark);
    rrect(ctx, -11, -6.8, 22, 13.6, 2.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Sloped glacis, lit, and rear engine deck with grille.
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(6, -6);
    ctx.lineTo(10.5, -4.2);
    ctx.lineTo(10.5, 4.2);
    ctx.lineTo(6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-10, -4.6, 5.4, 9.2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 4; i++) ctx.fillRect(-9.6 + i * 1.3, -4, 0.7, 8);
    // Panel lines.
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-4.5, -6.6);
    ctx.lineTo(-4.5, 6.6);
    ctx.moveTo(6, -6.6);
    ctx.lineTo(6, 6.6);
    ctx.stroke();
    // Exhaust stacks at the rear corners, headlights at the front.
    ctx.fillStyle = '#2c2a28';
    ctx.fillRect(-11.6, -6.2, 2, 2);
    ctx.fillRect(-11.6, 4.2, 2, 2);
    ctx.fillStyle = p.moving ? '#fff3c4' : '#c9c2a2';
    ctx.fillRect(10, -5.6, 1.2, 1.6);
    ctx.fillRect(10, 4, 1.2, 1.6);
    hullDamage(ctx, hp, p.t, 22, 13, layer === 'all' ? 'both' : 'static');
    ctx.restore();
  }

  // Turret.
  if (layer !== 'hull') {
    ctx.save();
    ctx.rotate(p.turret);
    const recoil = Math.max(0, 2.6 - p.sinceShot * 12);
    barrel(ctx, 4, 13.5, 3, recoil, firing);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(-5, -4);
    ctx.lineTo(4.4, -4.6);
    ctx.lineTo(7.4, -1.4);
    ctx.lineTo(7.4, 2.6);
    ctx.lineTo(4.4, 6.4);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = litGrad(ctx, p.turret, 7, team.light, team.main);
    ctx.beginPath();
    ctx.moveTo(-6.5, -5);
    ctx.lineTo(3.4, -5.6);
    ctx.lineTo(6.8, -2);
    ctx.lineTo(6.8, 2);
    ctx.lineTo(3.4, 5.6);
    ctx.lineTo(-6.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // Turret bustle (rear stowage box).
    ctx.fillStyle = team.dark;
    ctx.fillRect(-8, -3.6, 2, 7.2);
    // Commander's hatch with a lit rim, loader's hatch, sight.
    ctx.fillStyle = '#1f2a33';
    circle(ctx, -2.2, -1.8, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-3, 1.6, 3, 2.2);
    ctx.fillStyle = '#9fd6ff';
    ctx.fillRect(3.2, -3.6, 1.4, 1.2);
    emblem(ctx, team, 0.6, 3, 1.5);
    // Whip antenna, swaying a little when moving.
    const sway = p.moving ? Math.sin(p.t * 9) * 1.5 : 0.4;
    ctx.strokeStyle = 'rgba(20,20,20,0.75)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-6, 3.8);
    ctx.quadraticCurveTo(-10, 5 + sway * 0.5, -13, 6 + sway);
    ctx.stroke();
    ctx.restore();
  }
}

function drawArtillery(ctx: Ctx, team: Team, p: UnitPose, layer: Layer = 'all') {
  const hp = clamp01(p.hp, 1);
  const firing = p.firing ?? p.sinceShot < 0.15;
  if (layer !== 'turret') {
    bodyShadow(ctx, p.hull, 23, 18, 3);
    ctx.save();
    ctx.rotate(p.hull);
    treads(ctx, 23, 6.8, 4.4, p.t, p.moving);
    ctx.fillStyle = litGrad(ctx, p.hull, 10, team.main, team.dark);
    rrect(ctx, -10, -5.2, 20, 10.4, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Driver's cab at the front, ammunition lockers at the back, recoil spade.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(5, -4.4, 4.4, 8.8);
    ctx.fillStyle = '#9fd6ff';
    ctx.fillRect(8.2, -3, 1, 6);
    ctx.fillStyle = '#4a4436';
    ctx.fillRect(-9, -4.4, 3, 3.6);
    ctx.fillRect(-9, 0.8, 3, 3.6);
    ctx.fillStyle = ART.hazard;
    ctx.fillRect(-11.6, -3, 1.6, 6);
    ctx.fillStyle = '#222';
    ctx.fillRect(-11.6, -1.5, 1.6, 0.9);
    ctx.fillRect(-11.6, 0.6, 1.6, 0.9);
    hullDamage(ctx, hp, p.t, 20, 10, layer === 'all' ? 'both' : 'static');
    ctx.restore();
  }

  if (layer !== 'hull') {
    ctx.save();
    ctx.rotate(p.turret);
    const recoil = Math.max(0, 4 - p.sinceShot * 10);
    // Recuperator cylinders under the long barrel.
    ctx.fillStyle = '#3b3f40';
    ctx.fillRect(1 - recoil * 0.4, -2.6, 9, 1.2);
    ctx.fillRect(1 - recoil * 0.4, 1.4, 9, 1.2);
    barrel(ctx, 0, 22, 2.8, recoil, firing);
    // Gun shield and mount.
    ctx.fillStyle = litGrad(ctx, p.turret, 6, '#8b9295', ART.metalDark);
    rrect(ctx, -6.5, -5, 10, 10, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = team.main;
    ctx.fillRect(-5.6, -5, 2.6, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    circle(ctx, -0.5, 0, 1.6);
    ctx.fill();
    emblem(ctx, team, -4.3, 0, 1.2);
    ctx.restore();
  }
}

function drawBuggy(ctx: Ctx, team: Team, p: UnitPose, layer: Layer = 'all') {
  const hp = clamp01(p.hp, 1);
  const firing = p.firing ?? p.sinceShot < 0.15;
  if (layer !== 'turret') {
    bodyShadow(ctx, p.hull, 20, 15, 3, 2.5, 3.5);
    ctx.save();
    ctx.rotate(p.hull);
    const bounce = p.moving ? Math.sin(p.t * 30) * 0.4 : 0;
    for (const [wx, wy] of [
      [-5.5, -5.6],
      [5.2, -5.6],
      [-5.5, 5.6],
      [5.2, 5.6],
    ]) {
      ctx.fillStyle = '#151616';
      rrect(ctx, wx - 2.7, wy - 1.7 + bounce, 5.4, 3.4, 1.2);
      ctx.fill();
      ctx.fillStyle = '#3a3c3c';
      const ph = p.moving ? frac(p.t * 6) * 1.8 : 0;
      ctx.fillRect(wx - 2 + ph, wy - 1.4 + bounce, 0.6, 2.8);
      ctx.fillRect(wx - 0.2 + ph, wy - 1.4 + bounce, 0.6, 2.8);
    }
    // Wedge chassis.
    ctx.fillStyle = litGrad(ctx, p.hull, 9, team.light, team.dark);
    ctx.beginPath();
    ctx.moveTo(-8.5, -4.2);
    ctx.lineTo(5, -4.6);
    ctx.lineTo(9.5, -2);
    ctx.lineTo(9.5, 2);
    ctx.lineTo(5, 4.6);
    ctx.lineTo(-8.5, 4.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // Bonnet panel line, headlights, spare wheel at the back.
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(4.2, -4.2);
    ctx.lineTo(4.2, 4.2);
    ctx.stroke();
    ctx.fillStyle = p.moving ? '#fff3c4' : '#d8d0ae';
    ctx.fillRect(8.6, -2.2, 1, 1.4);
    ctx.fillRect(8.6, 0.8, 1, 1.4);
    ctx.fillStyle = '#1a1b1b';
    circle(ctx, -8.8, 0, 2.1);
    ctx.fill();
    ctx.fillStyle = '#4a4c4c';
    circle(ctx, -8.8, 0, 0.8);
    ctx.fill();
    // Roll cage, driver, and a whip antenna with a pennant.
    ctx.strokeStyle = '#26292a';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(-4.5, -3.2, 7, 6.4);
    ctx.beginPath();
    ctx.moveTo(-4.5, -3.2);
    ctx.lineTo(2.5, 3.2);
    ctx.stroke();
    ctx.fillStyle = '#3c4334';
    circle(ctx, 0.8, 1.6, 1.4);
    ctx.fill();
    ctx.fillStyle = team.dark;
    ctx.fillRect(-7, -3.6, 1.6, 1.6);
    emblem(ctx, team, 6.4, 0, 1.3);
    hullDamage(ctx, hp, p.t, 17, 9, layer === 'all' ? 'both' : 'static');
    const sway = p.moving ? Math.sin(p.t * 11) * 1.4 : 0;
    ctx.strokeStyle = 'rgba(20,20,20,0.8)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-6.2, -2.8);
    ctx.quadraticCurveTo(-9, -3.5 + sway * 0.4, -12, -4 + sway);
    ctx.stroke();
    ctx.restore();
  }

  // Pintle machine gun.
  if (layer !== 'hull') {
    ctx.save();
    ctx.rotate(p.turret);
    const kick = firing ? Math.sin(p.t * 90) * 0.5 : 0;
    ctx.fillStyle = '#1c1e1f';
    ctx.fillRect(-1 + kick, -0.85, 9.5, 1.7);
    ctx.fillStyle = '#4a4e4f';
    ctx.fillRect(1.5 + kick, -1.4, 3, 2.8);
    ctx.fillStyle = '#3a3d3e';
    circle(ctx, -1.2, 0, 2.4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    if (firing) {
      ctx.fillStyle = 'rgba(255,230,140,0.9)';
      ctx.beginPath();
      ctx.moveTo(8.6 + kick, -1.4);
      ctx.lineTo(11.5, 0);
      ctx.lineTo(8.6 + kick, 1.4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawHauler(ctx: Ctx, team: Team, p: UnitPose, layer: Layer = 'all') {
  const hp = clamp01(p.hp, 1);
  if (layer !== 'turret') {
    bodyShadow(ctx, p.hull, 29, 22, 4);
    ctx.save();
    ctx.rotate(p.hull);
    treads(ctx, 28, 8.2, 5.4, p.t, p.moving);
    // Ore bed: hopper walls, ribs, the load.
    ctx.fillStyle = litGrad(ctx, p.hull, 10, '#6f777b', ART.metalDark);
    rrect(ctx, -14, -7.4, 18, 14.8, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = '#4b4640';
    ctx.fillRect(-12.4, -5.8, 14.6, 11.6);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 4; i++) ctx.fillRect(-11 + i * 3.8, -7.4, 0.9, 1.6);
    for (let i = 0; i < 4; i++) ctx.fillRect(-11 + i * 3.8, 5.8, 0.9, 1.6);
    if (p.cargo > 0.01) {
      const n = Math.ceil(clamp01(p.cargo, 0) * 8);
      for (let i = 0; i < n; i++) {
        const cx = -10.2 + (i % 4) * 3.6;
        const cy = -2.8 + Math.floor(i / 4) * 5.2;
        ctx.fillStyle = i % 3 === 0 ? ART.oreGlow : i % 2 ? ART.ore : ART.oreDark;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 2.5);
        ctx.lineTo(cx + 2.1, cy);
        ctx.lineTo(cx, cy + 2.5);
        ctx.lineTo(cx - 2.1, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Hydraulic rams tipping the bed.
    ctx.fillStyle = '#9ea5a8';
    ctx.fillRect(1.4, -6.6, 3.2, 1);
    ctx.fillRect(1.4, 5.6, 3.2, 1);
    // Cab.
    ctx.fillStyle = litGrad(ctx, p.hull, 7, team.light, team.dark);
    rrect(ctx, 4.4, -7.4, 10, 14.8, 2.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = 'rgba(160,220,255,0.8)';
    ctx.fillRect(10.8, -5.4, 2.2, 10.8);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(11, -5.2, 0.8, 4);
    ctx.fillStyle = ART.hazard;
    ctx.fillRect(4.4, -7.4, 1.6, 14.8);
    ctx.fillStyle = '#222';
    for (let i = 0; i < 4; i++) ctx.fillRect(4.4, -6.4 + i * 3.8, 1.6, 1.6);
    // Exhaust stack behind the cab and an amber beacon that turns while it drives.
    ctx.fillStyle = '#262625';
    circle(ctx, 6.8, -5.2, 1.3);
    ctx.fill();
    const beacon = p.moving ? 0.5 + 0.5 * Math.sin(p.t * 9) : 0.25;
    ctx.fillStyle = `rgba(255,170,40,${0.35 + 0.65 * beacon})`;
    circle(ctx, 7.6, 3.6, 1.2);
    ctx.fill();
    emblem(ctx, team, 8.2, 0, 1.6);
    hullDamage(ctx, hp, p.t, 26, 14, layer === 'all' ? 'both' : 'static');
    ctx.restore();
  }
}

/**
 * Infantry, from above: shadow, legs, pack, shoulders, arms, weapon, helmet. Idle, the weapon is
 * carried at port across the chest; firing, it is shouldered and pointing at the target with the
 * stance braced, and a short flash leaves the muzzle.
 */
function drawTrooper(ctx: Ctx, kind: TrooperKind, team: Team, p: UnitPose) {
  if (kind === 'spy' || kind === 'commando' || kind === 'engineer') {
    drawHeroTrooper(ctx, kind, team, p);
    return;
  }
  const hp = clamp01(p.hp, 1);
  const firing = p.firing ?? p.sinceShot < 0.15;
  const step = p.moving ? Math.sin(p.t * 16) : 0;
  ctx.scale(1.6, 1.6);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(1.6, 2.6, 5.2, 3.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(1.4, 2.4, 3.8, 2.6, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.rotate(p.turret);
  // Legs: striding when moving, braced apart when firing.
  ctx.strokeStyle = '#25261f';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (firing && !p.moving) {
    ctx.moveTo(-0.6, -1.4);
    ctx.lineTo(1.6, -2.6);
    ctx.moveTo(-0.6, 1.4);
    ctx.lineTo(-2.8, 2.4);
  } else {
    ctx.moveTo(-0.8, -1.4);
    ctx.lineTo(-0.8 + step * 2.6, -1.8);
    ctx.moveTo(-0.8, 1.4);
    ctx.lineTo(-0.8 - step * 2.6, 1.8);
  }
  ctx.stroke();
  // Pack.
  ctx.fillStyle = '#3c3f31';
  rrect(ctx, -3.6, -1.9, 2.2, 3.8, 0.8);
  ctx.fill();
  // Shoulders in team colour, lit on the side toward the light.
  ctx.fillStyle = litGrad(ctx, p.turret, 3, team.light, team.main);
  ctx.beginPath();
  ctx.ellipse(0, 0, 2.3, 3.5, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = team.dark;
  ctx.lineWidth = 0.7;
  ctx.stroke();
  // Arms and weapon.
  const skin = '#c8a07a';
  if (kind === 'rifleman') {
    if (firing) {
      ctx.strokeStyle = team.main;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0.2, -2.4);
      ctx.lineTo(3.6, 0.9);
      ctx.moveTo(0.2, 2.6);
      ctx.lineTo(1.6, 1.4);
      ctx.stroke();
      ctx.fillStyle = '#17181a';
      ctx.fillRect(0.4, 0.75, 7.8, 1.2);
      ctx.fillStyle = '#5a4630';
      ctx.fillRect(0.4, 0.75, 2.2, 1.3);
      ctx.fillStyle = skin;
      circle(ctx, 3.7, 1.1, 0.55);
      ctx.fill();
      if (p.sinceShot < 0.08) {
        ctx.fillStyle = 'rgba(255,235,150,0.95)';
        ctx.beginPath();
        ctx.moveTo(8.2, 0.3);
        ctx.lineTo(10.6, 1.35);
        ctx.lineTo(8.2, 2.4);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = '#17181a';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-0.8, 2.8);
      ctx.lineTo(4.6, -1.6);
      ctx.stroke();
      ctx.fillStyle = skin;
      circle(ctx, 1.6, 0.5, 0.55);
      ctx.fill();
    }
  } else {
    // Rocket tube on the shoulder: level and forward when firing, angled back when carried.
    ctx.save();
    if (!firing) ctx.rotate(-0.35);
    ctx.fillStyle = '#44503d';
    ctx.fillRect(-3.4, -3.4, 10.4, 2.4);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(-3.4, -3.4, 10.4, 0.7);
    ctx.fillStyle = '#1f241c';
    ctx.fillRect(6.4, -3.7, 1.5, 3);
    ctx.fillRect(-4, -3.6, 1, 2.8);
    ctx.fillStyle = ART.hazard;
    ctx.fillRect(1.8, -3.4, 0.8, 2.4);
    if (firing && p.sinceShot < 0.12) {
      // Back-blast.
      ctx.fillStyle = 'rgba(230,220,200,0.55)';
      circle(ctx, -6, -2.2, 2.2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,200,110,0.8)';
      circle(ctx, -4.8, -2.2, 1.1);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = skin;
    circle(ctx, firing ? 2.6 : 2, firing ? -1 : -0.6, 0.55);
    ctx.fill();
  }
  // Helmet with a team band.
  ctx.fillStyle = '#4b543f';
  circle(ctx, 0.4, 0, 1.9);
  ctx.fill();
  ctx.strokeStyle = team.light;
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.arc(0.4, 0, 1.55, -1.2, 1.2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  circle(ctx, -0.1, -0.6, 0.65);
  ctx.fill();
  ctx.restore();
  if (hp < 0.5) {
    // A field dressing, then a limp-and-smoulder.
    ctx.fillStyle = '#e9e4d6';
    ctx.fillRect(-1.6, -2.4, 1.6, 0.9);
    ctx.fillStyle = '#b8352a';
    ctx.fillRect(-1.1, -2.4, 0.6, 0.9);
    if (hp < 0.25) sparks(ctx, 0, -1, p.t, 2, 3);
  }
}

// ---------------------------------------------------------------------------------------------
// Heroes (campaign). Four silhouettes that read at a glance against line troops: the Spy is slim
// in a long coat and a wide hat, the Commando broad with a beret, a bandolier and a heavy gun, the
// Engineer in a hard hat and a hi-vis vest with a toolkit, and the Ace a larger prototype tank in
// gunmetal with team slashes, twin barrels and a commander's pennant. Every hero also carries a
// gold star and level pips (drawHeroBadge), drawn by the renderer over the stamp.

const GOLD = '#ffd34d';
const GOLD_DARK = '#8a6412';
/** Hero infantry are drawn a little larger than line troops (1.6). */
const HERO_SCALE: Record<string, number> = { spy: 1.85, commando: 2.0, engineer: 1.85 };

/** A five-pointed star centred on (x, y). */
export function starPath(ctx: Ctx, x: number, y: number, r: number, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 ? r * inner : r;
    if (i) ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    else ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
}

/** A playing-card spade, point up in the current frame: the Ace's emblem. */
export function spadePath(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.bezierCurveTo(x + s * 0.4, y - s * 0.5, x + s * 1.05, y - s * 0.15, x + s * 0.85, y + s * 0.35);
  ctx.bezierCurveTo(x + s * 0.7, y + s * 0.7, x + s * 0.25, y + s * 0.65, x + s * 0.08, y + s * 0.35);
  ctx.lineTo(x + s * 0.3, y + s);
  ctx.lineTo(x - s * 0.3, y + s);
  ctx.lineTo(x - s * 0.08, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.25, y + s * 0.65, x - s * 0.7, y + s * 0.7, x - s * 0.85, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 1.05, y - s * 0.15, x - s * 0.4, y - s * 0.5, x, y - s);
  ctx.closePath();
}

/**
 * The hero mark: a gold star with a dark edge, and five level pips beside it, filled up to
 * `level`. (x, y) is the star's centre, in world pixels; about 22 px wide in all.
 */
export function drawHeroBadge(ctx: Ctx, x: number, y: number, level: number): void {
  const lv = Math.max(1, Math.min(5, Math.round(level)));
  ctx.save();
  ctx.fillStyle = 'rgba(8,10,12,0.72)';
  rrect(ctx, x - 5, y - 4.6, 23, 9.2, 3);
  ctx.fill();
  starPath(ctx, x, y, 4.2);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const px = x + 6 + i * 2.6;
    ctx.fillStyle = i < lv ? GOLD : 'rgba(255,255,255,0.2)';
    if (i < lv) ctx.fillRect(px - 0.9, y - 2, 1.8, 4);
    else ctx.fillRect(px - 0.9, y - 1.2, 1.8, 2.4);
  }
  ctx.restore();
}

/** The Spy's cloak: a pale band sweeping across him and a few motes, drawn live over the stamp. */
function cloakShimmer(ctx: Ctx, t: number) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(-1.5, 0, 9, 9, 0, 0, TAU);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const ph = frac(t * 0.55);
  const bx = -14 + ph * 28;
  const g = ctx.createLinearGradient(bx - 2.2, -2.6, bx + 2.2, 2.6);
  g.addColorStop(0, 'rgba(150,210,255,0)');
  g.addColorStop(0.5, 'rgba(180,230,255,0.38)');
  g.addColorStop(1, 'rgba(150,210,255,0)');
  alpha(ctx, 1);
  ctx.fillStyle = g;
  ctx.fillRect(-10, -10, 20, 20);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#cfeeff';
  for (let i = 0; i < 5; i++) {
    const q = frac(t * 0.8 + i * 0.23);
    const a = i * 1.9 + t * 0.9;
    const d = 5 + 3 * Math.sin(t * 1.7 + i);
    alpha(ctx, Math.sin(q * Math.PI) * 0.55);
    ctx.fillRect(Math.cos(a) * d - 0.6, Math.sin(a) * d - q * 5 - 0.6, 1.2, 1.2);
  }
  alpha(ctx, 1);
  ctx.restore();
}

/** The Engineer's torch at work: a blue-white core, flickering, and sparks spitting off it. */
function weldSpark(ctx: Ctx, facing: number, t: number) {
  const sc = HERO_SCALE.engineer;
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  const lx = 5.6 * sc;
  const ly = -1.4 * sc;
  const x = lx * c - ly * s;
  const y = lx * s + ly * c;
  const f = 0.6 + 0.4 * Math.sin(t * 37) * Math.sin(t * 23);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
  g.addColorStop(0, `rgba(220,240,255,${0.9 * f})`);
  g.addColorStop(0.35, `rgba(120,190,255,${0.45 * f})`);
  g.addColorStop(1, 'rgba(80,140,255,0)');
  alpha(ctx, 1);
  ctx.fillStyle = g;
  ctx.fillRect(x - 7, y - 7, 14, 14);
  ctx.restore();
  sparks(ctx, x, y, t * 2.5, 5, 7);
}

function heroLegs(ctx: Ctx, colour: string, width: number, step: number, braced: boolean) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (braced) {
    ctx.moveTo(-0.6, -1.5);
    ctx.lineTo(1.8, -2.9);
    ctx.moveTo(-0.6, 1.5);
    ctx.lineTo(-3, 2.6);
  } else {
    ctx.moveTo(-0.8, -1.4);
    ctx.lineTo(-0.8 + step * 2.6, -1.8);
    ctx.moveTo(-0.8, 1.4);
    ctx.lineTo(-0.8 - step * 2.6, 1.8);
  }
  ctx.stroke();
}

function drawHeroTrooper(ctx: Ctx, kind: 'spy' | 'commando' | 'engineer', team: Team, p: UnitPose) {
  const hp = clamp01(p.hp, 1);
  const firing = p.firing ?? p.sinceShot < 0.15;
  const step = p.moving ? Math.sin(p.t * 16) : 0;
  const skin = '#c8a07a';
  const sc = HERO_SCALE[kind];
  ctx.scale(sc, sc);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(1.6, 2.6, kind === 'commando' ? 6 : 5.4, 3.8, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(1.4, 2.4, kind === 'commando' ? 4.4 : 3.8, 2.8, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.rotate(p.turret);

  if (kind === 'spy') {
    heroLegs(ctx, '#1d1d22', 1.3, step, false);
    // The long coat, flaring behind him with a split vent; a team-colour belt.
    ctx.fillStyle = litGrad(ctx, p.turret, 4, '#c4a874', '#6a5636');
    ctx.beginPath();
    ctx.moveTo(1.2, -1.9);
    ctx.quadraticCurveTo(0.2, -2.3, -1.2, -2.2);
    ctx.lineTo(-5.6 - step * 0.4, -2.8);
    ctx.lineTo(-6.0, -0.5);
    ctx.lineTo(-4.9, 0);
    ctx.lineTo(-6.0, 0.5);
    ctx.lineTo(-5.6 + step * 0.4, 2.8);
    ctx.lineTo(-1.2, 2.2);
    ctx.quadraticCurveTo(0.2, 2.3, 1.2, 1.9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.strokeStyle = team.main;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-1.6, -2.3);
    ctx.lineTo(-1.6, 2.3);
    ctx.stroke();
    // Turned-up collar.
    ctx.fillStyle = '#7d6745';
    ctx.beginPath();
    ctx.ellipse(-0.3, 0, 1.2, 2.2, 0, 0, TAU);
    ctx.fill();
    // Pistol arm out when firing; hands in pockets otherwise.
    if (firing) {
      ctx.strokeStyle = '#4a453d';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(0.2, 1.8);
      ctx.lineTo(3.6, 0.6);
      ctx.stroke();
      ctx.fillStyle = '#141416';
      ctx.fillRect(3.4, 0.25, 2.2, 0.8);
      ctx.fillStyle = skin;
      circle(ctx, 3.5, 0.65, 0.5);
      ctx.fill();
      if (p.sinceShot < 0.08) {
        ctx.fillStyle = 'rgba(255,235,150,0.95)';
        circle(ctx, 6.2, 0.65, 0.9);
        ctx.fill();
      }
    }
    // Wide-brimmed hat with a team band: the silhouette that names him.
    ctx.fillStyle = '#26231f';
    circle(ctx, 0.2, 0, 2.75);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.arc(0.2, 0, 2.55, Math.PI * 0.9, Math.PI * 1.6);
    ctx.stroke();
    ctx.fillStyle = '#423c34';
    ctx.beginPath();
    ctx.ellipse(0.3, 0, 1.75, 1.45, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = team.main;
    ctx.lineWidth = 0.55;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(-0.9, 0);
    ctx.lineTo(1.4, 0);
    ctx.stroke();
  } else if (kind === 'commando') {
    heroLegs(ctx, '#262b1d', 1.7, step, firing && !p.moving);
    // Broad shoulders in olive, team patches on each.
    ctx.fillStyle = litGrad(ctx, p.turret, 4, '#7c8a5a', '#3c4529');
    ctx.beginPath();
    ctx.ellipse(-0.2, 0, 2.8, 4.3, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.fillStyle = team.main;
    ctx.fillRect(-1.1, -4.1, 1.8, 1.1);
    ctx.fillRect(-1.1, 3.0, 1.8, 1.1);
    // Bandolier across the chest, brass rounds along it.
    ctx.strokeStyle = '#3d2b19';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-2.2, -3.2);
    ctx.lineTo(1.8, 3.3);
    ctx.stroke();
    ctx.fillStyle = '#e0b04a';
    for (let i = 0; i < 6; i++) {
      const f = 0.1 + i * 0.15;
      ctx.fillRect(-2.2 + 4 * f - 0.35, -3.2 + 6.5 * f - 0.35, 0.7, 0.7);
    }
    // The heavy gun: level and blazing when firing, carried low across the body otherwise.
    ctx.save();
    if (!firing) {
      ctx.translate(0.4, 0.6);
      ctx.rotate(-0.55);
    }
    ctx.strokeStyle = skin;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -3.2);
    ctx.lineTo(3.8, 0.9);
    ctx.moveTo(0, 3.2);
    ctx.lineTo(1.4, 2.2);
    ctx.stroke();
    ctx.fillStyle = '#1a1b1d';
    ctx.fillRect(0.2, 0.7, 6.4, 2.1);
    ctx.fillStyle = '#2b2d30';
    ctx.fillRect(6.4, 1.1, 4.2, 1.3);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 4; i++) ctx.fillRect(6.8 + i * 0.95, 1.2, 0.4, 0.4);
    ctx.fillStyle = '#4a5233';
    ctx.fillRect(1.6, 2.8, 2.2, 1.7);
    ctx.fillStyle = '#c99a3a';
    ctx.fillRect(2.2, 2.6, 0.5, 0.6);
    ctx.fillRect(2.9, 2.6, 0.5, 0.6);
    if (firing && p.sinceShot < 0.1) {
      ctx.fillStyle = 'rgba(255,235,150,0.95)';
      ctx.beginPath();
      ctx.moveTo(10.6, 0.3);
      ctx.lineTo(13.6, 1.75);
      ctx.lineTo(10.6, 3.2);
      ctx.lineTo(11.4, 1.75);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,170,70,0.9)';
      circle(ctx, 11, 1.75, 1.1);
      ctx.fill();
    }
    ctx.restore();
    // Head and a beret slumped to one side, with a gold cap badge.
    ctx.fillStyle = skin;
    circle(ctx, 0.5, 0, 1.6);
    ctx.fill();
    ctx.fillStyle = team.dark;
    ctx.beginPath();
    ctx.ellipse(0.1, -0.45, 2.05, 1.75, -0.3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.4;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    circle(ctx, 1.1, -1.1, 0.5);
    ctx.fill();
  } else {
    heroLegs(ctx, '#2c3a52', 1.4, step, false);
    // Toolkit in the left hand: a red box with a handle.
    ctx.fillStyle = '#b8352a';
    rrect(ctx, -0.6, 3.1, 3.2, 1.9, 0.4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(-0.6, 3.1, 3.2, 0.5);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.4;
    ctx.strokeRect(0.3, 2.7, 1.4, 0.5);
    // Shoulders in the hi-vis vest, reflective stripes across the back; team-colour sleeves.
    ctx.fillStyle = litGrad(ctx, p.turret, 3.5, '#ffc43a', '#d77d10');
    ctx.beginPath();
    ctx.ellipse(-0.1, 0, 2.4, 3.6, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.strokeStyle = '#eef3f4';
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(-1.3, -3.2);
    ctx.lineTo(-1.3, 3.2);
    ctx.moveTo(-0.2, -3.5);
    ctx.lineTo(-0.2, 3.5);
    ctx.stroke();
    // Torch arm forward (further when welding), the other down to the toolkit.
    ctx.strokeStyle = team.main;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(0.2, -2.6);
    ctx.lineTo(p.repairing ? 3.4 : 2.4, -1.6);
    ctx.moveTo(0.2, 2.6);
    ctx.lineTo(1, 3.2);
    ctx.stroke();
    ctx.strokeStyle = '#3b3e40';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(p.repairing ? 3.2 : 2.2, -1.6);
    ctx.lineTo(p.repairing ? 5.6 : 4.4, -1.4);
    ctx.stroke();
    ctx.fillStyle = skin;
    circle(ctx, p.repairing ? 3.3 : 2.3, -1.6, 0.5);
    ctx.fill();
    // Hard hat with a brim and a ridge, a team sticker on the side.
    ctx.fillStyle = '#e8b51f';
    circle(ctx, 0.3, 0, 2.35);
    ctx.fill();
    ctx.fillStyle = '#ffd94a';
    circle(ctx, 0.35, 0, 1.85);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,80,0,0.6)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-1.4, 0);
    ctx.lineTo(2.1, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    circle(ctx, -0.2, -0.8, 0.6);
    ctx.fill();
    ctx.fillStyle = team.main;
    ctx.fillRect(-0.4, 0.8, 1.1, 0.7);
  }
  ctx.restore();
  if (hp < 0.5) {
    ctx.fillStyle = '#e9e4d6';
    ctx.fillRect(-1.6, -2.6, 1.6, 0.9);
    ctx.fillStyle = '#b8352a';
    ctx.fillRect(-1.1, -2.6, 0.6, 0.9);
  }
}

function drawAce(ctx: Ctx, team: Team, p: UnitPose, layer: Layer = 'all') {
  const hp = clamp01(p.hp, 1);
  const firing = p.firing ?? p.sinceShot < 0.15;
  if (layer !== 'turret') {
    bodyShadow(ctx, p.hull, 30, 23, 4.5);
    ctx.save();
    ctx.rotate(p.hull);
    treads(ctx, 30, 8.6, 6, p.t, p.moving);
    // Side skirts over the tracks.
    ctx.fillStyle = '#22262a';
    ctx.fillRect(-13, -11.2, 24, 1.6);
    ctx.fillRect(-13, 9.6, 24, 1.6);
    // Gunmetal hull, team-colour slashes across it, gold trim.
    ctx.fillStyle = litGrad(ctx, p.hull, 12, '#68707a', '#24282d');
    rrect(ctx, -13.5, -7.6, 27, 15.2, 3);
    ctx.fill();
    ctx.save();
    rrect(ctx, -13.5, -7.6, 27, 15.2, 3);
    ctx.clip();
    ctx.fillStyle = team.main;
    for (let i = -2; i < 3; i++) {
      const x = i * 6.5;
      ctx.beginPath();
      ctx.moveTo(x - 1, -8);
      ctx.lineTo(x + 1.6, -8);
      ctx.lineTo(x - 2.4, 8);
      ctx.lineTo(x - 5, 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = '#d9b04a';
    ctx.lineWidth = 0.8;
    rrect(ctx, -12.6, -6.7, 25.2, 13.4, 2.4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    rrect(ctx, -13.5, -7.6, 27, 15.2, 3);
    ctx.stroke();
    // Wedge glacis, lit.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(8, -7.2);
    ctx.lineTo(13.2, -3.6);
    ctx.lineTo(13.2, 3.6);
    ctx.lineTo(8, 7.2);
    ctx.closePath();
    ctx.fill();
    // Engine deck with twin grilles, exhausts, headlights.
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(-12.6, -5.4, 5.6, 4.4);
    ctx.fillRect(-12.6, 1, 5.6, 4.4);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(-12.2 + i * 1.3, -5, 0.6, 3.6);
      ctx.fillRect(-12.2 + i * 1.3, 1.4, 0.6, 3.6);
    }
    ctx.fillStyle = '#2c2a28';
    ctx.fillRect(-14.2, -7, 2.2, 2.2);
    ctx.fillRect(-14.2, 4.8, 2.2, 2.2);
    ctx.fillStyle = p.moving ? '#fff3c4' : '#c9c2a2';
    ctx.fillRect(12.6, -6.4, 1.3, 1.8);
    ctx.fillRect(12.6, 4.6, 1.3, 1.8);
    hullDamage(ctx, hp, p.t, 27, 15, layer === 'all' ? 'both' : 'static');
    ctx.restore();
  }
  if (layer !== 'hull') {
    ctx.save();
    ctx.rotate(p.turret);
    const recoil = Math.max(0, 2.8 - p.sinceShot * 12);
    // Twin long barrels, firing together.
    for (const off of [-2, 2]) {
      ctx.save();
      ctx.translate(0, off);
      barrel(ctx, 5, 16, 2.4, recoil, firing);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.moveTo(-6.5, -5);
    ctx.lineTo(5, -5.6);
    ctx.lineTo(9.6, -1.4);
    ctx.lineTo(9.6, 3.2);
    ctx.lineTo(5, 7.6);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    // A long angular turret in gunmetal, a team chevron pointing forward.
    ctx.fillStyle = litGrad(ctx, p.turret, 8, '#8a939c', '#30353b');
    ctx.beginPath();
    ctx.moveTo(-8.5, -6);
    ctx.lineTo(4, -6.8);
    ctx.lineTo(8.8, -2.6);
    ctx.lineTo(8.8, 2.6);
    ctx.lineTo(4, 6.8);
    ctx.lineTo(-8.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = team.main;
    ctx.beginPath();
    ctx.moveTo(-1, -6.4);
    ctx.lineTo(4.5, 0);
    ctx.lineTo(-1, 6.4);
    ctx.lineTo(-3.6, 6.2);
    ctx.lineTo(1.6, 0);
    ctx.lineTo(-3.6, -6.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1f2327';
    ctx.fillRect(-10, -4.4, 2, 8.8);
    // Commander's cupola with a gold ring; the spade on the bustle.
    ctx.fillStyle = '#1f2a33';
    circle(ctx, -4.6, -2.4, 2.1);
    ctx.fill();
    ctx.strokeStyle = '#d9b04a';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.save();
    ctx.translate(-5, 3);
    ctx.rotate(Math.PI / 2);
    spadePath(ctx, 0, 0, 1.9);
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#9fd6ff';
    ctx.fillRect(4.2, -4.4, 1.4, 1.2);
    // The commander's pennant on a short mast, streaming behind.
    const flap = Math.sin(p.t * (p.moving ? 14 : 4)) * (p.moving ? 1.2 : 0.5);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-7.4, -4.6);
    ctx.lineTo(-7.4, -5.8);
    ctx.stroke();
    ctx.fillStyle = team.main;
    ctx.beginPath();
    ctx.moveTo(-7.4, -5.8);
    ctx.quadraticCurveTo(-11, -6.8 + flap, -15, -6.2 + flap * 1.4);
    ctx.lineTo(-7.4, -3.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // Whip antenna.
    const sway = p.moving ? Math.sin(p.t * 9) * 1.5 : 0.4;
    ctx.strokeStyle = 'rgba(20,20,20,0.75)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-7.5, 4.6);
    ctx.quadraticCurveTo(-11.5, 6 + sway * 0.5, -15, 7 + sway);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------------------------
// Structures

export interface BuildingPose {
  t: number;
  /** 0..1 while the structure rises after placement. */
  rise: number;
  lowPower: boolean;
  turret: number;
  sinceShot: number;
  /** Health fraction 0..1, for drawn damage. Missing means unhurt. */
  hp?: number;
  /** Producing something right now (refinery unloading, factory or barracks building). */
  working?: boolean;
}

export function drawBuilding(ctx: Ctx, kind: BuildingKind, owner: Owner, x: number, y: number, pose: BuildingPose): void {
  const spec = BUILDINGS[kind];
  const w = spec.w * TILE;
  const h = spec.h * TILE;
  const team = TEAM[owner];
  baseAlpha = ctx.globalAlpha;
  ctx.save();
  ctx.translate(x, y);
  if (pose.rise < 1) {
    // Rising out of the ground behind scaffolding.
    ctx.beginPath();
    ctx.rect(-4, h - (h + 8) * pose.rise, w + 8, (h + 8) * pose.rise + 4);
    ctx.clip();
  }
  // Ground shadow, cast down and to the right, with a soft outer edge.
  if (kind !== 'turret') {
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    rrect(ctx, 4, 5, w + 2, h + 2, 6);
    ctx.fill();
    ctx.fillStyle = ART.shadow;
    rrect(ctx, 5, 6, w - 2, h - 2, 4);
    ctx.fill();
  }
  const seed = (Math.round(x) * 7 + Math.round(y) * 13 + kind.charCodeAt(0) * 31) | 0;
  switch (kind) {
    case 'hq':
      drawHq(ctx, w, h, team, pose);
      break;
    case 'power':
      drawPower(ctx, w, h, team, pose);
      break;
    case 'refinery':
      drawRefinery(ctx, w, h, team, pose);
      break;
    case 'barracks':
      drawBarracks(ctx, w, h, team, pose);
      break;
    case 'factory':
      drawFactory(ctx, w, h, team, pose);
      break;
    case 'turret':
      drawTurret(ctx, w, h, team, pose);
      break;
    case 'uplink':
      drawUplink(ctx, w, h, team, pose);
      break;
  }
  buildingDamage(ctx, w, h, clamp01(pose.hp, 1), pose.t, seed);
  if (pose.rise < 1) {
    ctx.strokeStyle = 'rgba(230,190,60,0.85)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= w; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(230,190,60,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 8; j < h; j += 16) {
      ctx.moveTo(0, j);
      ctx.lineTo(w, j);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = baseAlpha;
}

/**
 * Damage on a structure: scorch first, then broken panels with sparks, then cracks, a gaping hole
 * and embers. Positions come from a hash of where the structure stands, so each one breaks its own
 * way but the same way every frame.
 */
function buildingDamage(ctx: Ctx, w: number, h: number, hp: number, t: number, seed: number) {
  if (hp >= 0.75) return;
  const small = w <= TILE;
  const r = (k: number) => hash(seed * 97 + k);
  const m = small ? 6 : 10;
  const n = hp < 0.25 ? 5 : hp < 0.5 ? 3 : 2;
  for (let i = 0; i < n; i++) scorch(ctx, m + r(i) * (w - m * 2), m + r(i + 20) * (h - m * 2), (small ? 5 : 8) + r(i + 40) * (small ? 3 : 8));
  if (hp < 0.5) {
    const holes = small ? 1 : hp < 0.25 ? 3 : 2;
    for (let i = 0; i < holes; i++) {
      const hx = m + r(i + 60) * (w - m * 2);
      const hy = m + r(i + 80) * (h - m * 2);
      brokenPanel(ctx, hx, hy, small ? 3 : 3.5 + r(i + 90) * 2.5, seed + i * 11);
      sparks(ctx, hx, hy - 1, t, small ? 2 : 3, seed + i);
    }
  }
  if (hp < 0.25) {
    // Cracks running across the roof.
    ctx.strokeStyle = 'rgba(15,12,10,0.7)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let c = 0; c < (small ? 1 : 3); c++) {
      let cx = r(c + 100) * w;
      let cy = r(c + 110) * h;
      ctx.moveTo(cx, cy);
      for (let k = 0; k < 4; k++) {
        cx += (r(c * 7 + k + 120) - 0.5) * (small ? 10 : 22);
        cy += (r(c * 7 + k + 140) - 0.5) * (small ? 10 : 22);
        ctx.lineTo(Math.max(2, Math.min(w - 2, cx)), Math.max(2, Math.min(h - 2, cy)));
      }
    }
    ctx.stroke();
    const bx = m + r(160) * (w - m * 2);
    const by = m + r(170) * (h - m * 2);
    brokenPanel(ctx, bx, by, small ? 4 : 7, seed + 77);
    embers(ctx, bx, by, small ? 5 : 9, t, seed);
    sparks(ctx, bx, by - 2, t + 0.3, 5, seed + 5);
  }
}

function slab(ctx: Ctx, w: number, h: number, inset = 2) {
  ctx.fillStyle = shade(ctx, 0, 0, w, h, ART.concreteLight, ART.concreteDark);
  rrect(ctx, inset, inset, w - inset * 2, h - inset * 2, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Lit top and left lip.
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.moveTo(inset + 1.5, h - inset - 3);
  ctx.lineTo(inset + 1.5, inset + 1.5);
  ctx.lineTo(w - inset - 3, inset + 1.5);
  ctx.stroke();
  // Expansion joints and a bolt at each corner.
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  for (let i = TILE; i < w; i += TILE) {
    ctx.moveTo(i, inset);
    ctx.lineTo(i, h - inset);
  }
  for (let j = TILE; j < h; j += TILE) {
    ctx.moveTo(inset, j);
    ctx.lineTo(w - inset, j);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (const [bx, by] of [
    [inset + 3, inset + 3],
    [w - inset - 4, inset + 3],
    [inset + 3, h - inset - 4],
    [w - inset - 4, h - inset - 4],
  ])
    ctx.fillRect(bx, by, 1.4, 1.4);
}

function block(ctx: Ctx, x: number, y: number, w: number, h: number, top: string | CanvasGradient, side: string, depth = 4) {
  ctx.fillStyle = side;
  ctx.fillRect(x, y + depth, w, h);
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h + depth - 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(x + 1.5, y + h - 1);
  ctx.lineTo(x + 1.5, y + 1.5);
  ctx.lineTo(x + w - 1.5, y + 1.5);
  ctx.stroke();
}

/** A status lamp with a soft glow while lit. `rate` is how fast it pulses; `blink` makes it on/off. */
function lamp(ctx: Ctx, x: number, y: number, on: boolean, colour: string, t: number, rate = 4, blink = false) {
  const a = !on ? 0.14 : blink ? (frac(t * rate * 0.16 + x * 0.013) < 0.5 ? 1 : 0.12) : 0.55 + 0.45 * Math.sin(t * rate + x);
  ctx.fillStyle = '#1e2120';
  circle(ctx, x, y, 2.1);
  ctx.fill();
  ctx.fillStyle = colour;
  if (a > 0.6) {
    alpha(ctx, (a - 0.5) * 0.5);
    circle(ctx, x, y, 4.6);
    ctx.fill();
  }
  alpha(ctx, a);
  circle(ctx, x, y, 1.5);
  ctx.fill();
  alpha(ctx, 1);
}

/** Smoke or steam puffing from a stack: four puffs rising and fading, cycling on t. */
function puffs(ctx: Ctx, x: number, y: number, t: number, strength: number, rgb = '128,126,120') {
  if (strength <= 0) return;
  for (let i = 0; i < 4; i++) {
    const ph = frac(t * 0.42 + i * 0.25);
    const px = x + ph * 8 + Math.sin(t * 1.3 + i * 2.1) * 1.4;
    const py = y - ph * 20;
    ctx.fillStyle = `rgba(${rgb},${(1 - ph) * 0.62 * strength})`;
    circle(ctx, px, py, 2 + ph * 5.5);
    ctx.fill();
  }
}

function stack(ctx: Ctx, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  circle(ctx, x + 2, y + 3, r);
  ctx.fill();
  ctx.fillStyle = '#6a6e6b';
  circle(ctx, x, y, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(x, y, r - 0.5, Math.PI, Math.PI * 1.6);
  ctx.stroke();
  ctx.fillStyle = '#1b1c1b';
  circle(ctx, x, y, r * 0.55);
  ctx.fill();
}

function hazardStripe(ctx: Ctx, x: number, y: number, w: number, h: number, step = 4) {
  for (let i = 0; i * step < w; i++) {
    ctx.fillStyle = i % 2 ? ART.hazard : '#222';
    ctx.fillRect(x + i * step, y, Math.min(step, w - i * step), h);
  }
}

function drawHq(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  const on = !p.lowPower;
  // Helipad with landing lights chasing round it.
  ctx.fillStyle = '#3a3e3c';
  circle(ctx, w - 22, h - 22, 15);
  ctx.fill();
  ctx.strokeStyle = ART.hazard;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  circle(ctx, w - 22, h - 22, 11);
  ctx.stroke();
  ctx.fillStyle = '#e8e8e0';
  ctx.fillRect(w - 27, h - 28, 2.4, 12);
  ctx.fillRect(w - 19.4, h - 28, 2.4, 12);
  ctx.fillRect(w - 25, h - 23.2, 6, 2.4);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const lit = on && Math.floor(frac(p.t * 0.8) * 6) === i;
    ctx.fillStyle = lit ? '#b8ff9a' : 'rgba(120,180,110,0.45)';
    circle(ctx, w - 22 + Math.cos(a) * 13, h - 22 + Math.sin(a) * 13, lit ? 1.6 : 1);
    ctx.fill();
  }
  // Annex with door and an exhaust vent.
  block(ctx, 64, 10, 24, 24, '#9aa09c', '#5f6562', 5);
  ctx.fillStyle = '#2d3130';
  ctx.fillRect(70, 33, 9, 6);
  ctx.fillStyle = on ? 'rgba(255,220,140,0.85)' : 'rgba(120,110,80,0.6)';
  ctx.fillRect(71.5, 34, 6, 1.2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (let i = 0; i < 4; i++) ctx.fillRect(67, 14 + i * 3, 10, 1.2);
  stack(ctx, 82, 16, 3);
  puffs(ctx, 82, 14, p.t, on ? 0.6 : 0.25);
  // Main command block.
  block(ctx, 10, 10, 50, 38, shade(ctx, 10, 10, 50, 38, team.light, team.main), team.dark, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(14, 14, 42, 7);
  for (let i = 0; i < 5; i++) {
    const flick = on ? 0.65 + 0.35 * (hash(i * 13 + Math.floor(p.t * 0.7)) > 0.25 ? 1 : 0.3) : 0.25;
    ctx.fillStyle = `rgba(170,230,255,${flick})`;
    ctx.fillRect(16 + i * 8, 15.5, 5, 4);
  }
  // Roof plant: two fans spinning, a hatch, the team mark.
  for (const fx of [18, 30]) {
    ctx.fillStyle = '#5b605d';
    ctx.fillRect(fx - 5, 26, 10, 10);
    ctx.fillStyle = '#2a2d2c';
    circle(ctx, fx, 31, 3.8);
    ctx.fill();
    ctx.strokeStyle = '#8a908c';
    ctx.lineWidth = 1;
    const a = on ? p.t * 7 : 0.3;
    ctx.beginPath();
    ctx.moveTo(fx + Math.cos(a) * 3.2, 31 + Math.sin(a) * 3.2);
    ctx.lineTo(fx - Math.cos(a) * 3.2, 31 - Math.sin(a) * 3.2);
    ctx.moveTo(fx + Math.cos(a + 1.57) * 3.2, 31 + Math.sin(a + 1.57) * 3.2);
    ctx.lineTo(fx - Math.cos(a + 1.57) * 3.2, 31 - Math.sin(a + 1.57) * 3.2);
    ctx.stroke();
  }
  ctx.fillStyle = team.dark;
  ctx.fillRect(38, 39, 9, 6);
  emblem(ctx, team, 50, 40, 4);
  // Antenna mast with crossbar and stays, red beacon on top.
  ctx.strokeStyle = 'rgba(30,32,34,0.5)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(50, 6);
  ctx.lineTo(43, 28);
  ctx.moveTo(50, 6);
  ctx.lineTo(57, 28);
  ctx.stroke();
  ctx.strokeStyle = '#2c3032';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(50, 28);
  ctx.lineTo(50, 4);
  ctx.moveTo(46, 11);
  ctx.lineTo(54, 11);
  ctx.stroke();
  lamp(ctx, 50, 4, on, '#ff4a3a', p.t, 4, true);
  // Supply crates.
  for (const [cx, cy] of [
    [42, 58],
    [50, 58],
    [46, 52],
  ]) {
    ctx.fillStyle = '#7d6a45';
    ctx.fillRect(cx, cy, 7, 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.7;
    ctx.strokeRect(cx + 0.5, cy + 0.5, 6, 5);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + 7, cy + 6);
    ctx.stroke();
  }
  // Crane: a lattice boom slewing slowly, with a hook on a cable.
  ctx.save();
  ctx.translate(22, 70);
  ctx.rotate(Math.sin(p.t * 0.4) * 0.6 - 0.6);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(1, 2, 34, 4);
  ctx.strokeStyle = ART.hazard;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(34, -1.2);
  ctx.moveTo(0, 2);
  ctx.lineTo(34, 1.2);
  for (let i = 0; i < 34; i += 4) {
    ctx.moveTo(i, -2 + i * 0.024);
    ctx.lineTo(i + 4, 2 - (i + 4) * 0.024);
  }
  ctx.stroke();
  ctx.fillStyle = '#2c3032';
  ctx.fillRect(-5, -5, 10, 10);
  ctx.fillStyle = ART.hazard;
  ctx.fillRect(-5, -5, 10, 2);
  ctx.fillStyle = '#222';
  ctx.fillRect(28, 2.5, 3, 3);
  ctx.restore();
}

function drawPower(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  const on = !p.lowPower;
  // Conduit between the two cores.
  ctx.strokeStyle = '#3a3f3d';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(26, 26);
  ctx.lineTo(38, 37);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(26, 25);
  ctx.lineTo(38, 36);
  ctx.stroke();
  // Transformer: a box with three insulators and an arc flickering between them.
  block(ctx, 38, 6, 20, 12, '#7f8582', '#545a57', 3);
  ctx.fillStyle = team.main;
  ctx.fillRect(38, 6, 20, 3);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#c9c2a8';
    circle(ctx, 42 + i * 6, 13, 1.6);
    ctx.fill();
    ctx.fillStyle = '#6b6450';
    circle(ctx, 42 + i * 6, 13, 0.7);
    ctx.fill();
  }
  if (on && frac(p.t * 1.7) < 0.12) {
    ctx.strokeStyle = 'rgba(190,230,255,0.9)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(42, 13);
    ctx.lineTo(45, 11.5);
    ctx.lineTo(48, 13);
    ctx.lineTo(51, 11.8);
    ctx.lineTo(54, 13);
    ctx.stroke();
  }
  // Control hut with a lit window and a beacon.
  block(ctx, 6, 42, 18, 14, team.main, team.dark, 3);
  ctx.fillStyle = on ? 'rgba(255,225,150,0.9)' : 'rgba(110,100,80,0.7)';
  ctx.fillRect(9, 47, 5, 3);
  ctx.fillRect(16, 47, 5, 3);
  lamp(ctx, 21, 44.5, on, '#ffb43a', p.t, 5, true);
  hazardStripe(ctx, 26, 56, 14, 3);
  // The two cores. Glow pulses when powered and drops to a guttering ember when short.
  for (const [cx, cy, s] of [
    [19, 20, 0],
    [44, 42, 1.7],
  ]) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    circle(ctx, cx + 3, cy + 4, 12);
    ctx.fill();
    const g = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, 12);
    g.addColorStop(0, '#d5d8d2');
    g.addColorStop(1, '#717773');
    ctx.fillStyle = g;
    circle(ctx, cx, cy, 11.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Ribs round the rim.
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      ctx.moveTo(cx + Math.cos(a) * 7.5, cy + Math.sin(a) * 7.5);
      ctx.lineTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11);
    }
    ctx.stroke();
    ctx.fillStyle = '#242827';
    circle(ctx, cx, cy, 7);
    ctx.fill();
    const glow = on ? 0.6 + 0.25 * Math.sin(p.t * 3 + s * 2) : 0.14 + (frac(p.t * 3.1 + s) < 0.08 ? 0.25 : 0);
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 6.5);
    cg.addColorStop(0, `rgba(255,236,170,${glow})`);
    cg.addColorStop(0.55, `rgba(255,180,60,${glow * 0.8})`);
    cg.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = cg;
    circle(ctx, cx, cy, 6.5);
    ctx.fill();
    puffs(ctx, cx, cy - 2, p.t + s, on ? 0.55 : 0.12, '235,235,230');
  }
}

function drawRefinery(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  const on = !p.lowPower;
  const work = !!p.working;
  // Conveyor from the shed down to the dock, rollers running while it unloads.
  ctx.fillStyle = '#232625';
  ctx.fillRect(41, 40, 14, 24);
  ctx.fillStyle = '#5a5f5c';
  ctx.fillRect(40, 40, 1.6, 24);
  ctx.fillRect(54.4, 40, 1.6, 24);
  const belt = work ? frac(p.t * 1.6) * 4 : 0;
  ctx.fillStyle = '#3e4341';
  for (let j = 40 + belt; j < 64; j += 4) ctx.fillRect(42, j, 12, 1.2);
  if (work) {
    for (let k = 0; k < 3; k++) {
      const oy = 40 + frac(p.t * 0.4 + k / 3) * 22;
      ctx.fillStyle = k % 2 ? ART.ore : ART.oreGlow;
      ctx.beginPath();
      ctx.moveTo(48, oy - 2);
      ctx.lineTo(50, oy);
      ctx.lineTo(48, oy + 2);
      ctx.lineTo(46, oy);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Processing shed with skylights and a team band.
  block(ctx, 6, 8, 50, 30, '#9aa09c', '#5f6562', 6);
  ctx.fillStyle = team.main;
  ctx.fillRect(6, 8, 50, 7);
  emblem(ctx, team, 12, 11.5, 2.6);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 0; i < 5; i++) ctx.fillRect(10 + i * 9, 19, 5, 15);
  ctx.fillStyle = work ? 'rgba(255,200,90,0.55)' : 'rgba(140,200,230,0.35)';
  for (let i = 0; i < 5; i++) ctx.fillRect(11 + i * 9, 20, 3, 4);
  // Chimney.
  stack(ctx, 62, 12, 3.6);
  puffs(ctx, 62, 10, p.t, work ? 0.9 : on ? 0.35 : 0.15);
  // Silo with ladder, rim and the ore glow at its mouth.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  circle(ctx, 79, 30, 15);
  ctx.fill();
  const g = ctx.createRadialGradient(71, 20, 2, 76, 26, 16);
  g.addColorStop(0, '#dcd7be');
  g.addColorStop(1, '#878269');
  ctx.fillStyle = g;
  circle(ctx, 76, 26, 15);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  circle(ctx, 76, 26, 10.5);
  ctx.stroke();
  ctx.strokeStyle = '#4f4c3e';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(88, 20);
  ctx.lineTo(88, 34);
  ctx.moveTo(90, 20);
  ctx.lineTo(90, 34);
  for (let j = 21; j < 34; j += 2.5) {
    ctx.moveTo(88, j);
    ctx.lineTo(90, j);
  }
  ctx.stroke();
  ctx.fillStyle = '#3b3a30';
  circle(ctx, 76, 26, 6);
  ctx.fill();
  alpha(ctx, (work ? 0.85 : 0.6) + 0.15 * Math.sin(p.t * (work ? 6 : 2)));
  ctx.fillStyle = ART.ore;
  circle(ctx, 76, 26, 4.6);
  ctx.fill();
  ctx.fillStyle = ART.oreGlow;
  circle(ctx, 75, 25, 1.8);
  ctx.fill();
  alpha(ctx, 1);
  lamp(ctx, 66, 40, on, work ? '#ffb43a' : '#7dff8a', p.t, 6, work);
  // Dock arm: a boom from the shed that swings out over the pad and dips while unloading.
  ctx.save();
  ctx.translate(30, 46);
  const reach = work ? 0.95 + 0.06 * Math.sin(p.t * 3) : 0.28;
  ctx.rotate(reach);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(2, 1, 30, 5);
  ctx.fillStyle = ART.hazard;
  ctx.fillRect(0, -2, 30, 4);
  ctx.fillStyle = '#222';
  for (let i = 4; i < 30; i += 6) ctx.fillRect(i, -2, 2, 4);
  ctx.fillStyle = '#4b504e';
  rrect(ctx, 26, -4, 8, 8, 1.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  if (work) {
    ctx.fillStyle = ART.oreGlow;
    alpha(ctx, 0.5 + 0.5 * Math.sin(p.t * 9));
    circle(ctx, 30, 0, 1.6);
    ctx.fill();
    alpha(ctx, 1);
  }
  ctx.fillStyle = '#2c3032';
  circle(ctx, 0, 0, 4);
  ctx.fill();
  ctx.fillStyle = '#8a908c';
  circle(ctx, 0, 0, 1.4);
  ctx.fill();
  ctx.restore();
  // Chute mouth.
  ctx.fillStyle = '#4b504e';
  ctx.fillRect(40, 58, 16, 6);
  hazardStripe(ctx, 40, 61, 16, 3);
}

/** The dock pad below a refinery, painted on the ground. */
export function drawDock(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = 'rgba(60,62,60,0.85)';
  ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 8, y + 6, TILE - 16, TILE - 12);
  ctx.strokeStyle = ART.hazard;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + TILE / 2 - 4, y + TILE / 2);
  ctx.lineTo(x + TILE / 2 + 4, y + TILE / 2);
  ctx.moveTo(x + TILE / 2, y + TILE / 2 - 4);
  ctx.lineTo(x + TILE / 2, y + TILE / 2 + 4);
  ctx.stroke();
}

function drawBarracks(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  const on = !p.lowPower;
  const work = !!p.working;
  // Sandbag ring, bag by bag.
  ctx.fillStyle = '#6f6447';
  rrect(ctx, 2, 2, w - 4, h - 4, 8);
  ctx.fill();
  ctx.strokeStyle = '#4e4530';
  ctx.lineWidth = 1;
  ctx.stroke();
  const bag = (bx: number, by: number, horiz: boolean) => {
    ctx.fillStyle = '#9a8a62';
    ctx.beginPath();
    ctx.ellipse(bx, by, horiz ? 3.4 : 2.4, horiz ? 2.4 : 3.4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(bx - 0.8, by - 0.8, horiz ? 1.8 : 1.1, horiz ? 1 : 1.8, 0, 0, TAU);
    ctx.fill();
  };
  for (let i = 8; i < w - 6; i += 6.5) {
    bag(i, 4.6, true);
    if (i < 22 || i > 42) bag(i, h - 4.6, true);
  }
  for (let j = 10; j < h - 8; j += 6.5) {
    bag(4.6, j, false);
    bag(w - 4.6, j, false);
  }
  ctx.fillStyle = '#665c40';
  rrect(ctx, 8, 8, w - 16, h - 16, 4);
  ctx.fill();
  // Two ridged tents.
  for (const tx of [10, 34]) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(tx + 2, 14, 20, 30);
    const g = ctx.createLinearGradient(tx, 0, tx + 20, 0);
    g.addColorStop(0, '#7a8a52');
    g.addColorStop(0.5, '#9aab70');
    g.addColorStop(0.52, '#5f6d3e');
    g.addColorStop(1, '#4f5a34');
    ctx.fillStyle = g;
    ctx.fillRect(tx, 12, 20, 30);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx + 0.5, 12.5, 19, 29);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let j = 18; j < 42; j += 6) {
      ctx.moveTo(tx + 1, j);
      ctx.lineTo(tx + 19, j);
    }
    ctx.stroke();
  }
  ctx.fillStyle = team.main;
  ctx.fillRect(10, 12, 20, 3);
  emblem(ctx, team, 44, 27, 3.4);
  // Ammunition crates and a lamp post.
  ctx.fillStyle = '#5d6a3a';
  ctx.fillRect(12, 46, 7, 5);
  ctx.fillRect(14, 43, 5, 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(12.5, 46.5, 6, 4);
  lamp(ctx, 47, 47, on, '#ffd27a', p.t, work ? 8 : 1.5, false);
  // Gate: canvas flaps closed, or drawn back on a lit doorway while it trains someone.
  if (work) {
    const g = ctx.createRadialGradient(32, h - 5, 0, 32, h - 5, 12);
    g.addColorStop(0, 'rgba(255,220,140,0.9)');
    g.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(20, h - 17, 24, 17);
    ctx.fillStyle = '#ffe1a0';
    ctx.fillRect(27, h - 9, 10, 7);
    ctx.fillStyle = '#556136';
    ctx.fillRect(24.5, h - 10, 2.5, 8);
    ctx.fillRect(37, h - 10, 2.5, 8);
  } else {
    ctx.fillStyle = '#3a3426';
    ctx.fillRect(26, h - 9, 12, 7);
    ctx.fillStyle = '#556136';
    ctx.fillRect(26, h - 9, 6, 7);
    ctx.fillRect(32, h - 9, 6, 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(32, h - 9);
    ctx.lineTo(32, h - 2);
    ctx.stroke();
  }
  // Flag.
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(57, 48);
  ctx.lineTo(57, 28);
  ctx.stroke();
  const wave = Math.sin(p.t * 5) * 1.5;
  ctx.fillStyle = team.main;
  ctx.beginPath();
  ctx.moveTo(57, 28);
  ctx.quadraticCurveTo(62, 29 + wave, 66, 28);
  ctx.lineTo(66, 35);
  ctx.quadraticCurveTo(62, 36 + wave, 57, 35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = team.light;
  ctx.fillRect(59, 30.5 + wave * 0.3, 4, 1.6);
}

function drawFactory(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  const on = !p.lowPower;
  const work = !!p.working;
  // Light spilling out of the bay onto the apron while it builds.
  if (work) {
    const g = ctx.createRadialGradient(48, h - 6, 2, 48, h - 2, 30);
    g.addColorStop(0, `rgba(255,170,80,${on ? 0.55 : 0.3})`);
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(18, h - 26, 60, 32);
  }
  // Hangar roof, ribbed, with skylights.
  block(ctx, 8, 6, w - 16, h - 30, '#848a87', '#565c59', 6);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 14; i < w - 10; i += 6) {
    ctx.moveTo(i, 15);
    ctx.lineTo(i, h - 26);
  }
  ctx.stroke();
  ctx.fillStyle = team.main;
  ctx.fillRect(8, 6, w - 16, 8);
  emblem(ctx, team, 48, 10, 3);
  ctx.fillStyle = work ? 'rgba(255,190,110,0.5)' : 'rgba(150,200,230,0.3)';
  ctx.fillRect(36, 40, 24, 5);
  ctx.fillRect(36, 50, 24, 5);
  // Roof vents with heat shimmer.
  for (const vx of [22, 74]) {
    ctx.fillStyle = '#3d4240';
    circle(ctx, vx, 30, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = on ? `rgba(255,140,60,${(work ? 0.5 : 0.3) + 0.2 * Math.sin(p.t * 6 + vx)})` : '#2a2a2a';
    circle(ctx, vx, 30, 3);
    ctx.fill();
  }
  // Chimney.
  stack(ctx, 80, 52, 3.8);
  puffs(ctx, 80, 50, p.t, work ? 0.95 : on ? 0.3 : 0.1);
  // Gantry crane on rails along the roof: traverses while a vehicle is on the line.
  ctx.fillStyle = '#4c524f';
  ctx.fillRect(12, 17, w - 24, 1.6);
  ctx.fillRect(12, 64, w - 24, 1.6);
  const gx = work ? 18 + (0.5 + 0.5 * Math.sin(p.t * 0.9)) * (w - 40) : 18;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(gx + 2, 18, 4, 49);
  ctx.fillStyle = ART.hazard;
  ctx.fillRect(gx, 16, 4, 51);
  ctx.fillStyle = '#222';
  for (let j = 20; j < 66; j += 7) ctx.fillRect(gx, j, 4, 2);
  const ty = work ? 41 + Math.sin(p.t * 1.7) * 14 : 30;
  ctx.fillStyle = '#2f3432';
  ctx.fillRect(gx - 2, ty - 3, 8, 6);
  ctx.fillStyle = work ? '#ffb43a' : '#556';
  ctx.fillRect(gx + 1, ty - 0.6, 2, 1.2);
  // Bay door: shutter half up and the line lit inside while building.
  ctx.fillStyle = '#242827';
  ctx.fillRect(28, h - 22, 40, 18);
  if (work) {
    const bay = ctx.createLinearGradient(0, h - 22, 0, h - 4);
    bay.addColorStop(0, 'rgba(255,150,60,0.4)');
    bay.addColorStop(1, 'rgba(255,200,120,0.95)');
    ctx.fillStyle = bay;
    ctx.fillRect(29, h - 14, 38, 10);
    ctx.fillStyle = '#4b514e';
    ctx.fillRect(28, h - 22, 40, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(40, h - 10, 16, 5);
  } else {
    ctx.fillStyle = '#4b514e';
    ctx.fillRect(28, h - 22, 40, 17);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let j = h - 20; j < (work ? h - 14 : h - 5); j += 2.5) {
    ctx.moveTo(29, j);
    ctx.lineTo(67, j);
  }
  ctx.stroke();
  hazardStripe(ctx, 28, h - 6, 40, 3);
  lamp(ctx, 25, h - 20, on, '#ffb43a', p.t, work ? 9 : 2, work);
  lamp(ctx, 71, h - 20, on, '#ffb43a', p.t + 0.5, work ? 9 : 2, work);
}

function drawTurret(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  const cx = w / 2;
  const cy = h / 2;
  const oct = (r: number, ox = 0, oy = 0) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      ctx.lineTo(cx + ox + Math.cos(a) * r, cy + oy + Math.sin(a) * r);
    }
    ctx.closePath();
  };
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  oct(15, 3, 4);
  ctx.fill();
  ctx.fillStyle = shade(ctx, cx - 15, cy - 15, 30, 30, '#9a9e9a', '#545855');
  oct(15);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#5f6360';
  oct(11.5);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.fillRect(cx + Math.cos(a) * 13.2 - 0.6, cy + Math.sin(a) * 13.2 - 0.6, 1.2, 1.2);
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.turret);
  const recoil = Math.max(0, 3 - p.sinceShot * 14);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(3 - recoil, 0, 16, 4.5);
  barrel(ctx, 2, 16, 4, recoil, p.sinceShot < 0.15);
  ctx.fillStyle = litGrad(ctx, p.turret, 8, team.light, team.dark);
  rrect(ctx, -7.5, -7, 13, 14, 3.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.fillStyle = '#1f2a33';
  circle(ctx, -2.5, -2, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.fillStyle = '#9fd6ff';
  ctx.fillRect(2, -5.2, 1.6, 1.4);
  emblem(ctx, team, -2, 3.2, 1.6);
  ctx.restore();
  lamp(ctx, cx + 10, cy + 10, !p.lowPower, '#ff4a3a', p.t, 4, true);
}

function drawUplink(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  const on = !p.lowPower;
  // Equipment house with racks of status lights.
  block(ctx, 6, 34, 28, 20, '#8d9390', '#5a605d', 5);
  ctx.fillStyle = team.main;
  ctx.fillRect(6, 34, 28, 5);
  emblem(ctx, team, 11, 36.5, 2);
  ctx.fillStyle = '#2a2e2d';
  ctx.fillRect(9, 42, 22, 9);
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 2; j++) {
      const lit = on && hash(i * 7 + j * 3 + Math.floor(p.t * 3 + i)) > 0.4;
      ctx.fillStyle = lit ? (j ? '#ffb43a' : '#7dff8a') : '#3c423f';
      ctx.fillRect(10.5 + i * 3.4, 44 + j * 3.6, 1.8, 1.6);
    }
  // Cable tray from the house to the mast.
  ctx.strokeStyle = '#2b2f2e';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(34, 46);
  ctx.lineTo(41, 46);
  ctx.stroke();
  // Secondary whip antenna.
  ctx.strokeStyle = '#2c3032';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(14, 34);
  ctx.lineTo(14, 14);
  ctx.stroke();
  lamp(ctx, 14, 13, on, '#ff4a3a', p.t, 3, true);
  // Mast.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(43, 32, 6, 22);
  ctx.fillStyle = '#3a3f3d';
  ctx.fillRect(41, 30, 6, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(41, 30, 1.5, 22);
  // Dish: a lit bowl with ribs and a feed horn on three struts, slewing while powered.
  ctx.save();
  ctx.translate(42, 24);
  const a = p.lowPower ? 0.4 : p.t * 0.8;
  ctx.rotate(a);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(2, 3, 16, 7.5, 0, 0, TAU);
  ctx.fill();
  const g = ctx.createLinearGradient(0, -7, 0, 7);
  g.addColorStop(0, '#f0f2ec');
  g.addColorStop(1, '#a8aea7');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 7.5, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const b = (k / 8) * TAU;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(b) * 15.5, Math.sin(b) * 7.2);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, 9.5, 4.4, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = '#2a2d2c';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-12, -2);
  ctx.lineTo(0, -10);
  ctx.moveTo(12, -2);
  ctx.lineTo(0, -10);
  ctx.moveTo(0, 6);
  ctx.lineTo(0, -10);
  ctx.stroke();
  ctx.fillStyle = '#2a2d2c';
  circle(ctx, 0, -10, 1.8);
  ctx.fill();
  ctx.restore();
  lamp(ctx, 42, 14, on, '#6cf5ff', p.t * 2, 4, false);
  lamp(ctx, 56, 56, on, '#7dff8a', p.t, 2, true);
}
