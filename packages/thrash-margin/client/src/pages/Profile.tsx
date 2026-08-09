import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getToken } from '../lib/token';
import PortalNav from '../components/PortalNav';

const API = import.meta.env.VITE_API_URL ?? '';

interface ProfileData {
  id: string;
  username: string;
  email: string;
  registeredAt: number;
  lastLoginAt: number | null;
  gamesByTitle: { thrash_margin: number; niccolo: number; tea_race: number };
  activeGames: number;
  wins: number;
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function fmtDate(ms: number | null): string {
  if (!ms) return 'Never';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function Profile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const signedIn = !!getToken();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${API}/api/profile`, { headers: authHeaders() });
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setProfile(data);
      setNewEmail(data.email);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (signedIn) load(); else setLoading(false); }, [signedIn, load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaved(false);
    if (!currentPassword) { setFormError('Enter your current password to make changes.'); return; }
    const emailChanged = profile && newEmail.trim().toLowerCase() !== profile.email.toLowerCase();
    if (!emailChanged && !newPassword) { setFormError('Nothing to update.'); return; }

    setSaving(true);
    try {
      const res = await fetch(`${API}/api/profile`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          currentPassword,
          ...(emailChanged && { newEmail: newEmail.trim() }),
          ...(newPassword && { newPassword }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(data.message ?? 'Failed to update'); return; }
      setSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      load();
    } catch {
      setFormError('Network error — try again');
    } finally {
      setSaving(false);
    }
  };

  if (!signedIn) {
    return (
      <Shell>
        <Centered>
          <p style={{ color: '#7d8590', fontSize: 14 }}>Sign in to view your profile.</p>
          <Link to="/login" style={s.link}>Sign in →</Link>
        </Centered>
      </Shell>
    );
  }

  if (loading) return <Shell><Centered><p style={{ color: '#7d8590' }}>Loading…</p></Centered></Shell>;

  if (loadError || !profile) {
    return (
      <Shell>
        <Centered>
          <p style={{ color: '#f85149', fontSize: 14, fontWeight: 600 }}>Session expired — sign in again.</p>
          <Link to="/login" style={s.link}>Sign in →</Link>
        </Centered>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={s.page}>
        <div style={s.col}>
          <section style={s.card}>
            <h1 style={s.title}>{profile.username}</h1>
            <p style={s.subtitle}>{profile.email}</p>
            <div style={s.statGrid}>
              <Stat label="Registered" value={fmtDate(profile.registeredAt)} />
              <Stat label="Last login" value={fmtDate(profile.lastLoginAt)} />
              <Stat label="Thrash Margin" value={String(profile.gamesByTitle.thrash_margin)} />
              <Stat label="Banco di Niccolo" value={String(profile.gamesByTitle.niccolo)} />
              <Stat label="The Tea Race" value={String(profile.gamesByTitle.tea_race)} />
              <Stat label="Wins" value={String(profile.wins)} />
            </div>
          </section>

          <section style={s.card}>
            <h2 style={s.h2}>Account settings</h2>
            <form onSubmit={submit} style={s.form}>
              <label style={s.label}>
                Email
                <input style={s.input} type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
              </label>
              <label style={s.label}>
                New password <span style={{ color: '#4b5563', fontWeight: 400 }}>(leave blank to keep current)</span>
                <input style={s.input} type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              </label>
              <label style={s.label}>
                Current password <span style={{ color: '#4b5563', fontWeight: 400 }}>(required to save any change)</span>
                <input style={s.input} type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
              </label>
              {formError && <p style={s.error}>{formError}</p>}
              {saved && <p style={s.success}>✓ Saved.</p>}
              <button style={s.btn} type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </form>
          </section>
        </div>
      </div>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: '#4b5563', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: '#e6edf3', fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
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
  outer:    { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  page:     { flex: 1, background: '#0d1117', display: 'flex', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', padding: '32px 16px' },
  col:      { display: 'flex', flexDirection: 'column', gap: 20, width: 420, maxWidth: '100%' },
  card:     { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '28px 32px' },
  title:    { color: '#e6edf3', fontSize: 22, fontWeight: 700, margin: '0 0 2px', letterSpacing: -0.5 },
  subtitle: { color: '#7d8590', margin: '0 0 20px', fontSize: 13 },
  h2:       { fontSize: 13, fontWeight: 700, color: '#9198a1', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 18px' },
  statGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' },
  form:     { display: 'flex', flexDirection: 'column', gap: 14 },
  label:    { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#9198a1', fontWeight: 600 },
  input:    { padding: '9px 12px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', fontSize: 13, outline: 'none', fontWeight: 400 },
  error:    { color: '#f85149', fontSize: 12, margin: 0 },
  success:  { color: '#3fb950', fontSize: 12, margin: 0, fontWeight: 600 },
  btn:      { marginTop: 4, padding: '10px 0', background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  link:     { color: '#1f6feb', fontSize: 14, fontWeight: 600, textDecoration: 'none' },
};
