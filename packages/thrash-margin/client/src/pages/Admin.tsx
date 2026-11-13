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
  /** 'pending' waits in the approval queue; 'suspended' cannot sign in. */
  status: 'active' | 'pending' | 'suspended';
  registeredAt: number;
  lastLoginAt: number | null;
  gamesByTitle: Record<string, number>;
  /** The games this account may play (keys from GAMES). */
  games: string[];
  activeGames: number;
  wins: number;
}

interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  target: string;
  action:
    | 'grant_admin' | 'remove_admin' | 'reset_password' | 'grant_game' | 'revoke_game' | 'set_new_account_games'
    | 'set_require_approval' | 'approve_account' | 'reject_account' | 'suspend' | 'unsuspend' | 'delete_account';
  detail: string | null;
}

const AUDIT_VERBS: Record<string, string> = {
  grant_admin: 'made admin',
  remove_admin: 'removed admin from',
  reset_password: 'reset the password of',
  approve_account: 'approved',
  reject_account: 'rejected',
  suspend: 'suspended',
  unsuspend: 'reinstated',
  delete_account: 'deleted the account of',
};

/** Actions whose detail is a note the admin typed, shown after the sentence. */
const NOTED = new Set(['approve_account', 'reject_account', 'suspend', 'unsuspend', 'delete_account']);

const GAME_LABEL: Record<string, string> = Object.fromEntries(GAMES.map(g => [g.key, g.label]));

