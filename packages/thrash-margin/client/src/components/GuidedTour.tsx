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
 * The game ships a tutorial map and a `Coach` panel (`components/Modals.tsx`) whose text follows
 * the board state. That is good as far as it goes, and it stays. Two things it does not do:
 *
 * - **It only exists on the tutorial map.** `Game.tsx` renders it under
 *   `state.config.mapId === 'tutorial'`, so a player who starts a normal campaign — which is what
 *   the lobby's main button does — gets no help at all.
 * - **It tells rather than points.** A sentence in a side panel about a shape on a map is not the
 *   same as a ring round the shape.
 *
 * So this runs on any map, naming whatever the player's actual capital and neighbours are called,
 * and `Game.tsx` hides the coach while it is up so the two are never talking at once.
 *
 * ## What the predicates have to tolerate
 *
 * `isComplete` is read against live state on every render, so no step may read true before the run
 * begins, and the opening scan walks the steps in order and stops at the first unfinished one
 * rather than searching the whole list. Several steps measure a *change* — troops recruited, a
 * building raised — which is what `TourMemory`'s opening snapshot is for.
 *
 * A step's target may name more than one element, first match wins. That is for the build step:
 * the panel's building picker is two stages, an opener that is replaced by a list of buildings, so
 * the step points at the row once the list is open and at the opener before it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BASE_BUILDINGS, BUILDINGS, slotsOf,
  type BuildingType, type GameState, type Territory,
} from 'shared/sim';
import { UI } from '../theme';

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

/** Neighbours of a node, read off the edge list in both directions. */
function neighboursOf(state: GameState, id: number): Territory[] {
  const ids = new Set<number>();
  for (const [a, b] of state.edges) {
    if (a === id) ids.add(b);
    if (b === id) ids.add(a);
  }
  return [...ids].map(i => state.nodes[i]).filter(Boolean);
}

const mine = (state: GameState) => state.nodes.filter(n => n.owner === state.activeFaction);

/**
 * Work out the turn to teach, from the board as it stands.
 *
 * Nothing is hardcoded to the tutorial map. The home territory is whichever one the player holds,
 * the target is the softest thing next to it, and the building is the cheapest the treasury can
 * pay for out of what is still unbuilt — so the run says "build a Farm" only when a Farm is
 * genuinely the sensible thing to build, and says the right name on every map.
 *
 * Returns null when the run does not make sense: more than one territory held (this is a first
 * turn, not a rescue), no free building slot, nothing adjacent to take, or no money.
 */
export function planFirstTurn(state: GameState): TourPlan | null {
  if (state.status !== 'active') return null;
  const held = mine(state);
  if (held.length !== 1) return null;
  const home = held[0];
  const purse = state.factions[state.activeFaction]?.resources;
  if (!purse) return null;

  // Somewhere to attack. Weakest first: a first attack that bounces teaches the wrong lesson.
  const targets = neighboursOf(state, home.id)
    .filter(n => n.owner !== state.activeFaction)
    .sort((a, b) => a.troops - b.troops);
  if (targets.length === 0) return null;

  // Something to build, and a slot to put it in.
  if (home.buildings.length >= slotsOf(home)) return null;
  const affordable = BASE_BUILDINGS
    .filter(b => !home.buildings.includes(b))
    .filter(b => BUILDINGS[b].cost.gold <= purse.gold && BUILDINGS[b].cost.mat <= purse.mat)
    .sort((a, b) => BUILDINGS[a].cost.gold + BUILDINGS[a].cost.mat - (BUILDINGS[b].cost.gold + BUILDINGS[b].cost.mat));
  if (affordable.length === 0) return null;

  if (purse.gold < state.config.recruitCost) return null;

  return { homeId: home.id, targetId: targets[0].id, building: affordable[0] };
}

/* -------------------------------------------------------------------------------------------- */
/* Steps                                                                                          */
/* -------------------------------------------------------------------------------------------- */

/** Everything a step reads, assembled by `Game.tsx` from state plus its own selection. */
export interface TourView {
  state: GameState;
  selected: number | null;
  target: number | null;
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
  /** One id, or several in order of preference — the first that is on screen is spotlit. */
  target: (v: TourView, plan: TourPlan) => string | string[] | null;
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
    `Click ${nameOf(v, plan.homeId)} on the map. Selecting a territory is what opens its orders — nothing in this game happens to a territory you have not selected.`,
  target: (_v, plan) => `tm-territory-${plan.homeId}`,
  isComplete: (v, plan) => v.selected === plan.homeId,
};

