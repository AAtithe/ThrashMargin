/**
 * Fireline's guided first battle, played on the real battle.
 *
 * It rings one control at a time, waits for the game to say the player used it, and moves on.
 * Everything is real: the Generator, the Refinery and the Barracks stay built, the riflemen really
 * march, the credits really arrive. The battle keeps running underneath, because building takes
 * time and a paused game cannot finish a Generator; the run takes about three minutes, well inside
 * the first enemy attack on any difficulty.
 *
 * ## What the predicates have to tolerate (lessons from the portal's other four tours)
 *
 * - **No step may complete on arrival.** Every predicate compares the live view with a snapshot
 *   taken when that step became current (`Baseline`), never with an absolute value. A player who
 *   already has a Generator, or already has riflemen selected, still has to do the thing.
 * - **No step may un-complete.** A move order turns back into idle once the riflemen arrive, so
 *   completion is latched the moment it is first seen and the advance timer runs from the latch.
 * - **Where the run opens is the caller's business.** It always opens on the welcome card; it never
 *   guesses a resume point from the state.
 * - **It stays mounted through modals** (`hidden`), returning null after every hook, so pausing or
 *   opening the controls sheet keeps its place.
 * - **The card names its target** (`data-tour-target`, the element actually ringed), says when a
 *   step is read rather than acted on (`data-tour-manual`), and carries `data-tour-done` while it
 *   pauses after a finished step, so `scripts/tours/fireline.cjs` can drive it honestly.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BUILDINGS, type BuildingKind, type Category } from '../sim/rules';
import { countBuildings } from '../sim/state';
import type { GameState } from '../sim/types';
import { FONT, UI } from '../theme';

const TOUR_SEEN_KEY = 'fireline_tour_seen';

/** Whether this browser has finished or skipped the run. A UI preference, so localStorage. */
export function hasSeenGuidedTour(): boolean {
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY);
  } catch {
    return false;
  }
}

export function markGuidedTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    /* Blocked storage: the run is offered again next time, which is harmless. */
  }
}

/** Everything a step reads, assembled by the game screen on each HUD refresh. */
export interface TourView {
  s: GameState;
  selected: number[];
  placing: BuildingKind | null;
  tab: Category;
}

/** Taken when a step becomes current. Predicates measure change from here. */
interface Baseline {
  built: Record<BuildingKind, number>;
  queued: Record<BuildingKind, boolean>;
  infantryQueued: number;
  trained: number;
  selection: string;
  orders: Record<number, string>;
}

function baselineOf(v: TourView): Baseline {
  const kinds = Object.keys(BUILDINGS) as BuildingKind[];
  const built = {} as Record<BuildingKind, number>;
  const queued = {} as Record<BuildingKind, boolean>;
  for (const k of kinds) {
    built[k] = countBuildings(v.s, 0, k);
    queued[k] = v.s.players[0].queues.building.some(q => q.kind === k);
  }
  const orders: Record<number, string> = {};
  for (const u of v.s.units) if (u.owner === 0) orders[u.id] = JSON.stringify(u.order);
  return {
    built,
    queued,
    infantryQueued: v.s.players[0].queues.infantry.length,
    trained: v.s.players[0].stats.trained,
    selection: [...v.selected].sort((a, b) => a - b).join(','),
    orders,
  };
}

interface TourStep {
  title: string;
  body: (v: TourView) => string;
  /** The id of the element to ring, or null for a centred card. */
  target: (v: TourView) => string | null;
  isComplete: (v: TourView, b: Baseline) => boolean;
  manual?: boolean;
}

/**
 * Another structure is occupying the one-at-a-time structure queue, so this step's button is
 * disabled. Ring the thing in the way instead, and say how to clear it, rather than pointing at a
 * control the game will not let the player use.
 */
function busyWith(v: TourView, kind: BuildingKind): BuildingKind | null {
  const head = v.s.players[0].queues.building[0];
  return head && head.kind !== kind ? (head.kind as BuildingKind) : null;
}

const busyBody = (other: BuildingKind) =>
  `Your Command Yard is busy with a ${BUILDINGS[other].name}, and it builds one structure at a time. Place it when it says Ready, or right-click its button to cancel it for a full refund. Then carry on.`;

const queueTarget = (kind: BuildingKind) => (v: TourView) => {
  if (v.tab !== 'building') return 'fl-tab-building';
  const other = busyWith(v, kind);
  if (other) return v.placing === other ? 'fl-battlefield' : `fl-build-${other}`;
  return `fl-build-${kind}`;
};

