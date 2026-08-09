import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getToken } from '../lib/token';
import PortalNav from '../components/PortalNav';

const API = import.meta.env.VITE_API_URL ?? '';

const GAMES = [
  { value: 'general',       label: 'General / Portal' },
  { value: 'thrash_margin', label: 'Thrash Margin' },
  { value: 'niccolo',       label: 'Banco di Niccolo' },
  { value: 'tea_race',      label: 'The Tea Race' },
] as const;

const TYPES = [
  { value: 'bug',     label: '🐛 Bug report' },
  { value: 'idea',    label: '💡 Idea / suggestion' },
  { value: 'comment', label: '💬 General comment' },
] as const;

export default function Feedback() {
  const [game, setGame] = useState<string>('general');
  const [type, setType] = useState<string>('idea');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const signedIn = !!getToken();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ game, type, message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.message ?? 'Failed to submit — try again'); return; }
      setSent(true);
      setMessage('');
    } catch {
      setError('Network error — try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={s.outer}>
      <PortalNav variant="header" />
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.title}>Feedback</h1>
          <p style={s.subtitle}>Report a bug, suggest an idea, or just say something — about any game on the portal.</p>

          {!signedIn ? (
            <div style={s.signInPrompt}>
              <p style={{ margin: '0 0 12px', color: '#7d8590', fontSize: 13 }}>
                Sign in first so we know who to credit for the idea (or blame for the bug report).
              </p>
              <Link to="/login" style={s.signInLink}>Sign in →</Link>
            </div>
          ) : sent ? (
            <div style={s.sentBox}>
              <p style={{ margin: 0, color: '#3fb950', fontSize: 14, fontWeight: 600 }}>✓ Thanks — that's been sent.</p>
              <button style={s.linkBtn} onClick={() => setSent(false)}>Submit another</button>
            </div>
          ) : (
            <form onSubmit={submit} style={s.form}>
              <label style={s.label}>
                Which game?
                <select style={s.select} value={game} onChange={e => setGame(e.target.value)}>
                  {GAMES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </label>
              <label style={s.label}>
                Type
                <select style={s.select} value={type} onChange={e => setType(e.target.value)}>
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label style={s.label}>
                Message
                <textarea
                  style={s.textarea} rows={6} maxLength={4000} required
                  placeholder="What happened, or what would make this better?"
                  value={message} onChange={e => setMessage(e.target.value)}
                />
              </label>
              {error && <p style={s.error}>{error}</p>}
              <button style={s.btn} type="submit" disabled={submitting || !message.trim()}>
                {submitting ? 'Sending…' : 'Submit'}
              </button>
            </form>
          )}
        </div>
      </div>
      <PortalNav variant="footer" />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  outer:    { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  page:     { flex: 1, background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', padding: '32px 16px' },
  card:     { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: '36px 40px', width: 420, maxWidth: '100%', boxSizing: 'border-box' },
  title:    { color: '#e6edf3', fontSize: 24, fontWeight: 700, margin: '0 0 6px', letterSpacing: -0.5 },
  subtitle: { color: '#7d8590', margin: '0 0 24px', fontSize: 13, lineHeight: 1.5 },
  form:     { display: 'flex', flexDirection: 'column', gap: 14 },
  label:    { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#9198a1', fontWeight: 600 },
  select:   { padding: '9px 10px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', fontSize: 13, outline: 'none' },
  textarea: { padding: '10px 12px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  error:    { color: '#f85149', fontSize: 12, margin: 0 },
  btn:      { marginTop: 4, padding: '10px 0', background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  signInPrompt: { textAlign: 'center', padding: '8px 0' },
  signInLink: { color: '#1f6feb', fontSize: 14, fontWeight: 600, textDecoration: 'none' },
  sentBox:  { textAlign: 'center', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' },
  linkBtn:  { background: 'none', border: 'none', color: '#7d8590', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' },
};