const RECRUIT: TourStep = {
  title: 'Raise some troops',
  body: (v, plan) =>
    `Troops cost ${v.state.config.recruitCost} gold each and no action at all, so raising them is never the thing that stops you doing something else. ` +
    `What does stop you is the cap: ${nameOf(v, plan.homeId)} holds only so many, and barracks and higher levels are what raise it. Set the stepper and press Recruit.`,
  target: () => 'tm-recruit',
  isComplete: (v, plan, memory) => (nodeOf(v, plan.homeId)?.troops ?? 0) > memory.troops,
};

const BUILD: TourStep = {
  title: 'Build something that pays',
  body: (_v, plan) =>
    `A settlement has slots, and an empty slot earns nothing. Open the slot and choose ${BUILDINGS[plan.building].name} — ${BUILDINGS[plan.building].desc.toLowerCase()} — for ${BUILDINGS[plan.building].cost.gold} gold and ${BUILDINGS[plan.building].cost.mat} materials. ` +
    `It costs one action now and goes on paying every turn for the rest of the campaign. This is the half of the game the sword does not win.`,
  // The picker is two stages: the opener is replaced by the list of buildings once it is pressed.
  target: (_v, plan) => [`tm-build-${plan.building}`, 'tm-build-open'],
  isComplete: (v, plan, memory) => (nodeOf(v, plan.homeId)?.buildings.length ?? 0) > memory.buildings,
};

const PICK_TARGET: TourStep = {
  title: 'Pick what to take',
  body: (v, plan) =>
    `With your own territory selected, click ${nameOf(v, plan.targetId)} — the ring round it marks it as somewhere you can reach from here. ` +
    `It holds ${nodeOf(v, plan.targetId)?.troops ?? '?'} troops, the softest thing next to you, and taking it widens everything: more income a turn, more ground to recruit on, more neighbours to go at next.`,
  target: (_v, plan) => `tm-territory-${plan.targetId}`,
  isComplete: (v, plan) => v.target === plan.targetId || nodeOf(v, plan.targetId)?.owner === v.state.activeFaction,
};

const ATTACK: TourStep = {
  title: 'Send them in',
  body: () =>
    `The columns decide how many go and how many actions it costs. Combat here is arithmetic, not dice — what the panel forecasts is what will happen, not what might. ` +
    `Leave a garrison behind: a territory with nothing in it is a territory anyone can walk into.`,
  target: () => 'tm-attack',
  // An attack that bounces is still an attack, and still the lesson. Any of: we hold it now, we
  // hold more ground than we did, or the chronicle has grown since the run opened.
  isComplete: (v, plan, memory) =>
    nodeOf(v, plan.targetId)?.owner === v.state.activeFaction ||
    mine(v.state).length > memory.territories ||
    v.state.log.length > memory.logLength,
};

const END_TURN: TourStep = {
  title: 'End the turn',
  body: v =>
    `Ending the turn collects the income, feeds the troops — ${v.state.config.upkeep} food each, every turn, and a shortfall starves them — and lets everyone else move.`,
  target: () => 'tm-end-turn',
  isComplete: (v, _plan, memory) => v.state.turn > memory.turn,
};

const OUTRO: TourStep = {
  title: 'That is the turn',
  body: () =>
    `Recruit, build, take ground, end the turn. The tension in this game is that troops eat and buildings do not: an army you cannot feed starves, and an economy you do not defend gets taken. ` +
    `Watch the food chip in the top bar more closely than the gold. Press ? at any time for the full rules.`,
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
function useTargetRect(targetIds: string[]): { rect: DOMRect | null; id: string | null } {
  // The resolved id travels with the rect: a step may name several candidates, and both the
  // `data-tour-target` attribute and anything reading it need the one actually spotlit, not the
  // first on the list. Reporting the preference instead made an automated pass hunt for the
  // building row while the ring was on the opener that reveals it.
  const [found, setFound] = useState<{ rect: DOMRect | null; id: string | null }>({ rect: null, id: null });
  const key = targetIds.join('|');

  useEffect(() => {
    const ids = key ? key.split('|') : [];
    const setRect = (r: DOMRect | null, id: string | null = null) => setFound({ rect: r, id: r ? id : null });
    if (ids.length === 0) {
      setRect(null);
      return;
    }
    let scrolledOnce = false;
    const measure = () => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        // A zero-size box is an element in the DOM but not laid out — a collapsed bottom sheet,
        // most often. Spotlighting it would ring nothing in the corner.
        if (r.width === 0 && r.height === 0) continue;
        if (!scrolledOnce && (r.top < 0 || r.bottom > window.innerHeight)) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          scrolledOnce = true;
          setRect(el.getBoundingClientRect(), id);
          return;
        }
        setRect(r, id);
        return;
      }
      setRect(null);
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
  }, [key]);

  return found;
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

