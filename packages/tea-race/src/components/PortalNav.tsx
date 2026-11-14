import { getStoredUser, clearToken, hasGameAccess } from '../lib/portalAuth';
import ThemeToggle from './ThemeToggle';
import MotionToggle from './MotionToggle';

interface PortalNavProps {
  variant?: 'header' | 'footer';
}

/**
 * Chrome for moving between the three games and managing the account shared across them (the same
 * tm_token/tm_user localStorage keys the other two games' PortalNavs read and write).
 *
 * Deliberately styled as portal chrome rather than in this game's own palette — it is the one strip
 * that looks identical everywhere, which is what makes it read as "the site" rather than part of
 * whichever game you happen to be in. Not rendered on the board screen itself, matching Thrash
 * Margin's own rule: that header is already dense with live state and this adds nothing mid-turn.
 */
export default function PortalNav({ variant = 'header' }: PortalNavProps) {
  const user = getStoredUser();
  // Games the account has not been given (Admin page, Game access) are left out. A courtesy only:
  // the server refuses them regardless (api/play/[kind].ts). Signed out, every game is listed, since
  // each lobby then offers sign-in.
  const canSee = (game: string) => !user || hasGameAccess(user, game);
  const isFooter = variant === 'footer';

  return (
    <div className="portal-nav" style={{ ...styles.bar, ...(isFooter ? styles.barFooter : styles.barHeader) }}>
      <div className="portal-nav-links" style={styles.links}>
        <a href="/" className="portal-nav-link" style={styles.link}>
          🏠 Home
        </a>
        {canSee('thrash_margin') && (
          <>
            <span className="portal-nav-sep" aria-hidden="true" style={styles.sep}>·</span>
            <a href="/thrash-margin/" className="portal-nav-link" style={styles.link}>
              🎮 Thrash Margin
            </a>
          </>
        )}
        {canSee('niccolo') && (
          <>
            <span className="portal-nav-sep" aria-hidden="true" style={styles.sep}>·</span>
            <a href="/niccolo/" className="portal-nav-link" style={styles.link}>
              ⚖️ Banco di Niccolò
            </a>
          </>
        )}
        {canSee('steady_eddie') && (
          <>
            <span className="portal-nav-sep" aria-hidden="true" style={styles.sep}>·</span>
            <a href="/steady-eddie/" className="portal-nav-link" style={styles.link}>
              🚚 Steady Eddie
            </a>
          </>
        )}
        {canSee('niccolo_rising') && (
          <>
            <span className="portal-nav-sep" aria-hidden="true" style={styles.sep}>·</span>
            <a href="/rising/" className="portal-nav-link" style={styles.link}>
              🗡 Niccolò Rising
            </a>
          </>
        )}
        {canSee('fireline') && (
          <>
            <span className="portal-nav-sep" aria-hidden="true" style={styles.sep}>·</span>
            <a href="/fireline/" className="portal-nav-link" style={styles.link}>
              🎯 Fireline
            </a>
          </>
        )}
        <span className="portal-nav-sep" aria-hidden="true" style={styles.sep}>·</span>
        <a href="/thrash-margin/feedback" className="portal-nav-link" style={styles.link}>
          💬 Feedback
        </a>
        {/* Absolute, not base-relative: the admin panel only exists as a route inside Thrash
            Margin's own client, same as feedback/profile/login above. Shown to admins only, as a
            courtesy: hiding it protects nothing. Access is enforced server-side, where every
            admin endpoint checks users.role. */}
        {user?.isAdmin && (
          <>
            <span className="portal-nav-sep" aria-hidden="true" style={styles.sep}>·</span>
            <a href="/thrash-margin/admin" className="portal-nav-link" style={styles.link}>
              🛠 Admin
            </a>
          </>
        )}
      </div>
      <div className="portal-nav-right" style={styles.right}>
        <MotionToggle />
        <ThemeToggle />
        {user ? (
          <>
            <span className="portal-nav-user">Signed in as {user.username}</span>
            <a href="/thrash-margin/profile" className="portal-nav-link" style={styles.link}>
              Profile
            </a>
            <button
              className="portal-nav-btn" style={styles.signOut}
              onClick={() => {
                clearToken();
                window.location.reload();
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <a href="/thrash-margin/login?next=/tea-race/" className="portal-nav-link" style={styles.link}>
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
