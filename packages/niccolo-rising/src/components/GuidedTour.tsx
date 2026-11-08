/**
 * A guided first hour, played on the real character.
 *
 * It spotlights a control in the live UI, waits for the game state to say the player used it, and
 * moves on. Everything counts: the training is real training, the scheme is a real scheme, the
 * post is a real post. A player who finishes has taken a mission, spent Energy on a stat, spent
 * Nerve on a job of work, and put their name to a wage.
 *
 * ## What this game needs taught that the others do not
 *
 * The portal's other four games are turn-based: everything the player can do is on the screen in
 * front of them, and the lesson is which thing to do first. This one is real time and spread
 * across eleven places, and the two things a new player will not work out on their own are:
 *
 * - **Time is the resource.** Energy, Nerve, Spirits and Health refill by the clock whether the
 *   tab is open or not, so the shape of a session is "spend what has refilled, then leave". The
 *   run opens on the bars for exactly that reason, before it asks for a single click.
 * - **The verbs live in different places.** A step here carries the place it belongs to, and if
 *   the player is somewhere else the step points at that place's button in the nav first and says
 *   so. Navigation is folded into the lesson rather than padded out into steps of its own.
 *
 * ## What the predicates have to tolerate
 *
 * `isComplete` is read against live state on every render, so no step may read true before the run
 * begins, and the opening scan walks the steps in order and stops at the first unfinished one
 * rather than searching the whole list. The training and scheme steps measure a *change*, which is
 * what `TourMemory`'s opening snapshot is for — the character already has stats and may already
 * have pulled a scheme before asking for the tour.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { JOBS, SCHEMES, YARD, barMax } from '../sim/content';
import { nextMission } from '../sim/missions';
import { WORK_STATS, type BattleStat, type GameState } from '../sim/types';
import { FONT, UI } from '../theme';

const TOUR_SEEN_KEY = 'niccolo_rising_tour_seen';

/** Whether this browser has finished or skipped the run before. A UI preference, not game state,
 *  so it lives in localStorage rather than in the save. */
export function hasSeenGuidedTour(): boolean {
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY);
  } catch {
    // Private browsing and blocked storage both throw. Offering the run again is the harmless
    // failure; crashing the game screen is not.
    return false;
  }
}

export function markGuidedTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    /* see above */
  }
}

/** The places the run sends the player to. A subset of `GameScreen`'s own list. */
export type TourPlace = 'home' | 'missions' | 'yard' | 'schemes' | 'work';

/* -------------------------------------------------------------------------------------------- */
/* The plan                                                                                       */
/* -------------------------------------------------------------------------------------------- */

export interface TourPlan {
  /** The yard the character already belongs to, and the stat to raise in it. */
  yardId: string;
  stat: BattleStat;
  /** The cheapest scheme in Nerve that is unlocked and affordable. */
  schemeId: string;
  /** The first post whose requirements the character already meets, or null if none do. */
  jobId: string | null;
  /** Whether there is a mission waiting to be accepted. */
  hasMission: boolean;
}

/**
 * Work out the first hour to teach, from the character as they stand.
 *
 * Nothing is hardcoded. The yard is one the character is already a member of, the scheme is the
 * cheapest they can actually attempt, and the post is the first whose requirements they meet — so
 * the copy names the right things however the content is retuned, and the run never points at a
 * control the sim would refuse.
 *
 * Returns null when there is nothing to teach: no yard, or no scheme within their Nerve.
 */
