import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AIR_AMMO,
  HELIPAD_SLOTS,
  REARM_TICKS,
  LINES,
  LINE_ORDER,
  MODULES,
  MODULE_ORDER,
  MODULE_SLOTS,
  UPGRADES,
  UPGRADE_LINE,
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
  type LineId,
  type ModuleId,
  type ResearchMode,
  type SupportPower,
  type UnitKind,
  type UpgradeId,
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
import { buildTicksOf, costFor, hasBuilding, hasProducer, maxHpOf, powerOf, readyStructure, researchModeOf, techAllowed, unlocked } from '../sim/state';
import { airCount, airRoom } from '../sim/air';
import { doctrineOf, doctrineProblem, hasUpgrade, researchCostOf, researchProblem, researchTicksOf } from '../sim/research';
import { cargoMaxOf, inModuleOrder, loadoutCost, loadoutOf, queueCostFor } from '../sim/loadout';
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
export function statsOf(kind: BuildingKind | UnitKind, research: ResearchMode = 'classic'): StatRow[] {
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
  if (kind === 'researchlab')
    rows.push({
      label: 'Research',
      value: research === 'lines' ? 'Development lines on the Research tab of the build window once it stands' : 'Upgrades listed on the Research tab of the build window once it stands',
    });
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
export function StatTip({
  kind,
  anchor,
  extra,
  research = 'classic',
}: {
  kind: BuildingKind | UnitKind;
  anchor: HTMLElement;
  extra?: ReactNode;
  /** The battle's research mode: only the Research Lab's card reads it. */
  research?: ResearchMode;
}) {
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
        {statsOf(kind, research).map(r => (
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, flex: 1, minWidth: 0, flexDirection: compact ? 'column' : 'row' }}>
        <div style={creditsBox} id="fl-credits" data-testid="credits" title="Credits. Haulers bring ore to a refinery to earn more.">
          <span style={tiny}>Credits</span>
          <Credits value={p.credits} />
        </div>
        <div id="fl-power" style={{ ...creditsBox, flex: 1 }} title={`Power: ${pw.made} made, ${pw.used} used${pw.low ? '. Short: production halves.' : ''}`}>
          <span style={tiny}>
            Power {pw.made}/{pw.used}
            {pw.low && <strong style={{ color: UI.bad, marginLeft: 6 }}>LOW</strong>}
          </span>
          <div style={{ position: 'relative', height: 8, background: UI.ground, borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, width: `${(pw.made / max) * 100}%`, background: UI.good, opacity: 0.75 }} />
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `calc(${Math.min(100, (pw.used / max) * 100)}% - 1px)`,
                width: 2,
                background: pw.low ? UI.bad : UI.text,
              }}
            />
          </div>
        </div>
      </div>

      {compact && (
        <div id="fl-minimap" style={{ width: 104, flex: '0 0 104px' }}>
          {minimap}
        </div>
      )}
      </div>

      {!compact && <div id="fl-minimap">{minimap}</div>}

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
          Build: <strong>{tabLabel(tab)}</strong>
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
            aria-label={`Research: ${UPGRADES[research.id].name}, ${Math.round(Math.min(1, research.progress / researchTicksOf(state, research.id)) * 100)}%. ${touch ? 'Tap to open Research; × cancels it' : 'Click to cancel it'} for a full refund`}
            title={`Research: ${UPGRADES[research.id].name}. ${touch ? 'Tap to open Research; × cancels it' : 'Click to cancel it'} for a full refund`}
            onClick={() => (touch ? onOpenTab('research') : dispatch({ type: 'cancelResearch' }))}
            onContextMenu={e => {
              e.preventDefault();
              if (!touch) dispatch({ type: 'cancelResearch' });
            }}
          >
            <img src={iconFor('researchlab')} alt="" width={48} height={32} />
            <span className="fl-strip-bar research" aria-hidden="true">
              <span style={{ width: `${Math.round(Math.min(1, research.progress / researchTicksOf(state, research.id)) * 100)}%` }} />
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
  // Vehicles carry the loadout's modules in their price (development lines only).
  const cost = tab === 'vehicle' ? queueCostFor(state, 0, kind as UnitKind) : costFor(state, 0, kind);
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
          style={{ flex: 1, minWidth: 0, borderColor: placing === kind ? UI.good : undefined, opacity: open ? 1 : 0.42 }}
        >
          <img src={iconFor(kind)} alt="" width={96} height={64} draggable={false} />
          <span className="fl-build-name">
            {key && <kbd className="fl-key">{key}</kbd>} {nameOf(kind)}
          </span>
          <span className="fl-build-cost" style={{ color: affordable ? UI.textSoft : UI.bad }}>
            {cost}
          </span>
          {isHead && !isReady && (
            <div style={progressWrap}>
              <div style={{ ...progressFill, width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {isReady && <span style={{ ...badge, background: UI.good }}>{placing === kind ? 'Placing' : 'Ready'}</span>}
          {inQueue > 1 && <span style={{ ...badge, background: UI.accent, left: 'auto', right: 3, top: 'auto', bottom: 8 }}>{inQueue}</span>}
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
  const lines = researchModeOf(state) === 'lines';
  return (
    <section className="fl-research" data-testid="research" data-mode={lines ? 'lines' : 'classic'} aria-label="Research">
      <h3 className="fl-research-head">
        Research
        {busy && lowPower && <span className="fl-research-slow">half speed: power low</span>}
      </h3>
      {lines
        ? LINE_ORDER.map(line => <LineRow key={line} state={state} line={line} dispatch={dispatch} />)
        : UPGRADE_ORDER.map(id => {
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
                  title={problem ?? `Research for ${researchCostOf(state, id)} credits`}
                  onClick={() => dispatch({ type: 'research', upgrade: id })}
                >
                  {researchCostOf(state, id)}
                </button>
              )}
            </div>
            <span className="fl-research-blurb">
              {spec.blurb} {!done && <span className="fl-research-time">{secs(researchTicksOf(state, id))}</span>}
              {!done && !running && problem && problem !== 'Not enough credits' && problem !== 'Already researching' && (
                <span className="fl-research-why"> {problemText(problem)}</span>
              )}
            </span>
            {running && (
              <div className="fl-research-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((busy!.progress / researchTicksOf(state, id)) * 100)}>
                <span style={{ width: `${Math.round((busy!.progress / researchTicksOf(state, id)) * 100)}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

type NodeState = 'done' | 'running' | 'ready' | 'blocked' | 'closed' | 'choose';
const MARK_NAME = ['', 'Mk I', 'Mk II', 'Mk III'] as const;

/** Where one node of a development line stands for the player. */
function nodeState(state: GameState, id: UpgradeId): NodeState {
  const p = state.players[0];
  if (hasUpgrade(state, 0, id)) return 'done';
  if (p.research?.id === id) return 'running';
  const { line, mark } = UPGRADE_LINE[id]!;
  if (mark === 3) {
    const chosen = doctrineOf(state, 0, line);
    if (!chosen) return hasUpgrade(state, 0, LINES[line].marks[1]) ? 'choose' : 'blocked';
    if (chosen !== id) return 'closed';
  }
  return researchProblem(state, 0, id) ? 'blocked' : 'ready';
}

/** What the caption line says about one node: its effect, price and time, and what stands in the way. */
function nodeCaption(state: GameState, id: UpgradeId): string {
  const spec = UPGRADES[id];
  const { line, mark } = UPGRADE_LINE[id]!;
  const head = `${spec.name}, ${MARK_NAME[mark]}: ${spec.blurb}`;
  const st = nodeState(state, id);
  if (st === 'done') return `${head} Done.`;
  if (st === 'closed') return `Closed: you adopted ${UPGRADES[doctrineOf(state, 0, line)!].name}.`;
  const price = `${researchCostOf(state, id)} credits, ${secs(researchTicksOf(state, id))}.`;
  if (st === 'running') return `${head} Researching.`;
  if (st === 'choose') return `${head} Adopt this doctrine to research it for ${price} The other one closes for the rest of the battle.`;
  const problem = researchProblem(state, 0, id);
  const why = problem && problem !== 'Already researching' ? ` ${problemText(problem)}` : '';
  return `${head} ${price}${why}`;
}

/** The node the caption describes when nothing is pointed at: the one under way, or the next step. */
function defaultNode(state: GameState, line: LineId): UpgradeId | null {
  const l = LINES[line];
  const ids = [...l.marks, ...l.fork];
  const running = ids.find(id => state.players[0].research?.id === id);
  if (running) return running;
  return ids.find(id => {
    const st = nodeState(state, id);
    return st !== 'done' && st !== 'closed';
  }) ?? null;
}

/**
 * One development line: Mk I, Mk II, then the doctrine fork. The caption under the nodes describes
 * whichever node is pointed at or focused, and otherwise the next step.
 */
function LineRow({ state, line, dispatch }: { state: GameState; line: LineId; dispatch: (a: GameAction) => boolean }) {
  const [hover, setHover] = useState<UpgradeId | null>(null);
  const l = LINES[line];
  const chosen = doctrineOf(state, 0, line);
  const shown = hover ?? defaultNode(state, line);
  const node = (id: UpgradeId) => (
    <LineNode key={id} state={state} id={id} chosen={chosen === id} dispatch={dispatch} onPoint={setHover} />
  );
  const choosing = !chosen && hasUpgrade(state, 0, l.marks[1]);
  return (
    <div className="fl-line-row" data-testid={`line-${line}`} onMouseLeave={() => setHover(null)}>
      <span className="fl-line-label">{l.name}</span>
      <div className="fl-line-nodes">
        {node(l.marks[0])}
        <span className="fl-line-link" aria-hidden="true" />
        {node(l.marks[1])}
        <span className="fl-line-link" aria-hidden="true" />
        <div className="fl-line-fork" role="group" aria-label={`${l.name} doctrine`}>
          {node(l.fork[0])}
          {node(l.fork[1])}
        </div>
      </div>
      <span className="fl-line-caption" aria-live="polite">
        {shown ? nodeCaption(state, shown) : 'Line complete.'}
        {!hover && choosing && ' Adopt one of the two doctrines.'}
      </span>
    </div>
  );
}

function LineNode({
  state,
  id,
  chosen,
  dispatch,
  onPoint,
}: {
  state: GameState;
  id: UpgradeId;
  chosen: boolean;
  dispatch: (a: GameAction) => boolean;
  onPoint: (id: UpgradeId | null) => void;
}) {
  const spec = UPGRADES[id];
  const { line, mark } = UPGRADE_LINE[id]!;
  const st = nodeState(state, id);
  const busy = state.players[0].research;
  const problem = st === 'ready' || st === 'blocked' ? researchProblem(state, 0, id) : null;
  const doctrineWhy = st === 'choose' ? doctrineProblem(state, 0, line, id) : null;
  // Nodes without a button still take focus, so the caption can be read from the keyboard.
  const focusable = st === 'done' || st === 'closed';
  return (
    <div
      className="fl-line-node"
      data-testid={`research-${id}`}
      data-state={st}
      data-doctrine={chosen ? '1' : undefined}
      tabIndex={focusable ? 0 : undefined}
      aria-label={focusable ? `${spec.name}, ${MARK_NAME[mark]}, ${st === 'done' ? 'done' : 'closed'}` : undefined}
      onMouseEnter={() => onPoint(id)}
      onFocus={() => onPoint(id)}
      onBlur={() => onPoint(null)}
    >
      <span className="fl-line-mark">{MARK_NAME[mark]}</span>
      <span className="fl-line-name">{spec.name}</span>
      {st === 'done' ? (
        <span className="fl-research-done">Done</span>
      ) : st === 'running' ? (
        <>
          <div className="fl-research-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((busy!.progress / researchTicksOf(state, id)) * 100)}>
            <span style={{ width: `${Math.round((busy!.progress / researchTicksOf(state, id)) * 100)}%` }} />
          </div>
          <button type="button" className="fl-research-btn" data-kind="cancel" onClick={() => dispatch({ type: 'cancelResearch' })}>
            Cancel
          </button>
        </>
      ) : st === 'choose' ? (
        <button
          type="button"
          className="fl-research-btn fl-line-adopt"
          data-testid={`doctrine-${line}-${id}`}
          disabled={!!doctrineWhy}
          title="Adopt this doctrine. The other one closes for the rest of the battle."
          onClick={() => dispatch({ type: 'doctrine', line, branch: id })}
        >
          Adopt
        </button>
      ) : st === 'closed' ? null : (
        <button
          type="button"
          className="fl-research-btn"
          disabled={!!problem && problem !== 'Not enough credits'}
          title={problem ? problemText(problem) : `Research for ${researchCostOf(state, id)} credits`}
          aria-label={`Research ${spec.name} for ${researchCostOf(state, id)} credits`}
          onClick={() => dispatch({ type: 'research', upgrade: id })}
        >
          {researchCostOf(state, id)}
        </button>
      )}
    </div>
  );
}

/**
 * Loadouts, on the Vehicles tab of a development-lines battle once a module is unlocked: per vehicle
 * kind, the modules every new one is built with. A chip toggles a module; the price shows after.
 */
export function LoadoutPanel({ state, dispatch }: { state: GameState; dispatch: (a: GameAction) => boolean }) {
  if (researchModeOf(state) !== 'lines') return null;
  const ups = state.players[0].upgrades ?? [];
  if (!MODULE_ORDER.some(m => ups.includes(MODULES[m].unlock))) return null;
  const kinds = (menuFor('vehicle', state) as UnitKind[]).filter(k => MODULE_SLOTS[k] && !UNITS[k].hero);
  return (
    <section className="fl-loadout" data-testid="loadout" aria-label="Loadouts">
      <h3 className="fl-research-head">Loadouts</h3>
      <p className="fl-loadout-note">New vehicles are built with these. Units already built keep theirs.</p>
      {kinds.map(kind => {
        const slots = MODULE_SLOTS[kind]!;
        const current = loadoutOf(state, 0, kind);
        const extra = loadoutCost(current);
        const fits = MODULE_ORDER.filter(m => MODULES[m].fits.includes(kind));
        const toggle = (m: ModuleId) => {
          const next = current.includes(m) ? current.filter(x => x !== m) : inModuleOrder([...current, m]);
          dispatch({ type: 'loadout', kind, modules: next });
        };
        return (
          <div key={kind} className="fl-loadout-row" data-testid={`loadout-${kind}`}>
            <span className="fl-loadout-kind">
              {UNITS[kind].name}
              <span className="fl-loadout-slots">
                {current.length}/{slots}
              </span>
            </span>
            <div className="fl-loadout-chips" role="group" aria-label={`${UNITS[kind].name} modules`}>
              {fits.map(m => {
                const spec = MODULES[m];
                const on = current.includes(m);
                const researched = ups.includes(spec.unlock);
                const full = !on && current.length >= slots;
                const title = !researched
                  ? `Unlocked by ${UPGRADES[spec.unlock].name}.`
                  : full
                    ? `${spec.name}: ${spec.blurb} ${slots === 1 ? 'The slot is' : 'Both slots are'} full: take a module off first.`
                    : `${spec.name}, +${spec.cost}: ${spec.blurb}`;
                return (
                  <button
                    key={m}
                    type="button"
                    className="fl-loadout-chip"
                    data-testid={`module-${kind}-${m}`}
                    aria-pressed={on}
                    disabled={!researched || full}
                    title={title}
                    onClick={() => toggle(m)}
                  >
                    {spec.name}
                  </button>
                );
              })}
              {extra > 0 && <span className="fl-loadout-cost">+{extra}</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** A research refusal in the player's words: requirements named as structures. */
function problemText(problem: string): string {
  if (problem === 'Needs Mk I') return 'Research Mk I first.';
  if (problem === 'Needs Mk II') return 'Research Mk II first.';
  if (problem === 'Choose a doctrine first') return 'Adopt a doctrine first.';
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
  const price = tab === 'vehicle' ? queueCostFor(state, 0, kind as UnitKind) : costFor(state, 0, kind);
  const modules = price - costFor(state, 0, kind);
  const short = price - p.credits;
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
      {modules > 0 && <span>Includes {modules} for modules.</span>}
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
  const tipCard = tip && <StatTip kind={tip.key} anchor={tip.el} research={researchModeOf(state)} />;
  if (!units.length && !building) {
    if (touch) {
      return (
        <p style={{ margin: 0, fontSize: '0.74rem', color: UI.textFaint, lineHeight: 1.45 }}>
          Tap a unit to select it, or use Army or Box on the map. With units selected, tap the ground to move and an enemy to attack.
        </p>
      );
    }
    return (
      <p style={{ margin: 0, fontSize: '0.74rem', color: UI.textFaint, lineHeight: 1.45 }}>
        Drag a box or click to select. Right-click to move or attack. <kbd>A</kbd> attack-move, <kbd>S</kbd> stop,{' '}
        <kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>9</kbd> to group. The letter on each build button builds it, <kbd>Tab</kbd>{' '}
        switches lists, <kbd>Space</kbd> jumps to the last alert.
      </p>
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
                style={smallBtn(building.repairing ? UI.good : UI.rule)}
                disabled={building.hp >= spec.hp && !building.repairing}
                onClick={() => dispatch({ type: 'repair', id: building.id })}
                title="Repair (G), paid for as the work is done"
              >
                {building.repairing ? 'Repairing…' : 'Repair'}
              </button>
              <button
                style={smallBtn(UI.bad)}
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
            className="fl-has-tip"
            {...bind(kind)}
            style={{ fontSize: '0.74rem', padding: '2px 6px', border: `1px solid ${UI.rule}`, borderRadius: 3, color: mine ? UI.text : UI.enemy }}
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
          Carrying {one.cargo} of {cargoMaxOf(one)} ore.{' '}
          {one.order.type === 'harvest' ? 'Harvesting.' : touch ? 'Idle: tap ore or a refinery.' : 'Idle: right-click ore or a refinery.'}
        </span>
      )}
      {one && one.modules && one.modules.length > 0 && (
        <span style={{ fontSize: '0.72rem', color: UI.textSoft }} data-testid="unit-modules">
          Modules: {one.modules.map(m => MODULES[m]?.name ?? m).join(', ')}.
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
          <button style={smallBtn(UI.rule)} onClick={() => dispatch({ type: 'stop', ids: units.map(u => u.id) })}>
            {touch ? 'Stop' : 'Stop (S)'}
          </button>
        </div>
      )}
      {mine && <ActionButtons state={state} sel={{ units, building: null }} dispatch={dispatch} touch={touch} />}
      {mine && units.some(u => UNITS[u.kind].weapon) && (
        <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="Stance">
          {STANCE_BUTTONS.map(([stance, label, title]) => {
            const armed = units.filter(u => UNITS[u.kind].weapon);
            const on = armed.every(u => u.stance === stance);
            return (
              <button
                key={stance}
                data-stance={stance}
                aria-pressed={on}
                style={{ ...smallBtn(on ? UI.good : UI.rule), padding: '4px 7px', fontWeight: on ? 600 : 400 }}
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
          style={smallBtn(UI.rule)}
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

function Bar({ frac }: { frac: number }) {
  return (
    <div style={{ height: 5, background: UI.ground, borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: frac > 0.6 ? UI.good : frac > 0.3 ? UI.warn : UI.bad }} />
    </div>
  );
}

const smallBtn = (border: string): CSSProperties => ({
  fontFamily: 'inherit',
  fontSize: '0.74rem',
  padding: '4px 9px',
  border: `1px solid ${border}`,
  background: UI.panelRaised,
  color: UI.text,
  borderRadius: 3,
  cursor: 'pointer',
});

const creditsBox: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: '5px 9px',
  background: UI.panelRaised,
  border: `1px solid ${UI.rule}`,
  borderRadius: 4,
  minWidth: 92,
};

const tiny: CSSProperties = {
  fontSize: '0.6rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: UI.textFaint,
};

const progressWrap: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: 4,
  background: UI.scrim,
};

const progressFill: CSSProperties = {
  height: '100%',
  background: UI.accent,
};

const badge: CSSProperties = {
  position: 'absolute',
  top: 3,
  left: 3,
  fontSize: '0.6rem',
  fontWeight: 700,
  color: UI.ground,
  borderRadius: 2,
  padding: '1px 4px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};
