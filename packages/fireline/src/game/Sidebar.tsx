import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BUILD_MENU,
  BUILDINGS,
  DAMAGE_VS,
  INFANTRY_MENU,
  MAX_QUEUE,
  PRODUCER,
  UNITS,
  TICKS_PER_SECOND,
  VEHICLE_MENU,
  type Armor,
  type BuildingKind,
  type Category,
  type UnitKind,
  type WeaponKind,
} from '../sim/rules';
import { buildTicksOf, costOf, hasBuilding, powerOf, readyStructure, unlocked } from '../sim/state';
import type { GameAction, GameState } from '../sim/types';
import { FONT, UI, money } from '../theme';
import { iconFor } from './icons';

export type Tab = Category;

const TABS: { key: Tab; label: string }[] = [
  { key: 'building', label: 'Structures' },
  { key: 'infantry', label: 'Infantry' },
  { key: 'vehicle', label: 'Vehicles' },
];

const MENUS: Record<Tab, (BuildingKind | UnitKind)[]> = {
  building: BUILD_MENU,
  infantry: INFANTRY_MENU,
  vehicle: VEHICLE_MENU,
};

const nameOf = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? BUILDINGS[k as BuildingKind].name : UNITS[k as UnitKind].name);
const blurbOf = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? BUILDINGS[k as BuildingKind].blurb : UNITS[k as UnitKind].blurb);
const needsOf = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? BUILDINGS[k as BuildingKind].requires : UNITS[k as UnitKind].requires);

/** The build hotkeys, in menu order: the first item on the open tab is Q, the second W, and so on. */
export const BUILD_KEYS = ['q', 'w', 'e', 'r', 't', 'y'] as const;

/** Items for each tab, in menu (and hotkey) order. */
export const menuFor = (tab: Tab) => MENUS[tab];

/** The order Tab cycles through. */
export const TAB_ORDER: Tab[] = TABS.map(t => t.key);

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
  const head = state.players[0].queues[tab][0];
  if (tab === 'building' && readyStructure(state, 0) === kind) {
    setPlacing(placing === kind ? null : (kind as BuildingKind));
    return;
  }
  if (tab === 'building' && head && head.kind === kind) return;
  const n = batch && tab !== 'building' ? BATCH : 1;
  for (let i = 0; i < n; i++) if (!dispatch({ type: 'queue', category: tab, kind })) break;
}

const ARMOR_NAME: Record<Armor, string> = { infantry: 'Infantry', light: 'Light', heavy: 'Heavy', building: 'Structure' };
const WEAPON_NAME: Record<WeaponKind, string> = { bullet: 'Machine gun', shell: 'Cannon', rocket: 'Rockets', artillery: 'Artillery shell' };
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
    rows.push({
      label: 'Damage vs',
      value: (['infantry', 'light', 'heavy', 'building'] as Armor[]).map(a => `${ARMOR_NAME[a].toLowerCase()} ${Math.round(vs[a] * 100)}%`).join(' · '),
    });
  }
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
    // Clear of the whole sidebar, so the card never hides the neighbouring buttons.
    const edge = (anchor.closest('aside') ?? anchor).getBoundingClientRect().left;
    el.style.left = `${Math.max(8, edge - el.offsetWidth - 8)}px`;
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
function useTip<K>() {
  const [tip, setTip] = useState<{ key: K; el: HTMLElement } | null>(null);
  const bind = (key: K) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => setTip({ key, el: e.currentTarget }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => setTip({ key, el: e.currentTarget }),
    onBlur: () => setTip(null),
  });
  return { tip: tip && tip.el.isConnected ? tip : null, bind, clear: () => setTip(null) };
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
 * Credits, power, the build menu and the queues. Everything here reads the live state handed in
 * on each HUD refresh; every button sends an ordinary action through `dispatch`.
 */
