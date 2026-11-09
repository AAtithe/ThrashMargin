import { FLIGHT_TICKS, type Owner } from '../../sim/rules';
import { TEAM } from '../../theme';
import type { Particles } from './particles';
import { sprites } from './sprites';

/**
 * Renderer-only drawing for the advanced weapons: the missile strike (its warning marker on the
 * target and the missile in flight) and the flamethrower's jet. Like the rest of fx/, nothing here
 * is read by the simulation, so it may use Math.random and real time.
 */

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

/** Ticks from the call to the impact: the marker counts these down. */
export const MISSILE_ARC = FLIGHT_TICKS.missile;

/**
 * The target marker, drawn above the fog for both sides from the call until impact: a pulsing red
 * zone the size of the blast, a turning dashed ring, crosshairs, a sweep that empties as the
 * missile closes, and the seconds left. `f` runs 0..1 over the flight.
 */
export function drawMissileMarker(ctx: Ctx, x: number, y: number, r: number, f: number, secondsLeft: number, t: number): void {
  const urgent = f > 0.7;
  const pulse = 0.5 + 0.5 * Math.sin(t * (urgent ? 16 : 7));
  ctx.save();
  const zone = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
  zone.addColorStop(0, `rgba(255,60,40,${0.06 + 0.08 * pulse})`);
  zone.addColorStop(0.85, `rgba(255,60,40,${0.14 + 0.14 * pulse})`);
  zone.addColorStop(1, 'rgba(255,60,40,0)');
  ctx.fillStyle = zone;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  // Dark under-stroke so the ring reads on bright ground and on fog alike.
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(20,6,4,0.45)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([10, 7]);
  ctx.lineDashOffset = -t * 30;
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(255,90,70,${0.75 + 0.25 * pulse})`;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  // Time left: an arc that empties clockwise.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,215,120,0.9)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, 1 - f));
  ctx.stroke();
  // Crosshairs, broken at the centre.
  ctx.strokeStyle = 'rgba(255,110,90,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    ctx.moveTo(x + dx * r * 0.18, y + dy * r * 0.18);
    ctx.lineTo(x + dx * r * 1.15, y + dy * r * 1.15);
  }
  ctx.stroke();
  ctx.fillStyle = `rgba(255,80,60,${0.6 + 0.4 * pulse})`;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, TAU);
  ctx.fill();
  if (secondsLeft > 0) {
    const label = secondsLeft.toFixed(1);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20,6,4,0.8)';
    ctx.strokeText(label, x, y - r - 10);
    ctx.fillStyle = '#ffd9cf';
    ctx.fillText(label, x, y - r - 10);
  }
  ctx.restore();
}

/**
 * A missile on its way: it climbs out of the silo almost straight up, arcs high over the map and
 * streaks down on the target, a long smoke trail behind it. (x0, y0) and (x1, y1) are the silo and
 * the target in pixels; `f` runs 0..1 over the flight.
 */
export function drawMissileInFlight(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  f: number,
  t: number,
  owner: Owner,
  fx: Particles,
  dt: number,
  inView: (x: number, y: number, m?: number) => boolean,
): void {
  if (f <= 0 || f >= 1) return;
  const span = Math.hypot(x1 - x0, y1 - y0);
  const H = 240 + span * 0.18;
  const at = (q: number) => {
    const e = q * q;
    const gx = x0 + (x1 - x0) * e;
    const gy = y0 + (y1 - y0) * e;
    const z = H * 4 * q * (1 - q) * (1 - 0.35 * q);
    return { gx, gy, x: gx, y: gy - z, z };
  };
  const p = at(f);
  const q = at(Math.min(0.999, f + 0.01));
  const ang = Math.atan2(q.y - p.y, q.x - p.x);
  // The trail: smoke left in the air where it passed, and sparks off the motor.
  if (Math.random() < dt * 60) fx.add({ kind: 'smoke', x: p.gx, y: p.gy, z: p.z, vx: (Math.random() - 0.5) * 8, vz: 2, life: 2.2 + Math.random(), size: 3.2, grow: 3.4 });
  if (Math.random() < dt * 30) fx.add({ kind: 'fire', x: p.gx - Math.cos(ang) * 8, y: p.gy, z: p.z - Math.sin(ang) * 8, life: 0.25, size: 4, grow: 0.4 });
  if (!inView(p.x, p.y, 60) && !inView(p.gx, p.gy, 60)) return;
  // Its shadow on the ground, firming up as it comes down.
  if (f > 0.5) {
    ctx.fillStyle = `rgba(0,0,0,${0.35 * (f - 0.5) * 2})`;
    ctx.beginPath();
    ctx.ellipse(p.gx, p.gy, 7, 3, ang, 0, TAU);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  // Exhaust plume.
  ctx.globalCompositeOperation = 'lighter';
  const flick = 0.8 + 0.2 * Math.sin(t * 50);
  ctx.globalAlpha = flick;
  ctx.drawImage(sprites().fire, -30, -9, 20, 18);
  ctx.drawImage(sprites().fire, -22, -6, 12, 12);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // Body: white, a team-coloured band, a dark nose, four fins.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-11, -1.6, 2.6, 3.2);
  ctx.fillStyle = '#2a2d2e';
  ctx.beginPath();
  ctx.moveTo(-11, -2.4);
  ctx.lineTo(-6, -1.6);
  ctx.lineTo(-6, 1.6);
  ctx.lineTo(-11, 2.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ecebe4';
  ctx.fillRect(-10, -2, 16, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(-10, -2, 16, 1);
  ctx.fillStyle = TEAM[owner].main;
  ctx.fillRect(-2, -2, 2.4, 4);
  ctx.fillStyle = '#b8352a';
  ctx.beginPath();
  ctx.moveTo(6, -2);
  ctx.lineTo(11, 0);
  ctx.lineTo(6, 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * A flamethrower's jet, from the nozzle (12 pixels out from (x0, y0) toward the target) to the
 * target: a white-hot core that tapers off, wrapped in tongues of fire that widen and lick about.
 * `f` runs 0..1 over the jet's short life.
 */
export function flameJet(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, f: number, t: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const sx = x0 + ux * 12;
  const sy = y0 + uy * 12;
  const len = Math.max(4, d - 12);
  // The jet reaches out fast, then thins from the nozzle end as it dies.
  const reach = Math.min(1, f * 5);
  const tail = Math.max(0, (f - 0.45) / 0.55);
  const k = 1 - f * f;
  const fire = sprites().fire;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const n = 9;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    if (s > reach || s < tail) continue;
    const wob = Math.sin(t * 23 + i * 1.7) * (1.5 + s * 4);
    const px = sx + ux * len * s - uy * wob;
    const py = sy + uy * len * s + ux * wob;
    const r = 4 + s * 10 + Math.sin(t * 31 + i) * 1.2;
    ctx.globalAlpha = k * (0.55 + 0.35 * (1 - s));
    ctx.drawImage(fire, px - r, py - r, r * 2, r * 2);
  }
  // The core.
  if (reach > 0.2 && tail < 0.6) {
    const a = sx + ux * len * Math.max(tail, 0);
    const b = sy + uy * len * Math.max(tail, 0);
    const g = ctx.createLinearGradient(a, b, sx + ux * len * reach, sy + uy * len * reach);
    g.addColorStop(0, `rgba(255,250,225,${0.9 * k})`);
    g.addColorStop(0.6, `rgba(255,190,90,${0.5 * k})`);
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.globalAlpha = 1;
    ctx.strokeStyle = g;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(sx + ux * len * reach * 0.8, sy + uy * len * reach * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}
