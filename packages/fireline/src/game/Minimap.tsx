import { useEffect, useMemo, useRef } from 'react';
import { usePace } from '../lib/motion';
import { BUILDINGS } from '../sim/rules';
import type { GameState } from '../sim/types';
import { TEAM } from '../theme';
import { TILE } from './art';
import type { Camera } from './renderer';
import { paintMiniTerrain } from './terrain';
// round5:D. Neutral sites (fireline-round5-design.md, workstream D).
import { SITES } from '../sim/rules';
import { SITE_ART } from './art';
import { stealthSeen } from '../sim/sites';
import { drawEventMarks } from './fx/events';
import { isDetected } from '../sim/mission';

const SCALE = 3;

// The radar's own art. It draws over the map's terrain, which is the same in both colour modes,
// so like the battlefield it keeps one palette rather than reading the page's theme tokens.
const ORE = '#d9b23a';
/** The view's corner brackets, and its faint wash at VIEW_WASH. */
const VIEW = '#ffffff';
const VIEW_WASH = 'rgba(255, 255, 255, 0.08)';
/** The ring round a selected unit of yours. */
const PICKED = '#f4f8f6';
/** The radar sweep: its leading edge, and how long one turn takes at full pace. */
const SWEEP_RGB = '150, 236, 170';
const SWEEP_MS = 4200;
/** How far round the sweep's trailing glow reaches, in radians. */
const SWEEP_TAIL = 1.1;

/** A combat alert: somewhere side 0 is being hit. `at` is performance.now() when it was raised. */
export interface Alert {
  x: number;
  y: number;
  at: number;
  kind: 'base' | 'hauler';
}

/** How long a ping keeps expanding on the radar, in milliseconds. */
export const ALERT_MS = 3200;

/**
 * The radar. Online only while you own a powered Comms Uplink: until then it shows static, which
 * is the genre's oldest reason to build one. Click or drag on it to move the view.
 */
