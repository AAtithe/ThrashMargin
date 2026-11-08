/**
 * A guided first turn, played on the real campaign.
 *
 * It spotlights a control in the live UI, waits for the player to actually use it, and moves on
 * when the game state says they did. Everything counts: the troops are real troops, the attack is
 * a real attack, and a player who finishes has run one complete turn — select, build, recruit,
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
const battlesOf = (state: GameState) => {
  const st = state.factions[state.activeFaction]?.stats;
  return st ? st.battlesWon + st.battlesLost : 0;
};

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

  // Recruiting comes after the build, so the gold has to cover both.
  if (purse.gold - BUILDINGS[affordable[0]].cost.gold < state.config.recruitCost) return null;

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
  turn: number;
  /** Battles the player had fought when the run opened, won or lost. */
  battles: number;
}

interface TourStep {
  title: string;
  body: (v: TourView, plan: TourPlan, memory: TourMemory) => string;
  /** One id, or several in order of preference — the first that is on screen is spotlit. */
  target: (v: TourView, plan: TourPlan, memory: TourMemory) => string | string[] | null;
  isComplete: (v: TourView, plan: TourPlan, memory: TourMemory) => boolean;
}

const nodeOf = (v: TourView, id: number): Territory | undefined => v.state.nodes[id];
const nameOf = (v: TourView, id: number): string => nodeOf(v, id)?.name ?? `territory ${id}`;

const INTRO: TourStep = {
  title: 'One turn, start to finish',
  body: (v, plan) =>
    `I will point at one control at a time and wait while you use it. This is your real campaign — everything you do here counts. ` +
    `We will build something at ${nameOf(v, plan.homeId)} that pays for itself, raise troops there, and take ${nameOf(v, plan.targetId)}. Skip at any time.`,
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
  // An attack that bounces is still an attack, and still the lesson: we hold it now, or we have
  // fought a battle since the run opened. Not "the chronicle has grown", which it had: building
  // and recruiting both write to it, so this step read as done the moment it was reached and the
  // card skipped on to End turn with no attack made.
  isComplete: (v, plan, memory) =>
    nodeOf(v, plan.targetId)?.owner === v.state.activeFaction ||
    battlesOf(v.state) > memory.battles,
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
    `Build, recruit, take ground, end the turn. The tension in this game is that troops eat and buildings do not: an army you cannot feed starves, and an economy you do not defend gets taken. ` +
    `Watch the food chip in the top bar more closely than the gold. Press ? at any time for the full rules.`,
  target: () => null,
  isComplete: () => false,
};

// Build comes before recruiting. The recruit stepper defaults to as many troops as the treasury
// allows, so recruiting first spent the gold the planned building needed and left the build step
// pointing at a disabled row with no way forward.
/**
 * A step that acts on the capital's orders, made safe against the capital being deselected.
 *
 * Clicking a selected territory again deselects it, and so does Escape. A player who clicked their
 * capital twice (a double-click, or a second click to "make sure") had the run move on to Build
 * with nothing selected, and the card pointed at a building slot that was no longer on screen,
 * with Back the only way forward. Until the capital is selected again the step points at it.
 *
 * The attack step also needs the target picked; if it was cancelled, it points back at the target.
 */
function needsHome(step: TourStep, needsTarget = false): TourStep {
  // A finished step is never redirected: the attack clears the target as it lands, and the card
  // would otherwise say the attack was put away during the pause before it moves on.
  const lostHome = (v: TourView, plan: TourPlan, m: TourMemory) => !step.isComplete(v, plan, m) && v.selected !== plan.homeId;
  const lostTarget = (v: TourView, plan: TourPlan, m: TourMemory) => needsTarget && !step.isComplete(v, plan, m) && v.target !== plan.targetId;
  return {
    ...step,
    body: (v, plan, m) =>
      lostHome(v, plan, m)
        ? `${nameOf(v, plan.homeId)} is no longer selected. Click it again to bring back its orders.`
        : lostTarget(v, plan, m)
          ? `The attack was put away. Click ${nameOf(v, plan.targetId)} again to bring the orders back.`
          : step.body(v, plan, m),
    target: (v, plan, m) =>
      lostHome(v, plan, m)
        ? `tm-territory-${plan.homeId}`
        : lostTarget(v, plan, m)
          ? `tm-territory-${plan.targetId}`
          : step.target(v, plan, m),
  };
}

