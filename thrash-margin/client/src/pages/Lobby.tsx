import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, clearToken, getStoredUser } from '../lib/token';
import { useGame } from '../hooks/useGame';

const API = import.meta.env.VITE_API_URL ?? '';

interface GameRow {
  id: string;
  status: 'active' | 'victory' | 'defeated';
  turn: number;
  created_at: string;
}

export default function Lobby() {
  const { createGame, loading } = useGame();
  const [games, setGames] = useState<GameRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const nav = useNavigate();
  const user = getStoredUser();

  useEffect(() => {
    const token = getToken();
    if (!token) { nav('/login'); return; }
    fetch(`${API}/api/game`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setGames(d.games ?? []))
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [nav]);

  const handleNew = async () => {
    const id = await createGame();
    if (id) nav(`/game/${id}`);
  };

  const handleLogout = () => { clearToken(); nav('/login'); };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <span style={s.logo}>Thrash Margin</span>
        <div style={s.headerRight}>
          <span style={s.username}>{user?.username}</span>
          <button onClick={handleLogout} style={s.logoutBtn}>Logout</button>
        </div>
      </div>

      <div style={s.content}>
        <div style={s.row}>
          <h2 style={s.heading}>Campaigns</h2>
          <button style={s.newBtn} onClick={handleNew} disabled={loading}>
            {loading ? 'Starting…' : '+ New campaign'}
          </button>
        </div>

        {fetching ? (
          <p style={s.muted}>Loading…</p>
        ) : games.length === 0 ? (
          <div style={s.empty}>
            <p style={s.emptyTitle}>No campaigns yet</p>
            <p style={s.muted}>Start one above to begin your conquest.</p>
          </div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {['Status', 'Turn', 'Started', ''].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {games.map(g => (
                <tr key={g.id}>
                  <td style={{ ...s.td, ...statusColour(g.status) }}>{g.status}</td>
                  <td style={s.td}>{g.turn}</td>
                  <td style={s.td}>{new Date(g.created_at).toLocaleDateString()}</td>
                  <td style={s.td}>
                    <button style={s.continueBtn} onClick={() => nav(`/game/${g.id}`)}>
                      {g.status === 'active' ? 'Continue →' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function statusColour(s: GameRow['status']): React.CSSProperties {
  if (s === 'victory')  return { color: '#3fb950' };
  if (s === 'defeated') return { color: '#f85149' };
  return { color: '#e6edf3' };
}

const s: Record<string, React.CSSProperties> = {
  page:        { minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui,sans-serif' },
  header:      { background: '#161b22', borderBottom: '1px solid #30363d', padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:        { fontSize: 18, fontWeight: 700, color: '#e6edf3' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 14 },
  username:    { fontSize: 13, color: '#7d8590' },
  logoutBtn:   { background: 'none', border: '1px solid #30363d', color: '#7d8590', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  content:     { maxWidth: 720, margin: '40px auto', padding: '0 24px' },
  row:         { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  heading:     { margin: 0, fontSize: 20, fontWeight: 600 },
  newBtn:      { background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, padding: '9px 20px', cursor: 'pointer', fontSize: 14 },
  muted:       { color: '#7d8590', fontSize: 14, margin: 0 },
  empty:       { textAlign: 'center', padding: '48px 0' },
  emptyTitle:  { fontSize: 16, fontWeight: 600, margin: '0 0 8px' },
  table:       { width: '100%', borderCollapse: 'collapse' },
  th:          { textAlign: 'left', color: '#7d8590', fontSize: 11, fontWeight: 600, padding: '8px 12px', borderBottom: '1px solid #21262d', textTransform: 'uppercase', letterSpacing: 0.5 },
  td:          { padding: '13px 12px', borderBottom: '1px solid #21262d', fontSize: 14, color: '#e6edf3' },
  continueBtn: { background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '5px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
};