export default function Minimap({
  state,
  vis,
  online,
  cam,
  onJump,
  alerts,
  selected,
}: {
  state: GameState;
  vis: Uint8Array;
  online: boolean;
  cam: Camera;
  onJump: (x: number, y: number) => void;
  /** Live list, appended to by the battle screen; read every frame for the pings. */
  alerts?: Alert[];
  /** The player's selection, marked on the radar so the army is easy to find. */
  selected?: Set<number>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pingRef = useRef<HTMLCanvasElement>(null);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const pace = usePace();
  // The sweep turns only while the radar is on and motion is allowed (motion.ts: "off" follows
  // the system's reduced-motion setting unless the player chose otherwise).
  const sweepRef = useRef(false);
  sweepRef.current = online && pace !== 'off';
  const kickRef = useRef<() => void>(() => {});

  // The overlay canvas: alert pings and the radar sweep, animated on their own frame loop so they
  // move smoothly while the radar beneath redraws only when the battle ticks. Pings show even while
  // the radar is offline: the alarm has already told you, and this says where. The loop stops when
  // there is nothing to animate (no live ping, no sweep) and is started again from the render below,
  // which runs on every battle tick; nothing in it allocates per frame.
  useEffect(() => {
    let raf = 0;
    let running = false;
    let drawn = false;
    let wedge: HTMLCanvasElement | null = null;
    const sweepArt = (size: number): HTMLCanvasElement => {
      if (wedge && wedge.width === size) return wedge;
      // One pre-drawn wedge, centred, pointing along +x with its glow trailing behind; each frame
      // only rotates it into place.
      const w = document.createElement('canvas');
      w.width = w.height = size;
      const g = w.getContext('2d')!;
      const r = size / 2;
      if (typeof g.createConicGradient === 'function') {
        // A smooth trail: transparent at the tail, brightest at the leading edge, nothing ahead of it.
        const cg = g.createConicGradient(-SWEEP_TAIL, r, r);
        const lead = SWEEP_TAIL / (Math.PI * 2);
        cg.addColorStop(0, `rgba(${SWEEP_RGB}, 0)`);
        cg.addColorStop(lead * 0.6, `rgba(${SWEEP_RGB}, 0.05)`);
        cg.addColorStop(lead, `rgba(${SWEEP_RGB}, 0.18)`);
        cg.addColorStop(Math.min(1, lead + 0.001), `rgba(${SWEEP_RGB}, 0)`);
        cg.addColorStop(1, `rgba(${SWEEP_RGB}, 0)`);
        g.fillStyle = cg;
        g.beginPath();
        g.arc(r, r, r, 0, Math.PI * 2);
        g.fill();
      }
      const steps = typeof g.createConicGradient === 'function' ? 0 : 48;
      for (let k = 0; k < steps; k++) {
        const a0 = -SWEEP_TAIL * (1 - k / steps);
        const a1 = -SWEEP_TAIL * (1 - (k + 1) / steps);
        g.fillStyle = `rgba(${SWEEP_RGB}, ${0.16 * ((k + 1) / steps) ** 2})`;
        g.beginPath();
        g.moveTo(r, r);
        g.arc(r, r, r, a0, a1 + 0.01);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = `rgba(${SWEEP_RGB}, 0.5)`;
      g.lineWidth = Math.max(1, size / 240);
      g.beginPath();
      g.moveTo(r, r);
      g.lineTo(size, r);
      g.stroke();
      wedge = w;
      return w;
    };
    const frame = (now: number) => {
      const c = pingRef.current;
      const list = alertsRef.current;
      const sweep = sweepRef.current;
      let live = 0;
      if (list) for (let i = 0; i < list.length; i++) if (now - list[i].at < ALERT_MS) live++;
      if (!c || (!live && !sweep)) {
        if (c && drawn) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
        drawn = false;
        running = false;
        return;
      }
      raf = requestAnimationFrame(frame);
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      drawn = true;
      if (sweep) {
        const size = Math.max(c.width, c.height) * 1.5;
        const art = sweepArt(Math.ceil(size));
        ctx.save();
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(((now % SWEEP_MS) / SWEEP_MS) * Math.PI * 2);
        ctx.drawImage(art, -art.width / 2, -art.height / 2);
        ctx.restore();
      }
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (now - a.at >= ALERT_MS) continue;
        const t = (now - a.at) / ALERT_MS;
        const x = a.x * SCALE;
        const y = a.y * SCALE;
        const colour = a.kind === 'base' ? '255, 92, 72' : '255, 196, 64';
        for (let ring = 0; ring < 2; ring++) {
          const k = (t * 2.5 + ring * 0.5) % 1;
          ctx.strokeStyle = `rgba(${colour}, ${(1 - k) * (1 - t * 0.6)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 3 + k * 26, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${colour}, ${1 - t * 0.7})`;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    kickRef.current = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    kickRef.current();
    return () => {
      cancelAnimationFrame(raf);
      running = false;
      kickRef.current = () => {};
    };
  }, []);
  // Every render (each battle tick, a pace change, the uplink going on or off): restart the overlay
  // loop if it had stopped. A no-op while it runs.
  useEffect(() => {
    kickRef.current();
  });
  const terrain = useMemo(() => paintMiniTerrain(state.tiles, state.mapW, state.mapH), [state.tiles, state.mapW, state.mapH]);
  const MAP_W = state.mapW;
  const MAP_H = state.mapH;
  const dragging = useRef(false);
  const fogRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    if (!online) {
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 30 + Math.random() * 60;
        img.data[i] = v;
        img.data[i + 1] = v + 6;
        img.data[i + 2] = v + 4;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return;
    }
    ctx.drawImage(terrain, 0, 0, MAP_W * SCALE, MAP_H * SCALE);
    ctx.fillStyle = ORE;
    for (let k = 0; k < state.ore.length; k++) {
      if (state.ore[k] <= 0 || state.explored.charCodeAt(k) !== 49) continue;
      ctx.fillRect((k % MAP_W) * SCALE, ((k / MAP_W) | 0) * SCALE, SCALE, SCALE);
    }
    for (const b of state.buildings) {
      const spec = BUILDINGS[b.kind];
      if (b.owner !== 0 && state.explored.charCodeAt(b.y * MAP_W + b.x) !== 49) continue;
      ctx.fillStyle = TEAM[b.owner].main;
      ctx.fillRect(b.x * SCALE, b.y * SCALE, spec.w * SCALE, spec.h * SCALE);
      ctx.strokeStyle = TEAM[b.owner].light;
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x * SCALE + 0.5, b.y * SCALE + 0.5, spec.w * SCALE - 1, spec.h * SCALE - 1);
    }
    // round5:D begin. Neutral sites: a square per seen site, its holder's colour or neutral grey.
    for (const st of state.sites ?? []) {
      if (state.explored.charCodeAt(st.y * MAP_W + st.x) !== 49 && state.explored.charCodeAt((st.y + 1) * MAP_W + st.x + 1) !== 49) continue;
      const spec = SITES[st.kind];
      ctx.fillStyle = st.owner === null ? SITE_ART.neutral : TEAM[st.owner].main;
      ctx.beginPath();
      ctx.arc((st.x + spec.w / 2) * SCALE, (st.y + spec.h / 2) * SCALE, Math.max(2.5, spec.w * SCALE * 0.75), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = SITE_ART.neutralLight;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // round5:D end.
    // Battlefield events (src/sim/events.ts): every live crate, beacon and ore strike, announced so always shown.
    drawEventMarks(ctx, state, SCALE);
    for (const u of state.units) {
      const k = Math.floor(u.y) * MAP_W + Math.floor(u.x);
      if (u.owner !== 0 && !vis[k]) continue;
      // A hidden enemy Spy or Stealth Tank stays off the radar too, as it does off the battlefield.
      if (u.owner !== 0 && (!stealthSeen(state, u, 0) || (u.kind === 'spy' && !isDetected(state, u, 0)))) continue;
      const ux = Math.floor(u.x * SCALE);
      const uy = Math.floor(u.y * SCALE);
      ctx.fillStyle = TEAM[u.owner].light;
      if (u.owner !== 0) {
        // Other sides are diamonds, so the sides differ by shape as well as by colour.
        ctx.beginPath();
        ctx.moveTo(ux, uy - 2);
        ctx.lineTo(ux + 2, uy);
        ctx.lineTo(ux, uy + 2);
        ctx.lineTo(ux - 2, uy);
        ctx.closePath();
        ctx.fill();
      } else if (selected?.has(u.id)) {
        ctx.fillRect(ux - 2, uy - 2, 3.5, 3.5);
        ctx.strokeStyle = PICKED;
        ctx.lineWidth = 1;
        ctx.strokeRect(ux - 2.5, uy - 2.5, 4.5, 4.5);
      } else {
        ctx.fillRect(ux - 1, uy - 1, 2.5, 2.5);
      }
      if (u.ammo !== undefined) ctx.fillRect(ux - 3, uy, 6.5, 0.9); // An aircraft: a wing bar.
    }
    // Fog: one pixel per tile in a small canvas, drawn over the radar at its scale in one call
    // (round 5: a 160-tile map has 25,600 tiles, too many to fill one at a time on every tick).
    let fog = fogRef.current;
    if (!fog || fog.width !== MAP_W || fog.height !== MAP_H) {
      fog = fogRef.current = document.createElement('canvas');
      fog.width = MAP_W;
      fog.height = MAP_H;
    }
    const fctx = fog.getContext('2d')!;
    const img = fctx.createImageData(MAP_W, MAP_H);
    const px = img.data;
    for (let k = 0; k < MAP_W * MAP_H; k++) {
      const seen = state.explored.charCodeAt(k) === 49;
      if (seen && vis[k]) continue;
      const i = k * 4;
      px[i] = 5;
      px[i + 1] = 7;
      px[i + 2] = 8;
      px[i + 3] = seen ? 115 : 255;
    }
    fctx.putImageData(img, 0, 0);
    ctx.drawImage(fog, 0, 0, MAP_W * SCALE, MAP_H * SCALE);
    // The view: a faint wash with corner brackets, like a camera's frame.
    const s = SCALE / TILE;
    const vx = Math.round(cam.x * s) + 0.5;
    const vy = Math.round(cam.y * s) + 0.5;
    const vw = Math.round((cam.w / cam.zoom) * s);
    const vh = Math.round((cam.h / cam.zoom) * s);
    ctx.fillStyle = VIEW_WASH;
    ctx.fillRect(vx, vy, vw, vh);
    const arm = Math.max(3, Math.min(10, vw / 4, vh / 4));
    ctx.strokeStyle = VIEW;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(vx, vy + arm);
    ctx.lineTo(vx, vy);
    ctx.lineTo(vx + arm, vy);
    ctx.moveTo(vx + vw - arm, vy);
    ctx.lineTo(vx + vw, vy);
    ctx.lineTo(vx + vw, vy + arm);
    ctx.moveTo(vx + vw, vy + vh - arm);
    ctx.lineTo(vx + vw, vy + vh);
    ctx.lineTo(vx + vw - arm, vy + vh);
    ctx.moveTo(vx + arm, vy + vh);
    ctx.lineTo(vx, vy + vh);
    ctx.lineTo(vx, vy + vh - arm);
    ctx.stroke();
  });

  const jump = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!online) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * MAP_W;
    const y = ((e.clientY - r.top) / r.height) * MAP_H;
    onJump(x, y);
  };

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={ref}
        width={MAP_W * SCALE}
        height={MAP_H * SCALE}
        aria-label="Minimap"
        data-testid="minimap"
        style={{ width: '100%', aspectRatio: '1', display: 'block', imageRendering: 'pixelated', borderRadius: 3, cursor: online ? 'crosshair' : 'default', touchAction: 'none' }}
        onPointerDown={e => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          jump(e);
        }}
        onPointerMove={e => dragging.current && jump(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      />
      <canvas
        ref={pingRef}
        width={MAP_W * SCALE}
        height={MAP_H * SCALE}
        aria-hidden="true"
        data-testid="minimap-pings"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}
      />
      {!online && (
        <div className="fl-radar-offline">
          <strong>Radar offline</strong>
          <span>Build a powered Comms Uplink</span>
        </div>
      )}
    </div>
  );
}
