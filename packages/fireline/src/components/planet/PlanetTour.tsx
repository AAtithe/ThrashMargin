/**
 * War for the Planet: the guided first turn (fireline-planet-design.md, build log; fireline-design.md
 * section 5 for the pattern it follows).
 *
 * It rings one control at a time on the real war and waits for the player to use it: the map and
 * the capital, a region's details, a build, a recruit, a move, how a battle is fought, the
 * Diplomacy screen and a proposal, the Trade screen and a route, End turn, and the Journal that
 * reports the turn. Every order goes through the same `act` as any other, so the reducer is
 * untouched and the war it leaves behind is an ordinary war.
 *
 * The lessons of the portal's other tours, kept here too:
 *
 * - **No step completes on arrival.** Every predicate compares the live view with a snapshot taken
 *   when that step became current (`Baseline`).
 * - **No step un-completes.** Completion is latched the moment it is first seen.
 * - **Where the run resumes is the caller's business.** The caller passes `startAt`; Planet.tsx
 *   walks the steps in order and stops at the first one this save has not finished
 *   (`firstUnfinished`). The tour never guesses a resume point from the war.
 * - **It stays mounted through modals** (`hidden`), returning null only after every hook.
 * - **The card names its target** (`data-tour-target`, the element actually ringed), says when a
 *   step is read rather than acted on (`data-tour-manual`), names the option to choose when it
 *   rings a list (`data-tour-pick`), and carries `data-tour-done` while it pauses after a finished
 *   step, so `scripts/tours/fireline-planet.cjs` can drive it honestly.
 *
 * Progress is a UI preference kept per save in localStorage (wrapped in try/catch), never in the
 * save: the 48 KB strategic budget is for the war.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { proposalVerdict } from '../../planet/diplomacy';
import { routeProblem } from '../../planet/trade';
import { CITY_BUILDINGS, type CityBuildingId, type FactionId, type PlanetMap, type PlanetState, type RegionId } from '../../planet/types';
import { buildingName } from '../../planet/cities';
import { FONT, UI } from '../../theme';
import { why } from './common';
import { defaultDraft } from './DiplomacyTab';

export type PlanetTabKey = 'map' | 'army' | 'research' | 'commander' | 'diplomacy' | 'trade' | 'journal';

// ---- Progress, per save, in this browser ------------------------------------------------------

const progressKey = (id: string) => `fireline_planet_tour_${id}`;
const SEEN_KEY = 'fireline_planet_tour_seen';

export interface PlanetTourProgress {
  /** The run is showing (or would be, on this save's next load). */
  open: boolean;
  /** Steps finished, by index. */
  done: number[];
}

export function readPlanetTour(id: string): PlanetTourProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(id));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PlanetTourProgress>;
    return { open: p.open === true, done: Array.isArray(p.done) ? p.done.filter(n => Number.isInteger(n) && n >= 0) : [] };
  } catch {
    return null;
  }
}

export function writePlanetTour(id: string, p: PlanetTourProgress): void {
  try {
    localStorage.setItem(progressKey(id), JSON.stringify(p));
  } catch {
    /* Blocked storage: the run simply does not resume next time. */
  }
}

/** Asked for on a new war: opens on the welcome card when the war first loads. */
export function startPlanetTour(id: string): void {
  writePlanetTour(id, { open: true, done: [] });
}

/** Whether this browser has finished or skipped a guided first turn (the war panel's default). */
export function hasSeenPlanetTour(): boolean {
  try {
    return !!localStorage.getItem(SEEN_KEY);
  } catch {
    return false;
  }
}

function markPlanetTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* Harmless: the war panel ticks the guided option again next time. */
  }
}

/** The first step not finished, walking them in order (the caller's resume point). */
export function firstUnfinished(p: PlanetTourProgress, count: number): number {
  for (let i = 0; i < count; i++) if (!p.done.includes(i)) return i;
  return count - 1;
}

// ---- What a step reads ----------------------------------------------------------------------------

/** Assembled by the Planet screen on every render. */
export interface PlanetTourView {
  s: PlanetState;
  map: PlanetMap;
  tab: PlanetTabKey;
  selected: RegionId | null;
  /** The faction the propose dialog is open for, if it is. */
  proposing: FactionId | null;
  /** Regions the field army can move to now. */
  moves: RegionId[];
  /** Regions the field army can attack now. */
  targets: RegionId[];
}

