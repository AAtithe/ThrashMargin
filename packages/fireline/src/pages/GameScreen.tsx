import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isCampaignSave } from '../campaign/save';
import type { CampaignSave } from '../campaign/types';
import { HERO_KEYS, HeroBar, heroName, ObjectivesPanel, PowerBar, abilityBlock, type Targeting } from '../components/CampaignHud';
import GuidedTour, { hasSeenGuidedTour } from '../components/GuidedTour';
import ThemeToggle from '../components/ThemeToggle';
import { TILE } from '../game/art';
import Minimap, { ALERT_MS, type Alert } from '../game/Minimap';
import { Renderer, type Camera, type Overlay } from '../game/renderer';
import { BUILD_KEYS, BuildPanel, SelectionPanel, TAB_ORDER, menuFor, pressBuild, type Tab } from '../game/Sidebar';
import { sound } from '../game/sound';
import { statusOf, useSaves } from '../hooks/useSaves';
import CampaignFlow from './Campaign';
import { campaignSaves } from './campaignSaves';
import { LoadingScreen, SIGN_IN_AGAIN } from '../lib/Loading';
import { clearToken, getStoredUser } from '../lib/portalAuth';
import { processAction } from '../sim/actions';
import { placementProblem } from '../sim/commands';
import { occupancy } from '../sim/grid';
import { abilityProblem, heroUnit, powerProblem } from '../sim/mission';
import {
  BUILDINGS,
  DIFFICULTIES,
  HERO_ABILITY,
  HERO_KINDS,
  MAP_H,
  MAP_W,
  MAX_QUEUE,
  POWERS,
  TICKS_PER_SECOND,
  UNITS,
  type BuildingKind,
  type HeroKind,
  type SupportPower,
  type UnitKind,
} from '../sim/rules';
import { costOf, powerOf, readyStructure, unlocked } from '../sim/state';
import type { GameAction, GameState } from '../sim/types';
import { FONT, UI } from '../theme';

const TICK_MS = 1000 / TICKS_PER_SECOND;
const SAVE_EVERY_MS = 15000;
/** How long the battlefield's "under attack" chip stays up after the last hit, in milliseconds. */
const ALERT_CHIP_MS = 8000;
/** Alerts closer than this (tiles) within this long (ms) of one already pinged share its ping. */
const ALERT_MERGE_TILES = 6;
const ALERT_MERGE_MS = 6000;
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
  // The campaign's calls (create, load, save of a CampaignSave) alongside the skirmish ones.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const camp = useMemo(() => campaignSaves(saves), [saves.cloud, saves.load, saves.save]);
  const [state, setState] = useState<GameState | CampaignSave | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const { load } = camp;

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
  if (isCampaignSave(state)) {
    return <CampaignFlow initial={state} save={camp.save} saveError={saves.error} lastSaved={saves.lastSaved} cloud={saves.cloud} />;
  }
  return <Battle initial={state} save={saves.save} saveError={saves.error} lastSaved={saves.lastSaved} cloud={saves.cloud} />;
}

/** What a campaign battle adds to the screen: where "back" goes, and the debrief at the end. */
export interface CampaignBattle {
  leaveLabel: string;
  onLeave: () => void;
  /** Drawn over the battlefield once `s.mission.result` is set, in place of the skirmish end card. */
  renderEnd: (s: GameState) => ReactNode;
}

