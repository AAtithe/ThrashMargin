import { useNavigate } from 'react-router-dom';
import { useGameLocal } from '../hooks/useGameLocal';

export default function Lobby() {
  const { createGame, loading } = useGameLocal();
  const nav = useNavigate();

  const handleNew = () => {
    const id = createGame();
    nav(`/game/${id}`);
  };

  const saved = (() => {
    try {
      const raw = localStorage.getItem('tm_local_game');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s.status && s.id ? s : null;
    } catch { return null; }
  })();

  return (
    <div style={s.page}>
      <div style={s.header}>
        <span style={s.logo}>Thrash Margin</span>
      </div>

      <div style={s.content}>
        <h2 style={s.heading}>Campaigns</h2>

        {saved && (
          <div style={s.card}>
            <div style={s.cardRow}>
              <div>
                <p style={s.cardTitle}>Campaign in progress</p>
                <p style={s.cardSub}>
                  Turn {saved.turn} · Status: <span style={statusColour(saved.status)}>{saved.status}</span>
                </p>
              </div>
              <button style={s.continueBtn} onClick={() => nav(`/game/${saved.id}`)}>
                {saved.status === 'active' ? 'Continue →' : 'View result'}
              </button>
            </div>
          </div>
        )}

        <button style={s.newBtn} onClick={handleNew} disabled={loading}>
          {loading ? 'Starting…' : '+ New campaign'}
        </button>
      </div>
    </div>
  );
}

function statusColour(status: string): React.CSSProperties {
  if (status === 'victory')  return { color: '#3fb950' };
  if (status === 'defeated') return { color: '#f85149' };
  return { color: '#e6edf3' };
}

const s: Record<string, React.CSSProperties> = {
  page:        { minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui,sans-serif' },
  header:      { background: '#161b22', borderBottom: '1px solid #30363d', padding: '14px 32px' },
  logo:        { fontSize: 18, fontWeight: 700, color: '#e6edf3' },
  content:     { maxWidth: 600, margin: '48px auto', padding: '0 24px' },
  heading:     { fontSize: 20, fontWeight: 600, margin: '0 0 24px' },
  card:        { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px', marginBottom: 16 },
  cardRow:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:   { color: '#e6edf3', fontSize: 14, fontWeight: 600, margin: '0 0 4px' },
  cardSub:     { color: '#7d8590', fontSize: 12, margin: 0 },
  continueBtn: { background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  newBtn:      { background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, padding: '10px 22px', cursor: 'pointer', fontSize: 14 },
};
