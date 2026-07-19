import type { Secret } from '../sim/types';

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0.9rem 0 0.4rem',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.4rem 0',
  borderBottom: '1px solid #2a2117',
  fontSize: '0.78rem',
};

const SMALL_BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.2rem 0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function statusLabel(secret: Secret, week: number): { text: string; color: string } {
  if (secret.used) return { text: 'used', color: '#6a5a40' };
  if (secret.expired) return { text: 'expired', color: '#b5451a' };
  if (secret.expiresWeek !== null) {
    return { text: `expires week ${secret.expiresWeek} (${secret.expiresWeek - week} left)`, color: '#a08040' };
  }
  return { text: 'held', color: '#3a6b5a' };
}

interface SecretsPanelProps {
  secrets: Secret[];
  week: number;
  onUse: (secretId: string) => void;
}

export default function SecretsPanel({ secrets, week, onUse }: SecretsPanelProps) {
  if (secrets.length === 0) return null;

  return (
    <div>
      <p style={LABEL}>Secrets</p>
      {secrets.map(s => {
        const status = statusLabel(s, week);
        const usable = !s.used && !s.expired;
        return (
          <div key={s.id} style={ROW}>
            <div style={{ flex: 1 }}>
              <div>{s.name}</div>
              <div style={{ fontSize: '0.7rem', color: '#8a7a5a' }}>{s.description}</div>
              <div style={{ fontSize: '0.7rem', color: status.color }}>
                {usable ? `worth ${s.value}f · ${status.text}` : status.text}
              </div>
            </div>
            {usable && (
              <button style={SMALL_BUTTON} onClick={() => onUse(s.id)}>
                Exploit / Sell
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
