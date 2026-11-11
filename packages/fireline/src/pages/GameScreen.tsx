import { boardProblem, canRide } from '../sim/transport';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isCampaignSave } from '../campaign/save';
import { isPlanetSave, type PlanetSave } from '../planet/save';
import type { CampaignSave } from '../campaign/types';
import { HERO_KEYS, HeroBar, heroName, ObjectivesPanel, PowerBar, SkirmishPowerBar, abilityBlock, type Targeting } from '../components/CampaignHud';
import GuidedTour, { hasSeenGuidedTour } from '../components/GuidedTour';
import FullscreenToggle from '../components/FullscreenToggle';
import MotionToggle from '../components/MotionToggle';
import ThemeToggle from '../components/ThemeToggle';
import { AIR_LIFT, TILE } from '../game/art';
import { useLayout } from '../game/layout';
import Minimap, { ALERT_MS, type Alert } from '../game/Minimap';
import { Renderer, type Camera, type Overlay } from '../game/renderer';
import { BUILD_KEYS, BuildPanel, SelectionPanel, menuFor, pressBuild, tabsFor, type Tab } from '../game/Sidebar';
import BuildWindow from '../game/BuildWindow';
import { airRoom } from '../sim/air';
import { researchProblem } from '../sim/research';
import { sound } from '../game/sound';
import { statusOf, useSaves } from '../hooks/useSaves';
import CampaignFlow from './Campaign';
import PlanetFlow from './Planet';
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
  MAX_QUEUE,
  POWERS,
  TICKS_PER_SECOND,
  UNITS,
  type BuildingKind,
  type HeroKind,
  type SupportPower,
  type UnitKind,
} from '../sim/rules';
import { isAlly, isEnemy, sidesOf, wonBy } from '../sim/sides';
import { costOf, isStructure, powerOf, readyStructure, unlocked } from '../sim/state';
import type { GameAction, GameState } from '../sim/types';
import { FONT, UI } from '../theme';
import { selectionActions } from '../game/selectionActions';

const TICK_MS = 1000 / TICKS_PER_SECOND;
const SAVE_EVERY_MS = 15000;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.7;
/** How far a finger may wander, in CSS pixels, and still count as a tap rather than a drag. */
const TAP_SLOP = 10;
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
  const [state, setState] = useState<GameState | CampaignSave | PlanetSave | null>(null);
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
  // War for the Planet (fireline-planet-design.md, section 17): the whole war, battles included.
  if (isPlanetSave(state)) {
    return <PlanetFlow initial={state} save={camp.save} saveError={saves.error} lastSaved={saves.lastSaved} cloud={saves.cloud} />;
  }
  return <Battle initial={state} save={saves.save} saveError={saves.error} lastSaved={saves.lastSaved} cloud={saves.cloud} />;
}

