import { dockTile } from '../sim/grid';
import { BUILDINGS, MAP_H, MAP_W, TICKS_PER_SECOND, UNITS, type BuildingKind } from '../sim/rules';
import { powerOf, visibility } from '../sim/state';
import type { Building, GameState, Unit } from '../sim/types';
import { ART, TEAM } from '../theme';
import { drawBuilding, drawDock, drawUnit, TILE } from './art';
import { paintTerrain } from './terrain';

/**
 * Draws one frame of the battlefield. Owns nothing the simulation reads: particles, scorch marks
 * and click pings live here and only here, so they can use Math.random and real time freely.
 *
 * Units are drawn between the previous tick's position and the current one (`alpha` is how far
 * through the tick the frame falls), so ten simulation ticks a second still move smoothly at
 * sixty frames.
 */

export interface Camera {
  /** World pixels at the top-left of the view. */
  x: number;
  y: number;
  zoom: number;
  /** View size in CSS pixels. */
  w: number;
  h: number;
}

export interface Ping {
  x: number;
  y: number;
  at: number;
  kind: 'move' | 'attack' | 'rally';
}

export interface Overlay {
  selected: Set<number>;
  hover: number;
  placement: { kind: BuildingKind; tx: number; ty: number; ok: boolean } | null;
  /** Screen-space drag rectangle. */
  drag: { x0: number; y0: number; x1: number; y1: number } | null;
  pings: Ping[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  kind: 'fire' | 'smoke' | 'debris' | 'spark';
}

export class Renderer {
  private terrain: HTMLCanvasElement;
  private fog: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImg: ImageData;
  private particles: Particle[] = [];
  private scorches: { x: number; y: number; r: number }[] = [];
  private seen = new Set<number>();
  private visFor: GameState | null = null;
  private vis: Uint8Array = new Uint8Array(MAP_W * MAP_H);
  private lastNow = 0;

  constructor(tiles: string) {
    this.terrain = paintTerrain(tiles);
    this.fog = document.createElement('canvas');
    this.fog.width = MAP_W;
    this.fog.height = MAP_H;
    this.fogCtx = this.fog.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(MAP_W, MAP_H);
  }

  /** What side 0 can see right now. Cached per state object. */
  visible(s: GameState): Uint8Array {
    if (this.visFor !== s) {
      this.vis = visibility(s, 0);
      this.visFor = s;
    }
    return this.vis;
  }

