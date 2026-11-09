import { dockTile } from '../sim/grid';
import { isDetected } from '../sim/mission';
import { BUILDINGS, CAPTURE_TICKS, CHARGE_FUSE, ENGINEER_REPAIR_RANGE, MAP_H, MAP_W, POWERS, TICKS_PER_SECOND, UNITS, type BuildingKind } from '../sim/rules';
import { buildTicksOf, powerOf, producerFor, visibility } from '../sim/state';
import type { Building, Effect, GameState, Unit } from '../sim/types';
import { ART, TEAM } from '../theme';
import { drawBuilding, drawDock, drawHeroBadge, drawUnit, TILE, type BuildingPose, type UnitPose } from './art';
import { drawCampaignEffect, drawCaptureRing, drawChargeOnBuilding, drawOverdriveGlow, drawReconArea, startCampaignEffect } from './fx/campaign';
import { Atmosphere } from './fx/atmosphere';
import { Particles } from './fx/particles';
import { Scars } from './fx/scars';
import { sprites } from './fx/sprites';
import { Water } from './fx/water';
import { sound, type SoundKind } from './sound';
import { paintTerrain } from './terrain';

/**
 * The pose fields art.ts reads for damage, recoil flashes and working structures. Declared here as
 * optional extras so this file compiles whether or not art.ts has them yet; once it does, these
 * intersections change nothing.
 */
type UnitPoseX = UnitPose & { hp?: number; firing?: boolean };
type BuildingPoseX = BuildingPose & { hp?: number; working?: boolean };

/** Seconds after a shot that a unit still counts as firing, for its muzzle pose. */
const FIRING_WINDOW = 0.15;
/** How long, in ticks, a shot lights the ground, and the most such lights in one frame. */
const LIGHT_TICKS = 1.3;
const MAX_LIGHTS = 32;

/** Full health of a unit: a per-unit maxHp if the simulation sets one (perks, hero levels), else the kind's. */
const maxHpOf = (u: Unit) => (u as { maxHp?: number }).maxHp ?? UNITS[u.kind].hp;

/** The sound each campaign effect makes. */
const CAMPAIGN_SOUND: Partial<Record<Effect['kind'], SoundKind>> = {
  infiltrate: 'infiltrate',
  captured: 'capture',
  charge: 'charge',
  levelup: 'levelup',
  recon: 'recon',
  barrage: 'barrage',
  reinforce: 'reinforce',
};

/**
 * Whether side 0 can see this enemy Spy. Until the simulation's isDetected exists it throws, and
 * an enemy Spy is then simply not drawn.
 */
function spySeen(s: GameState, u: Unit): boolean {
  try {
    return isDetected(s, u, 0);
  } catch {
    return false;
  }
}

/** The Engineer is welding: an own vehicle beside him is short of health. */
function engineerWelding(s: GameState, u: Unit): boolean {
  for (const v of s.units) {
    if (v.owner !== u.owner || UNITS[v.kind].category !== 'vehicle' || v.hp >= maxHpOf(v)) continue;
    if (Math.hypot(v.x - u.x, v.y - u.y) <= ENGINEER_REPAIR_RANGE) return true;
  }
  return false;
}

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
  /** Control group of each own unit that has one (unit id to digit), for the badge under it. */
  groupOf?: Map<number, number>;
}

export class Renderer {
  private terrain: HTMLCanvasElement;
  private fog: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImg: ImageData;
  private fx = new Particles();
  private scars: Scars;
  private water: Water;
  private atmosphere = new Atmosphere();
  /** Structures producing something right now, cached per state object. */
  private workingFor: GameState | null = null;
  private working = new Set<number>();
  private seen = new Set<number>();
  /** False until the first frame, which marks what is already on the field as seen, silently. */
  private primed = false;
  private visFor: GameState | null = null;
  private vis: Uint8Array = new Uint8Array(MAP_W * MAP_H);
  private lastNow = 0;

