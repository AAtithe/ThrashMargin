import { useRef } from 'react';
import type { GameState } from '../sim/types';
import { FONT, UI } from '../theme';
import { clock } from '../lib/format';
import { paced, usePace } from '../lib/motion';
import { LiveRegion } from '../lib/Kit';

const TONES = { good: UI.good, bad: UI.bad, neutral: UI.text, honour: UI.brass } as const;

export default function Chronicle({ s }: { s: GameState }) {
  const pace = usePace();
  // Lines already written when this character came on screen appear at once; lines written since
  // rise in, oldest first, a beat apart. Each new line's delay is fixed when it is first seen, so a
  // later re-render never restarts its animation. With motion off no line carries a class at all.
  const seen = useRef<{ id: string; base: number; delays: Map<number, number> } | null>(null);
  const lastSeq = s.log.length ? s.log[s.log.length - 1].seq : -1;
  if (!seen.current || seen.current.id !== s.id) seen.current = { id: s.id, base: lastSeq, delays: new Map() };
  const mem = seen.current;
  if (pace === 'off') {
    // Nothing animates, and switching motion back on must not replay lines already on screen.
    mem.base = lastSeq;
    mem.delays.clear();
  }
  let fresh = 0;
  for (const e of s.log) {
    if (e.seq <= mem.base || mem.delays.has(e.seq)) continue;
    mem.delays.set(e.seq, fresh++ * paced(110, pace));
  }
  // New lines are read out to a screen reader, oldest first, once each, without their times. Only
  // lines the chronicle gains: the screen's one-second clock re-renders this without adding any, so
  // nothing is said for the clock itself. Lines already there when the character opens are not read.
  const said = useRef<{ id: string; seq: number; message: string } | null>(null);
  if (!said.current || said.current.id !== s.id) said.current = { id: s.id, seq: lastSeq, message: '' };
  if (lastSeq > said.current.seq) {
    const since = said.current.seq;
    said.current.message = s.log.filter(e => e.seq > since).map(e => e.text).join(' ');
    said.current.seq = lastSeq;
  }
  const entries = [...s.log].reverse().slice(0, 80);
  return (
    <aside style={{ width: 300, flexShrink: 0, borderLeft: `1px solid ${UI.rule}`, background: UI.panel, padding: '1rem', overflowY: 'auto', maxHeight: '100vh', position: 'sticky', top: 0 }}>
      <h2 style={{ margin: '0 0 0.7rem', fontFamily: FONT.display, fontSize: '1rem', color: UI.brass, fontWeight: 'normal' }}>Chronicle</h2>
      <LiveRegion message={said.current.message} nonce={said.current.seq} />
      {entries.map(e => {
        const delay = mem.delays.get(e.seq);
        return (
          <div
            key={e.seq}
            className={delay !== undefined ? 'tm-anim-rise' : undefined}
            style={{ fontSize: '0.75rem', lineHeight: 1.45, padding: '0.35rem 0', borderTop: `1px solid ${UI.rule}`, ...(delay ? { animationDelay: `${delay}ms` } : {}) }}
          >
            <span style={{ fontFamily: FONT.data, fontSize: '0.65rem', color: UI.textFaint, marginRight: 6 }}>{clock(e.at)}</span>
            <span style={{ color: TONES[e.tone] }}>{e.text}</span>
          </div>
        );
      })}
    </aside>
  );
}
