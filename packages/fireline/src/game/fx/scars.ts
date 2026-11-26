import { BUILDINGS, UNITS, type UnitKind } from '../../sim/rules';
import type { GameState, Unit } from '../../sim/types';
import { ART } from '../../theme';
import { drawUnit, TILE } from '../art';
import type { TerrainStore } from '../terrainStore';
import type { Particles } from './particles';
import { sprites } from './sprites';

/**
 * The marks a battle leaves on the ground, drawn under the units.
 *
 * - Tread and tyre marks, small scorches and fallen soldiers are stamped straight into the
 *   ground's chunks (terrainStore.ts), so they arrive with the ground the renderer draws anyway and
 *   cost nothing per frame however many there are. To make them fade, each marked 128-pixel square
 *   is blended back towards the clean ground every FADE_PERIOD seconds, 20% each time, so a mark is
 *   gone in about a minute. A chunk dropped while it held marks comes back clean.
 * - A structure's rubble and scorched footprint, and a missile's crater, are permanent marks
 *   (TerrainStore.permanent): drawn into the clean ground with their own seed, so the fading never
 *   touches them and a chunk painted again draws them again, the same. They stay for the session.
 * - A destroyed vehicle leaves a burnt-out hull for about 25 seconds: a dark copy of the vehicle,
 *   rendered once into a small sprite when it dies, which smoulders while it lasts.
 *
 * Deaths are found by comparing the units and structures of the last state seen with the current
 * one. Nothing is marked where the player cannot see, so the scars never reveal what the fog hides.
 */

const CHUNK = 128;
/** Seconds between two fades of the same chunk, and how much each fade takes away. */
const FADE_PERIOD = 4;
const FADE_ALPHA = 0.2;
/** Fades after the last stamp before a chunk is surely clean (0.8^25 is under 1/255). */
const FADES_TO_CLEAR = 25;

const WRECK_LIFE = 25;
const WRECK_SOLID = 18;
const MAX_WRECKS = 48;

interface Wreck {
  x: number;
  y: number;
  sprite: HTMLCanvasElement;
  born: number;
  big: boolean;
}

interface Smoulder {
  x: number;
  y: number;
  w: number;
  h: number;
  born: number;
  life: number;
}

const TRACKS: Partial<Record<UnitKind, { off: number; w: number; a: number }>> = {
  tank: { off: 7.5, w: 4, a: 0.16 },
  hauler: { off: 8, w: 4.5, a: 0.16 },
  artillery: { off: 7, w: 3.5, a: 0.15 },
  buggy: { off: 5.5, w: 1.6, a: 0.2 },
  flametank: { off: 7.8, w: 4.2, a: 0.16 },
  missilecarrier: { off: 6.2, w: 2, a: 0.2 },
  bastion: { off: 11.6, w: 6.4, a: 0.2 },
};

export class Scars {
  /** The ground, held a chunk at a time: marks go into it, and fade back to its clean copy. */
  private store: TerrainStore;
  /** Told about each region the fading repaints, so animated water there can redraw itself. */
  onRepaint: ((x: number, y: number, w: number, h: number) => void) | null = null;
  /** The marked squares (index into the map's grid of CHUNK squares): fades applied since the last stamp, and when the next is due. */
  private dirty = new Map<number, { fades: number; due: number }>();
  /** Squares across the map. */
  private cols: number;
  private rows: number;
  /** The map's width in tiles. */
  private mapW: number;
  private clock = 0;
  private trackAt = new Map<number, { x: number; y: number }>();
  private wrecks: Wreck[] = [];
  private smoulders: Smoulder[] = [];
  private last: GameState | null = null;
  private tiles: string;

  constructor(store: TerrainStore, tiles: string, mapW: number, mapH: number) {
    this.store = store;
    this.tiles = tiles;
    this.mapW = mapW;
    this.cols = Math.ceil((mapW * TILE) / CHUNK);
    this.rows = Math.ceil((mapH * TILE) / CHUNK);
  }