export function Battle({
  initial,
  save,
  saveError,
  lastSaved,
  cloud,
  campaign,
}: {
  initial: GameState;
  save: (s: GameState) => void;
  saveError: string | null;
  lastSaved: number | null;
  cloud: boolean;
  campaign?: CampaignBattle;
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
  // Combat alerts: every recent ping (drawn by the minimap) and the latest hit, which Space jumps to.
  const alerts = useRef<Alert[]>([]);
  const lastAlert = useRef<Alert | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const toastTimer = useRef(0);

  const [, setHud] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [placing, setPlacingState] = useState<BuildingKind | null>(null);
  const [attackMode, setAttackMode] = useState(false);
  const [tab, setTab] = useState<Tab>('building');
  const [help, setHelp] = useState(false);
  // Campaign: a hero ability or support power waiting for its click on the map.
  const [targeting, setTargetingState] = useState<Targeting>(null);
  const targetingRef = useRef<Targeting>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const zoneRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Heroes fielded in this mission, kept after they fall so the bar can say so.
  const fielded = useRef(new Set<HeroKind>());
  if (!fielded.current.size) for (const u of initial.units) if (u.owner === 0 && u.hero) fielded.current.add(u.kind as HeroKind);
  // The guided run opens by itself on a fresh battle for anyone who has not finished or skipped it
  // in this browser; the Tour button reopens it at any time. Bumping `tourRun` remounts it, so a
  // reopened run always starts on the welcome card.
  // The tour teaches a skirmish base; a campaign battle never opens it.
  const [tourOpen, setTourOpen] = useState(() => !initial.mission && !hasSeenGuidedTour() && initial.tick < 600 && initial.winner === null);
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
  const tabRef = useRef(tab);
  tabRef.current = tab;
  pausedRef.current = paused || help;
  speedRef.current = speed;
  placingRef.current = placing;
  attackRef.current = attackMode;
  targetingRef.current = targeting;

  const refresh = useCallback(() => setHud(n => (n + 1) % 1000000), []);

  const setPlacing = useCallback((k: BuildingKind | null) => {
    setPlacingState(k);
    placingRef.current = k;
    if (!k) overlay.current.placement = null;
  }, []);

  const setTargeting = useCallback((t: Targeting) => {
    setTargetingState(t);
    targetingRef.current = t;
    if (!t && ringRef.current) ringRef.current.style.display = 'none';
  }, []);

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(t => ({ text, n: (t?.n ?? 0) + 1 }));
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const dispatch = useCallback(
    (a: GameAction): boolean => {
      const next = processAction(cur.current, a);
      if (next === cur.current) {
        if (a.type === 'queue' || a.type === 'place') sound.play('denied');
        if (a.type === 'queue') {
          // Say why, in the order the rules check it.
          const s = cur.current;
          const q = s.players[0].queues[a.category];
          if (s.allowed && !s.allowed.includes(a.kind)) showToast('Not available in this mission');
          else if (!unlocked(s, 0, a.kind)) {
            const needs = (a.kind in BUILDINGS ? BUILDINGS[a.kind as BuildingKind] : UNITS[a.kind as UnitKind]).requires;
            showToast(`Needs a ${needs.filter(r => !s.buildings.some(b => b.owner === 0 && b.kind === r)).map(r => BUILDINGS[r].name).join(' and a ')}`);
          } else if (a.category === 'building' && q.length) showToast('One structure at a time');
          else if (q.length >= MAX_QUEUE) showToast('Queue full');
          else if (s.players[0].credits < costOf(a.kind)) showToast('Insufficient funds');
        }
        return false;
      }
      cur.current = next;
      if (a.type === 'queue' || a.type === 'cancel') sound.play('queue');
      else if (a.type === 'place') sound.play('place');
      else if (a.type === 'move' || a.type === 'attack' || a.type === 'harvest' || a.type === 'rally' || a.type === 'stop' || a.type === 'ability' || a.type === 'power')
        sound.play('order');
      refresh();
      return true;
    },
    [refresh, showToast],
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

  const jumpToAlert = useCallback(() => {
    const a = lastAlert.current;
    if (a) centreOn(a.x, a.y);
  }, [centreOn]);

  /** Placement from the build menu or its hotkeys: entering it leaves attack-move. */
  const choosePlacing = useCallback(
    (k: BuildingKind | null) => {
      setPlacing(k);
      if (k) {
        setAttackMode(false);
        setTargeting(null);
      }
    },
    [setPlacing, setTargeting],
  );

  // ---- Campaign: heroes, abilities and support powers ------------------------------------------
  const heroOrder = (): HeroKind[] => {
    for (const u of cur.current.units) if (u.owner === 0 && u.hero) fielded.current.add(u.kind as HeroKind);
    return HERO_KINDS.filter(k => fielded.current.has(k));
  };

  /** Select a hero; selecting the same one again centres the view on it. */
  const selectHero = useCallback(
    (kind: HeroKind) => {
      const u = heroUnit(cur.current, 0, kind);
      if (!u) return;
      const ov = overlay.current;
      if (ov.selected.size === 1 && ov.selected.has(u.id)) centreOn(u.x, u.y);
      else {
        ov.selected = new Set([u.id]);
        sound.play('select');
      }
      refresh();
    },
    [centreOn, refresh],
  );

  /** Use a hero's ability: at once when it needs no target, otherwise wait for a click on a structure. */
  const triggerAbility = useCallback(
    (kind: HeroKind) => {
      const s = cur.current;
      const u = heroUnit(s, 0, kind);
      if (!u) return;
      const block = abilityBlock(s, u);
      if (block) {
        sound.play('denied');
        showToast(block);
        return;
      }
      if (HERO_ABILITY[kind].target === 'none') {
        if (!dispatch({ type: 'ability', id: u.id })) showToast(abilityProblem(s, 0, u.id) ?? 'Not now');
        return;
      }
      setPlacing(null);
      setAttackMode(false);
      const t = targetingRef.current;
      setTargeting(t?.kind === 'ability' && t.heroId === u.id ? null : { kind: 'ability', heroId: u.id, hero: kind });
    },
    [dispatch, setPlacing, setTargeting, showToast],
  );

  const choosePower = useCallback(
    (p: SupportPower) => {
      setPlacing(null);
      setAttackMode(false);
      const t = targetingRef.current;
      setTargeting(t?.kind === 'power' && t.power === p ? null : { kind: 'power', power: p });
    },
    [setPlacing, setTargeting],
  );

  /** The click that completes a targeting mode. Stays in the mode after a refused click, saying why. */
  const fireTargeting = (wx: number, wy: number) => {
    const t = targetingRef.current;
    if (!t) return;
    const s = cur.current;
    const now = performance.now();
    if (t.kind === 'power') {
      const x = Math.floor(wx) + 0.5;
      const y = Math.floor(wy) + 0.5;
      const problem = powerProblem(s, 0, t.power, x, y);
      if (problem || !dispatch({ type: 'power', power: t.power, x, y })) {
        sound.play('denied');
        showToast(problem ?? 'Not now');
        return;
      }
      overlay.current.pings.push({ x, y, at: now, kind: 'attack' });
      setTargeting(null);
      return;
    }
    const id = pick(wx, wy);
    const b = s.buildings.find(x => x.id === id);
    if (!b || b.owner === 0) {
      sound.play('denied');
      showToast('Click an enemy structure');
      return;
    }
    const problem = abilityProblem(s, 0, t.heroId, b.id);
    if (problem || !dispatch({ type: 'ability', id: t.heroId, target: b.id })) {
      sound.play('denied');
      showToast(problem ?? 'Not now');
      return;
    }
    overlay.current.pings.push({ x: wx, y: wy, at: now, kind: 'attack' });
    setTargeting(null);
  };

  /** Control-group badges for the renderer (contract 3): unit id to digit, newest group winning. */
  const syncGroupBadges = () => {
    const m = new Map<number, number>();
    for (const [digit, ids] of groups.current) for (const id of ids) m.set(id, Number(digit));
    (overlay.current as Overlay & { groupOf?: Map<number, number> }).groupOf = m;
  };

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
      // Shift held: add the order to the end of each unit's waypoint queue.
      const queue = keys.current.has('Shift');
      const targetUnit = s.units.find(u => u.id === target);
      const targetBuilding = s.buildings.find(b => b.id === target);
      const enemy = (targetUnit && targetUnit.owner !== 0) || (targetBuilding && targetBuilding.owner !== 0);
      if (enemy) {
        dispatch({ type: 'attack', ids, target, queue });
        const haulers = mine.filter(u => !UNITS[u.kind].weapon).map(u => u.id);
        if (haulers.length) dispatch({ type: 'move', ids: haulers, x: wx, y: wy, queue });
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
      if (dispatch({ type: 'move', ids, x: wx, y: wy, attackMove: forceAttackMove, queue })) {
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
      if (targetingRef.current) {
        setTargeting(null);
        return;
      }
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
    if (targetingRef.current) {
      const w = toWorld(sx, sy);
      fireTargeting(w.x, w.y);
      return;
    }
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
    placeRing(sx, sy);
  };

  /** The support power's area, following the pointer while a power is being aimed. */
  const placeRing = (sx: number, sy: number) => {
    const el = ringRef.current;
    const t = targetingRef.current;
    if (!el) return;
    const r = t?.kind === 'power' ? POWERS[t.power].radius : 0;
    if (!r || !mouse.current.inside) {
      el.style.display = 'none';
      return;
    }
    const d = r * 2 * TILE * cam.current.zoom;
    el.style.display = 'block';
    el.style.width = el.style.height = `${d}px`;
    el.style.transform = `translate(${sx - d / 2}px, ${sy - d / 2}px)`;
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
      const buildIndex = (BUILD_KEYS as readonly string[]).indexOf(k);
      if (buildIndex >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Q W E R T Y: the open list's items in order; Shift queues five units.
        const kind = menuFor(tabRef.current)[buildIndex];
        if (kind) pressBuild(cur.current, tabRef.current, kind, placingRef.current, dispatch, choosePlacing, e.shiftKey);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const i = TAB_ORDER.indexOf(tabRef.current);
        setTab(TAB_ORDER[(i + (e.shiftKey ? TAB_ORDER.length - 1 : 1)) % TAB_ORDER.length]);
        return;
      }
      const heroKey = (HERO_KEYS as readonly string[]).indexOf(k);
      if (cur.current.mission && heroKey >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Z X C V: heroes 1 to 4 in bar order; twice to jump to the hero.
        const kind = heroOrder()[heroKey];
        if (kind) selectHero(kind);
        return;
      }
      if (cur.current.mission && k === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // F: the selected hero's ability.
        const u = cur.current.units.find(x => x.owner === 0 && x.hero && ov.selected.has(x.id));
        if (u) triggerAbility(u.kind as HeroKind);
        return;
      }
      if (e.key === 'Escape') {
        if (help) setHelp(false);
        else if (targetingRef.current) setTargeting(null);
        else if (placingRef.current) setPlacing(null);
        else if (attackRef.current) setAttackMode(false);
        else {
          ov.selected = new Set();
          refresh();
        }
      } else if (k === 'a' && !e.ctrlKey && !e.metaKey) {
        if (ownSelectedUnits().length) {
          setAttackMode(true);
          setTargeting(null);
        }
      } else if (k === 's' && !e.ctrlKey && !e.metaKey) {
        const ids = ownSelectedUnits().map(u => u.id);
        if (ids.length) dispatch({ type: 'stop', ids });
      } else if (k === 'p' && !e.ctrlKey && !e.metaKey) {
        setPaused(p => !p);
      } else if (e.key === ' ') {
        // Space never presses a focused button here; it jumps to the latest combat alert.
        e.preventDefault();
        jumpToAlert();
      } else if (k === 'h' || e.key === 'Home') {
        const yard = cur.current.buildings.find(b => b.owner === 0 && b.kind === 'hq') ?? cur.current.buildings.find(b => b.owner === 0);
        if (yard) centreOn(yard.x + 1.5, yard.y + 1.5);
      } else if (/^[1-9]$/.test(e.key)) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          groups.current.delete(e.key);
          groups.current.set(e.key, ownSelectedUnits().map(u => u.id));
          syncGroupBadges();
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
      } else if (k === 'g' && !e.ctrlKey && !e.metaKey) {
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
  }, [dispatch, refresh, setPlacing, centreOn, help, changeSound, choosePlacing, jumpToAlert, selectHero, triggerAbility, setTargeting]);

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
    let heardWinner = cur.current.winner !== null || !!cur.current.mission?.result;
    // Hits already in a loaded save are not news.
    let seenHurt = cur.current.ai[0].hurtTick;
    let haulerHp = new Map<number, number>();
    for (const u of cur.current.units) if (u.owner === 0 && u.kind === 'hauler') haulerHp.set(u.id, u.hp);
    const raiseAlert = (x: number, y: number, kind: Alert['kind'], at: number) => {
      lastAlert.current = { x, y, at, kind };
      const list = alerts.current.filter(a => at - a.at < Math.max(ALERT_MS, ALERT_MERGE_MS));
      if (!list.some(a => at - a.at < ALERT_MERGE_MS && Math.hypot(a.x - x, a.y - y) < ALERT_MERGE_TILES)) list.push({ x, y, at, kind });
      // Mutated in place: the minimap holds this array and reads it every frame.
      alerts.current.length = 0;
      alerts.current.push(...list);
    };
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
        if (!pausedRef.current && cur.current.winner === null && !cur.current.mission?.result) {
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
        // Campaign: rings over the places an objective sends you (extraction, a zone to hold).
        const zones = zoneRefs.current;
        if (zones.length) {
          const goals = missionZones(cur.current);
          zones.forEach((el, i) => {
            const z = goals[i];
            if (!el || !z) return;
            const d = z.r * 2 * TILE * c.zoom;
            el.style.width = el.style.height = `${d}px`;
            el.style.transform = `translate(${(z.x * TILE - c.x) * c.zoom - d / 2}px, ${(z.y * TILE - c.y) * c.zoom - d / 2}px)`;
          });
        }
        if (targetingRef.current?.kind === 'power') placeRing(m.x, m.y);
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
          // Combat alerts: a structure hit (the side's own memory of it) or a hauler losing health.
          const mem = cur.current.ai[0];
          if (mem.hurtTick > seenHurt) {
            seenHurt = mem.hurtTick;
            raiseAlert(mem.hurtX, mem.hurtY, 'base', now);
          }
          const hp = new Map<number, number>();
          for (const u of cur.current.units) {
            if (u.owner !== 0 || u.kind !== 'hauler') continue;
            const was = haulerHp.get(u.id);
            if (was !== undefined && u.hp < was) raiseAlert(u.x, u.y, 'hauler', now);
            hp.set(u.id, u.hp);
          }
          haulerHp = hp;
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
          const result = cur.current.mission?.result;
          if ((cur.current.winner !== null || result) && !heardWinner) {
            heardWinner = true;
            sound.play((result ? result === 'won' : cur.current.winner === 0) ? 'victory' : 'defeat');
          }
          if (cur.current.winner !== null || result) doSave();
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
  const power = powerOf(s, 0);
  const uplinkOnline = s.buildings.some(b => b.owner === 0 && b.kind === 'uplink') && !power.low;
  const alert = lastAlert.current && performance.now() - lastAlert.current.at < ALERT_CHIP_MS ? lastAlert.current : null;
  const secs = Math.floor(s.tick / TICKS_PER_SECOND);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const recent = s.log.slice(-5).reverse();
  const cursor = placing ? 'copy' : attackMode || targeting ? 'crosshair' : overlay.current.hover ? 'pointer' : 'default';
  const mission = s.mission ?? null;
  const ended = s.winner !== null || !!mission?.result;
  const zones = mission ? missionZones(s) : [];
  const leave = () => {
    doSave();
    if (campaign) campaign.onLeave();
    else navigate('/');
  };

  return (
    <div style={shell}>
      <header style={topBar}>
        <button style={chromeBtn} onClick={leave} data-testid="leave">
          ← {campaign ? campaign.leaveLabel : 'Lobby'}
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
        {!mission && (
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
        )}
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
            onPointerLeave={() => {
              mouse.current.inside = false;
              if (ringRef.current) ringRef.current.style.display = 'none';
            }}
            onContextMenu={e => e.preventDefault()}
            onWheel={onWheel}
          />
          {zones.map((z, i) => (
            <div
              key={i}
              ref={el => {
                zoneRefs.current[i] = el;
              }}
              className="fl-zone"
              data-done={z.done ? '1' : '0'}
              aria-hidden="true"
            >
              <span>{z.label}</span>
            </div>
          ))}
          <div ref={ringRef} className="fl-target-ring" aria-hidden="true" />
          <div className="fl-banners">
            {(placing || attackMode || targeting) && (
              <div className="fl-hint" data-testid="hint">
                {placing
                  ? `Place the ${BUILDINGS[placing].name}: click open ground near your base. Right-click or Esc to stop.`
                  : targeting?.kind === 'ability'
                    ? `${HERO_ABILITY[targeting.hero].name}: click an enemy structure for ${heroName(targeting.hero)}. Right-click or Esc to stop.`
                    : targeting?.kind === 'power'
                      ? `${POWERS[targeting.power].name}: click the map to call it in. Right-click or Esc to stop.`
                      : 'Attack-move: click where to go. Units fight anything they meet on the way.'}
              </div>
            )}
            {power.low && !ended && (
              <div className="fl-lowpower" role="status" data-testid="low-power">
                <strong>Low power</strong> {power.made}/{power.used}. Production at half speed, turrets slowed, radar down. Build a
                Generator.
              </div>
            )}
          </div>
          {alert && !ended && (
            <button type="button" className="fl-alert-chip" data-testid="alert-chip" data-kind={alert.kind} onClick={jumpToAlert}>
              <span className="fl-alert-dot" aria-hidden="true" />
              {alert.kind === 'base' ? 'Base under attack' : 'Hauler under attack'}
              <kbd>Space</kbd>
            </button>
          )}
          {toast && (
            <div key={toast.n} className="fl-toast" role="status" data-testid="toast">
              {toast.text}
            </div>
          )}
          <div style={mission && !ended ? { ...feed, bottom: 78 } : feed} aria-live="polite">
            {recent.map(l => (
              <div key={`${l.tick}-${l.text}`} style={{ color: l.tone === 'bad' ? '#ff9a8c' : l.tone === 'good' ? '#a8f0ae' : '#e4ebe8', opacity: Math.max(0.25, 1 - (s.tick - l.tick) / 300) }}>
                {l.text}
              </div>
            ))}
          </div>
          {mission && !ended && <ObjectivesPanel s={s} />}
          {mission && !ended && (
            <div className="fl-cbar">
              <HeroBar s={s} heroes={heroOrder()} selected={overlay.current.selected} targeting={targeting} onSelect={selectHero} onAbility={triggerAbility} />
              <PowerBar s={s} targeting={targeting} onPower={choosePower} />
            </div>
          )}
          {paused && !help && !ended && (
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
                <Controls campaign={!!mission} />
                <button style={{ ...chromeBtn, alignSelf: 'flex-end' }} onClick={() => setHelp(false)}>
                  Close
                </button>
              </div>
            </div>
          )}
          {mission && campaign ? (mission.result ? campaign.renderEnd(s) : null) : s.winner !== null && <EndCard state={s} onLobby={() => navigate('/')} />}
        </div>

        {tourOpen && (
          <GuidedTour
            key={tourRun}
            view={{ s, selected: [...overlay.current.selected], placing, tab }}
            onFinish={() => setTourOpen(false)}
            hidden={paused || help || ended}
          />
        )}

        <aside style={sidebar} className="fl-scroll">
          <BuildPanel
            state={s}
            tab={tab}
            setTab={setTab}
            dispatch={dispatch}
            placing={placing}
            setPlacing={choosePlacing}
            minimap={<Minimap state={s} vis={vis} online={uplinkOnline} cam={cam.current} onJump={centreOn} alerts={alerts.current} />}
          />
          <div style={{ borderTop: `1px solid ${UI.rule}`, paddingTop: 8 }}>
            <SelectionPanel state={s} selected={overlay.current.selected} dispatch={dispatch} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Places on the map an objective sends the player to, for the rings drawn over the battlefield. */
function missionZones(s: GameState): { x: number; y: number; r: number; label: string; done: boolean }[] {
  const out: { x: number; y: number; r: number; label: string; done: boolean }[] = [];
  for (const o of s.mission?.objectives ?? []) {
    const sp = o.spec;
    if (sp.kind === 'reach') out.push({ x: sp.x, y: sp.y, r: sp.r, label: sp.who === 'any' ? 'Rendezvous' : 'Extraction', done: o.done });
    else if (sp.kind === 'holdZone') out.push({ x: sp.x, y: sp.y, r: sp.r, label: 'Hold', done: o.done });
  }
  return out;
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

/** The key table. Campaign keys are listed in a campaign battle and on How to play. */
export function Controls({ campaign = false }: { campaign?: boolean }) {
  const rows: [string, string][] = [
    ['Left-click / drag', 'Select a unit or structure; drag a box to select a group'],
    ['Double-click', 'Select every unit of that kind on screen'],
    ['Right-click', 'Move, attack, harvest, or set a rally point for a selected producer'],
    ['A then click', 'Attack-move: go there, fighting anything met on the way'],
    ['Shift + right-click', 'Queue another order after the current one (waypoints, up to 12)'],
    ['Stance buttons', 'Aggressive chases anything in sight; Guard (default) holds and returns fire; Hold fire never shoots unordered'],
    ['S', 'Stop'],
    ['Ctrl + 1–9', 'Make a group; press the number to select it, twice to jump to it'],
    ['Q W E R T Y', 'Build or train the first to sixth item in the open list (the letter is on each button)'],
    ['Shift + click or key', 'Queue five infantry or vehicles at once'],
    ['Tab', 'Next build list: Structures, Infantry, Vehicles (Shift + Tab goes back)'],
    ['G', 'Toggle repair on the selected structure'],
    ['Arrows / screen edge', 'Scroll; middle-drag to pan; wheel to zoom'],
    ['H', 'Jump to your Command Yard'],
    ['Space', 'Jump to the last combat alert (pinged on the minimap)'],
    ['P', 'Pause'],
    ['M', 'Sound on or off'],
    ['Esc', 'Cancel placement, attack-move or aiming; clear selection'],
  ];
  const campaignRows: [string, string][] = [
    ['Z X C V', 'Campaign: select hero 1 to 4 in the hero bar; twice to jump to it'],
    ['F', "Campaign: the selected hero's ability (Infiltrate, Demolition charge and Capture then want a click on an enemy structure)"],
    ['Power button, then click', 'Campaign: call a support power (Recon sweep, Artillery barrage, Reinforcements) on that spot'],
  ];
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
      <tbody>
        {(campaign ? [...rows, ...campaignRows] : rows).map(([k, v]) => (
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
