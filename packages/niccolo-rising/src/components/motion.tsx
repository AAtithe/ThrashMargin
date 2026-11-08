import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { paced, useCountUp, usePace } from '../lib/motion';
import { FONT, UI } from '../theme';

/**
 * Niccolò Rising's presentation-only motion: the pieces built on lib/motion.ts (the portal's
 * shared toolkit) that this game's screens use. Nothing here reads or changes game state; it only
 * shows, a moment later, what the simulation already decided. With motion off every piece renders
 * exactly the markup the screen had before.
 */

/** One visible consequence of an action, shown as a floating marker by the button that caused it. */
export interface Gain {
  text: string;
  good: boolean;
}

/**
 * What became of the last action a button dispatched. `rejected` is an illegal action (the sim
 * returned the same state object); `bad` is a legal action whose story went against the player (a
 * new log line in the bad tone: a scheme caught, a duel lost).
 */
export interface Outcome {
  seq: number;
  origin: string;
  result: 'ok' | 'bad' | 'rejected';
  gains: Gain[];
}

export const OutcomeContext = createContext<Outcome | null>(null);

/** Restart a one-shot animation class on an element without remounting it (which would drop focus). */
export function replay(el: HTMLElement | null, cls: string): void {
  if (!el) return;
  el.classList.remove('tm-anim-pulse', 'tm-anim-shake', 'tm-anim-pop');
  void el.offsetWidth;
  el.classList.add(cls);
}

interface FloatItem {
  id: number;
  text: string;
  colour: string;
}

let nextFloat = 0;

/** A short-lived stack of floating "+12 gr" markers. Nothing is added while motion is off. */
export function useFloats(): { items: FloatItem[]; push: (text: string, colour: string) => void } {
  const pace = usePace();
  const [items, setItems] = useState<FloatItem[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);
  const push = useCallback(
    (text: string, colour: string) => {
      const ms = paced(1100, pace);
      if (ms <= 0) return;
      const id = ++nextFloat;
      setItems(prev => [...prev.slice(-2), { id, text, colour }]);
      timers.current.push(window.setTimeout(() => setItems(prev => prev.filter(f => f.id !== id)), ms + 60));
    },
    [pace],
  );
  return { items, push };
}

/** Where a float drifts up from: beside the value (left or right of it) or above a button. */
export type FloatSide = 'left' | 'right' | 'above';

export function Floats({ items, side }: { items: FloatItem[]; side: FloatSide }) {
  return (
    <>
      {items.map((f, i) => {
        const place: CSSProperties =
          side === 'above'
            ? { left: 0, right: 0, bottom: `calc(100% + ${0.15 + i * 1.05}em)`, textAlign: 'center' }
            : side === 'right'
              ? { left: '100%', marginLeft: 6, top: `${-i * 1.05}em` }
              : { right: '100%', marginRight: 6, top: `${-i * 1.05}em` };
        return (
          <span
            key={f.id}
            aria-hidden="true"
            className="tm-anim-float nr-float"
            style={{
              position: 'absolute',
              ...place,
              color: f.colour,
              fontFamily: FONT.data,
              fontSize: '0.72rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            {f.text}
          </span>
        );
      })}
    </>
  );
}

/**
 * A number shown as it changes: it counts to its new value, pulses once, and (optionally) floats the
 * difference beside itself. Give it a `key` that changes when the number's meaning resets (another
 * character, a new level), so it snaps instead of counting across the reset.
 */
export function Tally({
  value,
  format,
  decimals = 0,
  float,
  floatFormat,
  ms = 600,
}: {
  value: number;
  format: (n: number) => string;
  decimals?: number;
  /** Float the change beside the number, on this side. Omit for a count and pulse only. */
  float?: FloatSide;
  floatFormat?: (delta: number) => string;
  ms?: number;
}) {
  const pace = usePace();
  const shown = useCountUp(value, ms, decimals);
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const { items, push } = useFloats();
  useEffect(() => {
    const delta = value - prev.current;
    prev.current = value;
    if (delta === 0 || pace === 'off') return;
    replay(ref.current, 'tm-anim-pulse');
    if (float && Math.abs(delta) >= 10 ** -decimals / 2) {
      const text = floatFormat ? floatFormat(delta) : `${delta > 0 ? '+' : '−'}${format(Math.abs(delta))}`;
      push(text, delta > 0 ? UI.good : UI.bad);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (pace === 'off') return <>{format(value)}</>;
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {format(shown)}
      {float && <Floats items={items} side={float} />}
    </span>
  );
}

/**
 * A slim bar for something running against the clock (a course, a journey, the day to payday). It is
 * redrawn with each second of the screen's clock and glides between seconds with a linear transition
 * of the same length, so it moves continuously. Nothing at all while motion is off.
 */
export function TimerBar({ start, end, now, colour, style }: { start: number; end: number; now: number; colour: string; style?: CSSProperties }) {
  const pace = usePace();
  if (pace === 'off' || !(end > start)) return null;
  const pct = Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      style={{ height: 4, background: UI.ground, border: `1px solid ${UI.rule}`, margin: '0.35rem 0', overflow: 'hidden', ...style }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: colour, transition: 'width 1000ms linear' }} />
    </div>
  );
}

/** Wrap children in a relatively positioned inline box, so floats can anchor to it. */
export function Anchor({ children, innerRef }: { children: ReactNode; innerRef?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={innerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {children}
    </span>
  );
}

/**
 * A TimerBar for a wait whose start the state does not record (the Infirmary, the Steen): it runs
 * from the moment this screen first showed the wait to its end. Mount it with the panel it sits in.
 */
export function Countdown({ until, now, colour }: { until: number; now: number; colour: string }) {
  const [from] = useState(now);
  return <TimerBar start={from} end={until} now={now} colour={colour} />;
}
