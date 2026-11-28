/**
 * The build window: the tech tree, popped out of the sidebar (fireline-round5-design.md, section 3).
 *
 * Desktop (2026-11-28): a rail down the left edge of the battlefield (BuildRail) names every list,
 * and the window slides out of it, docked against it from top to bottom. Structures pops out once
 * more: a column of its groups, and beside it the chosen group's items. Phones and touch: a
 * full-screen sheet with the lists as tabs. Either way it is not modal: the battle keeps running,
 * and on a desktop the map outside it stays clickable.
 *
 * Round 8 (fireline-round8-build-window.md): two views. Build, the default, shows what can be built
 * now as full cards (Structures in four groups, one of them active for the hotkeys), then Coming next
 * (what one more structure unlocks) and Later. Tech tree lays every item out by tier (techTree.ts),
 * drawing lines only for the chain of the item under the pointer or focus. Everything comes from
 * rules.ts: no kind is named here.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BATTLE_LINES, BUILDINGS, PRODUCER, STRUCTURE_LEVELS, maxLevelOf, type BattleLineId, type BuildingKind, type Category, type UnitKind } from '../sim/rules';
import { buildTicksFor, costFor, hasBuilding, hasProducer, powerOf, readyStructure, researchModeOf, techAllowed } from '../sim/state';
import { linesFor } from '../sim/fortify';
import { doctrineOf, hasUpgrade, researchTicksOf } from '../sim/research';
import { levelOf, nextLevelOf, upgradePrice, upgradeProblem } from '../sim/structures';
import { buildingSpecFor } from '../sim/specs';
import { airCount, airRoom } from '../sim/air';
import type { GameAction, GameState } from '../sim/types';
import { BUILD_KEYS, BuildButton, BuildTipFooter, LineRow, LoadoutPanel, ResearchBlock, StatTip, isPanelTab, menuFor, pressBuild, researchOpen, tabLabel, tabsFor, useTip, type Tab } from './Sidebar';
import { advise, groupLabel, groupOf, groupsFor, keyedList, planList, type Advice, type Group, type Kind } from './buildPlan';
import { advisorOn, advisorPref, buildView, fresh, scouted, seenTab, setAdvisor, setBuildView, useStore } from './buildStores';
import { rulesCatalogue, layoutTree, withExtras, type Catalogue, type ExtraItem } from './techTree';
import { factionOf } from '../sim/specs';
import { iconFor } from './icons';

/** The rail's width, in pixels: the window docks against its right edge, and the map's own furniture moves over by it. */
export const RAIL_W = 76;

/** The art on each list's rail button: the list's first item, or the Command Yard for Structures. */
const RAIL_ICON: Record<Tab, BuildingKind | UnitKind> = {
  building: 'hq',
  infantry: 'rifleman',
  vehicle: 'tank',
  air: 'helipad',
  naval: 'shipyard',
  research: 'researchlab',
  upgrades: 'turret',
};

/** Short names for the rail, which is narrow. */
const RAIL_LABEL: Record<Tab, string> = {
  building: 'Structures',
  infantry: 'Infantry',
  vehicle: 'Vehicles',
  air: 'Air',
  naval: 'Naval',
  research: 'Research',
  upgrades: 'Upgrades',
};

/** How much is under way on a panel tab or a build list: research running, upgrades in hand, or the queue. */
function busyOf(state: GameState, t: Tab): number {
  if (t === 'research') return state.players[0].research ? 1 : 0;
  if (t === 'upgrades') return state.buildings.filter(b => b.owner === 0 && b.hp > 0 && b.upgrade).length;
  return state.players[0].queues[t].length;
}

/** Research on this battle's rail before the Lab stands: greyed, but there, so players know it exists. */
const techComing = (state: GameState): boolean => !researchOpen(state) && techAllowed(state, 0, 'researchlab');

export interface BuildRailProps {
  state: GameState;
  /** The list the hotkeys act on: marked on the rail whether or not the window is open. */
  tab: Tab;
  open: boolean;
  touch: boolean;
  /** A rail button: opens the window on that list, or closes it if that list is already showing. */
  onPick: (t: Tab) => void;
  /** Under the lists: the pinned items (QuickBar in the rail). */
  children?: ReactNode;
}

/**
 * The build rail (desktop): the menu bar down the left edge of the battlefield. Each button is a
 * list; pressing one slides the build window out beside the rail on that list, pressing it again
 * puts the window away. The buttons carry the same ids and markers the window's tabs do on a sheet
 * (`fl-tab-<list>`, a dot for something new, the advisor's ring, the queue length).
 */
