import { BUILDINGS, POWERS } from '../../sim/rules';
import type { Effect, GameState } from '../../sim/types';
import { TEAM } from '../../theme';
import { TILE } from '../art';
import type { Particles } from './particles';

/**
 * The campaign's battlefield effects: hero abilities and support powers. Drawn in world pixels by
 * the renderer, between the units and the fog. Like the rest of the renderer these may use
 * Math.random and real time; the simulation never reads them.
 *
 * `age` is in ticks since the effect was made (fractional, interpolated), and `t` is seconds of
 * real time, for pulsing.
 */

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const GOLD = '#ffd34d';

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How long each effect is drawn, in ticks. */
const LIFE: Partial<Record<Effect['kind'], number>> = {
  infiltrate: 30,
  captured: 24,
  charge: 10,
  levelup: 26,
  recon: 22,
  barrage: 48,
  reinforce: 30,
};

/** Particles that start when an effect first appears. */
export function startCampaignEffect(e: Effect, fx: Particles): void {
  const x = e.x * TILE;
  const y = e.y * TILE;
  switch (e.kind) {
    case 'infiltrate':
      for (let i = 0; i < 5; i++) fx.smoke(x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 10, 0.9);
      for (let i = 0; i < 6; i++) fx.spark(x, y);
      break;
    case 'charge':
      for (let i = 0; i < 5; i++) fx.spark(x, y);
      break;
    case 'captured':
      for (let i = 0; i < 10; i++) fx.spark(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30);
      break;
    case 'levelup':
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        fx.add({ kind: 'ember', x, y, z: 6, vx: Math.cos(a) * 26, vy: Math.sin(a) * 18, vz: 50 + Math.random() * 40, life: 0.7 + Math.random() * 0.4, size: 1.6 });
      }
      break;
    case 'reinforce':
      for (let i = 0; i < 16; i++) fx.dust(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 40, 1.6);
      break;
  }
}