export function planFirstHours(s: GameState): TourPlan | null {
  if (s.status.kind !== 'free') return null;

  const yardId = s.yards.find(id => YARD[id]) ?? null;
  if (!yardId) return null;

  const scheme = SCHEMES
    .filter(x => !x.requiresCourse || s.coursesDone.includes(x.requiresCourse))
    .filter(x => x.nerve <= s.bars.nerve.cur)
    .sort((a, b) => a.nerve - b.nerve)[0];
  if (!scheme) return null;

  const job = s.job
    ? null
    : JOBS.find(j => WORK_STATS.every(k => s.work[k] >= (j.ranks[0].req[k] ?? 0))) ?? null;

  return {
    yardId,
    stat: 'strength',
    schemeId: scheme.id,
    jobId: job?.id ?? null,
    hasMission: !s.missions.active && nextMission(s) !== null,
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Steps                                                                                          */
/* -------------------------------------------------------------------------------------------- */

/** Everything a step reads, assembled by `GameScreen` from the advanced view plus its own place. */
export interface TourView {
  s: GameState;
  place: string;
}

/** The opening snapshot, for steps that measure a change rather than a value. */
interface TourMemory {
  stat: number;
  schemes: number;
}

interface TourStep {
  title: string;
  body: (v: TourView, plan: TourPlan) => string;
  /** The place this step's control lives in. The run points at the nav first when elsewhere. */
  place?: TourPlace;
  target: (v: TourView, plan: TourPlan) => string | null;
  isComplete: (v: TourView, plan: TourPlan, memory: TourMemory) => boolean;
  /** True for a step the player reads and dismisses rather than acts on. */
  manual?: boolean;
}

const INTRO: TourStep = {
  title: 'Your first hour in Bruges',
  body: () =>
    'I will point at one thing at a time and wait while you use it. This is your real character — the training, the money and the mission are all yours to keep. Skip at any time.',
  target: () => null,
  isComplete: () => false,
  manual: true,
};

const BARS: TourStep = {
  title: 'Time is the resource',
  body: v =>
    `Energy, Nerve, Spirits and Health. Every verb in this game spends one of them, and every one of them refills by the clock whether you are at the screen or not — you have ${Math.floor(v.s.bars.energy.cur)} of ${barMax(v.s, 'energy')} Energy and ${Math.floor(v.s.bars.nerve.cur)} of ${barMax(v.s, 'nerve')} Nerve right now. ` +
    'That is the whole rhythm: spend what has built up, go and live your life, come back to a full bar. Nothing is lost by closing the tab, and nothing is gained by sitting on it.',
  target: () => 'nr-bars',
  isComplete: () => false,
  manual: true,
};

const MISSION: TourStep = {
  title: 'Take the first mission',
  body: () =>
    'Missions are the spine of the story, and they count things you were going to do anyway. Accept this one: it asks for jokes at the burgomaster\'s expense, which is the cheapest thing in Bruges and the next step besides.',
  place: 'missions',
  target: () => 'nr-mission-accept',
  isComplete: v => v.s.missions.active !== null || v.s.missions.done.length > 0,
};

const TRAIN: TourStep = {
  title: 'Spend Energy on a stat',
  body: (v, plan) =>
    `${YARD[plan.yardId]?.name ?? 'The yard'} costs ${YARD[plan.yardId]?.energy ?? '?'} Energy a train and gives it back as ${plan.stat}. ` +
    'Battle stats are trained and never bought, so this is the slow money: everything you can do in a year depends on what you put in now. Spirits make each train worth more, which is why eating and drinking come before a session rather than after it.',
  place: 'yard',
  target: (_v, plan) => `nr-train-${plan.yardId}-${plan.stat}`,
  isComplete: (v, plan, memory) => v.s.battle[plan.stat] > memory.stat,
};

const SCHEME: TourStep = {
  title: 'Spend Nerve on a scheme',
  body: (_v, plan) => {
    const x = SCHEMES.find(s => s.id === plan.schemeId);
    return (
      `${x?.name ?? 'The scheme'} costs ${x?.nerve ?? '?'} Nerve. Success pays and builds the skill that makes the harder schemes worth trying; failure builds a little skill anyway and may land you in the Steen or the infirmary for a few minutes. ` +
      'Nerve refills faster than Energy, so this is the thing to do with a spare five minutes.'
    );
  },
  place: 'schemes',
  target: (_v, plan) => `nr-scheme-${plan.schemeId}`,
  isComplete: (v, _plan, memory) => v.s.counters.schemes > memory.schemes,
};

const JOB: TourStep = {
  title: 'Take a post',
  body: (_v, plan) => {
    const j = JOBS.find(x => x.id === plan.jobId);
    return (
      `A post pays once a day and raises your working stats for every day you hold it, and it costs neither Energy nor Nerve to keep. ` +
      `${j?.name ?? 'This employer'} starts at ${j?.ranks[0].pay ?? '?'} groats a day and asks nothing of you yet. It is the floor under everything else.`
    );
  },
  place: 'work',
  target: (_v, plan) => (plan.jobId ? `nr-job-${plan.jobId}` : null),
  isComplete: v => v.s.job !== null,
};

const OUTRO: TourStep = {
  title: 'That is the rhythm',
  body: () =>
    'Spend the bars, then leave: they fill while you are away, and a journey to Trebizond or a course at Louvain is a thing you come back to rather than sit through. Duels, the Waterhalle, better lodgings and the Medici counting house are all waiting in the rail above. The chronicle on the right remembers everything that happens to you.',
  target: () => null,
  isComplete: () => false,
  manual: true,
};

function buildSteps(plan: TourPlan): TourStep[] {
  return [
    INTRO,
    BARS,
    ...(plan.hasMission ? [MISSION] : []),
    TRAIN,
    SCHEME,
    ...(plan.jobId ? [JOB] : []),
    OUTRO,
  ];
}

/* -------------------------------------------------------------------------------------------- */
/* Placement                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/**
 * Track where the spotlit element actually is.
 *
 * Polled rather than observed: this screen re-renders on a one-second clock and the panels swap
 * wholesale when the place changes, and no one listener catches all of it. A quarter-second tick
 * is invisible to a player and cheap beside the game's own renders.
 *
 * The scroll is one-shot and instant — one-shot so the run does not fight a player who scrolled
 * somewhere deliberately, instant because a smooth scroll leaves the element moving for a few
 * hundred milliseconds after it is measured and the ring visibly lands wrong and then slides on.
 */
function useTargetRect(targetId: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!targetId) {
      setRect(null);
      return;
    }
    let scrolledOnce = false;
    const measure = () => {
      const el = document.getElementById(targetId);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setRect(null);
        return;
      }
      if (!scrolledOnce && (r.top < 0 || r.bottom > window.innerHeight)) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        scrolledOnce = true;
        setRect(el.getBoundingClientRect());
        return;
      }
      setRect(r);
    };
    measure();
    const interval = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [targetId]);

  return rect;
}

