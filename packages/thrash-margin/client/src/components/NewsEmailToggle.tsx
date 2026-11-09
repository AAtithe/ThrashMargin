import { useEffect, useState } from 'react';
import { getToken } from '../lib/token';

const API = import.meta.env.VITE_API_URL ?? '';

/**
 * The account's consent to news emails, as a switch. Used on the What's new page and on Profile.
 * Off until the player turns it on (UK PECR: marketing email needs consent, not a default). The
 * switch moves only once the server has saved the change.
 */
export default function NewsEmailToggle({ compact = false }: { compact?: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` };

  useEffect(() => {
    fetch(`${API}/api/news/prefs`, { headers })
      .then(r => (r.ok ? r.json() : null))
      .then(d => d && setOn(d.emailOptIn === true))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async () => {
    if (on === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/news/prefs`, { method: 'PATCH', headers, body: JSON.stringify({ emailOptIn: !on }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.message ?? 'Could not save that');
      else setOn(d.emailOptIn === true);
    } catch {
      setError('Could not reach the server, try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: on === null ? 'default' : 'pointer' }}>
        <button
          type="button"
          role="switch"
          aria-checked={!!on}
          aria-label="Email me the portal's news"
          disabled={on === null || busy}
          onClick={toggle}
          data-testid="news-email-toggle"
          style={{
            position: 'relative', width: 38, height: 22, flex: 'none', borderRadius: 11, padding: 0,
            border: `1px solid ${on ? 'var(--news-house)' : 'var(--news-soft)'}`,
            background: on ? 'var(--news-house)' : 'transparent',
            cursor: busy ? 'wait' : 'pointer', opacity: on === null ? 0.5 : 1, transition: 'background 0.15s ease',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: on ? 19 : 3, width: 14, height: 14, borderRadius: 7,
            background: on ? 'var(--news-on-accent)' : 'var(--news-soft)', transition: 'left 0.15s ease',
          }} />
        </button>
        <span style={{ fontSize: compact ? 13 : 14, color: 'var(--news-text)', lineHeight: 1.4 }}>
          {on ? 'You get the news by email' : 'Email me the news'}
        </span>
      </label>
      {!compact && (
        <span style={{ fontSize: 12, color: 'var(--news-soft)', lineHeight: 1.5 }}>
          New games, features as they ship, and a monthly roundup. Unsubscribe from any email in one click.
        </span>
      )}
      {error && <span style={{ fontSize: 12, color: 'var(--portal-bad)' }}>{error}</span>}
    </div>
  );
}
