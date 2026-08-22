import { useEffect, useMemo, useState } from 'react';
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
import type { Contract, DepotId } from '../sim/types';

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
  // Never carry a half-pressed confirmation into somebody else's turn.
  useEffect(() => {
    setConfirmingEnd(false);
  }, [state?.turn]);

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

  return (
    <div style={page}>
      {/* --- Header ------------------------------------------------------------------- */}
      <header style={header}>
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

        <Button tone="quiet" onClick={() => navigate('/')}>
          Lobby
        </Button>
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
          <span style={{ ...bodySmall, fontSize: '0.76rem' }}>
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
      <main style={board} className="tr-board">
        {/* Left: what everyone is racing over. Narrow on purpose — it is reference, not controls. */}
        <aside style={exchangeColumn}>
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
        </aside>

        {/* Centre: the chart, given the room. */}
        <div style={mapColumn}>
          <MapView
            vehicles={state.vehicles}
            hauliers={state.hauliers}
            contracts={state.contracts}
            selectedVehicleId={selectedVehicleId}
            plannedRoute={plannedRoute}
            viewerId={haulier?.id ?? null}
            season={season}
            showTheft={state.hazards?.theft ?? false}
            onDepotClick={depotId => {
              setTargetDepot(depotId);
              setFocusedContract(null);
            }}
          />

          <div style={turnBar}>
            {over ? (
              <span style={{ ...bodySmall, color: UI.brass }}>
                {winner ? `${winner.name} carried the company.` : 'The run is over.'}
              </span>
            ) : mustRoll ? (
              <>
                <Button tone="primary" onClick={() => dispatch({ type: 'ROLL' })}>
                  Roll for the day — {myVehicles.length === 1 ? 'her' : 'the fleet'}
                </Button>
                <span style={{ ...bodySmall, fontSize: '0.78rem', color: UI.textFaint }}>
                  2d6 per vehicle. Vehicles already on the road drive on the moment you roll.
                </span>
              </>
            ) : canAct ? (
              <>
                <Button
                  tone={confirmingEnd ? 'primary' : undefined}
                  onClick={() => {
                    // One extra click, never a block: waiting in depot for cash or a better card is
                    // a real move, so the warning must be dismissible by simply repeating yourself.
                    if (awaiting.length > 0 && !confirmingEnd) {
                      setConfirmingEnd(true);
                      return;
                    }
                    setConfirmingEnd(false);
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

        {/* Right: everything you actually do. */}
        <aside style={actionColumn} id="game-sidebar">
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
        </aside>
      </main>

      {/* Notable events pop as cards so the game can be watched rather than read. */}
      <EventCards log={state.log} hauliers={state.hauliers} viewerId={haulier?.id ?? null} />

      {/* --- Overlays -------------------------------------------------------------------- */}
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
  minHeight: '100vh',
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
  background: 'rgba(111, 176, 164, 0.07)',
};

const declarationBanner: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderBottom: `1px solid ${UI.rule}`,
  background: 'rgba(217, 164, 65, 0.09)',
  fontFamily: FONT.body,
  fontSize: '0.82rem',
  color: UI.textSoft,
};

/**
 * Three columns: the exchange on the left as reference, the chart in the middle with the room it
 * needs, and every control on the right. Previously the chart and a single tall sidebar shared the
 * width, which squeezed the map and mixed "what I am racing over" with "what I can do".
 * `tr-board` in styles.css collapses this to one column on narrow screens.
 */
const board: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.8rem',
  padding: '0.8rem',
  flex: 1,
};

const exchangeColumn: React.CSSProperties = {
  flex: '0 1 265px',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};

const mapColumn: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const actionColumn: React.CSSProperties = {
  flex: '0 1 355px',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
};

const turnBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.8rem',
  flexWrap: 'wrap',
  border: `1px solid ${UI.rule}`,
  background: UI.panel,
  padding: '0.6rem 0.75rem',
};

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(6, 11, 14, 0.92)',
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
