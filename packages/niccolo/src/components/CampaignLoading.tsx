import { UI, FONT } from '../theme';
import PortalNav from './PortalNav';
import { Button } from './ui';
import { LoadingScreen, SIGN_IN_AGAIN } from '../lib/Loading';

/**
 * A campaign on its way: the game screen's code chunk and the save, fetched together by
 * pages/GameRoute.tsx, which keeps this one loader mounted until both are in, so the two read as
 * one load with nothing to hand over between them. The portal nav stays in place throughout.
 */
export default function CampaignLoading({
  error = null,
  onRetry,
  onBack,
  onSignIn,
}: {
  error?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
  /** Set when the sign-in has expired: the one action that can help, in place of Try again. */
  onSignIn?: () => void;
}) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body }}>
      <PortalNav variant="header" />
      <LoadingScreen
        fullPage={false}
        motif="ledger"
        caption="Opening the ledger…"
        error={onSignIn ? SIGN_IN_AGAIN : error}
        actions={
          onSignIn ? (
            <Button tone="primary" onClick={onSignIn}>Sign in again</Button>
          ) : (
            <>
              {onRetry && <Button tone="primary" onClick={onRetry}>Try again</Button>}
              {onBack && <Button onClick={onBack}>Back to the lobby</Button>}
            </>
          )
        }
      />
      <PortalNav variant="footer" />
    </div>
  );
}