  draw(ctx: CanvasRenderingContext2D, cur: GameState, prev: GameState, alpha: number, cam: Camera, ov: Overlay, now: number, dpr: number): void {
    const dt = Math.min(0.1, this.lastNow ? (now - this.lastNow) / 1000 : 0);
    this.lastNow = now;
    const t = now / 1000;
    const rt = prev.tick + (cur.tick - prev.tick) * alpha;
    const vis = this.visible(cur);
    const explored = cur.explored;
    const z = cam.zoom * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050707';
    ctx.fillRect(0, 0, cam.w * dpr, cam.h * dpr);
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    ctx.imageSmoothingEnabled = true;

    // Visible window, in tiles, with a margin for things that overhang their tile.
    const vw = cam.w / cam.zoom;
    const vh = cam.h / cam.zoom;
    const tx0 = Math.max(0, Math.floor(cam.x / TILE) - 2);
    const ty0 = Math.max(0, Math.floor(cam.y / TILE) - 2);
    const tx1 = Math.min(MAP_W - 1, Math.ceil((cam.x + vw) / TILE) + 2);
    const ty1 = Math.min(MAP_H - 1, Math.ceil((cam.y + vh) / TILE) + 2);
    const inView = (px: number, py: number, m = 64) => px > cam.x - m && py > cam.y - m && px < cam.x + vw + m && py < cam.y + vh + m;

    // 1. Ground.
    const sx = tx0 * TILE;
    const sy = ty0 * TILE;
    const sw = (tx1 - tx0 + 1) * TILE;
    const sh = (ty1 - ty0 + 1) * TILE;
    ctx.drawImage(this.terrain, sx, sy, sw, sh, sx, sy, sw, sh);

    // 2. Scorch marks from past explosions.
    for (const m of this.scorches) {
      if (!inView(m.x, m.y)) continue;
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
      g.addColorStop(0, 'rgba(20,16,12,0.55)');
      g.addColorStop(1, 'rgba(20,16,12,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Ore.
    for (let y = ty0; y <= ty1; y++)
      for (let x = tx0; x <= tx1; x++) {
        const k = y * MAP_W + x;
        const o = cur.ore[k];
        if (o <= 0 || explored.charCodeAt(k) !== 49) continue;
        drawOre(ctx, x, y, o, t, k);
      }

    // 4. Structures, back to front.
    const low: [boolean, boolean] = [powerOf(cur, 0).low, powerOf(cur, 1).low];
    const seenBuilding = (b: Building) => {
      if (b.owner === 0) return true;
      const spec = BUILDINGS[b.kind];
      for (let y = b.y; y < b.y + spec.h; y++)
        for (let x = b.x; x < b.x + spec.w; x++) if (explored.charCodeAt(y * MAP_W + x) === 49) return true;
      return false;
    };
    const buildings = cur.buildings.filter(b => seenBuilding(b)).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const b of buildings) {
      if (b.kind !== 'refinery') continue;
      const d = dockTile(b);
      drawDock(ctx, d.x * TILE, d.y * TILE);
    }
    for (const b of buildings) {
      const spec = BUILDINGS[b.kind];
      const px = b.x * TILE;
      const py = b.y * TILE;
      if (!inView(px + (spec.w * TILE) / 2, py + (spec.h * TILE) / 2, 120)) continue;
      const w = spec.weapon;
      drawBuilding(ctx, b.kind, b.owner, px, py, {
        t,
        rise: Math.min(1, Math.max(0, (rt - b.placedAt) / 15)),
        lowPower: low[b.owner],
        turret: Math.atan2(b.ty, b.tx),
        sinceShot: w && b.cooldown > 0 ? (w.cooldown - b.cooldown) / TICKS_PER_SECOND : 9,
      });
      const frac = b.hp / spec.hp;
      if (frac < 0.5 && Math.random() < dt * (frac < 0.25 ? 14 : 6)) {
        this.particles.push(smoke(px + Math.random() * spec.w * TILE, py + Math.random() * spec.h * TILE * 0.6, 1.6));
        if (frac < 0.25 && Math.random() < 0.6)
          this.particles.push(fire(px + TILE * 0.3 + Math.random() * (spec.w - 0.6) * TILE, py + Math.random() * spec.h * TILE * 0.7));
      }
      const selected = ov.selected.has(b.id);
      if (selected || ov.hover === b.id) {
        brackets(ctx, px - 2, py - 2, spec.w * TILE + 4, spec.h * TILE + 4, b.owner === 0 ? ART.select : ART.selectEnemy);
        hpBar(ctx, px + 4, py - 7, spec.w * TILE - 8, frac);
      } else if (frac < 1 && b.owner === 0) {
        hpBar(ctx, px + 4, py - 6, spec.w * TILE - 8, frac, true);
      }
      if (b.repairing) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 6);
        ctx.fillStyle = ART.hpGood;
        const cx = px + (spec.w * TILE) / 2;
        const cy = py + (spec.h * TILE) / 2;
        ctx.fillRect(cx - 7, cy - 2, 14, 4);
        ctx.fillRect(cx - 2, cy - 7, 4, 14);
        ctx.globalAlpha = 1;
      }
      if (selected && b.owner === 0 && b.rally) {
        const cx = px + (spec.w * TILE) / 2;
        const cy = py + spec.h * TILE;
        ctx.strokeStyle = 'rgba(125,255,138,0.7)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(b.rally.x * TILE, b.rally.y * TILE);
        ctx.stroke();
        ctx.setLineDash([]);
        flag(ctx, b.rally.x * TILE, b.rally.y * TILE);
      }
    }

