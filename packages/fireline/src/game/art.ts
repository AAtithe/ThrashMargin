import type { BuildingKind, Owner, UnitKind } from '../sim/rules';
import { BUILDINGS } from '../sim/rules';
import { ART, TEAM } from '../theme';

/**
 * Every unit and structure, drawn with canvas paths. No image files: the same functions draw the
 * battlefield and the build menu's icons, at any scale and in either team's colours.
 *
 * Conventions: (x, y) is the centre of a unit, or the top-left of a structure, in pixels at
 * scale 1 where a tile is TILE pixels. Angles are radians, 0 pointing east.
 */

export const TILE = 32;

type Ctx = CanvasRenderingContext2D;

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

function shade(ctx: Ctx, x: number, y: number, w: number, h: number, light: string, dark: string) {
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  return g;
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
}

export function drawUnit(ctx: Ctx, kind: UnitKind, owner: Owner, x: number, y: number, pose: UnitPose): void {
  const team = TEAM[owner];
  ctx.save();
  ctx.translate(x, y);
  switch (kind) {
    case 'rifleman':
    case 'rocketeer':
      ctx.scale(1.45, 1.45);
      drawTrooper(ctx, kind, team, pose);
      break;
    case 'tank':
      drawTank(ctx, team, pose);
      break;
    case 'buggy':
      drawBuggy(ctx, team, pose);
      break;
    case 'hauler':
      drawHauler(ctx, team, pose);
      break;
    case 'artillery':
      drawArtillery(ctx, team, pose);
      break;
  }
  ctx.restore();
}

type Team = (typeof TEAM)[Owner];

function treads(ctx: Ctx, len: number, off: number, w: number, t: number, moving: boolean) {
  for (const side of [-1, 1]) {
    const y = side * off - w / 2;
    ctx.fillStyle = '#1d1f1f';
    rrect(ctx, -len / 2, y, len, w, 1.5);
    ctx.fill();
    ctx.strokeStyle = '#3b3e3e';
    ctx.lineWidth = 1;
    const phase = moving ? (t * 14) % 3 : 0;
    ctx.beginPath();
    for (let i = -len / 2 + phase; i < len / 2; i += 3) {
      ctx.moveTo(i, y + 0.5);
      ctx.lineTo(i, y + w - 0.5);
    }
    ctx.stroke();
  }
}

