import { dockTile } from '../sim/grid';
import { cargoMaxOf } from '../sim/loadout';
import { isDetected } from '../sim/mission';
import {
  BUILDINGS,
  CAPTURE_TICKS,
  CHARGE_FUSE,
  ENGINEER_REPAIR_RANGE,
  MAP_H as DEFAULT_MAP_H,
  MAP_W as DEFAULT_MAP_W,
  MEDIC_RANGE,
  POWERS,
  REPAIR_BAY_RANGE,
  AIR_AMMO,
  TICKS_PER_SECOND,
  UNITS,
  type BuildingKind,
  type MapType,
} from '../sim/rules';
import { sidesOf } from '../sim/sides';
import { buildTicksOf, powerOf, producerFor, teamVisibility } from '../sim/state';
import type { Building, Effect, GameState, Projectile, Unit } from '../sim/types';
import { ART, TEAM } from '../theme';
import { AIR_LIFT, drawAirShadow, drawBuilding, drawDock, drawHeroBadge, drawUnit, TILE, type BuildingPose, type UnitPose } from './art';
import { drawCampaignEffect, drawCaptureRing, drawChargeOnBuilding, drawOverdriveGlow, drawReconArea, startCampaignEffect } from './fx/campaign';
import { Atmosphere } from './fx/atmosphere';
import { Particles } from './fx/particles';
import { Scars } from './fx/scars';
import { sprites } from './fx/sprites';
import { Water } from './fx/water';
import { drawOreField } from './fx/ore';
import { contactShadow, footprint, SKIRT } from './fx/ground';
import { currentPace } from '../lib/motion';
import { sound, type SoundKind } from './sound';
import { drawMissileMarker, drawMissileInFlight, flameJet, MISSILE_ARC } from './fx/strike';
import { paintMiniTerrain, paintTerrain, paintTerrainOffThread } from './terrain';
// round5:D. Neutral sites and tier three (fireline-round5-design.md, workstream D).
import { drawSiteLayer } from './art';
import { stealthSeen } from '../sim/sites';

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

/** Distance from a point to a structure's footprint, in tiles (0 inside it). */
function toFootprint(x: number, y: number, b: Building): number {
  const spec = BUILDINGS[b.kind];
  const dx = Math.max(b.x - x, 0, x - (b.x + spec.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + spec.h));
  return Math.hypot(dx, dy);
}

/**
 * What the structures and support units are doing in one state, for their poses: each wall's
 * neighbours, which Repair Bays are mending something (and which way it lies), which Medics are
 * treating someone, and each side's missile charge. Worked out once per state object.
 */
interface Activity {
  joins: Map<number, number>;
  bayAim: Map<number, number>;
  medics: Set<number>;
  /** Per side: missile cooldown left, or -1 when the side has no missile. */
  missileCd: number[];
}

