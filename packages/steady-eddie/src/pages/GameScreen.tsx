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
import ChronicleLog from '../components/ChronicleLog';
import HandoverCard from '../components/HandoverCard';
import { Button, bodySmall, dataText } from '../components/ui';
import GuidedTour, { hasSeenGuidedTour, planFirstRun, type TourPlan } from '../components/GuidedTour';
import type { Contract, DepotId } from '../sim/types';
import ThemeToggle from '../components/ThemeToggle';

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

  if (!state) {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ ...bodySmall, textAlign: 'center', maxWidth: '40ch' }}>
          {error ?? 'Loading the run…'}
        </p>
        {error && (
          <Button onClick={() => navigate('/')} style={{ marginTop: '0.8rem' }}>
            Back to the lobby
          </Button>
        )}
      </div>
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

  /** A run the tour could teach from where the fleet stands right now, or null if there isn't one
   *  (nothing affordable or reachable, everything struck, or every vehicle on the road). */
  const tourCandidate: TourPlan | null = (() => {
    if (!haulier || !isHuman || over) return null;
    const parked = myVehicles.find(ve => ve.location) ?? null;
    return parked ? planFirstRun(state, haulier, parked) : null;
  })();

  /**
   * The guided run is pointing at something: open whichever panel it lives in, then, once the panel
   * has finished sliding in, scroll the control into the middle of it. Scrolling any earlier
   * measures a panel still in motion, and on a phone that left the control tucked under the
   * sheet's own title strip with the spotlight framing an empty gap.
   */
  const revealTourTarget = (targetId: string | null) => {
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (!el) return;
    const panel = exchangeRef.current?.contains(el) ? 'exchange' : ordersRef.current?.contains(el) ? 'orders' : null;
    if (!panel) return;
    const wasOpen = panel === 'exchange' ? exchangeOpen : ordersOpen;
    if (panel === 'exchange') openExchange(true);
    else openOrders(true);
    window.setTimeout(() => {
      const target = document.getElementById(targetId);
      const body = target?.closest('.tr-panel-body');
      if (!target || !body) return;
      const t = target.getBoundingClientRect(), b = body.getBoundingClientRect();
      if (t.top < b.top + 8 || t.bottom > b.bottom - 8) target.scrollIntoView({ block: 'center', behavior: 'auto' });
    }, wasOpen ? 0 : 320);
  };

  const insetPx = layout.sheet
    ? { left: 0, right: 0, bottom: exchangeOpen || ordersOpen ? Math.round((boardRef.current?.clientHeight ?? window.innerHeight) * 0.58) : 0 }
    : {
        left: exchangeOpen ? layout.exchangeWidth + 20 : 0,
        right: ordersOpen ? layout.ordersWidth + 20 : 0,
        bottom: 0,
      };
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
            <span style={{ ...dataText, fontSize: '0.8rem', color: UI.brass }}>{money(haulier.cash)}</span>
            <span style={{ ...dataText, fontSize: '0.8rem', color: UI.verdigris }}>
              {haulier.shares} share{haulier.shares === 1 ? '' : 's'}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <ThemeToggle style={{ borderColor: UI.rule, color: UI.textSoft }} />
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
          <span style={{ ...dataText, fontSize: '0.72rem', color: UI.textFaint }}>
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
          vehicles={state.vehicles}
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
            <HauliersTable state={state} />
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
                  rolled={state.phase === 'act'}
                  turn={state.turn}
                  deadlines={state.hazards?.deadlines ?? false}
                  onSelect={vehicleId => {
                    setSelectedVehicleId(vehicleId);
                    setTargetDepot(null);
                  }}
                />

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
            <ChronicleLog log={state.log} hauliers={state.hauliers} />
          </div>
        </aside>

          <div
            style={{
              ...turnBar,
              left: `calc(${insetPx.left}px + 12px)`,
              right: `calc(${insetPx.right}px + 66px)`,
              bottom: insetPx.bottom + 12,
            }}
            className="tr-turnbar"
          >
            {over ? (
              <span style={{ ...bodySmall, color: UI.brass }}>
                {winner ? `${winner.name} carried the company.` : 'The run is over.'}
              </span>
            ) : mustRoll ? (
              <>
                <Button id="roll-button" tone="primary" onClick={() => dispatch({ type: 'ROLL' })}>
                  Roll for the day — {myVehicles.length === 1 ? 'her' : 'the fleet'}
                </Button>
                <span className="tr-hide-phone" style={{ ...bodySmall, fontSize: '0.78rem', color: UI.textFaint }}>
                  2d6 per vehicle. Vehicles already on the road drive on the moment you roll.
                </span>
              </>
            ) : canAct ? (
              <>
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
                    Wait — give her orders
                  </Button>
                )}
                <span
                  style={{
                    ...bodySmall,
                    fontSize: '0.78rem',
                    color: awaiting.length > 0 ? UI.warn : UI.textFaint,
                  }}
                >
                  {awaiting.length > 0
                    ? awaiting
                        .map(
                          w =>
                            `${w.vehicleName} lies at ${w.depotName} with ${w.pointsUnspent} pts unspent — ${w.hint}`,
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
                {haulier?.name} is taking their turn…
              </span>
            )}
          </div>
      </main>

      {/* Notable events pop as cards so the game can be watched rather than read. */}
      <EventCards log={state.log} hauliers={state.hauliers} viewerId={haulier?.id ?? null} />

      {/* --- Overlays -------------------------------------------------------------------- */}
      {/* Kept off while a handover card or the closing card owns the screen — both are modal, and
          spotlighting a control underneath one would point at something unclickable. */}
      {tourPlan && haulier && !over && (
        <GuidedTour
          onTargetChange={revealTourTarget}
          hidden={state.phase === 'handover'}
          view={{
            state,
            haulier,
            vehicle: state.vehicles.find(ve => ve.id === tourPlan.vehicleId) ?? null,
            targetDepot,
            focusedContract,
          }}
          plan={tourPlan}
          onFinish={() => setTourPlan(null)}
        />
      )}

      {state.phase === 'handover' && haulier && (
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

const gazetteSlot: React.CSSProperties = {
  position: 'absolute',
  top: 56,
  zIndex: 22,
  margin: '0 auto',
  maxWidth: 620,
  maxHeight: 'calc(100% - 150px)',
  overflowY: 'auto',
};

const launcher: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  zIndex: 24,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
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
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${title.toLowerCase()} (Esc)`}
        title="Close (Esc)"
        style={{ background: 'none', border: `1px solid ${UI.rule}`, borderRadius: 2, color: UI.textSoft, cursor: 'pointer', fontFamily: FONT.data, fontSize: '0.8rem', width: 30, height: 28 }}
      >
        ✕
      </button>
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