const queuedOrBuilt = (kind: BuildingKind) => (v: TourView, b: Baseline) =>
  countBuildings(v.s, 0, kind) > b.built[kind] || (v.s.players[0].queues.building.some(q => q.kind === kind) && !b.queued[kind]);

const placed = (kind: BuildingKind) => (v: TourView, b: Baseline) => countBuildings(v.s, 0, kind) > b.built[kind];

/** Ring the build button until the structure is being placed, then the battlefield. */
const placeTarget = (kind: BuildingKind) => (v: TourView) => {
  if (v.placing === kind) return 'fl-battlefield';
  return queueTarget(kind)(v);
};

const placeBody = (kind: BuildingKind, extra: string) => (v: TourView) => {
  const name = BUILDINGS[kind].name;
  const other = busyWith(v, kind);
  if (other) return busyBody(other);
  const head = v.s.players[0].queues.building[0];
  if (v.placing === kind)
    return `Move over open ground near your Command Yard. Green squares mean it fits; click to place it. ${extra}`;
  if (head && head.kind === kind && head.progress >= BUILDINGS[kind].buildTicks)
    return `The ${name} is ready. Click its button once more to pick it up, then choose where it goes.`;
  return `The ${name} is under construction; the bar along the bottom of its button fills as it builds. When the button says Ready, click it again.`;
};

function buildSteps(): TourStep[] {
  return [
    {
      title: 'Your first battle',
      body: () =>
        'I will ring one thing at a time and wait while you do it. This is your real battle: everything you build stays built, and the clock keeps running, so the enemy is building too. Their first attack is minutes away. Skip at any time.',
      target: () => null,
      isComplete: () => false,
      manual: true,
    },
    {
      title: 'Build a Generator',
      body: v =>
        busyWith(v, 'power')
          ? busyBody(busyWith(v, 'power')!)
          : 'Everything runs on power, and your Command Yard makes almost none. Click Generator to start building one. You pay the 300 credits now; cancel with a right-click and you get them all back.',
      target: queueTarget('power'),
      isComplete: queuedOrBuilt('power'),
    },
    {
      title: 'Place the Generator',
      body: placeBody('power', 'New structures must go within four tiles of one you own.'),
      target: placeTarget('power'),
      isComplete: placed('power'),
    },
    {
      title: 'Build a Refinery',
      body: v =>
        busyWith(v, 'refinery')
          ? busyBody(busyWith(v, 'refinery')!)
          : 'Credits come from ore, and ore only becomes credits at a Refinery. It is the most important thing you will build, and it arrives with a free hauler. Click Refinery.',
      target: queueTarget('refinery'),
      isComplete: queuedOrBuilt('refinery'),
    },
    {
      title: 'Place the Refinery',
      body: placeBody('refinery', 'Put it toward the gold ore if you can: the shorter the haul, the faster the money. Leave the pad below it clear; that is where the hauler docks.'),
      target: placeTarget('refinery'),
      isComplete: placed('refinery'),
    },
    {
      title: 'Ore is money',
      body: () =>
        'Your hauler drives out on its own, fills up with ore and brings it back to the pad. Each load is worth 600 credits; watch this counter jump when it docks. A second refinery and hauler roughly doubles your income, and haulers are the first thing an enemy raids.',
      target: () => 'fl-credits',
      isComplete: () => false,
      manual: true,
    },
    {
      title: 'Select your riflemen',
      body: () =>
        'Your three riflemen are standing by the Command Yard. Drag a box around them on the map, holding the left button down. A box with fighting units in it leaves haulers out, which is almost always what you want.',
      target: () => 'fl-battlefield',
      isComplete: (v, b) => {
        const key = [...v.selected].sort((a, c) => a - c).join(',');
        if (key === b.selection) return false;
        return v.s.units.some(u => u.owner === 0 && u.kind !== 'hauler' && v.selected.includes(u.id));
      },
    },
    {
      title: 'Give them an order',
      body: () =>
        'Right-click open ground and they march there. Right-click an enemy and they attack it. Press A and then click for an attack-move: they go there and fight anything they meet on the way, which is how to send an army.',
      target: () => 'fl-battlefield',
      isComplete: (v, b) =>
        v.s.units.some(
          u =>
            u.owner === 0 &&
            u.kind !== 'hauler' &&
            (u.order.type === 'move' || u.order.type === 'attackMove' || u.order.type === 'attack') &&
            JSON.stringify(u.order) !== b.orders[u.id],
        ),
    },
    {
      title: 'Build a Barracks',
      body: v => {
        const other = busyWith(v, 'barracks');
        if (other) return busyBody(other);
        if (v.placing === 'barracks') return 'Place it near the base. Infantry walk out of the door on its south side, so leave a little room below it.';
        return 'Riflemen and rocketeers come from a Barracks. Build one and place it, the same way as before: click, wait for Ready, click again, then choose the ground.';
      },
      target: placeTarget('barracks'),
      isComplete: placed('barracks'),
    },
    {
      title: 'Train a soldier',
      body: v =>
        v.tab !== 'infantry'
          ? 'Open the Infantry list.'
          : 'Click Rifleman to train one. Infantry and vehicles each queue up to five; riflemen are cheap and cut down enemy infantry, rocketeers are the answer to tanks and turrets.',
      target: v => (v.tab !== 'infantry' ? 'fl-tab-infantry' : 'fl-build-rifleman'),
      isComplete: (v, b) => v.s.players[0].queues.infantry.length > b.infantryQueued || v.s.players[0].stats.trained > b.trained,
    },
    {
      title: 'Keep the power on',
      body: () => {
        return 'This bar is power made against power used. Every structure but a Generator draws some. Let demand pass supply and all production runs at half speed, turrets fire half as fast and the radar goes dark. When the marker nears the end of the green, build another Generator before anything else.';
      },
      target: () => 'fl-power',
      isComplete: () => false,
      manual: true,
    },
    {
      title: 'From here',
      body: () =>
        'Next: a War Factory for tanks, a turret or two on the side facing the enemy, then a Comms Uplink to bring this radar online and unlock artillery. You win when every enemy structure is gone. Press ? at any time for the controls.',
      target: () => 'fl-minimap',
      isComplete: () => false,
      manual: true,
    },
  ];
}

