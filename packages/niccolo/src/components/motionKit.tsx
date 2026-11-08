import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FloatText, signed, useCountUp, useFloats, useSkipOnInput, useStagger } from '../lib/motion';
import { UI } from '../theme';

/**
 * Banco di Niccolò's own motion pieces: the florin formatting and the one adaptation of the portal
 * toolkit (`lib/motion.ts`) this game needs. Everything generic lives there.
 *
 * Presentation only: the simulation has already resolved the week (and the save has already gone
 * out) before any of this starts. Every playback finishes at once on a click or a key, and nothing
 * plays with motion off.
 */

/**
 * Reveal `count` freshly arrived items one after another when `week` changes, rather than all at
 * once (the shared `useStagger`). The shared hook is key-driven; this turns the week into that key
 * so that, as the game has always had it:
 *   - nothing plays on first mount (the key is `null` until the week first changes);
 *   - a change of `count` alone does not replay (the count is frozen at the moment the week turned,
 *     since the shared hook restarts when its duration changes);
 *   - a click or a key reveals everything at once (the run's key drops to `null`).
 */
export function useWeekStagger(week: number | undefined, count: number, stepMs = 240): (i: number) => { className?: string; style?: CSSProperties } {
  const [run, setRun] = useState({ week, n: 0, count });
  if (run.week !== week) setRun({ week, n: run.n + 1, count });
  const [skipped, setSkipped] = useState(0);
  const key = run.n === 0 || skipped === run.n ? null : run.n;
  const reveal = useStagger(key, run.count, stepMs);
  const first = reveal(0);
  useSkipOnInput(first.className !== undefined || first.style !== undefined, () => setSkipped(run.n));
  return reveal;
}

/** A florin amount as a float reads it, "+40f" / "−12f", in the good tone for a gain and the bad
 * one for spending. */
export function florinFloat(amount: number): { text: string; colour: string } {
  return { text: signed(amount, n => `${n}f`), colour: amount >= 0 ? UI.good : UI.bad };
}

/** A florin figure that counts to its new value instead of snapping. */
export function Florins({ value, ms = 700 }: { value: number; ms?: number }) {
  const shown = useCountUp(Math.round(value), ms);
  return <>{Math.round(shown)}f</>;
}

/**
 * A florin figure that counts, plus a small "+40f" / "−12f" that floats up off it whenever it
 * changes — the week's wages and fees, a sale, a purchase. One float at a time: a second change
 * replaces the first. Nothing floats with motion off.
 */
export function FlorinsWithDelta({ value }: { value: number }) {
  const rounded = Math.round(value);
  const prev = useRef(rounded);
  const { items, push } = useFloats(1200, 1);
  useEffect(() => {
    const before = prev.current;
    prev.current = rounded;
    if (before === rounded) return;
    const f = florinFloat(rounded - before);
    push(f.text, f.colour);
  }, [rounded, push]);
  return (
    <span style={{ position: 'relative' }}>
      <Florins value={value} />
      {items.map(f => (
        <FloatText key={f.id} text={f.text} colour={f.colour} style={{ left: 0, top: '-0.9em' }} />
      ))}
    </span>
  );
}
