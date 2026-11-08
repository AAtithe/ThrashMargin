import { getStoredUser, hasGameAccess } from './lib/portalAuth';
import NoGameAccess from './lib/NoGameAccess';
import PortalNav from './components/PortalNav';
import LedgerScreen from './pages/LedgerScreen';

const GAME_KEY = 'founders_ledger';

export default function App() {
  const user = getStoredUser();

  /**
   * Every game on the portal requires a real account. **There is no guest path, and none is to be
   * added** — one existed in the other games and was deliberately removed. See CLAUDE.md at the repo
   * root.
   *
   * This check is presentational: it reads `tm_user` from localStorage and decides what to render, so
   * it is trivially satisfied client-side and protects nothing on its own. It still has to stay — it
   * is what stops the app inviting somebody to start a ledger they cannot save.
   *
   * The real boundary is server-side: api/play/[kind].ts runs `requireUser` (a Bearer JWT verified
   * against JWT_SECRET, 401 without one) and then the account's game access (403) before this game's
   * handler, which checks the user again. To check the UI locally, set `tm_user` in the console.
   */
  if (!user) {
    return (
      <div className="fl-page">
        <PortalNav />
        <main className="fl-gate">
          <div className="card fl-gate-card">
            <div className="eyebrow">Williams, Stanley &amp; Co. &middot; CEO coaching</div>
            <h2>The Founder's Ledger</h2>
            <p className="muted">Sign in to keep your ledger on your account.</p>
            <div>
              <a className="btn" href="/thrash-margin/login?next=/founders-ledger/">Sign in / Register</a>
            </div>
          </div>
        </main>
        <PortalNav variant="footer" />
      </div>
    );
  }

  // Game access, set per account on the Admin page. This game is opt-in (shared/games.ts): off for
  // every account until an admin turns it on. Presentational, like the check above: the server
  // refuses every request to a game the account does not have (api/play/[kind].ts).
  if (!hasGameAccess(user, GAME_KEY)) {
    return <NoGameAccess title="The Founder's Ledger" header={<PortalNav variant="header" />} footer={<PortalNav variant="footer" />} />;
  }

  return <LedgerScreen />;
}
