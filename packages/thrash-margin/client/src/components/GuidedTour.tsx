/**
 * A guided first turn, played on the real campaign.
 *
 * It spotlights a control in the live UI, waits for the player to actually use it, and moves on
 * when the game state says they did. Everything counts: the troops are real troops, the attack is
 * a real attack, and a player who finishes has run one complete turn — select, recruit, build,
 * pick a target, attack, end the turn — rather than read about it.
 *
 * ## What was already here, and why this is not it
 *
 * The game has carried a tutorial since the prototype: `buildTutorial`'s eight-territory map, the
 * lobby's "Start Tutorial" quick-start, `getTutorialHint`'s six state-driven hints in a green
 * panel, and the "Tutorial Graduate" achievement. That tutorial is good as far as it goes, and it
 * stays. Two things it does not do:
 *
 * - **It only exists on the tutorial map.** `cfg.mapId === 'tutorial'` gates the panel, so a
 *   player who starts a normal campaign — which is what the lobby's main button does — gets no
 *   help at all.
 * - **It tells rather than points.** "Click Ironhold (your blue capital)" is a sentence in a
 *   side panel about a shape on a map; this points at the shape.
 *
 * So this runs on any map, naming whatever the player's actual capital and neighbours are called,
 * and `Game.tsx` hides the hint panel while it is up so the two are never talking at once.
 *
 * `GameConfig.enableTutorial` is a flag declared in `shared/types.ts` and read by nothing — a
 * placeholder from the prototype. It is deliberately left alone: the run is offered on a fresh
 * campaign and from the header, not behind a lobby checkbox nobody ticks.
 *
 * ## Action points are the constraint this tour is built around
 *
 * A turn is `apPerTurn` points, 4 by default. Recruit costs 1, build costs 1, and an attack costs
 * 2 — exactly the four the tour spends, in that order, and no more. A fifth action step would
 * either sit waiting on a disabled button or push the attack out of reach, so there isn't one.
 *
 * ## What the predicates have to tolerate
 *
 * `isComplete` is read against live state on every render, so no step may read true before the
 * run begins, and the opening scan walks the steps in order and stops at the first unfinished one
 * rather than searching the whole list. Several steps measure a *change* (troops recruited,
 * building raised), which is what `TourMemory`'s opening snapshot is for.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILDINGS, BUILDING_UPGRADES, getSlots } from 'shared/engine-reference';
import { PLAYER, isEnemy } from 'shared/types';
import type { BuildingType, GameState, Territory } from 'shared/types';

const TOUR_SEEN_KEY = 'tm_guided_tour_seen';

/** Whether this browser has finished or skipped the run before. A UI preference, not game state,
 *  so it lives in localStorage rather than in the save. */
