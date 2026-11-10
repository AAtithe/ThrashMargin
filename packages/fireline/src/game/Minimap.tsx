import { useEffect, useMemo, useRef } from 'react';
import { BUILDINGS } from '../sim/rules';
import type { GameState } from '../sim/types';
import { TEAM } from '../theme';
import { TILE } from './art';
import type { Camera } from './renderer';
import { paintMiniTerrain } from './terrain';

const SCALE = 3;

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
}: {
  state: GameState;
  vis: Uint8Array;
  online: boolean;
  cam: Camera;
  onJump: (x: number, y: number) => void;
  /** Live list, appended to by the battle screen; read every frame for the pings. */
  alerts?: Alert[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pingRef = useRef<HTMLCanvasElement>(null);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  // Alert pings: a second canvas on top, animated on its own frame loop so the rings expand
  // smoothly while the radar beneath redraws only when the battle ticks. Pings show even while
  // the radar is offline: the alarm has already told you, and this says where.
  useEffect(() => {
    let raf = 0;
    let drawn = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const c = pingRef.current;
      const list = alertsRef.current;
      if (!c || !list) return;
      const live = list.filter(a => now - a.at < ALERT_MS);
      if (!live.length && !drawn) return;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      drawn = live.length > 0;
      for (const a of live) {
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
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  const terrain = useMemo(() => paintMiniTerrain(state.tiles, state.mapW, state.mapH), [state.tiles, state.mapW, state.mapH]);
  const MAP_W = state.mapW;
  const MAP_H = state.mapH;
  const dragging = useRef(false);

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
    ctx.fillStyle = '#d9b23a';
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
    // round5:D end.
    for (const u of state.units) {
      const k = Math.floor(u.y) * MAP_W + Math.floor(u.x);
      if (u.owner !== 0 && !vis[k]) continue;
      ctx.fillStyle = TEAM[u.owner].light;
      ctx.fillRect(Math.floor(u.x * SCALE) - 1, Math.floor(u.y * SCALE) - 1, 2.5, 2.5);
      if (u.ammo !== undefined) ctx.fillRect(Math.floor(u.x * SCALE) - 3, Math.floor(u.y * SCALE), 6.5, 0.9); // An aircraft: a wing bar.
    }
    // Fog.
    for (let k = 0; k < MAP_W * MAP_H; k++) {
      const seen = state.explored.charCodeAt(k) === 49;
      if (seen && vis[k]) continue;
      ctx.fillStyle = seen ? 'rgba(5,7,8,0.45)' : '#050708';
      ctx.fillRect((k % MAP_W) * SCALE, ((k / MAP_W) | 0) * SCALE, SCALE, SCALE);
    }
    // The view.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    const s = SCALE / TILE;
    ctx.strokeRect(cam.x * s + 0.5, cam.y * s + 0.5, (cam.w / cam.zoom) * s, (cam.h / cam.zoom) * s);
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
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#cfd8d4',
            fontSize: '0.72rem',
            textAlign: 'center',
            textShadow: '0 1px 2px #000',
            pointerEvents: 'none',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          <strong>Radar offline</strong>
          <span style={{ textTransform: 'none', letterSpacing: 0, opacity: 0.85 }}>Build a powered Comms Uplink</span>
        </div>
      )}
    </div>
  );
}
