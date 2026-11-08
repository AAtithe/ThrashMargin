import { createContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { FloatText, replayClass, signed, useCountUp, useFloats, usePace } from '../lib/motion';
import type { FloatItem } from '../lib/motion';
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

/** How long a float lives and how many stack at once (this game shows at most three). */
const FLOAT_MS = 1100;
const FLOAT_MAX = 3;

/** The portal's floating-amount stack, sized for this game's markers. */
export function useGameFloats() {
  return useFloats(FLOAT_MS, FLOAT_MAX);
}

/** Where a float drifts up from: beside the value (left or right of it) or above a button. */
export type FloatSide = 'left' | 'right' | 'above';

/** The shared FloatText, placed beside a value or above a button and set in the data face. */
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
        return <FloatText key={f.id} text={f.text} colour={f.colour} style={{ ...place, fontFamily: FONT.data, fontSize: '0.72rem', zIndex: 2 }} />;
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
  const { items, push } = useGameFloats();
  useEffect(() => {
    const delta = value - prev.current;
    prev.current = value;
    if (delta === 0 || pace === 'off') return;
    replayClass(ref.current, 'tm-anim-pulse');
    if (float && Math.abs(delta) >= 10 ** -decimals / 2) {
      const text = floatFormat ? floatFormat(delta) : signed(delta, format);
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
 * A TimerBar for a stay in the Infirmary or the Steen. Saves from 2026-11-08 record when the stay
 * began (`since`) and the bar runs from there, so it survives a reload; older saves do not, and the
 * bar then runs from the moment this screen first showed the stay. Mount it with the panel it sits in.
 */
export function Countdown({ since, until, now, colour }: { since?: number; until: number; now: number; colour: string }) {
  const [firstSeen] = useState(now);
  return <TimerBar start={since ?? firstSeen} end={until} now={now} colour={colour} />;
}
