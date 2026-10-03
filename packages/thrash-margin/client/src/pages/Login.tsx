import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, setToken, setStoredUser } from '../lib/token';
import PortalNav from '../components/PortalNav';

const API = import.meta.env.VITE_API_URL ?? '';

/**
 * Every game in the portal signs in here, and each lobby's sign-in button passes `?next=` with its
 * own path so the player lands back in the game they came from rather than in Thrash Margin's lobby.
 *
 * `next` is only ever followed when it is a same-origin absolute path: it must start with a single
 * '/', so '//evil.example' and 'https://...' are refused and the page falls back to its own lobby.
 */
function safeNext(): string | null {
  const raw = new URLSearchParams(window.location.search).get('next');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}

const GAME_TITLES: { prefix: string; title: string; subtitle: string }[] = [
  { prefix: '/rising/', title: 'Niccolò Rising', subtitle: 'Bruges · 1460 · in real time' },
  { prefix: '/niccolo/', title: 'Banco di Niccolo', subtitle: 'Trade · Credit · Intelligence' },
  { prefix: '/tea-race/', title: 'The Tea Race', subtitle: 'Clippers · Cargo · First home' },
  { prefix: '/steady-eddie/', title: 'Steady Eddie', subtitle: 'Haulage · Loads · First to the depot' },
];

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const next = safeNext();
  const game = next ? GAME_TITLES.find(g => next.startsWith(g.prefix)) : undefined;

  // Another game is a separate build, so leaving for it is a full page load, not a router push.
  const leave = useCallback(() => {
    if (next) window.location.assign(next);
    else nav('/');
  }, [next, nav]);

  useEffect(() => {
    if (getToken()) leave();
  }, [leave]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body = mode === 'register'
        ? { username, email, password }
        : { username, password };
      const res = await fetch(`${API}/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed'); return; }
      setToken(data.token);
      setStoredUser({ userId: data.userId, username: data.username });
      leave();
    } catch {
      setError('Network error — try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.outer}>
      <PortalNav variant="header" />
      <div style={s.page}>
        <div style={s.card}>
        <h1 style={s.title}>{game?.title ?? 'Thrash Margin'}</h1>
        <p style={s.subtitle}>{game?.subtitle ?? 'Territory · Economy · Conquest'}</p>

        <div style={s.tabs}>
          {(['login', 'register'] as const).map(m => (
            <button key={m} style={mode === m ? s.tabOn : s.tabOff} onClick={() => { setMode(m); setError(null); }}>
              {m === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={s.form}>
          <input
            style={s.input} placeholder="Username" autoComplete="username"
            value={username} onChange={e => setUsername(e.target.value)} required
          />
          {mode === 'register' && (
            <input
              style={s.input} type="email" placeholder="Email" autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)} required
            />
          )}
          <input
            style={s.input} type="password" placeholder="Password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password} onChange={e => setPassword(e.target.value)} required
          />
          {error && <p style={s.error}>{error}</p>}
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? '…' : game ? (mode === 'login' ? 'Sign in →' : 'Create account →') : mode === 'login' ? 'Enter campaign' : 'Begin campaign'}
          </button>
        </form>
        </div>
      </div>
      <PortalNav variant="footer" />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  outer:   { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  page:    { flex: 1, background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' },
  card:    { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '40px 48px', width: 340 },
  title:   { color: '#e6edf3', fontSize: 28, fontWeight: 700, margin: '0 0 4px', letterSpacing: -0.5 },
  subtitle:{ color: '#7d8590', margin: '0 0 28px', fontSize: 13 },
  tabs:    { display: 'flex', gap: 2, marginBottom: 20, background: '#0d1117', borderRadius: 6, padding: 3 },
  tabOn:   { flex: 1, padding: '7px 0', border: 'none', background: '#21262d', color: '#e6edf3', cursor: 'pointer', borderRadius: 4, fontSize: 13, fontWeight: 600 },
  tabOff:  { flex: 1, padding: '7px 0', border: 'none', background: 'transparent', color: '#7d8590', cursor: 'pointer', borderRadius: 4, fontSize: 13 },
  form:    { display: 'flex', flexDirection: 'column', gap: 10 },
  input:   { padding: '9px 12px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', fontSize: 13, outline: 'none' },
  error:   { color: '#f85149', fontSize: 12, margin: 0 },
  btn:     { marginTop: 6, padding: '10px 0', background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
};
