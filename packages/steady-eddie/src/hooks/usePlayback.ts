import { useCallback, useEffect, useRef, useState } from 'react';
import { paced, usePace } from '../lib/motion';

/**
 * Two small playback clocks for the presentation layer, built on lib/motion.ts's pace.
 *
 * They differ from motion.ts's `useProgress` and `useSequence` in one way that matters on this
 * screen: both remember which `key` their value belongs to, and report the *start* of a new key on
 * the very render the key changes. The shared hooks reset in an effect, so the first render after a
 * change still carries the previous run's finished value. For a lorry that is one painted frame at
 * her destination before she jumps back to set off, which reads as a flicker.
 *
 * Nothing here touches game state. With the pace off both report "finished" at once.
 */

/** 0 → 1 over `baseMs` (paced), restarting whenever `key` changes. `skip` jumps to 1. */
export function useTween(key: string | number | null, baseMs: number): { t: number; skip: () => void } {
  const pace = usePace();
  const dur = key === null ? 0 : paced(baseMs, pace);
  const [st, setSt] = useState<{ key: typeof key; t: number }>({ key, t: 1 });
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (dur <= 0) {
      setSt({ key, t: 1 });
      return;
    }
    const start = performance.now();
    setSt({ key, t: 0 });
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      setSt({ key, t });
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [key, dur]);

  const skip = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setSt({ key, t: 1 });
  }, [key]);

  const t = st.key === key ? st.t : dur > 0 ? 0 : 1;
  return { t, skip };
}

/**
 * Step through frames, each held for its own duration (`baseMs[i]`, paced). `index` is the frame on
 * screen: 0 … count-1 while playing, `count` once finished (show the real state). Restarts when
 * `key` changes; the durations are read when it does.
 */
export function useSteps(
  key: string | number | null,
  baseMs: number[],
): { index: number; playing: boolean; skip: () => void } {
  const pace = usePace();
  const count = baseMs.length;
  const factor = key === null ? 0 : paced(1000, pace) / 1000;
  const [st, setSt] = useState<{ key: typeof key; index: number }>({ key, index: count });
  const timer = useRef<number | null>(null);
  const durations = useRef(baseMs);
  durations.current = baseMs;

  useEffect(() => {
    if (factor <= 0 || count <= 0) {
      setSt({ key, index: count });
      return;
    }
    let i = 0;
    setSt({ key, index: 0 });
    const hold = (n: number) => Math.max(16, Math.round((durations.current[n] ?? 0) * factor));
    const tick = () => {
      i += 1;
      setSt({ key, index: i });
      if (i < count) timer.current = window.setTimeout(tick, hold(i));
    };
    timer.current = window.setTimeout(tick, hold(0));
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [key, count, factor]);

  const skip = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setSt({ key, index: count });
  }, [key, count]);

  const index = st.key === key ? st.index : factor > 0 && count > 0 ? 0 : count;
  return { index, playing: index < count, skip };
}