interface Baseline {
  tab: PlanetTabKey;
  selected: RegionId | null;
  marks: number;
  units: number;
  armyRegion: RegionId | null;
  armyMoved: number;
  treaties: string[];
  routes: number[];
  turn: number;
}

const mine = (s: PlanetState) => s.regions.map((r, i) => (r.owner === 0 ? i : -1)).filter(i => i >= 0);

function baselineOf(v: PlanetTourView): Baseline {
  const s = v.s;
  let marks = 0;
  let units = s.factions[0].army?.units.length ?? 0;
  for (const r of mine(s)) {
    const c = s.regions[r].city;
    marks += c.level + CITY_BUILDINGS.reduce((n, b) => n + (c.b[b] ?? 0), 0);
    units += s.regions[r].garrison.reduce((n, x) => n + x, 0);
  }
  return {
    tab: v.tab,
    selected: v.selected,
    marks,
    units,
    armyRegion: s.factions[0].army?.region ?? null,
    armyMoved: s.factions[0].army?.moved ?? 0,
    treaties: s.treaties.filter(t => t.a === 0 || t.b === 0).map(t => JSON.stringify(t)),
    routes: s.routes.filter(r => r.owner === 0).map(r => r.id),
    turn: s.turn,
  };
}

const BUILD_ORDER: CityBuildingId[] = ['farms', 'refinery', 'institute', 'fortifications', 'factory', 'port', 'airfield'];

/** A build the player can give now: in the selected region if it is theirs, else the capital. */
function buildChoice(v: PlanetTourView): { region: RegionId; building: CityBuildingId } | null {
  const cap = v.s.factions[0].capital;
  const regions = [v.selected !== null && v.s.regions[v.selected]?.owner === 0 ? v.selected : null, cap].filter((r): r is number => r !== null && r >= 0);
  for (const region of regions)
    for (const building of BUILD_ORDER) if (!why(v.s, { type: 'build', region, building })) return { region, building };
  return null;
}

function recruitChoice(v: PlanetTourView): RegionId | null {
  const cap = v.s.factions[0].capital;
  const regions = [v.selected !== null && v.s.regions[v.selected]?.owner === 0 ? v.selected : null, cap].filter((r): r is number => r !== null && r >= 0);
  return regions.find(region => !why(v.s, { type: 'recruit', region, kind: 'rifleman', to: 'garrison' })) ?? null;
}

/** A faction that would sign the propose dialog's opening draft as it stands. */
function proposeChoice(v: PlanetTourView): FactionId | null {
  for (const f of v.s.factions) {
    if (f.id === 0 || !f.alive) continue;
    const draft = defaultDraft(v.s, f.id);
    if (why(v.s, { type: 'propose', to: f.id, draft })) continue;
    if (proposalVerdict(v.s, f.id, 0, draft).accept) return f.id;
  }
  return null;
}

function routePossible(v: PlanetTourView): boolean {
  return mine(v.s).some(a => v.map.regions.some(h => h.id !== a && routeProblem(v.s, 0, a, h.id) === null));
}

/** A region to look at: one the army can attack, else a neighbour of the selection. */
function lookChoice(v: PlanetTourView): RegionId | null {
  const t = v.targets.find(r => r !== v.selected);
  if (t !== undefined) return t;
  const from = v.selected ?? v.s.factions[0].capital;
  return v.map.regions[from]?.links.find(l => l.to !== v.selected)?.to ?? null;
}

const city = (v: PlanetTourView, r: RegionId) => v.map.regions[r]?.city ?? 'that region';
const onTab = (v: PlanetTourView, tab: PlanetTabKey, id: string | null) => (v.tab !== tab ? `pl-tab-${tab}` : id);
const disabled = (id: string) => !!(document.getElementById(id) as HTMLButtonElement | null)?.disabled;

interface Step {
  title: string;
  body: (v: PlanetTourView, target: string | null) => string;
  target: (v: PlanetTourView) => string | null;
  /** The option to choose when the target is a list. */
  pick?: (v: PlanetTourView) => RegionId | null;
  isComplete: (v: PlanetTourView, b: Baseline) => boolean;
  /** Always read rather than acted on. */
  manual?: boolean;
  /** Read rather than acted on just now: the action cannot be taken in this war at the moment. */
  manualIf?: (v: PlanetTourView, b: Baseline) => boolean;
}