export function BuildRail({ state, tab, open, touch, onPick, children }: BuildRailProps) {
  const offered = tabsFor(state);
  // The build lists, then the panels (Tech, Upgrades) under a rule. Tech shows greyed before its Lab.
  const tabs: Tab[] = [...offered.filter(t => !isPanelTab(t)), ...(offered.includes('research') || techComing(state) ? (['research'] as Tab[]) : []), ...offered.filter(t => t === 'upgrades')];
  const shown: Tab = tabs.includes(tab) ? tab : tabs[0];
  const newTabs = useStore(fresh).tabs;
  const advisorChoice = useStore(advisorPref);
  const advice = advisorOn(advisorChoice, state) ? advise(state, scouted(state)) : null;
  return (
    <nav className="fl-rail" aria-label="Build menu" data-testid="build-rail" style={{ width: RAIL_W }}>
      <span className="fl-rail-title" aria-hidden="true">
        Build
      </span>
      <div role="tablist" aria-orientation="vertical" aria-label="Build lists" className="fl-rail-list">
        {tabs.map((t, i) => {
          const producer = t === 'research' ? researchOpen(state) : t === 'upgrades' || hasProducer(state, 0, t);
          const busy = busyOf(state, t);
          const showing = open && shown === t;
          const isNew = newTabs.has(t) && !showing;
          const ruled = isPanelTab(t) && (i === 0 || !isPanelTab(tabs[i - 1]));
          return (
            <Fragment key={t}>
            {ruled && <span className="fl-rail-rule" aria-hidden="true" />}
            <button
              id={`fl-tab-${t}`}
              role="tab"
              type="button"
              className="fl-rail-btn"
              aria-selected={shown === t}
              aria-expanded={showing}
              aria-controls={showing ? 'fl-build-window' : undefined}
              data-open={showing ? '1' : '0'}
              data-producer={producer ? '1' : '0'}
              data-new={isNew ? '1' : '0'}
              data-advice={advice && advice.tab === t && !showing ? '1' : '0'}
              data-testid={`rail-${t}`}
              onClick={() => onPick(t)}
              title={`${tabLabel(t)}${t === 'research' && !researchOpen(state) ? ': build a Research Lab to research' : ''}${isNew ? ': something new unlocked' : ''} (${showing ? 'click again to close' : touch ? 'tap to open' : 'click to open; Tab cycles the lists'})`}
            >
              <img src={iconFor(RAIL_ICON[t])} alt="" width={48} height={32} draggable={false} />
              <span className="fl-rail-label">{RAIL_LABEL[t]}</span>
              {busy > 0 && (
                <span className="fl-rail-busy" aria-label={`${busy} in production`}>
                  {busy}
                </span>
              )}
              {isNew && <span className="fl-rail-new" aria-label="new" />}
            </button>
            </Fragment>
          );
        })}
      </div>
      {children}
    </nav>
  );
}

/**
 * A test-only extra item (`window.__flExtraMenuItem`, one or a list), read in development builds
 * alone. It proves the window lays out a kind it has never seen (scripts/tours/fireline-build-window.cjs).
 */
function readExtras(): ExtraItem[] {
  if (!import.meta.env.DEV) return [];
  const raw = (window as unknown as { __flExtraMenuItem?: unknown }).__flExtraMenuItem;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter(
    (x): x is ExtraItem =>
      !!x &&
      typeof x === 'object' &&
      typeof (x as ExtraItem).kind === 'string' &&
      typeof (x as ExtraItem).name === 'string' &&
      typeof (x as ExtraItem).cost === 'number' &&
      Array.isArray((x as ExtraItem).requires) &&
      ['building', 'infantry', 'vehicle', 'air', 'naval'].includes((x as ExtraItem).tab),
  );
}

export interface BuildWindowProps {
  state: GameState;
  tab: Tab;
  setTab: (t: Tab) => void;
  /** The active structure group (round 8): the one the hotkeys act on. */
  group: Group;
  setGroup: (g: Group) => void;
  dispatch: (a: GameAction) => boolean;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
  touch: boolean;
  /** A full-screen sheet (phones and touch) rather than a panel over the battlefield. */
  sheet: boolean;
  onClose: () => void;
  /** Centre the map on a tile (the Upgrades panel's Show). */
  onLocate?: (x: number, y: number) => void;
}

