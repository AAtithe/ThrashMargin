/**
 * The chronicle: everything that has happened, newest first, filterable.
 */
import { useState } from 'react';
import { FACTION_COLORS, type GameState, type LogKind } from 'shared/sim';
import { UI } from '../theme';

const FILTERS: Array<{ id: string; label: string; kinds: LogKind[] | null }> = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'war', label: 'War', kinds: ['battle', 'capture'] },
  { id: 'realm', label: 'Realm', kinds: ['economy', 'build', 'research'] },
  { id: 'world', label: 'World', kinds: ['event', 'diplomacy', 'system', 'achievement'] },
];

export default function LogPanel({ state }: { state: GameState }) {
  const [filter, setFilter] = useState('all');
  const [mine, setMine] = useState(false);
  const f = FILTERS.find(x => x.id === filter)!;
  const rows = state.log.filter(l => (!f.kinds || f.kinds.includes(l.kind)) && (!mine || l.faction === state.activeFaction));
  let lastTurn = -1;
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTERS.map(x => (
          <button key={x.id} type="button" onClick={() => setFilter(x.id)} className="tm-btn"
            style={{ padding: '3px 9px', borderRadius: 12, fontSize: 11.5, cursor: 'pointer', background: filter === x.id ? UI.accent : 'transparent', color: filter === x.id ? UI.accentInk : UI.textSoft, border: `1px solid ${filter === x.id ? UI.accent : UI.rule}` }}>
            {x.label}
          </button>
        ))}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: UI.textSoft, marginLeft: 'auto' }}>
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Mine only
        </label>
      </div>
      <div style={{ display: 'grid', gap: 2 }}>
        {rows.length === 0 && <div style={{ fontSize: 12, color: UI.textFaint }}>Nothing yet.</div>}
        {rows.map((l, i) => {
          const header = l.turn !== lastTurn;
          lastTurn = l.turn;
          return (
            <div key={i}>
              {header && <div style={{ fontSize: 10.5, color: UI.textFaint, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '8px 0 3px' }}>Turn {l.turn}</div>}
              <div style={{ display: 'flex', gap: 7, fontSize: 12, lineHeight: 1.45, color: l.kind === 'achievement' ? UI.accent : UI.text }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, marginTop: 5, flexShrink: 0, background: (FACTION_COLORS[l.faction] ?? FACTION_COLORS[0]).fill }} />
                <span>{l.message}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