function drawTank(ctx: Ctx, team: Team, p: UnitPose) {
  // Shadow.
  ctx.fillStyle = ART.shadow;
  ctx.beginPath();
  ctx.ellipse(3, 4, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(p.hull);
  treads(ctx, 24, 7.5, 5, p.t, p.moving);
  ctx.fillStyle = shade(ctx, -10, -7, 20, 14, team.main, team.dark);
  rrect(ctx, -10.5, -6.5, 21, 13, 2.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Glacis plate and engine deck.
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(5, -5.5, 4.5, 11);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 3; i++) ctx.fillRect(-9 + i * 2.2, -4.5, 1.2, 9);
  ctx.restore();
  // Turret.
  ctx.save();
  ctx.rotate(p.turret);
  const recoil = Math.max(0, 2.5 - p.sinceShot * 12);
  ctx.fillStyle = '#2a2d2e';
  ctx.fillRect(3 - recoil, -1.6, 13, 3.2);
  ctx.fillStyle = '#1a1c1d';
  ctx.fillRect(14 - recoil, -2.1, 3, 4.2);
  ctx.fillStyle = shade(ctx, -6, -6, 12, 12, team.light, team.main);
  ctx.beginPath();
  ctx.moveTo(-6, -5);
  ctx.lineTo(3, -5.5);
  ctx.lineTo(6.5, -2);
  ctx.lineTo(6.5, 2);
  ctx.lineTo(3, 5.5);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
  ctx.fillStyle = team.dark;
  ctx.beginPath();
  ctx.arc(-2, -1.5, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawArtillery(ctx: Ctx, team: Team, p: UnitPose) {
  ctx.fillStyle = ART.shadow;
  ctx.beginPath();
  ctx.ellipse(3, 4, 12, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(p.hull);
  treads(ctx, 22, 6.5, 4, p.t, p.moving);
  ctx.fillStyle = shade(ctx, -9, -5, 18, 10, team.main, team.dark);
  rrect(ctx, -9.5, -5, 19, 10, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.rotate(p.turret);
  const recoil = Math.max(0, 4 - p.sinceShot * 10);
  ctx.fillStyle = '#2c2f30';
  ctx.fillRect(0 - recoil, -1.4, 21, 2.8);
  ctx.fillStyle = '#191b1c';
  ctx.fillRect(18 - recoil, -2, 3.5, 4);
  ctx.fillStyle = ART.metal;
  rrect(ctx, -6, -4.5, 10, 9, 2);
  ctx.fill();
  ctx.fillStyle = team.main;
  ctx.fillRect(-5, -4.5, 3, 9);
  ctx.restore();
}

function drawBuggy(ctx: Ctx, team: Team, p: UnitPose) {
  ctx.fillStyle = ART.shadow;
  ctx.beginPath();
  ctx.ellipse(2.5, 3.5, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(p.hull);
  ctx.fillStyle = '#151616';
  const bounce = p.moving ? Math.sin(p.t * 30) * 0.4 : 0;
  for (const [wx, wy] of [
    [-5.5, -5.5],
    [5, -5.5],
    [-5.5, 5.5],
    [5, 5.5],
  ]) {
    rrect(ctx, wx - 2.5, wy - 1.5 + bounce, 5, 3, 1);
    ctx.fill();
  }
  ctx.fillStyle = shade(ctx, -8, -4.5, 16, 9, team.light, team.main);
  ctx.beginPath();
  ctx.moveTo(-8, -4);
  ctx.lineTo(5, -4.5);
  ctx.lineTo(9, -2);
  ctx.lineTo(9, 2);
  ctx.lineTo(5, 4.5);
  ctx.lineTo(-8, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
  // Roll cage.
  ctx.strokeStyle = '#2b2d2e';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-4, -3, 6, 6);
  ctx.restore();
  ctx.save();
  ctx.rotate(p.turret);
  ctx.fillStyle = '#202223';
  ctx.fillRect(-1, -0.8, 9, 1.6);
  ctx.fillStyle = '#3a3d3e';
  ctx.beginPath();
  ctx.arc(-1, 0, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHauler(ctx: Ctx, team: Team, p: UnitPose) {
  ctx.fillStyle = ART.shadow;
  ctx.beginPath();
  ctx.ellipse(3, 4, 15, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(p.hull);
  treads(ctx, 27, 8, 5, p.t, p.moving);
  // Ore bed.
  ctx.fillStyle = ART.metalDark;
  rrect(ctx, -13, -7, 17, 14, 2);
  ctx.fill();
  ctx.fillStyle = '#56504a';
  ctx.fillRect(-11.5, -5.5, 14, 11);
  if (p.cargo > 0.01) {
    const n = Math.ceil(p.cargo * 7);
    for (let i = 0; i < n; i++) {
      const cx = -9.5 + (i % 4) * 3.4;
      const cy = -3 + Math.floor(i / 4) * 5;
      ctx.fillStyle = i % 2 ? ART.ore : ART.oreDark;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 2.4);
      ctx.lineTo(cx + 2, cy);
      ctx.lineTo(cx, cy + 2.4);
      ctx.lineTo(cx - 2, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Cab.
  ctx.fillStyle = shade(ctx, 4, -7, 10, 14, team.light, team.main);
  rrect(ctx, 4, -7, 10, 14, 2.5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(160,220,255,0.75)';
  ctx.fillRect(10.5, -5, 2, 10);
  ctx.fillStyle = ART.hazard;
  ctx.fillRect(4, -7, 1.5, 14);
  ctx.restore();
}

function drawTrooper(ctx: Ctx, kind: 'rifleman' | 'rocketeer', team: Team, p: UnitPose) {
  const step = p.moving ? Math.sin(p.t * 16) : 0;
  ctx.fillStyle = ART.shadow;
  ctx.beginPath();
  ctx.ellipse(1.5, 2.5, 4.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(p.turret);
  // Legs.
  ctx.strokeStyle = '#2a2a24';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-1, -1.5);
  ctx.lineTo(-1 - step * 2.5, -2);
  ctx.moveTo(-1, 1.5);
  ctx.lineTo(-1 + step * 2.5, 2);
  ctx.stroke();
  // Body.
  ctx.fillStyle = team.main;
  ctx.beginPath();
  ctx.ellipse(0, 0, 2.6, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = team.dark;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  if (kind === 'rifleman') {
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0.5, 1.4);
    ctx.lineTo(6.5, 1.4);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#3f4a3a';
    ctx.fillRect(-3, -3.6, 9.5, 2.4);
    ctx.fillStyle = '#20251e';
    ctx.fillRect(6, -3.8, 1.4, 2.8);
  }
  // Helmet.
  ctx.fillStyle = '#4a5240';
  ctx.beginPath();
  ctx.arc(0.4, 0, 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
}

export function drawBuilding(ctx: Ctx, kind: BuildingKind, owner: Owner, x: number, y: number, pose: BuildingPose): void {
  const spec = BUILDINGS[kind];
  const w = spec.w * TILE;
  const h = spec.h * TILE;
  const team = TEAM[owner];
  ctx.save();
  ctx.translate(x, y);
  if (pose.rise < 1) {
    // Rising out of the ground behind scaffolding.
    ctx.beginPath();
    ctx.rect(-4, h - (h + 8) * pose.rise, w + 8, (h + 8) * pose.rise + 4);
    ctx.clip();
  }
  // Ground shadow, cast down and to the right.
  ctx.fillStyle = ART.shadow;
  rrect(ctx, 5, 6, w - 2, h - 2, 4);
  ctx.fill();
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
  if (pose.rise < 1) {
    ctx.strokeStyle = 'rgba(230,190,60,0.85)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= w; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function slab(ctx: Ctx, w: number, h: number, inset = 2) {
  ctx.fillStyle = shade(ctx, 0, 0, w, h, ART.concreteLight, ART.concreteDark);
  rrect(ctx, inset, inset, w - inset * 2, h - inset * 2, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
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
}

function block(ctx: Ctx, x: number, y: number, w: number, h: number, top: string | CanvasGradient, side: string, depth = 4) {
  ctx.fillStyle = side;
  ctx.fillRect(x, y + depth, w, h);
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h + depth - 1);
}

function light(ctx: Ctx, x: number, y: number, on: boolean, colour: string, t: number) {
  const a = on ? 0.6 + 0.4 * Math.sin(t * 4 + x) : 0.15;
  ctx.fillStyle = colour;
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(x, y, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHq(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  // Helipad.
  ctx.fillStyle = '#3c403e';
  ctx.beginPath();
  ctx.arc(w - 22, h - 22, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ART.hazard;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#e8e8e0';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', w - 22, h - 21);
  // Main command block.
  block(ctx, 10, 10, 50, 38, shade(ctx, 10, 10, 50, 38, team.light, team.main), team.dark, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(14, 14, 42, 6);
  ctx.fillStyle = 'rgba(170,230,255,0.8)';
  for (let i = 0; i < 5; i++) ctx.fillRect(16 + i * 8, 15, 5, 4);
  // Antenna mast.
  ctx.strokeStyle = '#2c3032';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(50, 26);
  ctx.lineTo(50, 4);
  ctx.stroke();
  light(ctx, 50, 4, !p.lowPower, '#ff4a3a', p.t);
  // Crane arm, slewing slowly.
  ctx.save();
  ctx.translate(22, 70);
  ctx.rotate(Math.sin(p.t * 0.4) * 0.6 - 0.6);
  ctx.fillStyle = ART.hazard;
  ctx.fillRect(-2, -2, 34, 4);
  ctx.fillStyle = '#2c3032';
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();
}

function drawPower(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  for (const [cx, cy] of [
    [19, 20],
    [44, 42],
  ]) {
    ctx.fillStyle = '#5c625f';
    ctx.beginPath();
    ctx.arc(cx + 2, cy + 3, 12, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(cx - 3, cy - 3, 2, cx, cy, 12);
    g.addColorStop(0, '#c9ccc6');
    g.addColorStop(1, '#7c827e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2f2e';
    ctx.beginPath();
    ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
    ctx.fill();
    // Core glow.
    const glow = p.lowPower ? 0.2 : 0.55 + 0.25 * Math.sin(p.t * 3 + cx);
    ctx.fillStyle = `rgba(255, 200, 80, ${glow})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = team.main;
  ctx.fillRect(40, 8, 16, 6);
  ctx.fillRect(8, 44, 16, 6);
  ctx.strokeStyle = '#3a3f3d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(26, 26);
  ctx.lineTo(38, 37);
  ctx.stroke();
}

function drawRefinery(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  // Processing shed.
  block(ctx, 6, 8, 50, 30, '#9aa09c', '#5f6562', 6);
  ctx.fillStyle = team.main;
  ctx.fillRect(6, 8, 50, 7);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  for (let i = 0; i < 5; i++) ctx.fillRect(10 + i * 9, 19, 5, 15);
  // Silo.
  const g = ctx.createRadialGradient(72, 22, 2, 76, 26, 16);
  g.addColorStop(0, '#d6d1b8');
  g.addColorStop(1, '#8e8a72');
  ctx.fillStyle = '#5a5848';
  ctx.beginPath();
  ctx.arc(78, 29, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(76, 26, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ART.ore;
  ctx.globalAlpha = 0.7 + 0.3 * Math.sin(p.t * 2);
  ctx.beginPath();
  ctx.arc(76, 26, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Chute toward the dock pad below.
  ctx.fillStyle = '#4b504e';
  ctx.fillRect(40, 44, 16, 20);
  ctx.fillStyle = ART.hazard;
  for (let i = 0; i < 4; i++) ctx.fillRect(40 + i * 4, 58, 2, 6);
}

/** The dock pad below a refinery, painted on the ground. */
export function drawDock(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = 'rgba(60,62,60,0.85)';
  ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  ctx.strokeStyle = ART.hazard;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
  ctx.setLineDash([]);
}

function drawBarracks(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  // Sandbag ring.
  ctx.fillStyle = '#8d7d58';
  rrect(ctx, 2, 2, w - 4, h - 4, 8);
  ctx.fill();
  ctx.strokeStyle = '#5e5236';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#6f6447';
  rrect(ctx, 7, 7, w - 14, h - 14, 5);
  ctx.fill();
  // Two ridged tents.
  for (const tx of [10, 34]) {
    const g = ctx.createLinearGradient(tx, 0, tx + 20, 0);
    g.addColorStop(0, '#6c7a4a');
    g.addColorStop(0.5, '#93a36a');
    g.addColorStop(1, '#55613a');
    ctx.fillStyle = g;
    ctx.fillRect(tx, 12, 20, 30);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.strokeRect(tx + 0.5, 12.5, 19, 29);
    ctx.beginPath();
    ctx.moveTo(tx + 10, 12);
    ctx.lineTo(tx + 10, 42);
    ctx.stroke();
  }
  // Door gap and flag.
  ctx.fillStyle = '#3a3426';
  ctx.fillRect(26, h - 9, 12, 7);
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(57, 48);
  ctx.lineTo(57, 30);
  ctx.stroke();
  const wave = Math.sin(p.t * 5) * 1.5;
  ctx.fillStyle = team.main;
  ctx.beginPath();
  ctx.moveTo(57, 30);
  ctx.quadraticCurveTo(62, 31 + wave, 66, 30);
  ctx.lineTo(66, 37);
  ctx.quadraticCurveTo(62, 38 + wave, 57, 37);
  ctx.closePath();
  ctx.fill();
}

function drawFactory(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  // Hangar roof, ribbed.
  block(ctx, 8, 6, w - 16, h - 30, '#848a87', '#565c59', 6);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 14; i < w - 10; i += 6) {
    ctx.moveTo(i, 8);
    ctx.lineTo(i, h - 26);
  }
  ctx.stroke();
  ctx.fillStyle = team.main;
  ctx.fillRect(8, 6, w - 16, 8);
  // Bay door with hazard edge, on the south face where vehicles roll out.
  ctx.fillStyle = '#2b2f2e';
  ctx.fillRect(28, h - 22, 40, 18);
  ctx.fillStyle = ART.hazard;
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? ART.hazard : '#222';
    ctx.fillRect(28 + i * 4, h - 6, 4, 3);
  }
  // Roof vents with a little heat shimmer.
  for (const vx of [22, 70]) {
    ctx.fillStyle = '#3d4240';
    ctx.beginPath();
    ctx.arc(vx, 30, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.lowPower ? '#2a2a2a' : `rgba(255,140,60,${0.35 + 0.2 * Math.sin(p.t * 6 + vx)})`;
    ctx.beginPath();
    ctx.arc(vx, 30, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTurret(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  const cx = w / 2;
  const cy = h / 2;
  ctx.fillStyle = '#6e726f';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ctx.lineTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.turret);
  const recoil = Math.max(0, 3 - p.sinceShot * 14);
  ctx.fillStyle = '#232627';
  ctx.fillRect(2 - recoil, -2, 16, 4);
  const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, 9);
  g.addColorStop(0, team.light);
  g.addColorStop(1, team.dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.restore();
}

function drawUplink(ctx: Ctx, w: number, h: number, team: Team, p: BuildingPose) {
  slab(ctx, w, h);
  block(ctx, 8, 34, 26, 18, '#8d9390', '#5a605d', 5);
  ctx.fillStyle = team.main;
  ctx.fillRect(8, 34, 26, 5);
  // Rotating dish on a mast.
  ctx.fillStyle = '#3a3f3d';
  ctx.fillRect(41, 30, 6, 22);
  ctx.save();
  ctx.translate(40, 24);
  ctx.rotate(p.lowPower ? 0.4 : p.t * 0.8);
  ctx.fillStyle = '#d5d8d2';
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  ctx.fillStyle = '#9aa09a';
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a2d2c';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -9);
  ctx.stroke();
  ctx.restore();
  light(ctx, 40, 15, !p.lowPower, '#6cf5ff', p.t * 2);
}
