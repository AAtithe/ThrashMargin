/**
 * Territories held per faction, turn by turn. One axis, 2px lines in each faction's validated
 * series colour, a legend plus end-of-line labels, and a crosshair tooltip on hover.
 */
import { useMemo, useState } from 'react';
import { factionName, type GameState } from 'shared/sim';
import { FONT, UI } from '../theme';

/** Series colours, checked with the dataviz validator against the panel surface (dark). */
export const SERIES: Record<number, string> = { 1: '#4f8fd6', 2: '#d9605a', 3: '#9a7ad6', 4: '#3f9e70' };

type Metric = 'territories' | 'troops' | 'gold';
const METRIC_LABEL: Record<Metric, string> = { territories: 'Territories', troops: 'Troops', gold: 'Gold' };

export default function HistoryChart({ state, height = 180 }: { state: GameState; height?: number }) {
  const [metric, setMetric] = useState<Metric>('territories');
  const [hover, setHover] = useState<number | null>(null);
  const ids = Object.keys(state.factions).map(Number).sort((a, b) => a - b);
  const rows = state.history;
  const W = 420, H = height, L = 30, R = 64, T = 10, B = 22;

  const max = useMemo(() => Math.max(1, ...rows.flatMap(r => ids.map(id => r.factions[id]?.[metric] ?? 0))), [rows, ids, metric]);
  if (rows.length < 2) return <div style={{ fontSize: 12, color: UI.textFaint }}>The chart fills in after a couple of turns.</div>;

  const x = (i: number) => L + (i / (rows.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, Math.round(max / 2), max];

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {(Object.keys(METRIC_LABEL) as Metric[]).map(m => (
          <button key={m} type="button" onClick={() => setMetric(m)} className="tm-btn"
            style={{ padding: '3px 9px', borderRadius: 12, fontSize: 11.5, cursor: 'pointer', background: metric === m ? UI.accent : 'transparent', color: metric === m ? UI.accentInk : UI.textSoft, border: `1px solid ${metric === m ? UI.accent : UI.rule}` }}>
            {METRIC_LABEL[m]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {ids.map(id => (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: UI.textSoft }}>
            <span style={{ width: 10, height: 2, background: SERIES[id] }} />{factionName(state, id)}
          </span>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}
          onMouseLeave={() => setHover(null)}
          onMouseMove={e => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const i = Math.round(((px - L) / (W - L - R)) * (rows.length - 1));
            setHover(Math.max(0, Math.min(rows.length - 1, i)));
          }}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={UI.rule} strokeWidth={1} />
              <text x={L - 5} y={y(t) + 3} textAnchor="end" fontSize={9} fill={UI.textFaint} fontFamily={FONT.data}>{t}</text>
            </g>
          ))}
          <text x={L} y={H - 6} fontSize={9} fill={UI.textFaint}>Turn {rows[0].turn}</text>
          <text x={W - R} y={H - 6} fontSize={9} fill={UI.textFaint} textAnchor="end">Turn {rows[rows.length - 1].turn}</text>
          {ids.map(id => {
            const pts = rows.map((r, i) => [x(i), y(r.factions[id]?.[metric] ?? 0)] as const);
            const lastV = rows[rows.length - 1].factions[id]?.[metric] ?? 0;
            return (
              <g key={id}>
                <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={SERIES[id]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <text x={W - R + 6} y={y(lastV) + 3} fontSize={9.5} fill={UI.textSoft}>{factionName(state, id).split(' ')[0]} {lastV}</text>
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke={UI.textFaint} strokeWidth={1} />
              {ids.map(id => <circle key={id} cx={x(hover)} cy={y(rows[hover].factions[id]?.[metric] ?? 0)} r={4} fill={SERIES[id]} stroke={UI.panelRaised} strokeWidth={2} />)}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div style={{ position: 'absolute', top: 0, left: `${(x(hover) / W) * 100}%`, transform: `translateX(${x(hover) > W / 2 ? '-105%' : '5%'})`, background: UI.panel, border: `1px solid ${UI.ruleStrong}`, borderRadius: 6, padding: '6px 8px', fontSize: 11, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            <div style={{ color: UI.textFaint, marginBottom: 2 }}>Turn {rows[hover].turn}</div>
            {ids.map(id => (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, color: UI.text }}>
                <span style={{ width: 8, height: 2, background: SERIES[id] }} />{factionName(state, id)}: <b>{rows[hover].factions[id]?.[metric] ?? 0}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
