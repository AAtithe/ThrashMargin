import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  AIR_AMMO,
  HELIPAD_SLOTS,
  REARM_TICKS,
  UPGRADES,
  UPGRADE_ORDER,
  hitsAir,
  hitsGround,
  BUILDINGS,
  DAMAGE_VS,
  MAX_QUEUE,
  MEDIC_HEAL,
  MEDIC_HEAL_TICKS,
  MEDIC_RANGE,
  POWERS,
  REPAIR_BAY_HP,
  REPAIR_BAY_RANGE,
  REPAIR_BAY_TICKS,
  SELF_REPAIR_TICKS,
  SKIRMISH_POWERS,
  PRODUCER,
  MENUS,
  STANDARD_TECH,
  UNITS,
  TICKS_PER_SECOND,
  type Armor,
  type BuildingKind,
  type Category,
  type SupportPower,
  type UnitKind,
  type WeaponKind,
  BOARD_RANGE,
  DETECTOR_RANGE,
  FUEL_RESERVE,
  UNLOAD_RADIUS,
  airSlotsOf,
  FUEL_TICKS,
  SCRAMBLE_LEASH,
  SCRAMBLE_RANGE,
} from '../sim/rules';
import { buildTicksOf, costFor, hasBuilding, hasProducer, maxHpOf, powerOf, readyStructure, techAllowed, unlocked } from '../sim/state';
import { airCount, airRoom } from '../sim/air';
import { hasUpgrade, researchProblem } from '../sim/research';
import type { GameAction, GameState } from '../sim/types';
import { FONT, UI, money } from '../theme';
import { iconFor } from './icons';
import { selectionActions, type Selection } from './selectionActions';

/** A tab of the build window: a build list, or Research once a Research Lab stands. */
export type Tab = Category | 'research';

export const TABS: { key: Tab; label: string }[] = [
  { key: 'building', label: 'Structures' },
  { key: 'infantry', label: 'Infantry' },
  { key: 'vehicle', label: 'Vehicles' },
  { key: 'air', label: 'Air' },
  { key: 'research', label: 'Research' },
];

export const tabLabel = (t: Tab): string => TABS.find(x => x.key === t)?.label ?? t;

/** Whether this battle has a Research tab: a Research Lab stands, and the battle allows one. */
export const researchOpen = (state: GameState): boolean => hasBuilding(state, 0, 'researchlab') && techAllowed(state, 0, 'researchlab');

/**
 * The tabs this battle offers: the Air tab only with advanced tech (never in a mission or on
 * standard tech), and Research after the others once a Research Lab stands.
 */
export const tabsFor = (state?: GameState): Tab[] =>
  TABS.map(t => t.key).filter(k =>
    k === 'research' ? !!state && researchOpen(state) : k !== 'air' || !state || techAllowed(state, 0, 'helipad'),
  );


const nameOf = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? BUILDINGS[k as BuildingKind].name : UNITS[k as UnitKind].name);
const blurbOf = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? BUILDINGS[k as BuildingKind].blurb : UNITS[k as UnitKind].blurb);
const needsOf = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? BUILDINGS[k as BuildingKind].requires : UNITS[k as UnitKind].requires);

/**
 * The build hotkeys, in menu order: the first item on the open tab is Q, the second W, and so on.
 * Q to Y are the original six; U and I continue the top row, and J K L the row below, because O
 * (objectives), P (pause), A, S, G, H, M, F and Z to V already have jobs. B, N and D carry the
 * Structures list on to its last three (Flak Cannon, Helipad and Research Lab on advanced tech).
 */
export const BUILD_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'j', 'k', 'l', 'b', 'n', 'd'] as const;

/**
 * Items for a tab, in menu (and hotkey) order. Given the battle, only what can be built in it: a
 * skirmish on standard tech, or a mission, shows the original items alone (still greyed until
 * their requirements stand, as ever), and advanced tech adds the rest. A mission's own tech list
 * keeps greying the original items it leaves out, so the campaign looks as it always has.
 */
export const menuFor = (tab: Tab, state?: GameState): (BuildingKind | UnitKind)[] =>
  tab === 'research'
    ? []
    : state
      ? MENUS[tab].filter(k => STANDARD_TECH.includes(k) || techAllowed(state, 0, k))
      : MENUS[tab].slice();

/** How many units a shift-click or shift+hotkey queues. */
export const BATCH = 5;

/**
 * What a press on a build button does, shared by the button and its hotkey. A ready structure
 * toggles placement; a structure under construction ignores the press; anything else queues one,
 * or with `batch` (units only) up to five, stopping at the first refusal.
 */
export function pressBuild(
  state: GameState,
  tab: Tab,
  kind: BuildingKind | UnitKind,
  placing: BuildingKind | null,
  dispatch: (a: GameAction) => boolean,
  setPlacing: (k: BuildingKind | null) => void,
  batch: boolean,
): void {
  if (tab === 'research') return;
  const head = state.players[0].queues[tab][0];
  if (tab === 'building' && readyStructure(state, 0) === kind) {
    setPlacing(placing === kind ? null : (kind as BuildingKind));
    return;
  }
  if (tab === 'building' && head && head.kind === kind) return;
  const n = batch && tab !== 'building' ? BATCH : 1;
  for (let i = 0; i < n; i++) if (!dispatch({ type: 'queue', category: tab, kind })) break;
}

