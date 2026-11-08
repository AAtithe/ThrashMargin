import { UI, FONT } from '../theme';
import PortalNav from './PortalNav';
import { Button } from './ui';
import { LoadingScreen } from '../lib/Loading';

/**
 * A campaign on its way: first the game screen's code chunk (the Suspense fallback in main.tsx),
 * then the save itself (GameScreen). Both stages render this, with the portal nav in place, so the
 * two read as one load. The shared loader skips its 300ms delay when it replaces another loader,
 * so there is no blink at the handover.
 */
export default function CampaignLoading({
  error = null,
  onRetry,
  onBack,
}: {
  error?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body }}>
      <PortalNav variant="header" />
      <LoadingScreen
        fullPage={false}
        motif="ledger"
        caption="Opening the ledger…"
        error={error}
        actions={
          <>
            {onRetry && <Button tone="primary" onClick={onRetry}>Try again</Button>}
            {onBack && <Button onClick={onBack}>Back to the lobby</Button>}
          </>
        }
      />
      <PortalNav variant="footer" />
    </div>
  );
}
