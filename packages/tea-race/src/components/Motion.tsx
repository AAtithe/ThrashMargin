import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FloatText, paced, signed, useCountUp, useFloats, usePace, useSkipOnInput } from '../lib/motion';
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
  const shown = useCountUp(value, baseMs);
  // Never more than a couple in the air: a burst of trades should not stack a column of figures.
  // (Nothing is pushed with motion off; each removes itself on a timer.)
  const floats = useFloats(1100, 2);
  const prev = useRef(value);

  useEffect(() => {
    const delta = value - prev.current;
    prev.current = value;
    if (!float || delta === 0) return;
    floats.push(signed(delta, format), delta > 0 ? UI.good : UI.bad);
    // `format` is usually an inline arrow; only a change of value floats anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, float, floats.push]);

  const text = format(shown);
  if (floats.items.length === 0) return <>{text}</>;
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {text}
      {floats.items.map(f => (
        <FloatText
          key={f.id}
          text={f.text}
          colour={f.colour}
          // Beside the figure rather than above it: a header sits at the very top of the page, and
          // a figure rising out of it would be clipped before it could be read. The figure's own
          // size, not the shared default.
          style={{ left: '100%', top: 0, marginLeft: '0.4rem', fontSize: 'inherit' }}
        />
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