const ARMOR_NAME: Record<Armor, string> = { infantry: 'Infantry', light: 'Light', heavy: 'Heavy', building: 'Structure', aircraft: 'Aircraft' };
const WEAPON_NAME: Record<WeaponKind, string> = {
  bullet: 'Machine gun',
  shell: 'Cannon',
  rocket: 'Rockets',
  artillery: 'Artillery shell',
  flame: 'Flamethrower',
  missile: 'Missile',
  flak: 'Flak',
  aamissile: 'Anti-air missiles',
  bomb: 'Bombs',
  rail: 'Railgun',
};
const secs = (ticks: number) => {
  const v = ticks / TICKS_PER_SECOND;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}s`;
};

export interface StatRow {
  label: string;
  value: string;
}

/** Every number worth knowing about a unit or structure, straight from rules.ts. */
export function statsOf(kind: BuildingKind | UnitKind): StatRow[] {
  const isB = kind in BUILDINGS;
  const b = isB ? BUILDINGS[kind as BuildingKind] : null;
  const u = isB ? null : UNITS[kind as UnitKind];
  const spec = (b ?? u)!;
  const rows: StatRow[] = [];
  if (kind !== 'hq') {
    rows.push({ label: 'Cost', value: `${spec.cost.toLocaleString('en-GB')} credits` });
    rows.push({ label: 'Build time', value: secs(spec.buildTicks) });
  }
  rows.push({ label: 'Health', value: `${spec.hp}` });
  rows.push({ label: 'Armour', value: ARMOR_NAME[u ? u.armor : 'building'] });
  if (b) {
    rows.push({ label: 'Power', value: b.power > 0 ? `+${b.power}` : `${b.power}` });
    rows.push({ label: 'Size', value: `${b.w}×${b.h} tiles` });
  }
  if (u) rows.push({ label: 'Speed', value: `${(u.speed * TICKS_PER_SECOND).toFixed(1)} tiles/s` });
  rows.push({ label: 'Sight', value: `${spec.sight} tiles` });
  const w = spec.weapon;
  if (w) {
    rows.push({ label: 'Weapon', value: `${WEAPON_NAME[w.kind]}, ${w.damage} damage` });
    rows.push({ label: 'Range', value: `${w.range} tiles${w.minRange ? ` (not under ${w.minRange})` : ''}` });
    rows.push({ label: 'Reload', value: secs(w.cooldown) });
    if (w.splash) rows.push({ label: 'Splash', value: `${w.splash} tiles` });
    const vs = DAMAGE_VS[w.kind];
    const against: Armor[] = [...(hitsGround(w) ? (['infantry', 'light', 'heavy', 'building'] as Armor[]) : []), ...(hitsAir(w) ? (['aircraft'] as Armor[]) : [])];
    rows.push({
      label: 'Damage vs',
      value: against.map(a => `${ARMOR_NAME[a].toLowerCase()} ${Math.round(vs[a] * 100)}%`).join(' · '),
    });
    rows.push({ label: 'Targets', value: hitsGround(w) && hitsAir(w) ? 'Ground and air' : hitsAir(w) ? 'Aircraft only' : 'Ground only' });
  }
  const ammo = AIR_AMMO[kind as UnitKind];
  if (u && ammo && kind === 'reconplane')
    rows.push({
      label: 'Fuel',
      value: `About ${secs(ammo * FUEL_TICKS)} aloft; turns for home with ${FUEL_RESERVE} loads left; refuels at its Helipad, a load every ${secs(REARM_TICKS.reconplane ?? 0)}`,
    });
  else if (u && ammo)
    rows.push({
      label: 'Ammunition',
      value: `${ammo} ${kind === 'bomber' || kind === 'heavybomber' ? 'bombs, dropped in one run' : kind === 'interceptor' ? 'air-to-air missiles' : 'rockets'}; rearms at its Helipad, a load every ${secs(REARM_TICKS[kind as UnitKind] ?? 0)}`,
    });
  if (u?.carries) rows.push({ label: 'Carries', value: `${u.carries} infantry; they climb in within ${BOARD_RANGE} tiles while it is still, and get out within ${UNLOAD_RADIUS}` });
  if (u && airSlotsOf(kind as UnitKind) > 1) rows.push({ label: 'Helipad', value: 'Takes a whole Helipad to itself' });
  if (u?.detector) rows.push({ label: 'Detects', value: `Stealth Tanks and Spies within ${DETECTOR_RANGE} tiles, for its whole side` });
  if (kind === 'interceptor') rows.push({ label: 'Scrambles', value: `Parked, at enemy aircraft within ${SCRAMBLE_RANGE} tiles of its Helipad; breaks off ${SCRAMBLE_LEASH} tiles out` });
  if (u?.category === 'air') rows.push({ label: 'Flies', value: 'Over water, rock and structures; only anti-air and bullets reach it' });
  if (kind === 'helipad') rows.push({ label: 'Serves', value: `${HELIPAD_SLOTS} aircraft: builds them and rearms them` });
  if (kind === 'researchlab') rows.push({ label: 'Research', value: 'Upgrades listed on the Research tab of the build window once it stands' });
  if (u?.medic) rows.push({ label: 'Heals', value: `${MEDIC_HEAL} hp to the most hurt infantry within ${MEDIC_RANGE} tiles every ${secs(MEDIC_HEAL_TICKS)}` });
  if (u?.selfRepair)
    rows.push({ label: 'Self-repair', value: `${u.selfRepair} hp every ${secs(SELF_REPAIR_TICKS)} when out of combat` });
  if (kind === 'repairbay')
    rows.push({ label: 'Repairs', value: `Vehicles within ${REPAIR_BAY_RANGE} tile: ${REPAIR_BAY_HP} hp every ${secs(REPAIR_BAY_TICKS)}, paid as it goes` });
  if (b?.wall) rows.push({ label: 'Note', value: 'Blocks movement. Does not extend the build area or count as a structure.' });
  const grants = (Object.entries(SKIRMISH_POWERS) as [SupportPower, BuildingKind][]).find(([, k]) => k === kind);
  if (grants) rows.push({ label: 'Grants', value: `${POWERS[grants[0]].name} (skirmish, advanced tech)` });
  if (spec.requires.length) rows.push({ label: 'Needs', value: spec.requires.map(r => BUILDINGS[r].name).join(', ') });
  return rows;
}

/**
 * A stat card that floats to the left of the sidebar, level with the control it describes. It
 * never takes the pointer, so it cannot cover anything a click is aimed at, and it sits under
 * the guided tour's card.
 */
export function StatTip({ kind, anchor, extra }: { kind: BuildingKind | UnitKind; anchor: HTMLElement; extra?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor.isConnected) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    // Clear of the whole sidebar, or of the whole build window, so the card never hides the
    // neighbouring buttons: to the left of the sidebar; beside the window, on whichever side has room.
    const side = anchor.closest('aside');
    const win = side ? null : anchor.closest('[data-tip-host]');
    let left: number;
    if (win) {
      const r = win.getBoundingClientRect();
      if (r.right + w + 8 <= window.innerWidth - 8) left = r.right + 8;
      else if (r.left - w - 8 >= 8) left = r.left - w - 8;
      else left = a.right + w + 8 <= window.innerWidth - 8 ? a.right + 8 : a.left - w - 8;
    } else left = (side ?? anchor).getBoundingClientRect().left - w - 8;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, left))}px`;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, a.top))}px`;
  });
  return (
    <div ref={ref} className="fl-tip" role="tooltip" data-testid="stat-tip">
      <strong className="fl-tip-title">{nameOf(kind)}</strong>
      <span className="fl-tip-blurb">{blurbOf(kind)}</span>
      <dl>
        {statsOf(kind).map(r => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      {extra}
    </div>
  );
}

/** Hover-or-focus state for a StatTip. */
export function useTip<K>() {
  const [tip, setTip] = useState<{ key: K; el: HTMLElement } | null>(null);
  const bind = (key: K) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => setTip({ key, el: e.currentTarget }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => setTip({ key, el: e.currentTarget }),
    onBlur: () => setTip(null),
  });
  return { tip: tip && tip.el.isConnected ? tip : null, bind, clear: () => setTip(null), show: (key: K, el: HTMLElement) => setTip({ key, el }) };
}

/**
 * The credits figure, counting toward the real value rather than jumping, so a hauler's delivery
 * reads as money arriving. Written straight to the DOM each frame: no React render per frame.
 * `data-value` always carries the real figure.
 */
function Credits({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const target = useRef(value);
  const raf = useRef(0);
  target.current = value;
  useEffect(() => {
    const el = ref.current;
    if (!el || Math.floor(shown.current) === Math.floor(value)) return;
    let still = false;
    try {
      still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      still = false;
    }
    cancelAnimationFrame(raf.current);
    if (still) {
      shown.current = value;
      el.textContent = money(value);
      return;
    }
    el.dataset.trend = value > shown.current ? 'up' : 'down';
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(100, Math.max(0, now - last));
      last = now;
      const diff = target.current - shown.current;
      if (Math.abs(diff) < 1) {
        shown.current = target.current;
        el.textContent = money(shown.current);
        delete el.dataset.trend;
        return;
      }
      let move = diff * (1 - Math.exp(-dt / 140));
      if (Math.abs(move) < 1) move = Math.sign(diff) * Math.min(1, Math.abs(diff));
      shown.current += move;
      el.textContent = money(shown.current);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [value]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return (
    <span ref={ref} className="fl-credits-value" data-value={Math.floor(value)}>
      {money(shown.current)}
    </span>
  );
}

/**
 * Credits, power, the minimap, the Build button and the production strip. The build lists
 * themselves live in the build window (BuildWindow.tsx). Everything here reads the live state
 * handed in on each HUD refresh; every button sends an ordinary action through `dispatch`.
 */
export function BuildPanel({
  state,
  tab,
  dispatch,
  placing,
  setPlacing,
  minimap,
  buildOpen,
  onToggleBuild,
  onOpenTab,
  compact = false,
  touch = false,
}: {
  state: GameState;
  /** The build window's tab, named on the Build button. */
  tab: Tab;
  dispatch: (a: GameAction) => boolean;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
  minimap: ReactNode;
  buildOpen: boolean;
  onToggleBuild: () => void;
  /** Open the window on a tab (a tap on a production strip icon, touch). */
  onOpenTab: (t: Tab) => void;
  /** A short or narrow panel: the minimap sits beside credits and power. */
  compact?: boolean;
  touch?: boolean;
}) {
  const p = state.players[0];
  const pw = powerOf(state, 0);
  const max = Math.max(pw.made, pw.used, 100);

  // The power meter: twelve lamps across the scale. Amber is drawn, green is spare, red is the
  // shortfall when more is drawn than made.
  const LAMPS = 12;
  const lamp = (i: number): 'used' | 'spare' | 'short' | 'off' => {
    const at = ((i + 0.5) / LAMPS) * max;
    if (at < Math.min(pw.used, pw.made)) return 'used';
    if (at < pw.made) return 'spare';
    if (at < pw.used) return 'short';
    return 'off';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, flex: 1, minWidth: 0, flexDirection: compact ? 'column' : 'row' }}>
        <div className="fl-d-gauge fl-d-credits" id="fl-credits" data-testid="credits" title="Credits. Haulers bring ore to a refinery to earn more.">
          <span className="fl-d-gauge-label">Credits</span>
          <Credits value={p.credits} />
        </div>
        <div
          id="fl-power"
          className="fl-d-gauge fl-d-power"
          data-low={pw.low ? '1' : '0'}
          title={`Power: ${pw.made} made, ${pw.used} used${pw.low ? '. Short: production halves.' : ''}`}
        >
          <span className="fl-d-gauge-label">
            Power
            <span className="fl-d-gauge-state">{pw.low ? 'Low' : 'OK'}</span>
          </span>
          <span className="fl-d-meter" aria-hidden="true">
            {Array.from({ length: LAMPS }, (_, i) => (
              <span key={i} data-s={lamp(i)} />
            ))}
          </span>
          <span className="fl-d-gauge-sub">
            <span>{pw.used} used</span>
            <span>{pw.made} made</span>
          </span>
        </div>
      </div>

      {compact && (
        <div id="fl-minimap" className="fl-d-radar" style={{ width: 104, flex: '0 0 104px' }}>
          {minimap}
        </div>
      )}
      </div>

      {!compact && (
        <section className="fl-d-block" aria-label="Radar">
          <h3 className="fl-d-sect">Radar</h3>
          <div id="fl-minimap" className="fl-d-radar">
            {minimap}
          </div>
        </section>
      )}

      {!compact && <h3 className="fl-d-sect">Production</h3>}
      <button
        type="button"
        id="fl-build-open"
        data-testid="build-open"
        className="fl-build-open"
        aria-expanded={buildOpen}
        aria-controls="fl-build-window"
        aria-keyshortcuts={touch ? undefined : 'Backquote'}
        title={buildOpen ? 'Close the build window' : 'Open the build window: every structure, unit and upgrade, laid out by what each needs'}
        onClick={onToggleBuild}
        data-open={buildOpen ? '1' : '0'}
      >
        <span className="fl-build-open-label">
          <span className="fl-d-build-word">Build</span> <strong>{tabLabel(tab)}</strong>
        </span>
        {!touch && <kbd>`</kbd>}
      </button>

      <ProductionStrip state={state} dispatch={dispatch} placing={placing} setPlacing={setPlacing} touch={touch} onOpenTab={onOpenTab} />
    </div>
  );
}

