import { getStoredUser, clearToken } from '../lib/portalAuth';

interface PortalNavProps {
  variant?: 'header' | 'footer';
}

/**
 * Chrome for moving between the four games and managing the account shared across them (the same
 * tm_token/tm_user localStorage keys the other three games' PortalNavs read and write).
 *
 * Deliberately styled as portal chrome rather than in this game's own palette — it is the one strip
 * that looks identical everywhere, which is what makes it read as "the site" rather than part of
 * whichever game you happen to be in. Not rendered on the board screen itself, matching Thrash
 * Margin's own rule: that header is already dense with live state and this adds nothing mid-turn.
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
        <a href="/thrash-margin/" style={styles.link}>
          🎮 Thrash Margin
        </a>
        <span style={styles.sep}>·</span>
        <a href="/niccolo/" style={styles.link}>
          ⚖️ Banco di Niccolo
        </a>
        <span style={styles.sep}>·</span>
        <a href="/tea-race/" style={styles.link}>
          ⛵ The Tea Race
        </a>
        <span style={styles.sep}>·</span>
        <a href="/thrash-margin/feedback" style={styles.link}>
          💬 Feedback
        </a>
      </div>
      <div style={styles.right}>
        {user ? (
          <>
            <span>Signed in as {user.username}</span>
            <a href="/thrash-margin/profile" style={styles.link}>
              Profile
            </a>
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
    flexWrap: 'wrap',
    gap: '0.4rem',
    padding: '0.45rem 1.25rem',
    background: '#0b0c10',
    fontSize: '0.78rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    color: '#7a7f8a',
  },
  barHeader: { borderBottom: '1px solid #22252b' },
  barFooter: { borderTop: '1px solid #22252b' },
  links: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' },
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