/** What a campaign battle adds to the screen: where "back" goes, and the debrief at the end. */
export interface CampaignBattle {
  leaveLabel: string;
  onLeave: () => void;
  /**
   * Drawn over the battlefield in place of the skirmish end card: once `s.mission.result` is set
   * (`endWhen: 'mission'`, the default), or once `s.winner` is set (`'winner'`, a planet battle).
   */
  renderEnd: (s: GameState) => ReactNode;
  endWhen?: 'mission' | 'winner';
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
  if (!renderer.current) renderer.current = new Renderer(initial.tiles, undefined, initial.mapW, initial.mapH);
  // Open on the Command Yard; in a mission with no base, on the middle of our units.
  const hq = initial.buildings.find(b => b.owner === 0 && b.kind === 'hq');
  const ours = initial.units.filter(u => u.owner === 0);
  const opening = hq
    ? { x: hq.x, y: hq.y }
    : ours.length
      ? { x: ours.reduce((a, u) => a + u.x, 0) / ours.length - 1, y: ours.reduce((a, u) => a + u.y, 0) / ours.length - 1 }
      : null;
  const cam = useRef<Camera>({ x: opening ? opening.x * TILE - 300 : 0, y: opening ? opening.y * TILE - 260 : 0, zoom: 1, w: 800, h: 600 });
  const overlay = useRef<Overlay>({ selected: new Set(), hover: 0, placement: null, drag: null, pings: [] });
  const keys = useRef(new Set<string>());
  const mouse = useRef({ x: -1, y: -1, inside: false, downX: 0, downY: 0, down: false, pan: false, panX: 0, panY: 0, camX: 0, camY: 0, lastClick: 0 });
  const groups = useRef(new Map<string, number[]>());
  // Fingers on the battlefield, by pointer id, and the gesture they are making. One finger pans
  // (or draws a box in box mode), two pinch to zoom, and a finger lifted without moving is a tap.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    kind: 'none' as 'none' | 'tap' | 'pan' | 'box' | 'pinch',
    x0: 0,
    y0: 0,
    camX: 0,
    camY: 0,
    zoom: 1,
    dist: 0,
    midX: 0,
    midY: 0,
    lastTap: 0,
    lastTapId: 0,
    /** When a finger last touched the map. Browsers follow a tap with a made-up mouse move. */
    lastTouch: -Infinity,
  });
  const layout = useLayout();
  const opened = useRef(false);
  const [menu, setMenu] = useState(false);
  const [boxMode, setBoxMode] = useState(false);
  const boxRef = useRef(boxMode);
  boxRef.current = boxMode;
  /** A building-target ability ordered out of range: the hero walks there and uses it on arrival. */
  const pendingAbility = useRef<{ heroId: number; target: number; since: number } | null>(null);
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
  // The build window (BuildWindow.tsx): open or not, and whether placing a structure closed it, so
  // it comes back on the same tab once the structure is placed or placement is cancelled.
  const [buildOpen, setBuildOpenState] = useState(false);
  const buildOpenRef = useRef(false);
  const reopenAfterPlacing = useRef(false);
  const [help, setHelp] = useState(false);
  // Campaign: a hero ability or support power waiting for its click on the map.
  const [targeting, setTargetingState] = useState<Targeting>(null);
  const targetingRef = useRef<Targeting>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const zoneRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Missiles in flight, by projectile id: a ring on each target, moved with the view every frame.
  const missileRefs = useRef(new Map<number, HTMLDivElement>());
  // Heroes fielded in this mission, kept after they fall so the bar can say so.
  const fielded = useRef(new Set<HeroKind>());
  if (!fielded.current.size) for (const u of initial.units) if (u.owner === 0 && u.hero) fielded.current.add(u.kind as HeroKind);
  // The guided run opens by itself on a fresh battle for anyone who has not finished or skipped it
  // in this browser; the Tour button reopens it at any time. Bumping `tourRun` remounts it, so a
  // reopened run always starts on the welcome card.
  // The tour teaches a skirmish base; a campaign battle never opens it.
  const [tourOpen, setTourOpen] = useState(() => !initial.mission && !initial.planet && !hasSeenGuidedTour() && initial.tick < 600 && initial.winner === null);
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
  pausedRef.current = paused || help || menu;
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

  /** Open or close the build window. Closing hands focus back to the Build button unless told not to. */
  const setBuildOpen = useCallback((open: boolean, refocus = true) => {
    if (buildOpenRef.current === open) return;
    buildOpenRef.current = open;
    setBuildOpenState(open);
    if (!open && refocus) window.setTimeout(() => document.getElementById('fl-build-open')?.focus({ preventScroll: true }), 0);
  }, []);

  /** The Build button and the backquote key. Opening while placing puts the structure back to Ready. */
  const toggleBuild = useCallback(() => {
    reopenAfterPlacing.current = false;
    if (!buildOpenRef.current && placingRef.current) setPlacing(null);
    setBuildOpen(!buildOpenRef.current);
  }, [setBuildOpen, setPlacing]);

  // Placing a structure closes the window, so the placement cursor is never under it; it comes back
  // on the same tab when the structure is placed or placement is cancelled.
  useEffect(() => {
    if (placing) {
      if (buildOpenRef.current) {
        reopenAfterPlacing.current = true;
        setBuildOpen(false, false);
      }
    } else if (reopenAfterPlacing.current) {
      reopenAfterPlacing.current = false;
      setBuildOpen(true);
    }
  }, [placing, setBuildOpen]);

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
          else if (a.category === 'air' && airRoom(s, 0) <= 0) showToast('Every Helipad is full: build another');
          else if (s.players[0].credits < costOf(a.kind)) showToast('Insufficient funds');
        }
        if (a.type === 'research') {
          sound.play('denied');
          const why = researchProblem(cur.current, 0, a.upgrade);
          if (why === 'Not enough credits') showToast('Insufficient funds');
          else if (why) showToast(why);
        }
        return false;
      }
      cur.current = next;
      if (a.type === 'queue' || a.type === 'cancel' || a.type === 'research' || a.type === 'cancelResearch') sound.play('queue');
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
      if (u.owner !== 0 && !vis[Math.floor(u.y) * s.mapW + Math.floor(u.x)]) continue;
      const r = UNITS[u.kind].category === 'infantry' ? 0.35 : 0.55;
      // Aircraft are drawn lifted above their shadow: pick them where they are drawn.
      const d = Math.hypot(u.x - wx, u.y - (UNITS[u.kind].category === 'air' ? AIR_LIFT : 0) - wy);
      if (d < r && d < bestD) {
        bestD = d;
        best = u.id;
      }
    }
    if (best) return best;
    for (const b of s.buildings) {
      const spec = BUILDINGS[b.kind];
      if (wx >= b.x && wx < b.x + spec.w && wy >= b.y && wy < b.y + spec.h) {
        if (b.owner !== 0 && s.explored.charCodeAt(b.y * s.mapW + b.x) !== 49) continue;
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
    clampCam(c, cur.current);
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
    if (problem === 'Move closer first') {
      // Walk there and use it on arrival (checked every tick in the loop below).
      const spec = BUILDINGS[b.kind];
      if (dispatch({ type: 'move', ids: [t.heroId], x: b.x + spec.w / 2, y: b.y + spec.h / 2 })) {
        pendingAbility.current = { heroId: t.heroId, target: b.id, since: s.tick };
        showToast('Moving into position');
        overlay.current.pings.push({ x: wx, y: wy, at: now, kind: 'attack' });
        setTargeting(null);
        return;
      }
    }
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
      // Infantry on one of our own Troop Carriers: they walk to it and climb in; anything else moves there.
      if (targetUnit && targetUnit.owner === 0 && UNITS[targetUnit.kind].carries) {
        const riders = mine.filter(u => canRide(u, targetUnit)).map(u => u.id);
        if (riders.length) {
          const rest = mine.filter(u => !canRide(u, targetUnit) && u.id !== targetUnit.id).map(u => u.id);
          if (dispatch({ type: 'board', ids: riders, carrier: targetUnit.id })) ov.pings.push({ x: wx, y: wy, at: now, kind: 'move' });
          else showToast(boardProblem(s, 0, riders, targetUnit.id) ?? 'Cannot board');
          if (rest.length) dispatch({ type: 'move', ids: rest, x: wx, y: wy, queue });
          return;
        }
      }
      const haulerIds = mine.filter(u => u.kind === 'hauler').map(u => u.id);
      const others = mine.filter(u => u.kind !== 'hauler').map(u => u.id);
      if (haulerIds.length && targetBuilding && targetBuilding.kind === 'refinery') {
        dispatch({ type: 'harvest', ids: haulerIds, refinery: targetBuilding.id });
        if (others.length) dispatch({ type: 'move', ids: others, x: wx, y: wy, attackMove: forceAttackMove });
        ov.pings.push({ x: wx, y: wy, at: now, kind: 'move' });
        return;
      }
      const tile = Math.floor(wy) * s.mapW + Math.floor(wx);
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

  // ---- Selecting ---------------------------------------------------------------------------
  /** Select own units inside a screen-space box. */
  const selectInBox = (d: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) => {
    const ov = overlay.current;
    const s = cur.current;
    const a = toWorld(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1));
    const b = toWorld(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
    const inBox = s.units.filter(u => u.owner === 0 && u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y);
    // A box with fighting units in it leaves the haulers out, the way you almost always want.
    const fighters = inBox.filter(u => u.kind !== 'hauler');
    const chosen = fighters.length ? fighters : inBox;
    if (additive) chosen.forEach(u => ov.selected.add(u.id));
    else ov.selected = new Set(chosen.map(u => u.id));
    if (chosen.length) sound.play('select');
    refresh();
  };

  /** Every own unit of one kind inside the view. */
  const selectKindOnScreen = (kind: string) => {
    const c = cam.current;
    const x0 = c.x / TILE;
    const y0 = c.y / TILE;
    const x1 = x0 + c.w / c.zoom / TILE;
    const y1 = y0 + c.h / c.zoom / TILE;
    overlay.current.selected = new Set(
      cur.current.units.filter(u => u.owner === 0 && u.kind === kind && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1).map(u => u.id),
    );
  };

  /** Select one thing; a producer opens its own build list. */
  const selectOne = (id: number) => {
    overlay.current.selected = new Set([id]);
    const b = cur.current.buildings.find(x => x.id === id);
    if (b && b.owner === 0) {
      if (b.kind === 'barracks') setTab('infantry');
      if (b.kind === 'factory') setTab('vehicle');
      if (b.kind === 'helipad') setTab('air');
      if (b.kind === 'shipyard') setTab('naval');
      if (b.kind === 'hq') setTab('building');
    }
    sound.play('select');
  };

  /** Every fighting unit you own: the touch stand-in for a box drawn round the whole army. */
  const selectArmy = () => {
    const ids = cur.current.units.filter(u => u.owner === 0 && u.kind !== 'hauler').map(u => u.id);
    overlay.current.selected = new Set(ids);
    if (ids.length) sound.play('select');
    refresh();
  };

  const goHome = () => {
    const yard = cur.current.buildings.find(b => b.owner === 0 && b.kind === 'hq') ?? cur.current.buildings.find(b => b.owner === 0);
    if (yard) centreOn(yard.x + 1.5, yard.y + 1.5);
  };

  /**
   * A finger lifted without moving. A touch screen has no right button, so a tap does what the
   * situation calls for: with your units selected, a tap on open ground, ore, a refinery or an
   * enemy is an order; a tap on one of your own units or structures selects it instead.
   */
  const tap = (sx: number, sy: number) => {
    const s = cur.current;
    const ov = overlay.current;
    const w = toWorld(sx, sy);
    if (targetingRef.current) {
      fireTargeting(w.x, w.y);
      return;
    }
    if (placingRef.current) {
      updatePlacement(sx, sy);
      const p = ov.placement;
      if (p && p.ok && dispatch({ type: 'place', kind: p.kind, x: p.tx, y: p.ty })) setPlacing(null);
      else sound.play('denied');
      refresh();
      return;
    }
    if (attackRef.current) {
      command(w.x, w.y, true);
      setAttackMode(false);
      return;
    }
    const id = pick(w.x, w.y);
    const now = performance.now();
    const g = gesture.current;
    const double = id !== 0 && id === g.lastTapId && now - g.lastTap < 350;
    g.lastTap = now;
    g.lastTapId = id;
    const unit = s.units.find(u => u.id === id);
    const building = s.buildings.find(b => b.id === id);
    const mine = ownSelectedUnits();
    const selectedBuilding = s.buildings.find(b => ov.selected.has(b.id) && b.owner === 0);
    if (unit && unit.owner === 0) {
      if (double) selectKindOnScreen(unit.kind);
      else selectOne(id);
    } else if (building && building.owner === 0) {
      // Haulers selected and a refinery tapped: send them to unload there.
      if (building.kind === 'refinery' && mine.some(u => u.kind === 'hauler')) command(w.x, w.y, false);
      else selectOne(id);
    } else if (id) {
      // An enemy: attack it with what is selected, or look at it when nothing of yours is.
      if (mine.length) command(w.x, w.y, false);
      else selectOne(id);
    } else if (mine.length) {
      command(w.x, w.y, false);
    } else if (selectedBuilding && (selectedBuilding.kind === 'barracks' || selectedBuilding.kind === 'factory')) {
      command(w.x, w.y, false);
    } else {
      ov.selected = new Set();
    }
    refresh();
  };

  // ---- Pointer input on the battlefield -----------------------------------------------------
  const pinchOf = () => {
    const [p, q] = [...touches.current.values()];
    return { dist: Math.max(1, Math.hypot(p.x - q.x, p.y - q.y)), midX: (p.x + q.x) / 2, midY: (p.y + q.y) / 2 };
  };

  const touchDown = (e: React.PointerEvent<HTMLCanvasElement>, sx: number, sy: number) => {
    touches.current.set(e.pointerId, { x: sx, y: sy });
    const g = gesture.current;
    const c = cam.current;
    mouse.current.inside = false;
    if (touches.current.size === 2) {
      Object.assign(g, { kind: 'pinch', zoom: c.zoom, camX: c.x, camY: c.y, ...pinchOf() });
      overlay.current.drag = null;
    } else if (touches.current.size === 1) {
      Object.assign(g, { kind: 'tap', x0: sx, y0: sy, camX: c.x, camY: c.y });
    }
  };

  const touchMove = (e: React.PointerEvent<HTMLCanvasElement>, sx: number, sy: number) => {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: sx, y: sy });
    const g = gesture.current;
    const c = cam.current;
    if (g.kind === 'pinch' && touches.current.size >= 2) {
      const p = pinchOf();
      // Keep the map point under the first midpoint under the fingers as they move and spread.
      const wx = g.camX + g.midX / g.zoom;
      const wy = g.camY + g.midY / g.zoom;
      c.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (g.zoom * p.dist) / g.dist));
      c.x = wx - p.midX / c.zoom;
      c.y = wy - p.midY / c.zoom;
      clampCam(c, cur.current);
      return;
    }
    if (g.kind === 'tap' && Math.hypot(sx - g.x0, sy - g.y0) > TAP_SLOP) g.kind = boxRef.current ? 'box' : 'pan';
    if (g.kind === 'pan') {
      c.x = g.camX - (sx - g.x0) / c.zoom;
      c.y = g.camY - (sy - g.y0) / c.zoom;
      clampCam(c, cur.current);
    } else if (g.kind === 'box') {
      overlay.current.drag = { x0: g.x0, y0: g.y0, x1: sx, y1: sy };
    }
  };

  const touchUp = (e: React.PointerEvent<HTMLCanvasElement>, sx: number, sy: number) => {
    if (!touches.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g.kind === 'pinch') {
      // The pinch is over only when both fingers are up; the second one lifting is not a tap.
      if (touches.current.size === 0) g.kind = 'none';
      return;
    }
    if (touches.current.size) return;
    const kind = g.kind;
    g.kind = 'none';
    if (e.type === 'pointercancel') {
      overlay.current.drag = null;
      return;
    }
    if (kind === 'box' && overlay.current.drag) {
      const d = overlay.current.drag;
      overlay.current.drag = null;
      selectInBox(d, false);
      setBoxMode(false);
    } else if (kind === 'tap') {
      tap(sx, sy);
    }
  };

  const local = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  /** A mouse event that is really the browser echoing a recent touch, not a mouse. */
  const echo = (e: React.PointerEvent<HTMLCanvasElement>) => e.pointerType !== 'touch' && performance.now() - gesture.current.lastTouch < 1000;

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = local(e);
    const m = mouse.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      gesture.current.lastTouch = performance.now();
      touchDown(e, sx, sy);
      return;
    }
    if (echo(e)) return;
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
    const { sx, sy } = local(e);
    if (e.pointerType === 'touch') {
      gesture.current.lastTouch = performance.now();
      touchMove(e, sx, sy);
      return;
    }
    // Without this, the echo of a tap near the edge of the map would start edge-scrolling and
    // carry the view away from the base with nobody touching anything.
    if (echo(e)) return;
    const m = mouse.current;
    m.x = sx;
    m.y = sy;
    m.inside = true;
    if (m.pan) {
      cam.current.x = m.camX - (sx - m.panX) / cam.current.zoom;
      cam.current.y = m.camY - (sy - m.panY) / cam.current.zoom;
      clampCam(cam.current, cur.current);
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
    const { sx, sy } = local(e);
    if (e.pointerType === 'touch') {
      gesture.current.lastTouch = performance.now();
      touchUp(e, sx, sy);
      return;
    }
    if (echo(e)) return;
    const m = mouse.current;
    if (m.pan) {
      m.pan = false;
      return;
    }
    if (!m.down || e.button !== 0) return;
    m.down = false;
    const ov = overlay.current;
    const s = cur.current;
    if (ov.drag) {
      const d = ov.drag;
      ov.drag = null;
      selectInBox(d, e.shiftKey);
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
      selectKindOnScreen(unit.kind);
    } else if (unit && unit.owner === 0 && e.shiftKey) {
      if (ov.selected.has(id)) ov.selected.delete(id);
      else ov.selected.add(id);
    } else if (id) {
      selectOne(id);
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
    c.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    c.x = before.x - sx / c.zoom;
    c.y = before.y - sy / c.zoom;
    clampCam(c, cur.current);
  };

  // ---- Keyboard -----------------------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      keys.current.add(e.key);
      const ov = overlay.current;
      const k = e.key.toLowerCase();
      if (e.code === 'Backquote' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // ` opens and closes the build window.
        e.preventDefault();
        toggleBuild();
        return;
      }
      const buildIndex = (BUILD_KEYS as readonly string[]).indexOf(k);
      if (buildIndex >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Q W E R T Y (then U I J K L B N D): the open list's items in order; Shift queues five units.
        const kind = menuFor(tabRef.current, cur.current)[buildIndex];
        if (kind) pressBuild(cur.current, tabRef.current, kind, placingRef.current, dispatch, choosePlacing, e.shiftKey);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const order = tabsFor(cur.current);
        const i = Math.max(0, order.indexOf(tabRef.current));
        setTab(order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]);
        return;
      }
      const heroKey = (HERO_KEYS as readonly string[]).indexOf(k);
      if ((cur.current.mission || cur.current.planet) && heroKey >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Z X C V: heroes 1 to 4 in bar order; twice to jump to the hero.
        const kind = heroOrder()[heroKey];
        if (kind) selectHero(kind);
        return;
      }
      if ((cur.current.mission || cur.current.planet) && k === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // F: the selected hero's ability.
        const u = cur.current.units.find(x => x.owner === 0 && x.hero && ov.selected.has(x.id));
        if (u) triggerAbility(u.kind as HeroKind);
        return;
      }
      if (!cur.current.mission && k === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // F in a skirmish: the selection's first command that can go (selectionActions.ts), if any.
        const st = cur.current;
        const units = st.units.filter(x => x.owner === 0 && ov.selected.has(x.id));
        const building = units.length ? null : (st.buildings.find(x => x.owner === 0 && ov.selected.has(x.id)) ?? null);
        const go = selectionActions(st, { units, building }).find(x => !x.problem);
        if (go) dispatch(go.action);
        return;
      }
      if (e.key === 'Escape') {
        // The controls sheet hides the build window, so it goes first; then the window, then the rest.
        if (help) setHelp(false);
        else if (buildOpenRef.current) {
          reopenAfterPlacing.current = false;
          setBuildOpen(false);
        } else if (targetingRef.current) setTargeting(null);
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
        goHome();
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
  }, [dispatch, refresh, setPlacing, centreOn, help, changeSound, choosePlacing, jumpToAlert, selectHero, triggerAbility, setTargeting, toggleBuild, setBuildOpen]);

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
        // A phone's view is too small for the fixed opening offset to show the base: on a narrow
        // battlefield, open centred on the Command Yard instead, once its real size is known.
        if (!opened.current && w > 0) {
          opened.current = true;
          if (w < 700 && hq) centreOn(hq.x + 1.5, hq.y + 1.5);
        }
        clampCam(c, cur.current);

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
          clampCam(c, cur.current);
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
        if (missileRefs.current.size) {
          for (const [id, el] of missileRefs.current) {
            const p = cur.current.projectiles.find(x => x.id === id);
            if (!p) continue;
            const d = POWERS.missile.radius * 2 * TILE * c.zoom;
            el.style.width = el.style.height = `${d}px`;
            el.style.transform = `translate(${(p.toX * TILE - c.x) * c.zoom - d / 2}px, ${(p.toY * TILE - c.y) * c.zoom - d / 2}px)`;
          }
        }
        if (targetingRef.current?.kind === 'power') placeRing(m.x, m.y);
        if (cur.current.tick !== lastTick) {
          const pa = pendingAbility.current;
          if (pa) {
            const st = cur.current;
            const hero = st.units.find(u => u.id === pa.heroId);
            const target = st.buildings.find(b => b.id === pa.target);
            const walking = hero && (hero.order.type === 'move' || hero.order.type === 'idle');
            if (!hero || !target || target.owner === 0 || !walking || st.tick - pa.since > 600) pendingAbility.current = null;
            else {
              const why = abilityProblem(st, 0, pa.heroId, pa.target);
              if (!why) {
                pendingAbility.current = null;
                dispatch({ type: 'ability', id: pa.heroId, target: pa.target });
              } else if (why !== 'Move closer first') {
                pendingAbility.current = null;
                showToast(why);
              }
            }
          }
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
            if (/under attack|missile launch/i.test(l.text)) sound.play('alarm');
            else if (/ ready/i.test(l.text)) sound.play('ready');
          }
          if (log.length) heardLog = log[log.length - 1];
          const result = cur.current.mission?.result;
          if ((cur.current.winner !== null || result) && !heardWinner) {
            heardWinner = true;
            sound.play((result ? result === 'won' : wonBy(cur.current, 0)) ? 'victory' : 'defeat');
          }
          if (cur.current.winner !== null || result) doSave();
          refresh();
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [doSave, refresh, setPlacing, updatePlacement, centreOn]);

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
  const big = layout.touch ? touchBtn : null;
  const verb = layout.touch ? 'tap' : 'click';
  const stopHint = layout.touch ? 'Tap the button below to stop.' : 'Right-click or Esc to stop.';
  const saveStatus = (
    <span
      className="fl-d-save"
      data-state={saveError ? 'error' : lastSaved ? 'saved' : 'idle'}
      title={saveError ?? (lastSaved ? `Saved ${cloud ? 'to your account' : 'in this browser'}. Saves every 15 seconds.` : 'Saves every 15 seconds')}
    >
      <span className="fl-d-led" aria-hidden="true" />
      {saveError ? 'Not saving' : lastSaved ? 'Saved' : 'Autosave'}
    </span>
  );
  const speedButtons = (
    <div className="fl-d-seg" role="group" aria-label="Game speed">
      {SPEEDS.map(sp => (
        <button key={sp.label} type="button" className="fl-d-btn" style={big ?? undefined} aria-pressed={speed === sp.value} onClick={() => setSpeed(sp.value)}>
          {sp.label}
        </button>
      ))}
    </div>
  );
  const pauseButton = (
    <button
      type="button"
      className="fl-d-btn fl-d-pause"
      data-paused={paused ? '1' : '0'}
      style={big ?? undefined}
      onClick={() => setPaused(p => !p)}
      data-testid="pause"
      title={paused ? 'Resume (P)' : 'Pause (P)'}
    >
      <span className="fl-d-glyph" data-glyph={paused ? 'play' : 'pause'} aria-hidden="true" />
      {paused ? 'Resume' : 'Pause'}
    </button>
  );
  const soundControls = (
    <div className="fl-d-sound">
      <button
        type="button"
        className="fl-d-btn"
        style={big ? { ...big, minWidth: 82 } : { minWidth: 82 }}
        data-testid="sound-button"
        aria-pressed={!soundPrefs.muted}
        title="Sound on or off (M)"
        onClick={() => changeSound({ muted: !soundPrefs.muted })}
      >
        <span className="fl-d-glyph" data-glyph={soundPrefs.muted ? 'mute' : 'sound'} aria-hidden="true" />
        {soundPrefs.muted ? 'Sound off' : 'Sound on'}
      </button>
      <input
        type="range"
        className="fl-d-range"
        min={0}
        max={1}
        step={0.05}
        value={soundPrefs.volume}
        aria-label="Volume"
        disabled={soundPrefs.muted}
        onChange={e => changeSound({ volume: Number(e.target.value) })}
        style={layout.compact ? { width: 110 } : undefined}
      />
    </div>
  );
  // The tour teaches a skirmish base; a campaign or planet battle has no Tour button.
  const tourButton = mission || s.planet ? null : (
    <button
      type="button"
      className="fl-d-btn"
      style={big ?? undefined}
      data-testid="tour-button"
      title="Replay the guided first battle"
      onClick={() => {
        setMenu(false);
        setTourRun(n => n + 1);
        setTourOpen(true);
      }}
    >
      Tour
    </button>
  );
  // The portal's own toggles, fitted into the console: same height and face as its buttons.
  const viewBtn: CSSProperties = { height: 26, padding: '0 7px', border: '1px solid transparent', background: 'transparent', color: UI.textSoft, fontSize: '0.72rem', borderRadius: 3 };
  const ownSelected = s.units.some(u => u.owner === 0 && overlay.current.selected.has(u.id));
  const modal = !!(placing || targeting);
  // Phones and touch screens get the build window as a full-screen sheet.
  const sheet = layout.touch || layout.stacked;
  // On a touch screen the command bar takes the foot of the map; the campaign's hero and power
  // bar and the battle feed sit above it.
  const barLift = layout.touch && !ended ? 56 : 0;
  const zones = mission ? missionZones(s) : [];
  const missiles = s.projectiles.filter(p => p.weapon === 'missile');
  const incoming = ended ? null : missiles.filter(p => isEnemy(s, 0, p.owner)).sort((a, b) => a.hitAt - b.hitAt)[0] ?? null;
  const skirmishPowers = !mission && !s.planet && !ended && !!s.powers && s.setup?.tech === 'advanced';
  // A planet battle: the heroes brought and every power held (perk powers and those of standing structures).
  const planetBar = !!s.planet && !ended;
  const leave = () => {
    doSave();
    if (campaign) campaign.onLeave();
    else navigate('/');
  };

  return (
    <div style={shell} className="fl-shell">
      <header className="fl-d-top" data-compact={layout.compact ? '1' : '0'}>
        <button type="button" className="fl-d-btn fl-d-back" style={big ?? undefined} onClick={leave} data-testid="leave">
          <span aria-hidden="true">←</span> {campaign ? campaign.leaveLabel : 'Lobby'}
        </button>
        {!layout.stacked && (
          <div className="fl-d-ident">
            <span className="fl-d-mark">FIRELINE</span>
            {!layout.compact && (
              <span className="fl-d-op" title={`${s.name} · ${DIFFICULTIES[s.difficulty].label}`}>
                {s.name} · {DIFFICULTIES[s.difficulty].label}
              </span>
            )}
          </div>
        )}
        <span className="fl-d-clock" title="Battle time">
          <span className="fl-d-clock-label" aria-hidden="true">
            T+
          </span>
          <span data-testid="clock">{clock}</span>
        </span>
        {!layout.stacked && <SideNames state={s} />}
        <span style={{ flex: 1 }} />
        {layout.compact ? (
          <>
            {saveError && <span className="fl-d-save" data-state="error">Not saving</span>}
            {pauseButton}
            <button type="button" className="fl-d-btn" style={big ?? undefined} aria-expanded={menu} aria-haspopup="dialog" data-testid="menu-button" onClick={() => setMenu(m => !m)}>
              Menu
            </button>
          </>
        ) : (
          <>
            {saveStatus}
            <div className="fl-d-group" role="group" aria-label="Battle clock">
              <span className="fl-d-group-label" aria-hidden="true">Speed</span>
              {speedButtons}
              {pauseButton}
            </div>
            <div className="fl-d-group" role="group" aria-label="Sound">
              {soundControls}
            </div>
            <div className="fl-d-group" role="group" aria-label="Help">
              {tourButton}
              <button type="button" className="fl-d-btn fl-d-help" onClick={() => setHelp(true)} aria-label="Controls" title="Controls">
                ?
              </button>
            </div>
            <div className="fl-d-group fl-d-view" role="group" aria-label="Display">
              <MotionToggle style={viewBtn} />
              <ThemeToggle style={viewBtn} />
              <FullscreenToggle style={viewBtn} />
            </div>
          </>
        )}
      </header>

      {menu && layout.compact && (
        <div style={menuScrim} onClick={() => setMenu(false)}>
          <div role="dialog" aria-label="Battle menu" style={menuSheet} onClick={e => e.stopPropagation()} data-testid="menu">
            <div style={{ fontSize: '0.85rem', color: UI.textSoft }}>
              {s.name} · {DIFFICULTIES[s.difficulty].label}
            </div>
            <SideNames state={s} />
            {saveStatus}
            <div style={menuRow}>
              <span style={menuLabel}>Speed</span>
              {speedButtons}
            </div>
            <div style={menuRow}>
              <span style={menuLabel}>Sound</span>
              {soundControls}
            </div>
            <div style={menuRow}>
              <span style={menuLabel}>Display</span>
              <ThemeToggle style={{ padding: '6px 10px' }} />
              <MotionToggle style={{ padding: '6px 10px' }} />
              <FullscreenToggle style={{ padding: '6px 10px' }} />
            </div>
            <div style={{ ...menuRow, justifyContent: 'flex-end' }}>
              {tourButton}
              <button
                type="button"
                className="fl-d-btn"
                style={touchBtn}
                onClick={() => {
                  setMenu(false);
                  setHelp(true);
                }}
              >
                Controls
              </button>
              <button type="button" className="fl-d-btn fl-d-primary" style={touchBtn} onClick={() => setMenu(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {saveError && <div style={errorStrip}>{saveError}</div>}

      <div style={{ ...body, flexDirection: layout.stacked ? 'column' : 'row', flexWrap: 'nowrap' }}>
        <div ref={wrapRef} style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: layout.stacked ? 180 : 0, overflow: 'hidden', background: '#050707' }}>
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
            onPointerCancel={onPointerUp}
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
          {missiles.map(p => (
            <div
              key={p.id}
              ref={el => {
                if (el) missileRefs.current.set(p.id, el);
                else missileRefs.current.delete(p.id);
              }}
              className="fl-missile-mark"
              data-owner={p.owner}
              data-testid="missile-mark"
              aria-hidden="true"
            >
              <span>{Math.max(0, Math.ceil((p.hitAt - s.tick) / TICKS_PER_SECOND))}</span>
            </div>
          ))}
          <div ref={ringRef} className="fl-target-ring" aria-hidden="true" />
          <div className="fl-banners">
            {(placing || attackMode || targeting) && (
              <div className="fl-hint" data-testid="hint">
                {placing
                  ? `Place the ${BUILDINGS[placing].name}: ${verb} open ground near your base. ${layout.touch ? 'Drag to look around.' : stopHint}`
                  : targeting?.kind === 'ability'
                    ? `${HERO_ABILITY[targeting.hero].name}: ${verb} an enemy structure for ${heroName(targeting.hero)}. ${stopHint}`
                    : targeting?.kind === 'power'
                      ? `${POWERS[targeting.power].name}: ${verb} the map to call it in. ${stopHint}`
                      : `Attack-move: ${verb} where to go. Units fight anything they meet on the way.`}
              </div>
            )}
            {incoming && (
              <button
                type="button"
                className="fl-missile-warn"
                role="alert"
                data-testid="missile-warning"
                onClick={() => centreOn(incoming.toX, incoming.toY)}
                title="Jump to the target"
              >
                <strong>Enemy missile incoming</strong>
                <span>Impact in {Math.max(0, Math.ceil((incoming.hitAt - s.tick) / TICKS_PER_SECOND))}s. Move everything out of the red ring.</span>
              </button>
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
          {layout.touch && !ended && (
            // While placing or aiming, the one button goes to the corner: centred, it sat under the
            // ground near the base, and a phone's tap adjustment snapped taps meant for the map onto it.
            <div style={modal ? { ...commandBar, left: 'auto' } : commandBar} data-testid="command-bar">
              {modal ? (
                <button
                  style={barBtn(false)}
                  onClick={() => {
                    setPlacing(null);
                    setTargeting(null);
                  }}
                >
                  {placing ? 'Stop placing' : 'Cancel'}
                </button>
              ) : (
                <>
                  <button
                    style={barBtn(boxMode)}
                    aria-pressed={boxMode}
                    data-testid="box-mode"
                    title="Then drag on the map to select the units inside the box"
                    onClick={() => setBoxMode(b => !b)}
                  >
                    Box
                  </button>
                  <button style={barBtn(false)} id="fl-select-army" data-testid="select-army" onClick={selectArmy}>
                    Army
                  </button>
                  <button
                    style={barBtn(attackMode)}
                    aria-pressed={attackMode}
                    data-testid="attack-move"
                    title="Attack-move: then tap where to go, and they fight anything met on the way"
                    disabled={!ownSelected}
                    onClick={() => setAttackMode(a => !a)}
                  >
                    Attack
                  </button>
                  <button
                    style={barBtn(false)}
                    disabled={!ownSelected}
                    onClick={() => {
                      const ids = ownSelectedUnits().map(u => u.id);
                      if (ids.length) dispatch({ type: 'stop', ids });
                    }}
                  >
                    Stop
                  </button>
                  <button
                    style={barBtn(false)}
                    disabled={overlay.current.selected.size === 0}
                    onClick={() => {
                      overlay.current.selected = new Set();
                      setAttackMode(false);
                      refresh();
                    }}
                  >
                    Clear
                  </button>
                  <button style={barBtn(false)} onClick={goHome}>
                    Base
                  </button>
                </>
              )}
            </div>
          )}
          <div
            className="fl-d-feed"
            style={{ bottom: ((mission && !ended) || skirmishPowers || planetBar ? 80 : 10) + barLift, maxWidth: layout.stacked ? '90%' : 'min(60%, 520px)' }}
            aria-live="polite"
          >
            {(layout.stacked ? recent.slice(0, 3) : recent).map(l => (
              <div key={`${l.tick}-${l.text}`} data-tone={l.tone ?? 'info'} style={{ opacity: Math.max(0.3, 1 - (s.tick - l.tick) / 300) }}>
                {l.text}
              </div>
            ))}
          </div>
          {mission && !ended && <ObjectivesPanel s={s} onLocate={centreOn} />}
          {mission && !ended && (
            <div className="fl-cbar" style={barLift ? { bottom: 10 + barLift } : undefined}>
              <HeroBar s={s} heroes={heroOrder()} selected={overlay.current.selected} targeting={targeting} onSelect={selectHero} onAbility={triggerAbility} />
              <PowerBar s={s} targeting={targeting} onPower={choosePower} />
            </div>
          )}
          {planetBar && (
            <div className="fl-cbar" style={barLift ? { bottom: 10 + barLift } : undefined}>
              <HeroBar s={s} heroes={heroOrder()} selected={overlay.current.selected} targeting={targeting} onSelect={selectHero} onAbility={triggerAbility} />
              <PowerBar s={s} targeting={targeting} onPower={choosePower} />
            </div>
          )}
          {skirmishPowers && (
            <div className="fl-cbar" style={barLift ? { bottom: 10 + barLift } : undefined}>
              <SkirmishPowerBar s={s} targeting={targeting} onPower={choosePower} />
            </div>
          )}
          {buildOpen && !paused && !help && !ended && (
            <BuildWindow
              state={s}
              tab={tab}
              setTab={setTab}
              dispatch={dispatch}
              placing={placing}
              setPlacing={choosePlacing}
              touch={layout.touch}
              sheet={sheet}
              onClose={() => {
                reopenAfterPlacing.current = false;
                setBuildOpen(false);
              }}
            />
          )}
          {paused && !help && !ended && (
            <div style={scrim}>
              <div className="fl-d-card fl-d-paused" role="dialog" aria-label="Paused">
                <span className="fl-d-glyph fl-d-paused-glyph" data-glyph="pause" aria-hidden="true" />
                <h2 className="fl-d-card-title">Paused</h2>
                <p className="fl-d-card-sub">The battle is holding. Your progress has been saved.</p>
                <button type="button" className="fl-d-btn fl-d-primary" onClick={() => setPaused(false)}>
                  Resume <kbd>P</kbd>
                </button>
              </div>
            </div>
          )}
          {help && (
            <div style={scrim} onClick={() => setHelp(false)}>
              <div className="fl-d-card fl-d-help-card fl-scroll" role="dialog" aria-label="Controls" onClick={e => e.stopPropagation()}>
                <header className="fl-d-card-head">
                  <h2 className="fl-d-card-title">Controls</h2>
                  <button type="button" className="fl-d-btn" onClick={() => setHelp(false)}>
                    Close
                  </button>
                </header>
                <Controls campaign={!!mission} touch={layout.touch} />
              </div>
            </div>
          )}
          {campaign?.endWhen === 'winner'
            ? s.winner !== null && campaign.renderEnd(s)
            : mission && campaign
              ? mission.result
                ? campaign.renderEnd(s)
                : null
              : s.winner !== null && <EndCard state={s} onLobby={() => navigate('/')} />}
        </div>

        {tourOpen && (
          <GuidedTour
            key={tourRun}
            view={{ s, selected: [...overlay.current.selected], placing, tab, touch: layout.touch, buildOpen: buildOpen && !paused && !help && !ended, sheet }}
            onFinish={() => setTourOpen(false)}
            hidden={paused || help || menu || ended}
          />
        )}

        <aside
          style={
            layout.stacked
              ? { ...sidebar, width: '100%', flex: '0 0 auto', maxHeight: '44%', borderLeft: 'none', borderTop: `1px solid ${UI.ruleStrong}` }
              : layout.short
                ? { ...sidebar, width: 228, flex: '0 0 228px', padding: 8 }
                : sidebar
          }
          className="fl-scroll fl-d-side"
          data-short={layout.short ? '1' : '0'}
        >
          {layout.stacked && overlay.current.selected.size > 0 && (
            <section className="fl-d-sel" aria-label="Selection">
              <h3 className="fl-d-sect">Selection</h3>
              <SelectionPanel state={s} selected={overlay.current.selected} dispatch={dispatch} touch={layout.touch} />
            </section>
          )}
          <BuildPanel
            compact={layout.stacked || layout.short}
            touch={layout.touch}
            state={s}
            tab={tabsFor(s).includes(tab) ? tab : 'building'}
            dispatch={dispatch}
            placing={placing}
            setPlacing={choosePlacing}
            buildOpen={buildOpen}
            onToggleBuild={toggleBuild}
            onOpenTab={t => {
              setTab(t);
              setBuildOpen(true);
            }}
            minimap={<Minimap state={s} vis={vis} online={uplinkOnline} cam={cam.current} onJump={centreOn} alerts={alerts.current} />}
          />
          {!(layout.stacked && overlay.current.selected.size > 0) && (
            <section className="fl-d-sel" aria-label="Selection">
              <h3 className="fl-d-sect">{overlay.current.selected.size > 0 ? 'Selection' : 'Orders'}</h3>
              <SelectionPanel state={s} selected={overlay.current.selected} dispatch={dispatch} touch={layout.touch} />
            </section>
          )}
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
    else if (sp.kind === 'escort') out.push({ x: sp.x, y: sp.y, r: sp.r, label: 'Convoy', done: o.done });
  }
  return out;
}

function clampCam(c: Camera, s: GameState) {
  const MAP_W = s.mapW;
  const MAP_H = s.mapH;
  const vw = c.w / c.zoom;
  const vh = c.h / c.zoom;
  // Room to scroll past the edge, so a structure in a corner can be brought out from under the
  // objectives panel, the hero bar or the alerts (a 64px margin left a corner uplink unclickable).
  const m = Math.max(64, Math.min(vw, vh) * 0.4);
  c.x = Math.max(-m, Math.min(MAP_W * TILE - vw + m, c.x));
  c.y = Math.max(-m, Math.min(MAP_H * TILE - vh + m, c.y));
  if (vw > MAP_W * TILE + 2 * m) c.x = (MAP_W * TILE - vw) / 2;
  if (vh > MAP_H * TILE + 2 * m) c.y = (MAP_H * TILE - vh) / 2;
}

/** The key table. Campaign keys are listed in a campaign battle and on How to play. */
export function Controls({ campaign = false, skirmish = !campaign, touch = false }: { campaign?: boolean; skirmish?: boolean; touch?: boolean }) {
  const mouseRows: [string, string][] = [
    ['Left-click / drag', 'Select a unit or structure; drag a box to select a group'],
    ['Double-click', 'Select every unit of that kind on screen'],
    ['Right-click', 'Move, attack, harvest, or set a rally point for a selected producer'],
    ['A then click', 'Attack-move: go there, fighting anything met on the way'],
    ['Shift + right-click', 'Queue another order after the current one (waypoints, up to 12)'],
    ['Stance buttons', 'Aggressive chases anything in sight; Guard (default) holds and returns fire; Hold fire never shoots unordered'],
    ['S', 'Stop'],
    ['Ctrl + 1–9', 'Make a group; press the number to select it, twice to jump to it'],
    ['` (backquote) or Build', 'Open or close the build window: every structure, unit and upgrade, laid out by what each needs'],
    ['Q W E R T Y', 'Build or train the first to sixth item in the list the Build button names, window open or closed (the letter is on each button)'],
    ['U I J K L B N D', 'With advanced tech: the seventh to fourteenth item in that list; any further items are clicked'],
    ['Shift + click or key', 'Queue five infantry or vehicles at once'],
    ['Tab', 'Next build list: Structures, Infantry, Vehicles, then Air and Research when you have them (Shift + Tab goes back)'],
    ['Production strip', 'Under the Build button: click an item to cancel the last one queued; click a ready structure to place it'],
    ['G', 'Toggle repair on the selected structure'],
    ['F', "Skirmish: the selection's own command when it has one, such as Deploy (the key shows on its button)"],
    ['Arrows / screen edge', 'Scroll; middle-drag to pan; wheel to zoom'],
    ['H', 'Jump to your Command Yard'],
    ['Space', 'Jump to the last combat alert (pinged on the minimap)'],
    ['P', 'Pause'],
    ['M', 'Sound on or off'],
    ['O', 'Hide or show the mission objectives (campaign)'],
    ['Esc', 'Close the build window; otherwise cancel placement, attack-move or aiming; clear selection'],
    ['Fullscreen button', 'Fill the whole screen with the battle; Esc leaves fullscreen'],
  ];
  const touchRows: [string, string][] = [
    ['Tap', 'Select one of your units or structures'],
    ['Tap with units selected', 'Move to open ground, attack an enemy, harvest ore, or unload at a refinery'],
    ['Double-tap a unit', 'Select every unit of that kind on screen'],
    ['Box, then drag', 'Select the units inside the box'],
    ['Army', 'Select every fighting unit you own'],
    ['Attack, then tap', 'Attack-move: go there, fighting anything met on the way'],
    ['Barracks or Factory, then tap', 'Set where new units gather'],
    ['Stance buttons', 'Aggressive chases anything in sight; Guard (default) holds and returns fire; Hold fire never shoots unordered'],
    ['Drag / pinch', 'Look around / zoom'],
    ['Minimap', 'Tap to jump there, once a Comms Uplink is powered'],
    ['Build', 'Open the build window; × at its top closes it'],
    ['Long press a build button', 'Its numbers: cost, health, weapon, what it needs'],
    ['× on a build button', 'Cancel it for a full refund'],
    ['Production strip', 'Under Build: tap an item to open its list, its × to cancel the last one queued, a ready structure to place it'],
    ['Base', 'Jump to your Command Yard'],
  ];
  const rows = touch ? touchRows : mouseRows;
  const campaignRows: [string, string][] = touch
    ? [
        ['Hero bar', 'Campaign: tap a hero to select it, twice to jump to it; tap its ability, then an enemy structure if it needs one'],
        ['Power button, then tap', 'Campaign: call a support power (Recon sweep, Artillery barrage, Reinforcements) on that spot'],
      ]
    : [
    ['Z X C V', 'Campaign: select hero 1 to 4 in the hero bar; twice to jump to it'],
    ['F', "Campaign: the selected hero's ability (Infiltrate, Demolition charge and Capture then want a click on an enemy structure)"],
    ['Power button, then click', 'Campaign: call a support power (Recon sweep, Artillery barrage, Reinforcements) on that spot'],
      ];
  const skirmishRows: [string, string][] = [
    [
      touch ? 'Skirmish power, then tap' : 'Skirmish power, then click',
      'Advanced tech: a Comms Uplink grants a Recon sweep, a Tech Centre an Artillery barrage, a Strike Command a Missile strike',
    ],
  ];
  return (
    <table className="fl-d-keys">
      <tbody>
        {[...rows, ...(campaign ? campaignRows : []), ...(skirmish ? skirmishRows : [])].map(([k, v], i) => (
          <tr key={`${i}-${k}`}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** True while a side still has a structure standing. */
const standingSide = (state: GameState, o: number) => state.buildings.some(b => b.owner === o && isStructure(b));

/**
 * The computer sides of a battle of three or four, each named in its colour, allies marked, and a
 * side that is out struck through. Nothing in a two-sided battle.
 */
function SideNames({ state }: { state: GameState }) {
  if (state.players.length <= 2) return null;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8, fontSize: '0.78rem' }} data-testid="side-names">
      {sidesOf(state)
        .filter(o => o !== 0)
        .map(o => {
          const out = !standingSide(state, o);
          return (
            <span
              key={o}
              style={{ color: UI.side[o], fontWeight: 600, whiteSpace: 'nowrap', textDecoration: out ? 'line-through' : undefined, opacity: out ? 0.6 : 1 }}
              title={`${state.players[o].name}: ${isAlly(state, 0, o) ? 'your ally' : 'enemy'}${out ? ', out of the battle' : ''}`}
            >
              {state.players[o].name}
              <span style={{ color: UI.textFaint, fontWeight: 400 }}> {isAlly(state, 0, o) ? '(ally)' : ''}</span>
            </span>
          );
        })}
    </span>
  );
}

/** Names joined as "A", "A and B" or "A, B and C". */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Who won, for a battle of three or four sides: the winning team by name, or in a free-for-all the
 * player alone (a victory) or the sides still standing when the player fell (a defeat).
 */
function winningLine(state: GameState): string | null {
  if (state.players.length <= 2 || state.winner === null) return null;
  const names = (os: number[]) => andList(os.map(o => (o === 0 ? 'you' : state.players[o].name)));
  const team = sidesOf(state).filter(o => isAlly(state, o, state.winner!));
  if (team.length > 1) return `Winning team: ${names(team)}.`;
  if (state.winner === 0) return 'You are the last side standing.';
  const left = sidesOf(state).filter(o => o !== 0 && standingSide(state, o));
  return left.length ? `Still standing: ${names(left)}.` : null;
}

function EndCard({ state, onLobby }: { state: GameState; onLobby: () => void }) {
  const won = wonBy(state, 0);
  const secs = Math.floor(state.tick / TICKS_PER_SECOND);
  // One column per side: You and Enemy in a two-sided battle, each side by name with more.
  const two = state.players.length === 2;
  const cols = sidesOf(state).map(o => ({
    o,
    label: o === 0 ? 'You' : two ? 'Enemy' : state.players[o].name,
    colour: two ? (o === 0 ? UI.team : UI.enemy) : UI.side[o],
  }));
  const stat = (k: keyof GameState['players'][number]['stats']) => state.players.map(p => p.stats[k]);
  const rows: [string, number[]][] = [
    ['Structures built', stat('built')],
    ['Units trained', stat('trained')],
    ['Enemy destroyed', stat('killed')],
    ['Losses', stat('lost')],
    ['Credits harvested', stat('harvested')],
  ];
  const line = winningLine(state);
  const minutes = Math.floor(secs / 60);
  return (
    <div style={scrim} className="fl-d-end-scrim">
      <div className="fl-d-end" role="dialog" aria-label={won ? 'Victory' : 'Defeat'} data-won={won ? '1' : '0'} data-testid="end-card" data-status={statusOf(state)}>
        <div className="fl-d-end-band">
          <p className="fl-d-end-eyebrow">
            {state.name} · {DIFFICULTIES[state.difficulty].label}
          </p>
          <h2 className="fl-d-end-title">{won ? 'VICTORY' : 'DEFEAT'}</h2>
          <p className="fl-d-end-sub">
            {won ? (two ? 'The Ashen Combine has been driven from the field' : 'Every enemy has been driven from the field') : 'Your last structure has fallen'} after {minutes}{' '}
            {minutes === 1 ? 'minute' : 'minutes'} {secs % 60} seconds.
          </p>
          {line && (
            <p className="fl-d-end-team" data-testid="winning-team">
              {line}
            </p>
          )}
        </div>
        <div className="fl-d-end-body">
          <h3 className="fl-d-sect">After-action report</h3>
          <table className="fl-d-end-stats">
            <thead>
              <tr>
                <th scope="col">
                  <span className="fl-d-visually-hidden">Measure</span>
                </th>
                {cols.map(c => (
                  <th key={c.o} scope="col" style={{ color: c.colour }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([l, vals]) => {
                const top = Math.max(1, ...cols.map(c => vals[c.o] ?? 0));
                return (
                  <tr key={l}>
                    <th scope="row">{l}</th>
                    {cols.map(c => {
                      const v = vals[c.o] ?? 0;
                      return (
                        <td key={c.o}>
                          <span className="fl-d-end-val">{Math.floor(v).toLocaleString('en-GB')}</span>
                          <span className="fl-d-end-bar" aria-hidden="true">
                            <span style={{ width: `${Math.round((v / top) * 100)}%`, background: c.colour }} />
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="fl-d-end-foot">
          <button type="button" className="fl-d-btn fl-d-primary" onClick={onLobby} autoFocus>
            Back to the lobby
          </button>
        </div>
      </div>
    </div>
  );
}

const shell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: UI.ground,
  color: UI.text,
  fontFamily: FONT.body,
  overflow: 'hidden',
};

const body: CSSProperties = {
  flex: 1,
  display: 'flex',
  minHeight: 0,
  flexWrap: 'wrap',
};

/** Width and scroll only: the console face (background, edge, bevel) is .fl-d-side in styles.css. */
const sidebar: CSSProperties = {
  width: 268,
  flex: '0 0 268px',
  maxHeight: '100%',
  overflowY: 'auto',
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

/** Finger-sized: 40px tall, the smallest target that is reliable on a phone. */
const touchBtn: CSSProperties = { minHeight: 40, padding: '6px 12px', fontSize: '0.85rem' };

const commandBar: CSSProperties = {
  position: 'absolute',
  left: 6,
  right: 6,
  bottom: 6,
  display: 'flex',
  gap: 4,
  justifyContent: 'center',
};

const barBtn = (on: boolean): CSSProperties => ({
  flex: '1 1 0',
  minWidth: 0,
  maxWidth: 110,
  minHeight: 44,
  padding: '6px 4px',
  fontFamily: 'inherit',
  fontSize: '0.8rem',
  fontWeight: 600,
  // Sits on the battlefield, which is the same canvas art in both modes, so like the hint and the
  // feed it keeps one dark backing; only the "on" edge takes the theme's accent.
  border: `1px solid ${on ? UI.accent : 'rgba(255,255,255,0.22)'}`,
  background: on ? 'rgba(60,44,16,0.88)' : 'rgba(8,12,12,0.78)',
  color: '#e9f0ec',
  borderRadius: 6,
  cursor: 'pointer',
});

const menuScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1500,
  background: UI.scrim,
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'flex-start',
  padding: 8,
};

const menuSheet: CSSProperties = {
  background: 'linear-gradient(180deg, var(--d-console-hi), var(--ui-panel) 90px)',
  border: '1px solid var(--d-btn-rule)',
  borderTop: `3px solid ${UI.accent}`,
  borderRadius: 8,
  padding: 14,
  width: 'min(360px, 100%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: `0 10px 40px ${UI.shadow}`,
};

const menuRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };

const menuLabel: CSSProperties = { fontSize: '0.75rem', color: UI.textFaint, width: 52 };

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

const scrim: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: UI.scrim,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const errorStrip: CSSProperties = {
  padding: '6px 12px',
  background: UI.tintBad,
  color: UI.bad,
  fontSize: '0.8rem',
  borderBottom: `1px solid ${UI.rule}`,
};
