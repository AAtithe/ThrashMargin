import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { paced, useCountUp, usePace } from '../lib/motion';
import { useTween } from '../hooks/usePlayback';
import { FONT, UI, money } from '../theme';
import type { Haulier } from '../sim/types';
import type { ReplayFrame } from '../hooks/aiReplay';

/**
 * The small presentation pieces behind Steady Eddie's sense of time (lib/motion.ts holds the pace
 * and the keyframes). Every one of them is display only: none holds game state back, and with the
 * pace off each renders exactly what the screen showed before motion existed.
 */

/** A number that counts to its new value instead of snapping. */
export function CountUp({ value, format = String, ms = 600 }: { value: number; format?: (n: number) => string; ms?: number }) {
  const shown = useCountUp(value, ms);
  return <>{format(shown)}</>;
}

/**
 * Replays an entrance animation on its children whenever `on` changes, without remounting them
 * (the orders panel keeps its own little settings, and a remount would reset them).
 */
export function Enter({
  on,
  children,
  className = 'tm-anim-rise',
}: {
  on: string | number;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(className);
  }, [on, className]);
  return <div ref={ref}>{children}</div>;
}

/**
 * Floating "+£1,200" / "−£300" markers over a figure, one per change while `live`. Changes made
 * while not live (someone else's turn, a load) just pass silently. Nothing at all with the pace off.
 */
export function MoneyFloats({ value, scope, live }: { value: number; scope: string; live: boolean }) {
  const pace = usePace();
  const last = useRef({ value, scope });
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const [floats, setFloats] = useState<{ id: number; delta: number }[]>([]);

  useEffect(() => {
    const prev = last.current;
    last.current = { value, scope };
    if (pace === 'off' || !live || prev.scope !== scope || prev.value === value) return;
    const id = ++seq.current;
    setFloats(f => [...f.slice(-2), { id, delta: value - prev.value }]);
    timers.current.push(
      window.setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), paced(1150, pace) + 50),
    );
  }, [value, scope, live, pace]);

  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);

  if (floats.length === 0) return null;
  return (
    <span style={floatAnchor} aria-hidden="true">
      {floats.map(f => (
        <span
          key={f.id}
          className="tm-anim-float"
          style={{ ...floatText, color: f.delta > 0 ? UI.good : UI.textSoft }}
        >
          {f.delta > 0 ? '+' : '−'}
          {money(Math.abs(f.delta))}
        </span>
      ))}
    </span>
  );
}

/** One die face. While `tumbling`, it spins and its face flickers through a fixed cycle. */
function Die({ face, tumbling, t, salt }: { face: number; tumbling: boolean; t: number; salt: number }) {
  const shown = tumbling ? 1 + ((Math.floor(t * 14) + salt * 3) % 6) : face;
  return (
    <span className={tumbling ? 'tm-anim-tumble' : 'tm-anim-pop'} style={die}>
      {shown}
    </span>
  );
}

/**
 * The dice for a roll: one pair per vehicle. Tumbles while `t < 1`, then lands on the real result,
 * which the reducer already settled; only the display waits.
 */
export function DiceTray({
  rolls,
  t,
  colour,
}: {
  rolls: { id: string; name: string; dice: [number, number] | null }[];
  t: number;
  colour?: string;
}) {
  const tumbling = t < 1;
  // Once landed, a vehicle with no roll this turn (bought after the dice) shows no dice at all.
  const shown = tumbling ? rolls : rolls.filter(r => r.dice);
  if (shown.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
      {shown.map((r, i) => (
        <span
          key={r.id}
          title={r.name}
          style={{ display: 'inline-flex', gap: '0.2rem', alignItems: 'center', borderBottom: `2px solid ${colour ?? 'transparent'}` }}
        >
          <Die face={r.dice?.[0] ?? 1} tumbling={tumbling} t={t} salt={i * 2} />
          <Die face={r.dice?.[1] ?? 1} tumbling={tumbling} t={t} salt={i * 2 + 1} />
        </span>
      ))}
    </span>
  );
}

/**
 * The strip shown over the chart while the computer hauliers' turns are replayed: whose turn, what
 * they just did, their dice, how far through, and a skip. Any click or key anywhere also skips.
 */
export function ReplayStrip({
  frame,
  haulier,
  index,
  count,
  onSkip,
  stepMs,
}: {
  frame: ReplayFrame;
  haulier: Haulier | undefined;
  index: number;
  count: number;
  onSkip: () => void;
  stepMs: number;
}) {
  const opening = frame.action === null;
  const { t } = useTween(opening ? `open-${index}` : null, stepMs * 0.85);
  const mine = frame.state.vehicles.filter(v => v.ownerId === frame.haulierId);
  const rolling = opening || frame.action?.type === 'ROLL';
  const rolls = mine.map(v => ({
    id: v.id,
    name: v.name,
    dice: opening ? null : frame.state.dice[v.id] ?? null,
  }));
  const said = frame.entries.filter(e => e.kind !== 'roll');
  const line = opening
    ? `${haulier?.name ?? 'A rival'} takes the wheel.`
    : said.length
      ? said.slice(-2).map(e => e.text).join(' ')
      : frame.entries[frame.entries.length - 1]?.text ?? '';

  return (
    <div style={strip} role="status" aria-live="polite">
      <span style={{ ...dot, background: haulier?.colour ?? UI.textFaint }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0, flex: '1 1 auto' }}>
        <span style={stripHead}>
          {haulier?.name ?? 'Rival'} · step {Math.min(index + 1, count)} of {count}
        </span>
        <span key={index} className="tm-anim-fade" style={stripText}>
          {line}
        </span>
      </span>
      {rolling && <DiceTray rolls={rolls} t={opening ? t : 1} colour={haulier?.colour} />}
      <button
        type="button"
        onClick={onSkip}
        style={skipButton}
        title="Skip the replay (any click or key does the same)"
      >
        Skip ▸▸
      </button>
    </div>
  );
}

const floatAnchor: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: '100%',
  height: 0,
  pointerEvents: 'none',
};

const floatText: CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 0,
  fontFamily: FONT.data,
  fontSize: '0.8rem',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const die: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.35rem',
  height: '1.35rem',
  border: `1px solid ${UI.ruleStrong}`,
  borderRadius: 4,
  background: UI.panelRaised,
  color: UI.text,
  fontFamily: FONT.data,
  fontSize: '0.78rem',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const strip: CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  right: 8,
  zIndex: 5,
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.45rem 0.6rem',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  background: UI.panel,
  boxShadow: `0 6px 18px ${UI.shadow}`,
};

const dot: CSSProperties = { width: 10, height: 10, borderRadius: '50%', flex: '0 0 auto' };

const stripHead: CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.6rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: UI.textFaint,
};

const stripText: CSSProperties = {
  fontFamily: FONT.body,
  fontSize: '0.82rem',
  lineHeight: 1.35,
  color: UI.text,
};

const skipButton: CSSProperties = {
  flex: '0 0 auto',
  background: 'transparent',
  border: `1px solid ${UI.ruleStrong}`,
  borderRadius: 2,
  color: UI.textSoft,
  fontFamily: FONT.data,
  fontSize: '0.66rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '0.3rem 0.55rem',
  cursor: 'pointer',
};
