import { getStoredUser, clearToken } from '../lib/token';

interface PortalNavProps {
  variant?: 'header' | 'footer';
}

/**
 * Chrome for moving between the two games and managing the account that's shared
 * across them (same tm_token/tm_user localStorage keys Niccolo's own PortalNav reads).
 * Deliberately not rendered on the in-game screen (Game.tsx) — that header is already
 * dense with live gameplay state and this adds nothing useful mid-turn.
 */
export default function PortalNav({ variant = 'header' }: PortalNavProps) {
  const user = getStoredUser();
  const isFooter = variant === 'footer';

  return (
    <div style={{ ...styles.bar, ...(isFooter ? styles.barFooter : styles.barHeader) }}>
      <div style={styles.links}>
        <a href="/" style={styles.link}>
          🏠 Home
        </a>
        <span style={styles.sep}>·</span>
        <a href="/niccolo/" style={styles.link}>
          🎮 Play Banco di Niccolo
        </a>
      </div>
      <div style={styles.right}>
        {user ? (
          <>
            <span>Signed in as {user.username}</span>
            <button
              style={styles.signOut}
              onClick={() => {
                clearToken();
                window.location.reload();
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <a href="/thrash-margin/login" style={styles.link}>
            Sign in
          </a>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.45rem 1.25rem',
    background: '#0b0c10',
    fontSize: '0.78rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    color: '#7a7f8a',
  },
  barHeader: { borderBottom: '1px solid #22252b' },
  barFooter: { borderTop: '1px solid #22252b' },
  links: { display: 'flex', alignItems: 'center' },
  sep: { color: '#3a3e46', margin: '0 0.6rem' },
  right: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  link: { color: '#9aa1ad', textDecoration: 'none' },
  signOut: {
    background: 'transparent',
    border: '1px solid #333a48',
    color: '#9aa1ad',
    borderRadius: 4,
    padding: '0.15rem 0.5rem',
    fontSize: '0.72rem',
    cursor: 'pointer',
  },
};