export function hasSeenGuidedTour(): boolean {
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY);
  } catch {
    // Private browsing and blocked storage both throw. Offering the run again is the harmless
    // failure; crashing the campaign screen is not.
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

/* -------------------------------------------------------------------------------------------- */
/* The plan                                                                                       */
/* -------------------------------------------------------------------------------------------- */

export interface TourPlan {
  /** The territory the run is taught from: the player's capital, or their only holding. */
  homeId: number;
  /** The neighbour it attacks: the weakest thing adjacent to home that is not already ours. */
  targetId: number;
  /** The building it raises, chosen for what the treasury can actually pay for right now. */
  building: BuildingType;
}

const owned = (state: GameState) => state.nodes.filter(n => n.owner === PLAYER);

/** Neighbours of a node, read off the edge list in both directions. */
function neighboursOf(state: GameState, id: number): Territory[] {
  const ids = new Set<number>();
  for (const [a, b] of state.edges) {
    if (a === id) ids.add(b);
    if (b === id) ids.add(a);
  }
  return [...ids].map(i => state.nodes[i]).filter(Boolean);
}

/**
 * Work out the turn to teach, from the board as it stands.
 *
 * Nothing here is hardcoded to the tutorial map. The home territory is whichever one the player
 * actually holds, the target is the softest thing next to it, and the building is the cheapest one
 * the treasury can pay for out of what is still unbuilt — so the run says "build a Farm" only when
 * a Farm is genuinely the sensible thing to build, and says the right name on every map.
 *
 * Returns null when the run does not make sense: more than one territory held (this is a first
 * turn, not a rescue), no free building slot, nothing adjacent to take, or no money.
 */
export function planFirstTurn(state: GameState): TourPlan | null {
  if (state.status !== 'active') return null;
  const mine = owned(state);
  if (mine.length !== 1) return null;
  const home = mine[0];

  // Somewhere to attack. Weakest first: a first attack that bounces teaches the wrong lesson.
  const targets = neighboursOf(state, home.id)
    .filter(n => n.owner !== PLAYER)
    .sort((a, b) => a.troops - b.troops || Number(isEnemy(b.owner)) - Number(isEnemy(a.owner)));
  if (targets.length === 0) return null;

  // Something to build, and a slot to put it in. Base buildings only: the rest of the list is
  // reachable as an upgrade of something already standing, which on turn one nothing is.
  if (home.buildings.length >= getSlots(home)) return null;
  const upgradeTargets = new Set<string>(Object.values(BUILDING_UPGRADES));
  const affordable = (Object.keys(BUILDINGS) as BuildingType[])
    .filter(b => !upgradeTargets.has(b) && !home.buildings.includes(b))
    .filter(b => BUILDINGS[b].cost.gold <= state.resources.gold && BUILDINGS[b].cost.mat <= state.resources.mat)
    .sort((a, b) => BUILDINGS[a].cost.gold + BUILDINGS[a].cost.mat - (BUILDINGS[b].cost.gold + BUILDINGS[b].cost.mat));
  if (affordable.length === 0) return null;

  if (state.resources.gold < state.config.recruitCost) return null;

  return { homeId: home.id, targetId: targets[0].id, building: affordable[0] };
}

/* -------------------------------------------------------------------------------------------- */
/* Steps                                                                                          */
/* -------------------------------------------------------------------------------------------- */

/** Everything a step reads, assembled by `Game.tsx` from state plus its own selection. */
export interface TourView {
  state: GameState;
  selId: number | null;
  tgtId: number | null;
}

/** The opening snapshot, for steps that measure a change rather than a value. */
interface TourMemory {
  troops: number;
  buildings: number;
  territories: number;
  turn: number;
  logLength: number;
}

interface TourStep {
  title: string;
  body: (v: TourView, plan: TourPlan) => string;
  target: (v: TourView, plan: TourPlan) => string | null;
  isComplete: (v: TourView, plan: TourPlan, memory: TourMemory) => boolean;
}

const nodeOf = (v: TourView, id: number): Territory | undefined => v.state.nodes[id];
const nameOf = (v: TourView, id: number): string => nodeOf(v, id)?.name ?? `territory ${id}`;

const INTRO: TourStep = {
  title: 'One turn, start to finish',
  body: (v, plan) =>
    `I will point at one control at a time and wait while you use it. This is your real campaign — everything you do here counts. ` +
    `We will raise troops at ${nameOf(v, plan.homeId)}, build something that pays for itself, and take ${nameOf(v, plan.targetId)}. Skip at any time.`,
  target: () => null,
  isComplete: () => false,
};

const SELECT_HOME: TourStep = {
  title: 'Select your capital',
  body: (v, plan) =>
    `Click ${nameOf(v, plan.homeId)} on the map. Selecting a territory is what opens its options — nothing in this game happens to a territory you have not selected.`,
  target: (_v, plan) => `territory-${plan.homeId}`,
  isComplete: (v, plan) => v.selId === plan.homeId,
};

const RECRUIT: TourStep = {
  title: 'Raise some troops',
  body: (v, plan) =>
    `Recruit costs ${v.state.config.recruitCost} gold a troop and one action point, and a settlement will only hold so many — ${nameOf(v, plan.homeId)} is capped by its level and its barracks. ` +
    `Set the slider where you like and press Recruit.`,
  target: () => 'recruit-button',
  isComplete: (v, plan, memory) => (nodeOf(v, plan.homeId)?.troops ?? 0) > memory.troops,
};

const BUILD: TourStep = {
  title: 'Build something that pays',
  body: (_v, plan) =>
    `A settlement has slots, and an empty slot earns nothing. ${BUILDINGS[plan.building].name} — ${BUILDINGS[plan.building].desc.toLowerCase()} — costs ${BUILDINGS[plan.building].cost.gold} gold and ${BUILDINGS[plan.building].cost.mat} materials, and goes on paying every turn for the rest of the campaign. ` +
    `This is the half of the game the sword does not win.`,
  target: (_v, plan) => `build-${plan.building}`,
  isComplete: (v, plan, memory) => (nodeOf(v, plan.homeId)?.buildings.length ?? 0) > memory.buildings,
};

const PICK_TARGET: TourStep = {
  title: 'Pick what to take',
  body: (v, plan) => {
    const target = nodeOf(v, plan.targetId);
    return (
      `Click ${nameOf(v, plan.targetId)} — the ring round it marks it as somewhere you can reach from here. ` +
      `It holds ${target?.troops ?? '?'} troops, which is the softest thing next to you, and taking it widens everything: more gold a turn, more ground to recruit on, more neighbours to go at next.`
    );
  },
  target: (_v, plan) => `territory-${plan.targetId}`,
  isComplete: (v, plan) => v.tgtId === plan.targetId || nodeOf(v, plan.targetId)?.owner === PLAYER,
};

const ATTACK: TourStep = {
  title: 'Send them in',
  body: () =>
    `The slider sets how many troops go. Combat here is arithmetic, not dice — the preview above the button is what will happen, not what might. ` +
    `Leave at least one troop at home: a territory with nothing in it is a territory anyone can walk into.`,
  target: () => 'attack-button',
  // An attack that bounces is still an attack, and still the lesson. Any of: we hold it now, the
  // defenders are fewer than they were, or the log has grown since the run opened.
  isComplete: (v, plan, memory) =>
    nodeOf(v, plan.targetId)?.owner === PLAYER ||
    owned(v.state).length > memory.territories ||
    v.state.log.length > memory.logLength,
};

const END_TURN: TourStep = {
  title: 'End the turn',
  body: v =>
    `Your points are spent. Ending the turn collects the production, feeds the troops — one food each, every turn, and a shortfall starves them — and lets ${v.state.config.hotseat ? 'the other player' : 'the enemy'} move.`,
  target: () => 'end-turn-button',
  isComplete: (v, _plan, memory) => v.state.turn > memory.turn,
};

const OUTRO: TourStep = {
  title: 'That is the turn',
  body: () =>
    `Recruit, build, take ground, end the turn. The tension in this game is that troops eat and buildings do not: an army you cannot feed starves, and an economy you do not defend gets taken. ` +
    `Watch the food line in the header more closely than the gold. Win by taking every enemy territory.`,
  target: () => null,
  isComplete: () => false,
};

const STEPS: TourStep[] = [INTRO, SELECT_HOME, RECRUIT, BUILD, PICK_TARGET, ATTACK, END_TURN, OUTRO];

/* -------------------------------------------------------------------------------------------- */
/* Placement                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/**
 * Track where the spotlit element actually is.
 *
 * Polled rather than observed: targets appear and move as the sidebar re-renders, the map pans and
 * zooms under the player's hand, and no one listener catches all of it. A quarter-second tick is
 * invisible to a player and cheap beside the game's own renders.
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
      // A zero-size box is an element that is in the DOM but not laid out — a collapsed mobile
      // drawer, most often. Spotlighting it would draw a ring round nothing in the corner.
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
function firstIncompleteStep(v: TourView, plan: TourPlan, memory: TourMemory): number {
  const last = STEPS.length - 1; // the outro, which never completes
  let i = 1;
  while (i < last && STEPS[i].isComplete(v, plan, memory)) i++;
  return i === 1 ? 0 : i;
}

/* -------------------------------------------------------------------------------------------- */
/* The component                                                                                  */
/* -------------------------------------------------------------------------------------------- */

interface Props {
  view: TourView;
  plan: TourPlan;
  onFinish: () => void;
}

export default function GuidedTour({ view, plan, onFinish }: Props) {
  // Captured once, on the first render. `useRef` rather than `useState` because reading it must
  // never cause a render of its own.
  const memoryRef = useRef<TourMemory>({
    troops: view.state.nodes[plan.homeId]?.troops ?? 0,
    buildings: view.state.nodes[plan.homeId]?.buildings.length ?? 0,
    territories: owned(view.state).length,
    turn: view.state.turn,
    logLength: view.state.log.length,
  });
  const memory = memoryRef.current;

  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(view, plan, memory));
  const steps = useMemo(() => STEPS, []);

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const isManual = step === INTRO || step === OUTRO;
  const targetId = step.target(view, plan);
  const rect = useTargetRect(targetId);

  // Advance once the game itself says the step is done. The pause lets the player see the result
  // of what they just did before the card moves on.
  useEffect(() => {
    if (isManual) return;
    if (!step.isComplete(view, plan, memory)) return;
    const t = setTimeout(() => setStepIndex(i => Math.min(i + 1, steps.length - 1)), 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, stepIndex]);

  const PADDING = 8;
  const spotlight: React.CSSProperties | null = rect
    ? {
        position: 'fixed',
        zIndex: 2001,
        left: rect.left - PADDING,
        top: rect.top - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
        borderRadius: 6,
        border: `2px solid ${GOLD}`,
        boxShadow: `0 0 0 9999px ${SCRIM}`,
        pointerEvents: 'none',
        transition: 'all 0.2s ease',
      }
    : null;

  // Close enough to decide which side of the target has room; the card's real height varies with
  // the body copy and pixel-exactness buys nothing.
  const CARD_HEIGHT_ESTIMATE = 210;
  const CARD_WIDTH = 330;
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

  return (
    <>
      {/* No target to spotlight (a bookend, or the drawer that holds it is shut): dim the whole
          board instead, so the card still reads as the thing being spoken to. */}
      {!rect && <div style={{ position: 'fixed', inset: 0, zIndex: 2001, background: SCRIM, pointerEvents: 'none' }} />}
      {spotlight && <div style={spotlight} />}

      {/* `data-tour-*` is how an automated pass drives the run: it reads which control the card is
          pointing at and clicks that, rather than guessing from the copy. */}
      <div style={cardStyle} data-tour-step={String(stepIndex)} data-tour-target={targetId ?? ''}>
        <p style={stepLabel}>
          Guided turn — {stepIndex + 1} of {steps.length}
        </p>
        <h3 style={cardTitle}>{step.title}</h3>
        <p style={cardBody}>{step.body(view, plan)}</p>
        <div style={footer}>
          <button type="button" style={ghostButton} onClick={finish}>
            {isLast ? 'Close' : 'Skip the tour'}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {!isFirst && (
              <button type="button" style={plainButton} onClick={() => setStepIndex(i => Math.max(0, i - 1))}>
                Back
              </button>
            )}
            <button
              type="button"
              style={isManual ? primaryButton : plainButton}
              onClick={() => (isLast ? finish() : setStepIndex(i => Math.min(i + 1, steps.length - 1)))}
            >
              {isLast ? 'Finish' : isManual ? 'Start' : 'Skip this'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Chrome — the game's own palette, not a second one                                              */
/* -------------------------------------------------------------------------------------------- */

const GOLD = '#f59e0b';
const SCRIM = 'rgba(2, 6, 12, 0.76)';

const CARD: React.CSSProperties = {
  position: 'fixed',
  zIndex: 2002,
  width: 330,
  maxWidth: 'calc(100vw - 32px)',
  boxSizing: 'border-box',
  background: '#161b22',
  border: `1px solid ${GOLD}`,
  borderRadius: 8,
  boxShadow: '0 10px 44px rgba(0,0,0,0.7)',
  padding: '14px 16px 12px',
  fontFamily: 'system-ui,sans-serif',
  color: '#e6edf3',
  transition: 'top 0.2s ease, left 0.2s ease',
};

const stepLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#7d8590',
  margin: '0 0 6px',
};

const cardTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: GOLD,
  margin: '0 0 8px',
};

const cardBody: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: '#9198a1',
  margin: '0 0 14px',
};

const footer: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

// The full `border` shorthand is set on every variant rather than overriding `borderColor` on a
// shared base: mixing a shorthand and a longhand for one property across renders of the same
// element is a real React warning, not a lint nag.
const plainButton: React.CSSProperties = {
  background: '#21262d',
  border: '1px solid #30363d',
  borderRadius: 5,
  color: '#e6edf3',
  padding: '6px 11px',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const primaryButton: React.CSSProperties = {
  ...plainButton,
  border: `1px solid ${GOLD}`,
  background: GOLD,
  color: '#0d1117',
  fontWeight: 700,
};

const ghostButton: React.CSSProperties = {
  ...plainButton,
  border: '1px solid transparent',
  background: 'transparent',
  color: '#6b7280',
  padding: '6px 2px',
};