export function BuildPanel({
  state,
  tab,
  setTab,
  dispatch,
  placing,
  setPlacing,
  minimap,
}: {
  state: GameState;
  tab: Tab;
  setTab: (t: Tab) => void;
  dispatch: (a: GameAction) => boolean;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
  minimap: ReactNode;
}) {
  const p = state.players[0];
  const pw = powerOf(state, 0);
  const ready = readyStructure(state, 0);
  const max = Math.max(pw.made, pw.used, 100);
  const { tip, bind, clear } = useTip<BuildingKind | UnitKind>();
  // A tab change swaps the buttons out from under the pointer: drop the card with them.
  useEffect(clear, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
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

      <div id="fl-minimap">{minimap}</div>

      <div role="tablist" style={{ display: 'flex', gap: 2 }}>
        {TABS.map(t => {
          const producer = hasBuilding(state, 0, PRODUCER[t.key]);
          const busy = p.queues[t.key].length;
          return (
            <button
              key={t.key}
              id={`fl-tab-${t.key}`}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              title={`${t.label} (Tab cycles the lists)`}
              style={{
                flex: 1,
                padding: '5px 2px',
                fontFamily: 'inherit',
                fontSize: '0.72rem',
                fontWeight: tab === t.key ? 700 : 500,
                border: `1px solid ${tab === t.key ? UI.accent : UI.rule}`,
                background: tab === t.key ? UI.tintAccent : 'transparent',
                color: producer ? UI.text : UI.textFaint,
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              {t.label}
              {busy > 0 && <span style={{ color: UI.accent }}> ·{busy}</span>}
            </button>
          );
        })}
      </div>

      {!hasBuilding(state, 0, PRODUCER[tab]) && (
        <p style={{ margin: 0, fontSize: '0.72rem', color: UI.textFaint }}>
          {tab === 'building'
            ? 'Your Command Yard is gone. No new structures can be built.'
            : `Build a ${BUILDINGS[PRODUCER[tab]].name} to unlock this list.`}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 5 }}>
        {MENUS[tab].map((kind, index) => {
          const q = p.queues[tab];
          const inQueue = q.filter(i => i.kind === kind).length;
          const head = q[0];
          const isHead = head && head.kind === kind;
          const progress = isHead ? head.progress / buildTicksOf(kind) : 0;
          const open = unlocked(state, 0, kind);
          const cost = costOf(kind);
          const isReady = tab === 'building' && ready === kind;
          const blockedByOther = tab === 'building' && q.length > 0 && !isHead;
          const full = tab !== 'building' && q.length >= MAX_QUEUE;
          const affordable = p.credits >= cost;
          // Unaffordable stays clickable: the click is refused with a toast that says why.
          const disabled = !open || blockedByOther || (!isHead && !isReady && full);
          const key = BUILD_KEYS[index]?.toUpperCase();
          return (
            <button
              key={kind}
              id={`fl-build-${kind}`}
              className={`fl-build${isReady ? ' ready' : ''}`}
              data-testid={`build-${kind}`}
              data-state={!open ? 'locked' : isReady ? 'ready' : isHead ? 'building' : 'idle'}
              data-afford={affordable ? '1' : '0'}
              disabled={disabled}
              aria-label={`${nameOf(kind)}, ${cost} credits${key ? `, hotkey ${key}` : ''}`}
              aria-keyshortcuts={key}
              aria-pressed={placing === kind}
              {...bind(kind)}
              onClick={e => pressBuild(state, tab, kind, placing, dispatch, setPlacing, e.shiftKey)}
              onContextMenu={e => {
                e.preventDefault();
                if (inQueue) {
                  dispatch({ type: 'cancel', category: tab, kind });
                  if (placing === kind) setPlacing(null);
                }
              }}
              style={{ borderColor: placing === kind ? UI.good : undefined, opacity: open ? 1 : 0.42 }}
            >
              <img src={iconFor(kind)} alt="" width={96} height={64} style={{ width: '100%', height: 'auto', borderRadius: 2, display: 'block' }} />
              <span style={{ fontWeight: 600, lineHeight: 1.1, textAlign: 'center' }}>
                {key && <kbd className="fl-key">{key}</kbd>} {nameOf(kind)}
              </span>
              <span style={{ fontFamily: FONT.mono, color: affordable ? UI.textSoft : UI.bad }}>{cost}</span>
              {isHead && !isReady && (
                <div style={progressWrap}>
                  <div style={{ ...progressFill, width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}
              {isReady && <span style={{ ...badge, background: UI.good }}>{placing === kind ? 'Placing' : 'Ready'}</span>}
              {inQueue > 1 && <span style={{ ...badge, background: UI.accent, left: 'auto', right: 3 }}>{inQueue}</span>}
            </button>
          );
        })}
      </div>
      {tip && (
        <StatTip
          kind={tip.key}
          anchor={tip.el}
          extra={<BuildTipFooter state={state} tab={tab} kind={tip.key} hotkey={BUILD_KEYS[MENUS[tab].indexOf(tip.key)]} lowPower={pw.low} />}
        />
      )}
    </div>
  );
}

/** The live part of a build button's card: what stands in the way right now, and the keys. */
function BuildTipFooter({
  state,
  tab,
  kind,
  hotkey,
  lowPower,
}: {
  state: GameState;
  tab: Tab;
  kind: BuildingKind | UnitKind;
  hotkey?: string;
  lowPower: boolean;
}) {
  const p = state.players[0];
  const missing = needsOf(kind).filter(r => !hasBuilding(state, 0, r));
  const short = costOf(kind) - p.credits;
  const notes: string[] = [];
  if (missing.length) notes.push(`Locked: build a ${missing.map(r => BUILDINGS[r].name).join(' and a ')} first.`);
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
}: {
  state: GameState;
  selected: Set<number>;
  dispatch: (a: GameAction) => boolean;
}) {
  const units = state.units.filter(u => selected.has(u.id));
  const building = state.buildings.find(b => selected.has(b.id));
  const { tip, bind } = useTip<BuildingKind | UnitKind>();
  const tipCard = tip && <StatTip kind={tip.key} anchor={tip.el} />;
  if (!units.length && !building) {
    return (
      <p style={{ margin: 0, fontSize: '0.74rem', color: UI.textFaint, lineHeight: 1.45 }}>
        Drag a box or click to select. Right-click to move or attack. <kbd>A</kbd> attack-move, <kbd>S</kbd> stop,{' '}
        <kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>9</kbd> to group. <kbd>Q</kbd>–<kbd>Y</kbd> build from the open list, <kbd>Tab</kbd>{' '}
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
              {(building.kind === 'barracks' || building.kind === 'factory') && ' Right-click the map to set where new units gather.'}
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
          </>
        )}
      </div>
    );
  }
  const counts = new Map<UnitKind, number>();
  for (const u of units) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
  const hp = units.reduce((a, u) => a + u.hp, 0);
  const max = units.reduce((a, u) => a + UNITS[u.kind].hp, 0);
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
          Carrying {one.cargo} of 600 ore.{' '}
          {one.order.type === 'harvest' ? 'Harvesting.' : 'Idle: right-click ore or a refinery.'}
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
            Stop (S)
          </button>
        </div>
      )}
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