/**
 * One small icon per queue with anything in it (the four build queues, and the research under
 * way): the item at its head with its progress bar and the queue's count. A click cancels the last
 * one queued (touch: the ×); a ready structure pulses, and a click on it picks it up to place.
 */
function ProductionStrip({
  state,
  dispatch,
  placing,
  setPlacing,
  touch,
  onOpenTab,
}: {
  state: GameState;
  dispatch: (a: GameAction) => boolean;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
  touch: boolean;
  onOpenTab: (t: Tab) => void;
}) {
  const p = state.players[0];
  const ready = readyStructure(state, 0);
  const cats = (['building', 'infantry', 'vehicle', 'air'] as Category[]).filter(c => p.queues[c].length > 0);
  const research = p.research ?? null;
  if (!cats.length && !research) {
    return (
      <div id="fl-queue-strip" data-testid="queue-strip" className="fl-strip" data-empty="1">
        <span className="fl-strip-empty">Nothing in production.</span>
      </div>
    );
  }
  return (
    <div id="fl-queue-strip" data-testid="queue-strip" className="fl-strip" role="group" aria-label="In production">
      {cats.map(c => {
        const q = p.queues[c];
        const head = q[0];
        const last = q[q.length - 1];
        const isReady = c === 'building' && ready === head.kind;
        const progress = Math.min(1, head.progress / buildTicksOf(head.kind));
        const name = nameOf(head.kind);
        const cancelLast = () => {
          dispatch({ type: 'cancel', category: c, kind: last.kind });
          if (placing === last.kind) setPlacing(null);
        };
        const label = isReady
          ? `${name} ready: ${touch ? 'tap' : 'click'} to place it`
          : `${tabLabel(c)}: ${name}${q.length > 1 ? `, ${q.length} queued` : ''}, ${Math.round(progress * 100)}%. ${touch ? 'Tap to open the list; × cancels' : 'Click to cancel'} the last one queued (${nameOf(last.kind)}) for a full refund`;
        return (
          <div key={c} className="fl-strip-cell">
            <button
              type="button"
              className={`fl-strip-item${isReady ? ' ready' : ''}`}
              data-testid={`strip-${c}`}
              data-state={isReady ? (placing === head.kind ? 'placing' : 'ready') : 'building'}
              aria-label={label}
              title={label}
              onClick={() => {
                if (isReady) setPlacing(placing === head.kind ? null : (head.kind as BuildingKind));
                else if (touch) onOpenTab(c);
                else cancelLast();
              }}
              onContextMenu={e => {
                e.preventDefault();
                if (!touch) cancelLast();
              }}
            >
              <img src={iconFor(head.kind)} alt="" width={48} height={32} />
              {!isReady && (
                <span className="fl-strip-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(progress * 100)}%` }} />
                </span>
              )}
              {q.length > 1 && <span className="fl-strip-count">{q.length}</span>}
              {isReady && <span className="fl-strip-ready">{placing === head.kind ? 'Placing' : 'Ready'}</span>}
            </button>
            {touch && !isReady && (
              <button type="button" className="fl-strip-x" data-testid={`strip-cancel-${c}`} aria-label={`Cancel the last ${nameOf(last.kind)}`} onClick={cancelLast}>
                ×
              </button>
            )}
          </div>
        );
      })}
      {research && (
        <div className="fl-strip-cell">
          <button
            type="button"
            className="fl-strip-item"
            data-testid="strip-research"
            data-state="building"
            aria-label={`Research: ${UPGRADES[research.id].name}, ${Math.round((research.progress / UPGRADES[research.id].ticks) * 100)}%. ${touch ? 'Tap to open Research; × cancels it' : 'Click to cancel it'} for a full refund`}
            title={`Research: ${UPGRADES[research.id].name}. ${touch ? 'Tap to open Research; × cancels it' : 'Click to cancel it'} for a full refund`}
            onClick={() => (touch ? onOpenTab('research') : dispatch({ type: 'cancelResearch' }))}
            onContextMenu={e => {
              e.preventDefault();
              if (!touch) dispatch({ type: 'cancelResearch' });
            }}
          >
            <img src={iconFor('researchlab')} alt="" width={48} height={32} />
            <span className="fl-strip-bar research" aria-hidden="true">
              <span style={{ width: `${Math.round(Math.min(1, research.progress / UPGRADES[research.id].ticks) * 100)}%` }} />
            </span>
          </button>
          {touch && (
            <button type="button" className="fl-strip-x" data-testid="strip-cancel-research" aria-label="Cancel the research" onClick={() => dispatch({ type: 'cancelResearch' })}>
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One build button, as the build window lays it out: icon, name, cost, hotkey letter, queue count
 * and progress, the Shift batch, the ready-to-place pulse, cancel by right-click (or the ×), and a
 * line naming what it still needs when locked. The stat card shows on hover, focus or a long press.
 */
export function BuildButton({
  state,
  tab,
  kind,
  hotkey,
  placing,
  setPlacing,
  dispatch,
  touch,
  tipBind,
  onLongPress,
}: {
  state: GameState;
  tab: Category;
  kind: BuildingKind | UnitKind;
  hotkey?: string;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
  dispatch: (a: GameAction) => boolean;
  touch: boolean;
  tipBind: Record<string, unknown>;
  onLongPress: (el: HTMLElement | null) => void;
}) {
  const p = state.players[0];
  const q = p.queues[tab];
  const inQueue = q.filter(i => i.kind === kind).length;
  const head = q[0];
  const isHead = !!head && head.kind === kind;
  const progress = isHead ? head.progress / buildTicksOf(kind) : 0;
  const open = unlocked(state, 0, kind);
  const cost = costFor(state, 0, kind);
  const isReady = tab === 'building' && readyStructure(state, 0) === kind;
  const blockedByOther = tab === 'building' && q.length > 0 && !isHead;
  const full = tab !== 'building' && q.length >= MAX_QUEUE;
  const affordable = p.credits >= cost;
  // Unaffordable stays clickable: the click is refused with a toast that says why.
  const disabled = !open || blockedByOther || (!isHead && !isReady && full);
  // A hotkey letter means nothing without a keyboard.
  const key = touch ? undefined : hotkey?.toUpperCase();
  const missing = needsOf(kind).filter(r => r !== 'hq' && !hasBuilding(state, 0, r));
  const cancel = () => {
    dispatch({ type: 'cancel', category: tab, kind });
    if (placing === kind) setPlacing(null);
  };
  // A long press (touch) shows the stat card and swallows the tap that follows it.
  const press = useRef<{ timer: number; fired: boolean; touch: boolean }>({ timer: 0, fired: false, touch: false });
  const endPress = () => {
    window.clearTimeout(press.current.timer);
    if (press.current.fired) onLongPress(null);
  };
  useEffect(() => () => window.clearTimeout(press.current.timer), []);
  return (
    <div className="fl-tree-cell" data-node={kind} data-tier-item="1">
      <div style={{ position: 'relative', display: 'flex' }}>
        <button
          id={`fl-build-${kind}`}
          className={`fl-build${isReady ? ' ready' : ''}`}
          data-testid={`build-${kind}`}
          data-state={!open ? 'locked' : isReady ? 'ready' : isHead ? 'building' : 'idle'}
          data-afford={affordable ? '1' : '0'}
          disabled={disabled}
          aria-label={`${nameOf(kind)}, ${cost} credits${key ? `, hotkey ${key}` : ''}${missing.length ? `, needs ${missing.map(r => BUILDINGS[r].name).join(', ')}` : ''}`}
          aria-keyshortcuts={key}
          aria-pressed={placing === kind}
          {...tipBind}
          onPointerDown={e => {
            press.current.fired = false;
            press.current.touch = e.pointerType === 'touch';
            if (e.pointerType !== 'touch') return;
            const el = e.currentTarget;
            window.clearTimeout(press.current.timer);
            press.current.timer = window.setTimeout(() => {
              press.current.fired = true;
              onLongPress(el);
            }, 450);
          }}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onPointerLeave={endPress}
          onClick={e => {
            if (press.current.fired) {
              press.current.fired = false;
              return;
            }
            pressBuild(state, tab, kind, placing, dispatch, setPlacing, e.shiftKey);
          }}
          onContextMenu={e => {
            e.preventDefault();
            // A finger's long press raises contextmenu too; on touch only the × cancels.
            if (inQueue && !press.current.touch) cancel();
          }}
          style={{ flex: 1, minWidth: 0 }}
        >
          <span className="fl-build-pic">
            <img src={iconFor(kind)} alt="" width={96} height={64} draggable={false} />
            {isHead && !isReady && (
              <>
                <span className="fl-build-sweep" aria-hidden="true" style={{ width: `${Math.round((1 - progress) * 100)}%` }} />
                <span className="fl-build-pct" aria-hidden="true">
                  {Math.floor(progress * 100)}%
                </span>
              </>
            )}
          </span>
          <span className="fl-build-name">
            {key && <kbd className="fl-key">{key}</kbd>} {nameOf(kind)}
          </span>
          <span className="fl-build-cost" data-short={affordable ? '0' : '1'}>
            {cost}
          </span>
          {isHead && !isReady && (
            <span className="fl-build-prog" aria-hidden="true">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          )}
          {isReady && <span className="fl-build-badge" data-kind="ready">{placing === kind ? 'Placing' : 'Ready'}</span>}
          {inQueue > 1 && (
            <span className="fl-build-badge" data-kind="count">
              ×{inQueue}
            </span>
          )}
        </button>
        {inQueue > 0 && (
          <button
            type="button"
            className="fl-cancel"
            data-testid={`cancel-${kind}`}
            aria-label={`Cancel ${nameOf(kind)}`}
            title="Cancel for a full refund"
            onClick={cancel}
          >
            ×
          </button>
        )}
      </div>
      {missing.length > 0 && (
        <span className="fl-tree-needs" data-testid={`needs-${kind}`}>
          Needs {missing.map(r => BUILDINGS[r].name).join(', ')}
        </span>
      )}
    </div>
  );
}

/**
 * Research, on the build window's Research tab once a Research Lab stands: every upgrade with its
 * cost, time and effect; the one under way with its progress and a cancel; those done ticked off.
 * Starting one pays for it in full; cancelling refunds it in full.
 */
export function ResearchBlock({ state, dispatch, lowPower }: { state: GameState; dispatch: (a: GameAction) => boolean; lowPower: boolean }) {
  const p = state.players[0];
  const busy = p.research ?? null;
  return (
    <section className="fl-research" data-testid="research" aria-label="Research">
      <h3 className="fl-research-head">
        Research
        {busy && lowPower && <span className="fl-research-slow">half speed: power low</span>}
      </h3>
      {UPGRADE_ORDER.map(id => {
        const spec = UPGRADES[id];
        const done = hasUpgrade(state, 0, id);
        const running = busy?.id === id;
        const problem = researchProblem(state, 0, id);
        const state0 = done ? 'done' : running ? 'running' : problem ? 'blocked' : 'ready';
        return (
          <div key={id} className="fl-research-row" data-testid={`research-${id}`} data-state={state0}>
            <div className="fl-research-top">
              <strong>{spec.name}</strong>
              {done ? (
                <span className="fl-research-done">Done</span>
              ) : running ? (
                <button type="button" className="fl-research-btn" data-kind="cancel" onClick={() => dispatch({ type: 'cancelResearch' })}>
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="fl-research-btn"
                  disabled={!!problem && problem !== 'Not enough credits'}
                  title={problem ?? `Research for ${spec.cost} credits`}
                  onClick={() => dispatch({ type: 'research', upgrade: id })}
                >
                  {spec.cost}
                </button>
              )}
            </div>
            <span className="fl-research-blurb">
              {spec.blurb} {!done && <span className="fl-research-time">{secs(spec.ticks)}</span>}
              {!done && !running && problem && problem !== 'Not enough credits' && problem !== 'Already researching' && (
                <span className="fl-research-why"> {problemText(problem)}</span>
              )}
            </span>
            {running && (
              <div className="fl-research-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((busy!.progress / spec.ticks) * 100)}>
                <span style={{ width: `${Math.round((busy!.progress / spec.ticks) * 100)}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** A research refusal in the player's words: requirements named as structures. */
function problemText(problem: string): string {
  if (!problem.startsWith('Needs: ')) return `${problem}.`;
  const kind = problem.slice(7) as BuildingKind;
  return `Needs a ${BUILDINGS[kind]?.name ?? kind}.`;
}

/** The live part of a build button's card: what stands in the way right now, and the keys. */
export function BuildTipFooter({
  state,
  tab,
  kind,
  hotkey,
  lowPower,
}: {
  state: GameState;
  tab: Category;
  kind: BuildingKind | UnitKind;
  hotkey?: string;
  lowPower: boolean;
}) {
  const p = state.players[0];
  const missing = needsOf(kind).filter(r => !hasBuilding(state, 0, r));
  const short = costFor(state, 0, kind) - p.credits;
  const notes: string[] = [];
  if (state.allowed && !state.allowed.includes(kind)) notes.push('Not available in this mission.');
  else if (missing.length) notes.push(`Locked: build a ${missing.map(r => BUILDINGS[r].name).join(' and a ')} first.`);
  else if (short > 0 && !p.queues[tab].some(q => q.kind === kind)) notes.push(`Need ${money(short)} more credits.`);
  if (lowPower) notes.push('Power is low: everything builds at half speed.');
  const k = hotkey?.toUpperCase();
  const how =
    tab === 'building'
      ? `${k ? `${k} or click` : 'Click'} to build, again to place it when ready. Right-click cancels.`
      : `${k ? `${k} or click` : 'Click'} to train one; with Shift, ${BATCH}. Right-click cancels one.`;
  return (
    <div className="fl-tip-foot">
      {notes.map(n => (
        <span key={n} className="fl-tip-warn">
          {n}
        </span>
      ))}
      <span>{how}</span>
    </div>
  );
}

export function SelectionPanel({
  state,
  selected,
  dispatch,
  touch = false,
}: {
  state: GameState;
  selected: Set<number>;
  dispatch: (a: GameAction) => boolean;
  touch?: boolean;
}) {
  const units = state.units.filter(u => selected.has(u.id));
  const building = state.buildings.find(b => selected.has(b.id));
  const { tip, bind } = useTip<BuildingKind | UnitKind>();
  const tipCard = tip && <StatTip kind={tip.key} anchor={tip.el} />;
  if (!units.length && !building) {
    if (touch) {
      return (
        <p style={{ margin: 0, fontSize: '0.74rem', color: UI.textFaint, lineHeight: 1.45 }}>
          Tap a unit to select it, or use Army or Box on the map. With units selected, tap the ground to move and an enemy to attack.
        </p>
      );
    }
    return (
      <dl className="fl-d-legend" aria-label="Orders">
        <div>
          <dt>Click, drag a box</dt>
          <dd>Select</dd>
        </div>
        <div>
          <dt>Right-click</dt>
          <dd>Move or attack</dd>
        </div>
        <div>
          <dt>
            <kbd>A</kbd>
          </dt>
          <dd>Attack-move</dd>
        </div>
        <div>
          <dt>
            <kbd>S</kbd>
          </dt>
          <dd>Stop</dd>
        </div>
        <div>
          <dt>
            <kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>9</kbd>
          </dt>
          <dd>Make a group</dd>
        </div>
        <div>
          <dt>
            <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd>…
          </dt>
          <dd>Build the item with that letter</dd>
        </div>
        <div>
          <dt>
            <kbd>Tab</kbd>
          </dt>
          <dd>Next build list</dd>
        </div>
        <div>
          <dt>
            <kbd>Space</kbd>
          </dt>
          <dd>Jump to the last alert</dd>
        </div>
      </dl>
    );
  }
  if (building) {
    const spec = BUILDINGS[building.kind];
    const mine = building.owner === 0;
    const refund = Math.floor((spec.cost * 0.5 * (building.hp / spec.hp)) / 10) * 10;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong tabIndex={0} className="fl-has-tip" style={{ fontSize: '0.85rem', color: mine ? UI.text : UI.enemy }} {...bind(building.kind)}>
            {mine ? '' : 'Enemy '}
            {spec.name}
          </strong>
          <span style={{ fontFamily: FONT.mono, fontSize: '0.72rem', color: UI.textSoft }}>
            {Math.ceil(building.hp)}/{spec.hp}
          </span>
        </div>
        <Bar frac={building.hp / spec.hp} />
        {tipCard}
        {mine && (
          <>
            <p style={{ margin: 0, fontSize: '0.72rem', color: UI.textSoft, lineHeight: 1.4 }}>
              {spec.blurb}
              {(building.kind === 'barracks' || building.kind === 'factory') && (touch ? ' Tap the map to set where new units gather.' : ' Right-click the map to set where new units gather.')}
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="fl-d-sbtn"
                aria-pressed={building.repairing}
                disabled={building.hp >= spec.hp && !building.repairing}
                onClick={() => dispatch({ type: 'repair', id: building.id })}
                title="Repair (G), paid for as the work is done"
              >
                {building.repairing ? 'Repairing…' : 'Repair'}
              </button>
              <button
                className="fl-d-sbtn"
                data-tone="bad"
                onClick={() => {
                  if (window.confirm(`Sell the ${spec.name} for ${refund} credits?`)) dispatch({ type: 'sell', id: building.id });
                }}
              >
                Sell ({refund})
              </button>
            </div>
            <ActionButtons state={state} sel={{ units: [], building }} dispatch={dispatch} touch={touch} />
          </>
        )}
      </div>
    );
  }
  const counts = new Map<UnitKind, number>();
  for (const u of units) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
  const hp = units.reduce((a, u) => a + u.hp, 0);
  const max = units.reduce((a, u) => a + maxHpOf(u), 0);
  const mine = units[0].owner === 0;
  const one = units.length === 1 ? units[0] : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {[...counts].map(([kind, n]) => (
          <span
            key={kind}
            tabIndex={0}
            {...bind(kind)}
            className="fl-has-tip fl-d-chip"
            data-enemy={mine ? '0' : '1'}
          >
            {n > 1 ? `${n}× ` : ''}
            {mine ? '' : 'Enemy '}
            {UNITS[kind].name}
          </span>
        ))}
      </div>
      <Bar frac={hp / Math.max(1, max)} />
      {tipCard}
      {one && one.kind === 'hauler' && mine && (
        <span style={{ fontSize: '0.72rem', color: UI.textSoft }}>
          Carrying {one.cargo} of 600 ore.{' '}
          {one.order.type === 'harvest' ? 'Harvesting.' : touch ? 'Idle: tap ore or a refinery.' : 'Idle: right-click ore or a refinery.'}
        </span>
      )}
      {one && mine && AIR_AMMO[one.kind] && (
        <span style={{ fontSize: '0.72rem', color: UI.textSoft }} data-testid="air-ammo">
          {one.kind === 'bomber' || one.kind === 'heavybomber' ? 'Bombs' : one.kind === 'reconplane' ? 'Fuel' : one.kind === 'interceptor' ? 'Missiles' : 'Rockets'} {one.ammo ?? 0} of {AIR_AMMO[one.kind]}.{' '}
          {one.order.type === 'rearm'
            ? (one.ammo ?? 0) < (AIR_AMMO[one.kind] ?? 0)
              ? one.order.pad
                ? one.kind === 'reconplane'
                  ? (one.ammo ?? 0) <= FUEL_RESERVE
                    ? 'Low on fuel: home to refuel.'
                    : 'Refuelling at its Helipad.'
                  : 'Rearming at its Helipad.'
                : 'No Helipad with room: waiting.'
              : one.kind === 'interceptor'
                ? 'Parked on its Helipad, ready to scramble.'
                : 'Parked on its Helipad.'
            : one.bombRun
              ? 'On its bomb run.'
              : one.scramble
                ? 'Scrambled after an intruder.'
                : one.kind === 'reconplane' && one.order.type === 'idle'
                  ? 'Circling.'
                  : 'In the air.'}
        </span>
      )}
      {one && mine && UNITS[one.kind].carries && (
        <span style={{ fontSize: '0.72rem', color: UI.textSoft }} data-testid="carrier-load">
          Carrying {one.carried?.length ?? 0} of {UNITS[one.kind].carries}.{' '}
          {one.drop
            ? 'Setting them down where it stops.'
            : one.order.type === 'rearm'
              ? 'Parked on its Helipad.'
              : one.order.type === 'idle'
                ? 'Hovering.'
                : 'In the air.'}{' '}
          {(one.carried?.length ?? 0) < (UNITS[one.kind].carries ?? 0) && (touch ? 'Infantry: tap it to board.' : 'Infantry: right-click it to board.')}
        </span>
      )}
      {one && (one.kills > 0 || one.vet > 0 || one.queue.length > 0) && (
        <span style={{ fontSize: '0.72rem', color: UI.textSoft }}>
          {[
            one.vet > 0 ? RANK_NAMES[one.vet] ?? '' : '',
            one.kills > 0 ? `${one.kills} ${one.kills === 1 ? 'kill' : 'kills'}` : '',
            one.queue.length > 0 ? `${one.queue.length} more ${one.queue.length === 1 ? 'order' : 'orders'} queued` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
      {mine && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="fl-d-sbtn" onClick={() => dispatch({ type: 'stop', ids: units.map(u => u.id) })}>
            {touch ? 'Stop' : 'Stop (S)'}
          </button>
        </div>
      )}
      {mine && <ActionButtons state={state} sel={{ units, building: null }} dispatch={dispatch} touch={touch} />}
      {mine && units.some(u => UNITS[u.kind].weapon) && (
        <div className="fl-d-seg fl-d-stance" role="group" aria-label="Stance">
          {STANCE_BUTTONS.map(([stance, label, title]) => {
            const armed = units.filter(u => UNITS[u.kind].weapon);
            const on = armed.every(u => u.stance === stance);
            return (
              <button
                key={stance}
                data-stance={stance}
                aria-pressed={on}
                className="fl-d-sbtn"
                title={title}
                onClick={() => dispatch({ type: 'stance', ids: armed.map(u => u.id), stance })}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {mine && (
        <span style={{ fontSize: '0.68rem', color: UI.textFaint }}>
          <kbd>Shift</kbd>+right-click queues waypoints.
        </span>
      )}
    </div>
  );
}

/**
 * The selection's own commands (selectionActions.ts), one button each; nothing when none applies.
 * The first one that can go is also the F key in a skirmish.
 */
function ActionButtons({ state, sel, dispatch, touch }: { state: GameState; sel: Selection; dispatch: (a: GameAction) => boolean; touch: boolean }) {
  const list = selectionActions(state, sel);
  if (!list.length) return null;
  const first = list.findIndex(x => !x.problem);
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {list.map(({ spec, action, problem }, i) => (
        <button
          key={spec.id}
          data-action={spec.id}
          className="fl-d-sbtn"
          disabled={!!problem}
          title={problem ?? spec.title}
          onClick={() => dispatch(action)}
        >
          {spec.label}
          {!touch && !state.mission && i === first ? ' (F)' : ''}
        </button>
      ))}
    </div>
  );
}

// Kept here rather than imported so this panel's additions stay in one place (rules.ts VET_NAMES).
const RANK_NAMES = ['', 'Veteran', 'Elite'];
const STANCE_BUTTONS: ['aggressive' | 'guard' | 'hold', string, string][] = [
  ['aggressive', 'Aggressive', 'Chase and attack any enemy in sight'],
  ['guard', 'Guard', 'Fire at enemies in range and answer fire from close by (default)'],
  ['hold', 'Hold fire', 'Never fire or chase unless ordered to attack'],
];

/** Health, as a segmented gauge: green, amber under 60%, red under 30%. */
function Bar({ frac }: { frac: number }) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <div className="fl-d-hp" data-tone={f > 0.6 ? 'good' : f > 0.3 ? 'warn' : 'bad'} aria-hidden="true">
      <div style={{ width: `${f * 100}%` }} />
    </div>
  );
}

