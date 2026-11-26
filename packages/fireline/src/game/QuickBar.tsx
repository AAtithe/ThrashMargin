/**
 * The quick bar (fireline-round8-build-window.md, section 7): up to six items pinned from any build
 * list, along the battlefield's upper left whether the build window is open or not. A slot queues
 * or places exactly as its card does (pressBuild), shows its progress, and right-click cancels the
 * last one queued. Keys F1 F2 F3 F4 F6 F7 (GameScreen's keyboard handler).
 */
import { BUILDINGS, type BuildingKind, type UnitKind } from '../sim/rules';
import { buildTicksFor, categoryOf, costFor, readyStructure } from '../sim/state';
import { buildingSpecFor, factionOf, unitSpecFor } from '../sim/specs';
import type { GameAction, GameState } from '../sim/types';
import { isOpen, type Kind } from './buildPlan';
import { QUICK_KEYS, pins, togglePin, useStore } from './buildStores';
import { iconFor } from './icons';
import { menuFor, pressBuild } from './Sidebar';

export default function QuickBar({
  state,
  dispatch,
  placing,
  setPlacing,
}: {
  state: GameState;
  dispatch: (a: GameAction) => boolean;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
}) {
  const list = useStore(pins);
  if (!list.length) return null;
  const f = factionOf(state, 0);
  const p = state.players[0];
  return (
    <div className="fl-quick" role="toolbar" aria-label="Quick bar" data-testid="quick-bar">
      {list.map((kind: Kind, i) => {
        const tab = categoryOf(kind);
        const here = menuFor(tab, state).includes(kind);
        const name = kind in BUILDINGS ? buildingSpecFor(f, kind as BuildingKind).name : unitSpecFor(f, kind as UnitKind).name;
        const q = p.queues[tab];
        const head = q.find(x => x.kind === kind);
        const count = q.filter(x => x.kind === kind).length;
        const ready = tab === 'building' && readyStructure(state, 0) === kind;
        const pct = head && !ready ? Math.min(100, Math.floor((head.progress / buildTicksFor(state, 0, kind)) * 100)) : 0;
        const open = here && isOpen(state, kind);
        const cost = costFor(state, 0, kind);
        return (
          <div key={kind} className="fl-quick-slot">
            <button
              type="button"
              id={`fl-quick-${kind}`}
              data-testid={`quick-${kind}`}
              className="fl-quick-btn"
              data-state={!open ? 'locked' : ready ? 'ready' : head ? 'building' : 'idle'}
              data-afford={p.credits >= cost ? '1' : '0'}
              aria-pressed={placing === kind}
              aria-keyshortcuts={QUICK_KEYS[i]}
              disabled={!open}
              aria-label={`${name}, ${cost} credits, key ${QUICK_KEYS[i]}${!here ? ', not in this battle' : !open ? ', locked' : ''}`}
              title={`${name} (${QUICK_KEYS[i]})${!here ? ': not in this battle' : !open ? ': locked' : ''}. Right-click cancels one.`}
              onClick={e => pressBuild(state, tab, kind, placing, dispatch, setPlacing, e.shiftKey)}
              onContextMenu={e => {
                e.preventDefault();
                if (count) {
                  dispatch({ type: 'cancel', category: tab, kind });
                  if (placing === kind) setPlacing(null);
                }
              }}
            >
              <img src={iconFor(kind)} alt="" width={48} height={32} draggable={false} />
              <kbd className="fl-quick-key">{QUICK_KEYS[i]}</kbd>
              {head && !ready && <span className="fl-quick-prog" style={{ width: `${pct}%` }} aria-hidden="true" />}
              {ready && <span className="fl-quick-badge">{placing === kind ? 'Placing' : 'Ready'}</span>}
              {count > 1 && <span className="fl-quick-count">×{count}</span>}
            </button>
            <button type="button" className="fl-quick-unpin" data-testid={`unpin-${kind}`} aria-label={`Unpin ${name}`} title="Unpin" onClick={() => togglePin(kind)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