  constructor(tiles: string) {
    this.terrain = paintTerrain(tiles);
    this.scars = new Scars(this.terrain, tiles);
    this.water = new Water(tiles, this.terrain);
    this.scars.onRepaint = (x, y, w, h) => this.water.invalidate(x, y, w, h);
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
    // The terrain canvas carries the battle's marks (tread marks, scorches, fallen soldiers,
    // rubble; see fx/scars.ts) and the water's animation (fx/water.ts), so one copy draws them all.
    this.scars.update(cur, vis, now);
    this.scars.step(dt, now, this.fx);
    this.water.update(t, tx0, ty0, tx1, ty1);
    ctx.drawImage(this.terrain, sx, sy, sw, sh, sx, sy, sw, sh);

    // 2. Burnt-out wrecks.
    this.scars.draw(ctx, now, inView);

    // 2b. Light on the ground: muzzle flashes, blasts, and their shockwaves.
    this.groundLight(ctx, cur, rt, vis, inView);
    this.fx.drawGround(ctx, inView);

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
    const working = this.workingSet(cur);
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
      const frac = b.hp / spec.hp;
      const bpose: BuildingPoseX = {
        t,
        rise: Math.min(1, Math.max(0, (rt - b.placedAt) / 15)),
        lowPower: low[b.owner],
        turret: Math.atan2(b.ty, b.tx),
        sinceShot: w && b.cooldown > 0 ? (w.cooldown - b.cooldown) / TICKS_PER_SECOND : 9,
        hp: frac,
        working: working.has(b.id),
      };
      drawBuilding(ctx, b.kind, b.owner, px, py, bpose);
      if (frac < 0.5 && Math.random() < dt * (frac < 0.25 ? 14 : 6)) {
        this.fx.smoke(px + Math.random() * spec.w * TILE, py + Math.random() * spec.h * TILE * 0.6, 1.6);
        if (frac < 0.25 && Math.random() < 0.6) this.fx.fire(px + TILE * 0.3 + Math.random() * (spec.w - 0.6) * TILE, py + Math.random() * spec.h * TILE * 0.7);
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
      if (b.chargeAt !== undefined && b.chargeAt + 1 > rt) {
        const left = Math.max(0, Math.min(1, (b.chargeAt - rt) / CHARGE_FUSE));
        drawChargeOnBuilding(ctx, px, py, spec.w * TILE, spec.h * TILE, left, t);
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
      if (u.owner !== 0) {
        if (!vis[Math.floor(u.y) * MAP_W + Math.floor(u.x)]) continue;
        if (u.kind === 'spy' && !spySeen(cur, u)) continue;
      }
      drawn.push({ u, x, y });
    }
    drawn.sort((a, b) => a.y - b.y);
    this.orderLines(ctx, cur, drawn, ov, t);
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
      const spec = UNITS[u.kind];
      const w = spec.weapon;
      const sinceShot = w && u.cooldown > 0 ? (w.cooldown - u.cooldown) / TICKS_PER_SECOND : 9;
      const upose: UnitPoseX = {
        hull: Math.atan2(p.fy + (u.fy - p.fy) * alpha, p.fx + (u.fx - p.fx) * alpha),
        turret: Math.atan2(p.ty + (u.ty - p.ty) * alpha, p.tx + (u.tx - p.tx) * alpha),
        t: t + u.id * 0.37,
        moving,
        cargo: u.cargo / 600,
        sinceShot,
        hp: u.hp / maxHpOf(u),
        firing: sinceShot < FIRING_WINDOW,
      };
      const hero = u.hero;
      if (hero) {
        upose.shimmer = u.kind === 'spy';
        upose.repairing = u.kind === 'engineer' && engineerWelding(cur, u);
        const act = hero.active;
        if (act && act.kind === 'overdrive' && act.until > cur.tick) {
          drawOverdriveGlow(ctx, x, y, upose.hull, t, (act.until - rt) / TICKS_PER_SECOND);
          if (moving && Math.random() < dt * 20) this.fx.fire(x - u.fx * 14, y - u.fy * 14);
        }
      }
      // Your own Spy is cloaked: drawn at about half strength.
      const cloaked = u.kind === 'spy' && u.owner === 0;
      if (cloaked) ctx.globalAlpha = 0.55;
      drawUnit(ctx, u.kind, u.owner, x, y, upose);
      if (cloaked) ctx.globalAlpha = 1;
      if (spec.category === 'vehicle' && moving) {
        this.scars.track(u, x, y, this.fx, dt);
        if (Math.random() < dt * 5) this.fx.exhaust(x - u.fx * 10, y - u.fy * 10);
      }
    }
    for (const { u, x, y } of drawn) {
      const act = u.hero?.active;
      if (!act || act.kind !== 'capture') continue;
      const b = cur.buildings.find(v => v.id === act.target);
      if (!b) continue;
      const bs = BUILDINGS[b.kind];
      // Progress may be kept as ticks or as a fraction; either reads as 0..1 here.
      const prog = act.progress > 1 || Number.isInteger(act.progress) ? act.progress / CAPTURE_TICKS : act.progress;
      drawCaptureRing(ctx, x, y, b.x * TILE, b.y * TILE, bs.w * TILE, bs.h * TILE, Math.max(0, Math.min(1, prog)), TEAM[u.owner].main, t);
    }
    for (const { u, x, y } of drawn) {
      const spec = UNITS[u.kind];
      const frac = u.hp / maxHpOf(u);
      const r = spec.category === 'infantry' ? 9 : 14;
      if (ov.selected.has(u.id) || ov.hover === u.id) hpBar(ctx, x - r, y - r - 7, r * 2, frac);
      else if (frac < 1) hpBar(ctx, x - r, y - r - 5, r * 2, frac, true);
      if (u.kind === 'hauler' && ov.selected.has(u.id)) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - r, y - r - 3, r * 2, 2.5);
        ctx.fillStyle = ART.ore;
        ctx.fillRect(x - r, y - r - 3, r * 2 * (u.cargo / 600), 2.5);
      }
      const vet = (u as unknown as { vet?: number }).vet ?? 0;
      if (vet > 0) chevrons(ctx, x + r + 2, y - r - 2, Math.min(2, vet));
      const group = u.owner === 0 ? ov.groupOf?.get(u.id) : undefined;
      if (group !== undefined) groupBadge(ctx, x, y + r + 1, group);
      if (u.hero) drawHeroBadge(ctx, x - r + 4, y - r - 13, u.hero.level);
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
        if (Math.random() < 0.5) this.fx.add({ kind: 'smoke', x, y, z: lift, life: 0.5, size: 2, grow: 2 });
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
        this.fx.add({ kind: 'smoke', x, y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 0.55, size: 2, grow: 2.4 });
      } else {
        ctx.fillStyle = '#ffe9b0';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7. Flashes, tracers and explosions.
    if (!this.primed) {
      // A loaded save carries a few seconds of old effects: neither replay them nor play them.
      for (const e of cur.effects) this.seen.add(e.id);
      this.primed = true;
    }
    for (const e of cur.effects) {
      const age = rt - e.at + 1;
      const x = e.x * TILE;
      const y = e.y * TILE;
      if (!this.seen.has(e.id)) {
        this.seen.add(e.id);
        if (e.kind === 'boom') this.burst(x, y, e.size, e.weapon);
        if (e.kind === 'sold') for (let i = 0; i < 18; i++) this.fx.spark(x, y);
        startCampaignEffect(e, this.fx);
        if (age < 4) this.hear(e, cam, vis);
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
        // The white-hot instant of the blast; the fireball, smoke and debris are particles.
        const dur = e.size >= 2 ? 3 : 2;
        if (age > dur) continue;
        const f = age / dur;
        const R = (e.size >= 2 ? 40 : e.size >= 1 ? 22 : e.weapon === 'artillery' ? 18 : 9) * (0.7 + f * 0.6);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - f) * (1 - f);
        ctx.drawImage(sprites().fire, x - R, y - R, R * 2, R * 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      } else if (e.kind === 'sold' && age < 12) {
        ctx.strokeStyle = `rgba(255,230,120,${1 - age / 12})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, e.size * 10 * (age / 6), 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind !== 'muzzle' && e.kind !== 'sold') {
        drawCampaignEffect(ctx, e, age, cur, t);
      }
    }
    if (this.seen.size > 4000) {
      const live = new Set(cur.effects.map(e => e.id));
      for (const id of this.seen) if (!live.has(id)) this.seen.delete(id);
    }

    // 8. Particles.
    this.fx.step(dt);
    this.fx.drawAir(ctx, inView);

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
    // tile canvas scaled up with smoothing, which is what gives it soft edges. Cloud shadows and
    // the vignette ride in the same canvas (see fx/atmosphere.ts), so they cost no extra fill.
    const d = this.fogImg.data;
    const [fr, fg, fb] = ART.fog;
    const shade = this.atmosphere.shade(t, cam, tx0, ty0, tx1, ty1);
    for (let k = 0; k < MAP_W * MAP_H; k++) {
      d[k * 4] = fr;
      d[k * 4 + 1] = fg;
      d[k * 4 + 2] = fb;
      const a = explored.charCodeAt(k) !== 49 ? 255 : vis[k] ? 0 : 120;
      d[k * 4 + 3] = 255 - ((255 - a) * (255 - shade[k])) / 255;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
    ctx.drawImage(this.fog, 0, 0, MAP_W * TILE, MAP_H * TILE);
    // Recon sweeps: a soft scanning ring over the revealed area, above the fog.
    if (cur.recon)
      for (const [cx, cy, r, until] of cur.recon) {
        if (until <= cur.tick) continue;
        drawReconArea(ctx, cx * TILE, cy * TILE, r * TILE, t, (until - rt) / TICKS_PER_SECOND);
      }
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

  /**
   * The sound of an effect, placed on screen: panned by where it is, quieter the further from the
   * middle of the view, and silent under the fog, so sound never reveals what the player cannot see.
   */
  private hear(e: GameState['effects'][number], cam: Camera, vis: Uint8Array) {
    const k = Math.floor(e.y) * MAP_W + Math.floor(e.x);
    // A recon sweep or a barrage is called by a commander and heard on the radio, fog or not.
    if (!vis[k] && e.kind !== 'recon' && e.kind !== 'barrage') return;
    let kind: SoundKind;
    let gain = 1;
    const campaign = CAMPAIGN_SOUND[e.kind];
    if (campaign) kind = campaign;
    else if (e.kind === 'muzzle') kind = e.weapon === 'bullet' ? 'bullet' : e.weapon === 'rocket' ? 'rocket' : e.weapon === 'artillery' ? 'artillery' : 'shell';
    else if (e.kind === 'sold') kind = 'sold';
    else if (e.size >= 2) kind = 'boomBuilding';
    else if (e.size >= 1) kind = 'boomVehicle';
    else {
      kind = 'boomSmall';
      gain = e.size > 0 || e.weapon === 'artillery' ? 0.9 : 0.5;
    }
    const sx = (e.x * TILE - cam.x) * cam.zoom;
    const sy = (e.y * TILE - cam.y) * cam.zoom;
    const half = cam.w / 2 || 1;
    const pan = Math.max(-0.9, Math.min(0.9, (sx - half) / half));
    const inView = sx >= 0 && sy >= 0 && sx <= cam.w && sy <= cam.h;
    const dTiles = Math.hypot(sx - half, sy - cam.h / 2) / (TILE * cam.zoom);
    gain *= Math.max(0.12, Math.min(1, 1.15 - dTiles / 30)) * (inView ? 1 : 0.45);
    sound.play(kind, pan, gain);
  }

  private burst(x: number, y: number, size: number, weapon?: string) {
    this.fx.explode(x, y, size, weapon === 'artillery');
    // A structure's footprint gets rubble and a vehicle a scorch under its wreck, from Scars.
    if (size >= 1) return;
    this.scars.stampScorch(x, y, weapon === 'artillery' ? 14 : size >= 0.5 ? 9 : 5);
  }

  /** Structures producing right now: the head of a queue being worked, or a hauler unloading. */
  private workingSet(s: GameState): Set<number> {
    if (this.workingFor === s) return this.working;
    this.workingFor = s;
    const set = new Set<number>();
    for (const owner of [0, 1] as const) {
      const q = s.players[owner].queues;
      for (const cat of ['building', 'infantry', 'vehicle'] as const) {
        const head = q[cat][0];
        if (!head || head.progress >= buildTicksOf(head.kind)) continue;
        const b = producerFor(s, owner, cat);
        if (b) set.add(b.id);
      }
    }
    for (const u of s.units) if (u.order.type === 'harvest' && u.order.phase === 'unload' && u.order.refinery) set.add(u.order.refinery);
    this.working = set;
    return set;
  }

  /**
   * Light thrown on the ground by each shot fired in the last moments: an additive pool of warm
   * light around the gun. Only where the player can see, like the sound.
   */
  private groundLight(ctx: CanvasRenderingContext2D, cur: GameState, rt: number, vis: Uint8Array, inView: (x: number, y: number, m?: number) => boolean) {
    const img = sprites().light;
    let lit = false;
    let lights = 0;
    for (const e of cur.effects) {
      if (e.kind !== 'muzzle') continue;
      const age = rt - e.at + 1;
      if (age < 0 || age >= LIGHT_TICKS) continue;
      const x = e.x * TILE;
      const y = e.y * TILE;
      if (!inView(x, y, 60) || !vis[Math.floor(e.y) * MAP_W + Math.floor(e.x)]) continue;
      if (!lit) {
        ctx.globalCompositeOperation = 'lighter';
        lit = true;
      }
      if (++lights > MAX_LIGHTS) break;
      const r = e.weapon === 'bullet' ? 14 : e.weapon === 'rocket' ? 24 : e.weapon === 'artillery' ? 40 : 28;
      const k = 1 - age / LIGHT_TICKS;
      ctx.globalAlpha = k * k * (e.weapon === 'bullet' ? 0.55 : 0.85);
      ctx.drawImage(img, x - r, y - r * 0.8, r * 2, r * 1.6);
    }
    if (lit) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Where each selected unit of the player's is heading: a dashed line from the unit through any
   * queued waypoints to its goal, marching towards it, with a marker at the end. Green for a move,
   * amber for an attack-move, red to an attack target. More than four units share lines (below).
   */
  private orderLines(ctx: CanvasRenderingContext2D, cur: GameState, drawn: { u: Unit; x: number; y: number }[], ov: Overlay, t: number) {
    if (!ov.selected.size) return;
    const lines: [number[], number[], number[]] = [[], [], []];
    const ends: [number[], number[], number[]] = [[], [], []];
    let targets: Map<number, { x: number; y: number }> | null = null;
    const chains: { lane: number; pts: number[] }[] = [];
    for (const { u, x, y } of drawn) {
      if (u.owner !== 0 || !ov.selected.has(u.id)) continue;
      const o = u.order;
      const pts: number[] = [x, y];
      let lane = 0;
      if (o.type === 'move' || o.type === 'attackMove') {
        lane = o.type === 'move' ? 0 : 1;
        pts.push(o.x * TILE, o.y * TILE);
      } else if (o.type === 'attack') {
        if (!targets) {
          targets = new Map();
          for (const v of cur.units) targets.set(v.id, { x: v.x * TILE, y: v.y * TILE });
          for (const b of cur.buildings) {
            const spec = BUILDINGS[b.kind];
            targets.set(b.id, { x: (b.x + spec.w / 2) * TILE, y: (b.y + spec.h / 2) * TILE });
          }
        }
        const tg = targets.get(o.target);
        if (!tg) continue;
        lane = 2;
        pts.push(tg.x, tg.y);
      }
      // Queued waypoints, read loosely: any list of points with x and y in tiles.
      const queue = (u as unknown as { queue?: unknown }).queue;
      if (Array.isArray(queue))
        for (const q of queue) {
          const w = q as { x?: unknown; y?: unknown } | null;
          if (w && typeof w.x === 'number' && typeof w.y === 'number') pts.push(w.x * TILE, w.y * TILE);
        }
      if (pts.length < 4) continue;
      chains.push({ lane, pts });
    }
    // A big selection draws one line per order, from the group's middle through the average of its
    // waypoints, rather than one line per unit: twenty units sent somewhere made a spider's web.
    let shown = chains;
    if (chains.length > 4) {
      const groups = new Map<string, { lane: number; sum: number[]; n: number }>();
      for (const c of chains) {
        const key = `${c.lane}:${c.pts.length}`;
        const g = groups.get(key) ?? { lane: c.lane, sum: new Array(c.pts.length).fill(0), n: 0 };
        for (let i = 0; i < c.pts.length; i++) g.sum[i] += c.pts[i];
        g.n++;
        groups.set(key, g);
      }
      shown = [...groups.values()].map(g => ({ lane: g.lane, pts: g.sum.map(v => v / g.n) }));
    }
    for (const { lane, pts } of shown) {
      const l = lines[lane];
      for (let i = 0; i + 3 < pts.length; i += 2) l.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      for (let i = 2; i < pts.length; i += 2) ends[lane].push(pts[i], pts[i + 1]);
    }
    const cols = ['rgba(125,255,138,', 'rgba(255,196,90,', 'rgba(255,110,90,'];
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -(t * 14) % 9;
    for (let lane = 0; lane < 3; lane++) {
      const l = lines[lane];
      if (!l.length) continue;
      ctx.strokeStyle = cols[lane] + '0.6)';
      ctx.beginPath();
      for (let i = 0; i < l.length; i += 4) {
        ctx.moveTo(l[i], l[i + 1]);
        ctx.lineTo(l[i + 2], l[i + 3]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    for (let lane = 0; lane < 3; lane++) {
      const e = ends[lane];
      if (!e.length) continue;
      ctx.strokeStyle = cols[lane] + '0.85)';
      ctx.fillStyle = cols[lane] + '0.25)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < e.length; i += 2) {
        ctx.moveTo(e[i] + 4, e[i + 1]);
        ctx.ellipse(e[i], e[i + 1], 4, 2.8, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      if (lane === 2) continue;
      ctx.beginPath();
      for (let i = 0; i < e.length; i += 2) {
        ctx.moveTo(e[i], e[i + 1]);
        ctx.lineTo(e[i], e[i + 1] - 7);
      }
      ctx.stroke();
    }
  }
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

/** Rank chevrons for a veteran (one) or elite (two) unit, gold with a dark edge. */
function chevrons(ctx: CanvasRenderingContext2D, x: number, y: number, n: number) {
  ctx.lineJoin = 'miter';
  for (let i = 0; i < n; i++) {
    const cy = y - i * 3.6;
    ctx.beginPath();
    ctx.moveTo(x - 3.5, cy - 2);
    ctx.lineTo(x, cy + 0.8);
    ctx.lineTo(x + 3.5, cy - 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = n >= 2 ? '#ffd75a' : '#e8c460';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** The control-group digit under a grouped unit. */
function groupBadge(ctx: CanvasRenderingContext2D, x: number, y: number, digit: number) {
  ctx.fillStyle = 'rgba(8,12,10,0.78)';
  ctx.fillRect(x - 4.5, y, 9, 9);
  ctx.strokeStyle = 'rgba(125,255,138,0.6)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x - 4.5, y, 9, 9);
  ctx.fillStyle = '#d8ffd9';
  ctx.font = 'bold 8px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(digit), x, y + 4.8);
}