  /** Finds what died since the last call and marks the ground for it. */
  update(cur: GameState, vis: Uint8Array, now: number): void {
    const last = this.last;
    this.last = cur;
    if (!last || last === cur) return;
    const t = now / 1000;
    if (last.units.length) {
      const alive = new Set<number>();
      for (const u of cur.units) alive.add(u.id);
      for (const u of last.units) {
        if (alive.has(u.id)) continue;
        this.trackAt.delete(u.id);
        if (!vis[Math.floor(u.y) * this.mapW + Math.floor(u.x)]) continue;
        this.unitDied(u, t);
      }
    }
    if (last.buildings.length !== cur.buildings.length || last.buildings.some((b, i) => cur.buildings[i]?.id !== b.id)) {
      const alive = new Set<number>();
      for (const b of cur.buildings) alive.add(b.id);
      for (const b of last.buildings) {
        if (alive.has(b.id)) continue;
        const spec = BUILDINGS[b.kind];
        const cx = b.x + spec.w / 2;
        const cy = b.y + spec.h / 2;
        // Sold, not destroyed: it leaves clean ground.
        if (cur.effects.some(e => e.kind === 'sold' && e.at > last.tick - 1 && Math.abs(e.x - cx) < 0.6 && Math.abs(e.y - cy) < 0.6)) continue;
        let seen = b.owner === 0;
        for (let y = b.y; y < b.y + spec.h && !seen; y++)
          for (let x = b.x; x < b.x + spec.w; x++) if (cur.explored.charCodeAt(y * this.mapW + x) === 49) seen = true;
        if (!seen) continue;
        this.rubble(b.x * TILE, b.y * TILE, spec.w * TILE, spec.h * TILE);
        // A wall is sand and sacking: a scatter of rubble, but nothing left to burn.
        if (spec.wall) continue;
        this.smoulders.push({ x: b.x * TILE, y: b.y * TILE, w: spec.w * TILE, h: spec.h * TILE, born: t, life: 30 });
      }
    }
    if (this.trackAt.size > 600) {
      const alive = new Set(cur.units.map(u => u.id));
      for (const id of this.trackAt.keys()) if (!alive.has(id)) this.trackAt.delete(id);
    }
  }

  private unitDied(u: Unit, t: number) {
    const x = u.x * TILE;
    const y = u.y * TILE;
    if (UNITS[u.kind].category === 'infantry') {
      this.fallen(x, y);
      return;
    }
    const size = u.kind === 'bastion' ? 84 : 60;
    this.stampScorch(x, y, size === 60 ? 22 : 30);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const sc = c.getContext('2d')!;
    drawUnit(sc, u.kind, u.owner, size / 2, size / 2, {
      hull: Math.atan2(u.fy, u.fx),
      turret: Math.atan2(u.ty, u.tx) + (Math.random() - 0.5) * 0.8,
      t: 0,
      moving: false,
      cargo: 0,
      sinceShot: 9,
    });
    // Burn it out: everything drawn becomes charred metal, with a few rust-red scorches.
    sc.globalCompositeOperation = 'source-atop';
    sc.fillStyle = 'rgba(24,20,17,0.84)';
    sc.fillRect(0, 0, size, size);
    for (let i = 0; i < 7; i++) {
      sc.fillStyle = Math.random() < 0.5 ? 'rgba(110,52,26,0.45)' : 'rgba(70,64,58,0.5)';
      sc.beginPath();
      sc.arc(size / 2 + (Math.random() - 0.5) * 22, size / 2 + (Math.random() - 0.5) * 16, 1.5 + Math.random() * 3, 0, Math.PI * 2);
      sc.fill();
    }
    this.wrecks.push({ x, y, sprite: c, born: t, big: u.kind !== 'buggy' });
    if (this.wrecks.length > MAX_WRECKS) this.wrecks.splice(0, this.wrecks.length - MAX_WRECKS);
  }

  /** A soldier's fall: a dark patch and a small prone shape, on the fading layer. */
  private fallen(x: number, y: number) {
    const sp = sprites();
    const a = Math.random() * Math.PI * 2;
    this.store.paintLive(x - 8, y - 8, 16, 16, d => this.drawFallen(d, sp.scorch, x, y, a), true);
    this.touch(x - 8, y - 8, 16, 16);
  }

  private drawFallen(d: CanvasRenderingContext2D, scorch: HTMLCanvasElement, x: number, y: number, a: number) {
    d.globalAlpha = 0.55;
    d.drawImage(scorch, x - 7, y - 5, 14, 10);
    d.globalAlpha = 1;
    d.save();
    d.translate(x, y);
    d.rotate(a);
    d.fillStyle = 'rgba(38,42,32,0.85)';
    d.beginPath();
    d.ellipse(0, 0, 4.2, 1.8, 0, 0, Math.PI * 2);
    d.fill();
    d.fillStyle = 'rgba(52,58,44,0.9)';
    d.beginPath();
    d.arc(4.6, 0, 1.6, 0, Math.PI * 2);
    d.fill();
    d.strokeStyle = 'rgba(28,30,26,0.8)';
    d.lineWidth = 0.9;
    d.beginPath();
    d.moveTo(-1, 1.5);
    d.lineTo(3, 4);
    d.stroke();
    d.restore();
  }

