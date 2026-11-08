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
          <MotionToggle style={{ borderColor: UI.rule, color: UI.textSoft }} />
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
          <HauliersTable state={shown ?? state} />
        </aside>

        {/* Centre: the chart, given the room. */}
        <div style={mapColumn}>
          {/* Shrinks to the chart, so the replay strip lies across the chart and not the column. */}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignSelf: 'center', maxWidth: '100%' }}>
          {frame && replay && (
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
          )}
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
            onDepotClick={depotId => {
              setTargetDepot(depotId);
              setFocusedContract(null);
            }}
          />
          </div>

          <div style={turnBar}>
            {over ? (
              <span style={{ ...bodySmall, color: UI.brass }}>
                {winner ? `${winner.name} carried the company.` : 'The run is over.'}
              </span>
            ) : mustRoll ? (
              <>
                <Button id="roll-button" tone="primary" onClick={() => dispatch({ type: 'ROLL' })}>
                  Roll for the day — {myVehicles.length === 1 ? 'her' : 'the fleet'}
                </Button>
                <span style={{ ...bodySmall, fontSize: '0.78rem', color: UI.textFaint }}>
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
                  {tumbling
                    ? 'Rolling…'
                    : awaiting.length > 0
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
                {(frame ? frame.state.hauliers.find(h => h.id === frame.haulierId) : haulier)?.name} is taking
                their turn…
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
        </aside>
      </main>

      {/* Notable events pop as cards so the game can be watched rather than read. */}
      <EventCards log={shown?.log ?? state.log} hauliers={state.hauliers} viewerId={haulier?.id ?? null} />

      {/* --- Overlays -------------------------------------------------------------------- */}
      {/* Kept off while a handover card or the closing card owns the screen — both are modal, and
          spotlighting a control underneath one would point at something unclickable. */}
      {/* While the rivals' turns replay, the run steps aside rather than unmounting (it would forget
          its place and its latches): its spotlight's scrim would otherwise dim the replay, and
          its card would be talking about a board the screen is not yet showing. */}
      {tourPlan && haulier && !over && state.phase !== 'handover' && (
        <div style={{ display: frame ? 'none' : 'contents' }}>
        <GuidedTour
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
        </div>
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
