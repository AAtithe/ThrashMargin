import type { CSSProperties, ReactNode } from 'react';
import { FONT, UI } from '../theme';
import { Button as KitButton, type ButtonProps as KitButtonProps } from '../lib/Kit';

/** Small shared primitives, so every panel in the game agrees on its edges and its type scale. */

/** A manual section's anchor, from its title (How to play's index links to it). */
export const manualSlug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** One section of the How to play manual: a plate heading with a groove, and an anchor the index links to. */
export function ManualSection({ title, children }: { title: string; children: ReactNode }) {
  const id = manualSlug(title);
  return (
    <section className="fl-d-manual-sect" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

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
 * mapping in styles.css), which brings hover, press, focus, disabled, the 40px phone target and
 * the visible disabled reason. `fl-ui-btn` and `data-tone` stay for the game's own rules.
 */
export function Button({
  tone = 'default',
  testId,
  className,
  ...rest
}: KitButtonProps & {
  /** Rendered as data-testid, for scripts that drive the page. */
  testId?: string;
}) {
  return (
    <KitButton
      {...rest}
      tone={tone}
      data-tone={tone}
      data-testid={testId}
      className={className ? `fl-ui-btn ${className}` : 'fl-ui-btn'}
    />
  );
}

export function Pill({ children, colour }: { children: ReactNode; colour: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: FONT.mono,
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
  fontFamily: FONT.mono,
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
  fontFamily: FONT.mono,
  fontSize: '0.75rem',
  fontVariantNumeric: 'tabular-nums',
  color: UI.text,
};