  stampScorch(x: number, y: number, r: number) {
    const sp = sprites();
    this.store.paintLive(
      x - r,
      y - r,
      r * 2,
      r * 2,
      d => {
        d.globalAlpha = 0.8;
        d.drawImage(sp.scorch, x - r, y - r * 0.8, r * 2, r * 1.6);
        d.globalAlpha = 1;
      },
      true,
    );
    this.touch(x - r, y - r, r * 2, r * 2);
  }

  /**
   * Called for every vehicle drawn while it moves. Lays tread (or tyre) marks from where it was
   * last stamped to where it is now; a dust puff on dirt.
   */
  track(u: Unit, x: number, y: number, fx: Particles, dt: number) {
    const spec = TRACKS[u.kind];
    if (!spec) return;
    const at = this.trackAt.get(u.id);
    if (!at) {
      this.trackAt.set(u.id, { x, y });
      return;
    }
    const dx = x - at.x;
    const dy = y - at.y;
    const d2 = dx * dx + dy * dy;
    const k = Math.floor(y / TILE) * this.mapW + Math.floor(x / TILE);
    const ground = this.tiles[k];
    if (ground === 'd' && Math.random() < dt * (u.kind === 'buggy' ? 5 : 2.5)) fx.dust(x - (dx / (Math.sqrt(d2) || 1)) * 10, y - (dy / (Math.sqrt(d2) || 1)) * 8, u.kind === 'buggy' ? 0.9 : 1.2);
    if (d2 < 9) return;
    if (d2 > 1600) {
      at.x = x;
      at.y = y;
      return;
    }
    if (ground !== 'w') {
      const d = Math.sqrt(d2);
      const nx = -dy / d;
      const ny = dx / d;
      const ax = at.x;
      const ay = at.y;
      const bx0 = Math.min(x, ax) - 10;
      const by0 = Math.min(y, ay) - 10;
      this.store.paintLive(
        bx0,
        by0,
        Math.abs(dx) + 20,
        Math.abs(dy) + 20,
        c => {
          c.strokeStyle = ground === 'd' ? `rgba(52,38,22,${spec.a + 0.06})` : `rgba(30,26,16,${spec.a})`;
          c.lineWidth = spec.w;
          c.lineCap = 'butt';
          c.beginPath();
          for (const side of [-1, 1]) {
            c.moveTo(ax + nx * spec.off * side, ay + ny * spec.off * side);
            c.lineTo(x + nx * spec.off * side, y + ny * spec.off * side);
          }
          c.stroke();
        },
        true,
      );
      this.touch(bx0, by0, Math.abs(dx) + 20, Math.abs(dy) + 20);
    }
    at.x = x;
    at.y = y;
  }

  /** Rubble and a scorched footprint, a permanent mark: it never goes away. */
  private rubble(px: number, py: number, w: number, h: number) {
    // The footprint and its margin: everything the rubble draws, and what it replaces on the live
    // ground (any marks there).
    const m = Math.ceil(w * 0.12) + 2;
    const rx = Math.max(0, px - m);
    const ry = Math.max(0, py - m);
    const rw = w + m * 2 - (rx - (px - m));
    const rh = h + m * 2 - (ry - (py - m));
    this.store.permanent({ x: rx, y: ry, w: rw, h: rh, seed: (Math.random() * 4294967296) >>> 0, draw: (c, rand) => drawRubble(c, rand, px, py, w, h) });
    this.onRepaint?.(rx, ry, rw, rh);
  }

  /**
   * A missile's crater, a permanent mark so it lasts the battle: a wide scorch, a dark bowl with a
   * lit far rim, a raised lip of thrown earth, and rays of ejecta.
   */
  crater(x: number, y: number, r: number, t: number) {
    const m = r * 2.4;
    const rx = Math.max(0, Math.floor(x - m));
    const ry = Math.max(0, Math.floor(y - m));
    const rw = Math.ceil(x + m) - rx;
    const rh = Math.ceil(y + m) - ry;
    if (rw <= 0 || rh <= 0) return;
    this.store.permanent({ x: rx, y: ry, w: rw, h: rh, seed: (Math.random() * 4294967296) >>> 0, draw: (c, rand) => drawCrater(c, rand, x, y, r) });
    this.onRepaint?.(rx, ry, rw, rh);
    this.smoulders.push({ x: x - r, y: y - r * 0.8, w: r * 2, h: r * 1.6, born: t, life: 40 });
  }