const asList = (t: string | string[] | null): string[] => (t === null ? [] : Array.isArray(t) ? t : [t]);

/* -------------------------------------------------------------------------------------------- */
/* The component                                                                                  */
/* -------------------------------------------------------------------------------------------- */

interface Props {
  view: TourView;
  plan: TourPlan;
  onFinish: () => void;
  /**
   * Draw nothing for now, but keep the run's place. Game.tsx sets this while a modal (the
   * hand-over, the dispatch, an event) owns the screen. Unmounting instead would throw the step
   * away, and the prefix scan that picks where to open would land on the welcome card again,
   * because ending the turn clears the selection the early steps read.
   */
  hidden?: boolean;
}

export default function GuidedTour({ view, plan, onFinish, hidden = false }: Props) {
  // Captured once, on the first render. `useRef` rather than `useState` because reading it must
  // never cause a render of its own.
  const memoryRef = useRef<TourMemory>({
    troops: view.state.nodes[plan.homeId]?.troops ?? 0,
    buildings: view.state.nodes[plan.homeId]?.buildings.length ?? 0,
    territories: view.state.nodes.filter(n => n.owner === view.state.activeFaction).length,
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
  const targetIds = asList(step.target(view, plan));
  const { rect, id: shownTarget } = useTargetRect(targetIds);

  // Advance once the game itself says the step is done. The pause lets the player see the result
  // of what they just did before the card moves on.
  useEffect(() => {
    if (isManual) return;
    if (!step.isComplete(view, plan, memory)) return;
    const t = window.setTimeout(() => setStepIndex(i => Math.min(i + 1, steps.length - 1)), 650);
    return () => window.clearTimeout(t);
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
        borderRadius: 8,
        border: `2px solid ${UI.accent}`,
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

  if (hidden) return null;

  return (
    <>
      {/* No target to spotlight (a bookend, or the sheet that holds it is shut): dim the whole
          board instead, so the card still reads as the thing being spoken to. */}
      {!rect && <div style={{ position: 'fixed', inset: 0, zIndex: 2001, background: SCRIM, pointerEvents: 'none' }} />}
      {spotlight && <div style={spotlight} />}

      {/* `data-tour-*` is how an automated pass drives the run: it reads which control the card is
          pointing at and clicks that, rather than guessing from the copy. */}
      <div style={cardStyle} data-tour-step={String(stepIndex)} data-tour-target={shownTarget ?? ''}>
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
/* Chrome — the game's own tokens, so it follows light and dark mode with everything else         */
/* -------------------------------------------------------------------------------------------- */

const SCRIM = 'rgba(2, 6, 12, 0.72)';

const CARD: React.CSSProperties = {
  position: 'fixed',
  zIndex: 2002,
  width: 330,
  maxWidth: 'calc(100vw - 32px)',
  boxSizing: 'border-box',
  background: UI.panelRaised,
  border: `1px solid ${UI.accent}`,
  borderRadius: 8,
  boxShadow: '0 10px 44px rgba(0,0,0,0.45)',
  padding: '14px 16px 12px',
  color: UI.text,
  transition: 'top 0.2s ease, left 0.2s ease',
};

const stepLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: UI.textFaint,
  margin: '0 0 6px',
};

const cardTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: UI.accent,
  margin: '0 0 8px',
};

const cardBody: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: UI.textSoft,
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
  background: UI.panel,
  border: `1px solid ${UI.ruleStrong}`,
  borderRadius: 6,
  color: UI.text,
  padding: '6px 11px',
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const primaryButton: React.CSSProperties = {
  ...plainButton,
  border: `1px solid ${UI.accent}`,
  background: UI.accent,
  color: UI.accentInk,
  fontWeight: 700,
};

const ghostButton: React.CSSProperties = {
  ...plainButton,
  border: '1px solid transparent',
  background: 'transparent',
  color: UI.textFaint,
  padding: '6px 2px',
};
