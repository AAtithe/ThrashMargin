import { useEffect, useRef, useState } from 'react';
import { FONT, UI } from '../theme';
import type { Captain, LogEntry, LogKind } from '../sim/types';

/**
 * Pops a card for anything notable, so the game can be watched rather than read.
 *
 * The owner's report was "pirates don't seem to do anything". They do — measured over 1,394 rounds,
 * 268 storms, 70 ransoms and 8 seizures, roughly a storm every five rounds. But every one of them
 * produced only a line in a scrolling log, and if it fired during a computer captain's turn nobody
 * ever saw it. That is a presentation failure, not a rules one, and this is the fix.
 *
 * The log is the single source of truth here rather than a parallel event channel: every notable
 * thing already writes one entry with structured `data`, so there is nothing to keep in step.
 */

/**
 * Is this worth interrupting for? A predicate rather than a list of kinds, because one kind is not
 * uniformly notable.
 *
 * Insurance is the case that proved it: a standing policy writes a premium line at every single
 * cast-off, and promoting those to cards buried the storm that had just happened under three
 * identical notices about paperwork. Only an actual payout — the underwriters making good on a loss
 * — is news. The premium is a running cost and belongs in the log.
 */
function isNotable(entry: LogEntry): boolean {
  switch (entry.kind) {
    case 'storm':
    case 'piracy':
    case 'declare':
    case 'lapse':
    case 'victory':
    case 'contract':
    case 'event':
      return true;
    case 'insurance':
      return entry.data?.indemnity !== undefined;
    default:
      return false;
  }
}

/** How a card is coloured and titled. */
const PRESENTATION: Partial<Record<LogKind, { title: string; colour: string; glyph: string }>> = {
  storm: { title: 'Heavy weather', colour: UI.warn, glyph: '🌊' },
  piracy: { title: 'Pirates', colour: UI.bad, glyph: '⚔' },
  insurance: { title: 'The underwriters', colour: UI.verdigris, glyph: '§' },
  contract: { title: 'New commission', colour: UI.textSoft, glyph: '✦' },
  event: { title: 'From the exchange', colour: UI.warn, glyph: '⚑' },
  declare: { title: 'A claim is made', colour: UI.brass, glyph: '★' },
  lapse: { title: 'The claim collapses', colour: UI.warn, glyph: '✕' },
  victory: { title: 'The company is carried', colour: UI.brass, glyph: '♛' },
};

const MAX_ON_SCREEN = 4;

export default function EventCards({
  log,
  captains,
  viewerId,
}: {
  log: LogEntry[];
  captains: Captain[];
  viewerId: string | null;
}) {
  const [queue, setQueue] = useState<LogEntry[]>([]);

  /**
   * Everything already in the log when this mounts counts as seen. Without that, opening a save or
   * simply reloading would dump the whole backlog on screen at once.
   *
   * Tracked by `seq`, never by array index: the log is trimmed to LOG_LIMIT from the front, so
   * indices shift under you while seq does not.
   */
  const seen = useRef<number | null>(null);

  useEffect(() => {
    const highest = log.reduce((max, e) => Math.max(max, e.seq), -1);
    if (seen.current === null) {
      seen.current = highest;
      return;
    }
    const fresh = log.filter(e => e.seq > seen.current! && isNotable(e));
    seen.current = highest;
    if (fresh.length === 0) return;
    // Newest on top, and never more than a handful — a bad turn can fire several at once.
    setQueue(prev => [...fresh.reverse(), ...prev].slice(0, MAX_ON_SCREEN));
  }, [log]);

  if (queue.length === 0) return null;

  const dismiss = (seq: number) => setQueue(prev => prev.filter(e => e.seq !== seq));

  return (
    <div style={stack} aria-live="polite">
      {queue.map(entry => {
        const look = PRESENTATION[entry.kind] ?? {
          title: 'News',
          colour: UI.textSoft,
          glyph: '•',
        };
        const captain = captains.find(c => c.id === entry.captainId);
        const mine = entry.captainId !== null && entry.captainId === viewerId;

        return (
          <button
            key={entry.seq}
            type="button"
            onClick={() => dismiss(entry.seq)}
            title="Dismiss"
            style={{ ...card, borderColor: look.colour }}
          >
            <span style={{ ...glyph, color: look.colour }}>{look.glyph}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
              <span style={{ ...heading, color: look.colour }}>
                {look.title}
                {captain && (
                  <span style={{ color: UI.textFaint, fontWeight: 400 }}>
                    {' '}
                    · {mine ? 'you' : captain.name}
                  </span>
                )}
              </span>
              <span style={body}>{entry.text}</span>
            </span>
          </button>
        );
      })}
      {queue.length > 1 && (
        <button type="button" onClick={() => setQueue([])} style={clearAll}>
          Dismiss all
        </button>
      )}
    </div>
  );
}

/**
 * Bottom *left*, not right, and that is deliberate. The first version floated bottom-right and sat
 * squarely on top of the orders panel — the one column in this layout you actually click. The left
 * column is the exchange: reference you read rather than operate, so a card resting over it costs
 * nothing. Sized to sit roughly over that column so it reads as belonging there.
 */
const stack: React.CSSProperties = {
  position: 'fixed',
  left: '0.9rem',
  bottom: '0.9rem',
  width: 'min(320px, calc(100vw - 1.8rem))',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  zIndex: 30,
};

const card: React.CSSProperties = {
  display: 'flex',
  gap: '0.6rem',
  alignItems: 'flex-start',
  textAlign: 'left',
  border: '1px solid',
  borderLeftWidth: 4,
  borderRadius: 2,
  background: UI.panelRaised,
  padding: '0.6rem 0.7rem',
  cursor: 'pointer',
  font: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
};

const glyph: React.CSSProperties = {
  fontSize: '1rem',
  lineHeight: 1.1,
  flex: '0 0 auto',
};

const heading: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.62rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  fontWeight: 600,
};

const body: React.CSSProperties = {
  fontFamily: FONT.body,
  fontSize: '0.82rem',
  lineHeight: 1.4,
  color: UI.text,
};

const clearAll: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'transparent',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  color: UI.textFaint,
  fontFamily: FONT.data,
  fontSize: '0.62rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '0.2rem 0.5rem',
  cursor: 'pointer',
};
