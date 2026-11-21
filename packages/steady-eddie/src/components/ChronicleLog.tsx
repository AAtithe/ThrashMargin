import { useEffect, useRef, useState } from 'react';
import { LiveRegion } from '../lib/Kit';
import { FONT, UI } from '../theme';
import { Empty, Label, Panel } from './ui';
import type { Haulier, LogEntry, LogKind } from '../sim/types';

/** Colour by what kind of thing happened, not by who did it — the haulier's own colour is the dot. */
const KIND_COLOUR: Partial<Record<LogKind, string>> = {
  deliver: UI.good,
  missed: UI.bad,
  share: UI.verdigris,
  vehicle: UI.verdigris,
  declare: UI.warn,
  lapse: UI.warn,
  victory: UI.brass,
  contract: UI.textSoft,
};

export default function ChronicleLog({
  log,
  hauliers,
  limit = 40,
}: {
  log: LogEntry[];
  hauliers: Haulier[];
  limit?: number;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const entries = log.slice(-limit);
  const lastSeq = entries.length ? entries[entries.length - 1].seq : 0;

  // Follow the tail. Keyed on the newest seq rather than array length, because the log is trimmed
  // from the front — its length stops changing long before the entries do.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastSeq]);

  return (
    <Panel title="The log" aside={<Label>newest last</Label>}>
      <div ref={scroller} style={scrollerStyle}>
        {entries.length === 0 ? (
          <Empty>Nothing has happened yet.</Empty>
        ) : (
          entries.map(entry => {
            const haulier = hauliers.find(c => c.id === entry.haulierId);
            return (
              <p key={entry.seq} style={line} className="tm-anim-rise">
                <span style={{ ...dot, background: haulier?.colour ?? 'transparent' }} />
                <span style={{ color: KIND_COLOUR[entry.kind] ?? UI.textSoft }}>{entry.text}</span>
              </p>
            );
          })
        )}
      </div>
    </Panel>
  );
}

/**
 * Reads new log entries to a screen reader, politely, as they land. Lives outside the panels
 * (which are aria-hidden while put away) so the game is heard with the log closed. What was
 * already in the log when the screen opened is not read out.
 */
export function LogAnnouncer({ log }: { log: LogEntry[] }) {
  const seen = useRef<number | null>(null);
  const [message, setMessage] = useState('');
  const [nonce, setNonce] = useState(0);
  const lastSeq = log.length ? log[log.length - 1].seq : 0;
  useEffect(() => {
    if (seen.current === null) {
      seen.current = lastSeq;
      return;
    }
    const since = seen.current;
    seen.current = lastSeq;
    const fresh = log.filter(e => e.seq > since);
    if (fresh.length === 0) return;
    // A whole rival turn can land at once; the last few are what matter.
    setMessage(fresh.slice(-5).map(e => e.text).join(' '));
    setNonce(n => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSeq]);
  return <LiveRegion message={message} nonce={nonce} />;
}

const scrollerStyle: React.CSSProperties = {
  maxHeight: 220,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  paddingRight: '0.2rem',
};

const line: React.CSSProperties = {
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '0.45rem',
  alignItems: 'baseline',
  fontFamily: FONT.body,
  fontSize: '0.78rem',
  lineHeight: 1.4,
};

const dot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  display: 'inline-block',
  transform: 'translateY(-1px)',
};
