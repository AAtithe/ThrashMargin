import type { CSSProperties, ReactNode } from 'react';
import { FONT, UI } from '../theme';
import { Button as KitButton, type ButtonProps } from '../lib/Kit';

/**
 * Small shared primitives, ported from Tea Race's own `ui.tsx` (same tokens, so this is close to a
 * direct copy). Niccolò had none of this: every panel defined its own local `BUTTON`/`LABEL`
 * consts, duplicated ~25 times with tiny drifts between them. `FleetPanel` and `OrdersPanel` (the
 * two new always-visible sidebars) are built on these; older popup panels are free to adopt them
 * over time but were not forced to for this pass.
 */

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
 * The game's button, drawn by the portal kit (lib/Kit.tsx, lib/kit.css) in Niccolò's palette (the
 * --kit-* mapping in styles.css). Hover, press, focus, disabled, the 40px phone target and the
 * visible disabled reason all come from the kit; `style` still wins where a screen needs it.
 */
export function Button({ ariaLabel, ...rest }: ButtonProps & { ariaLabel?: string }) {
  return <KitButton aria-label={ariaLabel} {...rest} />;
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
