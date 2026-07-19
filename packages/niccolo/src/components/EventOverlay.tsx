import type { ScriptedEvent } from '../sim/types';

const BACKDROP: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(8, 6, 4, 0.78)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: '2rem',
};

const CARD: React.CSSProperties = {
  background: '#17130d',
  border: '1px solid #4a3d28',
  boxShadow: '0 0 0 1px #0e0b07, 0 8px 40px rgba(0,0,0,0.6)',
  maxWidth: '32rem',
  padding: '1.8rem',
  fontFamily: '"Georgia", "Times New Roman", serif',
  color: '#c9b88a',
};

const TITLE: React.CSSProperties = {
  fontSize: '1.3rem',
  letterSpacing: '0.05em',
  color: '#e8d5a3',
  margin: '0 0 1rem',
};

const BODY: React.CSSProperties = {
  fontSize: '0.95rem',
  lineHeight: 1.6,
  margin: '0 0 1.5rem',
  color: '#c9b88a',
};

const CHOICE_BUTTON: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
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
