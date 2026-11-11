/**
 * The build window: the tech tree, popped out of the sidebar (fireline-round5-design.md, section 3).
 *
 * Desktop: a panel over the battlefield (never over the sidebar), dragged by its title bar, its
 * place remembered per viewer. Phones and touch: a full-screen sheet. Either way it is not modal:
 * the battle keeps running, and on a desktop the map outside it stays clickable.
 *
 * Each tab lays its items out by tier (techTree.ts) with a line from each item to every structure
 * it needs; a structure on another tab shows as a small ghost node at the start of the tab, so
 * every line has both ends. Everything comes from rules.ts: no kind is named here.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BUILDINGS, PRODUCER, type BuildingKind, type Category, type UnitKind } from '../sim/rules';
import { hasBuilding, hasProducer, powerOf } from '../sim/state';
import { airCount, airRoom } from '../sim/air';
import type { GameAction, GameState } from '../sim/types';
import { BUILD_KEYS, BuildButton, BuildTipFooter, ResearchBlock, StatTip, menuFor, tabLabel, tabsFor, useTip, type Tab } from './Sidebar';
import { RULES_CATALOGUE, layoutTree, withExtras, type Catalogue, type ExtraItem } from './techTree';

const POS_KEY = 'fl_build_window';

/** Where the viewer last left the window, as a fraction of the room it can move in. */
interface Spot {
  fx: number;
  fy: number;
}

function loadSpot(): Spot | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null');
    if (v && typeof v.fx === 'number' && typeof v.fy === 'number' && Number.isFinite(v.fx) && Number.isFinite(v.fy))
      return { fx: Math.max(0, Math.min(1, v.fx)), fy: Math.max(0, Math.min(1, v.fy)) };
  } catch {
    /* Blocked or spoiled storage: the default place. */
  }
  return null;
}

function saveSpot(s: Spot): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(s));
  } catch {
    /* Blocked storage: the window opens in its default place next time. */
  }
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
  dispatch: (a: GameAction) => boolean;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
  touch: boolean;
  /** A full-screen sheet (phones and touch) rather than a panel over the battlefield. */
  sheet: boolean;
  onClose: () => void;
}

export default function BuildWindow({ state, tab, setTab, dispatch, placing, setPlacing, touch, sheet, onClose }: BuildWindowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tabs = tabsFor(state);
  // A tab this battle does not offer (Research with its Lab sold) shows the first one instead.
  const shown: Tab = tabs.includes(tab) ? tab : tabs[0];

  // ---- Place and drag (desktop) ---------------------------------------------------------------
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  const [spot, setSpot] = useState<Spot | null>(loadSpot);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
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
  // About 60% of the battlefield wide (never narrower than the tree needs, if the field allows),
  // at most 80% of it tall.
  const width = room ? Math.round(Math.min(room.w - 16, Math.max(room.w * 0.6, Math.min(560, room.w - 16)))) : 0;
  const maxHeight = room ? Math.round(room.h * 0.8) : 0;
  const height = ref.current?.offsetHeight ?? maxHeight;
  const freeX = room ? Math.max(0, room.w - width) : 0;
  const freeY = room ? Math.max(0, room.h - height) : 0;
  // First time: the centre of the battlefield, a little below the top banners.
  const at = spot ?? { fx: 0.5, fy: 0.25 };
  const left = Math.round(freeX * at.fx);
  const top = Math.round(freeY * at.fy);

  const onHeadDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (sheet || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, dx: e.clientX - left, dy: e.clientY - top };
  };
  const onHeadMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const x = Math.max(0, Math.min(freeX, e.clientX - d.dx));
    const y = Math.max(0, Math.min(freeY, e.clientY - d.dy));
    setSpot({ fx: freeX ? x / freeX : 0, fy: freeY ? y / freeY : 0 });
  };
  const onHeadUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (spot) saveSpot(spot);
  };

  // ---- Focus: into the window on open (GameScreen moves it back to the Build button on close) ----
  // Once it is visible: a desktop panel stays hidden until its room is measured, and a hidden
  // element cannot take focus.
  const visible = sheet || !!room;
  const focused = useRef(false);
  useEffect(() => {
    if (!visible || focused.current) return;
    focused.current = true;
    const el = document.getElementById(`fl-tab-${shown}`) ?? ref.current;
    el?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pw = powerOf(state, 0);
  const style = sheet
    ? undefined
    : room
      ? { left, top, width, maxHeight }
      : { visibility: 'hidden' as const };

  return (
    <div
      ref={ref}
      id="fl-build-window"
      className="fl-bw"
      role="dialog"
      aria-label="Build"
      data-testid="build-window"
      data-sheet={sheet ? '1' : '0'}
      data-tip-host="1"
      tabIndex={-1}
      style={style}
    >
      <div className="fl-bw-head" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp} data-testid="build-window-head">
        <strong className="fl-bw-title">Build</strong>
        <span className="fl-bw-hint">
          {touch ? 'Long press an item for its numbers.' : 'Drag here to move. Hover an item for its numbers.'}
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
      <div role="tablist" className="fl-bw-tabs" aria-label="Build lists">
        {tabs.map(t => {
          const producer = t === 'research' || hasProducer(state, 0, t);
          const busy = t === 'research' ? (state.players[0].research ? 1 : 0) : state.players[0].queues[t].length;
          return (
            <button
              key={t}
              id={`fl-tab-${t}`}
              role="tab"
              type="button"
              className="fl-bw-tab"
              aria-selected={shown === t}
              data-producer={producer ? '1' : '0'}
              onClick={() => setTab(t)}
              title={`${tabLabel(t)} (${touch ? 'tap' : 'Tab cycles the lists'})`}
            >
              {tabLabel(t)}
              {busy > 0 && <span className="fl-bw-tab-busy"> ·{busy}</span>}
            </button>
          );
        })}
      </div>
      <div className="fl-bw-body fl-scroll" data-testid="build-window-body">
        {shown === 'research' ? (
          <ResearchBlock state={state} dispatch={dispatch} lowPower={pw.low} />
        ) : (
          <BuildTab state={state} tab={shown} dispatch={dispatch} placing={placing} setPlacing={setPlacing} touch={touch} orient={sheet ? 'down' : 'across'} lowPower={pw.low} />
        )}
      </div>
    </div>
  );
}