    // 5. Units, interpolated, back to front.
    const prevById = new Map(prev.units.map(u => [u.id, u]));
    const drawn: { u: Unit; x: number; y: number }[] = [];
    for (const u of cur.units) {
      const p = prevById.get(u.id) ?? u;
      const x = (p.x + (u.x - p.x) * alpha) * TILE;
      const y = (p.y + (u.y - p.y) * alpha) * TILE;
      if (!inView(x, y)) continue;
      if (u.owner !== 0 && !vis[Math.floor(u.y) * MAP_W + Math.floor(u.x)]) continue;
      drawn.push({ u, x, y });
    }
    drawn.sort((a, b) => a.y - b.y);
    for (const { u, x, y } of drawn) {
      const spec = UNITS[u.kind];
      const r = spec.category === 'infantry' ? 8 : 14;
      if (ov.selected.has(u.id) || ov.hover === u.id) {
        ctx.strokeStyle = u.owner === 0 ? ART.select : ART.selectEnemy;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(x, y + 2, r + 1, (r + 1) * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const { u, x, y } of drawn) {
      const p = prevById.get(u.id) ?? u;
      const moving = Math.abs(u.x - p.x) + Math.abs(u.y - p.y) > 0.001;
      const w = UNITS[u.kind].weapon;
      drawUnit(ctx, u.kind, u.owner, x, y, {
        hull: Math.atan2(p.fy + (u.fy - p.fy) * alpha, p.fx + (u.fx - p.fx) * alpha),
        turret: Math.atan2(p.ty + (u.ty - p.ty) * alpha, p.tx + (u.tx - p.tx) * alpha),
        t: t + u.id * 0.37,
        moving,
        cargo: u.cargo / 600,
        sinceShot: w && u.cooldown > 0 ? (w.cooldown - u.cooldown) / TICKS_PER_SECOND : 9,
      });
      if (moving && UNITS[u.kind].category === 'vehicle' && Math.random() < dt * 8) {
        this.particles.push({ x: x - u.fx * 10, y: y - u.fy * 10, vx: 0, vy: -4, life: 0.7, max: 0.7, size: 3, kind: 'smoke' });
      }
    }
    for (const { u, x, y } of drawn) {
      const spec = UNITS[u.kind];
      const frac = u.hp / spec.hp;
      const r = spec.category === 'infantry' ? 9 : 14;
      if (ov.selected.has(u.id) || ov.hover === u.id) hpBar(ctx, x - r, y - r - 7, r * 2, frac);
      else if (frac < 1) hpBar(ctx, x - r, y - r - 5, r * 2, frac, true);
      if (u.kind === 'hauler' && ov.selected.has(u.id)) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - r, y - r - 3, r * 2, 2.5);
        ctx.fillStyle = ART.ore;
        ctx.fillRect(x - r, y - r - 3, r * 2 * (u.cargo / 600), 2.5);
      }
    }

