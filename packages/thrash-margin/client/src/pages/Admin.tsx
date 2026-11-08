import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getToken, getStoredUser } from '../lib/token';
import PortalNav from '../components/PortalNav';
import { GAMES, FEEDBACK_TOPICS } from 'shared/games';

const API = import.meta.env.VITE_API_URL ?? '';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  registeredAt: number;
  lastLoginAt: number | null;
  gamesByTitle: Record<string, number>;
  activeGames: number;
  wins: number;
}

interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  target: string;
  action: 'grant_admin' | 'remove_admin' | 'reset_password';
  detail: string | null;
}

const AUDIT_VERBS: Record<string, string> = {
  grant_admin: 'made admin',
  remove_admin: 'removed admin from',
  reset_password: 'reset the password of',
};

interface FeedbackItem {
  id: string;
  game: string;
  type: string;
  message: string;
  status: 'open' | 'resolved';
  createdAt: number;
  username: string;
}

const GAME_LABELS: Record<string, string> = Object.fromEntries(FEEDBACK_TOPICS.map(t => [t.key, t.label]));
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
  const [roleError, setRoleError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [tempPassword, setTempPassword] = useState<{ username: string; password: string } | null>(null);
  const signedIn = !!getToken();
  const myId = getStoredUser()?.userId;

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
      // Loaded separately and allowed to fail: the history is useful, not essential to the page.
      fetch(`${API}/api/admin/audit`, { headers: authHeaders() })
        .then(r => (r.ok ? r.json() : null))
        .then(d => setAudit(d?.entries ?? []))
        .catch(() => {});
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

  // Not optimistic, unlike feedback status: a role change is a permission change, so the table
  // only shows it once the server has confirmed it.
  const changeRole = async (u: AdminUser) => {
    const role = u.role === 'admin' ? 'user' : 'admin';
    const verb = role === 'admin' ? 'Make' : 'Remove';
    if (!window.confirm(`${verb} ${u.username} ${role === 'admin' ? 'an admin' : 'as admin'}?`)) return;
    setRoleError(null);
    try {
      const res = await fetch(`${API}/api/admin/users`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ id: u.id, role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRoleError(data.message ?? 'Could not change role');
        return;
      }
      setUsers(prev => prev?.map(x => x.id === u.id ? { ...x, role } : x) ?? null);
      refreshAudit();
    } catch {
      setRoleError('Network error, try again');
    }
  };

  const refreshAudit = () => {
    fetch(`${API}/api/admin/audit`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(d => d && setAudit(d.entries ?? []))
      .catch(() => {});
  };

  const resetPassword = async (u: AdminUser) => {
    if (!window.confirm(`Reset ${u.username}'s password? Their current password stops working immediately.`)) return;
    setRoleError(null);
    setTempPassword(null);
    try {
      const res = await fetch(`${API}/api/admin/reset-password`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id: u.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setRoleError(data.message ?? 'Could not reset password'); return; }
      setTempPassword({ username: u.username, password: data.temporaryPassword });
      refreshAudit();
    } catch {
      setRoleError('Network error, try again');
    }
  };

  if (!signedIn) {
    return (
      <Shell>
        <Centered>
          <p style={{ color: 'var(--portal-soft)', fontSize: 14 }}>Sign in to continue.</p>
          <Link to="/login" style={s.signInLink}>Sign in →</Link>
        </Centered>
      </Shell>
    );
  }

  if (loading) return <Shell><Centered><p style={{ color: 'var(--portal-soft)' }}>Loading…</p></Centered></Shell>;

  if (deniedReason) {
    return (
      <Shell>
        <Centered>
          <p style={{ color: 'var(--portal-bad)', fontSize: 14, fontWeight: 600 }}>
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
          {roleError && <p style={{ color: 'var(--portal-bad)', fontSize: 13, margin: '0 0 10px' }}>{roleError}</p>}
          {tempPassword && (
            <div style={s.notice}>
              <div>
                Temporary password for <strong>{tempPassword.username}</strong>:{' '}
                <code style={s.code}>{tempPassword.password}</code>
              </div>
              <div style={{ color: 'var(--portal-soft)', marginTop: 4 }}>
                Shown once. Pass it on privately; they should change it on their Profile page after signing in.
              </div>
              <button onClick={() => setTempPassword(null)} style={{ ...s.roleBtn, marginLeft: 0, marginTop: 8 }}>Done</button>
            </div>
          )}
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Username', 'Email', 'Role', 'Registered', 'Last login', ...GAMES.map(g => g.short), 'Active', 'Wins'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map(u => (
                  <tr key={u.id}>
                    <td style={s.tdStrong}>{u.username}</td>
                    <td style={s.td}>{u.email}</td>
                    <td style={s.td}>
                      <span style={u.role === 'admin' ? s.roleAdmin : s.roleUser}>{u.role}</span>
                      {u.id === myId ? (
                        <span style={{ fontSize: 11, color: 'var(--portal-faint)', marginLeft: 8 }}>you</span>
                      ) : (
                        <>
                          <button onClick={() => changeRole(u)} style={s.roleBtn}>
                            {u.role === 'admin' ? 'Remove admin' : 'Make admin'}
                          </button>
                          {u.role !== 'admin' && (
                            <button onClick={() => resetPassword(u)} style={s.roleBtn}>Reset password</button>
                          )}
                        </>
                      )}
                    </td>
                    <td style={s.td}>{fmtDate(u.registeredAt)}</td>
                    <td style={s.td}>{fmtDate(u.lastLoginAt)}</td>
                    {GAMES.map(g => <td key={g.key} style={s.tdNum}>{u.gamesByTitle[g.key] ?? 0}</td>)}
                    <td style={s.tdNum}>{u.activeGames}</td>
                    <td style={s.tdNum}>{u.wins}</td>
                  </tr>
                ))}
                {!users?.length && (
                  <tr><td style={s.td} colSpan={7 + GAMES.length}>No registered users yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={s.section}>
          <h2 style={s.h2}>Access history</h2>
          {audit.length ? (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <tbody>
                  {audit.map(e => (
                    <tr key={e.id}>
                      <td style={s.td}>{fmtDate(e.at)}</td>
                      <td style={s.td}>
                        <span style={{ color: 'var(--portal-text)', fontWeight: 600 }}>{e.actor}</span>{' '}
                        {AUDIT_VERBS[e.action] ?? e.action}{' '}
                        <span style={{ color: 'var(--portal-text)', fontWeight: 600 }}>{e.target}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--portal-soft)', fontSize: 13 }}>No access changes recorded yet.</p>
          )}
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
                  <span style={{ fontSize: 12, color: 'var(--portal-soft)' }}>by {item.username}</span>
                  <span style={{ fontSize: 11, color: 'var(--portal-faint)', marginLeft: 'auto' }}>{fmtDate(item.createdAt)}</span>
                </div>
                <p style={{ margin: '0 0 8px', color: 'var(--portal-text)', fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{item.message}</p>
                <button onClick={() => toggleStatus(item)} style={item.status === 'open' ? s.resolveBtn : s.reopenBtn}>
                  {item.status === 'open' ? '✓ Mark resolved' : '↺ Reopen'}
                </button>
              </div>
            ))}
            {!visibleFeedback.length && (
              <p style={{ color: 'var(--portal-soft)', fontSize: 13 }}>Nothing here.</p>
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
    <div style={{ flex: 1, background: 'var(--portal-ground)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, fontFamily: 'system-ui,sans-serif', minHeight: '60vh' }}>
      {children}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  outer:   { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  page:    { flex: 1, background: 'var(--portal-ground)', fontFamily: 'system-ui,sans-serif', padding: '32px 40px', color: 'var(--portal-text)' },
  title:   { fontSize: 24, fontWeight: 700, margin: '0 0 24px', letterSpacing: -0.5 },
  section: { marginBottom: 40 },
  h2:      { fontSize: 15, fontWeight: 700, color: 'var(--portal-softer)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--portal-rule)', borderRadius: 8 },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:      { textAlign: 'left', padding: '9px 12px', background: 'var(--portal-panel)', color: 'var(--portal-soft)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid var(--portal-rule)', whiteSpace: 'nowrap' },
  td:      { padding: '9px 12px', borderBottom: '1px solid var(--portal-raised)', color: 'var(--portal-text-mid)', whiteSpace: 'nowrap' },
  tdStrong:{ padding: '9px 12px', borderBottom: '1px solid var(--portal-raised)', color: 'var(--portal-text)', fontWeight: 600, whiteSpace: 'nowrap' },
  tdNum:   { padding: '9px 12px', borderBottom: '1px solid var(--portal-raised)', color: 'var(--portal-text-mid)', textAlign: 'center' },
  filterRow: { display: 'flex', gap: 4, background: 'var(--portal-panel)', borderRadius: 6, padding: 3 },
  filterOn:  { padding: '5px 12px', border: 'none', background: 'var(--portal-raised)', color: 'var(--portal-text)', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  filterOff: { padding: '5px 12px', border: 'none', background: 'transparent', color: 'var(--portal-soft)', borderRadius: 4, fontSize: 12, cursor: 'pointer' },
  feedbackCard: { background: 'var(--portal-panel)', border: '1px solid var(--portal-rule)', borderRadius: 8, padding: '14px 16px' },
  badge:      { fontSize: 11, fontWeight: 700, color: 'var(--portal-text)', background: 'var(--portal-raised)', border: '1px solid var(--portal-rule)', borderRadius: 4, padding: '2px 8px', textTransform: 'capitalize' },
  badgeMuted: { fontSize: 11, color: 'var(--portal-soft)', background: 'var(--portal-ground)', border: '1px solid var(--portal-raised)', borderRadius: 4, padding: '2px 8px' },
  resolveBtn: { background: 'none', border: '1px solid var(--portal-good-rule)', color: 'var(--portal-good)', borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  reopenBtn:  { background: 'none', border: '1px solid var(--portal-rule)', color: 'var(--portal-soft)', borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  roleAdmin:  { fontSize: 11, fontWeight: 700, color: 'var(--portal-warn)', textTransform: 'uppercase', letterSpacing: 0.4 },
  roleUser:   { fontSize: 11, color: 'var(--portal-soft)', textTransform: 'uppercase', letterSpacing: 0.4 },
  roleBtn:    { marginLeft: 8, background: 'none', border: '1px solid var(--portal-rule)', color: 'var(--portal-softer)', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer' },
  notice:     { background: 'var(--portal-panel)', border: '1px solid var(--portal-warn)', borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 12, color: 'var(--portal-text)' },
  code:       { fontFamily: 'ui-monospace, monospace', fontSize: 14, background: 'var(--portal-ground)', border: '1px solid var(--portal-rule)', borderRadius: 4, padding: '2px 6px', userSelect: 'all' },
  signInLink: { color: 'var(--portal-action)', fontSize: 14, fontWeight: 600, textDecoration: 'none' },
};