const STEPS: TourStep[] = [
  INTRO, SELECT_HOME, needsHome(BUILD), needsHome(RECRUIT), needsHome(PICK_TARGET), needsHome(ATTACK, true), END_TURN, OUTRO,
];

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
        const raw = el.getBoundingClientRect();
        // A zero-size box is an element in the DOM but not laid out — a collapsed bottom sheet,
        // most often. Spotlighting it would ring nothing in the corner.
        if (raw.width === 0 && raw.height === 0) continue;
        // Map territories are SVG and live inside a pan-and-zoom viewport with its own focus
        // handling. Scrolling one into view would scroll the overflow-hidden map container and
        // knock the board out of line with its controls, so they are only ever clipped.
        const inSvg = el instanceof SVGElement;
        if (!inSvg && !scrolledOnce && (raw.top < 0 || raw.bottom > window.innerHeight || isClippedByScroller(el, raw))) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          scrolledOnce = true;
        }
        const r = visibleRectOf(el);
        if (!r) continue;
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
 * The part of an element a player can actually see: its box cut down by every ancestor that clips
 * its overflow, and by the window. A territory's Voronoi cell routinely runs far past the edge of
 * the map viewport (on the tutorial map the capital's cell is taller than the screen), and ringing
 * the raw box drew the spotlight under the top bar and off the page, with the card parked on top
 * of the very thing it was pointing at. Returns null when nothing of it is visible.
 */
function visibleRectOf(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
    const c = p.getBoundingClientRect();
    left = Math.max(left, c.left); top = Math.max(top, c.top);
    right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
  }
  left = Math.max(left, 0); top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth); bottom = Math.min(bottom, window.innerHeight);
  if (right - left < 4 || bottom - top < 4) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Whether a scrollable ancestor (the sidebar, most often) is hiding part of the element. */
function isClippedByScroller(el: Element, r: DOMRect): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o !== 'auto' && o !== 'scroll') continue;
    const c = p.getBoundingClientRect();
    if (r.top < c.top - 1 || r.bottom > c.bottom + 1) return true;
  }
  return false;
}

/**
 * Where the card goes: below the target, then above, then to the right, then to the left — the
 * first that fits on screen without covering it. A target too big for any of those (a territory
 * filling most of a phone) gets the card in whichever screen corner overlaps it least.
 */
function placeCard(rect: DOMRect, cardW: number, cardH: number): { top: number; left: number } {
  const W = window.innerWidth, H = window.innerHeight, M = 16, GAP = 16;
  const w = Math.min(cardW, W - 2 * M);
  const clampX = (x: number) => Math.max(M, Math.min(x, W - M - w));
  const clampY = (y: number) => Math.max(M, Math.min(y, H - M - cardH));
  const candidates = [
    { top: rect.bottom + GAP, left: clampX(rect.left), ok: rect.bottom + GAP + cardH <= H - M },
    { top: rect.top - GAP - cardH, left: clampX(rect.left), ok: rect.top - GAP - cardH >= M },
    { top: clampY(rect.top), left: rect.right + GAP, ok: rect.right + GAP + w <= W - M },
    { top: clampY(rect.top), left: rect.left - GAP - w, ok: rect.left - GAP - w >= M },
  ];
  const fit = candidates.find(c => c.ok);
  if (fit) return { top: fit.top, left: fit.left };
  const overlap = (x: number, y: number) =>
    Math.max(0, Math.min(x + w, rect.right) - Math.max(x, rect.left)) *
    Math.max(0, Math.min(y + cardH, rect.bottom) - Math.max(y, rect.top));
  const corners = [
    { left: W - M - w, top: H - M - cardH }, { left: M, top: H - M - cardH },
    { left: W - M - w, top: M }, { left: M, top: M },
  ];
  return corners.reduce((best, c) => (overlap(c.left, c.top) < overlap(best.left, best.top) ? c : best));
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
   * Hidden rather than unmounted while a modal owns the screen. Unmounting threw away the step
   * and the opening snapshot, so the dispatch that follows End turn sent the run back to the
   * welcome card on turn two, teaching a plan whose gold had already been spent.
   */
  hidden?: boolean;
  /**
   * Called with the territory the current step points at, or null. On a phone the map shows only
   * part of the board above the bottom sheet, and the neighbour to attack was routinely off the
   * edge with a sliver of ring showing; `Game.tsx` feeds this to the map's focus so it pans there.
   */
  onFocusTerritory?: (id: number | null) => void;
}