/** One history row as a sentence after the actor's name. Targets in brackets are groups, not accounts. */
function auditSentence(e: AuditEntry): { before: string; target: string | null; after: string } {
  const group = e.target.startsWith('(') ? e.target.slice(1, -1) : null;
  if (e.action === 'grant_game' || e.action === 'revoke_game') {
    const game = GAME_LABEL[e.detail ?? ''] ?? e.detail ?? 'a game';
    const verb = e.action === 'grant_game' ? 'turned on' : 'turned off';
    return group ? { before: `${verb} ${game} for ${group}`, target: null, after: '' } : { before: `${verb} ${game} for`, target: e.target, after: '' };
  }
  if (e.action === 'set_require_approval') {
    return { before: `turned ${e.detail === 'on' ? 'on' : 'off'} approval for new accounts`, target: null, after: '' };
  }
  if (e.action === 'set_new_account_games') {
    const games = (e.detail ?? '').split(',').filter(Boolean).map(k => GAME_LABEL[k] ?? k);
    return { before: `set new accounts to start with ${games.length ? games.join(', ') : 'no games'}`, target: null, after: '' };
  }
  const note = NOTED.has(e.action) && e.detail ? `: "${e.detail}"` : '';
  return { before: AUDIT_VERBS[e.action] ?? e.action, target: e.target, after: note };
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

const GAME_LABELS: Record<string, string> = Object.fromEntries(FEEDBACK_TOPICS.map(t => [t.key, t.label]));

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
  const [tab, setTab] = useState<'access' | 'feedback' | 'history'>('access');
  const [newAccountGames, setNewAccountGames] = useState<string[] | null>(null);
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const [requireApproval, setRequireApproval] = useState<boolean | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [accessError, setAccessError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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
      fetch(`${API}/api/admin/settings`, { headers: authHeaders() })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (!d) return;
          setNewAccountGames(d.newAccountGames ?? []);
          setDefaultsSaved(d.saved === true);
          setRequireApproval(d.requireApproval === true);
        })
        .catch(() => {});
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

  // Game access. Not optimistic, like role changes: the switch moves once the server has saved it.
  const busy = (key: string, on: boolean) =>
    setPending(prev => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });

  const send = async (method: string, resource: string, body: unknown): Promise<any | null> => {
    setAccessError(null);
    try {
      const res = await fetch(`${API}/api/admin/${resource}`, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setAccessError(data.message ?? 'Could not save the change'); return null; }
      refreshAudit();
      return data;
    } catch {
      setAccessError('Could not reach the server, try again');
      return null;
    }
  };

  const toggleUserGame = async (u: AdminUser, game: string) => {
    const key = `${u.id}:${game}`;
    busy(key, true);
    const data = await send('PATCH', 'access', { id: u.id, game, enabled: !u.games.includes(game) });
    busy(key, false);
    if (data?.games) setUsers(prev => prev?.map(x => (x.id === u.id ? { ...x, games: data.games } : x)) ?? null);
  };

  const toggleDefault = async (game: string) => {
    if (!newAccountGames) return;
    const next = newAccountGames.includes(game) ? newAccountGames.filter(k => k !== game) : [...newAccountGames, game];
    const key = `default:${game}`;
    busy(key, true);
    const data = await send('PUT', 'settings', { newAccountGames: next });
    busy(key, false);
    if (data) {
      setNewAccountGames(data.newAccountGames);
      setDefaultsSaved(true);
    }
  };

  const setForEveryone = async (game: string, enabled: boolean) => {
    const label = GAME_LABEL[game];
    const msg = enabled
      ? `Turn on ${label} for every existing account?`
      : `Turn off ${label} for every existing account? Their saves are kept and come back if you turn it on again.`;
    if (!window.confirm(msg)) return;
    const key = `all:${game}`;
    busy(key, true);
    const data = await send('POST', 'access-all', { game, enabled });
    busy(key, false);
    if (data) {
      setUsers(prev =>
        prev?.map(x => ({
          ...x,
          games: enabled
            ? GAMES.map(g => g.key as string).filter(k => k === game || x.games.includes(k))
            : x.games.filter(k => k !== game),
        })) ?? null,
      );
    }
  };

  const toggleApproval = async () => {
    if (requireApproval === null) return;
    const next = !requireApproval;
    const msg = next
      ? 'Require approval for new accounts? Anyone who registers will wait in the queue and cannot sign in until an admin approves them.'
      : 'Stop requiring approval? New accounts will be able to sign in straight away. Accounts already waiting stay in the queue.';
    if (!window.confirm(msg)) return;
    busy('approval', true);
    const data = await send('PUT', 'settings', { requireApproval: next });
    busy('approval', false);
    if (data) setRequireApproval(data.requireApproval === true);
  };

  /** Replaces one account in the list, or removes it when `next` is null. */
  const patchUser = (id: string, next: Partial<AdminUser> | null) =>
    setUsers(prev => (prev ? (next ? prev.map(x => (x.id === id ? { ...x, ...next } : x)) : prev.filter(x => x.id !== id)) : null));

  // A note is optional everywhere; cancelling the prompt cancels the action.
  const askNote = (question: string): string | null => window.prompt(`${question}\n\nOptional note for the access history:`, '');

  const approve = async (u: AdminUser) => {
    const note = askNote(`Approve ${u.username}? They can sign in at once, with the games set for new accounts.`);
    if (note === null) return;
    busy(`acct:${u.id}`, true);
    const data = await send('POST', 'approve', { id: u.id, note });
    busy(`acct:${u.id}`, false);
    if (data) patchUser(u.id, { status: 'active', games: data.games ?? u.games });
  };

  const reject = async (u: AdminUser) => {
    const note = askNote(`Reject ${u.username}? Their account is deleted. They could register again and would wait in the queue again.`);
    if (note === null) return;
    busy(`acct:${u.id}`, true);
    const data = await send('POST', 'reject', { id: u.id, note });
    busy(`acct:${u.id}`, false);
    if (data) patchUser(u.id, null);
  };

  const setSuspended = async (u: AdminUser, suspend: boolean) => {
    const note = askNote(
      suspend
        ? `Suspend ${u.username}? They are signed out everywhere at once and cannot sign in. Their saves are kept.`
        : `Reinstate ${u.username}? They can sign in again.`,
    );
    if (note === null) return;
    busy(`acct:${u.id}`, true);
    const data = await send('PATCH', 'status', { id: u.id, status: suspend ? 'suspended' : 'active', note });
    busy(`acct:${u.id}`, false);
    if (data) patchUser(u.id, { status: suspend ? 'suspended' : 'active' });
  };

  const deleteUser = async (u: AdminUser) => {
    const typed = window.prompt(
      `Delete ${u.username}'s account and every saved game it owns? This cannot be undone. Their feedback is kept without their name.\n\nType ${u.username} to confirm:`,
      '',
    );
    if (typed === null) return;
    if (typed !== u.username) { setAccessError('The username did not match, so nothing was deleted.'); return; }
    busy(`acct:${u.id}`, true);
    const data = await send('POST', 'delete-account', { id: u.id, confirm: typed });
    busy(`acct:${u.id}`, false);
    if (data) patchUser(u.id, null);
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
            {deniedReason === 'forbidden' ? 'Admin access only.' : 'Session expired. Sign in again.'}
          </p>
          {deniedReason === 'unauthorized' && <Link to="/login" style={s.signInLink}>Sign in →</Link>}
        </Centered>
      </Shell>
    );
  }

  const visibleFeedback = (feedback ?? []).filter(f => feedbackFilter === 'all' || f.status === feedbackFilter);
  const openFeedback = (feedback ?? []).filter(f => f.status === 'open').length;
  const q = query.trim().toLowerCase();
  const pendingUsers = (users ?? []).filter(u => u.status === 'pending');
  const members = (users ?? []).filter(u => u.status !== 'pending');
  const visibleUsers = members.filter(u => !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  const accessCount = (game: string) => members.filter(u => u.games.includes(game)).length;

  return (
    <Shell>
      <div style={s.page}>
        <h1 style={s.title}>Admin</h1>

        <div style={s.stats}>
          <Stat label="Accounts" value={members.length} />
          <Stat label="Waiting for approval" value={pendingUsers.length} />
          <Stat label="Suspended" value={members.filter(u => u.status === 'suspended').length} />
          <Stat label="Admins" value={(users ?? []).filter(u => u.role === 'admin').length} />
          <Stat label="Open feedback" value={openFeedback} />
        </div>

        <div style={s.tabs} role="tablist">
          {([
            ['access', 'Users and game access'],
            ['feedback', `Feedback (${openFeedback} open)`],
            ['history', 'Access history'],
          ] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={tab === key ? s.tabOn : s.tabOff}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'access' && (
          <>
            <section style={s.section}>
              <div style={s.sectionHead}>
                <h2 style={{ ...s.h2, margin: 0 }}>Waiting for approval ({pendingUsers.length})</h2>
                <label style={s.switchRow}>
                  <Switch
                    on={!!requireApproval}
                    disabled={requireApproval === null || pending.has('approval')}
                    onClick={toggleApproval}
                    label="Require approval for new accounts"
                  />
                  <span>Require approval for new accounts</span>
                </label>
              </div>
              <p style={s.help}>
                {requireApproval
                  ? 'New accounts cannot sign in until an admin approves them here. Approving gives them the games set for new accounts below; rejecting deletes the account.'
                  : 'Off: anyone who registers can sign in straight away. Turn it on to approve each new account here first.'}
              </p>
              {pendingUsers.length > 0 && (
                <div style={s.tableWrap}>
                  <table style={s.table}>
                    <tbody>
                      {pendingUsers.map(u => (
                        <tr key={u.id} data-pending-user={u.username}>
                          <td style={s.tdStrong}>
                            {u.username}
                            <div style={s.sub}>{u.email}</div>
                          </td>
                          <td style={{ ...s.td, whiteSpace: 'normal', minWidth: 110 }}>Registered {fmtDate(u.registeredAt)}</td>
                          <td style={{ ...s.td, textAlign: 'right' }}>
                            <button style={{ ...s.approveBtn, marginLeft: 8 }} disabled={pending.has(`acct:${u.id}`)} onClick={() => approve(u)}>Approve</button>
                            <button style={s.roleBtn} disabled={pending.has(`acct:${u.id}`)} onClick={() => reject(u)}>Reject</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section style={s.section}>
              <h2 style={s.h2}>Game access</h2>
              <p style={s.help}>
                <strong>New accounts</strong> sets which games an account starts with when it is first created. It does not
                change existing accounts: use the buttons below a game for everyone, or the switches in the user list for
                one person. Turning a game off keeps the player's saves; they come back if it is turned on again.
                {!defaultsSaved && ' Until you change a New accounts switch, new accounts get every game, including any added later.'}
              </p>
              {accessError && <p style={s.error}>{accessError}</p>}
              <div style={s.gameGrid}>
                {GAMES.map(g => {
                  const count = accessCount(g.key);
                  const total = members.length;
                  return (
                    <div key={g.key} style={s.gameCard} data-game={g.key}>
                      <div style={s.gameName}>{g.label}</div>
                      <label style={s.switchRow}>
                        <Switch
                          on={!!newAccountGames?.includes(g.key)}
                          disabled={!newAccountGames || pending.has(`default:${g.key}`)}
                          onClick={() => toggleDefault(g.key)}
                          label={`${g.label} for new accounts`}
                        />
                        <span>New accounts</span>
                      </label>
                      <div style={s.gameCount}>{count} of {total} accounts have access</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          style={s.smallBtn}
                          disabled={pending.has(`all:${g.key}`) || count === total}
                          onClick={() => setForEveryone(g.key, true)}
                        >
                          On for everyone
                        </button>
                        <button
                          style={s.smallBtn}
                          disabled={pending.has(`all:${g.key}`) || count === 0}
                          onClick={() => setForEveryone(g.key, false)}
                        >
                          Off for everyone
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section style={s.section}>
              <div style={s.sectionHead}>
                <h2 style={{ ...s.h2, margin: 0 }}>Users ({visibleUsers.length})</h2>
                <input
                  type="search"
                  placeholder="Find by username or email"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  style={s.search}
                  aria-label="Find a user"
                />
              </div>
              {roleError && <p style={s.error}>{roleError}</p>}
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
                      {['Username', 'Role', 'Last login'].map(h => <th key={h} style={s.th}>{h}</th>)}
                      {GAMES.map(g => <th key={g.key} style={{ ...s.th, textAlign: 'center' }} title={g.label}>{g.short}</th>)}
                      {['Active', 'Wins', 'Registered'].map(h => <th key={h} style={s.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map(u => (
                      <tr key={u.id}>
                        <td style={s.tdStrong}>
                          {u.username}
                          {u.status === 'suspended' && <span style={s.suspended}>Suspended</span>}
                          <div style={s.sub}>{u.email}</div>
                        </td>
                        <td style={s.td}>
                          <span style={u.role === 'admin' ? s.roleAdmin : s.roleUser}>{u.role}</span>
                          {u.id === myId ? (
                            <span style={{ fontSize: 11, color: 'var(--portal-soft)', marginLeft: 8 }}>you</span>
                          ) : (
                            <>
                              <button onClick={() => changeRole(u)} style={s.roleBtn}>
                                {u.role === 'admin' ? 'Remove admin' : 'Make admin'}
                              </button>
                              {u.role !== 'admin' && (
                                <>
                                  <button onClick={() => resetPassword(u)} style={s.roleBtn}>Reset password</button>
                                  <button onClick={() => setSuspended(u, u.status !== 'suspended')} style={s.roleBtn} disabled={pending.has(`acct:${u.id}`)}>
                                    {u.status === 'suspended' ? 'Reinstate' : 'Suspend'}
                                  </button>
                                  <button onClick={() => deleteUser(u)} style={s.dangerBtn} disabled={pending.has(`acct:${u.id}`)}>Delete</button>
                                </>
                              )}
                            </>
                          )}
                        </td>
                        <td style={s.td}>{fmtDate(u.lastLoginAt)}</td>
                        {GAMES.map(g => {
                          const saves = u.gamesByTitle[g.key] ?? 0;
                          return (
                            <td key={g.key} style={s.tdCenter}>
                              <Switch
                                on={u.games.includes(g.key)}
                                disabled={pending.has(`${u.id}:${g.key}`)}
                                onClick={() => toggleUserGame(u, g.key)}
                                label={`${g.label} for ${u.username}`}
                              />
                              <div style={s.sub}>{saves} {saves === 1 ? 'save' : 'saves'}</div>
                            </td>
                          );
                        })}
                        <td style={s.tdNum}>{u.activeGames}</td>
                        <td style={s.tdNum}>{u.wins}</td>
                        <td style={s.td}>{fmtDate(u.registeredAt)}</td>
                      </tr>
                    ))}
                    {!visibleUsers.length && (
                      <tr><td style={s.td} colSpan={6 + GAMES.length}>{members.length ? 'No account matches.' : 'No registered users yet.'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {tab === 'history' && (
          <section style={s.section}>
            {audit.length ? (
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <tbody>
                    {audit.map(e => {
                      const line = auditSentence(e);
                      return (
                        <tr key={e.id}>
                          <td style={s.td}>{fmtDate(e.at)}</td>
                          <td style={{ ...s.td, whiteSpace: 'normal' }}>
                            <span style={s.name}>{e.actor}</span> {line.before}
                            {line.target && <> <span style={s.name}>{line.target}</span></>}
                            {line.after}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--portal-soft)', fontSize: 13 }}>No access changes recorded yet.</p>
            )}
          </section>
        )}

        {tab === 'feedback' && (
        <section style={s.section}>
          <div style={s.sectionHead}>
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
                  <span style={s.badge}>{item.type}</span>
                  <span style={s.badgeMuted}>{GAME_LABELS[item.game] ?? item.game}</span>
                  <span style={{ fontSize: 12, color: 'var(--portal-soft)' }}>by {item.username}</span>
                  <span style={{ fontSize: 11, color: 'var(--portal-soft)', marginLeft: 'auto' }}>{fmtDate(item.createdAt)}</span>
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
        )}
      </div>
    </Shell>
  );
}

/** An on/off switch. A real button with role="switch", so it works from the keyboard and reads correctly. */
function Switch({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={`${label}: ${on ? 'on' : 'off'}`}
      disabled={disabled}
      onClick={onClick}
      style={{
        position: 'relative',
        width: 34,
        height: 20,
        flex: 'none',
        borderRadius: 10,
        border: `1px solid ${on ? 'var(--portal-good)' : 'var(--portal-faint)'}`,
        background: on ? 'var(--portal-good)' : 'var(--portal-raised)',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        padding: 0,
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: 7,
          background: on ? 'var(--portal-panel)' : 'var(--portal-faint)',
          transition: 'left 0.15s ease',
        }}
      />
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={s.stat}>
      <div style={s.statValue}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="tm-portal" style={s.outer}>
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
  page:    { flex: 1, background: 'var(--portal-ground)', fontFamily: 'system-ui,sans-serif', padding: '32px clamp(16px, 4vw, 40px)', color: 'var(--portal-text)' },
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
  roleBtn:    { marginLeft: 8, background: 'none', border: '1px solid var(--portal-rule)', color: 'var(--portal-softer)', borderRadius: 5, padding: '4px 9px', fontSize: 11.5, cursor: 'pointer' },
  notice:     { background: 'var(--portal-panel)', border: '1px solid var(--portal-warn)', borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 12, color: 'var(--portal-text)' },
  code:       { fontFamily: 'ui-monospace, monospace', fontSize: 14, background: 'var(--portal-ground)', border: '1px solid var(--portal-rule)', borderRadius: 4, padding: '2px 6px', userSelect: 'all' },
  signInLink: { color: 'var(--portal-action)', fontSize: 14, fontWeight: 600, textDecoration: 'none' },
  tdCenter:   { padding: '9px 12px', borderBottom: '1px solid var(--portal-raised)', color: 'var(--portal-text-mid)', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' },
  sub:        { fontSize: 11, color: 'var(--portal-soft)', fontWeight: 400, marginTop: 3 },
  name:       { color: 'var(--portal-text)', fontWeight: 600 },
  error:      { color: 'var(--portal-bad)', fontSize: 13, margin: '0 0 10px' },
  help:       { color: 'var(--portal-soft)', fontSize: 13, lineHeight: 1.55, margin: '0 0 14px', maxWidth: 760 },
  stats:      { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 },
  stat:       { background: 'var(--portal-panel)', border: '1px solid var(--portal-rule)', borderRadius: 8, padding: '10px 16px', minWidth: 120, flex: '1 1 120px', maxWidth: 220 },
  statValue:  { fontSize: 22, fontWeight: 700, color: 'var(--portal-text)' },
  statLabel:  { fontSize: 11, color: 'var(--portal-soft)', textTransform: 'uppercase', letterSpacing: 0.4 },
  tabs:       { display: 'flex', gap: 4, borderBottom: '1px solid var(--portal-rule)', marginBottom: 24, flexWrap: 'wrap' },
  tabOn:      { padding: '8px 14px', border: 'none', borderBottom: '2px solid var(--portal-action)', background: 'none', color: 'var(--portal-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: -1 },
  tabOff:     { padding: '8px 14px', border: 'none', borderBottom: '2px solid transparent', background: 'none', color: 'var(--portal-soft)', fontSize: 13, cursor: 'pointer', marginBottom: -1 },
  sectionHead:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
  search:     { background: 'var(--portal-panel)', border: '1px solid var(--portal-rule)', borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--portal-text)', minWidth: 0, width: 260, maxWidth: '100%' },
  gameGrid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 },
  gameCard:   { background: 'var(--portal-panel)', border: '1px solid var(--portal-rule)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 },
  gameName:   { fontSize: 14, fontWeight: 700, color: 'var(--portal-text)' },
  switchRow:  { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--portal-text-mid)' },
  gameCount:  { fontSize: 12, color: 'var(--portal-soft)' },
  approveBtn: { background: 'none', border: '1px solid var(--portal-good-rule)', color: 'var(--portal-good)', borderRadius: 5, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' },
  dangerBtn:  { marginLeft: 8, background: 'none', border: '1px solid var(--portal-bad)', color: 'var(--portal-bad)', borderRadius: 5, padding: '4px 9px', fontSize: 11.5, cursor: 'pointer' },
  suspended:  { marginLeft: 8, fontSize: 10, fontWeight: 700, color: 'var(--portal-bad)', textTransform: 'uppercase', letterSpacing: 0.4 },
  smallBtn:   { background: 'none', border: '1px solid var(--portal-rule)', color: 'var(--portal-softer)', borderRadius: 5, padding: '4px 9px', fontSize: 11.5, cursor: 'pointer' },
};
