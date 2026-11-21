import type { CSSProperties, ReactNode } from 'react';
import { FONT, UI } from '../theme';
import { Button as KitButton, type ButtonProps as KitButtonProps } from '../lib/Kit';

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

/**
 * The game's button: the portal kit's Button (lib/Kit.tsx, styled by lib/kit.css with the --kit-*
 * mapping in styles.css), so hover, press, focus, disabled and the 40px phone target are written
 * once. `disabledReason` shows as a visible line under the button while it is disabled.
 * `id` is a stable hook for the guided run to spotlight this control (see `GuidedTour.tsx`).
 */
export function Button(props: KitButtonProps) {
  return <KitButton {...props} />;
}

type ButtonTone = 'default' | 'primary' | 'quiet' | 'danger';

/** A button's look, for the odd control that has to be something else (a router link) but should
 *  read as a button: the kit's own classes, so it shares the kit Button's states. */
export function buttonClass(tone: ButtonTone = 'default'): string {
  return tone === 'default' ? 'kit-btn' : `kit-btn kit-btn--${tone}`;
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