const tabNote = (target: string | null) => {
  const m = target?.match(/^pl-tab-(\w+)$/);
  return m ? `First open the ${m[1].charAt(0).toUpperCase() + m[1].slice(1)} screen. ` : '';
};

/** A region step: ring the region to choose first, then the control in its panel. */
function regionTarget(v: PlanetTourView, region: RegionId, id: string): string {
  if (v.tab !== 'map') return 'pl-tab-map';
  if (v.selected === region) return id;
  return region === v.s.factions[0].capital ? 'pl-goto-capital' : 'pl-region-select';
}

function buildSteps(): Step[] {
  return [
    {
      title: 'Your first turn',
      body: () =>
        'I will ring one thing at a time and wait while you do it. This is your real war: everything you build, recruit and sign stays. A turn is any number of orders, then End turn. Skip at any time.',
      target: () => null,
      isComplete: () => false,
      manual: true,
    },
    {
      title: 'The planet and your capital',
      body: v =>
        `Each shape is a region with one city. Yours wear your colour; your capital is ${city(v, v.s.factions[0].capital)}, where your field army stands, the marker with its unit count. Grey regions are independent. Regions ringed in red are ones your army can attack this turn; dashed lines are sea crossings.`,
      target: v => onTab(v, 'map', 'pl-map'),
      isComplete: () => false,
      manual: true,
    },
    {
      title: "A region's details",
      body: (v, t) => {
        const r = lookChoice(v);
        return `${tabNote(t)}Choose a region, from the map or from this list${r !== null ? `: try ${city(v, r)}` : ''}. The panel shows who holds it, what it yields each turn, its city, its garrison and, when your army can reach it, the odds of taking it.`;
      },
      target: v => onTab(v, 'map', 'pl-region-select'),
      pick: lookChoice,
      isComplete: (v, b) => v.selected !== null && v.selected !== b.selected,
    },
    {
      title: 'Build in a city',
      body: (v, t) => {
        const c = buildChoice(v);
        if (!c) return 'Your cities have built all they can this turn: one build or growth per city per turn, and you need the resources. Build next turn.';
        if (t === 'pl-goto-capital') return `${tabNote(t)}Go back to your capital, ${city(v, c.region)}.`;
        const mk = v.s.regions[c.region].city.b[c.building] ?? 0;
        const order = mk ? `Raise the ${buildingName(c.building, mk)} to Mk ${mk + 1}` : `Build the ${buildingName(c.building, 1)}`;
        return `${tabNote(t)}Each city holds one more building than its level, and buildings go up to Mk 3. ${order} here. The cost comes out of the stocks at the top, and a city builds or grows once a turn.`;
      },
      target: v => {
        const c = buildChoice(v);
        return c ? regionTarget(v, c.region, `pl-build-${c.building}`) : null;
      },
      pick: v => buildChoice(v)?.region ?? null,
      isComplete: (v, b) => baselineOf(v).marks > b.marks,
      manualIf: v => !buildChoice(v),
    },
    {
      title: 'Recruit',
      body: (v, t) => {
        const r = recruitChoice(v);
        if (r === null) return 'No city of yours can recruit just now: a garrison has a cap, and every unit costs food or alloys and fuel. Recruit next turn.';
        if (t === 'pl-goto-capital') return `${tabNote(t)}Go back to your capital, ${city(v, r)}.`;
        if (t === 'pl-recruit-kind') return 'You cannot afford that unit. Choose a Rifleman from this list.';
        return `${tabNote(t)}A garrison holds its region and defends it in battle. Recruit a Rifleman into it (1 food). Vehicles need a factory in the region. The Army screen recruits into your field army instead.`;
      },
      target: v => {
        const r = recruitChoice(v);
        if (r === null) return null;
        const t = regionTarget(v, r, 'pl-recruit-garrison');
        return t === 'pl-recruit-garrison' && disabled(t) ? 'pl-recruit-kind' : t;
      },
      pick: v => recruitChoice(v),
      isComplete: (v, b) => baselineOf(v).units > b.units,
      manualIf: v => recruitChoice(v) === null,
    },
    {
      title: 'Move your field army',
      body: (v, t) => {
        if (!v.moves.length) return `Your field army cannot move this turn: it moves up to ${v.s.options.armyMove} regions a turn, through your own regions and your allies'.`;
        if (t === 'pl-region-select') return `${tabNote(t)}Choose where it should go: ${city(v, v.moves[0])} is in reach.`;
        return `${tabNote(t)}Your field army moves up to ${v.s.options.armyMove} regions a turn through ground you may pass, and attacks from where it stands. Move it here.`;
      },
      target: v => {
        if (!v.moves.length) return onTab(v, 'map', 'pl-map');
        if (v.tab !== 'map') return 'pl-tab-map';
        return v.selected !== null && v.moves.includes(v.selected) ? 'pl-move-army' : 'pl-region-select';
      },
      pick: v => (v.selected !== null && v.moves.includes(v.selected) ? null : v.moves[0] ?? null),
      isComplete: (v, b) => (v.s.factions[0].army?.region ?? null) !== b.armyRegion || (v.s.factions[0].army?.moved ?? 0) > b.armyMoved,
      manualIf: v => !v.moves.length,
    },
    {
      title: 'Battles',
      body: v =>
        v.s.pending.length
          ? 'A battle is waiting. Fight it yourself as a real Fireline battle on that region\'s ground, or Auto-resolve it from the strength of each side, shown as the odds. Nothing else can be ordered until it is settled.'
          : 'Choose a region ringed in red and its panel offers Attack, with the extra credits and heroes to bring and the chance of taking it. One attack a turn. The battle then waits for you: Fight plays it as a real Fireline battle on that region\'s ground, Auto-resolve settles it at once from the odds. When time runs out, the defenders win.',
      target: v => (v.s.pending.length ? 'pl-pending' : v.tab === 'map' ? 'pl-map' : null),
      isComplete: () => false,
      manual: true,
    },
    {
      title: 'Diplomacy',
      body: () => 'Every faction starts under a short truce with you. Open the Diplomacy screen to see where each one stands.',
      target: () => 'pl-tab-diplomacy',
      isComplete: (v, b) => v.tab === 'diplomacy' && b.tab !== 'diplomacy',
      manualIf: (_v, b) => b.tab === 'diplomacy',
    },
    {
      title: 'Propose a treaty',
      body: (v, t) => {
        if (t === 'pl-send-proposal')
          return 'The verdict above the button says whether they would accept, and why, before you send it. Send it.';
        if (t === 'pl-treaty-verdict')
          return 'As it stands they would refuse; the reasons are here. Add a term they like, such as a payment, or choose a shorter length, until they would accept.';
        const f = proposeChoice(v);
        if (f === null) return 'No faction would sign a treaty with you just now. Trust rises with gifts and kept treaties; try again in a turn or two.';
        return `${tabNote(t)}Each card shows a faction's stance, temperament and trust in you. A trade pact allows trade routes between you; an alliance shares battles and victory. Propose a treaty to ${v.s.factions[f].name}.`;
      },
      target: v => {
        if (v.tab !== 'diplomacy') return 'pl-tab-diplomacy';
        if (v.proposing !== null) return disabled('pl-send-proposal') ? 'pl-treaty-verdict' : 'pl-send-proposal';
        const f = proposeChoice(v);
        return f === null ? null : `pl-propose-${f}`;
      },
      isComplete: (v, b) => v.s.treaties.some(t => (t.a === 0 || t.b === 0) && t.since === v.s.turn && !b.treaties.includes(JSON.stringify(t))),
      manualIf: v => v.proposing === null && proposeChoice(v) === null,
    },
    {
      title: 'Trade',
      body: () => 'Open the Trade screen, where routes between cities pay resources every turn.',
      target: () => 'pl-tab-trade',
      isComplete: (v, b) => v.tab === 'trade' && b.tab !== 'trade',
      manualIf: (_v, b) => b.tab === 'trade',
    },
    {
      title: 'Open a route',
      body: (v, t) =>
        routePossible(v)
          ? `${tabNote(t)}A route between two of your cities pays ore and food; one to a trading partner's city pays fuel and alloys to you both. A route cut by war pays nothing that turn. Open this one.`
          : `${tabNote(t)}No route is in reach yet. A route joins two of your cities at least 2 hops apart, or one of yours to a city of a faction you have a trade pact or alliance with, along a path you may pass. Come back here once you hold more ground or your partner's cities are in reach.`,
      target: v => onTab(v, 'trade', routePossible(v) ? 'pl-open-route' : 'pl-trade-open'),
      isComplete: (v, b) => v.s.routes.some(r => r.owner === 0 && !b.routes.includes(r.id)),
      manualIf: v => !routePossible(v),
    },
    {
      title: 'End the turn',
      body: v =>
        v.s.pending.length
          ? 'Settle the waiting battle first: Fight it or Auto-resolve it.'
          : 'When your orders are given, end the turn. Every other faction then moves, every city produces, and any attack on you becomes a battle to settle before your next orders.',
      target: v => (v.s.pending.length ? 'pl-pending' : 'pl-end-turn'),
      isComplete: (v, b) => v.s.turn > b.turn,
    },
    {
      title: 'The turn report',
      body: () => 'What happened while you waited is written in the Journal. Open it.',
      target: () => 'pl-tab-journal',
      isComplete: (v, b) => v.tab === 'journal' && b.tab !== 'journal',
      manualIf: (_v, b) => b.tab === 'journal',
    },
    {
      title: 'Read the report',
      body: () =>
        'Newest first: what you built and signed, what every other faction did, what your cities produced and any shortfall. Read it at the start of every turn; trouble shows here before it reaches the map.',
      target: v => onTab(v, 'journal', 'pl-journal'),
      isComplete: () => false,
      manual: true,
    },
    {
      title: 'From here',
      body: () =>
        'Grow your cities, keep the food and fuel above water, research on the Research screen, and pick your first fight while the truce lasts. How to Play in the lobby has the rules, and Tour at the top reopens this run.',
      target: () => null,
      isComplete: () => false,
      manual: true,
    },
  ];
}

