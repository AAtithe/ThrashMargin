import type { CSSProperties, ReactNode } from 'react';
import {
  BUILD_MENU,
  BUILDINGS,
  INFANTRY_MENU,
  MAX_QUEUE,
  PRODUCER,
  UNITS,
  VEHICLE_MENU,
  type BuildingKind,
  type Category,
  type UnitKind,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
        <div style={creditsBox} id="fl-credits" data-testid="credits" title="Credits. Haulers bring ore to a refinery to earn more.">
          <span style={tiny}>Credits</span>
          <span style={{ fontFamily: FONT.mono, fontSize: '1.15rem', color: UI.accent, fontVariantNumeric: 'tabular-nums' }}>
            {money(p.credits)}
          </span>
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
        {MENUS[tab].map(kind => {
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
          const disabled = !open || blockedByOther || (!isHead && !isReady && (full || !affordable));
          const missing = needsOf(kind).filter(r => !hasBuilding(state, 0, r));
          const title = !open
            ? `${nameOf(kind)}: needs ${missing.map(r => BUILDINGS[r].name).join(' and ')}`
            : `${nameOf(kind)}, ${cost} credits. ${blurbOf(kind)}${isHead ? ' Right-click to cancel.' : ''}`;
          return (
            <button
              key={kind}
              id={`fl-build-${kind}`}
              className={`fl-build${isReady ? ' ready' : ''}`}
              data-testid={`build-${kind}`}
              data-state={!open ? 'locked' : isReady ? 'ready' : isHead ? 'building' : 'idle'}
              disabled={disabled}
              title={title}
              aria-pressed={placing === kind}
              onClick={() => {
                if (isReady) setPlacing(placing === kind ? null : kind);
                else if (tab !== 'building' || !isHead) dispatch({ type: 'queue', category: tab, kind });
              }}
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
              <span style={{ fontWeight: 600, lineHeight: 1.1, textAlign: 'center' }}>{nameOf(kind)}</span>
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
  if (!units.length && !building) {
    return (
      <p style={{ margin: 0, fontSize: '0.74rem', color: UI.textFaint, lineHeight: 1.45 }}>
        Drag a box or click to select. Right-click to move or attack. <kbd>A</kbd> attack-move, <kbd>S</kbd> stop,{' '}
        <kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>9</kbd> to group.
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
          <strong style={{ fontSize: '0.85rem', color: mine ? UI.text : UI.enemy }}>
            {mine ? '' : 'Enemy '}
            {spec.name}
          </strong>
          <span style={{ fontFamily: FONT.mono, fontSize: '0.72rem', color: UI.textSoft }}>
            {Math.ceil(building.hp)}/{spec.hp}
          </span>
        </div>
        <Bar frac={building.hp / spec.hp} />
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
                title="Repair, paid for as the work is done"
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
          <span key={kind} style={{ fontSize: '0.74rem', padding: '2px 6px', border: `1px solid ${UI.rule}`, borderRadius: 3, color: mine ? UI.text : UI.enemy }}>
            {n > 1 ? `${n}× ` : ''}
            {mine ? '' : 'Enemy '}
            {UNITS[kind].name}
          </span>
        ))}
      </div>
      <Bar frac={hp / Math.max(1, max)} />
      {one && one.kind === 'hauler' && mine && (
        <span style={{ fontSize: '0.72rem', color: UI.textSoft }}>
          Carrying {one.cargo} of 600 ore.{' '}
          {one.order.type === 'harvest' ? 'Harvesting.' : 'Idle: right-click ore or a refinery.'}
        </span>
      )}
      {one && one.kills > 0 && <span style={{ fontSize: '0.72rem', color: UI.textSoft }}>{one.kills} kills</span>}
      {mine && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={smallBtn(UI.rule)} onClick={() => dispatch({ type: 'stop', ids: units.map(u => u.id) })}>
            Stop (S)
          </button>
        </div>
      )}
    </div>
  );
}

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