/**
 * Where to open. A prefix scan — walk forward from the first real step, stop at the first one not
 * done — rather than a search. Predicates only have to be honest about the state they are actually
 * reached in, and stopping on the very first real step means nothing has happened yet, which is a
 * fresh run, so it opens on the welcome card.
 */
function firstIncompleteStep(steps: TourStep[], v: TourView, plan: TourPlan, memory: TourMemory): number {
  const last = steps.length - 1; // the outro, which never completes
  let i = 1;
  while (i < last && steps[i].isComplete(v, plan, memory)) i++;
  return i === 1 ? 0 : i;
}

/* -------------------------------------------------------------------------------------------- */
/* The component                                                                                  */
/* -------------------------------------------------------------------------------------------- */

interface Props {
  view: TourView;
  plan: TourPlan;
  onFinish: () => void;
  /**
   * Draw nothing this render, but stay mounted. Set while one of the game's own modals owns the
   * display. It is a prop rather than the caller unmounting the run because the run's place in
   * the walk lives in this component: unmounting throws away both the captured memory and the
   * step index, and the card comes back at step one, so the run loops and never reaches its last
   * step. Thrash Margin hit this on its end-of-turn dispatch; here it is the same structure.
   */
  hidden?: boolean;
}

export default function GuidedTour({ view, plan, onFinish, hidden = false }: Props) {
  // Captured once, on the first render. `useRef` rather than `useState` because reading it must
  // never cause a render of its own.
  const memoryRef = useRef<TourMemory>({
    stat: view.s.battle[plan.stat],
    schemes: view.s.counters.schemes,
  });
  const memory = memoryRef.current;

  const steps = useMemo(() => buildSteps(plan), [plan]);
  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(steps, view, plan, memory));

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  // The verb this step wants lives somewhere else: point at the way there first, and say so.
  const elsewhere = !!step.place && view.place !== step.place;
  const isManual = !!step.manual;
  // Nothing to measure while hidden, so the 250ms poll cannot scroll the page under a panel.
  const targetId = hidden ? null : elsewhere ? `nr-place-${step.place}` : step.target(view, plan);
  const rect = useTargetRect(targetId);

  // Advance once the game itself says the step is done. The pause lets the player see the result
  // of what they just did before the card moves on.
  useEffect(() => {
    if (isManual) return;
    if (!step.isComplete(view, plan, memory)) return;
    const t = window.setTimeout(() => setStepIndex(i => Math.min(i + 1, steps.length - 1)), 650);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, stepIndex]);

  // Every hook above this line, so the run keeps advancing while it is out of sight.
  if (hidden) return null;

  const PADDING = 8;
  const spotlight: React.CSSProperties | null = rect
    ? {
        position: 'fixed',
        zIndex: 2001,
        left: rect.left - PADDING,
        top: rect.top - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
        borderRadius: 3,
        border: `2px solid ${UI.brass}`,
        boxShadow: `0 0 0 9999px ${SCRIM}`,
        pointerEvents: 'none',
        transition: 'all 0.2s ease',
      }
    : null;

  // Close enough to decide which side of the target has room; the card's real height varies with
  // the body copy and pixel-exactness buys nothing.
  const CARD_HEIGHT_ESTIMATE = 230;
  const CARD_WIDTH = 22 * 16;
  const cardStyle: React.CSSProperties = rect
    ? {
        ...CARD,
        top:
          rect.bottom + 16 + CARD_HEIGHT_ESTIMATE <= window.innerHeight
            ? rect.bottom + 16
            : Math.max(16, rect.top - CARD_HEIGHT_ESTIMATE - 16),
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 16 - CARD_WIDTH)),
      }
    : {
        ...CARD,
        top: Math.max(16, window.innerHeight / 2 - CARD_HEIGHT_ESTIMATE / 2),
        left: Math.max(16, window.innerWidth / 2 - CARD_WIDTH / 2),
      };

  const finish = () => {
    markGuidedTourSeen();
    onFinish();
  };

  const body = elsewhere
    ? `${PLACE_NAMES[step.place!]} is where this happens. Open it from the row along the top.`
    : step.body(view, plan);

  return (
    <>
      {/* Nothing to spotlight (a bookend): dim the whole screen instead, so the card still reads
          as the thing being spoken to. */}
      {!rect && <div style={{ position: 'fixed', inset: 0, zIndex: 2001, background: SCRIM, pointerEvents: 'none' }} />}
      {spotlight && <div style={spotlight} />}

      {/* `data-tour-*` is how an automated pass drives the run: it reads which control the card is
          pointing at and clicks that, rather than guessing from the copy. */}
      {/* `data-tour-manual` matters as much as the target here: this run has a step that
          spotlights the bars and is read rather than acted on, and an automated pass that only
          knew the target would click a div for ever waiting for something to happen. */}
      <div
        style={cardStyle}
        data-tour-step={String(stepIndex)}
        data-tour-target={targetId ?? ''}
        data-tour-manual={isManual && !elsewhere ? '1' : '0'}
      >
        <p style={stepLabel}>
          Guided first hour — {stepIndex + 1} of {steps.length}
        </p>
        <h3 style={cardTitle}>{elsewhere ? `Go to ${PLACE_NAMES[step.place!]}` : step.title}</h3>
        <p style={cardBody}>{body}</p>
        <div style={footer}>
          <button type="button" style={ghostButton} onClick={finish}>
            {isLast ? 'Close' : 'Skip the tour'}
          </button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {!isFirst && (
              <button type="button" style={plainButton} onClick={() => setStepIndex(i => Math.max(0, i - 1))}>
                Back
              </button>
            )}
            <button
              type="button"
              style={isManual && !elsewhere ? primaryButton : plainButton}
              onClick={() => (isLast ? finish() : setStepIndex(i => Math.min(i + 1, steps.length - 1)))}
            >
              {isLast ? 'Finish' : isFirst ? 'Start' : isManual && !elsewhere ? 'Next' : 'Skip this'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const PLACE_NAMES: Record<TourPlace, string> = {
  home: 'Home',
  missions: 'Missions',
  yard: 'the training yard',
  schemes: 'Schemes',
  work: 'Work',
};

/* -------------------------------------------------------------------------------------------- */
/* Chrome — the game's own tokens, so it follows light and dark mode with everything else         */
/* -------------------------------------------------------------------------------------------- */

const SCRIM = 'rgba(8, 12, 16, 0.74)';

const CARD: React.CSSProperties = {
  position: 'fixed',
  zIndex: 2002,
  width: '22rem',
  maxWidth: 'calc(100vw - 2rem)',
  boxSizing: 'border-box',
  background: UI.panelRaised,
  border: `1px solid ${UI.brass}`,
  boxShadow: '0 10px 44px rgba(0,0,0,0.5)',
  padding: '1rem 1.1rem 0.9rem',
  fontFamily: FONT.body,
  color: UI.text,
  transition: 'top 0.2s ease, left 0.2s ease',
};

const stepLabel: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.6rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: UI.textFaint,
  margin: '0 0 0.4rem',
};

const cardTitle: React.CSSProperties = {
  fontFamily: FONT.display,
  fontSize: '1.05rem',
  color: UI.brass,
  margin: '0 0 0.5rem',
};

const cardBody: React.CSSProperties = {
  fontSize: '0.84rem',
  lineHeight: 1.55,
  color: UI.textSoft,
  margin: '0 0 0.9rem',
};

const footer: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

// The full `border` shorthand is set on every variant rather than overriding `borderColor` on a
// shared base: mixing a shorthand and a longhand for one property across renders of the same
// element is a real React warning, not a lint nag.
const plainButton: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.ruleStrong}`,
  borderRadius: 2,
  color: UI.text,
  padding: '0.35rem 0.65rem',
  fontFamily: 'inherit',
  fontSize: '0.76rem',
  cursor: 'pointer',
};

const primaryButton: React.CSSProperties = {
  ...plainButton,
  border: `1px solid ${UI.brass}`,
  background: UI.brass,
  color: UI.ground,
  fontWeight: 600,
};

const ghostButton: React.CSSProperties = {
  ...plainButton,
  border: '1px solid transparent',
  background: 'transparent',
  color: UI.textFaint,
  padding: '0.35rem 0.2rem',
};
