import { useEffect, useRef, useState, type ReactNode } from 'react';
import { paced, useCountUp, usePace, useSkipOnInput } from '../lib/motion';
import { UI } from '../theme';
import { Die } from './Art';

/**
 * The Tea Race's small pieces of motion. Presentation only: each one is handed the settled value
 * from the game state and merely takes a moment to arrive at it. With motion off (`tm_motion`) each
 * renders exactly what the plain markup did before — the number, the dice — with nothing extra.
 */

/**
 * A number that counts to its new value, and optionally floats the change above itself ("+£120"
 * after a sale, "−£80" after a purchase).
 *
 * Key it by whoever owns the number (a captain's id): counting from one captain's cash to the
 * next captain's at a hotseat handover would be a figure that never existed.
 */
export function Counted({
  value,
  format = n => String(n),
  float = false,
  baseMs = 600,
}: {
  value: number;
  format?: (n: number) => string;
  float?: boolean;
  baseMs?: number;
}) {
  const pace = usePace();
  const shown = useCountUp(value, baseMs);
  const [floats, setFloats] = useState<{ id: number; delta: number }[]>([]);
  const prev = useRef(value);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const delta = value - prev.current;
    prev.current = value;
    const life = paced(1100, pace);
    if (!float || delta === 0 || life <= 0) return;
    const id = ++seq.current;
    // Never more than a couple in the air: a burst of trades should not stack a column of figures.
    setFloats(f => [...f.slice(-1), { id, delta }]);
    // Removed on a timer rather than on animationend, which never fires if the pace is switched
    // off mid-flight (the shared CSS then sets `animation: none`).
    timers.current.push(window.setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), life + 60));
  }, [value, float, pace]);

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  const text = format(shown);
  if (floats.length === 0) return <>{text}</>;
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {text}
      {floats.map(f => (
        <span
          key={f.id}
          className="tm-anim-float"
          aria-hidden="true"
          style={{
            // Beside the figure rather than above it: a header sits at the very top of the page,
            // and a figure rising out of it would be clipped before it could be read.
            position: 'absolute',
            left: '100%',
            top: 0,
            marginLeft: '0.4rem',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            fontWeight: 600,
            color: f.delta > 0 ? UI.good : UI.bad,
          }}
        >
          {f.delta > 0 ? '+' : '−'}
          {format(Math.abs(f.delta))}
        </span>
      ))}
    </span>
  );
}

/**
 * A pair (or one) of dice that tumble for a moment before showing the faces already thrown. The
 * roll is settled in the state before this renders; only the display waits. The tumbling faces
 * cycle in a fixed order, not at random — nothing here may pretend to be the dice.
 *
 * Tumbles once on mount when `tumble` is true. A click or key press settles it at once.
 */
export function TumblingDice({
  values,
  tumble,
  size = 17,
  tone,
  faint = false,
  after,
}: {
  values: number[];
  tumble: boolean;
  size?: number;
  tone?: string;
  faint?: boolean;
  /** Shown beside the dice once they have settled — the total, say — so it never leads the dice. */
  after?: ReactNode;
}) {
  const pace = usePace();
  const [rolling, setRolling] = useState(() => tumble && paced(520, pace) > 0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!rolling) return;
    const spin = window.setInterval(() => setTick(t => t + 1), 70);
    const stop = window.setTimeout(() => setRolling(false), paced(520, pace));
    return () => {
      window.clearInterval(spin);
      window.clearTimeout(stop);
    };
    // Started once, on mount; a pace change mid-tumble need not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling]);

  useSkipOnInput(rolling, () => setRolling(false));

  return (
    <>
      {values.map((v, i) =>
        rolling ? (
          <span key={i} className="tm-anim-tumble" style={{ display: 'inline-flex' }}>
            <Die value={((tick + i * 3) % 6) + 1} size={size} tone={tone} faint={faint} />
          </span>
        ) : (
          <Die key={i} value={v} size={size} tone={tone} faint={faint} />
        ),
      )}
      {!rolling && after}
    </>
  );
}
