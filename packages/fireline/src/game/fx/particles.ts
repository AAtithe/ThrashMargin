import { sprites } from './sprites';

/**
 * Renderer-only particles: fire, smoke, dust, sparks, and debris that flies in a fake third
 * dimension (z, with gravity) and bounces on the ground. Nothing here is read by the simulation,
 * so it may use Math.random and wall-clock time freely.
 *
 * Two lists. `ground` holds things painted flat on the battlefield under the units (the light a
 * blast throws on the ground, its shockwave ring); `air` holds everything that rises or flies and
 * is drawn over them. Both are capped, oldest first out, so a long firefight cannot grow them
 * without bound.
 */

export type AirKind = 'fire' | 'fireball' | 'smoke' | 'dust' | 'debris' | 'spark' | 'ember';

export interface AirParticle {
  kind: AirKind;
  x: number;
  y: number;
  /** Height above the ground, in pixels; drawn at y - z. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  /** How much the size grows over the particle's life (multiplier at the end). */
  grow: number;
  /** Seconds before it appears, so a smoke column can follow its fireball. */
  delay: number;
  rot: number;
  vr: number;
  bounces: number;
  /** 0..1 shade for debris, so not every chunk is the same colour. */
  tone: number;
}

export interface GroundFx {
  /** 'burn' is burning ground: a flickering glow that keeps throwing up flames while it lasts. */
  kind: 'flash' | 'ring' | 'burn';
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  strength: number;
}

const MAX_AIR = 1100;
const MAX_GROUND = 120;
const GRAVITY = 340;

export class Particles {
  air: AirParticle[] = [];
  ground: GroundFx[] = [];

  add(p: Partial<AirParticle> & { kind: AirKind; x: number; y: number; life: number; size: number }): void {
    this.air.push({
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      max: p.life,
      grow: 1,
      delay: 0,
      rot: 0,
      vr: 0,
      bounces: 0,
      tone: Math.random(),
      ...p,
    });
  }

  addGround(kind: GroundFx['kind'], x: number, y: number, r: number, life: number, strength = 1): void {
    this.ground.push({ kind, x, y, r, life, max: life, strength });
    if (this.ground.length > MAX_GROUND) this.ground.splice(0, this.ground.length - MAX_GROUND);
  }

  /**
   * An explosion. `size` follows the simulation's effect sizes: 0 a shell hit, 0.5 a soldier,
   * 1 a vehicle, 2 a structure; `heavy` for artillery, which hits harder than its size says.
   */
  explode(x: number, y: number, size: number, heavy: boolean): void {
    const s = heavy ? Math.max(size, 0.6) : size;
    const big = s >= 2;
    const R = big ? 46 : s >= 1 ? 26 : s >= 0.5 ? 16 : 10;
    // Light thrown on the ground, and the shockwave.
    this.addGround('flash', x, y, R * 2.6, big ? 0.7 : 0.35 + s * 0.15, big ? 1 : 0.7 + s * 0.2);
    if (s >= 0.5) this.addGround('ring', x, y, R * 2.2, big ? 0.75 : 0.45, big ? 1 : 0.7);
    // Fireball bloom: a few overlapping balls that swell and fade.
    const balls = big ? 7 : s >= 1 ? 4 : s >= 0.5 ? 2 : 1;
    for (let i = 0; i < balls; i++) {
      const spread = R * 0.45;
      this.add({
        kind: 'fireball',
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        z: Math.random() * R * 0.2,
        vz: 10 + Math.random() * 20,
        life: (big ? 0.9 : 0.45 + s * 0.15) * (0.7 + Math.random() * 0.5),
        size: R * (0.35 + Math.random() * 0.25),
        grow: 2,
        delay: i === 0 ? 0 : Math.random() * (big ? 0.35 : 0.12),
      });
    }
    // Rising smoke column that takes over from the fire.
    const puffs = big ? 14 : s >= 1 ? 6 : s >= 0.5 ? 2 : 1;
    for (let i = 0; i < puffs; i++) {
      const lift = Math.random();
      this.add({
        kind: 'smoke',
        x: x + (Math.random() - 0.5) * R * 0.7,
        y: y + (Math.random() - 0.5) * R * 0.5,
        z: lift * R * 0.6,
        vx: 3 + (Math.random() - 0.5) * 6,
        vy: 0,
        vz: 14 + Math.random() * 18 + (big ? 12 : 0),
        life: (big ? 3.6 : 1.4 + s) * (0.7 + Math.random() * 0.6),
        size: R * (0.25 + Math.random() * 0.15),
        grow: 2.4,
        delay: 0.12 + Math.random() * (big ? 1.2 : 0.4),
      });
    }
    // Debris that arcs and bounces; hot embers with it on bigger blasts.
    const chunks = big ? 26 : s >= 1 ? 12 : s >= 0.5 ? 4 : heavy ? 6 : 2;
    for (let i = 0; i < chunks; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (30 + Math.random() * 60) * (0.6 + s * 0.5);
      this.add({
        kind: 'debris',
        x,
        y,
        z: 2,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.75,
        vz: 60 + Math.random() * (90 + s * 70),
        life: 0.9 + Math.random() * 0.8,
        size: 1.4 + Math.random() * (1.4 + s),
        vr: (Math.random() - 0.5) * 18,
        rot: Math.random() * 6,
      });
    }
    const embers = big ? 16 : s >= 1 ? 8 : heavy ? 4 : 0;
    for (let i = 0; i < embers; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 80 * (0.5 + s * 0.4);
      this.add({ kind: 'ember', x, y, z: 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: 80 + Math.random() * 120, life: 0.6 + Math.random() * 0.6, size: 1.6 });
    }
    this.trim();
  }

