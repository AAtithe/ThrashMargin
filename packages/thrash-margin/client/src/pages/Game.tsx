/**
 * The game screen: the board on the left, a tabbed sidebar on the right (a bottom sheet on a
 * phone), and a top bar with the treasury, actions left, undo and End turn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CAMPAIGN_SCENARIOS, FACTION_COLORS, UNLIMITED_AP, defenceOf, explain, factionName, incomeOf,
  presetConfig, visibleTo, type GameAction, type GameState,
} from 'shared/sim';
import Icon from '../components/Icon';
import LogPanel from '../components/LogPanel';
import MapView, { type MapMarks } from '../components/MapView';
import {
  Coach, DispatchModal, EventModal, HelpModal, LedgerModal, PassScreen, VictoryScreen, reportHasNews,
} from '../components/Modals';
import { AttackOrders, MoveOrders } from '../components/OrdersPanel';
import RealmPanel from '../components/RealmPanel';
import ResearchPanel from '../components/ResearchPanel';
import TerritoryPanel from '../components/TerritoryPanel';
import { Button, Chip } from '../components/ui';
import { marksFor, orderKind, suggestColumns, undoable } from '../game/plan';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { FONT, UI } from '../theme';

type Tab = 'command' | 'realm' | 'research' | 'log';

export default function Game() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const game = useGameHybrid();
  const { state, loadGame } = game;

  const [selected, setSelected] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [columns, setColumns] = useState<Map<number, number>>(new Map());
  const [tab, setTab] = useState<Tab>('command');
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [modal, setModal] = useState<'ledger' | 'help' | null>(null);
  const [seenDispatch, setSeenDispatch] = useState<string | null>(null);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: number; x: number; y: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const [endHidden, setEndHidden] = useState(false);
  const prevOwners = useRef<number[] | null>(null);

  useEffect(() => { if (id) void loadGame(id); }, [id, loadGame]);

  // Territories that changed hands since the last render flash once.
  useEffect(() => {
    if (!state) return;
    const owners = state.nodes.map(n => n.owner);
    const prev = prevOwners.current;
    prevOwners.current = owners;
    if (!prev || prev.length !== owners.length) return;
    const changed = new Set(owners.map((o, i) => (o !== prev[i] ? i : -1)).filter(i => i >= 0));
    if (!changed.size) return;
    setFlash(changed);
    const t = window.setTimeout(() => setFlash(new Set()), 1100);
    return () => window.clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const visible = useMemo(() => (state ? visibleTo(state, state.activeFaction) : new Set<number>()), [state]);

  const clear = useCallback(() => { setSelected(null); setTarget(null); setColumns(new Map()); }, []);

  const act = useCallback((action: GameAction) => {
    if (!state) return;
    const why = explain(state, action);
    const before = state;
    const next = game.dispatch(action);
    if (!next) { setToast(why ?? 'That cannot be done right now.'); return; }
    if (action.type !== 'END_TURN' && undoable(action)) setUndoStack(s => [...s, before].slice(-20));
    else setUndoStack([]);
    if (action.type === 'ATTACK' || action.type === 'MOVE' || action.type === 'ANNEX') {
      setTarget(null);
      setColumns(new Map());
      const sel = selected !== null ? next.nodes[selected] : null;
      if (!sel || sel.owner !== next.activeFaction) setSelected(null);
    }
    if (action.type === 'END_TURN') { clear(); setTab('command'); }
  }, [state, game, selected, clear]);

  const undo = useCallback(() => {
    setUndoStack(s => {
      if (!s.length) return s;
      game.restore(s[s.length - 1]);
      return s.slice(0, -1);
    });
    setTarget(null);
    setColumns(new Map());
  }, [game]);

  const endTurn = useCallback(() => act({ type: 'END_TURN' }), [act]);

  const pick = useCallback((nid: number | null) => {
    if (!state) return;
    if (nid === null) { clear(); return; }
    const me = state.activeFaction;
    const n = state.nodes[nid];
    setTab('command');
    setSheetOpen(true);
    if (nid === selected) { clear(); return; }
    if (selected !== null && state.nodes[selected].owner === me) {
      const marks = marksFor(state, selected, null, new Map());
      if (n.owner !== me && marks.attack.has(nid)) {
        setTarget(nid);
        setColumns(suggestColumns(state, selected, nid));
        return;
      }
      if (n.owner === me && marks.move.has(nid) && state.nodes[selected].troops > 1) {
        setTarget(nid);
        return;
      }
    }
    setSelected(nid);
    setTarget(null);
    setColumns(new Map());
  }, [state, selected, clear]);

  const planAssault = useCallback((nid: number) => {
    if (!state) return;
    const me = state.activeFaction;
    const borders = state.edges.flatMap(([a, b]) => (a === nid ? [b] : b === nid ? [a] : []))
      .filter(m => state.nodes[m].owner === me)
      .sort((a, b) => state.nodes[b].troops - state.nodes[a].troops);
    if (!borders.length) return;
    setSelected(borders[0]);
    setTarget(nid);
    setColumns(suggestColumns(state, borders[0], nid));
  }, [state]);

  // Keyboard: Esc clears, E ends the turn, Z undoes, L ledger, ? help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { if (!modal) clear(); }
      else if (e.key === 'e' || e.key === 'E') { if (!modal && state?.status === 'active' && !state.pendingEvent) endTurn(); }
      else if (e.key === 'z' || e.key === 'Z') undo();
      else if (e.key === 'l' || e.key === 'L') setModal(m => (m === 'ledger' ? null : 'ledger'));
      else if (e.key === '?') setModal(m => (m === 'help' ? null : 'help'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear, endTurn, undo, modal, state]);

  const nextAct = useCallback(async () => {
    if (!state || state.config.campaignScenario === undefined) return;
    const next = CAMPAIGN_SCENARIOS[state.config.campaignScenario + 1];
    if (!next) return;
    const newId = await game.createGame(presetConfig(next.diff, {
      mapId: next.mapId,
      campaignScenario: next.index,
      campaignBonusGold: next.bonusGold,
      campaignBonusTechs: next.bonusTechs,
    }), next.title);
    if (newId) nav(`/game/${newId}`);
  }, [state, game, nav]);

  if (!state) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: UI.textSoft }}>
        <div>{game.error ?? (game.loading ? 'Loading the campaign…' : 'Campaign not found.')}</div>
        <Button tone="quiet" onClick={() => nav('/')}>Back to the lobby</Button>
      </div>
    );
  }

  const me = state.activeFaction;
  const f = state.factions[me];
  const inc = incomeOf(state, me);
  const over = state.status !== 'active';
  const hotseat = state.config.hotseat && Object.values(state.factions).filter(x => x.human && !x.eliminated).length > 1;
  const turnKey = `${state.turn}-${me}`;
  const needPass = hotseat && !over && readyFor !== turnKey && (state.turn > 1 || me !== 1);
  const report = state.reports[me];
  const showDispatch = !needPass && !over && !state.pendingEvent && seenDispatch !== turnKey && reportHasNews(report);
  const kind = orderKind(state, selected, target);
  const marks: MapMarks = { ...marksFor(state, selected, target, columns), hit: new Set(report?.attacksSuffered.map(a => a.target) ?? []) };
  const sel = selected !== null ? state.nodes[selected] : null;
  const unlimited = state.actionsLeft >= UNLIMITED_AP;
  const showDiplomacy = state.config.enableDiplomacy || state.config.enableSpies;
  const fc = FACTION_COLORS[me];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, overflow: 'hidden' }}>
      {/* ── Top bar ── */}
      <header className="tm-topbar" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, padding: '8px 14px', background: UI.panel, borderBottom: `1px solid ${UI.rule}`, flexShrink: 0 }}>
        <button type="button" onClick={() => nav('/')} title="Back to the lobby" style={{ background: 'none', border: 'none', color: UI.textSoft, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}>
          <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><Icon name="next" /></span>
          <span className="tm-hide-mobile" style={{ fontFamily: FONT.display, fontSize: 16, color: UI.text, fontWeight: 600 }}>Thrash Margin</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: fc.fill, border: `1px solid ${fc.edge}` }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Turn {state.turn}</span>
          {hotseat && <span className="tm-hide-mobile" style={{ fontSize: 12, color: UI.textSoft }}>{factionName(state, me)}</span>}
        </div>
        <ApPips left={state.actionsLeft} max={unlimited ? 0 : Math.max(state.actionsLeft, state.config.apPerTurn)} unlimited={unlimited} />
        <div className="tm-chips" style={{ display: 'flex', alignItems: 'center', gap: 14, overflowX: 'auto', flex: 1, minWidth: 0 }}>
          <Chip kind="gold" value={f.resources.gold} rate={inc.gold} />
          <Chip kind="food" value={f.resources.food} rate={inc.foodNet} title={`Food: grow ${inc.food}, troops eat ${inc.upkeep}`} />
          <Chip kind="mat" value={f.resources.mat} rate={inc.mat} />
          {showDiplomacy && <Chip kind="influence" value={f.resources.influence} rate={inc.influence} />}
          {(f.resources.population > 0 || inc.population > 0) && <Chip kind="pop" value={f.resources.population} rate={inc.population} />}
        </div>
        <span className="tm-spacer" />
        <SaveBadge status={game.saveStatus} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <IconButton icon="ledger" label="Ledger (L)" onClick={() => setModal('ledger')} />
          <IconButton icon="help" label="How to play (?)" onClick={() => setModal('help')} />
          <IconButton icon="undo" label={undoStack.length ? 'Undo (Z)' : 'Nothing to undo'} onClick={undo} disabled={!undoStack.length || over} />
          {over && endHidden && <Button tone="quiet" onClick={() => setEndHidden(false)}>Results</Button>}
          <Button tone="primary" icon="next" onClick={endTurn} disabled={over || !!state.pendingEvent}
            title={state.pendingEvent ? `Answer "${state.pendingEvent.title}" first` : 'End your turn (E)'}>
            <span className="tm-hide-mobile">End turn</span>
          </Button>
        </div>
      </header>

      {state.lastEvent && !over && (
        <div style={{ padding: '6px 14px', fontSize: 12, background: UI.panelSunk, borderBottom: `1px solid ${UI.rule}`, color: UI.textSoft, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: state.lastEvent.tone === 'positive' ? UI.good : state.lastEvent.tone === 'negative' ? UI.bad : UI.accent }} />
          <b style={{ color: UI.text }}>{state.lastEvent.title}.</b> {state.lastEvent.message}
        </div>
      )}

      <div className="tm-body" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <MapView
          state={state} visible={visible} selected={selected} target={target} marks={marks} flash={flash}
          onPick={pick} onHover={(nid, x, y) => setHover(nid === null ? null : { id: nid, x, y })}
          focus={target ?? selected}
        />

        {/* ── Sidebar ── */}
        <aside className={`tm-sidebar${sheetOpen ? ' open' : ''}`} style={{ width: 360, flexShrink: 0, background: UI.panel, borderLeft: `1px solid ${UI.rule}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="tm-sheet-handle" onClick={() => setSheetOpen(v => !v)}
            style={{ alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${UI.rule}`, cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{sel ? sel.name : 'Your realm'}</span>
            <span style={{ transform: sheetOpen ? 'rotate(90deg)' : 'rotate(-90deg)', display: 'inline-flex', color: UI.textSoft }}><Icon name="next" /></span>
          </div>
          <nav style={{ display: 'flex', borderBottom: `1px solid ${UI.rule}`, flexShrink: 0 }}>
            {([['command', sel ? 'Orders' : 'Overview'], ['realm', 'Realm'], ...(state.config.enableTechTree ? [['research', 'Research']] : []), ['log', 'Chronicle']] as Array<[Tab, string]>).map(([t, label]) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                style={{ flex: 1, padding: '10px 4px', background: 'none', border: 'none', borderBottom: `2px solid ${tab === t ? UI.accent : 'transparent'}`, color: tab === t ? UI.text : UI.textSoft, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </nav>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'grid', alignContent: 'start', gap: 10 }}>
            {state.config.mapId === 'tutorial' && !over && tab === 'command' && <Coach state={state} selected={selected} target={target} />}
            {tab === 'command' && (
              kind === 'attack' && selected !== null && target !== null ? (
                <AttackOrders state={state} target={target} visible={visible.has(target)} columns={columns} setColumns={setColumns} act={act} onCancel={() => { setTarget(null); setColumns(new Map()); }} />
              ) : kind === 'move' && selected !== null && target !== null ? (
                <MoveOrders state={state} selected={selected} target={target} act={act} onCancel={() => setTarget(null)} />
              ) : sel ? (
                <TerritoryPanel state={state} node={sel} visible={visible.has(sel.id)} act={act} onPlanAssault={planAssault} />
              ) : (
                <RealmPanel state={state} act={act} onJump={nid => pick(nid)} />
              )
            )}
            {tab === 'realm' && <RealmPanel state={state} act={act} onJump={nid => pick(nid)} />}
            {tab === 'research' && <ResearchPanel state={state} act={act} />}
            {tab === 'log' && <LogPanel state={state} />}
          </div>
        </aside>
      </div>

      {hover && !sheetOpen && <HoverCard state={state} id={hover.id} x={hover.x} y={hover.y} seen={visible.has(hover.id)} />}
      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', background: UI.panelRaised, border: `1px solid ${UI.warn}`, color: UI.text, padding: '9px 14px', borderRadius: 8, fontSize: 13, zIndex: 250, maxWidth: '90vw' }}>
          {toast}
        </div>
      )}
      {game.error && state && (
        <div role="alert" style={{ position: 'fixed', left: 12, bottom: 12, background: '#2e1d1b', border: `1px solid ${UI.bad}`, color: '#f3c6c1', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, zIndex: 250, maxWidth: 420 }}>{game.error}</div>
      )}

      {needPass && <PassScreen state={state} onReady={() => setReadyFor(turnKey)} />}
      {!needPass && state.pendingEvent && !over && <EventModal state={state} event={state.pendingEvent} act={act} />}
      {showDispatch && report && <DispatchModal state={state} report={report} onClose={() => setSeenDispatch(turnKey)} />}
      {over && !endHidden && <VictoryScreen state={state} onLobby={() => nav('/')} onNext={nextAct} onClose={() => setEndHidden(true)} />}
      {modal === 'ledger' && <LedgerModal state={state} onClose={() => setModal(null)} onPick={nid => pick(nid)} />}
      {modal === 'help' && <HelpModal onClose={() => setModal(null)} />}
    </div>
  );
}

