import type { CSSProperties, ReactNode } from 'react';
import { FONT, UI } from '../theme';

/** Shared primitives, so every panel agrees on its edges and its type scale. */

export function Panel({ title, aside, children, style }: { title?: string; aside?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ border: `1px solid ${UI.rule}`, background: UI.panel, padding: '0.9rem 1rem', marginBottom: '0.9rem', ...style }}>
      {title && (
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.8rem', marginBottom: '0.7rem' }}>
          <h2 style={{ margin: 0, fontFamily: FONT.display, fontSize: '1.05rem', color: UI.brass, letterSpacing: '0.04em', fontWeight: 'normal' }}>{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  tone = 'default',
  title,
  style,
  id,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'quiet' | 'danger';
  title?: string;
  style?: CSSProperties;
  /** A stable hook for the guided first hours to spotlight this control. See `GuidedTour.tsx`. */
  id?: string;
}) {
  const tones: Record<string, CSSProperties> = {
    default: { borderColor: UI.ruleStrong, color: UI.text, background: UI.panelRaised },
    primary: { borderColor: UI.brass, color: UI.ground, background: UI.brass, fontWeight: 600 },
    quiet: { borderColor: UI.rule, color: UI.textSoft, background: 'transparent' },
    danger: { borderColor: UI.bad, color: UI.bad, background: 'transparent' },
  };
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        border: '1px solid',
        padding: '0.35rem 0.7rem',
        fontFamily: FONT.body,
        fontSize: '0.8rem',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        ...tones[tone],
        ...(disabled ? { opacity: 0.38, cursor: 'not-allowed' } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Blurb({ children }: { children: ReactNode }) {
  return <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: UI.textSoft, lineHeight: 1.45 }}>{children}</p>;
}

export function Row({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem', padding: '0.6rem 0', borderTop: `1px solid ${UI.rule}`, ...style }}>
      {children}
    </div>
  );
}

export function Meta({ children, colour }: { children: ReactNode; colour?: string }) {
  return <span style={{ fontFamily: FONT.data, fontSize: '0.72rem', color: colour ?? UI.textFaint }}>{children}</span>;
}

/**
 * A filled bar. `ahead`, when given, is where the bar is heading before its next step (a bar part way
 * to its next refill): it is drawn as a faint fill behind the solid one and glides there with the
 * screen's one-second clock, so a refilling bar creeps up continuously instead of jumping at each tick.
 * When the value drops, the faint fill is left behind for that second and trails down after it, a
 * small mark of what was just lost. Callers omit `ahead` when motion is off, and the bar is exactly
 * the plain one.
 */
export function Meter({ value, max, colour, height = 6, ahead }: { value: number; max: number; colour: string; height?: number; ahead?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  if (ahead !== undefined) {
    const aheadPct = max > 0 ? Math.max(pct, Math.min(100, (ahead / max) * 100)) : 0;
    return (
      <div style={{ height, background: UI.ground, border: `1px solid ${UI.rule}`, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: `${aheadPct}%`, height: '100%', background: colour, opacity: 0.35, transition: 'width 1000ms linear' }} />
        <div style={{ position: 'relative', width: `${pct}%`, height: '100%', background: colour, transition: 'width 300ms' }} />
      </div>
    );
  }
  return (
    <div style={{ height, background: UI.ground, border: `1px solid ${UI.rule}` }}>
      <div style={{ width: `${pct}%`, height: '100%', background: colour, transition: 'width 300ms' }} />
    </div>
  );
}
