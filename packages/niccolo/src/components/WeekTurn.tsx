import { formatWeekDate } from '../sim/clock';
import { CAMPAIGN_START } from '../sim/content';
import { UI } from '../theme';
import { easeOut } from '../lib/motion';
import { useTween } from './motionKit';

/**
 * The passage of a week, made visible (presentation only — the week has already been resolved and
 * saved by the time any of this plays, and a click or key finishes it at once).
 *
 * `WeekDate` is the header's date, which turns over like a calendar leaf: last week's date tips
 * away, this week's tips into place. `WeekSweep` is a hairline that runs the width of the header
 * while the fleet glides across the chart, so the turn reads as a span of time rather than a jump.
 * With motion off both render exactly what the header always showed.
 */

const FLIP_MS = 760;
const SWEEP_MS = 1200;

export function WeekDate({ week }: { week: number }) {
  const { from, t, playing } = useTween(week, FLIP_MS);
  const text = formatWeekDate(week, CAMPAIGN_START);
  if (!playing) return <>{text}</>;
  // First half: the old leaf tips back to edge-on. Second half: the new one falls into place.
  const firstHalf = t < 0.45;
  const shown = firstHalf ? formatWeekDate(from, CAMPAIGN_START) : text;
  const angle = firstHalf ? (t / 0.45) * 90 : -90 * (1 - easeOut((t - 0.45) / 0.55));
  return (
    <span
      style={{
        display: 'inline-block',
        transform: `perspective(240px) rotateX(${angle}deg)`,
        transformOrigin: '50% 60%',
        color: firstHalf ? undefined : UI.brass,
      }}
    >
      {shown}
    </span>
  );
}

export function WeekSweep({ week }: { week: number }) {
  const { t, playing } = useTween(week, SWEEP_MS);
  if (!playing) return null;
  const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        bottom: -1,
        height: 2,
        width: `${easeOut(t) * 100}%`,
        background: UI.brass,
        opacity: fade,
        pointerEvents: 'none',
      }}
    />
  );
}