  private touch(x: number, y: number, w: number, h: number) {
    const c0 = Math.max(0, Math.floor(x / CHUNK));
    const r0 = Math.max(0, Math.floor(y / CHUNK));
    const c1 = Math.min(this.cols - 1, Math.floor((x + w) / CHUNK));
    const r1 = Math.min(this.rows - 1, Math.floor((y + h) / CHUNK));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const k = r * this.cols + c;
        const d = this.dirty.get(k);
        if (d) d.fades = 0;
        else this.dirty.set(k, { fades: 0, due: this.clock + FADE_PERIOD * (0.5 + Math.random() * 0.5) });
      }
  }

  /** Fades the marks a little, a few due squares a frame, and keeps wrecks smoking. */
  step(dt: number, now: number, fx: Particles) {
    this.clock += dt;
    let budget = 6;
    for (const [k, d] of this.dirty) {
      if (budget <= 0) break;
      if (d.due > this.clock) continue;
      budget--;
      const x = (k % this.cols) * CHUNK;
      const y = Math.floor(k / this.cols) * CHUNK;
      const done = ++d.fades > FADES_TO_CLEAR;
      // Blend towards the clean ground; the last pass copies it outright.
      this.store.restore(x, y, CHUNK, CHUNK, done ? 1 : FADE_ALPHA);
      if (done) this.dirty.delete(k);
      else d.due = this.clock + FADE_PERIOD;
      this.onRepaint?.(x, y, CHUNK, CHUNK);
    }

    const t = now / 1000;
    this.wrecks = this.wrecks.filter(w => t - w.born < WRECK_LIFE);
    for (const w of this.wrecks) {
      const age = t - w.born;
      const rate = Math.max(0, 1 - age / 22) * (w.big ? 2.6 : 1.6);
      if (Math.random() < dt * rate) fx.smoke(w.x + (Math.random() - 0.5) * 10, w.y + (Math.random() - 0.5) * 8, 1.1 + Math.random() * 0.6, 4);
      if (age < 7 && Math.random() < dt * 5) fx.fire(w.x + (Math.random() - 0.5) * 12, w.y + (Math.random() - 0.5) * 8);
    }
    this.smoulders = this.smoulders.filter(s => t - s.born < s.life);
    for (const s of this.smoulders) {
      const k = 1 - (t - s.born) / s.life;
      const rate = k * (2 + (s.w * s.h) / 2048);
      if (Math.random() < dt * rate) fx.smoke(s.x + Math.random() * s.w, s.y + Math.random() * s.h * 0.8, 1.4 + Math.random(), 2);
      if (k > 0.6 && Math.random() < dt * rate * 0.6) fx.fire(s.x + 6 + Math.random() * (s.w - 12), s.y + 6 + Math.random() * (s.h - 12));
    }
  }

  /** The wrecks in view. (The marks are already in the terrain.) */
  draw(ctx: CanvasRenderingContext2D, now: number, inView: (x: number, y: number, m?: number) => boolean) {
    const t = now / 1000;
    for (const w of this.wrecks) {
      if (!inView(w.x, w.y)) continue;
      const age = t - w.born;
      ctx.globalAlpha = age < WRECK_SOLID ? 1 : Math.max(0, 1 - (age - WRECK_SOLID) / (WRECK_LIFE - WRECK_SOLID));
      const s = w.sprite.width;
      ctx.drawImage(w.sprite, w.x - s / 2, w.y - s / 2);
      if (age < 9) {
        // Embers glowing in the hull, dying down.
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - age / 9) * (0.35 + 0.25 * Math.sin(t * 9 + w.x));
        ctx.drawImage(sprites().fire, w.x - 8, w.y - 7, 16, 14);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** A structure's rubble and scorched footprint over (px, py, w, h), drawn with `rand` (a permanent mark). */
function drawRubble(c: CanvasRenderingContext2D, rand: () => number, px: number, py: number, w: number, h: number) {
  const sp = sprites();
  const cx = px + w / 2;
  const cy = py + h / 2;
  c.save();
  c.globalAlpha = 0.95;
  c.drawImage(sp.scorch, cx - w * 0.62, cy - h * 0.62, w * 1.24, h * 1.24);
  c.globalAlpha = 1;
  // The foundation's outline, cracked.
  c.strokeStyle = 'rgba(20,18,15,0.45)';
  c.lineWidth = 2;
  c.setLineDash([7, 3, 2, 4]);
  c.strokeRect(px + 3, py + 3, w - 6, h - 6);
  c.setLineDash([]);
  const n = Math.round((w * h) / 70);
  const cols = [ART.concrete, ART.concreteDark, ART.metalDark, '#4a443c', '#2a2622'];
  for (let i = 0; i < n; i++) {
    // Heaped towards the middle.
    const rx = cx + (rand() + rand() - 1) * w * 0.55;
    const ry = cy + (rand() + rand() - 1) * h * 0.55;
    const r = 1.5 + rand() * (rand() < 0.15 ? 6 : 3.5);
    const sides = 3 + Math.floor(rand() * 3);
    const pts: [number, number][] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + rand() * 0.8;
      const d = r * (0.6 + rand() * 0.5);
      pts.push([rx + Math.cos(a) * d, ry + Math.sin(a) * d]);
    }
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    pts.forEach(([x, y], k) => (k ? c.lineTo(x + 1.5, y + 2) : c.moveTo(x + 1.5, y + 2)));
    c.fill();
    c.fillStyle = cols[Math.floor(rand() * cols.length)];
    c.globalAlpha = 0.75 + rand() * 0.25;
    c.beginPath();
    pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
  }
  // Charred beams.
  c.strokeStyle = 'rgba(22,18,14,0.85)';
  c.lineCap = 'round';
  for (let i = 0; i < Math.max(2, Math.round(w / 24)); i++) {
    const bx = px + 6 + rand() * (w - 12);
    const by = py + 6 + rand() * (h - 12);
    const a = rand() * Math.PI;
    const l = 8 + rand() * 14;
    c.lineWidth = 2 + rand() * 1.5;
    c.beginPath();
    c.moveTo(bx - Math.cos(a) * l / 2, by - Math.sin(a) * l / 2);
    c.lineTo(bx + Math.cos(a) * l / 2, by + Math.sin(a) * l / 2);
    c.stroke();
  }
  c.restore();
}

/** A missile's crater round (x, y), radius r, drawn with `rand` (a permanent mark). */
function drawCrater(c: CanvasRenderingContext2D, rand: () => number, x: number, y: number, r: number) {
  const sp = sprites();
  c.save();
  c.globalAlpha = 1;
  c.drawImage(sp.scorch, x - r * 2.2, y - r * 1.8, r * 4.4, r * 3.6);
  c.drawImage(sp.scorch, x - r * 1.5, y - r * 1.2, r * 3, r * 2.4);
  // Ejecta rays.
  c.strokeStyle = 'rgba(40,30,20,0.35)';
  c.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const l = r * (1.2 + rand() * 1.1);
    c.lineWidth = 2 + rand() * 4;
    c.beginPath();
    c.moveTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.75);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.8);
    c.stroke();
  }
  // The lip: a ring of churned earth, lit on the far (top-left) side.
  const lip = c.createRadialGradient(x, y, r * 0.75, x, y, r * 1.25);
  lip.addColorStop(0, 'rgba(120,96,66,0.95)');
  lip.addColorStop(0.5, 'rgba(96,76,52,0.85)');
  lip.addColorStop(1, 'rgba(70,56,40,0)');
  c.fillStyle = lip;
  c.beginPath();
  c.ellipse(x, y, r * 1.25, r * 1.05, 0, 0, Math.PI * 2);
  c.fill();
  // The bowl: dark, deepest just past the middle, with the lit inner wall on the far side.
  const bowl = c.createRadialGradient(x + r * 0.18, y + r * 0.15, 0, x, y, r);
  bowl.addColorStop(0, 'rgba(22,17,12,0.95)');
  bowl.addColorStop(0.6, 'rgba(48,37,26,0.95)');
  bowl.addColorStop(0.85, 'rgba(82,64,44,0.95)');
  bowl.addColorStop(1, 'rgba(110,88,60,0.9)');
  c.fillStyle = bowl;
  c.beginPath();
  c.ellipse(x, y, r, r * 0.82, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(180,150,110,0.45)';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(x, y, r * 0.96, r * 0.78, 0, Math.PI * 0.95, Math.PI * 1.75);
  c.stroke();
  // Clods and stones on the lip.
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const d = r * (0.95 + rand() * 0.6);
    const s = 1.2 + rand() * 2.6;
    c.fillStyle = rand() < 0.5 ? 'rgba(70,58,44,0.9)' : 'rgba(130,112,86,0.9)';
    c.beginPath();
    c.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.82, s, s * 0.75, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}
