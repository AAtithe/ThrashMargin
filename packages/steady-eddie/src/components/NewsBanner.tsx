/**
 * What the world is doing right now, in one line under the season.
 *
 * The event cards announce news once; this is the standing reminder, because a strike you were told
 * about four turns ago is still shutting the depot you are steering for. Cards are the notification,
 * this is the state.
 */

import { FONT, UI } from '../theme';
import { goodName, depotName } from '../sim/content';
import { BOUNTY_PER_UNIT, GLUT_FACTOR, SHORTAGE_FACTOR } from '../sim/events';
import type { WorldEvent } from '../sim/types';

const LOOK: Record<WorldEvent['kind'], { glyph: string; colour: string }> = {
  strike: { glyph: '⚑', colour: UI.bad },
  embargo: { glyph: '⊘', colour: UI.bad },
  glut: { glyph: '▼', colour: UI.warn },
  shortage: { glyph: '▲', colour: UI.verdigris },
  bounty: { glyph: '✦', colour: UI.brass },
};

/** The consequence, stated as a rule rather than as prose — this line is read mid-decision. */
function effect(e: WorldEvent): string {
  switch (e.kind) {
    case 'strike':
      return `${depotName(e.depot!)} shut — no lading, no landing`;
    case 'embargo':
      return `${goodName(e.good!)} cannot be loaded`;
    case 'glut':
      return `${goodName(e.good!)} lands at ×${GLUT_FACTOR}`;
    case 'shortage':
      return `${goodName(e.good!)} lands at ×${SHORTAGE_FACTOR}`;
    case 'bounty':
      return `${goodName(e.good!)} pays +£${BOUNTY_PER_UNIT} a unit`;
  }
}

export default function NewsBanner({ events, round }: { events: WorldEvent[]; round: number }) {
  if (events.length === 0) return null;

  return (
    <div style={bar} role="status">
      <span style={label}>The news</span>
      {events.map(e => {
        const look = LOOK[e.kind];
        const roundsLeft = e.until - round + 1;
        return (
          <span key={e.id} style={item} title={e.detail}>
            <span style={{ color: look.colour }}>{look.glyph}</span>
            <span style={{ color: UI.text }}>{effect(e)}</span>
            <span style={{ color: UI.textFaint }}>
              ({roundsLeft} {roundsLeft === 1 ? 'round' : 'rounds'})
            </span>
          </span>
        );
      })}
    </div>
  );
}

const bar: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '0.4rem 1rem',
  padding: '0.4rem 0.7rem',
  border: `1px solid ${UI.rule}`,
  borderLeft: `3px solid ${UI.warn}`,
  borderRadius: 2,
  background: UI.panel,
  fontFamily: FONT.data,
  fontSize: '0.72rem',
};

const label: React.CSSProperties = {
  color: UI.textFaint,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  fontSize: '0.6rem',
};

const item: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: '0.35rem',
};
