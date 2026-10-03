import { useEffect, useState } from 'react';
import { currentScheme, onSchemeChange, setScheme, type Scheme } from '../lib/colorScheme';

/**
 * One button that flips the whole portal between light and dark. Styled from the portal variables
 * so it looks the same in every game; pass `style` to fit it into a denser header.
 */
export default function ThemeToggle({ style }: { style?: React.CSSProperties }) {
  const [scheme, setLocal] = useState<Scheme>(currentScheme);
  useEffect(() => onSchemeChange(setLocal), []);
  const next: Scheme = scheme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setScheme(next)}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      style={{
        background: 'transparent',
        border: '1px solid var(--portal-btn-rule)',
        color: 'var(--portal-link)',
        borderRadius: 4,
        padding: '0.15rem 0.5rem',
        fontSize: '0.72rem',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {scheme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
