import { getStoredUser, clearToken } from '../lib/portalAuth';
import ThemeToggle from './ThemeToggle';

interface PortalNavProps {
  variant?: 'header' | 'footer';
}

/** Chrome for moving between the three games and managing the Thrash Margin account
 * session — Niccolo itself has no accounts, this just reflects/controls the same
 * tm_token/tm_user localStorage keys the other games' PortalNavs write. */
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
        <a href="/tea-race/" style={styles.link}>
          ⛵ The Tea Race
        </a>
        <span style={styles.sep}>·</span>
        <a href="/steady-eddie/" style={styles.link}>
          🚚 Steady Eddie
        </a>
        <span style={styles.sep}>·</span>
        <a href="/rising/" style={styles.link}>
          🗡 Niccolò Rising
        </a>
        <span style={styles.sep}>·</span>
        <a href="/thrash-margin/feedback" style={styles.link}>
          💬 Feedback
        </a>
        {/* Absolute, not base-relative: the admin panel only exists as a route inside Thrash
            Margin's own client, same as feedback/profile/login above. Shown to admins only, as a
            courtesy: hiding it protects nothing. Access is enforced server-side, where every
            admin endpoint checks users.role. */}
        {user?.isAdmin && (
          <>
            <span style={styles.sep}>·</span>
            <a href="/thrash-margin/admin" style={styles.link}>
              🛠 Admin
            </a>
          </>
        )}
      </div>
      <div style={styles.right}>
        <ThemeToggle />
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
          <a href="/thrash-margin/login?next=/niccolo/" style={styles.link}>
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
    background: 'var(--portal-bar)',
    fontSize: '0.78rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    color: 'var(--portal-bar-text)',
  },
  barHeader: { borderBottom: '1px solid var(--portal-bar-rule)' },
  barFooter: { borderTop: '1px solid var(--portal-bar-rule)' },
  links: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' },
  sep: { color: 'var(--portal-sep)', margin: '0 0.6rem' },
  right: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  link: { color: 'var(--portal-link)', textDecoration: 'none' },
  signOut: {
    background: 'transparent',
    border: '1px solid var(--portal-btn-rule)',
    color: 'var(--portal-link)',
    borderRadius: 4,
    padding: '0.15rem 0.5rem',
    fontSize: '0.72rem',
    cursor: 'pointer',
  },
};