export default function GuidedTour({ view, plan, onFinish, hidden = false, onFocusTerritory }: Props) {
  // Captured once, on the first render. `useRef` rather than `useState` because reading it must
  // never cause a render of its own.
  const memoryRef = useRef<TourMemory>({
    troops: view.state.nodes[plan.homeId]?.troops ?? 0,
    buildings: view.state.nodes[plan.homeId]?.buildings.length ?? 0,
    turn: view.state.turn,
    battles: battlesOf(view.state),
  });
  const memory = memoryRef.current;

  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(view, plan, memory));
  const steps = useMemo(() => STEPS, []);

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const isManual = step === INTRO || step === OUTRO;
  const done = !isManual && step.isComplete(view, plan, memory);
  // Once a step is done the card holds still on the control just used until it moves on. Reading
  // the target afresh during that pause made it flick to whatever the panel showed next: back to
  // the building opener after a build, and to nothing at all after an attack.
  const heldTargets = useRef<{ step: number; ids: string[] }>({ step: -1, ids: [] });
  const liveTargets = asList(step.target(view, plan, memory));
  if (!done || heldTargets.current.step !== stepIndex) heldTargets.current = { step: stepIndex, ids: liveTargets };
  const targetIds = done ? heldTargets.current.ids : liveTargets;
  const { rect, id: shownTarget } = useTargetRect(targetIds);

  const focusMatch = /^tm-territory-(\d+)$/.exec(targetIds[0] ?? '');
  const focusId = focusMatch ? Number(focusMatch[1]) : null;
  useEffect(() => {
    onFocusTerritory?.(focusId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
  useEffect(() => () => onFocusTerritory?.(null), [onFocusTerritory]);

  // Advance once the game itself says the step is done. The pause lets the player see the result
  // of what they just did before the card moves on.
  // Keyed on `done`, not on `view`: the view is a new object on every render, so a busy board kept
  // restarting the pause.
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setStepIndex(i => Math.min(i + 1, steps.length - 1)), 650);
    return () => window.clearTimeout(t);
  }, [done, stepIndex, steps.length]);

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

  // The card's height varies with the body copy, so it is measured after each render; the
  // estimate covers only the very first frame.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(210);
  useEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardHeight) > 2) setCardHeight(h);
  });
  const CARD_WIDTH = 330;
  const cardStyle: React.CSSProperties = rect
    ? { ...CARD, ...placeCard(rect, CARD_WIDTH, cardHeight) }
    : {
        ...CARD,
        top: Math.max(16, window.innerHeight / 2 - cardHeight / 2),
        left: Math.max(16, window.innerWidth / 2 - Math.min(CARD_WIDTH, window.innerWidth - 32) / 2),
      };

  const finish = () => {
    markGuidedTourSeen();
    onFinish();
  };

  // Every hook is above this line: one placed after an early return renders conditionally.
  if (hidden) return null;

  return (
    <>
      {/* No target to spotlight (a bookend, or the sheet that holds it is shut): dim the whole
          board instead, so the card still reads as the thing being spoken to. */}
      {!rect && <div style={{ position: 'fixed', inset: 0, zIndex: 2001, background: SCRIM, pointerEvents: 'none' }} />}
      {spotlight && <div style={spotlight} />}

      {/* `data-tour-*` is how an automated pass drives the run: it reads which control the card is
          pointing at and clicks that, rather than guessing from the copy. */}
      <div ref={cardRef} style={cardStyle} data-tour-step={String(stepIndex)} data-tour-target={shownTarget ?? ''} data-tour-done={done ? '1' : undefined}>
        <p style={stepLabel}>
          Guided turn — {stepIndex + 1} of {steps.length}
        </p>
        <h3 style={cardTitle}>{step.title}</h3>
        <p style={cardBody}>{step.body(view, plan, memory)}</p>
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
