import type { ScriptedEvent } from '../sim/types';
import { UI, FONT } from '../theme';

const BACKDROP: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(13, 20, 25, 0.78)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: '2rem',
};

const CARD: React.CSSProperties = {
  background: UI.panelRaised,
  border: `1px solid ${UI.rule}`,
  boxShadow: `0 0 0 1px ${UI.ground}, 0 8px 40px rgba(0,0,0,0.6)`,
  maxWidth: '32rem',
  padding: '1.8rem',
  fontFamily: FONT.body,
  color: UI.text,
};

const TITLE: React.CSSProperties = {
  fontSize: '1.3rem',
  letterSpacing: '0.05em',
  color: UI.brass,
  margin: '0 0 1rem',
};

const BODY: React.CSSProperties = {
  fontSize: '0.95rem',
  lineHeight: 1.6,
  margin: '0 0 1.5rem',
  color: UI.text,
};

const CHOICE_BUTTON: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  color: UI.text,
  padding: '0.6rem 0.9rem',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  marginBottom: '0.6rem',
  cursor: 'pointer',
};

interface EventOverlayProps {
  event: ScriptedEvent;
  onChoose: (choiceIndex: number) => void;
}

export default function EventOverlay({ event, onChoose }: EventOverlayProps) {
  return (
    <div style={BACKDROP}>
      <div style={CARD}>
        <h2 style={TITLE}>{event.title}</h2>
        <p style={BODY}>{event.body}</p>
        {event.choices.map((choice, i) => (
          <button key={i} style={CHOICE_BUTTON} onClick={() => onChoose(i)}>
            {choice.text}
          </button>
        ))}
      </div>
    </div>
  );
}
