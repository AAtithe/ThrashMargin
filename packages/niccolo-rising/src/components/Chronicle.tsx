import type { GameState } from '../sim/types';
import { FONT, UI } from '../theme';
import { clock } from '../lib/format';

const TONES = { good: UI.good, bad: UI.bad, neutral: UI.text, honour: UI.brass } as const;

/** `embedded` drops the column's own width, border and heading, for when it sits inside a floating panel. */
export default function Chronicle({ s, embedded = false }: { s: GameState; embedded?: boolean }) {
  const entries = [...s.log].reverse().slice(0, 80);
  return (
    <aside style={embedded ? { padding: '0 0.1rem' } : { width: 300, flexShrink: 0, borderLeft: `1px solid ${UI.rule}`, background: UI.panel, padding: '1rem', overflowY: 'auto', maxHeight: '100vh', position: 'sticky', top: 0 }}>
      {!embedded && <h2 style={{ margin: '0 0 0.7rem', fontFamily: FONT.display, fontSize: '1rem', color: UI.brass, fontWeight: 'normal' }}>Chronicle</h2>}
      {entries.map(e => (
        <div key={e.seq} style={{ fontSize: '0.75rem', lineHeight: 1.45, padding: '0.35rem 0', borderTop: `1px solid ${UI.rule}` }}>
          <span style={{ fontFamily: FONT.data, fontSize: '0.65rem', color: UI.textFaint, marginRight: 6 }}>{clock(e.at)}</span>
          <span style={{ color: TONES[e.tone] }}>{e.text}</span>
        </div>
      ))}
    </aside>
  );
}