/** One frame of a campaign effect. */
export function drawCampaignEffect(ctx: Ctx, e: Effect, age: number, s: GameState, t: number): void {
  const life = LIFE[e.kind];
  if (!life || age < 0 || age > life) return;
  const f = age / life;
  const x = e.x * TILE;
  const y = e.y * TILE;
  ctx.save();
  switch (e.kind) {
    case 'infiltrate': {
      // A ring closing in on the door, then a stream of data glyphs rising off the structure.
      ctx.strokeStyle = `rgba(150,230,255,${(1 - f) * 0.9})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, 18 * (1 - f) + 4, 0, TAU);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      for (let c = 0; c < 4; c++) {
        const cx = x - 9 + c * 6;
        for (let k = 0; k < 5; k++) {
          const rise = (age * 1.6 + k * 7 + c * 3) % 34;
          const a = (1 - rise / 34) * (1 - f);
          const bit = hash(e.id * 31 + c * 7 + k + Math.floor(age / 3)) > 0.5;
          ctx.fillStyle = `rgba(110,255,200,${a})`;
          if (bit) ctx.fillRect(cx - 0.8, y - 6 - rise, 1.6, 4);
          else ctx.strokeRect(cx - 1.5, y - 6 - rise, 3, 4);
          ctx.strokeStyle = `rgba(110,255,200,${a})`;
          ctx.lineWidth = 0.8;
        }
      }
      // A little signal glyph above it all.
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(190,255,230,${1 - f})`;
      ctx.lineWidth = 1.4;
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.arc(x, y - 30, k * 3.2, -Math.PI * 0.8, -Math.PI * 0.2);
        ctx.stroke();
      }
      break;
    }
    case 'captured': {
      // A wash of the new owner's colour over the structure, and its outline ringing outwards.
      const b = s.buildings.find(v => {
        const spec = BUILDINGS[v.kind];
        return e.x >= v.x && e.y >= v.y && e.x < v.x + spec.w && e.y < v.y + spec.h;
      });
      const team = TEAM[b ? b.owner : 0];
      if (b) {
        const spec = BUILDINGS[b.kind];
        const bx = b.x * TILE;
        const by = b.y * TILE;
        const w = spec.w * TILE;
        const h = spec.h * TILE;
        ctx.globalAlpha = (1 - f) * 0.55;
        ctx.fillStyle = team.main;
        ctx.fillRect(bx, by, w, h);
        ctx.globalAlpha = 1 - f;
        ctx.strokeStyle = team.light;
        ctx.lineWidth = 2;
        const g = f * 14;
        ctx.strokeRect(bx - g, by - g, w + g * 2, h + g * 2);
      } else {
        ctx.globalAlpha = (1 - f) * 0.5;
        ctx.fillStyle = team.main;
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'charge': {
      ctx.strokeStyle = `rgba(255,80,60,${1 - f})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 4 + f * 16, 0, TAU);
      ctx.stroke();
      break;
    }
    case 'levelup': {
      // A gold ring bursting outwards, rays, and a double chevron rising and fading.
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
      g.addColorStop(0, `rgba(255,220,110,${0.55 * (1 - f)})`);
      g.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 26, y - 26, 52, 52);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(255,214,90,${1 - f})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6 + f * 24, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        ctx.moveTo(x + Math.cos(a) * (8 + f * 14), y + Math.sin(a) * (8 + f * 14));
        ctx.lineTo(x + Math.cos(a) * (12 + f * 22), y + Math.sin(a) * (12 + f * 22));
      }
      ctx.stroke();
      const cy = y - 14 - f * 22;
      ctx.globalAlpha = f < 0.7 ? 1 : (1 - f) / 0.3;
      ctx.lineJoin = 'miter';
      for (let i = 0; i < 2; i++) {
        const yy = cy + i * 5;
        ctx.beginPath();
        ctx.moveTo(x - 7, yy);
        ctx.lineTo(x, yy - 5);
        ctx.lineTo(x + 7, yy);
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
      break;
    }
    case 'recon': {
      // Radar rings racing out to the sweep's radius.
      const R = POWERS.recon.radius * TILE;
      for (let k = 0; k < 3; k++) {
        const q = f * 1.4 - k * 0.2;
        if (q <= 0 || q >= 1) continue;
        ctx.strokeStyle = `rgba(140,255,190,${(1 - q) * 0.8})`;
        ctx.lineWidth = 2.4 - k * 0.6;
        ctx.beginPath();
        ctx.arc(x, y, R * q, 0, TAU);
        ctx.stroke();
      }
      break;
    }
    case 'barrage': {
      // The target area marked, then eight shells dropping in out of the sky across it.
      const R = POWERS.barrage.radius * TILE;
      ctx.strokeStyle = `rgba(255,90,70,${0.6 * (1 - f) + 0.2 * Math.sin(t * 10) ** 2})`;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -t * 20;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 8; i++) {
        const land = 4 + i * 5;
        const q = (age - (land - 9)) / 9;
        if (q < 0 || q > 1.25) continue;
        const a = hash(e.id * 17 + i) * TAU;
        const d = Math.sqrt(hash(e.id * 23 + i * 5)) * R;
        const tx = x + Math.cos(a) * d;
        const ty = y + Math.sin(a) * d * 0.8;
        if (q <= 1) {
          // Its shadow sharpening on the ground; the shell and its streak falling from above.
          ctx.fillStyle = `rgba(0,0,0,${0.15 + q * 0.3})`;
          ctx.beginPath();
          ctx.ellipse(tx, ty, 2 + q * 3, 1.4 + q * 2, 0, 0, TAU);
          ctx.fill();
          const lift = (1 - q) * 170;
          const hx = tx + (1 - q) * 30;
          const hy = ty - lift;
          const grad = ctx.createLinearGradient(hx + 8, hy - 26, hx, hy);
          grad.addColorStop(0, 'rgba(255,240,200,0)');
          grad.addColorStop(1, 'rgba(255,240,200,0.75)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(hx + 8, hy - 26);
          ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.fillStyle = '#fff1c4';
          ctx.beginPath();
          ctx.arc(hx, hy, 2.2, 0, TAU);
          ctx.fill();
        } else {
          const k = (q - 1) / 0.25;
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, 22);
          g.addColorStop(0, `rgba(255,230,160,${1 - k})`);
          g.addColorStop(1, 'rgba(255,140,60,0)');
          ctx.fillStyle = g;
          ctx.fillRect(tx - 22, ty - 22, 44, 44);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      break;
    }
    case 'reinforce': {
      // Dust rolling out where the column comes in, and a green signal smoke marker.
      ctx.fillStyle = `rgba(160,140,105,${0.35 * (1 - f)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 18 + f * 40, 12 + f * 26, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(125,255,138,${1 - f})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x, y, 10 + f * 18, 7 + f * 12, 0, 0, TAU);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * The Engineer capturing a structure: a dashed tether from him to it and a ring around it filling
 * with his colour as the capture goes on.
 */
export function drawCaptureRing(ctx: Ctx, ux: number, uy: number, bx: number, by: number, bw: number, bh: number, progress: number, colour: string, t: number): void {
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const R = Math.max(bw, bh) * 0.5 + 8;
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.lineDashOffset = -t * 18;
  ctx.strokeStyle = 'rgba(255,214,90,0.8)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(ux, uy);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + progress * TAU);
  ctx.stroke();
  // The leading edge glints.
  const a = -Math.PI / 2 + progress * TAU;
  ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 12)})`;
  ctx.beginPath();
  ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 2.4, 0, TAU);
  ctx.fill();
  // Twelve ticks around the ring.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const q = (i / 12) * TAU;
    ctx.moveTo(cx + Math.cos(q) * (R - 5), cy + Math.sin(q) * (R - 5));
    ctx.lineTo(cx + Math.cos(q) * (R - 3), cy + Math.sin(q) * (R - 3));
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * A demolition charge planted on a structure: a satchel with a red light blinking faster as the
 * fuse runs down, and a ring around it emptying with the time left (`left`, 1 just planted, 0 at
 * the blast).
 */
export function drawChargeOnBuilding(ctx: Ctx, px: number, py: number, w: number, h: number, left: number, t: number): void {
  const cx = px + w / 2;
  const cy = py + h / 2;
  const rate = 3 + (1 - left) * 9;
  const on = Math.sin(t * rate * TAU) > 0;
  ctx.save();
  if (on) {
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
    g.addColorStop(0, 'rgba(255,70,50,0.55)');
    g.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 22, cy - 22, 44, 44);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 13, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = '#ff5a46';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(cx, cy, 13, -Math.PI / 2, -Math.PI / 2 + left * TAU);
  ctx.stroke();
  // The satchel: olive canvas, a strap, a timer face and the light.
  ctx.fillStyle = '#4c5232';
  ctx.fillRect(cx - 6, cy - 4, 12, 8);
  ctx.strokeStyle = '#1a1a14';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(cx - 6, cy - 4, 12, 8);
  ctx.fillStyle = '#2b2a22';
  ctx.fillRect(cx - 6, cy - 1, 12, 1.4);
  ctx.fillStyle = '#111';
  ctx.fillRect(cx - 3.5, cy - 3, 5, 3);
  ctx.fillStyle = on ? '#ff3b2a' : '#5a1510';
  ctx.beginPath();
  ctx.arc(cx + 3.5, cy - 1.5, 1.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** The Ace in overdrive: a hot glow under the tank, pulsing, and speed streaks off its tail. */
export function drawOverdriveGlow(ctx: Ctx, x: number, y: number, hull: number, t: number, secondsLeft: number): void {
  const fade = Math.max(0, Math.min(1, secondsLeft / 1.5));
  const pulse = 0.75 + 0.25 * Math.sin(t * 14);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 4, x, y, 30);
  g.addColorStop(0, `rgba(255,170,60,${0.5 * pulse * fade})`);
  g.addColorStop(0.6, `rgba(255,110,40,${0.22 * pulse * fade})`);
  g.addColorStop(1, 'rgba(255,90,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 30, y - 30, 60, 60);
  ctx.translate(x, y);
  ctx.rotate(hull);
  ctx.strokeStyle = `rgba(255,200,120,${0.5 * fade})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const off = -7 + i * 4.6;
    const ph = (t * 3 + i * 0.27) % 1;
    const x0 = -16 - ph * 14;
    ctx.moveTo(x0, off);
    ctx.lineTo(x0 - 8, off);
  }
  ctx.stroke();
  ctx.restore();
}

/** A recon sweep over its area: a soft disc, a dashed rim turning, and a radar arm sweeping round. */
export function drawReconArea(ctx: Ctx, cx: number, cy: number, r: number, t: number, secondsLeft: number): void {
  const fade = Math.max(0, Math.min(1, secondsLeft / 2));
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
  g.addColorStop(0, 'rgba(120,255,170,0)');
  g.addColorStop(1, `rgba(120,255,170,${0.12 * fade})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = `rgba(140,255,190,${0.55 * fade})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -t * 16;
  ctx.stroke();
  ctx.setLineDash([]);
  // The sweeping arm and its fading trail.
  const a = t * 1.6;
  for (let k = 0; k < 10; k++) {
    const q = a - k * 0.06;
    ctx.strokeStyle = `rgba(150,255,190,${(0.5 - k * 0.05) * fade})`;
    ctx.lineWidth = k === 0 ? 2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(q) * r, cy + Math.sin(q) * r);
    ctx.stroke();
  }
  ctx.restore();
}
