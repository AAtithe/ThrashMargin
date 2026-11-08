import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import GuidedTour, { hasSeenGuidedTour } from '../components/GuidedTour';
import ThemeToggle from '../components/ThemeToggle';
import { TILE } from '../game/art';
import Minimap from '../game/Minimap';
import { Renderer, type Camera, type Overlay } from '../game/renderer';
import { BuildPanel, SelectionPanel, type Tab } from '../game/Sidebar';
import { sound } from '../game/sound';
import { statusOf, useSaves } from '../hooks/useSaves';
import { LoadingScreen, SIGN_IN_AGAIN } from '../lib/Loading';
import { clearToken, getStoredUser } from '../lib/portalAuth';
import { processAction } from '../sim/actions';
import { placementProblem } from '../sim/commands';
import { occupancy } from '../sim/grid';
import { BUILDINGS, DIFFICULTIES, MAP_H, MAP_W, TICKS_PER_SECOND, UNITS, type BuildingKind } from '../sim/rules';
import { powerOf, readyStructure } from '../sim/state';
import type { GameAction, GameState } from '../sim/types';
import { FONT, UI } from '../theme';

const TICK_MS = 1000 / TICKS_PER_SECOND;
const SAVE_EVERY_MS = 15000;
const SPEEDS = [
  { label: 'Slow', value: 0.6 },
  { label: 'Normal', value: 1 },
  { label: 'Fast', value: 1.6 },
];

/**
 * Loads the battle, then hands it to <Battle>. Split so that every hook in Battle runs on every
 * render: the loading and error branches return before Battle mounts, never in the middle of it.
 */
