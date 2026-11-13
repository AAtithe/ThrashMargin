import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { sourcesFor, planRoute, depotName } from '../sim/content';
import { SEASON_NAMES, planFastestRoute, roundsLeftInSeason, seasonOf, gameYear } from '../sim/weather';
import { destinationOf } from '../sim/movement';
import { DECLARATION_TURNS, SHARE_MAJORITY, VICTORY_CASH } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import MapView from '../components/MapView';
import ContractBoard from '../components/ContractBoard';
import FleetPanel from '../components/FleetPanel';
import DepotPanel from '../components/DepotPanel';
import CountingHouse from '../components/CountingHouse';
import DepotLedger from '../components/DepotLedger';
import RivalFleets from '../components/RivalFleets';
import EventCards from '../components/EventCards';
import NewsBanner from '../components/NewsBanner';
import { vehiclesAwaitingOrders } from '../sim/attention';
import HauliersTable from '../components/HauliersTable';
import ChronicleLog, { LogAnnouncer } from '../components/ChronicleLog';
import HandoverCard from '../components/HandoverCard';
import { Button, bodySmall, buttonClass, dataText } from '../components/ui';
import type { Contract, DepotId, GameState, Vehicle } from '../sim/types';
import GuidedTour, { hasSeenGuidedTour, planFirstRun, type TourPlan } from '../components/GuidedTour';
import { paced, signed, usePace, useSkipOnInput, useSteps, useTween } from '../lib/motion';
import { recordAiTurns, replayHolds, type ReplayFrame } from '../hooks/aiReplay';
import { CountUp, DiceTray, Enter, MoneyFloats, ReplayStrip } from '../components/Motion';
import type { MapFloat } from '../components/MapView';

const NO_HOLDS: number[] = [];
/** How long the dice tumble after your own roll, at full pace. */
const TUMBLE_MS = 560;
/** How long a payout floats over its depot at full pace: the life of the shared `tm-anim-float`. */
const MAP_FLOAT_MS = 1100;
import ThemeToggle from '../components/ThemeToggle';
import MotionToggle from '../components/MotionToggle';
import { LoadingScreen, SIGN_IN_AGAIN } from '../lib/Loading';
import { SESSION_EXPIRED } from '../hooks/useGameCloud';
import { clearToken } from '../lib/portalAuth';

