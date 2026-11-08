import type { ReactNode } from 'react';

/**
 * What a lobby shows a signed-in player whose account does not have this game turned on (Admin page,
 * Game access). Presentational, like the sign-in panel beside it: the server refuses every request to
 * the game regardless (api/play/[kind].ts). Uses the portal's own colour tokens (portal.css, the same
 * file in every game), so it looks the same in all five and follows light and dark mode.
 */
export default function NoGameAccess({ title, header, footer }: { title: string; header?: ReactNode; footer?: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--portal-ground)' }}>
      {header}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div
          data-testid="no-game-access"
          style={{
            background: 'var(--portal-panel)',
            border: '1px solid var(--portal-rule)',
            borderRadius: 12,
            padding: '32px 28px',
            maxWidth: 420,
            width: '100%',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: 'var(--portal-text)',
          }}
        >
          <h1 style={{ fontSize: 26, margin: '0 0 8px', fontWeight: 700 }}>{title}</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--portal-soft)', margin: '0 0 20px' }}>
            Your account does not have access to this game yet. An admin can turn it on for you.
          </p>
          <a href="/" style={{ color: 'var(--portal-action)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Back to the portal
          </a>
        </div>
      </div>
      {footer}
    </div>
  );
}
