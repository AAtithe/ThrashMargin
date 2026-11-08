/**
 * Step through a list of beats, each held for its own (paced) duration. Like `useSequence` from
 * lib/motion.ts, but beats need not be evenly spaced, and the index is tied to `key` so the first
 * render of a new replay already starts at 0 (no one-frame flash of the final board).
 *
 * `index` is the number of beats revealed (0 … durations.length); `playing` stays true while the
 * last beat is held. With motion off, or a skip,
 * everything is revealed at once. Presentation only: the caller's state is already final.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { paced, usePace } from '../lib/motion';

export function useBeats(key: string | null, durations: number[]): { index: number; playing: boolean; skip: () => void } {
  const pace = usePace();
  const count = durations.length;
  const off = paced(1000, pace) <= 0;
  // Internally the index runs one past the end: the last beat is held for its own duration too.
  const end = count + 1;
  const [st, setSt] = useState<{ key: string | null; index: number }>({ key, index: end });
  const timer = useRef<number | null>(null);
  const durs = useRef(durations);
  durs.current = durations;

  useEffect(() => {
    if (key === null || off || count === 0) {
      setSt({ key, index: end });
      return;
    }
    setSt({ key, index: 0 });
    let i = 0;
    // The first beat appears almost at once; each later one after the previous beat's hold.
    const tick = () => {
      i += 1;
      setSt({ key, index: i });
      if (i < end) timer.current = window.setTimeout(tick, Math.max(40, paced(durs.current[i - 1])));
    };
    timer.current = window.setTimeout(tick, Math.min(80, paced(200)));
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, count, off]);

  const skip = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setSt({ key, index: end });
  }, [key, end]);

  const raw = st.key === key ? st.index : (key === null || off || count === 0 ? end : 0);
  return { index: Math.min(raw, count), playing: raw < end, skip };
}