    // 6. Shells and rockets in flight.
    for (const p of cur.projectiles) {
      const span = Math.max(1, p.hitAt - p.firedAt);
      const f = Math.min(1, Math.max(0, (rt - p.firedAt) / span));
      const x = (p.fromX + (p.toX - p.fromX) * f) * TILE;
      const y = (p.fromY + (p.toY - p.fromY) * f) * TILE;
      if (!inView(x, y)) continue;
      if (p.weapon === 'artillery') {
        const lift = Math.sin(f * Math.PI) * 40;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe2a0';
        ctx.beginPath();
        ctx.arc(x, y - lift, 2.6, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.5) this.particles.push({ x, y: y - lift, vx: 0, vy: 0, life: 0.4, max: 0.4, size: 2, kind: 'smoke' });
      } else if (p.weapon === 'rocket') {
        const ang = Math.atan2(p.toY - p.fromY, p.toX - p.fromX);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.fillStyle = '#d8d8d0';
        ctx.fillRect(-4, -1, 7, 2);
        ctx.fillStyle = '#ffb347';
        ctx.fillRect(-7, -1.2, 3, 2.4);
        ctx.restore();
        this.particles.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 0.5, max: 0.5, size: 2.2, kind: 'smoke' });
      } else {
        ctx.fillStyle = '#ffe9b0';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7. Flashes, tracers and explosions.
    for (const e of cur.effects) {
      const age = rt - e.at + 1;
      const x = e.x * TILE;
      const y = e.y * TILE;
      if (!this.seen.has(e.id)) {
        this.seen.add(e.id);
        if (e.kind === 'boom') this.burst(x, y, e.size, e.weapon);
        if (e.kind === 'sold') for (let i = 0; i < 18; i++) this.particles.push(spark(x, y));
      }
      if (!inView(x, y, 120)) continue;
      if (e.kind === 'muzzle' && age < 2.2) {
        const tx = (e.x2 ?? e.x) * TILE;
        const ty = (e.y2 ?? e.y) * TILE;
        const a = 1 - age / 2.2;
        if (e.weapon === 'bullet') {
          ctx.strokeStyle = `rgba(255,236,160,${a})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          const f = Math.min(1, age / 1.2);
          ctx.moveTo(x + (tx - x) * Math.max(0, f - 0.5), y + (ty - y) * Math.max(0, f - 0.5));
          ctx.lineTo(x + (tx - x) * f, y + (ty - y) * f);
          ctx.stroke();
          if (age > 0.8 && age < 1.8) {
            ctx.fillStyle = `rgba(255,220,120,${a})`;
            ctx.fillRect(tx - 1.5 + Math.random() * 3, ty - 1.5 + Math.random() * 3, 2, 2);
          }
        }
        ctx.fillStyle = `rgba(255,210,110,${a})`;
        ctx.beginPath();
        ctx.arc(x, y, e.weapon === 'bullet' ? 3 : e.weapon === 'artillery' ? 8 : 5.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'boom') {
        const dur = e.size >= 2 ? 14 : e.size >= 1 ? 10 : 6;
        if (age > dur) continue;
        const f = age / dur;
        const R = (e.size >= 2 ? 44 : e.size >= 1 ? 22 : e.weapon === 'artillery' ? 18 : 9) * (0.4 + f * 0.8);
        const g = ctx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0, `rgba(255,250,220,${1 - f})`);
        g.addColorStop(0.35, `rgba(255,170,60,${0.9 * (1 - f)})`);
        g.addColorStop(0.75, `rgba(170,60,20,${0.6 * (1 - f)})`);
        g.addColorStop(1, 'rgba(60,30,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fill();
        if (age < 1.5 && e.size >= 1) {
          ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - age / 1.5)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, R * 1.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (e.kind === 'sold' && age < 12) {
        ctx.strokeStyle = `rgba(255,230,120,${1 - age / 12})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, e.size * 10 * (age / 6), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.seen.size > 4000) {
      const live = new Set(cur.effects.map(e => e.id));
      for (const id of this.seen) if (!live.has(id)) this.seen.delete(id);
    }

    // 8. Particles.
    this.stepParticles(ctx, dt);

    // 9. Order pings.
    ov.pings = ov.pings.filter(p => now - p.at < 600);
    for (const p of ov.pings) {
      const f = (now - p.at) / 600;
      ctx.strokeStyle = p.kind === 'attack' ? `rgba(255,110,90,${1 - f})` : `rgba(125,255,138,${1 - f})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x * TILE, p.y * TILE, 12 * (1 - f) + 3, (12 * (1 - f) + 3) * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 10. Fog: unexplored is black, explored but unwatched is dimmed. Drawn from a one-pixel-per-
    // tile canvas scaled up with smoothing, which is what gives it soft edges.
    const d = this.fogImg.data;
    const [fr, fg, fb] = ART.fog;
    for (let k = 0; k < MAP_W * MAP_H; k++) {
      d[k * 4] = fr;
      d[k * 4 + 1] = fg;
      d[k * 4 + 2] = fb;
      d[k * 4 + 3] = explored.charCodeAt(k) !== 49 ? 255 : vis[k] ? 0 : 120;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
    ctx.drawImage(this.fog, 0, 0, MAP_W * TILE, MAP_H * TILE);
    // Edges of the world.
    ctx.fillStyle = '#050707';
    ctx.fillRect(-400, -400, MAP_W * TILE + 800, 400);
    ctx.fillRect(-400, MAP_H * TILE, MAP_W * TILE + 800, 400);
    ctx.fillRect(-400, 0, 400, MAP_H * TILE);
    ctx.fillRect(MAP_W * TILE, 0, 400, MAP_H * TILE);

    // 11. Placement ghost.
    if (ov.placement) {
      const { kind, tx, ty, ok } = ov.placement;
      const spec = BUILDINGS[kind];
      ctx.globalAlpha = 0.55;
      drawBuilding(ctx, kind, 0, tx * TILE, ty * TILE, { t, rise: 1, lowPower: false, turret: -Math.PI / 4, sinceShot: 9 });
      ctx.globalAlpha = 1;
      ctx.fillStyle = ok ? 'rgba(90,255,120,0.28)' : 'rgba(255,70,60,0.35)';
      ctx.strokeStyle = ok ? 'rgba(120,255,140,0.9)' : 'rgba(255,90,80,0.9)';
      ctx.lineWidth = 1;
      for (let y = 0; y < spec.h; y++)
        for (let x = 0; x < spec.w; x++) {
          ctx.fillRect((tx + x) * TILE + 1, (ty + y) * TILE + 1, TILE - 2, TILE - 2);
          ctx.strokeRect((tx + x) * TILE + 1.5, (ty + y) * TILE + 1.5, TILE - 3, TILE - 3);
        }
      if (kind === 'refinery') {
        ctx.setLineDash([4, 3]);
        ctx.strokeRect((tx + 1) * TILE + 2, (ty + spec.h) * TILE + 2, TILE - 4, TILE - 4);
        ctx.setLineDash([]);
      }
    }

    // 12. Drag box, in screen space.
    if (ov.drag) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { x0, y0, x1, y1 } = ov.drag;
      ctx.fillStyle = 'rgba(125,255,138,0.08)';
      ctx.strokeStyle = 'rgba(125,255,138,0.9)';
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
  }

  private burst(x: number, y: number, size: number, weapon?: string) {
    const n = size >= 2 ? 40 : size >= 1 ? 18 : weapon === 'artillery' ? 12 : 4;
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      if (r < 0.4) this.particles.push(fire(x + (Math.random() - 0.5) * 10 * (size + 0.5), y + (Math.random() - 0.5) * 10 * (size + 0.5)));
      else if (r < 0.75) this.particles.push(smoke(x + (Math.random() - 0.5) * 14 * (size + 0.5), y + (Math.random() - 0.5) * 14 * (size + 0.5), 1 + size));
      else {
        const a = Math.random() * Math.PI * 2;
        const v = 40 + Math.random() * 90 * (size + 0.5);
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, size: 1.5 + Math.random() * 1.5, kind: 'debris' });
      }
    }
    if (size >= 0.5 || weapon === 'artillery') this.scorches.push({ x, y, r: size >= 2 ? 40 : size >= 1 ? 20 : 12 });
    if (this.scorches.length > 160) this.scorches.splice(0, this.scorches.length - 160);
  }

  private stepParticles(ctx: CanvasRenderingContext2D, dt: number) {
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'debris') {
        p.vx *= 0.92;
        p.vy *= 0.92;
      }
      const f = p.life / p.max;
      if (p.kind === 'fire') {
        ctx.fillStyle = `rgba(255,${120 + Math.floor(100 * f)},40,${f})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + f * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'smoke') {
        const s = p.size * (1 + (1 - f) * 2.5);
        ctx.fillStyle = `rgba(55,52,48,${0.45 * f})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'debris') {
        ctx.fillStyle = `rgba(40,34,28,${f})`;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      } else {
        ctx.fillStyle = `rgba(255,230,130,${f})`;
        ctx.fillRect(p.x, p.y, 2, 2);
      }
      keep.push(p);
    }
    this.particles = keep.length > 1500 ? keep.slice(keep.length - 1500) : keep;
  }
}

function fire(x: number, y: number): Particle {
  return { x, y, vx: (Math.random() - 0.5) * 10, vy: -18 - Math.random() * 20, life: 0.35 + Math.random() * 0.4, max: 0.75, size: 2.5 + Math.random() * 3, kind: 'fire' };
}

function smoke(x: number, y: number, scale: number): Particle {
  return { x, y, vx: 4 + (Math.random() - 0.5) * 6, vy: -10 - Math.random() * 12, life: 1 + Math.random() * 1.2, max: 2.2, size: 3 * scale, kind: 'smoke' };
}

function spark(x: number, y: number): Particle {
  const a = Math.random() * Math.PI * 2;
  const v = 30 + Math.random() * 50;
  return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, max: 0.6, size: 2, kind: 'spark' };
}

function oreHash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawOre(ctx: CanvasRenderingContext2D, x: number, y: number, amount: number, t: number, k: number) {
  const px = x * TILE;
  const py = y * TILE;
  ctx.fillStyle = ART.oreGround;
  ctx.beginPath();
  ctx.arc(px + TILE / 2, py + TILE / 2, 15, 0, Math.PI * 2);
  ctx.fill();
  const n = Math.max(1, Math.ceil(amount / 85));
  for (let i = 0; i < n; i++) {
    const cx = px + 5 + oreHash(k * 13 + i) * 22;
    const cy = py + 5 + oreHash(k * 29 + i * 7) * 22;
    const s = 2.8 + oreHash(k * 31 + i) * 2.6;
    ctx.fillStyle = ART.oreDark;
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy - s + 1);
    ctx.lineTo(cx + s * 0.7 + 1, cy + 1);
    ctx.lineTo(cx + 1, cy + s * 0.9 + 1);
    ctx.lineTo(cx - s * 0.7 + 1, cy + 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ART.ore;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s * 0.7, cy);
    ctx.lineTo(cx, cy + s * 0.9);
    ctx.lineTo(cx - s * 0.7, cy);
    ctx.closePath();
    ctx.fill();
    const glint = Math.sin(t * 2.2 + oreHash(k + i * 101) * 20);
    if (glint > 0.85) {
      ctx.fillStyle = ART.oreGlow;
      ctx.globalAlpha = (glint - 0.85) / 0.15;
      ctx.fillRect(cx - 0.8, cy - s * 0.6, 1.6, 1.6);
      ctx.globalAlpha = 1;
    }
  }
}

function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string) {
  const l = Math.min(10, w / 3);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y + l);
  ctx.lineTo(x, y);
  ctx.lineTo(x + l, y);
  ctx.moveTo(x + w - l, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + l);
  ctx.moveTo(x + w, y + h - l);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - l, y + h);
  ctx.moveTo(x + l, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - l);
  ctx.stroke();
}

function hpBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, thin = false) {
  const h = thin ? 2 : 3.5;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = frac > 0.6 ? ART.hpGood : frac > 0.3 ? ART.hpMid : ART.hpBad;
  ctx.fillRect(x, y, w * Math.max(0, frac), h);
}

function flag(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 16);
  ctx.stroke();
  ctx.fillStyle = TEAM[0].main;
  ctx.beginPath();
  ctx.moveTo(x, y - 16);
  ctx.lineTo(x + 10, y - 12.5);
  ctx.lineTo(x, y - 9);
  ctx.closePath();
  ctx.fill();
}
