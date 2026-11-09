import { useEffect, useState } from 'react';

/**
 * How the battle screen arranges itself, read from the window rather than guessed from the
 * device name.
 *
 * - `touch`: the main pointer is a finger. Shows the command bar and swaps the wording of hints,
 *   the tour and the controls sheet. Input handling does not depend on it: every pointer event is
 *   routed by its own `pointerType`, so a touchscreen laptop works with both.
 * - `stacked`: a narrow, upright window. The battlefield goes on top and the build panel below it.
 * - `compact`: too narrow for the full top bar. Speed, sound, the tour and the controls sheet move
 *   into a Menu.
 * - `short`: a phone on its side. The sidebar narrows so the battlefield keeps its width.
 */
export interface Layout {
  touch: boolean;
  stacked: boolean;
  compact: boolean;
  short: boolean;
}

function read(): Layout {
  if (typeof window === 'undefined') return { touch: false, stacked: false, compact: false, short: false };
  const w = window.innerWidth;
  const h = window.innerHeight;
  const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return {
    touch,
    stacked: w <= 760 && h >= w,
    compact: w < 1100,
    short: h < 520,
  };
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const update = () =>
      setLayout(prev => {
        const next = read();
        return prev.touch === next.touch && prev.stacked === next.stacked && prev.compact === next.compact && prev.short === next.short
          ? prev
          : next;
      });
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
    mq?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      mq?.removeEventListener?.('change', update);
    };
  }, []);
  return layout;
}