/** One build list as a tree. */
function BuildTab({
  state,
  tab,
  dispatch,
  placing,
  setPlacing,
  touch,
  orient,
  lowPower,
}: {
  state: GameState;
  tab: Category;
  dispatch: (a: GameAction) => boolean;
  placing: BuildingKind | null;
  setPlacing: (k: BuildingKind | null) => void;
  touch: boolean;
  orient: 'across' | 'down';
  lowPower: boolean;
}) {
  const extras = readExtras();
  const extraKey = extras.map(x => `${x.tab}:${x.kind}:${x.requires.join('+')}`).join(',');
  const cat: Catalogue = useMemo(() => withExtras(RULES_CATALOGUE, extras), [extraKey]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // ---- The lines, measured from the laid-out buttons ---------------------------------------------
  const treeRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ from: string; to: string; d: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const layoutKey = `${tab}|${orient}|${items.join(',')}|${tree.ghosts.join(',')}|${lockKey}`;
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
      for (const e of tree.edges) {
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
      {!hasProducer(state, 0, tab) && (
        <p className="fl-bw-note" data-testid="build-note">
          {tab === 'building'
            ? state.mission && !state.players[0].stats.built && !state.buildings.some(b => b.owner === 0)
              ? 'No base in this mission: your units are all you have.'
              : 'Your Command Yard is gone. No new structures can be built.'
            : `Build a ${BUILDINGS[PRODUCER[tab]].name} to unlock this list.`}
        </p>
      )}
      <div ref={treeRef} className="fl-tree" data-orient={orient} data-testid="build-tree">
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
                <div key={g} className="fl-tree-cell" data-node={g}>
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
                if (index < 0 || !isReal(kind)) return <PreviewItem key={kind} kind={kind} cat={cat} stands={stands} />;
                const k = kind as BuildingKind | UnitKind;
                return (
                  <BuildButton
                    key={kind}
                    state={state}
                    tab={tab}
                    kind={k}
                    hotkey={BUILD_KEYS[index]}
                    placing={placing}
                    setPlacing={setPlacing}
                    dispatch={dispatch}
                    touch={touch}
                    tipBind={touch ? {} : bind(k)}
                    onLongPress={el => (el ? show(k, el) : clear())}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {tab === 'air' && hasBuilding(state, 0, 'helipad') && (
        <p className="fl-air-room" data-testid="air-room">
          Helipads serve {airRoom(state, 0) + airCount(state, 0)} aircraft; {airCount(state, 0)} built or queued.
        </p>
      )}
      {tip && (
        <StatTip
          kind={tip.key}
          anchor={tip.el}
          extra={<BuildTipFooter state={state} tab={tab} kind={tip.key} hotkey={BUILD_KEYS[menu.indexOf(tip.key)]} lowPower={lowPower} />}
        />
      )}
    </>
  );
}

const isReal = (k: string) => RULES_CATALOGUE.spec(k) !== null;

/**
 * A kind the rules do not know (the test hook's extra item): laid out like any other from its spec,
 * but it cannot be built.
 */
function PreviewItem({ kind, cat, stands }: { kind: string; cat: Catalogue; stands: (k: string) => boolean }) {
  const spec = cat.spec(kind);
  const missing = (spec?.requires ?? []).filter(r => r !== 'hq' && !stands(r));
  return (
    <div className="fl-tree-cell" data-node={kind} data-extra="1">
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