/**
 * Track where the ringed element is. Polled, because the sidebar re-renders ten times a second
 * and swaps its contents when the tab changes. Any scroll is one-shot and instant: a smooth scroll
 * leaves the element moving after it is measured and the ring lands wrong.
 */
function useTargetRect(targetId: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!targetId) {
      setRect(null);
      return;
    }
    let scrolled = false;
    const measure = () => {
      const el = document.getElementById(targetId);
      if (!el) {
        setRect(null);
        return;
      }
      let r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setRect(null);
        return;
      }
      if (!scrolled && (r.top < 0 || r.bottom > window.innerHeight) && r.height < window.innerHeight) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        scrolled = true;
        r = el.getBoundingClientRect();
      }
      setRect(prev =>
        prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height ? prev : r,
      );
    };
    measure();
    const iv = window.setInterval(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [targetId]);
  return rect;
}

interface Props {
  view: TourView;
  onFinish: () => void;
  /** Draw nothing but stay mounted, so a modal does not cost the run its place. */
  hidden?: boolean;
}

export default function GuidedTour({ view, onFinish, hidden = false }: Props) {
  const steps = useMemo(buildSteps, []);
  const [stepIndex, setStepIndex] = useState(0);
  const [latched, setLatched] = useState(-1);
  const baseline = useRef<{ index: number; b: Baseline }>({ index: 0, b: baselineOf(view) });
  // A new step takes its snapshot the first time it renders as current.
  if (baseline.current.index !== stepIndex) baseline.current = { index: stepIndex, b: baselineOf(view) };

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const manual = !!step.manual;
  // Done as soon as the game says so, in this very render, not one render later when the latch
  // lands. Otherwise the frame after placing a structure (placing cleared, step not yet latched)
  // rings the build button again, and a quick second click queues a second one. CI caught this.
  const done = latched === stepIndex || (!manual && step.isComplete(view, baseline.current.b));
  const lastTarget = useRef<string | null>(null);
  // A finished step keeps ringing what it last rang while it pauses, rather than its idle target.
  const targetId = hidden ? null : done ? lastTarget.current : step.target(view);
  if (!done) lastTarget.current = targetId;
  const rect = useTargetRect(targetId);

  // Latch completion the first time the game says so; later state cannot take it back.
  useEffect(() => {
    if (manual || done) return;
    if (step.isComplete(view, baseline.current.b)) setLatched(stepIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, stepIndex]);

  // Advance from the latch, after a pause long enough to see what just happened.
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setStepIndex(i => Math.min(i + 1, steps.length - 1)), 900);
    return () => window.clearTimeout(t);
  }, [done, steps.length]);

  // Every hook above this line, so the run keeps its place while it is out of sight.
  if (hidden) return null;

  const PAD = 6;
  const big = rect && rect.width * rect.height > window.innerWidth * window.innerHeight * 0.3;
  const ring: CSSProperties | null = rect
    ? {
        position: 'fixed',
        zIndex: 2001,
        left: rect.left - (big ? -2 : PAD),
        top: rect.top - (big ? -2 : PAD),
        width: rect.width + (big ? -4 : PAD * 2),
        height: rect.height + (big ? -4 : PAD * 2),
        borderRadius: 4,
        border: `2px solid ${UI.accent}`,
        boxShadow: `0 0 0 9999px ${SCRIM}`,
        pointerEvents: 'none',
      }
    : null;

  const CARD_W = 336;
  const CARD_H = 250;
  let pos: { left: number; top: number };
  if (!rect) pos = { left: window.innerWidth / 2 - CARD_W / 2, top: Math.max(16, window.innerHeight / 2 - CARD_H / 2) };
  else if (big) {
    // The battlefield: sit in its bottom-right corner, away from the Command Yard the camera opens on.
    pos = { left: rect.right - CARD_W - 16, top: rect.bottom - CARD_H - 16 };
  } else if (rect.left > window.innerWidth / 2) {
    // A sidebar control: sit to its left, level with it.
    pos = { left: rect.left - CARD_W - 18, top: Math.min(window.innerHeight - CARD_H - 16, Math.max(16, rect.top - 20)) };
  } else {
    pos = {
      left: Math.max(16, Math.min(rect.left, window.innerWidth - CARD_W - 16)),
      top: rect.bottom + 16 + CARD_H <= window.innerHeight ? rect.bottom + 16 : Math.max(16, rect.top - CARD_H - 16),
    };
  }
  pos.left = Math.max(16, Math.min(pos.left, window.innerWidth - CARD_W - 16));
  pos.top = Math.max(16, pos.top);

  const finish = () => {
    markGuidedTourSeen();
    onFinish();
  };

  return (
    <>
      {!rect && <div style={{ position: 'fixed', inset: 0, zIndex: 2001, background: SCRIM, pointerEvents: 'none' }} />}
      {ring && <div style={ring} />}
      <div
        role="dialog"
        aria-label="Guided first battle"
        style={{ ...CARD, left: pos.left, top: pos.top, width: CARD_W }}
        data-tour-step={String(stepIndex)}
        data-tour-target={targetId ?? ''}
        data-tour-manual={manual ? '1' : '0'}
        {...(done ? { 'data-tour-done': '1' } : {})}
      >
        <p style={label}>
          Guided first battle · {stepIndex + 1} of {steps.length}
        </p>
        <h3 style={title}>{done ? 'Done' : step.title}</h3>
        <p style={bodyText}>{done ? 'Good. Next step in a moment.' : step.body(view)}</p>
        <div style={footer}>
          <button type="button" style={ghost} onClick={finish}>
            {isLast ? 'Close' : 'Skip the tour'}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {!isFirst && !done && (
              <button type="button" style={plain} onClick={() => setStepIndex(i => Math.max(0, i - 1))}>
                Back
              </button>
            )}
            {!done && (
              <button
                type="button"
                style={manual ? primary : plain}
                onClick={() => (isLast ? finish() : setStepIndex(i => Math.min(i + 1, steps.length - 1)))}
              >
                {isLast ? 'Finish' : isFirst ? 'Start' : manual ? 'Next' : 'Skip this step'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const SCRIM = 'rgba(4, 7, 8, 0.6)';

const CARD: CSSProperties = {
  position: 'fixed',
  zIndex: 2002,
  maxWidth: 'calc(100vw - 2rem)',
  boxSizing: 'border-box',
  background: UI.panel,
  border: `1px solid ${UI.accent}`,
  borderRadius: 6,
  boxShadow: `0 12px 44px ${UI.shadow}`,
  padding: '14px 16px 12px',
  fontFamily: FONT.body,
  color: UI.text,
};

const label: CSSProperties = {
  margin: '0 0 6px',
  fontFamily: FONT.mono,
  fontSize: '0.62rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: UI.textFaint,
};

const title: CSSProperties = { margin: '0 0 6px', fontFamily: FONT.display, fontSize: '1.05rem', color: UI.accent };

const bodyText: CSSProperties = { margin: '0 0 12px', fontSize: '0.84rem', lineHeight: 1.5, color: UI.textSoft };

const footer: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };

const plain: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.76rem',
  padding: '5px 10px',
  border: `1px solid ${UI.ruleStrong}`,
  borderRadius: 3,
  background: UI.panelRaised,
  color: UI.text,
  cursor: 'pointer',
};

const primary: CSSProperties = { ...plain, border: `1px solid ${UI.accent}`, background: UI.accent, color: UI.ground, fontWeight: 600 };

const ghost: CSSProperties = { ...plain, border: '1px solid transparent', background: 'transparent', color: UI.textFaint, padding: '5px 2px' };