export const PLANET_TOUR_STEPS = buildSteps().length;

/** Where the ringed element is, polled; any scroll is one-shot and instant (a smooth one moves after it is measured). */
function useTargetRect(targetId: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!targetId) {
      setRect(null);
      return;
    }
    let scrolled = false;
    // The first scroll waits for the poll: the screen scrolls itself to the top as it mounts, after
    // this effect has run, and would undo a scroll made now.
    const measure = (mayScroll: boolean) => {
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
      if (mayScroll && !scrolled && (r.top < 0 || r.bottom > window.innerHeight) && r.height < window.innerHeight) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        scrolled = true;
        r = el.getBoundingClientRect();
      }
      setRect(prev => (prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height ? prev : r));
    };
    const quiet = () => measure(false);
    quiet();
    const iv = window.setInterval(() => measure(true), 250);
    window.addEventListener('resize', quiet);
    window.addEventListener('scroll', quiet, true);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('resize', quiet);
      window.removeEventListener('scroll', quiet, true);
    };
  }, [targetId]);
  return rect;
}

interface Props {
  view: PlanetTourView;
  /** The step to open on: the caller's choice (Planet.tsx walks the save's progress). */
  startAt: number;
  /** A step was finished: acted on, read, or skipped. */
  onStepDone: (index: number) => void;
  /** Skipped or finished. */
  onClose: () => void;
  /** Draw nothing but stay mounted, so a modal does not cost the run its place. */
  hidden?: boolean;
}