function ApPips({ left, max, unlimited }: { left: number; max: number; unlimited: boolean }) {
  if (unlimited) return <Chip kind="ap" value="∞" title="Unlimited actions" />;
  return (
    <div title={`${left} of ${max} actions left`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Icon name="ap" color={UI.ap} size={15} />
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ width: 9, height: 9, borderRadius: 2, background: i < left ? UI.ap : 'transparent', border: `1px solid ${i < left ? UI.ap : UI.ruleStrong}` }} />
      ))}
    </div>
  );
}

function IconButton({ icon, label, onClick, disabled }: { icon: 'ledger' | 'help' | 'undo'; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="tm-btn" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      style={{ width: 32, height: 32, borderRadius: 7, background: UI.panelRaised, border: `1px solid ${UI.ruleStrong}`, color: UI.text, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={15} />
    </button>
  );
}

function SaveBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    saving: ['Saving', UI.textFaint],
    saved: ['Saved', UI.textFaint],
    error: ['Not saved', UI.bad],
    idle: ['', UI.textFaint],
  };
  const [text, color] = map[status] ?? map.idle;
  if (!text) return null;
  return <span className="tm-hide-mobile" style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>{text}</span>;
}

function HoverCard({ state, id, x, y, seen }: { state: GameState; id: number; x: number; y: number; seen: boolean }) {
  const n = state.nodes[id];
  const fc = FACTION_COLORS[n.owner] ?? FACTION_COLORS[0];
  const left = Math.min(x + 14, window.innerWidth - 220);
  return (
    <div className="tm-hide-mobile" style={{ position: 'fixed', left, top: y + 14, zIndex: 120, pointerEvents: 'none', background: UI.panel, border: `1px solid ${UI.ruleStrong}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: fc.fill }} />{n.name}
      </div>
      <div style={{ color: UI.textSoft, marginTop: 2 }}>{n.owner === 0 ? 'Neutral' : factionName(state, n.owner)}</div>
      {seen ? (
        <div style={{ marginTop: 4, color: UI.text }}>{n.troops} troops · defence {defenceOf(n, state.factions[n.owner]?.research ?? [])}{n.buildings.length ? ` · ${n.buildings.length} building${n.buildings.length === 1 ? '' : 's'}` : ''}</div>
      ) : <div style={{ marginTop: 4, color: UI.textFaint }}>Unseen</div>}
    </div>
  );
}