export default function GameScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = getStoredUser();
  const saves = useSaves();
  const [state, setState] = useState<GameState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const { load } = saves;

  useEffect(() => {
    if (!user) {
      navigate('/', { replace: true });
      return;
    }
    if (!id) return;
    let live = true;
    setFailed(false);
    load(id).then(s => {
      if (!live) return;
      if (s) setState(s);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
    // `user` is read once; the lobby is where sign-in changes are handled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt, load]);

  if (!state) {
    return (
      <LoadingScreen
        motif="territories"
        caption="Deploying to the battlefield…"
        error={failed ? (saves.expired ? SIGN_IN_AGAIN : saves.error ?? 'The battle could not be loaded.') : null}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {saves.expired ? (
              <button
                style={chromeBtn}
                onClick={() => {
                  clearToken();
                  navigate('/');
                }}
              >
                Sign in again
              </button>
            ) : (
              <button style={chromeBtn} onClick={() => setAttempt(a => a + 1)}>
                Try again
              </button>
            )}
            <Link to="/" style={{ ...chromeBtn, textDecoration: 'none' }}>
              Back to the lobby
            </Link>
          </div>
        }
      />
    );
  }
  return <Battle initial={state} save={saves.save} saveError={saves.error} lastSaved={saves.lastSaved} cloud={saves.cloud} />;
}

function Battle({
  initial,
  save,
  saveError,
  lastSaved,
  cloud,
}: {
  initial: GameState;
  save: (s: GameState) => void;
  saveError: string | null;
  lastSaved: number | null;
  cloud: boolean;
}) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cur = useRef(initial);
  const prev = useRef(initial);
  const savedState = useRef<GameState>(initial);
  const acc = useRef(0);
  const renderer = useRef<Renderer | null>(null);
  if (!renderer.current) renderer.current = new Renderer(initial.tiles);
  const hq = initial.buildings.find(b => b.owner === 0 && b.kind === 'hq');
  const cam = useRef<Camera>({ x: hq ? hq.x * TILE - 300 : 0, y: hq ? hq.y * TILE - 260 : 0, zoom: 1, w: 800, h: 600 });
  const overlay = useRef<Overlay>({ selected: new Set(), hover: 0, placement: null, drag: null, pings: [] });
  const keys = useRef(new Set<string>());
  const mouse = useRef({ x: -1, y: -1, inside: false, downX: 0, downY: 0, down: false, pan: false, panX: 0, panY: 0, camX: 0, camY: 0, lastClick: 0 });
  const groups = useRef(new Map<string, number[]>());

  const [, setHud] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [placing, setPlacingState] = useState<BuildingKind | null>(null);
  const [attackMode, setAttackMode] = useState(false);
  const [tab, setTab] = useState<Tab>('building');
  const [help, setHelp] = useState(false);
  // The guided run opens by itself on a fresh battle for anyone who has not finished or skipped it
  // in this browser; the Tour button reopens it at any time. Bumping `tourRun` remounts it, so a
  // reopened run always starts on the welcome card.
  const [tourOpen, setTourOpen] = useState(() => !hasSeenGuidedTour() && initial.tick < 600 && initial.winner === null);
  const [tourRun, setTourRun] = useState(0);
  const [soundPrefs, setSoundPrefs] = useState(sound.prefs);
  const changeSound = useCallback((p: Partial<typeof soundPrefs>) => {
    sound.unlock();
    sound.setPrefs(p);
    setSoundPrefs(sound.prefs);
  }, []);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  const placingRef = useRef(placing);
  const attackRef = useRef(attackMode);
  pausedRef.current = paused || help;
  speedRef.current = speed;
  placingRef.current = placing;
  attackRef.current = attackMode;

  const refresh = useCallback(() => setHud(n => (n + 1) % 1000000), []);

  const setPlacing = useCallback((k: BuildingKind | null) => {
    setPlacingState(k);
    placingRef.current = k;
    if (!k) overlay.current.placement = null;
  }, []);

  const dispatch = useCallback(
    (a: GameAction): boolean => {
      const next = processAction(cur.current, a);
      if (next === cur.current) {
        if (a.type === 'queue' || a.type === 'place') sound.play('denied');
        return false;
      }
      cur.current = next;
      if (a.type === 'queue' || a.type === 'cancel') sound.play('queue');
      else if (a.type === 'place') sound.play('place');
      else if (a.type === 'move' || a.type === 'attack' || a.type === 'harvest' || a.type === 'rally' || a.type === 'stop') sound.play('order');
      refresh();
      return true;
    },
    [refresh],
  );

  const doSave = useCallback(() => {
    if (savedState.current === cur.current) return;
    savedState.current = cur.current;
    save(cur.current);
  }, [save]);

  // ---- Coordinates and picking -------------------------------------------------------------
  const toWorld = (sx: number, sy: number) => ({ x: (cam.current.x + sx / cam.current.zoom) / TILE, y: (cam.current.y + sy / cam.current.zoom) / TILE });

  const pick = useCallback((wx: number, wy: number): number => {
    const s = cur.current;
    const vis = renderer.current!.visible(s);
    let best = 0;
    let bestD = Infinity;
    for (const u of s.units) {
      if (u.owner !== 0 && !vis[Math.floor(u.y) * MAP_W + Math.floor(u.x)]) continue;
      const r = UNITS[u.kind].category === 'infantry' ? 0.35 : 0.55;
      const d = Math.hypot(u.x - wx, u.y - wy);
      if (d < r && d < bestD) {
        bestD = d;
        best = u.id;
      }
    }
    if (best) return best;
    for (const b of s.buildings) {
      const spec = BUILDINGS[b.kind];
      if (wx >= b.x && wx < b.x + spec.w && wy >= b.y && wy < b.y + spec.h) {
        if (b.owner !== 0 && s.explored.charCodeAt(b.y * MAP_W + b.x) !== 49) continue;
        return b.id;
      }
    }
    return 0;
  }, []);

  const ownSelectedUnits = () => cur.current.units.filter(u => u.owner === 0 && overlay.current.selected.has(u.id));

  const centreOn = useCallback((tx: number, ty: number) => {
    const c = cam.current;
    c.x = tx * TILE - c.w / c.zoom / 2;
    c.y = ty * TILE - c.h / c.zoom / 2;
    clampCam(c);
  }, []);

  // ---- Orders -------------------------------------------------------------------------------
  const command = useCallback(
    (wx: number, wy: number, forceAttackMove: boolean) => {
      const s = cur.current;
      const ov = overlay.current;
      const target = pick(wx, wy);
      const mine = ownSelectedUnits();
      const now = performance.now();
      // A single producer selected: set its rally point.
      const building = s.buildings.find(b => ov.selected.has(b.id) && b.owner === 0);
      if (!mine.length && building) {
        if (dispatch({ type: 'rally', id: building.id, x: wx, y: wy })) ov.pings.push({ x: wx, y: wy, at: now, kind: 'rally' });
        return;
      }
      if (!mine.length) return;
      const ids = mine.map(u => u.id);
      const targetUnit = s.units.find(u => u.id === target);
      const targetBuilding = s.buildings.find(b => b.id === target);
      const enemy = (targetUnit && targetUnit.owner !== 0) || (targetBuilding && targetBuilding.owner !== 0);
      if (enemy) {
        dispatch({ type: 'attack', ids, target });
        const haulers = mine.filter(u => !UNITS[u.kind].weapon).map(u => u.id);
        if (haulers.length) dispatch({ type: 'move', ids: haulers, x: wx, y: wy });
        ov.pings.push({ x: wx, y: wy, at: now, kind: 'attack' });
        return;
      }
      const haulerIds = mine.filter(u => u.kind === 'hauler').map(u => u.id);
      const others = mine.filter(u => u.kind !== 'hauler').map(u => u.id);
      if (haulerIds.length && targetBuilding && targetBuilding.kind === 'refinery') {
        dispatch({ type: 'harvest', ids: haulerIds, refinery: targetBuilding.id });
        if (others.length) dispatch({ type: 'move', ids: others, x: wx, y: wy, attackMove: forceAttackMove });
        ov.pings.push({ x: wx, y: wy, at: now, kind: 'move' });
        return;
      }
      const tile = Math.floor(wy) * MAP_W + Math.floor(wx);
      if (haulerIds.length && s.ore[tile] > 0 && s.explored.charCodeAt(tile) === 49) {
        dispatch({ type: 'harvest', ids: haulerIds, tile });
        if (others.length) dispatch({ type: 'move', ids: others, x: wx, y: wy, attackMove: forceAttackMove });
        ov.pings.push({ x: wx, y: wy, at: now, kind: 'move' });
        return;
      }
      if (dispatch({ type: 'move', ids, x: wx, y: wy, attackMove: forceAttackMove })) {
        ov.pings.push({ x: wx, y: wy, at: now, kind: forceAttackMove ? 'attack' : 'move' });
      }
    },
    [dispatch, pick],
  );

  const updatePlacement = useCallback((sx: number, sy: number) => {
    const kind = placingRef.current;
    if (!kind) return;
    const s = cur.current;
    const spec = BUILDINGS[kind];
    const w = toWorld(sx, sy);
    const tx = Math.round(w.x - spec.w / 2);
    const ty = Math.round(w.y - spec.h / 2);
    overlay.current.placement = { kind, tx, ty, ok: placementProblem(s, 0, kind, tx, ty, occupancy(s)) === null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Pointer input on the battlefield -----------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const m = mouse.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      m.pan = true;
      m.panX = sx;
      m.panY = sy;
      m.camX = cam.current.x;
      m.camY = cam.current.y;
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      if (placingRef.current) {
        setPlacing(null);
        return;
      }
      if (attackRef.current) {
        setAttackMode(false);
        return;
      }
      const w = toWorld(sx, sy);
      command(w.x, w.y, false);
      return;
    }
    if (e.button !== 0) return;
    if (placingRef.current) {
      updatePlacement(sx, sy);
      const p = overlay.current.placement;
      if (p && p.ok && dispatch({ type: 'place', kind: p.kind, x: p.tx, y: p.ty })) setPlacing(null);
      return;
    }
    if (attackRef.current) {
      const w = toWorld(sx, sy);
      command(w.x, w.y, true);
      setAttackMode(false);
      return;
    }
    m.down = true;
    m.downX = sx;
    m.downY = sy;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const m = mouse.current;
    m.x = sx;
    m.y = sy;
    m.inside = true;
    if (m.pan) {
      cam.current.x = m.camX - (sx - m.panX) / cam.current.zoom;
      cam.current.y = m.camY - (sy - m.panY) / cam.current.zoom;
      clampCam(cam.current);
      return;
    }
    if (m.down && Math.hypot(sx - m.downX, sy - m.downY) > 5) {
      overlay.current.drag = { x0: m.downX, y0: m.downY, x1: sx, y1: sy };
    }
    const w = toWorld(sx, sy);
    overlay.current.hover = pick(w.x, w.y);
    updatePlacement(sx, sy);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = mouse.current;
    if (m.pan) {
      m.pan = false;
      return;
    }
    if (!m.down || e.button !== 0) return;
    m.down = false;
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const ov = overlay.current;
    const s = cur.current;
    if (ov.drag) {
      const a = toWorld(Math.min(ov.drag.x0, ov.drag.x1), Math.min(ov.drag.y0, ov.drag.y1));
      const b = toWorld(Math.max(ov.drag.x0, ov.drag.x1), Math.max(ov.drag.y0, ov.drag.y1));
      ov.drag = null;
      const inBox = s.units.filter(u => u.owner === 0 && u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y);
      // A box with fighting units in it leaves the haulers out, the way you almost always want.
      const fighters = inBox.filter(u => u.kind !== 'hauler');
      const chosen = fighters.length ? fighters : inBox;
      if (e.shiftKey) chosen.forEach(u => ov.selected.add(u.id));
      else ov.selected = new Set(chosen.map(u => u.id));
      if (chosen.length) sound.play('select');
      refresh();
      return;
    }
    const w = toWorld(sx, sy);
    const id = pick(w.x, w.y);
    const now = performance.now();
    const double = now - m.lastClick < 320;
    m.lastClick = now;
    const unit = s.units.find(u => u.id === id);
    if (unit && unit.owner === 0 && double) {
      // Double-click: every unit of that kind on screen.
      const c = cam.current;
      const x0 = c.x / TILE;
      const y0 = c.y / TILE;
      const x1 = x0 + c.w / c.zoom / TILE;
      const y1 = y0 + c.h / c.zoom / TILE;
      ov.selected = new Set(s.units.filter(u => u.owner === 0 && u.kind === unit.kind && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1).map(u => u.id));
    } else if (unit && unit.owner === 0 && e.shiftKey) {
      if (ov.selected.has(id)) ov.selected.delete(id);
      else ov.selected.add(id);
    } else if (id) {
      ov.selected = new Set([id]);
      const b = s.buildings.find(x => x.id === id);
      if (b && b.owner === 0) {
        if (b.kind === 'barracks') setTab('infantry');
        if (b.kind === 'factory') setTab('vehicle');
        if (b.kind === 'hq') setTab('building');
      }
      sound.play('select');
    } else if (!e.shiftKey) {
      // Clicking open ground with units selected leaves them selected; right-click gives orders.
      if (!ownSelectedUnits().length) ov.selected = new Set();
    }
    refresh();
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const c = cam.current;
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const before = { x: c.x + sx / c.zoom, y: c.y + sy / c.zoom };
    c.zoom = Math.max(0.55, Math.min(1.7, c.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    c.x = before.x - sx / c.zoom;
    c.y = before.y - sy / c.zoom;
    clampCam(c);
  };

  // ---- Keyboard -----------------------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      keys.current.add(e.key);
      const ov = overlay.current;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (help) setHelp(false);
        else if (placingRef.current) setPlacing(null);
        else if (attackRef.current) setAttackMode(false);
        else {
          ov.selected = new Set();
          refresh();
        }
      } else if (k === 'a' && !e.ctrlKey && !e.metaKey) {
        if (ownSelectedUnits().length) setAttackMode(true);
      } else if (k === 's' && !e.ctrlKey && !e.metaKey) {
        const ids = ownSelectedUnits().map(u => u.id);
        if (ids.length) dispatch({ type: 'stop', ids });
      } else if (k === 'p' || e.key === ' ') {
        e.preventDefault();
        setPaused(p => !p);
      } else if (k === 'h' || e.key === 'Home') {
        const yard = cur.current.buildings.find(b => b.owner === 0 && b.kind === 'hq') ?? cur.current.buildings.find(b => b.owner === 0);
        if (yard) centreOn(yard.x + 1.5, yard.y + 1.5);
      } else if (/^[1-9]$/.test(e.key)) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          groups.current.set(e.key, ownSelectedUnits().map(u => u.id));
        } else {
          const live = new Set(cur.current.units.filter(u => u.owner === 0).map(u => u.id));
          const ids = (groups.current.get(e.key) ?? []).filter(id => live.has(id));
          if (ids.length) {
            const same = ids.length === ov.selected.size && ids.every(id => ov.selected.has(id));
            ov.selected = new Set(ids);
            if (same) {
              const units = cur.current.units.filter(u => live.has(u.id) && ov.selected.has(u.id));
              const cx = units.reduce((a, u) => a + u.x, 0) / units.length;
              const cy = units.reduce((a, u) => a + u.y, 0) / units.length;
              centreOn(cx, cy);
            }
            refresh();
          }
        }
      } else if (k === 'r') {
        const b = cur.current.buildings.find(x => ov.selected.has(x.id) && x.owner === 0);
        if (b) dispatch({ type: 'repair', id: b.id });
      } else if (e.key === '?') {
        setHelp(h => !h);
      } else if (k === 'm' && !e.ctrlKey && !e.metaKey) {
        changeSound({ muted: !sound.prefs.muted });
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key);
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, refresh, setPlacing, centreOn, help, changeSound]);

  // Browsers only allow audio after the player has touched the page.
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // ---- The loop: simulation at ten ticks a second, drawing every frame ----------------------
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastTick = cur.current.tick;
    let heardLog = cur.current.log.length ? cur.current.log[cur.current.log.length - 1] : null;
    let heardWinner = cur.current.winner !== null;
    const frame = (now: number) => {
      const dt = Math.min(250, now - last);
      last = now;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (canvas && wrap) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          canvas.style.width = `${w}px`;
          canvas.style.height = `${h}px`;
        }
        const c = cam.current;
        c.w = w;
        c.h = h;
        clampCam(c);

        // Scrolling: arrow keys, or the pointer resting at the edge of the view.
        const pan = (dt / 1000) * 700 / c.zoom;
        const k = keys.current;
        const m = mouse.current;
        let dx = 0;
        let dy = 0;
        if (k.has('ArrowLeft')) dx -= pan;
        if (k.has('ArrowRight')) dx += pan;
        if (k.has('ArrowUp')) dy -= pan;
        if (k.has('ArrowDown')) dy += pan;
        if (m.inside && !m.down && !m.pan && document.hasFocus()) {
          const edge = 14;
          if (m.x >= 0 && m.x < edge) dx -= pan;
          if (m.x > w - edge) dx += pan;
          if (m.y >= 0 && m.y < edge) dy -= pan;
          if (m.y > h - edge) dy += pan;
        }
        if (dx || dy) {
          c.x += dx;
          c.y += dy;
          clampCam(c);
          if (placingRef.current) updatePlacement(m.x, m.y);
        }

        let alpha = 1;
        if (!pausedRef.current && cur.current.winner === null) {
          acc.current += dt * speedRef.current;
          let n = 0;
          while (acc.current >= TICK_MS && n < 4) {
            prev.current = cur.current;
            cur.current = processAction(cur.current, { type: 'tick' });
            acc.current -= TICK_MS;
            n++;
          }
          if (n === 4) acc.current = 0;
          alpha = acc.current / TICK_MS;
        } else {
          prev.current = cur.current;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) renderer.current!.draw(ctx, cur.current, prev.current, alpha, c, overlay.current, now, dpr);
        if (cur.current.tick !== lastTick) {
          lastTick = cur.current.tick;
          // Drop selections of things that have died.
          const sel = overlay.current.selected;
          if (sel.size) {
            const alive = new Set<number>();
            for (const u of cur.current.units) if (sel.has(u.id)) alive.add(u.id);
            for (const b of cur.current.buildings) if (sel.has(b.id)) alive.add(b.id);
            if (alive.size !== sel.size) overlay.current.selected = alive;
          }
          if (placingRef.current && readyStructure(cur.current, 0) !== placingRef.current) setPlacing(null);
          // Interface sounds from what the battle reported this tick.
          const log = cur.current.log;
          let from = heardLog ? log.lastIndexOf(heardLog) + 1 : 0;
          if (from === 0 && heardLog) from = Math.max(0, log.length - 2);
          for (let i = from; i < log.length; i++) {
            const l = log[i];
            if (/under attack/i.test(l.text)) sound.play('alarm');
            else if (/ ready/i.test(l.text)) sound.play('ready');
          }
          if (log.length) heardLog = log[log.length - 1];
          if (cur.current.winner !== null && !heardWinner) {
            heardWinner = true;
            sound.play(cur.current.winner === 0 ? 'victory' : 'defeat');
          }
          if (cur.current.winner !== null) doSave();
          refresh();
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [doSave, refresh, setPlacing, updatePlacement]);

  // ---- Saving -------------------------------------------------------------------------------
  useEffect(() => {
    const iv = window.setInterval(doSave, SAVE_EVERY_MS);
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        doSave();
        setPaused(true);
      }
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', doSave);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', doSave);
      doSave();
    };
  }, [doSave]);

  useEffect(() => {
    if (paused) doSave();
  }, [paused, doSave]);

  // ---- Render -------------------------------------------------------------------------------
  const s = cur.current;
  const vis = renderer.current!.visible(s);
  const uplinkOnline = s.buildings.some(b => b.owner === 0 && b.kind === 'uplink') && !powerOf(s, 0).low;
  const secs = Math.floor(s.tick / TICKS_PER_SECOND);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const recent = s.log.slice(-5).reverse();
  const cursor = placing ? 'copy' : attackMode ? 'crosshair' : overlay.current.hover ? 'pointer' : 'default';

  return (
    <div style={shell}>
      <header style={topBar}>
        <button
          style={chromeBtn}
          onClick={() => {
            doSave();
            navigate('/');
          }}
        >
          ← Lobby
        </button>
        <strong style={{ fontFamily: FONT.display, fontSize: '1rem', letterSpacing: '0.04em' }}>FIRELINE</strong>
        <span style={{ color: UI.textSoft, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
          {s.name} · {DIFFICULTIES[s.difficulty].label}
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: '0.85rem', color: UI.text }} data-testid="clock">
          {clock}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.72rem', color: saveError ? UI.bad : UI.textFaint }} title={saveError ?? undefined}>
          {saveError ? 'Not saving' : lastSaved ? `Saved ${cloud ? 'to your account' : 'in this browser'}` : 'Saves every 15s'}
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {SPEEDS.map(sp => (
            <button
              key={sp.label}
              style={{ ...chromeBtn, padding: '3px 8px', borderColor: speed === sp.value ? UI.accent : UI.rule, color: speed === sp.value ? UI.accent : UI.textSoft }}
              onClick={() => setSpeed(sp.value)}
            >
              {sp.label}
            </button>
          ))}
        </div>
        <button style={{ ...chromeBtn, minWidth: 76 }} onClick={() => setPaused(p => !p)} data-testid="pause">
          {paused ? 'Resume' : 'Pause'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            style={{ ...chromeBtn, minWidth: 82 }}
            data-testid="sound-button"
            aria-pressed={!soundPrefs.muted}
            title="Sound on or off (M)"
            onClick={() => changeSound({ muted: !soundPrefs.muted })}
          >
            {soundPrefs.muted ? 'Sound off' : 'Sound on'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={soundPrefs.volume}
            aria-label="Volume"
            disabled={soundPrefs.muted}
            onChange={e => changeSound({ volume: Number(e.target.value) })}
            style={{ width: 70, accentColor: 'var(--ui-accent)' }}
          />
        </div>
        <button
          style={chromeBtn}
          data-testid="tour-button"
          onClick={() => {
            setTourRun(n => n + 1);
            setTourOpen(true);
          }}
        >
          Tour
        </button>
        <button style={chromeBtn} onClick={() => setHelp(true)} aria-label="Controls">
          ?
        </button>
        <ThemeToggle style={{ padding: '4px 8px' }} />
      </header>

      {saveError && <div style={errorStrip}>{saveError}</div>}

      <div style={body}>
        <div ref={wrapRef} style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 320, overflow: 'hidden', background: '#050707' }}>
          <canvas
            ref={canvasRef}
            id="fl-battlefield"
            data-testid="battlefield"
            data-placing={placing ?? ''}
            data-placement={overlay.current.placement ? (overlay.current.placement.ok ? 'ok' : 'bad') : ''}
            style={{ display: 'block', cursor, touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => (mouse.current.inside = false)}
            onContextMenu={e => e.preventDefault()}
            onWheel={onWheel}
          />
          {(placing || attackMode) && (
            <div style={hint}>
              {placing
                ? `Place the ${BUILDINGS[placing].name}: click open ground near your base. Right-click or Esc to stop.`
                : 'Attack-move: click where to go. Units fight anything they meet on the way.'}
            </div>
          )}
          <div style={feed} aria-live="polite">
            {recent.map(l => (
              <div key={`${l.tick}-${l.text}`} style={{ color: l.tone === 'bad' ? '#ff9a8c' : l.tone === 'good' ? '#a8f0ae' : '#e4ebe8', opacity: Math.max(0.25, 1 - (s.tick - l.tick) / 300) }}>
                {l.text}
              </div>
            ))}
          </div>
          {paused && !help && s.winner === null && (
            <div style={scrim}>
              <div style={card}>
                <h2 style={{ margin: 0, fontFamily: FONT.display }}>Paused</h2>
                <p style={{ margin: 0, color: UI.textSoft, fontSize: '0.85rem' }}>Your progress has been saved.</p>
                <button style={{ ...chromeBtn, borderColor: UI.accent }} onClick={() => setPaused(false)}>
                  Resume
                </button>
              </div>
            </div>
          )}
          {help && (
            <div style={scrim} onClick={() => setHelp(false)}>
              <div style={{ ...card, maxWidth: 520, textAlign: 'left' }} onClick={e => e.stopPropagation()}>
                <h2 style={{ margin: 0, fontFamily: FONT.display }}>Controls</h2>
                <Controls />
                <button style={{ ...chromeBtn, alignSelf: 'flex-end' }} onClick={() => setHelp(false)}>
                  Close
                </button>
              </div>
            </div>
          )}
          {s.winner !== null && <EndCard state={s} onLobby={() => navigate('/')} />}
        </div>

        {tourOpen && (
          <GuidedTour
            key={tourRun}
            view={{ s, selected: [...overlay.current.selected], placing, tab }}
            onFinish={() => setTourOpen(false)}
            hidden={paused || help || s.winner !== null}
          />
        )}

        <aside style={sidebar} className="fl-scroll">
          <BuildPanel
            state={s}
            tab={tab}
            setTab={setTab}
            dispatch={dispatch}
            placing={placing}
            setPlacing={k => {
              setPlacing(k);
              if (k) setAttackMode(false);
            }}
            minimap={<Minimap state={s} vis={vis} online={uplinkOnline} cam={cam.current} onJump={centreOn} />}
          />
          <div style={{ borderTop: `1px solid ${UI.rule}`, paddingTop: 8 }}>
            <SelectionPanel state={s} selected={overlay.current.selected} dispatch={dispatch} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function clampCam(c: Camera) {
  const vw = c.w / c.zoom;
  const vh = c.h / c.zoom;
  const m = 64;
  c.x = Math.max(-m, Math.min(MAP_W * TILE - vw + m, c.x));
  c.y = Math.max(-m, Math.min(MAP_H * TILE - vh + m, c.y));
  if (vw > MAP_W * TILE + 2 * m) c.x = (MAP_W * TILE - vw) / 2;
  if (vh > MAP_H * TILE + 2 * m) c.y = (MAP_H * TILE - vh) / 2;
}

export function Controls() {
  const rows: [string, string][] = [
    ['Left-click / drag', 'Select a unit or structure; drag a box to select a group'],
    ['Double-click', 'Select every unit of that kind on screen'],
    ['Right-click', 'Move, attack, harvest, or set a rally point for a selected producer'],
    ['A then click', 'Attack-move: go there, fighting anything met on the way'],
    ['S', 'Stop'],
    ['Ctrl + 1–9', 'Make a group; press the number to select it, twice to jump to it'],
    ['R', 'Toggle repair on the selected structure'],
    ['Arrows / screen edge', 'Scroll; middle-drag to pan; wheel to zoom'],
    ['H', 'Jump to your Command Yard'],
    ['P or Space', 'Pause'],
    ['M', 'Sound on or off'],
    ['Esc', 'Cancel placement or attack-move; clear selection'],
  ];
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td style={{ padding: '3px 12px 3px 0', whiteSpace: 'nowrap', fontWeight: 600, verticalAlign: 'top' }}>{k}</td>
            <td style={{ padding: '3px 0', color: UI.textSoft }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EndCard({ state, onLobby }: { state: GameState; onLobby: () => void }) {
  const won = state.winner === 0;
  const [me, them] = state.players;
  const secs = Math.floor(state.tick / TICKS_PER_SECOND);
  const rows: [string, number, number][] = [
    ['Structures built', me.stats.built, them.stats.built],
    ['Units trained', me.stats.trained, them.stats.trained],
    ['Enemy destroyed', me.stats.killed, them.stats.killed],
    ['Losses', me.stats.lost, them.stats.lost],
    ['Credits harvested', me.stats.harvested, them.stats.harvested],
  ];
  return (
    <div style={scrim}>
      <div style={{ ...card, minWidth: 320 }} data-testid="end-card" data-status={statusOf(state)}>
        <h2 style={{ margin: 0, fontFamily: FONT.display, fontSize: '1.8rem', letterSpacing: '0.08em', color: won ? UI.good : UI.bad }}>
          {won ? 'VICTORY' : 'DEFEAT'}
        </h2>
        <p style={{ margin: 0, color: UI.textSoft, fontSize: '0.85rem' }}>
          {won ? 'The Ashen Combine has been driven from the field' : 'Your last structure has fallen'} after {Math.floor(secs / 60)} minutes{' '}
          {secs % 60} seconds.
        </p>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
          <thead>
            <tr style={{ color: UI.textFaint }}>
              <th />
              <th style={{ textAlign: 'right', padding: '2px 6px', color: UI.team }}>You</th>
              <th style={{ textAlign: 'right', padding: '2px 6px', color: UI.enemy }}>Enemy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([l, a, b]) => (
              <tr key={l}>
                <td style={{ textAlign: 'left', padding: '2px 6px 2px 0', color: UI.textSoft }}>{l}</td>
                <td style={{ textAlign: 'right', padding: '2px 6px', fontFamily: FONT.mono }}>{Math.floor(a).toLocaleString('en-GB')}</td>
                <td style={{ textAlign: 'right', padding: '2px 6px', fontFamily: FONT.mono }}>{Math.floor(b).toLocaleString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button style={{ ...chromeBtn, borderColor: UI.accent }} onClick={onLobby}>
          Back to the lobby
        </button>
      </div>
    </div>
  );
}

const shell: CSSProperties = {
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: UI.ground,
  color: UI.text,
  fontFamily: FONT.body,
  overflow: 'hidden',
};

const topBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 10px',
  borderBottom: `1px solid ${UI.rule}`,
  background: UI.panel,
  flexWrap: 'wrap',
};

const body: CSSProperties = {
  flex: 1,
  display: 'flex',
  minHeight: 0,
  flexWrap: 'wrap',
};

const sidebar: CSSProperties = {
  width: 268,
  flex: '0 0 268px',
  maxHeight: '100%',
  overflowY: 'auto',
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background: UI.panel,
  borderLeft: `1px solid ${UI.rule}`,
};

export const chromeBtn: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.8rem',
  padding: '4px 10px',
  border: `1px solid ${UI.rule}`,
  background: UI.panelRaised,
  color: UI.text,
  borderRadius: 3,
  cursor: 'pointer',
};

const hint: CSSProperties = {
  position: 'absolute',
  top: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(8,12,12,0.82)',
  color: '#e9f0ec',
  padding: '6px 12px',
  borderRadius: 4,
  fontSize: '0.8rem',
  pointerEvents: 'none',
  maxWidth: '90%',
  textAlign: 'center',
};

const feed: CSSProperties = {
  position: 'absolute',
  left: 10,
  bottom: 10,
  display: 'flex',
  flexDirection: 'column-reverse',
  gap: 2,
  fontSize: '0.78rem',
  textShadow: '0 1px 2px #000, 0 0 6px #000',
  pointerEvents: 'none',
  maxWidth: '60%',
};

const scrim: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: UI.scrim,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const card: CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  borderRadius: 6,
  padding: '18px 22px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  boxShadow: `0 10px 40px ${UI.shadow}`,
  textAlign: 'center',
};

const errorStrip: CSSProperties = {
  padding: '6px 12px',
  background: UI.tintBad,
  color: UI.bad,
  fontSize: '0.8rem',
  borderBottom: `1px solid ${UI.rule}`,
};
