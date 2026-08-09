import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getToken } from '../lib/token';
import PortalNav from '../components/PortalNav';

const API = import.meta.env.VITE_API_URL ?? '';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  registeredAt: number;
  lastLoginAt: number | null;
  gamesByTitle: { thrash_margin: number; niccolo: number; tea_race: number };
  activeGames: number;
  wins: number;
}

interface FeedbackItem {
  id: string;
  game: string;
  type: string;
  message: string;
  status: 'open' | 'resolved';
  createdAt: number;
  username: string;
}

const GAME_LABELS: Record<string, string> = {
  general: 'General', thrash_margin: 'Thrash Margin', niccolo: 'Banco di Niccolo', tea_race: 'The Tea Race',
};
const TYPE_ICONS: Record<string, string> = { bug: '🐛', idea: '💡', comment: '💬' };

function authHeaders(): HeadersInit {
  const token = getToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function fmtDate(ms: number | null): string {
  if (!ms) return 'Never';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function Admin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[] | null>(null);
  const [deniedReason, setDeniedReason] = useState<'unauthorized' | 'forbidden' | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'open' | 'resolved'>('open');
  const signedIn = !!getToken();

  const load = useCallback(async () => {
    setLoading(true);
    setDeniedReason(null);
    try {
      const [usersRes, feedbackRes] = await Promise.all([
        fetch(`${API}/api/admin/users`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/feedback`, { headers: authHeaders() }),
      ]);
      if (usersRes.status === 401 || feedbackRes.status === 401) { setDeniedReason('unauthorized'); return; }
      if (usersRes.status === 403 || feedbackRes.status === 403) { setDeniedReason('forbidden'); return; }
      const usersData = await usersRes.json();
      const feedbackData = await feedbackRes.json();
      setUsers(usersData.users ?? []);
      setFeedback(feedbackData.items ?? []);
    } catch {
      setDeniedReason('unauthorized');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (signedIn) load(); else setLoading(false); }, [signedIn, load]);

  const toggleStatus = async (item: FeedbackItem) => {
    const nextStatus = item.status === 'open' ? 'resolved' : 'open';
    setFeedback(prev => prev?.map(f => f.id === item.id ? { ...f, status: nextStatus } : f) ?? null);
    try {
      await fetch(`${API}/api/admin/feedback`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ id: item.id, status: nextStatus }),
      });
    } catch { /* optimistic update stands; a manual refresh will resync if this failed */ }
  };

  if (!signedIn) {
    return (
      <Shell>
        <Centered>
          <p style={{ color: '#7d8590', fontSize: 14 }}>Sign in to continue.</p>
          <Link to="/login" style={s.signInLink}>Sign in →</Link>
        </Centered>
      </Shell>
    );
  }

  if (loading) return <Shell><Centered><p style={{ color: '#7d8590' }}>Loading…</p></Centered></Shell>;

  if (deniedReason) {
    return (
      <Shell>
        <Centered>
          <p style={{ color: '#f85149', fontSize: 14, fontWeight: 600 }}>
            {deniedReason === 'forbidden' ? 'Admin access only.' : 'Session expired — sign in again.'}
          </p>
          {deniedReason === 'unauthorized' && <Link to="/login" style={s.signInLink}>Sign in →</Link>}
        </Centered>
      </Shell>
    );
  }

  const visibleFeedback = (feedback ?? []).filter(f => feedbackFilter === 'all' || f.status === feedbackFilter);

  return (
    <Shell>
      <div style={s.page}>
        <h1 style={s.title}>Admin</h1>

        <section style={s.section}>
          <h2 style={s.h2}>Users ({users?.length ?? 0})</h2>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Username', 'Email', 'Registered', 'Last login', 'TM', 'Niccolo', 'Tea Race', 'Active', 'Wins'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map(u => (
                  <tr key={u.id}>
                    <td style={s.tdStrong}>{u.username}</td>
                    <td style={s.td}>{u.email}</td>
                    <td style={s.td}>{fmtDate(u.registeredAt)}</td>
                    <td style={s.td}>{fmtDate(u.lastLoginAt)}</td>
                    <td style={s.tdNum}>{u.gamesByTitle.thrash_margin}</td>
                    <td style={s.tdNum}>{u.gamesByTitle.niccolo}</td>
                    <td style={s.tdNum}>{u.gamesByTitle.tea_race}</td>
                    <td style={s.tdNum}>{u.activeGames}</td>
                    <td style={s.tdNum}>{u.wins}</td>
                  </tr>
                ))}
                {!users?.length && (
                  <tr><td style={s.td} colSpan={9}>No registered users yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={s.section}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ ...s.h2, margin: 0 }}>Feedback ({visibleFeedback.length})</h2>
            <div style={s.filterRow}>
              {(['open', 'resolved', 'all'] as const).map(f => (
                <button key={f} onClick={() => setFeedbackFilter(f)}
                  style={feedbackFilter === f ? s.filterOn : s.filterOff}>
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visibleFeedback.map(item => (
              <div key={item.id} style={s.feedbackCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={s.badge}>{TYPE_ICONS[item.type] ?? ''} {item.type}</span>
                  <span style={s.badgeMuted}>{GAME_LABELS[item.game] ?? item.game}</span>
                  <span style={{ fontSize: 12, color: '#7d8590' }}>by {item.username}</span>
                  <span style={{ fontSize: 11, color: '#4b5563', marginLeft: 'auto' }}>{fmtDate(item.createdAt)}</span>
                </div>
                <p style={{ margin: '0 0 8px', color: '#e6edf3', fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{item.message}</p>
                <button onClick={() => toggleStatus(item)} style={item.status === 'open' ? s.resolveBtn : s.reopenBtn}>
                  {item.status === 'open' ? '✓ Mark resolved' : '↺ Reopen'}
                </button>
              </div>
            ))}
            {!visibleFeedback.length && (
              <p style={{ color: '#7d8590', fontSize: 13 }}>Nothing here.</p>
            )}
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={s.outer}>
      <PortalNav variant="header" />
      {children}
      <PortalNav variant="footer" />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, background: '#0d1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, fontFamily: 'system-ui,sans-serif', minHeight: '60vh' }}>
      {children}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  outer:   { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  page:    { flex: 1, background: '#0d1117', fontFamily: 'system-ui,sans-serif', padding: '32px 40px', color: '#e6edf3' },
  title:   { fontSize: 24, fontWeight: 700, margin: '0 0 24px', letterSpacing: -0.5 },
  section: { marginBottom: 40 },
  h2:      { fontSize: 15, fontWeight: 700, color: '#9198a1', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' },
  tableWrap: { overflowX: 'auto', border: '1px solid #30363d', borderRadius: 8 },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:      { textAlign: 'left', padding: '9px 12px', background: '#161b22', color: '#7d8590', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' },
  td:      { padding: '9px 12px', borderBottom: '1px solid #21262d', color: '#c9d1d9', whiteSpace: 'nowrap' },
  tdStrong:{ padding: '9px 12px', borderBottom: '1px solid #21262d', color: '#e6edf3', fontWeight: 600, whiteSpace: 'nowrap' },
  tdNum:   { padding: '9px 12px', borderBottom: '1px solid #21262d', color: '#c9d1d9', textAlign: 'center' },
  filterRow: { display: 'flex', gap: 4, background: '#161b22', borderRadius: 6, padding: 3 },
  filterOn:  { padding: '5px 12px', border: 'none', background: '#21262d', color: '#e6edf3', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  filterOff: { padding: '5px 12px', border: 'none', background: 'transparent', color: '#7d8590', borderRadius: 4, fontSize: 12, cursor: 'pointer' },
  feedbackCard: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '14px 16px' },
  badge:      { fontSize: 11, fontWeight: 700, color: '#e6edf3', background: '#21262d', border: '1px solid #30363d', borderRadius: 4, padding: '2px 8px', textTransform: 'capitalize' },
  badgeMuted: { fontSize: 11, color: '#7d8590', background: '#0d1117', border: '1px solid #21262d', borderRadius: 4, padding: '2px 8px' },
  resolveBtn: { background: 'none', border: '1px solid #2ea043', color: '#3fb950', borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  reopenBtn:  { background: 'none', border: '1px solid #30363d', color: '#7d8590', borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  signInLink: { color: '#1f6feb', fontSize: 14, fontWeight: 600, textDecoration: 'none' },
};
