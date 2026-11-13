import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FONT, UI } from '../theme';

/** Small shared primitives, so every panel in the game agrees on its edges and its type scale. */

export function Panel({
  title,
  aside,
  children,
  style,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section style={{ ...panelStyle, ...style }}>
      {title && (
        <header style={panelHeader}>
          <h2 style={panelTitle}>{title}</h2>
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
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: Tone;
  title?: string;
  style?: CSSProperties;
  /** A stable hook for the guided tour to spotlight this control. See `GuidedTour.tsx`. */
  id?: string;
  /** A spoken name, for a button whose face is only a symbol. */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className="tr-btn"
      id={id}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...buttonBase,
        ...BUTTON_TONES[tone],
        ...(disabled ? { opacity: 0.38, cursor: 'not-allowed' } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

type Tone = 'default' | 'primary' | 'quiet' | 'danger';

const BUTTON_TONES: Record<Tone, CSSProperties> = {
  default: { borderColor: UI.ruleStrong, color: UI.text, background: UI.panelRaised },
  primary: { borderColor: UI.brass, color: UI.ground, background: UI.brass, fontWeight: 600 },
  quiet: { borderColor: UI.ruleStrong, color: UI.textSoft, background: 'transparent' },
  danger: { borderColor: UI.bad, color: UI.bad, background: 'transparent' },
};

/**
 * A link dressed as a Button, for navigation. A <button> inside an <a> is two nested interactive
 * controls (keyboard users meet it twice, screen readers announce it oddly); this is one.
 */
export function ButtonLink({
  to,
  children,
  tone = 'default',
  style,
}: {
  to: string;
  children: ReactNode;
  tone?: Tone;
  style?: CSSProperties;
}) {
  return (
    <Link
      to={to}
      className="tr-btn"
      style={{ ...buttonBase, ...BUTTON_TONES[tone], display: 'inline-flex', alignItems: 'center', textDecoration: 'none', ...style }}
    >
      {children}
    </Link>
  );
}

export function Pill({ children, colour }: { children: ReactNode; colour: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: FONT.data,
        fontSize: '0.62rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: colour,
        border: `1px solid ${colour}`,
        borderRadius: 2,
        padding: '0.1rem 0.4rem',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span style={labelStyle}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p style={{ ...bodySmall, color: UI.textFaint, margin: 0 }}>{children}</p>;
}

const panelStyle: CSSProperties = {
  border: `1px solid ${UI.rule}`,
  background: UI.panel,
  padding: '0.75rem 0.85rem 0.85rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  boxSizing: 'border-box',
};

const panelHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '0.6rem',
};

const panelTitle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.display,
  fontSize: '0.95rem',
  letterSpacing: '0.01em',
  color: UI.text,
};

const buttonBase: CSSProperties = {
  fontFamily: FONT.body,
  fontSize: '0.82rem',
  padding: '0.35rem 0.65rem',
  border: '1px solid',
  borderRadius: 2,
  cursor: 'pointer',
  lineHeight: 1.25,
};

export const labelStyle: CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.6rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: UI.textFaint,
};

export const bodySmall: CSSProperties = {
  fontFamily: FONT.body,
  fontSize: '0.83rem',
  lineHeight: 1.45,
  color: UI.textSoft,
};

export const dataText: CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.75rem',
  fontVariantNumeric: 'tabular-nums',
  color: UI.text,
};
