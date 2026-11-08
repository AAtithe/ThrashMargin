import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { easeOut, paced, usePace, useCountUp, useSkipOnInput } from '../lib/motion';
import { UI } from '../theme';

/**
 * Banco di Niccolò's own motion helpers, built on the portal toolkit in `lib/motion.ts`.
 *
 * Presentation only, like everything there: the simulation has already resolved the week (and the
 * save has already gone out) before any of this starts. These only decide how the screen catches up
 * — and every one of them finishes at once on a click or a key, and does nothing with motion off.
 */

/**
 * Notice when `value` changes and play a 0 → 1 tween from the previous value to the new one.
 *
 * `from` is what was on screen before the change; the caller draws the live value as the target.
 * Unlike `useProgress`, the restart happens during render (the "store the previous value" pattern),
 * so there is never a painted frame of the end state before the tween begins. Nothing plays on
 * first mount, and nothing plays with motion off. `same` decides what counts as a change (vessels
 * get a new array on every action, but only a change of position should make them glide).
 */
export function useTween<T>(
  value: T,
  baseMs: number,
  same: (a: T, b: T) => boolean = Object.is,
): { from: T; t: number; playing: boolean; skip: () => void } {
  const pace = usePace();
  const [seg, setSeg] = useState({ from: value, to: value, id: 0, dur: 0 });
  const [t, setT] = useState(1);
  if (!same(seg.to, value)) {
    const dur = paced(baseMs, pace);
    setSeg({ from: seg.to, to: value, id: seg.id + 1, dur });
    setT(dur > 0 ? 0 : 1);
  }
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (seg.id === 0 || seg.dur <= 0) return;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / seg.dur);
      setT(p);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [seg.id, seg.dur]);
  const skip = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setT(1);
  }, []);
  // Motion switched off mid-play: finish now rather than let the frame loop run on.
  const playing = t < 1 && pace !== 'off';
  useSkipOnInput(playing, skip);
  return { from: seg.from, t: playing ? t : 1, playing, skip };
}

/**
 * Reveal `count` freshly arrived items one after another when `key` changes (a new week), rather
 * than all at once. Returns props to spread onto item `i`: hidden items keep their space (so the
 * panel does not jump about as they land) and each one rises in as it is revealed. Outside a
 * playback it returns nothing at all, so a list that is not animating renders exactly as before —
 * and so does every list with motion off. A change of `count` alone does not replay anything.
 */
export function useStagger(key: unknown, count: number, stepMs = 240): (i: number) => { className?: string; style?: CSSProperties } {
  const { t, playing } = useTween(key, Math.max(1, count) * stepMs);
  return (i: number) => {
    if (!playing || count <= 0) return {};
    return t * count > i ? { className: 'tm-anim-rise' } : { style: { visibility: 'hidden' } };
  };
}

/** A florin figure that counts to its new value instead of snapping. */
export function Florins({ value, ms = 700 }: { value: number; ms?: number }) {
  const shown = useCountUp(Math.round(value), ms);
  return <>{Math.round(shown)}f</>;
}

/**
 * A florin figure that counts, plus a small "+40f" / "−12f" that floats up off it whenever it
 * changes — the week's wages and fees, a sale, a purchase. Nothing floats with motion off.
 */
export function FlorinsWithDelta({ value }: { value: number }) {
  const pace = usePace();
  const rounded = Math.round(value);
  const prev = useRef(rounded);
  const [delta, setDelta] = useState<{ amount: number; n: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = rounded;
    if (before === rounded || pace === 'off') return;
    setDelta(d => ({ amount: rounded - before, n: (d?.n ?? 0) + 1 }));
  }, [rounded, pace]);
  useEffect(() => {
    if (!delta) return;
    const clear = window.setTimeout(() => setDelta(null), paced(1200, pace) + 50);
    return () => window.clearTimeout(clear);
  }, [delta, pace]);
  return (
    <span style={{ position: 'relative' }}>
      <Florins value={value} />
      {delta && pace !== 'off' && <FloatingAmount key={delta.n} amount={delta.amount} style={{ left: 0, top: '-0.9em' }} />}
    </span>
  );
}

/** The floating "+40f" itself. Gains in the good tone, spending in the bad one. */
export function FloatingAmount({ amount, style }: { amount: number; style?: CSSProperties }) {
  return (
    <span
      className="tm-anim-float"
      aria-hidden="true"
      style={{
        position: 'absolute',
        whiteSpace: 'nowrap',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: amount >= 0 ? UI.good : UI.bad,
        pointerEvents: 'none',
        ...style,
      }}
    >
      {amount >= 0 ? '+' : '−'}
      {Math.abs(amount)}f
    </span>
  );
}

/** Ease-in-out for things that travel (a ship leaving port and arriving), where ease-out alone
 * makes the start look like a jolt. */
export function easeInOut(t: number): number {
  return t < 0.5 ? (1 - easeOut(1 - 2 * t)) / 2 : 0.5 + easeOut(2 * t - 1) / 2;
}