export default function GameScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, error, loadGame, dispatch } = useGameHybrid();

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [targetDepot, setTargetDepot] = useState<DepotId | null>(null);
  const [focusedContract, setFocusedContract] = useState<Contract | null>(null);

  useEffect(() => {
    if (id && (!state || state.id !== id)) loadGame(id);
    // loadGame is stable per hook; re-running on every state change would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const haulier = state?.hauliers[state.activeIndex] ?? null;
  const myVehicles = useMemo(
    () => (state && haulier ? state.vehicles.filter(s => s.ownerId === haulier.id) : []),
    [state, haulier],
  );

  // Keep a sensible vehicle selected as turns pass, without fighting the player's own choice.
  useEffect(() => {
    if (!haulier) return;
    if (selectedVehicleId && myVehicles.some(s => s.id === selectedVehicleId)) return;
    const parked = myVehicles.find(s => s.location);
    setSelectedVehicleId((parked ?? myVehicles[0])?.id ?? null);
    setTargetDepot(null);
  }, [haulier, myVehicles, selectedVehicleId]);

  /**
   * Vehicles of yours parked up with their dice already rolled and nowhere to go — a wasted roll, and
   * very easy to miss at a four-vehicle fleet. See sim/attention.ts; the judgement lives there so the
   * harness can hold it down.
   *
   * Placed above the `if (!state)` bail-out below, not beside the code that uses it: hooks after an
   * early return render conditionally, and React counts them. Putting it lower crashed the whole
   * screen with "rendered more hooks than during the previous render" — which typechecks perfectly
   * and only shows up in a browser.
   */
  const awaiting = useMemo(
    () =>
      state && haulier && state.phase === 'act' && haulier.id === state.hauliers[state.activeIndex]?.id
        ? vehiclesAwaitingOrders(state, haulier.id)
        : [],
    [state, haulier],
  );
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  /**
   * The two panels that float over the chart. The chart is the board; the exchange (left) and the
   * fleet and orders (right) slide in when they are wanted and away when they are not.
   */
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const layout = usePanelLayout();
  // Where there is not room for both beside a usable chart, opening one puts the other away.
  const openExchange = (open: boolean) => {
    setExchangeOpen(open);
    if (open && layout.oneAtATime) setOrdersOpen(false);
  };
  const openOrders = (open: boolean) => {
    setOrdersOpen(open);
    if (open && layout.oneAtATime) setExchangeOpen(false);
  };
  const exchangeRef = useRef<HTMLElement | null>(null);
  const ordersRef = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLElement | null>(null);

  // Orders slide in once a human haulier has rolled: that is the moment there is something to do.
  const actKey = state && haulier?.kind === 'human' && state.phase === 'act' ? `${state.turn}` : null;
  useEffect(() => {
    if (actKey) openOrders(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actKey]);

  // Esc puts the panels away.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setExchangeOpen(false);
      setOrdersOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Never carry a half-pressed confirmation into somebody else's turn.
  useEffect(() => {
    setConfirmingEnd(false);
  }, [state?.turn]);

  /* --- Time on the board (presentation only) ------------------------------------------------------
   * Every action below has already resolved, and been saved, by the time any of this runs: the
   * reducer is instant and the hooks write the result at once. What follows only decides what the
   * screen shows for the next moment: the dice tumbling before the roll shows, the computer
   * hauliers' turns replayed step by step, the lorries driving rather than jumping. Any click or key
   * skips straight to the real state, and with the pace off none of it happens at all.
   *
   * All of these hooks sit above the `if (!state)` bail-out, for the reason given at `awaiting`.
   */
  const pace = usePace();
  const prevState = useRef<GameState | null>(null);
  useEffect(() => {
    prevState.current = state;
  }, [state]);

  /** The computer turns that ran inside the END_TURN that produced this state, step by step. */
  const replay = useMemo((): { key: number; frames: ReplayFrame[]; holds: number[] } | null => {
    const prev = prevState.current;
    if (pace === 'off' || !prev || !state || prev.id !== state.id) return null;
    if (prev.phase !== 'act' || state.turn - prev.turn < 2) return null;
    const frames = recordAiTurns(prev, state);
    return frames && frames.length ? { key: state.turn, frames, holds: replayHolds(frames) } : null;
    // Recomputed only when the state moves on; prevState is the state before that move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const steps = useSteps(replay?.key ?? null, replay?.holds ?? NO_HOLDS);
  const frame = replay && steps.playing ? replay.frames[steps.index] : null;

  /** Your own roll: the board as it stood before it, held while the dice tumble. */
  const rolled = useMemo((): { key: number; vehicles: Vehicle[] } | null => {
    const prev = prevState.current;
    if (pace === 'off' || !prev || !state || prev.id !== state.id) return null;
    return prev.phase === 'roll' && state.phase === 'act' && prev.turn === state.turn
      ? { key: state.turn, vehicles: prev.vehicles }
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const tumble = useTween(rolled ? `roll-${rolled.key}` : null, TUMBLE_MS);
  const tumbling = tumble.t < 1;

  const [snapToken, setSnapToken] = useState(0);
  useSkipOnInput(steps.playing || tumbling, () => {
    steps.skip();
    tumble.skip();
    setSnapToken(n => n + 1);
  });

  /** What the board shows: a replay frame, the pre-roll board while the dice tumble, or the truth. */
  const shown = frame?.state ?? state;
  const mapVehicles = frame
    ? frame.state.vehicles
    : tumbling && rolled
      ? rolled.vehicles
      : state?.vehicles ?? [];

  /** "+£1,200" over the depot where a load was just delivered, for anyone's delivery. */
  const contractDepot = useRef(new Map<string, DepotId>());
  for (const s of [prevState.current, state, ...(replay?.frames.map(f => f.state) ?? [])]) {
    for (const c of s?.contracts ?? []) contractDepot.current.set(c.id, c.destination);
  }
  const [mapFloats, setMapFloats] = useState<MapFloat[]>([]);
  const floatSeen = useRef<number | null>(null);
  const mapFloatTimers = useRef<number[]>([]);
  const shownLog = shown?.log;
  useEffect(() => {
    if (!shownLog) return;
    const highest = shownLog.reduce((m, e) => Math.max(m, e.seq), -1);
    if (floatSeen.current === null || pace === 'off') {
      floatSeen.current = Math.max(floatSeen.current ?? -1, highest);
      return;
    }
    const since = floatSeen.current;
    floatSeen.current = Math.max(since, highest);
    const fresh: MapFloat[] = [];
    for (const e of shownLog) {
      if (e.seq <= since || e.kind !== 'deliver') continue;
      const depot = contractDepot.current.get(String(e.data?.contractId ?? ''));
      const payout = Number(e.data?.payout ?? 0);
      if (depot && payout > 0) fresh.push({ id: e.seq, depot, text: signed(payout, money) });
    }
    if (fresh.length === 0) return;
    setMapFloats(f => [...f, ...fresh].slice(-6));
    const ids = new Set(fresh.map(f => f.id));
    const t = window.setTimeout(() => setMapFloats(f => f.filter(x => !ids.has(x.id))), paced(MAP_FLOAT_MS, pace) + 60);
    mapFloatTimers.current.push(t);
  }, [shownLog, pace]);
  useEffect(() => () => mapFloatTimers.current.forEach(t => window.clearTimeout(t)), []);

  /**
   * The guided run, once it has been started. Latched in state rather than recomputed per render
   * on purpose: the plan is chosen from the board as it stood when the run opened, and a plan
   * that silently re-picked itself every time a rival filled a commission would rewrite the steps
   * under the player's feet.
   */
  const [tourPlan, setTourPlan] = useState<TourPlan | null>(null);
  /** Whether the once-per-browser offer has already been considered for this screen. */
  const [tourOffered, setTourOffered] = useState(false);

  // Open the run unasked on a game that has not moved yet, the first time this browser sees one.
  // Hooks live above the `if (!state)` bail-out below; one placed after it renders conditionally,
  // which typechecks, passes the harness, and blanks the screen.
  useEffect(() => {
    if (tourOffered || !state || !haulier) return;
    if (haulier.kind !== 'human' || state.phase === 'over' || state.round > 1 || state.turn > 1) return;
    setTourOffered(true);
    if (hasSeenGuidedTour()) return;
    const vehicle = state.vehicles.find(ve => ve.ownerId === haulier.id && ve.location) ?? null;
    if (!vehicle) return;
    const plan = planFirstRun(state, haulier, vehicle);
    if (plan) setTourPlan(plan);
  }, [state, haulier, tourOffered]);

  /**
   * The control the guided run is ringing, and keeping the panel that holds it in view. On a phone
   * (and on any chart too narrow for both) only one panel is open at a time, so the game's own
   * moves can put the target away under a live step: the roll slides Fleet and orders in, which
   * closes the exchange, and a step waiting on a port in the ledger was left pointing at nothing.
   * Reacting only to a new target id cannot see that, because the target never changed.
   *
   * The rule: the panel is (re)opened, and the control scrolled to once, whenever the target
   * changes or the game moves on (a new turn, phase or seat), polled until the panel has stayed
   * open for two ticks so that a panel closed by the same render's effects is caught. Then it
   * stops. A player who opens the other panel or closes this one on purpose mid-step (to buy a
   * ship, or to see the chart) is left alone until the step, its target, or the game moves on;
   * those are the moments the game itself rearranges the panels, so the run reasserts what it
   * asks for exactly then and never fights a deliberate choice in between.
   */
  const [tourTarget, setTourTarget] = useState<string | null>(null);
  const tourMoment = state ? `${state.turn}|${state.phase}|${state.activeIndex}` : '';
  useEffect(() => {
    if (!tourTarget) return;
    let stopped = false;
    let openTicks = 0;
    const tick = () => {
      if (stopped) return;
      const el = document.getElementById(tourTarget);
      if (!el) return; // may appear only once the player acts; keep looking
      const inExchange = !!exchangeRef.current?.contains(el);
      if (!inExchange && !ordersRef.current?.contains(el)) {
        stopped = true; // on the chart or the turn bar: nothing to open
        return;
      }
      const panel = (inExchange ? exchangeRef : ordersRef).current!;
      if (!panel.classList.contains('open')) {
        openTicks = 0;
        if (inExchange) openExchange(true);
        else openOrders(true);
        return; // measure on a later tick, once the panel has slid in
      }
      if (++openTicks < 2) return;
      // Scrolling any earlier measures a panel still in motion, and on a phone that left the
      // control tucked under the sheet's own title strip with the spotlight framing an empty gap.
      const body = el.closest('.tr-panel-body');
      if (body) {
        const t = el.getBoundingClientRect(), b = body.getBoundingClientRect();
        if (t.top < b.top + 8 || t.bottom > b.bottom - 8) el.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
      stopped = true;
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourTarget, tourMoment]);

  /**
   * The turn bar's height, so that on a phone the open bottom sheet can end its scrolling body
   * above it. There the bar docks across the foot of the sheet instead of floating over the chart
   * above it, which used to hide the strip of chart the sheet had left showing.
   */
  const [turnBarEl, setTurnBarEl] = useState<HTMLDivElement | null>(null);
  const [turnBarH, setTurnBarH] = useState(0);
  useEffect(() => {
    if (!turnBarEl || typeof ResizeObserver === 'undefined') return;
    const measure = () => setTurnBarH(Math.ceil(turnBarEl.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(turnBarEl);
    return () => ro.disconnect();
  }, [turnBarEl]);

  if (!state) {
    return (
      <LoadingScreen
        motif="lorry"
        caption="Loading the run…"
        error={error === SESSION_EXPIRED ? SIGN_IN_AGAIN : error}
        actions={
          error === SESSION_EXPIRED ? (
            <Button tone="primary" onClick={() => { clearToken(); navigate('/'); }}>Sign in again</Button>
          ) : (
            <>
              {id && <Button tone="primary" onClick={() => void loadGame(id)}>Try again</Button>}
              <Button onClick={() => navigate('/')}>Back to the lobby</Button>
            </>
          )
        }
      />
    );
  }

  const selectedVehicle = state.vehicles.find(s => s.id === selectedVehicleId) ?? null;
  const isHuman = haulier?.kind === 'human';
  const canAct = state.phase === 'act' && isHuman;

  const mustRoll = state.phase === 'roll' && isHuman;
  const over = state.phase === 'over';
  const season = (state.hazards?.weather ?? false) ? seasonOf(state.round) : null;

  /** The course drawn on the chart: what the selected vehicle is running, or what she's being sent on. */
  const plannedRoute: DepotId[] | null = (() => {
    if (!selectedVehicle) return null;
    if (selectedVehicle.run) return [selectedVehicle.run.legFrom, ...selectedVehicle.run.route];
    if (selectedVehicle.location && targetDepot && targetDepot !== selectedVehicle.location) {
      // Draw the course she would actually be given: fastest in this season when there is weather,
      // shortest when there is not.
      const route = season
        ? planFastestRoute(selectedVehicle.location, targetDepot, season, selectedVehicle.fittings?.aeroKit)
        : planRoute(selectedVehicle.location, targetDepot);
      return route ? [selectedVehicle.location, ...route.path] : null;
    }
    if (focusedContract) {
      const from = selectedVehicle.location;
      if (!from) return null;
      const carrying = selectedVehicle.hold.some(lot => lot.good === focusedContract.good);
      // Empty, she wants the nearest depot that stocks it — the card names a buyer, not a seller.
      const to = carrying
        ? focusedContract.destination
        : sourcesFor(focusedContract.good, from)[0];
      if (!to) return null;
      const route = planRoute(from, to);
      return route ? [from, ...route.path] : null;
    }
    return null;
  })();

  const winner = state.winnerId ? state.hauliers.find(c => c.id === state.winnerId) : null;

  /** Who the guided run belongs to. Not `haulier`, which is whoever holds the seat right now. */
  const tourOwner = tourPlan ? state.hauliers.find(h => h.id === tourPlan.haulierId) ?? null : null;

  /** A run the tour could teach from where the fleet stands right now, or null if there isn't one
   *  (nothing affordable or reachable, everything struck, or every vehicle on the road). */
  const tourCandidate: TourPlan | null = (() => {
    if (!haulier || !isHuman || over) return null;
    const parked = myVehicles.find(ve => ve.location) ?? null;
    return parked ? planFirstRun(state, haulier, parked) : null;
  })();

  const insetPx = layout.sheet
    ? { left: 0, right: 0, bottom: exchangeOpen || ordersOpen ? Math.round((boardRef.current?.clientHeight ?? window.innerHeight) * 0.58) : 0 }
    : {
        left: exchangeOpen ? layout.exchangeWidth + 20 : 0,
        right: ordersOpen ? layout.ordersWidth + 20 : 0,
        bottom: 0,
      };
  /** On a phone with a sheet open, the turn bar sits at the sheet's foot, and the sheet's body ends above it. */
  const barDocked = layout.sheet && (exchangeOpen || ordersOpen);
  const sheetStyle: React.CSSProperties | undefined = barDocked ? { paddingBottom: turnBarH } : undefined;
  const focusDepot = targetDepot ?? selectedVehicle?.location ?? myVehicles.find(ve => ve.location)?.location ?? null;

  return (
    <div style={page}>
      {/* --- Header ------------------------------------------------------------------- */}
      <header style={header} className="tr-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.7rem', flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontFamily: FONT.display, fontSize: '1rem', color: UI.text }}>
            {state.name}
          </span>
          <span style={{ ...dataText, fontSize: '0.72rem', color: UI.textFaint }}>
            round {state.round}
          </span>
        </div>

        {haulier && !over && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: haulier.colour }} />
              <span style={{ fontFamily: FONT.display, fontSize: '0.92rem' }}>{haulier.name}</span>
            </span>
            <span style={{ ...dataText, fontSize: '0.8rem', color: UI.brass, position: 'relative' }}>
              <CountUp value={haulier.cash} format={money} />
              <MoneyFloats value={haulier.cash} scope={`${haulier.id}:${state.turn}`} live={canAct && !frame} />
            </span>
            <span style={{ ...dataText, fontSize: '0.8rem', color: UI.verdigris }}>
              <CountUp value={haulier.shares} /> share{haulier.shares === 1 ? '' : 's'}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {/* Sized like the game's own buttons beside them, so the header reads as one row. */}
          <MotionToggle className={buttonClass('quiet')} style={headerToggle} />
          <ThemeToggle className={buttonClass('quiet')} style={headerToggle} />
          {/* Offered whenever a run can actually be planned from where the fleet stands, not only
              on day one: a player who skipped it, or who came back to a half-played game, should
              still be able to ask for it. */}
          {tourCandidate && !tourPlan && (
            <Button tone="quiet" onClick={() => setTourPlan(tourCandidate)}>
              Guided run
            </Button>
          )}
          <Button tone="quiet" onClick={() => navigate('/')}>
            Lobby
          </Button>
        </div>
      </header>

      {/* --- The season ------------------------------------------------------------------- */}
      {season && !over && (
        <div style={seasonBanner}>
          <span style={{ color: UI.verdigris, fontFamily: FONT.display, fontSize: '0.9rem' }}>
            {SEASON_NAMES[season]}
          </span>
          <span style={{ ...dataText, fontSize: '0.72rem', color: UI.textSoft }}>
            year {gameYear(state.round)} · turns in {roundsLeftInSeason(state.round)} round
            {roundsLeftInSeason(state.round) === 1 ? '' : 's'}
          </span>
          <span className="tr-hide-phone" style={{ ...bodySmall, fontSize: '0.76rem' }}>
            Cloud marks fog- and flood-prone roads, worse this time of year. Crossed swords mark
            theft-prone roads.
          </span>
        </div>
      )}

      {/* --- Declaration clock ----------------------------------------------------------- */}
      {/* --- The news ---------------------------------------------------------------------- */}
      {!over && <NewsBanner events={state.events ?? []} round={state.round} />}

      {state.declaration && !over && (
        <div style={declarationBanner} role="status">
          <strong style={{ color: UI.warn }}>
            {state.hauliers.find(c => c.id === state.declaration!.haulierId)?.name} has claimed the
            company.
          </strong>{' '}
          {state.declaration.turnsRemaining} of {DECLARATION_TURNS} turns left. At the close they
          must still hold {SHARE_MAJORITY} shares, {money(VICTORY_CASH)} and a vehicle.
        </div>
      )}

      {/* --- Board -------------------------------------------------------------------- */}
      {/* The chart is the board and fills it. The exchange floats in from the left and the fleet
          and orders from the right, each when wanted; the turn's one big button sits on the chart
          along the bottom. `.tr-panel` in styles.css turns both panels into bottom sheets on a
          phone. */}
      <main ref={boardRef} style={board} className="tr-board">
        <MapView
          vehicles={mapVehicles}
          snapToken={snapToken}
          floats={mapFloats}
          hauliers={state.hauliers}
          contracts={state.contracts}
          selectedVehicleId={selectedVehicleId}
          plannedRoute={plannedRoute}
          viewerId={haulier?.id ?? null}
          season={season}
          showTheft={state.hazards?.theft ?? false}
          focusDepot={focusDepot}
          inset={insetPx}
          onDepotClick={depotId => {
            setTargetDepot(depotId);
            setFocusedContract(null);
            if (canAct) openOrders(true);
          }}
        />

        {/* The computer hauliers' turns, replayed: a strip across the top of the open chart, below
            the launchers, naming whose turn it is and offering Skip. */}
        {frame && replay && (
          <div style={{ ...replaySlot, left: insetPx.left + 12, right: insetPx.right + 12 }}>
            <ReplayStrip
              frame={frame}
              haulier={frame.state.hauliers.find(h => h.id === frame.haulierId)}
              index={steps.index}
              count={replay.frames.length}
              onSkip={() => {
                steps.skip();
                setSnapToken(n => n + 1);
              }}
              stepMs={replay.holds[steps.index] ?? 420}
            />
          </div>
        )}

        {/* With a panel away, the button that brings it back waits at its edge of the chart. */}
        {!exchangeOpen && (
          <button type="button" className="tr-launcher" style={{ ...launcher, left: 12 }} onClick={() => openExchange(true)}>
            The exchange
            <span style={launcherNote}>{state.contracts.filter(c => c.fills.length < 2).length} commissions</span>
          </button>
        )}
        {!ordersOpen && (
          <button type="button" className="tr-launcher" style={{ ...launcher, right: 12 }} onClick={() => openOrders(true)}>
            {haulier?.kind === 'human' ? 'Your fleet and orders' : 'Fleets and log'}
            {awaiting.length > 0 && <span style={{ ...launcherNote, color: UI.warn }}>{awaiting.length} awaiting orders</span>}
          </button>
        )}

        <aside
          ref={exchangeRef}
          className={`tr-panel tr-panel-left${exchangeOpen ? ' open' : ''}`}
          style={sheetStyle}
          aria-hidden={!exchangeOpen}
          aria-label="The exchange"
        >
          <PanelHead title="The exchange" onClose={() => setExchangeOpen(false)} />
          <div style={panelBody} className="tr-panel-body">
            <ContractBoard
              contracts={state.contracts}
              hauliers={state.hauliers}
              reference={selectedVehicle}
              round={state.round}
              deadlines={state.hazards?.deadlines ?? false}
              focusedId={focusedContract?.id ?? null}
              onFocus={contract => {
                setFocusedContract(prev => (prev?.id === contract.id ? null : contract));
                setTargetDepot(null);
              }}
            />
            <HauliersTable state={shown ?? state} />
            <DepotLedger
              contracts={state.contracts}
              reference={selectedVehicle}
              targetDepot={targetDepot}
              onDepotClick={depotId => {
                setTargetDepot(depotId);
                setFocusedContract(null);
              }}
            />
          </div>
        </aside>

        <aside
          ref={ordersRef}
          id="game-sidebar"
          className={`tr-panel tr-panel-right${ordersOpen ? ' open' : ''}`}
          style={sheetStyle}
          aria-hidden={!ordersOpen}
          aria-label="Your fleet and orders"
        >
          <PanelHead title={haulier?.kind === 'human' ? 'Your fleet and orders' : 'Fleets and log'} onClose={() => setOrdersOpen(false)} />
          <div style={panelBody} className="tr-panel-body">
            {haulier && (
              <>
                <FleetPanel
                  vehicles={myVehicles}
                  haulier={haulier}
                  miles={state.miles}
                  dice={state.dice}
                  selectedVehicleId={selectedVehicleId}
                  rolled={state.phase === 'act' && !tumbling}
                  turn={state.turn}
                  deadlines={state.hazards?.deadlines ?? false}
                  onSelect={vehicleId => {
                    setSelectedVehicleId(vehicleId);
                    setTargetDepot(null);
                  }}
                />

                <Enter on={`${selectedVehicle?.id ?? ''}:${selectedVehicle?.location ?? 'road'}`}>
                <DepotPanel
                  state={state}
                  vehicle={selectedVehicle}
                  haulier={haulier}
                  contracts={state.contracts}
                  miles={state.miles}
                  targetDepot={targetDepot}
                  onClearTarget={() => setTargetDepot(null)}
                  dispatch={dispatch}
                  enabled={canAct}
                  sellable={state.hazards?.depotSales ?? false}
                  season={season}
                  theftOn={state.hazards?.theft ?? false}
                />
                </Enter>

                <CountingHouse
                  state={state}
                  haulier={haulier}
                  fleetSize={myVehicles.length}
                  vehicles={myVehicles}
                  dispatch={dispatch}
                  enabled={canAct}
                />
              </>
            )}

            <RivalFleets state={state} viewerId={haulier?.id ?? null} />
            <ChronicleLog log={shown?.log ?? state.log} hauliers={state.hauliers} />
          </div>
        </aside>

          <div
            ref={setTurnBarEl}
            style={
              barDocked
                ? { ...turnBar, ...turnBarDocked }
                : {
                    ...turnBar,
                    left: `calc(${insetPx.left}px + 12px)`,
                    right: `calc(${insetPx.right}px + 66px)`,
                    bottom: insetPx.bottom + 12,
                  }
            }
            className="tr-turnbar"
          >
            {over ? (
              <span style={{ ...bodySmall, color: UI.brass }}>
                {winner ? `${winner.name} carried the company.` : 'The run is over.'}
              </span>
            ) : mustRoll ? (
              <>
                <Button id="roll-button" tone="primary" onClick={() => dispatch({ type: 'ROLL' })}>
                  {myVehicles.length === 1 ? 'Roll for the day' : 'Roll for the fleet'}
                </Button>
                <span className="tr-hide-phone" style={{ ...bodySmall, fontSize: '0.78rem', color: UI.textFaint }}>
                  2d6 per vehicle. Vehicles already on the road drive on the moment you roll.
                </span>
              </>
            ) : canAct ? (
              <>
                {pace !== 'off' && (
                  <DiceTray
                    rolls={myVehicles.map(v => ({ id: v.id, name: v.name, dice: state.dice[v.id] ?? null }))}
                    t={tumble.t}
                    colour={haulier?.colour}
                  />
                )}
                <Button
                  id="end-turn-button"
                  tone={confirmingEnd ? 'primary' : undefined}
                  onClick={() => {
                    // One extra click, never a block: waiting in depot for cash or a better card is
                    // a real move, so the warning must be dismissible by simply repeating yourself.
                    if (awaiting.length > 0 && !confirmingEnd) {
                      setConfirmingEnd(true);
                      return;
                    }
                    setConfirmingEnd(false);
                    setOrdersOpen(false);
                    dispatch({ type: 'END_TURN' });
                  }}
                >
                  {confirmingEnd ? 'End it anyway' : 'End the turn'}
                </Button>
                {confirmingEnd && (
                  <Button tone="quiet" onClick={() => setConfirmingEnd(false)}>
                    Wait, give her orders
                  </Button>
                )}
                <span
                  style={{
                    ...bodySmall,
                    fontSize: '0.78rem',
                    color: awaiting.length > 0 ? UI.warn : UI.textFaint,
                  }}
                >
                  {tumbling
                    ? 'Rolling…'
                    : awaiting.length > 0
                    ? awaiting
                        .map(
                          w =>
                            `${w.vehicleName} lies at ${w.depotName} with ${w.pointsUnspent} pts unspent: ${w.hint}`,
                        )
                        .join('. ') + '.'
                    : selectedVehicle?.location
                      ? `${selectedVehicle.name} lies at ${depotName(selectedVehicle.location)}.`
                      : selectedVehicle && destinationOf(selectedVehicle)
                        ? `${selectedVehicle.name} is on the road.`
                        : 'Give your vehicles their orders.'}
                </span>
              </>
            ) : (
              <span style={{ ...bodySmall, color: UI.textFaint }}>
                {(frame ? frame.state.hauliers.find(h => h.id === frame.haulierId) : haulier)?.name} is taking
                their turn…
              </span>
            )}
          </div>
      </main>

      {/* New log entries, read to a screen reader as they land (the log panel may be put away). */}
      <LogAnnouncer log={shown?.log ?? state.log} />

      {/* Notable events pop as cards so the game can be watched rather than read. */}
      <EventCards log={shown?.log ?? state.log} hauliers={state.hauliers} viewerId={haulier?.id ?? null} />

      {/* --- Overlays -------------------------------------------------------------------- */}
      {/* Hidden, not unmounted, while a handover card owns the screen or another hotseat player has
          the seat: the card is modal, and the run belongs to the player who started it. Unmounting
          sent the run back to its welcome card at every handover. The closing card ends it.
          It also steps aside while the rivals' turns replay: its scrim would dim the replay, and its
          card would be talking about a board the screen is not yet showing. */}
      {tourPlan && tourOwner && !over && (
        <GuidedTour
          onTargetChange={setTourTarget}
          view={{
            state,
            haulier: tourOwner,
            vehicle: state.vehicles.find(ve => ve.id === tourPlan.vehicleId) ?? null,
            selectedVehicleId,
            targetDepot,
            focusedContract,
          }}
          plan={tourPlan}
          hidden={state.phase === 'handover' || haulier?.id !== tourOwner.id || !!frame}
          onFinish={() => setTourPlan(null)}
        />
      )}

      {/* Hot seat: when computer hauliers sat between two humans, their replay plays first and the
          card follows it. Shown at once, the card covered the whole replay, and the press that
          dismissed it also skipped it, so nobody ever saw the rivals move. */}
      {state.phase === 'handover' && haulier && !frame && (
        <HandoverCard
          state={state}
          next={haulier}
          onReady={() => dispatch({ type: 'ACKNOWLEDGE_HANDOVER' })}
        />
      )}

      {over && winner && (
        <div style={backdrop}>
          <div style={{ ...victoryCard, borderColor: winner.colour }}>
            <span style={{ ...dataText, fontSize: '0.62rem', letterSpacing: '0.2em', color: UI.textFaint }}>
              ROUND {state.round}
            </span>
            <h2 style={{ fontFamily: FONT.display, fontSize: '1.9rem', margin: 0, color: winner.colour }}>
              {winner.name} carries the company
            </h2>
            <p style={{ ...bodySmall, margin: 0 }}>
              {winner.shares} shares, {money(winner.cash)} in hand and{' '}
              {state.vehicles.filter(s => s.ownerId === winner.id).length} vehicle
              {state.vehicles.filter(s => s.ownerId === winner.id).length === 1 ? '' : 's'} still on the road.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Button tone="primary" onClick={() => navigate('/')}>
                Back to the lobby
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const page: React.CSSProperties = {
  height: '100dvh',
  minHeight: '100vh',
  overflow: 'clip',
  display: 'flex',
  flexDirection: 'column',
  background: UI.ground,
  color: UI.text,
  fontFamily: FONT.body,
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.8rem',
  flexWrap: 'wrap',
  padding: '0.6rem 1rem',
  borderBottom: `1px solid ${UI.rule}`,
  background: UI.panel,
};

const seasonBanner: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.7rem',
  flexWrap: 'wrap',
  padding: '0.4rem 1rem',
  borderBottom: `1px solid ${UI.rule}`,
  background: UI.tintVerdigris,
};

const declarationBanner: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderBottom: `1px solid ${UI.rule}`,
  background: UI.tintWarn,
  fontFamily: FONT.body,
  fontSize: '0.82rem',
  color: UI.textSoft,
};

/**
 * The board: the chart filling everything below the banners, with the panels, the launchers and
 * the turn bar floating over it. `overflow: clip` rather than `hidden`, so that a scrollIntoView
 * from the guided run (aimed at a control inside a closed, off-screen panel) cannot scroll the
 * board sideways the way it can scroll an `overflow: hidden` box.
 */
const board: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflow: 'clip',
};

const panelBody: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
  padding: '0.7rem',
};

const turnBar: React.CSSProperties = {
  position: 'absolute',
  // Above the event cards (30), below the panels (40): the turn's one button must never be covered.
  zIndex: 32,
  margin: '0 auto',
  maxWidth: 760,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: '0.8rem',
  flexWrap: 'wrap',
  border: `1px solid ${UI.ruleStrong}`,
  background: UI.panel,
  padding: '0.55rem 0.75rem',
  boxShadow: `0 6px 20px ${UI.shadow}`,
  transition: 'left 0.25s ease, right 0.25s ease, bottom 0.25s ease',
};

/** The turn bar across the foot of a phone's open sheet: above the sheet (40), full width. */
const turnBarDocked: React.CSSProperties = {
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 41,
  maxWidth: 'none',
  borderWidth: '1px 0 0',
  boxShadow: 'none',
  padding: '0.5rem 0.75rem',
};

const gazetteSlot: React.CSSProperties = {
  position: 'absolute',
  top: 56,
  zIndex: 22,
  margin: '0 auto',
  maxWidth: 620,
  maxHeight: 'calc(100% - 150px)',
  overflowY: 'auto',
};

/** Holds the replay strip (itself absolutely placed at its top) clear of the launchers. */
const replaySlot: React.CSSProperties = {
  position: 'absolute',
  top: 62,
  // Above the event cards (30), below the turn bar (32) and the panels (40).
  zIndex: 31,
  margin: '0 auto',
  maxWidth: 640,
};

const launcher: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  zIndex: 24,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'center',
  gap: 1,
  padding: '0.45rem 0.75rem',
  background: UI.panel,
  border: `1px solid ${UI.ruleStrong}`,
  boxShadow: `0 4px 14px ${UI.shadow}`,
  color: UI.text,
  fontFamily: FONT.display,
  fontSize: '0.92rem',
  cursor: 'pointer',
  borderRadius: 2,
};

/** The shared toggles' own inline look, cleared so the kit's quiet button (and its states) shows. */
const headerToggle: React.CSSProperties = {
  background: undefined,
  border: undefined,
  color: undefined,
  borderRadius: undefined,
  padding: undefined,
  fontSize: undefined,
};

const launcherNote: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.62rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: UI.textFaint,
};

/** A panel's title strip, with the button that puts it away. */
function PanelHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.5rem 0.6rem 0.5rem 0.8rem', borderBottom: `1px solid ${UI.rule}`, flexShrink: 0 }}>
      <span style={{ fontFamily: FONT.display, fontSize: '0.95rem', color: UI.text }}>{title}</span>
      <Button
        tone="quiet"
        onClick={onClose}
        aria-label={`Close ${title.toLowerCase()} (Esc)`}
        title="Close (Esc)"
        className="se-square"
        style={{ fontFamily: FONT.data, fontSize: '0.85rem' }}
      >
        ✕
      </Button>
    </div>
  );
}

/**
 * How the panels sit, matching `.tr-panel` in styles.css: beside each other over a wide chart, one
 * at a time over a narrower one, and as a bottom sheet on a phone.
 */
function usePanelLayout() {
  const read = () => {
    const w = window.innerWidth;
    return {
      sheet: w <= 720,
      oneAtATime: w <= 1360,
      exchangeWidth: w <= 1100 ? 280 : 300,
      ordersWidth: w <= 1100 ? 340 : 370,
    };
  };
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const onResize = () =>
      setLayout(prev => {
        const next = read();
        return prev.sheet === next.sheet && prev.oneAtATime === next.oneAtATime && prev.exchangeWidth === next.exchangeWidth ? prev : next;
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return layout;
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: UI.cover,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1.5rem',
  zIndex: 50,
};

const victoryCard: React.CSSProperties = {
  background: UI.panel,
  border: '2px solid',
  borderRadius: 3,
  padding: '1.6rem 1.8rem',
  maxWidth: 480,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
  boxSizing: 'border-box',
};
