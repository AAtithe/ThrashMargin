import { useEffect, useRef } from 'react';
import { FONT, UI } from '../theme';
import { Empty, Label, Panel } from './ui';
import type { Captain, LogEntry, LogKind } from '../sim/types';

/** Colour by what kind of thing happened, not by who did it — the captain's own colour is the dot. */
const KIND_COLOUR: Partial<Record<LogKind, string>> = {
  deliver: UI.good,
  missed: UI.bad,
  share: UI.verdigris,
  ship: UI.verdigris,
  declare: UI.warn,
  lapse: UI.warn,
  victory: UI.brass,
  contract: UI.textSoft,
  teaRace: UI.brass,
  encounter: UI.verdigris,
  crackOn: UI.textSoft,
  repair: UI.textSoft,
  charter: UI.brass,
  renown: UI.brass,
  era: UI.brass,
  career: UI.verdigris,
  letter: UI.verdigris,
  wager: UI.brass,
};

export default function ChronicleLog({
  log,
  captains,
  limit = 40,
}: {
  log: LogEntry[];
  captains: Captain[];
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
      {/* A polite live log: new entries are read out as they land. The panel holding it is
          aria-hidden while it is put away, and it is put away while the rivals' turns replay (the
          replay bar narrates those), so nothing is announced twice. */}
      <div ref={scroller} style={scrollerStyle} role="log" aria-live="polite" aria-label="The log">
        {entries.length === 0 ? (
          <Empty>Nothing has happened yet.</Empty>
        ) : (
          entries.map(entry => {
            const captain = captains.find(c => c.id === entry.captainId);
            return (
              <p key={entry.seq} style={line}>
                <span style={{ ...dot, background: captain?.colour ?? 'transparent' }} />
                <span style={{ color: KIND_COLOUR[entry.kind] ?? UI.textSoft }}>{entry.text}</span>
              </p>
            );
          })
        )}
      </div>
    </Panel>
  );
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
