import { FONT, UI, money } from '../theme';
import { Button } from './ui';
import type { Haulier, GameState } from '../sim/types';

/**
 * Hotseat pause between two human hauliers.
 *
 * This is a pause, not a screen — everything in this game is public information, so there is
 * nothing to hide from the next player. What it prevents is the far more common hotseat mistake:
 * taking a turn without noticing the device has changed hands.
 */
export default function HandoverCard({
  state,
  next,
  onReady,
}: {
  state: GameState;
  next: Haulier;
  onReady: () => void;
}) {
  const vehicles = state.vehicles.filter(s => s.ownerId === next.id);
  const onRoad = vehicles.filter(s => !s.location).length;

  return (
    <div style={backdrop}>
      <div style={{ ...card, borderColor: next.colour }}>
        <span style={eyebrow}>Round {state.round}</span>
        <h2 style={{ ...title, color: next.colour }}>Pass to {next.name}</h2>
        <p style={body}>
          {money(next.cash)} in hand, {next.shares} share{next.shares === 1 ? '' : 's'},{' '}
          {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}
          {onRoad > 0 && ` (${onRoad} on the road)`}.
        </p>
        <Button tone="primary" onClick={onReady} style={{ alignSelf: 'flex-start', fontSize: '0.95rem', padding: '0.5rem 1rem' }}>
          I'm {next.name} — take the wheel
        </Button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(6, 11, 14, 0.92)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1.5rem',
  zIndex: 40,
};

const card: React.CSSProperties = {
  background: UI.panel,
  border: '2px solid',
  borderRadius: 3,
  padding: '1.6rem 1.8rem',
  maxWidth: 460,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
  boxSizing: 'border-box',
};

const eyebrow: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.62rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: UI.textFaint,
};

const title: React.CSSProperties = {
  fontFamily: FONT.display,
  fontSize: '1.7rem',
  margin: 0,
  lineHeight: 1.1,
};

const body: React.CSSProperties = {
  fontFamily: FONT.body,
  fontSize: '0.9rem',
  color: UI.textSoft,
  margin: 0,
};