export default function BuildWindow({ state, tab, setTab, group, setGroup, dispatch, placing, setPlacing, touch, sheet, onClose, onLocate }: BuildWindowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tabs = tabsFor(state);
  // A tab this battle does not offer (Research with its Lab sold) shows the first one instead. Docked,
  // Tech before its Lab opens on how to get one, as the rail offers it.
  const shown: Tab = tabs.includes(tab) || (!sheet && tab === 'research' && techComing(state)) ? tab : tabs[0];

  // ---- Docked against the rail (desktop) ------------------------------------------------------
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (sheet) return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setRoom(r => (r && r.w === parent.clientWidth && r.h === parent.clientHeight ? r : { w: parent.clientWidth, h: parent.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [sheet]);

  // ---- Focus: into the window on open (GameScreen moves it back to the Build button on close) ----
  // Once it is visible: a desktop panel stays hidden until its room is measured, and a hidden
  // element cannot take focus.
  const visible = sheet || !!room;
  const focused = useRef(false);
  useEffect(() => {
    if (!visible || focused.current) return;
    focused.current = true;
    // On a sheet the list's tab; docked, the window's first control (the rail's buttons stay where
    // they are, outside it).
    const el = sheet ? (document.getElementById(`fl-tab-${shown}`) ?? ref.current) : (ref.current?.querySelector<HTMLElement>('[aria-pressed="true"].fl-bw-grp') ?? ref.current);
    el?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pw = powerOf(state, 0);
  const view = useStore(buildView);
  const advisorChoice = useStore(advisorPref);
  const advising = advisorOn(advisorChoice, state);
  const advice = advising ? advise(state, scouted(state)) : null;
  const newTabs = useStore(fresh).tabs;
  // Looking at a tab clears its new-unlock dot.
  useEffect(() => {
    seenTab(shown);
  }, [shown, newTabs]);
  // Docked: the full height of the battlefield, as wide as the view needs. The tech tree wants six
  // tiers side by side; the Build view of Structures a group column and a grid of cards; any other
  // list a grid alone. Never wider than the field leaves beside the rail.
  const free = room ? room.w - RAIL_W - 12 : 0;
  const structures = shown === 'building' && view === 'build';
  const want = shown === 'research' ? 640 : shown === 'upgrades' ? 680 : view === 'tree' ? Math.max(660, Math.round(free * 0.72)) : structures ? 720 : 560;
  const width = Math.max(0, Math.min(free, want));
  const style = sheet ? undefined : room ? { left: RAIL_W, width } : { visibility: 'hidden' as const };
  // Structures' groups, for the column that pops out beside the rail: what each can build now.
  const groups = structures && !sheet ? groupsFor(state) : [];
  const nowPlan = groups.length ? planList(state, menuFor('building', state)) : null;
  const freshKinds = useStore(fresh).kinds;
  // Cascading-menu feel: moving the mouse onto a group and resting a moment pops it out, as a click
  // does. Only for a mouse (a finger or pen taps), and cancelled if the pointer leaves first.
  const hoverTimer = useRef<number | null>(null);
  const cancelHover = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => cancelHover, []);
  // The Tech and Upgrades pop-outs: the line, and the structure kind, chosen in their columns.
  const [line, setLine] = useState<BattleLineId | null>(null);
  const [upKind, setUpKind] = useState<BuildingKind | null>(null);
  // Each list, view and group gets its own key, so a change crossfades in rather than snapping.
  const swapKey = `${shown}|${view}|${groups.length ? group : ''}`;

  return (
    <div
      ref={ref}
      id="fl-build-window"
      className="fl-bw"
      role="dialog"
      aria-label="Build"
      data-testid="build-window"
      data-sheet={sheet ? '1' : '0'}
      data-docked={sheet ? '0' : '1'}
      data-tip-host="1"
      tabIndex={-1}
      style={style}
    >
      <div className="fl-bw-head" data-testid="build-window-head">
        <strong className="fl-bw-title">{sheet ? 'Build' : tabLabel(shown)}</strong>
        <div className="fl-bw-views" role="group" aria-label="View" hidden={isPanelTab(shown)}>
          <button type="button" id="fl-view-build" data-testid="view-build" aria-pressed={view === 'build'} onClick={() => setBuildView('build')}>
            Build
          </button>
          <button type="button" id="fl-view-tree" data-testid="view-tree" aria-pressed={view === 'tree'} onClick={() => setBuildView('tree')}>
            Tech tree
          </button>
        </div>
        <button
          type="button"
          hidden={isPanelTab(shown)}
          className="fl-bw-advisor"
          data-testid="advisor-toggle"
          aria-pressed={advising}
          title="The advisor rings one sensible next item, with its reason on the item's card"
          onClick={() => setAdvisor(!advising)}
        >
          <span className="fl-bw-advisor-lamp" aria-hidden="true" />
          Advisor
        </button>
        <span className="fl-bw-hint">
          {touch ? 'Long press an item for its numbers.' : 'Point at an item for its numbers.'}
        </span>
        <button
          type="button"
          id="fl-build-close"
          data-testid="build-close"
          className="fl-bw-close"
          aria-label="Close the build window"
          title={touch ? 'Close' : 'Close (` or Esc)'}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {sheet && (
      <div role="tablist" className="fl-bw-tabs" aria-label="Build lists">
        {tabs.map(t => {
          const producer = isPanelTab(t) || hasProducer(state, 0, t);
          const busy = busyOf(state, t);
          return (
            <button
              key={t}
              id={`fl-tab-${t}`}
              role="tab"
              type="button"
              className="fl-bw-tab"
              aria-selected={shown === t}
              data-producer={producer ? '1' : '0'}
              data-new={newTabs.has(t) && shown !== t ? '1' : '0'}
              data-advice={advice && advice.tab === t && shown !== t ? '1' : '0'}
              onClick={() => setTab(t)}
              title={`${tabLabel(t)}${newTabs.has(t) && shown !== t ? ': something new unlocked' : ''} (${touch ? 'tap' : 'Tab cycles the lists'})`}
            >
              {tabLabel(t)}
              {busy > 0 && <span className="fl-bw-tab-busy"> ·{busy}</span>}
              {newTabs.has(t) && shown !== t && <span className="fl-bw-tab-new" aria-label="new" />}
            </button>
          );
        })}
      </div>
      )}
      <div className="fl-bw-main" data-split={groups.length ? '1' : '0'}>
      {groups.length > 0 && nowPlan && (
        // The second pop-out: Structures' groups. The one pressed is the one the hotkeys build from,
        // and its items fill the panel beside it.
        <div className="fl-bw-groups" role="group" aria-label="Structure groups" data-testid="build-groups">
          {groups.map(g => {
            const count = nowPlan.now.filter(k => groupOf(k) === g).length;
            const active = g === group;
            const isNew = !active && [...freshKinds.keys()].some(k => groupOf(k) === g && menuFor('building', state).includes(k));
            return (
              <button
                key={g}
                type="button"
                id={`fl-group-${g}`}
                className="fl-bw-grp"
                aria-pressed={active}
                data-new={isNew ? '1' : '0'}
                data-advice={advice && advice.tab === 'building' && groupOf(advice.kind) === g && !active ? '1' : '0'}
                data-testid={`group-btn-${g}`}
                title={active ? 'The hotkeys build from this group' : 'Show this group; the hotkeys build from it (or press Tab)'}
                onClick={() => {
                  cancelHover();
                  setGroup(g);
                }}
                // On a real move only: a layout change that slides a group under a resting mouse
                // (Research's way to its Lab opens Structures under the pointer) must not pick it.
                onPointerMove={e => {
                  if (e.pointerType !== 'mouse' || active || hoverTimer.current !== null) return;
                  hoverTimer.current = window.setTimeout(() => {
                    hoverTimer.current = null;
                    setGroup(g);
                  }, 160);
                }}
                onPointerLeave={cancelHover}
              >
                <span className="fl-bw-grp-name">{groupLabel(g)}</span>
                <span className="fl-bw-grp-count">{count ? `${count} ready to build` : 'nothing yet'}</span>
                {isNew && <span className="fl-rail-new" aria-label="new" />}
              </button>
            );
          })}
        </div>
      )}
      <div className="fl-bw-body fl-scroll" data-testid="build-window-body">
        <div key={swapKey} className="fl-bw-swap">
        {shown === 'research' ? (
          !researchOpen(state) ? (
            <TechLocked
              state={state}
              onShow={() => {
                setGroup(groupOf('researchlab'));
                setTab('building');
              }}
            />
          ) : sheet || researchModeOf(state) !== 'lines' ? (
            <ResearchBlock state={state} dispatch={dispatch} lowPower={pw.low} />
          ) : (
            <TechLines state={state} line={line} setLine={setLine} dispatch={dispatch} lowPower={pw.low} />
          )
        ) : shown === 'upgrades' ? (
          <UpgradesPanel state={state} kind={upKind} setKind={setUpKind} dispatch={dispatch} onLocate={onLocate} docked={!sheet} />
        ) : view === 'build' ? (
          <BuildList
            state={state}
            tab={shown as Category}
            group={group}
            setGroup={setGroup}
            dispatch={dispatch}
            placing={placing}
            setPlacing={setPlacing}
            touch={touch}
            lowPower={pw.low}
            advice={advice}
            only={groups.length ? group : undefined}
            onTree={() => setBuildView('tree')}
          />
        ) : (
          <BuildTab state={state} tab={shown as Category} group={group} dispatch={dispatch} placing={placing} setPlacing={setPlacing} touch={touch} orient={sheet ? 'down' : 'across'} lowPower={pw.low} advice={advice} />
        )}
        </div>
      </div>
      </div>
    </div>
  );
}

/** The hotkey letter for an item: its place in the active list (a structure's group, or the tab). */
function hotkeyFor(state: GameState, tab: Category, group: Group, kind: string): string | undefined {
  if (tab === 'building' && groupOf(kind) !== group) return undefined;
  const i = keyedList(state, tab, group).indexOf(kind as Kind);
  return i >= 0 ? BUILD_KEYS[i] : undefined;
}

/** What the window does when a "no producer" note is due, shared by both views. */
function ProducerNote({ state, tab }: { state: GameState; tab: Category }) {
  if (hasProducer(state, 0, tab)) return null;
  return (
    <p className="fl-bw-note" data-testid="build-note">
      {tab === 'building'
        ? state.mission && !state.players[0].stats.built && !state.buildings.some(b => b.owner === 0)
          ? 'No base in this mission: your units are all you have.'
          : 'Your Command Yard is gone. No new structures can be built.'
        : `Build a ${BUILDINGS[PRODUCER[tab]].name} to unlock this list.`}
    </p>
  );
}

/** The Air tab's room on the helipads, under either view. */
function AirRoom({ state, tab }: { state: GameState; tab: Category }) {
  if (tab !== 'air' || !hasBuilding(state, 0, 'helipad')) return null;
  return (
    <p className="fl-air-room" data-testid="air-room">
      Helipads serve {airRoom(state, 0) + airCount(state, 0)} aircraft; {airCount(state, 0)} built or queued.
    </p>
  );
}

/**
 * The Build view (round 8): what can be built now, then Coming next (one row per structure, or set
 * of structures, whose building unlocks more), then Later.
 */
function BuildList({
  state,
  tab,
  group,
  setGroup,
  dispatch,
  placing,
  setPlacing,
  touch,
  lowPower,
  advice,
  only,
  onTree,
}: {
  state: GameState;
  tab: Category;
  group: Group;
  setGroup: (g: Group) => void;
  dispatch: (a: GameAction) => boolean;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
  touch: boolean;
  lowPower: boolean;
  advice: Advice | null;
  /** Docked Structures: the one group popped out. Every section keeps to its items. */
  only?: Group;
  onTree: () => void;
}) {
  const faction = factionOf(state, 0);
  const cat = rulesCatalogue(faction);
  const menu = menuFor(tab, state);
  const full = planList(state, menu);
  const inGroup = (k: string) => !only || groupOf(k) === only;
  const plan = only
    ? {
        ...full,
        now: full.now.filter(inGroup),
        next: full.next.map(r => ({ ...r, items: r.items.filter(inGroup) })).filter(r => r.items.length > 0),
        later: full.later.filter(inGroup),
      }
    : full;
  const { tip, bind, clear, show } = useTip<BuildingKind | UnitKind>();
  useEffect(clear, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (k: string) => cat.spec(k)?.name ?? k;
  const button = (k: Kind, variant: 'card' | 'mini' | 'chip') => (
    <BuildButton
      key={k}
      state={state}
      tab={tab}
      kind={k}
      hotkey={hotkeyFor(state, tab, group, k)}
      placing={placing}
      setPlacing={setPlacing}
      dispatch={dispatch}
      touch={touch}
      variant={variant}
      advice={!!advice && advice.kind === k}
      tipBind={touch ? {} : bind(k)}
      onLongPress={el => (el ? show(k, el) : clear())}
    />
  );
  const groups = tab === 'building' ? (only ? [only] : groupsFor(state)) : [];
  // Later: folded or open as the viewer last left it on this tab; null until they choose.
  const [laterOpen, setLaterOpen] = useState<boolean | null>(null);
  useEffect(() => setLaterOpen(null), [tab]);
  const q = state.players[0].queues.building;
  /** The button on a Coming next row that builds the structure the row is waiting for. */
  const go = (r: BuildingKind) => {
    const ready = readyStructure(state, 0) === r;
    const underWay = q[0]?.kind === r;
    const busy = q.length > 0 && !underWay;
    const pct = underWay && !ready ? Math.floor((q[0].progress / buildTicksFor(state, 0, r)) * 100) : 0;
    const label = ready ? (placing === r ? 'Placing' : 'Place it') : underWay ? `Building ${pct}%` : `Build ${nameOf(r)}`;
    return (
      <button
        key={r}
        type="button"
        className="fl-next-go"
        data-testid={`next-go-${r}`}
        data-state={ready ? 'ready' : underWay ? 'building' : 'idle'}
        disabled={(busy && !ready) || (underWay && !ready)}
        title={busy ? 'Another structure is under way' : undefined}
        onClick={() => pressBuild(state, 'building', r, placing, dispatch, setPlacing, false)}
      >
        {label}
        {!ready && !underWay && <span className="fl-next-cost"> {costFor(state, 0, r)}</span>}
      </button>
    );
  };
  return (
    <div className="fl-bl" data-testid="build-list">
      <ProducerNote state={state} tab={tab} />
      {tab === 'building' ? (
        groups.map(g => {
          const items = plan.now.filter(k => groupOf(k) === g);
          const active = g === group;
          if (only)
            return (
              <section key={g} className="fl-bl-group" data-group={g} data-active="1" data-testid={`group-${g}`}>
                <h4 className="fl-bl-group-title">
                  {groupLabel(g)}
                  {!touch && <span className="fl-bl-group-keys">Q W E R T Y</span>}
                </h4>
                {items.length > 0 ? <div className="fl-bl-grid">{items.map(k => button(k, 'card'))}</div> : <p className="fl-bl-empty">Nothing in this group can be built yet.</p>}
              </section>
            );
          return (
            <section key={g} className="fl-bl-group" data-group={g} data-active={active ? '1' : '0'} data-testid={`group-${g}`}>
              <button
                type="button"
                className="fl-bl-group-head"
                id={`fl-group-${g}`}
                aria-pressed={active}
                title={active ? 'The hotkeys build from this group' : 'Make this group the one the hotkeys build from (or press Tab)'}
                onClick={() => setGroup(g)}
              >
                {groupLabel(g)}
                {!items.length && <span className="fl-bl-group-none">nothing yet</span>}
                {active && !touch && <span className="fl-bl-group-keys">Q W E R T Y</span>}
              </button>
              {items.length > 0 && <div className="fl-bl-grid">{items.map(k => button(k, 'card'))}</div>}
            </section>
          );
        })
      ) : (
        <section className="fl-bl-group" data-active="1">
          {plan.now.length ? <div className="fl-bl-grid">{plan.now.map(k => button(k, 'card'))}</div> : <p className="fl-bl-empty">Nothing on this list can be built yet.</p>}
        </section>
      )}
      {tab === 'vehicle' && <LoadoutPanel state={state} dispatch={dispatch} />}
      <AirRoom state={state} tab={tab} />
      {plan.next.length > 0 && (
        <section className="fl-bl-next" data-testid="coming-next">
          <h4 className="fl-bl-title">Coming next</h4>
          {plan.next.map(row => (
            <div key={row.needs.join('+')} className="fl-bl-row" data-needs={row.needs.join('+')}>
              <div className="fl-bl-row-head">
                <span className="fl-bl-row-words">
                  {row.needs.map(nameOf).join(' and ')} {row.needs.length > 1 ? 'unlock' : 'unlocks'}{' '}
                  {row.items.length === 1 ? nameOf(row.items[0]) : row.items.length === 2 ? `${nameOf(row.items[0])} and ${nameOf(row.items[1])}` : `${row.items.length} items`}
                </span>
                {row.needs.map(go)}
              </div>
              <div className="fl-bl-minis">{row.items.map(k => button(k, 'mini'))}</div>
            </div>
          ))}
        </section>
      )}
      {plan.later.length > 0 && (
        // Folded while anything nearer is on show; open when Later is all the list has.
        <details className="fl-bl-later" data-testid="later" open={laterOpen ?? (!plan.now.length && !plan.next.length)} onToggle={e => setLaterOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="fl-bl-title">
            Later
            <span className="fl-bl-later-count">
              {plan.later.length} {plan.later.length === 1 ? 'item' : 'items'} further up the tree
            </span>
            <button
              type="button"
              className="fl-bl-tree"
              onClick={e => {
                e.preventDefault();
                onTree();
              }}
            >
              See the tech tree
            </button>
          </summary>
          <div className="fl-bl-chips">{plan.later.map(k => button(k, 'chip'))}</div>
        </details>
      )}
      {tip && (
        <StatTip
          kind={tip.key}
          faction={faction}
          state={state}
          anchor={tip.el}
          research={researchModeOf(state)}
          extra={<BuildTipFooter state={state} tab={tab} kind={tip.key} hotkey={hotkeyFor(state, tab, group, tip.key)} lowPower={lowPower} advice={advice && advice.kind === tip.key ? advice.reason : undefined} />}
        />
      )}
    </div>
  );
}

/** Every structure an item depends on, however far back. */
function chainOf(cat: Catalogue, kind: string): Set<string> {
  const out = new Set<string>([kind]);
  const walk = (k: string) => {
    for (const r of cat.spec(k)?.requires ?? []) {
      if (r === 'hq' || out.has(r)) continue;
      out.add(r);
      walk(r);
    }
  };
  walk(kind);
  return out;
}

/** One build list as a tree: lines only for the chain of the item pointed at. */
function BuildTab({
  state,
  tab,
  group,
  dispatch,
  placing,
  setPlacing,
  touch,
  orient,
  lowPower,
  advice,
}: {
  state: GameState;
  tab: Category;
  group: Group;
  dispatch: (a: GameAction) => boolean;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
  touch: boolean;
  orient: 'across' | 'down';
  lowPower: boolean;
  advice: Advice | null;
}) {
  const extras = readExtras();
  const extraKey = extras.map(x => `${x.tab}:${x.kind}:${x.requires.join('+')}`).join(',');
  const faction = factionOf(state, 0);
  const cat: Catalogue = useMemo(() => withExtras(rulesCatalogue(faction), extras), [extraKey, faction]); // eslint-disable-line react-hooks/exhaustive-deps
  const menu = menuFor(tab, state);
  const items = [...menu, ...extras.filter(x => x.tab === tab).map(x => x.kind)];
  const tree = useMemo(() => layoutTree(cat, items), [cat, items.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const { tip, bind, clear, show } = useTip<BuildingKind | UnitKind>();
  // A tab change swaps the buttons out from under the pointer: drop the card with them.
  useEffect(clear, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const stands = (k: string) => hasBuilding(state, 0, k as BuildingKind);
  const nameOf = (k: string) => cat.spec(k)?.name ?? k;
  // Which items show a "Needs" line: their height changes, so the lines are measured again.
  const lockKey = items.map(k => (cat.spec(k)?.requires ?? []).filter(r => r !== 'hq' && !stands(r)).length).join('');

  // ---- The item pointed at, and its chain -------------------------------------------------------
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => setFocus(null), [tab]);
  const chain = useMemo(() => (focus ? chainOf(cat, focus) : null), [cat, focus]);
  const nodeOf = (t: EventTarget | null) => ((t as HTMLElement | null)?.closest?.('[data-node]') as HTMLElement | null)?.dataset.node ?? null;

  // ---- The lines, measured from the laid-out buttons ---------------------------------------------
  const treeRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ from: string; to: string; d: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const edges = useMemo(() => (chain ? tree.edges.filter(e => chain.has(e.from) && chain.has(e.to)) : []), [chain, tree]);
  const layoutKey = `${tab}|${orient}|${items.join(',')}|${tree.ghosts.join(',')}|${lockKey}|${focus ?? ''}`;
  useLayoutEffect(() => {
    const root = treeRef.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const rectOf = (k: string) => {
        const node = root.querySelector(`[data-node="${k}"]`);
        const el = (node?.firstElementChild as HTMLElement | null) ?? (node as HTMLElement | null);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top };
      };
      const out: { from: string; to: string; d: string }[] = [];
      for (const e of edges) {
        const a = rectOf(e.from);
        const b = rectOf(e.to);
        if (!a || !b) continue;
        let d: string;
        if (orient === 'across') {
          const x1 = a.l;
          const y1 = (a.t + a.b) / 2;
          const x2 = b.r;
          const y2 = (b.t + b.b) / 2;
          const mx = (x1 + x2) / 2;
          d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${mx.toFixed(1)} ${y1.toFixed(1)} ${mx.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        } else {
          const x1 = (a.l + a.r) / 2;
          const y1 = a.t;
          const x2 = (b.l + b.r) / 2;
          const y2 = b.b;
          const my = (y1 + y2) / 2;
          d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${x1.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        }
        out.push({ from: e.from, to: e.to, d });
      }
      setPaths(prev => (prev.length === out.length && prev.every((p, i) => p.d === out[i].d && p.from === out[i].from && p.to === out[i].to) ? prev : out));
      setSize(prev => (prev.w === root.scrollWidth && prev.h === root.scrollHeight ? prev : { w: root.scrollWidth, h: root.scrollHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <ProducerNote state={state} tab={tab} />
      <p className="fl-bw-note fl-tree-help">{touch ? 'Long press an item to trace what it needs.' : 'Point at an item to trace everything it needs.'}</p>
      <div
        ref={treeRef}
        className="fl-tree"
        data-orient={orient}
        // High tiers add two more structure columns: past six the gaps close up so the tree still fits a 1280 window.
        data-cols={tree.columns.length + (tree.ghosts.length > 0 ? 1 : 0) > 6 ? 'many' : 'few'}
        data-testid="build-tree"
        data-focus={focus ?? ''}
        onPointerOver={e => {
          const k = nodeOf(e.target);
          if (k && k !== focus) setFocus(k);
        }}
        onPointerLeave={() => setFocus(null)}
        onFocus={e => {
          const k = nodeOf(e.target);
          if (k) setFocus(k);
        }}
        onBlur={e => {
          if (!treeRef.current?.contains(e.relatedTarget as Node | null)) setFocus(null);
        }}
      >
        <svg className="fl-tree-lines" width={size.w} height={size.h} aria-hidden="true" data-testid="build-lines">
          {paths.map(p => (
            <path key={`${p.from}>${p.to}`} className="fl-tree-line" d={p.d} data-from={p.from} data-to={p.to} data-met={stands(p.to) ? '1' : '0'} />
          ))}
        </svg>
        {tree.ghosts.length > 0 && (
          <div className="fl-tree-col" data-tier="ghost">
            <span className="fl-tree-head">Needs</span>
            <div className="fl-tree-items">
              {tree.ghosts.map(g => (
                <div key={g} className="fl-tree-cell" data-node={g} data-dim={chain && !chain.has(g) ? '1' : '0'}>
                  <div className="fl-tree-ghost" id={`fl-ghost-${g}`} data-met={stands(g) ? '1' : '0'} title={stands(g) ? `You have a ${nameOf(g)}` : `Build a ${nameOf(g)} first`}>
                    <span className="fl-tree-ghost-label">needs</span> {nameOf(g)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tree.columns.map(col => (
          <div key={col.tier} className="fl-tree-col" data-tier={col.tier}>
            <span className="fl-tree-head">Tier {col.tier + 1}</span>
            <div className="fl-tree-items">
              {col.items.map(kind => {
                const index = menu.indexOf(kind as BuildingKind | UnitKind);
                const dim = chain && !chain.has(kind) ? '1' : '0';
                if (index < 0 || !isReal(kind)) return <PreviewItem key={kind} kind={kind} cat={cat} stands={stands} dim={dim} />;
                const k = kind as BuildingKind | UnitKind;
                return (
                  <div key={kind} className="fl-tree-slot" data-dim={dim}>
                    <BuildButton
                      state={state}
                      tab={tab}
                      kind={k}
                      hotkey={hotkeyFor(state, tab, group, k)}
                      placing={placing}
                      setPlacing={setPlacing}
                      dispatch={dispatch}
                      touch={touch}
                      advice={!!advice && advice.kind === k}
                      tipBind={touch ? {} : bind(k)}
                      onLongPress={el => {
                        if (el) {
                          show(k, el);
                          setFocus(k);
                        } else clear();
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {/* Development lines: the vehicle loadouts, under the Vehicles tree (round 5b). */}
      {tab === 'vehicle' && <LoadoutPanel state={state} dispatch={dispatch} />}
      <AirRoom state={state} tab={tab} />
      {tip && (
        <StatTip
          kind={tip.key}
          faction={faction}
          state={state}
          anchor={tip.el}
          research={researchModeOf(state)}
          extra={<BuildTipFooter state={state} tab={tab} kind={tip.key} hotkey={hotkeyFor(state, tab, group, tip.key)} lowPower={lowPower} advice={advice && advice.kind === tip.key ? advice.reason : undefined} />}
        />
      )}
    </>
  );
}

const isReal = (k: string) => rulesCatalogue('meridian').spec(k) !== null;

/**
 * A kind the rules do not know (the test hook's extra item): laid out like any other from its spec,
 * but it cannot be built.
 */
function PreviewItem({ kind, cat, stands, dim }: { kind: string; cat: Catalogue; stands: (k: string) => boolean; dim: string }) {
  const spec = cat.spec(kind);
  const missing = (spec?.requires ?? []).filter(r => r !== 'hq' && !stands(r));
  return (
    <div className="fl-tree-cell" data-node={kind} data-extra="1" data-dim={dim}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <button id={`fl-build-${kind}`} className="fl-build" data-state={missing.length ? 'locked' : 'idle'} disabled style={{ flex: 1, minWidth: 0 }}>
          <span className="fl-tree-preview" aria-hidden="true" />
          <span className="fl-build-name">{spec?.name ?? kind}</span>
          <span className="fl-build-cost">{spec?.cost ?? 0}</span>
        </button>
      </div>
      {missing.length > 0 && <span className="fl-tree-needs">Needs {missing.map(r => cat.spec(r)?.name ?? r).join(', ')}</span>}
    </div>
  );
}

// ---- Tech and Upgrades (2026-11-28): the rail's panels, each with a column that pops out ---------

/** Tech before the Lab stands: what it needs, and the way to it. */
function TechLocked({ state, onShow }: { state: GameState; onShow: () => void }) {
  const name = buildingSpecFor(factionOf(state, 0), 'researchlab').name;
  return (
    <div className="fl-panel-locked" data-testid="tech-locked">
      <h4 className="fl-bl-group-title">Research</h4>
      <p>
        Research needs a {name}. Once it stands, this panel lists every upgrade
        {researchModeOf(state) === 'lines' ? ' line, each from Mk I to a doctrine,' : ''} and what each one does.
      </p>
      <button type="button" className="fl-next-go" data-testid="tech-locked-go" onClick={onShow}>
        Find the {name} in Structures
      </button>
    </div>
  );
}

/** Where a development line stands, in words for its column button. */
function lineStatus(state: GameState, line: BattleLineId): { words: string; running: boolean; choose: boolean } {
  const l = BATTLE_LINES[line];
  const busy = state.players[0].research;
  const nodes = [l.marks[0], l.marks[1], l.fork[0], l.fork[1]];
  if (busy && nodes.includes(busy.id)) {
    const pct = Math.floor((busy.progress / researchTicksOf(state, busy.id)) * 100);
    return { words: `researching, ${pct}%`, running: true, choose: false };
  }
  if (doctrineOf(state, 0, line)) return { words: 'complete', running: false, choose: false };
  if (hasUpgrade(state, 0, l.marks[1])) return { words: 'choose a doctrine', running: false, choose: true };
  if (hasUpgrade(state, 0, l.marks[0])) return { words: 'Mk I done', running: false, choose: false };
  return { words: 'not started', running: false, choose: false };
}

/** Development lines, docked: a column of lines, and the chosen line's nodes beside it. */
function TechLines({
  state,
  line,
  setLine,
  dispatch,
  lowPower,
}: {
  state: GameState;
  line: BattleLineId | null;
  setLine: (l: BattleLineId) => void;
  dispatch: (a: GameAction) => boolean;
  lowPower: boolean;
}) {
  const lines = linesFor(state);
  // The line under way first, else one waiting on a doctrine, else the first.
  const busy = lines.find(l => lineStatus(state, l).running) ?? lines.find(l => lineStatus(state, l).choose) ?? lines[0];
  const shown = line && lines.includes(line) ? line : busy;
  return (
    <div className="fl-pop" data-testid="tech-lines">
      <div className="fl-pop-col" role="group" aria-label="Development lines">
        {lines.map(l => {
          const st = lineStatus(state, l);
          return (
            <button
              key={l}
              type="button"
              id={`fl-line-${l}`}
              className="fl-bw-grp"
              aria-pressed={l === shown}
              data-running={st.running ? '1' : '0'}
              data-choose={st.choose ? '1' : '0'}
              onClick={() => setLine(l)}
            >
              <span className="fl-bw-grp-name">{BATTLE_LINES[l].name}</span>
              <span className="fl-bw-grp-count">{st.words}</span>
            </button>
          );
        })}
      </div>
      <div className="fl-pop-main" key={shown}>
        <h4 className="fl-bl-group-title">
          {BATTLE_LINES[shown].name}
          {state.players[0].research && lowPower && <span className="fl-research-slow">half speed: power low</span>}
        </h4>
        <section className="fl-research" data-mode="lines" aria-label="Research">
          <LineRow state={state} line={shown} dispatch={dispatch} />
        </section>
        <p className="fl-bw-note">One line researches at a time. Mk I, then Mk II, then one of two doctrines for the rest of the battle.</p>
      </div>
    </div>
  );
}

/**
 * Structure upgrades: a column of the kinds you hold that can be raised a level, and beside it each
 * structure of the chosen kind with its level, what the next does, the price and the button.
 */
function UpgradesPanel({
  state,
  kind,
  setKind,
  dispatch,
  onLocate,
  docked,
}: {
  state: GameState;
  kind: BuildingKind | null;
  setKind: (k: BuildingKind) => void;
  dispatch: (a: GameAction) => boolean;
  onLocate?: (x: number, y: number) => void;
  docked: boolean;
}) {
  const f = factionOf(state, 0);
  const mine = state.buildings.filter(b => b.owner === 0 && b.hp > 0 && STRUCTURE_LEVELS[b.kind]);
  const kinds = (Object.keys(STRUCTURE_LEVELS) as BuildingKind[]).filter(k => mine.some(b => b.kind === k));
  const name = (k: BuildingKind) => buildingSpecFor(f, k).name;
  if (!kinds.length)
    return (
      <div className="fl-panel-locked" data-testid="upgrades-none">
        <h4 className="fl-bl-group-title">Upgrades</h4>
        <p>
          None of your structures can be raised yet. These have levels:{' '}
          {(Object.keys(STRUCTURE_LEVELS) as BuildingKind[])
            .filter(k => k === 'hq' || menuFor('building', state).includes(k))
            .map(name)
            .join(', ')}
          . Build one and it appears here.
        </p>
      </div>
    );
  const ready = (k: BuildingKind) => mine.filter(b => b.kind === k && !upgradeProblem(state, 0, b.id)).length;
  const working = (k: BuildingKind) => mine.filter(b => b.kind === k && b.upgrade).length;
  const shown = kind && kinds.includes(kind) ? kind : (kinds.find(k => working(k)) ?? kinds.find(k => ready(k)) ?? kinds[0]);
  const rows = mine.filter(b => b.kind === shown);
  const list = (
    <div className="fl-up-list">
      {rows.map((b, i) => {
        const lv = levelOf(b);
        const next = nextLevelOf(b);
        const price = upgradePrice(state, b);
        const problem = upgradeProblem(state, 0, b.id);
        const pct = b.upgrade && next ? Math.floor((b.upgrade.progress / next.ticks) * 100) : 0;
        return (
          <div key={b.id} className="fl-up-row" data-testid={`upgrade-row-${b.id}`} data-state={b.upgrade ? 'running' : next ? (problem ? 'blocked' : 'ready') : 'done'}>
            <div className="fl-up-top">
              <strong>
                {name(b.kind)} {rows.length > 1 ? i + 1 : ''}
              </strong>
              <span className="fl-up-level">
                Level {lv} of {maxLevelOf(b.kind)}
              </span>
              {onLocate && (
                <button type="button" className="fl-up-show" onClick={() => onLocate(b.x + 0.5, b.y + 0.5)} title="Centre the map on it">
                  Show
                </button>
              )}
            </div>
            {next ? (
              <>
                <span className="fl-up-next">
                  Next: <b>{next.name}</b>, {next.blurb}.
                </span>
                {b.upgrade ? (
                  <div className="fl-up-act">
                    <div className="fl-research-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <button type="button" className="fl-research-btn" data-kind="cancel" data-testid={`upgrade-cancel-${b.id}`} onClick={() => dispatch({ type: 'cancelUpgrade', id: b.id })}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="fl-up-act">
                    <button
                      type="button"
                      className="fl-research-btn"
                      data-testid={`upgrade-go-${b.id}`}
                      disabled={!!problem}
                      onClick={() => dispatch({ type: 'upgradeStructure', id: b.id })}
                    >
                      Upgrade {price.credits}
                      {price.alloys ? ` + ${price.alloys} alloys` : ''}
                    </button>
                    {problem && <span className="fl-up-why">{problem}</span>}
                  </div>
                )}
              </>
            ) : (
              <span className="fl-up-next">Fully upgraded.</span>
            )}
          </div>
        );
      })}
      <p className="fl-bw-note">Paid now, refunded in full if you cancel. A structure keeps working while it is raised, but takes a quarter more damage until the work is done.</p>
    </div>
  );
  if (!docked)
    return (
      <div className="fl-bl" data-testid="upgrades">
        {kinds.map(k => (
          <section key={k} className="fl-bl-group">
            <h4 className="fl-bl-group-title">{name(k)}</h4>
            {k === shown ? list : (
              <button type="button" className="fl-next-go" onClick={() => setKind(k)}>
                {ready(k)} ready to upgrade
              </button>
            )}
          </section>
        ))}
      </div>
    );
  return (
    <div className="fl-pop" data-testid="upgrades">
      <div className="fl-pop-col" role="group" aria-label="Structures with upgrades">
        {kinds.map(k => {
          const n = mine.filter(b => b.kind === k).length;
          const r = ready(k);
          const w = working(k);
          return (
            <button key={k} type="button" id={`fl-upkind-${k}`} className="fl-bw-grp" aria-pressed={k === shown} data-running={w ? '1' : '0'} onClick={() => setKind(k)}>
              <span className="fl-bw-grp-name">{name(k)}</span>
              <span className="fl-bw-grp-count">{w ? `${w} upgrading` : r ? `${r} of ${n} can upgrade` : `${n} built`}</span>
            </button>
          );
        })}
      </div>
      <div className="fl-pop-main" key={shown}>
        <h4 className="fl-bl-group-title">{name(shown)}</h4>
        {list}
      </div>
    </div>
  );
}