  /**
   * The missile strike, on top of an ordinary structure blast: a flash and shockwaves the size of
   * its radius `R` (pixels), fireballs across it, a column of smoke with a spreading cap, debris
   * thrown far, and fires left burning round the crater.
   */
  megaBlast(x: number, y: number, R: number): void {
    this.addGround('flash', x, y, R * 2.6, 1.6, 1);
    this.addGround('ring', x, y, R * 2.8, 1.3, 1);
    this.addGround('ring', x, y, R * 1.7, 0.9, 0.8);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * R * 0.75;
      this.add({
        kind: 'fireball',
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d * 0.75,
        z: Math.random() * R * 0.2,
        vz: 20 + Math.random() * 40,
        life: 0.9 + Math.random() * 0.8,
        size: R * (0.22 + Math.random() * 0.22),
        grow: 2.2,
        delay: Math.random() * 0.45,
      });
    }
    // The column, then the cap: puffs that start high and spread outward.
    for (let i = 0; i < 12; i++)
      this.add({ kind: 'smoke', x: x + (Math.random() - 0.5) * R * 0.3, y, z: i * R * 0.1, vx: 3, vz: 40 + Math.random() * 30, life: 5 + Math.random() * 2, size: R * 0.22, grow: 2.6, delay: 0.2 + i * 0.05 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.add({ kind: 'smoke', x, y, z: R * 1.3, vx: Math.cos(a) * R * 0.5, vy: Math.sin(a) * R * 0.25, vz: 18, life: 6 + Math.random() * 2, size: R * 0.25, grow: 2.4, delay: 0.7 + Math.random() * 0.4 });
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 160;
      this.add({ kind: 'debris', x, y, z: 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.75, vz: 120 + Math.random() * 200, life: 1.4 + Math.random() * 1, size: 1.8 + Math.random() * 3.2, vr: (Math.random() - 0.5) * 18, rot: Math.random() * 6 });
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 140;
      this.add({ kind: 'ember', x, y, z: 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: 120 + Math.random() * 160, life: 0.9 + Math.random() * 0.9, size: 1.8 });
    }
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = R * (0.4 + Math.random() * 0.6);
      this.burn(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, 8 + Math.random() * 6, 6 + Math.random() * 6);
    }
    this.trim();
  }

  /** Burning ground, `r` pixels across, for `life` seconds (flamethrower hits, the missile's fires). */
  burn(x: number, y: number, r: number, life: number): void {
    this.addGround('burn', x, y, r, life, 1);
  }

  /** A flamethrower's spray: burning fuel thrown from the nozzle toward the target. */
  flameSpray(x0: number, y0: number, x1: number, y1: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy) || 1;
    const sx = x0 + (dx / d) * 12;
    const sy = y0 + (dy / d) * 12;
    for (let i = 0; i < 5; i++) {
      if (this.busy()) return;
      const life = 0.3 + Math.random() * 0.15;
      const v = (d - 12) / life;
      const spread = (Math.random() - 0.5) * 0.3;
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const ux = (dx / d) * c - (dy / d) * s;
      const uy = (dx / d) * s + (dy / d) * c;
      this.add({ kind: 'fire', x: sx, y: sy, z: 3, vx: ux * v, vy: uy * v, vz: 6 + Math.random() * 8, life, size: 3 + Math.random() * 2, grow: 2.6, delay: i * 0.03 });
    }
  }

  /**
   * True when ambient emitters (smoke, dust, exhaust, flames) should skip this particle: the
   * fuller the pool, the more they skip, so a huge firefight thins its haze instead of its frame
   * rate. Explosions themselves are never thinned.
   */
  private busy(): boolean {
    const f = this.air.length / MAX_AIR;
    return f > 0.35 && Math.random() < (f - 0.35) * 1.4;
  }

  smoke(x: number, y: number, scale: number, z = 0): void {
    if (this.busy()) return;
    this.add({ kind: 'smoke', x, y, z, vx: 4 + (Math.random() - 0.5) * 6, vz: 12 + Math.random() * 12, life: 1.2 + Math.random() * 1.4, size: 3 * scale, grow: 3.2 });
  }

  fire(x: number, y: number): void {
    if (this.busy()) return;
    this.add({ kind: 'fire', x, y, z: Math.random() * 4, vx: (Math.random() - 0.5) * 10, vz: 18 + Math.random() * 20, life: 0.35 + Math.random() * 0.4, size: 3 + Math.random() * 3, grow: 0.5 });
  }

  spark(x: number, y: number): void {
    const a = Math.random() * Math.PI * 2;
    const v = 30 + Math.random() * 50;
    this.add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, size: 2 });
  }

  dust(x: number, y: number, scale: number): void {
    if (this.busy()) return;
    this.add({ kind: 'dust', x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 8, vz: 4 + Math.random() * 5, life: 0.6 + Math.random() * 0.4, size: 3.5 * scale, grow: 2.2 });
  }

  exhaust(x: number, y: number): void {
    if (this.busy()) return;
    this.add({ kind: 'smoke', x, y, z: 3, vz: 6, life: 0.7, size: 2.4, grow: 2.2 });
  }

  trim(): void {
    if (this.air.length > MAX_AIR) this.air.splice(0, this.air.length - MAX_AIR);
  }

  /** Advances every particle by dt seconds, compacting the dead out in place. */
  step(dt: number): void {
    const air = this.air;
    let n = 0;
    for (let i = 0; i < air.length; i++) {
      const p = air[i];
      if (p.delay > 0) {
        p.delay -= dt;
        air[n++] = p;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.kind === 'debris' || p.kind === 'ember') {
        p.vz -= GRAVITY * dt;
        p.rot += p.vr * dt;
        if (p.z <= 0) {
          p.z = 0;
          if (p.bounces < 2 && p.vz < -25) {
            p.vz = -p.vz * 0.38;
            p.vx *= 0.55;
            p.vy *= 0.55;
            p.vr *= 0.5;
            p.bounces++;
          } else {
            p.vz = 0;
            p.vx *= 0.8;
            p.vy *= 0.8;
            p.vr = 0;
          }
        }
      } else if (p.kind === 'smoke' || p.kind === 'dust') {
        p.vz *= 1 - 0.25 * dt;
        p.vx += 2.5 * dt; // A light breeze carries smoke east.
      } else if (p.kind === 'spark') {
        p.vx *= 0.92;
        p.vy *= 0.92;
      }
      air[n++] = p;
    }
    air.length = n;
    const g = this.ground;
    let m = 0;
    for (let i = 0; i < g.length; i++) {
      const f = g[i];
      f.life -= dt;
      if (f.kind === 'burn' && f.life > 0) {
        // Burning ground keeps throwing up flames, fewer as it dies down, and a little smoke.
        const k = f.life / f.max;
        if (Math.random() < dt * 16 * Math.min(1, k * 2)) this.fire(f.x + (Math.random() - 0.5) * f.r * 1.4, f.y + (Math.random() - 0.5) * f.r);
        if (Math.random() < dt * 2.5 * k) this.smoke(f.x, f.y, 0.9, 6);
      }
      if (f.life > 0) g[m++] = f;
    }
    g.length = m;
  }

  /** The flat layer: ground light and shockwaves. Call under the units. */
  drawGround(ctx: CanvasRenderingContext2D, inView: (x: number, y: number, m?: number) => boolean): void {
    if (!this.ground.length) return;
    const sp = sprites();
    for (const f of this.ground) {
      if (!inView(f.x, f.y, f.r)) continue;
      const k = f.life / f.max;
      if (f.kind === 'burn') {
        ctx.globalCompositeOperation = 'lighter';
        const flick = 0.75 + 0.25 * Math.sin(f.life * 23 + f.x) * Math.sin(f.life * 13 + f.y);
        ctx.globalAlpha = Math.min(1, k * 2) * 0.55 * flick;
        const r = f.r * 2.2;
        ctx.drawImage(sp.light, f.x - r, f.y - r * 0.75, r * 2, r * 1.5);
        ctx.globalCompositeOperation = 'source-over';
      } else if (f.kind === 'flash') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, k * k * f.strength);
        const r = f.r * (0.7 + 0.3 * (1 - k));
        ctx.drawImage(sp.light, f.x - r, f.y - r * 0.8, r * 2, r * 1.6);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        const e = 1 - k;
        const r = f.r * (0.15 + 0.85 * Math.sqrt(e));
        ctx.globalAlpha = k * 0.55 * f.strength;
        ctx.strokeStyle = '#fff4dc';
        ctx.lineWidth = 1 + 4 * k;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, r, r * 0.72, 0, 0, Math.PI * 2);
        ctx.stroke();
        // A darker wave of dust just behind the bright edge.
        ctx.globalAlpha = k * 0.25 * f.strength;
        ctx.strokeStyle = '#5a4a36';
        ctx.lineWidth = 3 + 6 * k;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, r * 0.86, r * 0.86 * 0.72, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Everything that rises or flies. Call over the units. */
  drawAir(ctx: CanvasRenderingContext2D, inView: (x: number, y: number, m?: number) => boolean): void {
    const sp = sprites();
    const air = this.air;
    // Pass 1, ordinary paint: debris (with its shadow), dust, smoke.
    for (let i = 0; i < air.length; i++) {
      const p = air[i];
      if (p.delay > 0) continue;
      if (p.kind !== 'debris' && p.kind !== 'dust' && p.kind !== 'smoke') continue;
      if (!inView(p.x, p.y - p.z, 40)) continue;
      const f = p.life / p.max;
      if (p.kind === 'debris') {
        if (p.z > 1) {
          ctx.globalAlpha = 0.3 * Math.min(1, f * 3);
          ctx.fillStyle = '#000';
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 4, p.size, p.size / 2);
        }
        ctx.globalAlpha = Math.min(1, f * 3);
        const c = 26 + Math.floor(p.tone * 40);
        ctx.fillStyle = `rgb(${c + 8},${c},${c - 6})`;
        // Tumbling, faked by trading width for height as it spins: no transform per chunk.
        const w = p.size * (0.35 + 0.65 * Math.abs(Math.cos(p.rot)));
        const h = p.size * (0.35 + 0.65 * Math.abs(Math.sin(p.rot)));
        ctx.fillRect(p.x - w / 2, p.y - p.z - h / 2, w, h);
      } else {
        const img = p.kind === 'smoke' ? sp.smoke : sp.dust;
        const s = p.size * (1 + (p.grow - 1) * (1 - f));
        // Fade in quickly, out slowly.
        const a = Math.min(1, (1 - f) * 6) * f;
        ctx.globalAlpha = p.kind === 'smoke' ? a * 0.75 : a * 0.6;
        ctx.drawImage(img, p.x - s, p.y - p.z - s, s * 2, s * 2);
      }
    }
    // Pass 2, additive: fire, fireballs, sparks, embers.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < air.length; i++) {
      const p = air[i];
      if (p.delay > 0) continue;
      if (p.kind === 'debris' || p.kind === 'dust' || p.kind === 'smoke') continue;
      if (!inView(p.x, p.y - p.z, 60)) continue;
      const f = p.life / p.max;
      if (p.kind === 'fireball' || p.kind === 'fire') {
        const s = p.size * (1 + (p.grow - 1) * (1 - f));
        ctx.globalAlpha = p.kind === 'fireball' ? Math.pow(f, 0.8) : f;
        ctx.drawImage(sp.fire, p.x - s, p.y - p.z - s, s * 2, s * 2);
      } else if (p.kind === 'ember') {
        ctx.globalAlpha = f;
        ctx.fillStyle = '#ffb04a';
        ctx.fillRect(p.x - 1, p.y - p.z - 1, p.size, p.size);
      } else {
        ctx.globalAlpha = f;
        ctx.fillStyle = '#ffe68a';
        ctx.fillRect(p.x, p.y, 2, 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