export default function PlanetTour({ view, startAt, onStepDone, onClose, hidden = false }: Props) {
  const steps = useMemo(buildSteps, []);
  const [stepIndex, setStepIndex] = useState(() => Math.max(0, Math.min(startAt, steps.length - 1)));
  const [latched, setLatched] = useState(-1);
  // A light poll, so the card follows controls that live inside a dialog (the propose verdict).
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setTick(t => (t + 1) % 1000), 300);
    return () => window.clearInterval(iv);
  }, []);
  const baseline = useRef<{ index: number; b: Baseline }>({ index: stepIndex, b: baselineOf(view) });
  if (baseline.current.index !== stepIndex) baseline.current = { index: stepIndex, b: baselineOf(view) };

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  // Done as soon as the war says so, before asking whether the step is read-only just now: a build
  // can leave nothing more to build, and that must not turn a finished step into a manual one.
  const done = latched === stepIndex || (!step.manual && step.isComplete(view, baseline.current.b));
  const manual = !!step.manual || (!done && !!step.manualIf?.(view, baseline.current.b));
  const lastTarget = useRef<string | null>(null);
  const targetId = hidden ? null : done ? lastTarget.current : step.target(view);
  if (!done) lastTarget.current = targetId;
  const pick = !done && targetId === 'pl-region-select' ? step.pick?.(view) ?? null : null;
  const rect = useTargetRect(targetId);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 2) setCardH(h);
  });

  // Latch completion the first time the war says so; later state cannot take it back.
  useEffect(() => {
    if (step.manual || latched === stepIndex) return;
    if (step.isComplete(view, baseline.current.b)) setLatched(stepIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, stepIndex]);

  const doneRef = useRef(onStepDone);
  doneRef.current = onStepDone;
  // Advance from the latch, after a pause long enough to see what just happened.
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => {
      doneRef.current(stepIndex);
      setStepIndex(i => Math.min(i + 1, steps.length - 1));
    }, 900);
    return () => window.clearTimeout(t);
  }, [done, stepIndex, steps.length]);

  // Every hook above this line, so the run keeps its place while it is out of sight.
  if (hidden) return null;

  const CARD_W = Math.min(340, window.innerWidth - 32);
  const big = !!rect && rect.width * rect.height > window.innerWidth * window.innerHeight * 0.2;
  const PAD = 6;
  let pos: { left: number; top: number };
  if (!rect) pos = { left: window.innerWidth / 2 - CARD_W / 2, top: Math.max(16, window.innerHeight / 2 - cardH / 2) };
  else if (big) pos = { left: rect.right - CARD_W - 16, top: Math.min(rect.bottom, window.innerHeight) - cardH - 16 };
  else {
    const fits = (l: number, t: number) => l >= 16 && t >= 16 && l + CARD_W <= window.innerWidth - 16 && t + cardH <= window.innerHeight - 16;
    const clampL = (l: number) => Math.max(16, Math.min(l, window.innerWidth - CARD_W - 16));
    const clampT = (t: number) => Math.max(16, Math.min(t, window.innerHeight - cardH - 16));
    const options = [
      { left: clampL(rect.left), top: rect.bottom + 14 },
      { left: clampL(rect.left), top: rect.top - cardH - 14 },
      { left: rect.left - CARD_W - 18, top: clampT(rect.top - 20) },
      { left: rect.right + 18, top: clampT(rect.top - 20) },
    ];
    pos = options.find(o => fits(o.left, o.top)) ?? { left: clampL(rect.left), top: 16 };
  }
  pos.left = Math.max(16, Math.min(pos.left, window.innerWidth - CARD_W - 16));
  pos.top = Math.max(16, pos.top);

  const finishStep = () => {
    onStepDone(stepIndex);
    if (isLast) close();
    else setStepIndex(i => Math.min(i + 1, steps.length - 1));
  };
  const close = () => {
    markPlanetTourSeen();
    onClose();
  };

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
        boxShadow: `0 0 0 9999px ${UI.scrim}`,
        pointerEvents: 'none',
      }
    : null;

  return (
    <>
      {!rect && <div style={{ position: 'fixed', inset: 0, zIndex: 2001, background: UI.scrim, pointerEvents: 'none' }} />}
      {ring && <div style={ring} />}
      <div
        ref={cardRef}
        role="dialog"
        aria-label="Guided first turn"
        style={{ ...CARD, left: pos.left, top: pos.top, width: CARD_W }}
        data-testid="planet-tour"
        data-tour-step={String(stepIndex)}
        data-tour-target={targetId ?? ''}
        data-tour-manual={manual ? '1' : '0'}
        {...(pick !== null ? { 'data-tour-pick': String(pick) } : {})}
        {...(done ? { 'data-tour-done': '1' } : {})}
      >
        <p style={label}>
          Guided first turn · {stepIndex + 1} of {steps.length}
        </p>
        <h3 style={title}>{done ? 'Done' : step.title}</h3>
        <p style={bodyText}>{done ? 'Good. Next step in a moment.' : step.body(view, targetId)}</p>
        <div style={footer}>
          <button type="button" style={ghost} onClick={close}>
            {isLast ? 'Close' : 'Skip the tour'}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {!isFirst && !done && (
              <button type="button" style={plain} onClick={() => setStepIndex(i => Math.max(0, i - 1))}>
                Back
              </button>
            )}
            {!done && (
              <button type="button" style={manual ? primary : plain} onClick={finishStep}>
                {isLast ? 'Finish' : isFirst ? 'Start' : manual ? 'Next' : 'Skip this step'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const CARD: CSSProperties = {
  position: 'fixed',
  zIndex: 2002,
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