function activityOf(s: GameState): Activity {
  const joins = new Map<number, number>();
  const wallAt = new Map<number, Building>();
  const MAP_W = s.mapW;
  for (const b of s.buildings) if (BUILDINGS[b.kind].wall) wallAt.set(b.y * MAP_W + b.x, b);
  for (const b of wallAt.values()) {
    const same = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < s.mapH && wallAt.get(y * MAP_W + x)?.owner === b.owner;
    joins.set(b.id, (same(b.x, b.y - 1) ? 1 : 0) | (same(b.x + 1, b.y) ? 2 : 0) | (same(b.x, b.y + 1) ? 4 : 0) | (same(b.x - 1, b.y) ? 8 : 0));
  }
  const bayAim = new Map<number, number>();
  const bays = s.buildings.filter(b => b.kind === 'repairbay' && b.hp > 0);
  const medics = s.units.filter(u => UNITS[u.kind].medic);
  const busy = new Set<number>();
  if (bays.length || medics.length)
    for (const v of s.units) {
      if (v.hp <= 0 || v.hp >= maxHpOf(v)) continue;
      const cat = UNITS[v.kind].category;
      if (cat === 'vehicle')
        for (const b of bays) {
          if (b.owner !== v.owner || bayAim.has(b.id) || toFootprint(v.x, v.y, b) > REPAIR_BAY_RANGE) continue;
          const spec = BUILDINGS[b.kind];
          bayAim.set(b.id, Math.atan2(v.y - (b.y + spec.h / 2), v.x - (b.x + spec.w / 2)));
        }
      else
        for (const m of medics) {
          if (m.owner !== v.owner || m.id === v.id || busy.has(m.id) || Math.hypot(m.x - v.x, m.y - v.y) > MEDIC_RANGE) continue;
          busy.add(m.id);
        }
    }
  return { joins, bayAim, medics: busy, missileCd: sidesOf(s).map(o => s.powers?.[o]?.missile ?? -1) };
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
  /**
   * Painted on the first frame, when the state says which kind of map this is: in a worker where
   * the browser has one (paintTerrainOffThread), so the page never stalls on a large map. Until it
   * arrives the ground is `placeholder`, the minimap's one pixel per tile stretched over the map,
   * and there are no marks or water animation (scars and water are null).
   */
  private terrain: HTMLCanvasElement | null = null;
  private placeholder: HTMLCanvasElement | null = null;
  private fog: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImg: ImageData;
  private fx = new Particles();
  private scars: Scars | null = null;
  private water: Water | null = null;
  private tiles: string;
  private mapType: MapType | undefined;
  private painted = false;
  private actFor: GameState | null = null;
  private act: Activity = { joins: new Map(), bayAim: new Map(), medics: new Set(), missileCd: [-1, -1] };
  private atmosphere: Atmosphere;
  /** The map's size in tiles (GameState mapW, mapH). */
  private mapW: number;
  private mapH: number;
  /** Structures producing something right now, cached per state object. */
  private workingFor: GameState | null = null;
  private working = new Set<number>();
  private seen = new Set<number>();
  /** False until the first frame, which marks what is already on the field as seen, silently. */
  private primed = false;
  private visFor: GameState | null = null;
  private vis: Uint8Array = new Uint8Array(0);
  private lastNow = 0;
  private fogFor: GameState | null = null;
  private fogA = new Uint8Array(0);
  private fogRaw = new Uint8Array(0);
  private fogRow = new Uint16Array(0);
  /** Whether motion is on (lib/motion.ts), read once a second: off holds the ore's glints still. */
  private sparkle = true;
  private paceAt = -Infinity;

  /**
   * `mapType` picks the look of the ground (river banks, highland cliffs, canyon walls); when it is
   * left out, the first state drawn supplies it (GameState.mapType), and without one the ground
   * is the original map's.
   */
  constructor(tiles: string, mapType?: MapType, mapW = DEFAULT_MAP_W, mapH = DEFAULT_MAP_H) {
    this.tiles = tiles;
    this.mapType = mapType;
    this.mapW = mapW;
    this.mapH = mapH;
    const MAP_W = mapW;
    const MAP_H = mapH;
    this.atmosphere = new Atmosphere(mapW, mapH);
    this.fog = document.createElement('canvas');
    this.fog.width = MAP_W;
    this.fog.height = MAP_H;
    this.fogCtx = this.fog.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(MAP_W, MAP_H);
  }

  private paint(mapType: MapType | undefined) {
    this.painted = true;
    const job = paintTerrainOffThread(this.tiles, mapType, this.mapW, this.mapH);
    if (!job) {
      this.install(paintTerrain(this.tiles, mapType, this.mapW, this.mapH));
      return;
    }
    this.placeholder = paintMiniTerrain(this.tiles, this.mapW, this.mapH);
    job.then(
      c => this.install(c),
      () => this.install(paintTerrain(this.tiles, mapType, this.mapW, this.mapH)),
    );
  }

  private install(terrain: HTMLCanvasElement) {
    this.terrain = terrain;
    this.placeholder = null;
    const scars = new Scars(terrain, this.tiles);
    const water = new Water(this.tiles, terrain);
    scars.onRepaint = (x, y, w, h) => water.invalidate(x, y, w, h);
    this.scars = scars;
    this.water = water;
  }


  /**
   * The fog's alpha per tile (255 unexplored, 120 explored but unwatched, 0 in sight), blurred
   * with a 1-2-1 kernel each way so the edge spreads over two tiles and its corners round off.
   * A tile in sight stays mostly clear, so nothing the player can see is hidden by the
   * blur. Cached per state object, like the visibility it comes from.
   */
  private fogAlpha(s: GameState, vis: Uint8Array): Uint8Array {
    if (this.fogFor === s) return this.fogA;
    this.fogFor = s;
    const W = this.mapW;
    const H = this.mapH;
    const n = W * H;
    if (this.fogA.length !== n) {
      this.fogA = new Uint8Array(n);
      this.fogRaw = new Uint8Array(n);
      this.fogRow = new Uint16Array(n);
    }
    const raw = this.fogRaw;
    const row = this.fogRow;
    const out = this.fogA;
    const ex = s.explored;
    for (let k = 0; k < n; k++) raw[k] = ex.charCodeAt(k) !== 49 ? 255 : vis[k] ? 0 : 120;
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) {
        const c = raw[o + x];
        row[o + x] = (x > 0 ? raw[o + x - 1] : c) + 2 * c + (x < W - 1 ? raw[o + x + 1] : c);
      }
    }
    for (let y = 0; y < H; y++) {
      const o = y * W;
      const up = y > 0 ? o - W : o;
      const dn = y < H - 1 ? o + W : o;
      for (let x = 0; x < W; x++) {
        const v = (row[up + x] + 2 * row[o + x] + row[dn + x]) >> 4;
        out[o + x] = raw[o + x] === 0 ? Math.min(v, 72) : v;
      }
    }
    return out;
  }

  /** What side 0 (with its allies) can see right now. Cached per state object. */
  visible(s: GameState): Uint8Array {
    if (this.visFor !== s) {
      this.vis = teamVisibility(s, 0);
      this.visFor = s;
    }
    return this.vis;
  }

  draw(ctx: CanvasRenderingContext2D, cur: GameState, prev: GameState, alpha: number, cam: Camera, ov: Overlay, now: number, dpr: number): void {
    const MAP_W = this.mapW;
    const MAP_H = this.mapH;
    const dt = Math.min(0.1, this.lastNow ? (now - this.lastNow) / 1000 : 0);
    this.lastNow = now;
    const t = now / 1000;
    const rt = prev.tick + (cur.tick - prev.tick) * alpha;
    const vis = this.visible(cur);
    const explored = cur.explored;
    const z = cam.zoom * dpr;
    if (!this.painted) this.paint(this.mapType ?? cur.mapType);
    if (this.actFor !== cur) {
      this.act = activityOf(cur);
      this.actFor = cur;
    }
    const act = this.act;

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
    if (this.terrain && this.scars && this.water) {
      this.scars.update(cur, vis, now);
      this.scars.step(dt, now, this.fx);
      this.water.update(t, tx0, ty0, tx1, ty1);
      ctx.drawImage(this.terrain, sx, sy, sw, sh, sx, sy, sw, sh);
    } else if (this.placeholder) {
      // Still painting: the minimap's colours, one tile to a pixel, stretched and smoothed.
      ctx.drawImage(this.placeholder, tx0, ty0, tx1 - tx0 + 1, ty1 - ty0 + 1, sx, sy, sw, sh);
    }

    // 2. Burnt-out wrecks.
    this.scars?.draw(ctx, now, inView);

    // 2b. Light on the ground: muzzle flashes, blasts, and their shockwaves.
    this.groundLight(ctx, cur, rt, vis, inView);
    this.fx.drawGround(ctx, inView);

    // 3. Ore: stained ground, crystal clusters and glints (fx/ore.ts).
    if (now - this.paceAt > 1000) {
      this.paceAt = now;
      this.sparkle = currentPace() !== 'off';
    }
    drawOreField(ctx, cur.ore, explored, MAP_W, tx0, ty0, tx1, ty1, t, this.sparkle);

    // 4. Structures, back to front.
    const low = sidesOf(cur).map(o => powerOf(cur, o).low);
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
      const d = dockTile(cur, b);
      drawDock(ctx, d.x * TILE, d.y * TILE);
    }
    // round5:D begin. Neutral sites (fireline-round5-design.md): one call drawing every seen site
    // (drawSite in art.ts) goes under this line, before the structures.
    drawSiteLayer(ctx, cur, explored, vis, rt, t);
    // round5:D end.
    // The ground each structure stands on: a trampled skirt and its occlusion shadow (fx/ground.ts),
    // all of them before any structure, so a neighbour's skirt never laps over a wall.
    for (const b of buildings) {
      const spec = BUILDINGS[b.kind];
      const px = b.x * TILE;
      const py = b.y * TILE;
      if (!inView(px + (spec.w * TILE) / 2, py + (spec.h * TILE) / 2, 140)) continue;
      ctx.globalAlpha = Math.min(1, Math.max(0.15, (rt - b.placedAt) / 15));
      ctx.drawImage(footprint(spec.w * TILE, spec.h * TILE, !spec.wall), px - SKIRT, py - SKIRT);
    }
    ctx.globalAlpha = 1;
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
      if (b.kind === 'wall') bpose.joins = act.joins.get(b.id) ?? 0;
      else if (b.kind === 'repairbay') {
        const aim = act.bayAim.get(b.id);
        bpose.working = aim !== undefined;
        if (aim !== undefined) bpose.turret = aim;
      } else if (b.kind === 'strikecommand') this.silo(cur, b, bpose, rt, act);
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
    const aloft: { u: Unit; x: number; y: number }[] = [];
    for (const u of cur.units) {
      const p = prevById.get(u.id) ?? u;
      const x = (p.x + (u.x - p.x) * alpha) * TILE;
      const y = (p.y + (u.y - p.y) * alpha) * TILE;
      if (!inView(x, y)) continue;
      if (u.owner !== 0) {
        if (!vis[Math.floor(u.y) * MAP_W + Math.floor(u.x)]) continue;
        if (u.kind === 'spy' && !spySeen(cur, u)) continue;
        if (UNITS[u.kind].stealth && !stealthSeen(cur, u, 0)) continue;
      }
      // Aircraft are drawn in their own pass, after every ground unit (below).
      if (UNITS[u.kind].category === 'air') aloft.push({ u, x, y });
      else drawn.push({ u, x, y });
    }
    drawn.sort((a, b) => a.y - b.y);
    aloft.sort((a, b) => a.y - b.y);
    this.orderLines(ctx, cur, drawn.concat(aloft), ov, t);
    // Contact shadows, under every ground unit before any is drawn.
    const contact = contactShadow();
    for (const { u, x, y } of drawn) {
      const r = UNITS[u.kind].category === 'infantry' ? 7 : u.kind === 'bastion' ? 22 : 15;
      ctx.drawImage(contact, x - r * 1.15 + 1.5, y - r * 0.72 + 2.5, r * 2.3, r * 1.44);
    }
    for (const { u, x, y } of drawn) {
      const spec = UNITS[u.kind];
      const r = spec.category === 'infantry' ? 8 : u.kind === 'bastion' ? 20 : 14;
      if (ov.selected.has(u.id) || ov.hover === u.id) {
        // A faint pool of the selection colour on the ground, ringed.
        const col = u.owner === 0 ? ART.select : ART.selectEnemy;
        ctx.beginPath();
        ctx.ellipse(x, y + 2, r + 1, (r + 1) * 0.7, 0, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.13;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
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
        // Haulers: ore carried. Landing Craft: places taken aboard.
        cargo: UNITS[u.kind].carries ? (u.carried ?? []).reduce((n, r) => n + (UNITS[r.kind].category === 'vehicle' ? 2 : 1), 0) / (UNITS[u.kind].carries ?? 1) : u.cargo / cargoMaxOf(u),
        sinceShot,
        hp: u.hp / maxHpOf(u),
        firing: sinceShot < FIRING_WINDOW,
      };
      if (act.medics.has(u.id)) upose.repairing = true;
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
      const cloaked = (u.kind === 'spy' || !!spec.stealth) && u.owner === 0;
      if (cloaked) ctx.globalAlpha = 0.55;
      drawUnit(ctx, u.kind, u.owner, x, y, upose);
      if (cloaked) ctx.globalAlpha = 1;
      if (spec.category === 'vehicle' && moving) {
        this.scars?.track(u, x, y, this.fx, dt);
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
      const r = spec.category === 'infantry' ? 9 : u.kind === 'bastion' ? 20 : 14;
      if (ov.selected.has(u.id) || ov.hover === u.id) hpBar(ctx, x - r, y - r - 7, r * 2, frac);
      else if (frac < 1) hpBar(ctx, x - r, y - r - 5, r * 2, frac, true);
      if (u.kind === 'hauler' && ov.selected.has(u.id)) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - r, y - r - 3, r * 2, 2.5);
        ctx.fillStyle = ART.ore;
        ctx.fillRect(x - r, y - r - 3, r * 2 * Math.min(1, u.cargo / cargoMaxOf(u)), 2.5);
      }
      const vet = (u as unknown as { vet?: number }).vet ?? 0;
      if (vet > 0) chevrons(ctx, x + r + 2, y - r - 2, Math.min(2, vet));
      const group = u.owner === 0 ? ov.groupOf?.get(u.id) : undefined;
      if (group !== undefined) groupBadge(ctx, x, y + r + 1, group);
      if (u.hero) drawHeroBadge(ctx, x - r + 4, y - r - 13, u.hero.level);
    }

    // 5b. Aircraft, in one pass over every ground unit: the shadow on the ground, then the craft
    // lifted above it with its rotor turning or a contrail behind it.
    this.aircraft(ctx, cur, prevById, aloft, ov, alpha, t, dt);

    // 6. Shells, grenades, rockets and missiles in flight.
    let byId: Map<number, Unit> | null = null;
    const shooterKind = (p: Projectile) => {
      if (!p.shooter) return undefined;
      if (!byId) byId = new Map(cur.units.map(u => [u.id, u]));
      return byId.get(p.shooter)?.kind;
    };
    for (const p of cur.projectiles) {
      const span = Math.max(1, p.hitAt - p.firedAt);
      const f = Math.min(1, Math.max(0, (rt - p.firedAt) / span));
      if (p.weapon === 'missile') {
        // Drawn from its silo, high over the map; the warning marker is drawn above the fog below.
        const from = this.launchPoint(cur, p);
        drawMissileInFlight(ctx, from.x, from.y, p.toX * TILE, p.toY * TILE, f, t, p.owner, this.fx, dt, inView);
        continue;
      }
      const x = (p.fromX + (p.toX - p.fromX) * f) * TILE;
      const y = (p.fromY + (p.toY - p.fromY) * f) * TILE;
      if (!inView(x, y)) continue;
      if (p.weapon === 'artillery' && shooterKind(p) === 'grenadier') {
        // A grenade: a short lob, tumbling, its shadow on the ground under it.
        const d = Math.hypot(p.toX - p.fromX, p.toY - p.fromY) * TILE;
        const lift = Math.sin(f * Math.PI) * Math.min(30, 8 + d * 0.22);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(x, y, 2, 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3f4a2c';
        ctx.beginPath();
        ctx.arc(x, y - lift, 2.1, 0, Math.PI * 2);
        ctx.fill();
        const spin = rt * 2.2 + p.id;
        ctx.fillStyle = '#c9c4ad';
        ctx.fillRect(x + Math.cos(spin) * 1.6 - 0.6, y - lift + Math.sin(spin) * 1.6 - 0.6, 1.2, 1.2);
      } else if (p.weapon === 'artillery') {
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
        // Missile Carriers' rockets are bigger, climb a little, and leave a long trail.
        const big = shooterKind(p) === 'missilecarrier';
        const lift = big ? Math.sin(f * Math.PI) * 18 : 0;
        const ang = Math.atan2(p.toY - p.fromY - (big ? Math.cos(f * Math.PI) * 0.6 : 0), p.toX - p.fromX);
        ctx.save();
        ctx.translate(x, y - lift);
        ctx.rotate(ang);
        if (big) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.8;
          ctx.drawImage(sprites().fire, -15, -5, 10, 10);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#e8e6de';
          ctx.fillRect(-6, -1.4, 10, 2.8);
          ctx.fillStyle = '#3a3d3e';
          ctx.beginPath();
          ctx.moveTo(4, -1.4);
          ctx.lineTo(7, 0);
          ctx.lineTo(4, 1.4);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#2a2d2e';
          ctx.fillRect(-6.5, -2.4, 2, 4.8);
        } else {
          ctx.fillStyle = '#d8d8d0';
          ctx.fillRect(-4, -1, 7, 2);
          ctx.fillStyle = '#ffb347';
          ctx.fillRect(-7, -1.2, 3, 2.4);
        }
        ctx.restore();
        const tx = x - Math.cos(ang) * 6;
        const ty = y - Math.sin(ang) * 6;
        this.fx.add({ kind: 'smoke', x: tx, y: ty, z: lift, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: big ? 1.1 : 0.55, size: big ? 2.6 : 2, grow: big ? 3 : 2.4 });
      } else if (p.weapon === 'bomb') {
        // A bomb falling from the Bomber's height, its shadow closing on it.
        const lift = (1 - f) * AIR_LIFT * TILE;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(x, y, 2.4, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3e4232';
        ctx.beginPath();
        ctx.ellipse(x, y - lift, 1.8, 2.8, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.weapon === 'flak' || p.weapon === 'aamissile') {
        // Climbing from the gun to the aircraft's height; an Interceptor's flies level at it.
        const lift = (shooterKind(p) === 'interceptor' ? 1 : f) * AIR_LIFT * TILE;
        if (p.weapon === 'aamissile') {
          const ang = Math.atan2(p.toY - p.fromY - AIR_LIFT, p.toX - p.fromX);
          ctx.save();
          ctx.translate(x, y - lift);
          ctx.rotate(ang);
          ctx.fillStyle = '#e8e6de';
          ctx.fillRect(-4, -0.9, 7, 1.8);
          ctx.fillStyle = '#ff7a4a';
          ctx.fillRect(-6, -1, 2, 2);
          ctx.restore();
          this.fx.add({ kind: 'smoke', x: x - Math.cos(ang) * 5, y: y - Math.sin(ang) * 5, z: lift, vx: 0, vy: 0, life: 0.6, size: 1.6, grow: 2 });
        } else {
          ctx.fillStyle = '#fff1b8';
          ctx.fillRect(x - 1, y - lift - 1, 2, 2);
        }
      } else {
        ctx.fillStyle = '#ffe9b0';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7. Flashes, tracers and explosions.
    const markers: Effect[] = [];
    if (!this.primed) {
      // A loaded save carries a few seconds of old effects: neither replay them nor play them.
      for (const e of cur.effects) this.seen.add(e.id);
      this.primed = true;
    }
    for (const e of cur.effects) {
      const age = rt - e.at + 1;
      const x = e.x * TILE;
      // Anti-air bursts happen at the aircraft's height.
      const y = e.y * TILE - (e.weapon === 'flak' || e.weapon === 'aamissile' ? AIR_LIFT * TILE : 0);
      if (!this.seen.has(e.id)) {
        this.seen.add(e.id);
        if (e.kind === 'boom' && (e.weapon === 'flak' || e.weapon === 'aamissile')) this.flakBurst(x, y, e.weapon === 'aamissile');
        else if (e.kind === 'boom') this.burst(x, y, e.size, e.weapon);
        if (e.kind === 'bomb') this.burst(x, y, 1, 'bomb');
        if (e.kind === 'sold') for (let i = 0; i < 18; i++) this.fx.spark(x, y);
        if (e.kind === 'repair') for (let i = 0; i < 4; i++) this.fx.spark(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 8);
        if (e.kind === 'muzzle' && e.weapon === 'flame') this.fx.flameSpray(x, y, (e.x2 ?? e.x) * TILE, (e.y2 ?? e.y) * TILE);
        startCampaignEffect(e, this.fx);
        if (age < 4) this.hear(e, cam, vis, cur);
      }
      if (e.kind === 'missile') {
        markers.push(e);
        continue;
      }
      if (!inView(x, y, 120)) continue;
      if (e.kind === 'muzzle' && e.weapon === 'flame') {
        if (age < 4.5) flameJet(ctx, x, y, (e.x2 ?? e.x) * TILE, (e.y2 ?? e.y) * TILE, age / 4.5, t + e.id);
      } else if (e.kind === 'heal') {
        if (age < 6) this.healGlow(ctx, cur, e, x, y, age / 6, alpha);
      } else if (e.kind === 'repair') {
        if (age < 6) repairFlash(ctx, x, y, age / 6, t);
      } else if (e.kind === 'muzzle' && age < 2.2) {
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
        // The flash: a flame tongue out of the muzzle toward the target, over in a moment, then a
        // fading glow where the gun is.
        const ang = Math.atan2(ty - y, tx - x);
        const big = e.weapon === 'artillery' ? 1.5 : e.weapon === 'bullet' ? 0.5 : 1;
        const reach = e.weapon === 'bullet' ? 5 : 11;
        ctx.globalCompositeOperation = 'lighter';
        if (age < 1.1) {
          const k = 1 - age / 1.1;
          ctx.save();
          ctx.translate(x + Math.cos(ang) * reach, y + Math.sin(ang) * reach);
          ctx.rotate(ang);
          ctx.scale(big * (0.8 + 0.4 * k), big * (0.6 + 0.5 * k));
          ctx.globalAlpha = k;
          ctx.drawImage(sprites().flash, -8, -16);
          ctx.restore();
        }
        ctx.fillStyle = `rgba(255,190,100,${a * 0.6})`;
        ctx.beginPath();
        ctx.arc(x + Math.cos(ang) * reach, y + Math.sin(ang) * reach, 2 + big * 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      } else if (e.kind === 'bomb') {
        // A bomb's blast: brighter and wider than a shell's, over in a moment.
        if (age > 2.5) continue;
        const f = age / 2.5;
        const R = e.size * TILE * (0.6 + f * 0.6);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - f) * (1 - f);
        ctx.drawImage(sprites().fire, x - R, y - R, R * 2, R * 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      } else if (e.kind === 'boom' && (e.weapon === 'flak' || e.weapon === 'aamissile')) {
        // A puff of flak or a missile's burst: a small dark cloud with a hot centre.
        if (age > 6) continue;
        const f = age / 6;
        ctx.fillStyle = `rgba(40,40,38,${0.45 * (1 - f)})`;
        ctx.beginPath();
        ctx.arc(x, y, 4 + f * 5, 0, Math.PI * 2);
        ctx.fill();
        if (age < 1.5) {
          ctx.fillStyle = `rgba(255,214,140,${1 - age / 1.5})`;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
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
    // The fog's own alpha is softened over a tile each way and cached per state (fogAlpha), so its
    // edge is a rounded gradient rather than a staircase of tiles. ('high' smoothing on the scale
    // looked no better and cost frames on a machine without a GPU.)
    const d = this.fogImg.data;
    const [fr, fg, fb] = ART.fog;
    const shade = this.atmosphere.shade(t, cam, tx0, ty0, tx1, ty1);
    const fa = this.fogAlpha(cur, vis);
    for (let k = 0; k < MAP_W * MAP_H; k++) {
      d[k * 4] = fr;
      d[k * 4 + 1] = fg;
      d[k * 4 + 2] = fb;
      const a = fa[k];
      d[k * 4 + 3] = 255 - ((255 - a) * (255 - shade[k])) / 255;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
    ctx.drawImage(this.fog, 0, 0, MAP_W * TILE, MAP_H * TILE);
    // Missile strikes: the marker on the target, above the fog, so either side can see it coming.
    for (const e of markers) {
      const age = rt - e.at;
      const left = Math.max(0, MISSILE_ARC - age) / TICKS_PER_SECOND;
      if (age >= 0 && age <= MISSILE_ARC + 1) drawMissileMarker(ctx, e.x * TILE, e.y * TILE, e.size * TILE, age / MISSILE_ARC, left, t);
    }
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
      // A wall's ghost already joins the walls it would stand beside.
      let joins = 0;
      if (BUILDINGS[kind].wall)
        for (const b of cur.buildings) {
          if (b.owner !== 0 || !BUILDINGS[b.kind].wall) continue;
          if (b.x === tx && b.y === ty - 1) joins |= 1;
          else if (b.x === tx + 1 && b.y === ty) joins |= 2;
          else if (b.x === tx && b.y === ty + 1) joins |= 4;
          else if (b.x === tx - 1 && b.y === ty) joins |= 8;
        }
      drawBuilding(ctx, kind, 0, tx * TILE, ty * TILE, { t, rise: 1, lowPower: false, turret: -Math.PI / 4, sinceShot: 9, joins });
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
  private hear(e: GameState['effects'][number], cam: Camera, vis: Uint8Array, cur: GameState) {
    const k = Math.floor(e.y) * this.mapW + Math.floor(e.x);
    // A recon sweep, a barrage or a missile is called by a commander and heard on the radio, fog
    // or not; so is a missile's impact, which its marker has already shown to both sides.
    const radio = e.kind === 'recon' || e.kind === 'barrage' || e.kind === 'missile' || (e.kind === 'boom' && e.weapon === 'missile');
    if (!vis[k] && !radio) return;
    let kind: SoundKind;
    let gain = 1;
    const campaign = CAMPAIGN_SOUND[e.kind];
    if (campaign) kind = campaign;
    else if (e.kind === 'missile') kind = 'missileLaunch';
    else if (e.kind === 'heal') {
      kind = 'heal';
      gain = 0.5;
    } else if (e.kind === 'repair') {
      kind = 'repair';
      gain = 0.6;
    } else if (e.kind === 'muzzle') {
      if (e.weapon === 'artillery' && grenadierAt(cur, e.x, e.y)) kind = 'grenade';
      else
        kind =
          e.weapon === 'bullet' || e.weapon === 'flak'
            ? 'bullet'
            : e.weapon === 'rocket' || e.weapon === 'aamissile'
              ? 'rocket'
              : e.weapon === 'artillery'
                ? 'artillery'
                : e.weapon === 'flame'
                  ? 'flame'
                  : 'shell';
    } else if (e.kind === 'sold') kind = 'sold';
    else if (e.kind === 'boom' && e.weapon === 'missile') kind = 'missileImpact';
    else if (e.kind === 'boom' && e.weapon === 'flame') return;
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
    gain *= radio && (kind === 'missileLaunch' || kind === 'missileImpact') ? 1 : Math.max(0.12, Math.min(1, 1.15 - dTiles / 30)) * (inView ? 1 : 0.45);
    sound.play(kind, pan, gain);
  }

  /** A flak or anti-air missile burst in the air: a few sparks and a little smoke, no scorch on the ground. */
  private flakBurst(x: number, y: number, missile: boolean) {
    for (let i = 0; i < (missile ? 8 : 3); i++) this.fx.spark(x, y);
    this.fx.add({ kind: 'smoke', x, y, z: 0, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, life: 0.9, size: missile ? 3 : 2, grow: 2.5 });
  }

  /**
   * Aircraft: the shadow on the ground at the unit's position, the craft AIR_LIFT tiles above it,
   * a contrail behind a moving Bomber and a rotor wash under a Gunship, the selection ring round the
   * craft, and its health bar. Units under the fog are already left out of `aloft`.
   */
  private aircraft(
    ctx: CanvasRenderingContext2D,
    cur: GameState,
    prevById: Map<number, Unit>,
    aloft: { u: Unit; x: number; y: number }[],
    ov: Overlay,
    alpha: number,
    t: number,
    dt: number,
  ) {
    const lift = AIR_LIFT * TILE;
    for (const { u, x, y } of aloft) {
      const p = prevById.get(u.id) ?? u;
      const hull = Math.atan2(p.fy + (u.fy - p.fy) * alpha, p.fx + (u.fx - p.fx) * alpha);
      drawAirShadow(ctx, u.kind, x, y, hull);
    }
    for (const { u, x, y } of aloft) {
      const p = prevById.get(u.id) ?? u;
      const moving = Math.abs(u.x - p.x) + Math.abs(u.y - p.y) > 0.001;
      const w = UNITS[u.kind].weapon;
      const sinceShot = w && u.cooldown > 0 && u.order.type !== 'rearm' ? (w.cooldown - u.cooldown) / TICKS_PER_SECOND : 9;
      const max = AIR_AMMO[u.kind] ?? 1;
      const cap = UNITS[u.kind].carries;
      const pose: UnitPoseX = {
        hull: Math.atan2(p.fy + (u.fy - p.fy) * alpha, p.fx + (u.fx - p.fx) * alpha),
        turret: Math.atan2(p.ty + (u.ty - p.ty) * alpha, p.tx + (u.tx - p.tx) * alpha),
        t: t + u.id * 0.37,
        moving,
        cargo: cap ? (u.carried?.length ?? 0) / cap : (u.ammo ?? max) / max,
        sinceShot,
        hp: u.hp / maxHpOf(u),
        firing: sinceShot < FIRING_WINDOW,
      };
      if (ov.selected.has(u.id) || ov.hover === u.id) {
        ctx.strokeStyle = u.owner === 0 ? ART.select : ART.selectEnemy;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(x, y - lift, 18, 13, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Parked on its pad it sits low; in flight it rides AIR_LIFT above its shadow.
      const h = !moving && u.order.type === 'rearm' ? lift * 0.3 : lift;
      drawUnit(ctx, u.kind, u.owner, x, y - h, pose);
      if ((u.kind === 'bomber' || u.kind === 'heavybomber') && moving && Math.random() < dt * 30) {
        // Contrails from the outer engines.
        for (const side of [-1, 1]) {
          const ox = Math.cos(pose.hull) * -6 - Math.sin(pose.hull) * side * 13;
          const oy = Math.sin(pose.hull) * -6 + Math.cos(pose.hull) * side * 13;
          this.fx.add({ kind: 'smoke', x: x + ox, y: y + oy, z: lift, vx: 0, vy: 0, life: 1.4, size: 1.4, grow: 1.6 });
        }
      }
      if (u.kind === 'interceptor' && moving && Math.random() < dt * 20)
        this.fx.add({ kind: 'smoke', x: x - Math.cos(pose.hull) * 12, y: y - Math.sin(pose.hull) * 12, z: lift, vx: 0, vy: 0, life: 0.8, size: 1.1, grow: 1.4 });
      if ((u.kind === 'gunship' || u.kind === 'carrier') && Math.random() < dt * 4) this.fx.add({ kind: 'dust', x: x + (Math.random() - 0.5) * 18, y: y + (Math.random() - 0.5) * 12, z: 0, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 8, life: 0.7, size: 2.2, grow: 2.4 });
    }
    for (const { u, x, y } of aloft) {
      const frac = u.hp / maxHpOf(u);
      const top = y - lift - 20;
      if (ov.selected.has(u.id) || ov.hover === u.id) hpBar(ctx, x - 14, top, 28, frac);
      else if (frac < 1) hpBar(ctx, x - 14, top + 2, 28, frac, true);
      if (u.owner === 0 && ov.selected.has(u.id) && AIR_AMMO[u.kind]) {
        // Ammunition under the health bar.
        const share = (u.ammo ?? 0) / (AIR_AMMO[u.kind] ?? 1);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - 14, top + 4, 28, 2.5);
        ctx.fillStyle = '#e8d27a';
        ctx.fillRect(x - 14, top + 4, 28 * share, 2.5);
      }
      const vet = u.vet ?? 0;
      if (vet > 0) chevrons(ctx, x + 16, top + 2, Math.min(2, vet));
      const group = u.owner === 0 ? ov.groupOf?.get(u.id) : undefined;
      if (group !== undefined) groupBadge(ctx, x, y + 6, group);
    }
    void cur;
  }

  private burst(x: number, y: number, size: number, weapon?: string) {
    if (weapon === 'missile') {
      // The strike: a blast the size of its radius, and a crater that stays for the battle.
      const r = POWERS.missile.radius * TILE;
      this.fx.explode(x, y, 2, true);
      this.fx.megaBlast(x, y, r);
      this.scars?.crater(x, y, r * 0.55, this.lastNow / 1000);
      return;
    }
    if (weapon === 'flame') {
      // Burning ground where the jet lands: it smoulders for a few seconds and leaves a scorch.
      this.fx.burn(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 6, 7 + Math.random() * 4, 2.5 + Math.random() * 1.5);
      if (Math.random() < 0.5) this.scars?.stampScorch(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 8, 6);
      return;
    }
    this.fx.explode(x, y, size, weapon === 'artillery');
    // A structure's footprint gets rubble and a vehicle a scorch under its wreck, from Scars.
    if (size >= 1) return;
    this.scars?.stampScorch(x, y, weapon === 'artillery' ? 14 : size >= 0.5 ? 9 : 5);
  }

  /** Where a missile leaves from: the owner's Strike Command nearest its launch point, else that point. */
  private launchPoint(s: GameState, p: Projectile): { x: number; y: number } {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of s.buildings) {
      if (b.kind !== 'strikecommand' || b.owner !== p.owner) continue;
      const d = Math.hypot(b.x - p.fromX, b.y - p.fromY);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    // The silo's centre (see art.ts drawStrikeCommand), in pixels.
    return best ? { x: best.x * TILE + 38, y: best.y * TILE + 48 } : { x: p.fromX * TILE, y: p.fromY * TILE };
  }

  /** A Strike Command's silo: charge from the side's missile cooldown, doors, and a launch under way. */
  private silo(s: GameState, b: Building, pose: BuildingPoseX, rt: number, act: Activity) {
    const cd = act.missileCd[b.owner];
    const ready = cd < 0 ? 0 : 1 - Math.min(1, cd / POWERS.missile.cooldown);
    // The doors slide open over the last stretch of the charge, and stand open while it is ready.
    let open = cd < 0 ? 0 : Math.max(0, Math.min(1, (ready - 0.985) / 0.015));
    let launch: number | undefined;
    for (const p of s.projectiles) {
      if (p.weapon !== 'missile' || p.owner !== b.owner) continue;
      const since = (rt - p.firedAt) / TICKS_PER_SECOND;
      if (since >= 0 && (launch === undefined || since < launch)) launch = since;
    }
    if (launch !== undefined) open = Math.max(open, 1 - launch / 3);
    pose.ready = ready;
    pose.open = open;
    pose.launch = launch;
  }

  /** A Medic's work: a green glow on the patient and a beam from the Medic treating them. */
  private healGlow(ctx: CanvasRenderingContext2D, cur: GameState, e: Effect, x: number, y: number, f: number, alpha: number) {
    let medic: Unit | null = null;
    let best = MEDIC_RANGE + 0.6;
    for (const u of cur.units) {
      if (!UNITS[u.kind].medic) continue;
      const d = Math.hypot(u.x - e.x, u.y - e.y);
      if (d < best && d > 0.05) {
        best = d;
        medic = u;
      }
    }
    const k = 1 - f;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (medic) {
      const mx = medic.x * TILE;
      const my = medic.y * TILE;
      const g = ctx.createLinearGradient(mx, my, x, y);
      g.addColorStop(0, `rgba(120,255,160,${0.15 * k})`);
      g.addColorStop(1, `rgba(170,255,190,${0.75 * k})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.quadraticCurveTo((mx + x) / 2 + Math.sin(alpha * 6 + e.id) * 3, (my + y) / 2 - 6, x, y);
      ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = `rgba(235,255,240,${0.8 * k})`;
      ctx.stroke();
    }
    const r = 9 + f * 5;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, `rgba(170,255,190,${0.55 * k})`);
    glow.addColorStop(1, 'rgba(60,200,110,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // A small cross rising off the patient.
    ctx.fillStyle = `rgba(210,255,220,${0.9 * k})`;
    const cy = y - 8 - f * 10;
    ctx.fillRect(x - 0.8, cy - 2.6, 1.6, 5.2);
    ctx.fillRect(x - 2.6, cy - 0.8, 5.2, 1.6);
    ctx.restore();
  }

  /** Structures producing right now: the head of a queue being worked, or a hauler unloading. */
  private workingSet(s: GameState): Set<number> {
    if (this.workingFor === s) return this.working;
    this.workingFor = s;
    const set = new Set<number>();
    for (const owner of [0, 1] as const) {
      const q = s.players[owner].queues;
      for (const cat of ['building', 'infantry', 'vehicle', 'air', 'naval'] as const) {
        const head = q[cat]?.[0];
        if (!head || head.progress >= buildTicksOf(head.kind)) continue;
        const b = producerFor(s, owner, cat);
        if (b) set.add(b.id);
      }
    }
    // A Research Lab at work: every Lab of a side researching.
    for (const b of s.buildings) if (b.kind === 'researchlab' && s.players[b.owner]?.research) set.add(b.id);
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
      if (!inView(x, y, 60) || !vis[Math.floor(e.y) * this.mapW + Math.floor(e.x)]) continue;
      if (!lit) {
        ctx.globalCompositeOperation = 'lighter';
        lit = true;
      }
      if (++lights > MAX_LIGHTS) break;
      const r = e.weapon === 'bullet' ? 14 : e.weapon === 'rocket' ? 24 : e.weapon === 'artillery' ? 40 : e.weapon === 'flame' ? 34 : 28;
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

/**
 * A health bar: a dark case, the fill in good, middling or bad, a pale top edge on the fill so it
 * reads as lit like everything else, and a notch every quarter so a glance tells how much is gone.
 */
function hpBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, thin = false) {
  const h = thin ? 2 : 3.5;
  const f = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = f > 0.6 ? ART.hpGood : f > 0.3 ? ART.hpMid : ART.hpBad;
  ctx.fillRect(x, y, w * f, h);
  if (thin || w < 12) return;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x, y, w * f, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = 1; i < 4; i++) ctx.fillRect(Math.round(x + (w * i) / 4) - 0.5, y, 1, h);
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

/** Whether a Grenadier stands where a shot came from: its throw sounds unlike a howitzer. */
function grenadierAt(s: GameState, x: number, y: number): boolean {
  for (const u of s.units) if (u.kind === 'grenadier' && Math.abs(u.x - x) < 0.7 && Math.abs(u.y - y) < 0.7) return true;
  return false;
}

/** A Repair Bay at work on a vehicle: a blue-white welding flash on the hull. */
function repairFlash(ctx: CanvasRenderingContext2D, x: number, y: number, f: number, t: number) {
  const k = (1 - f) * (0.6 + 0.4 * Math.sin(t * 40));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
  g.addColorStop(0, `rgba(225,240,255,${0.8 * k})`);
  g.addColorStop(0.3, `rgba(120,180,255,${0.35 * k})`);
  g.addColorStop(1, 'rgba(80,140,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 12, y - 12, 24, 24);
  ctx.restore();
}
