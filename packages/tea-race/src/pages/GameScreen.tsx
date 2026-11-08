import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { useAiReplay } from '../hooks/useAiReplay';
import { Counted, TumblingDice } from '../components/Motion';
import { sourcesFor, planRoute, portName } from '../sim/content';
import { SEASON_NAMES, planFastestRoute, roundsLeftInSeason, seasonOf, voyageYear } from '../sim/weather';
import { destinationOf } from '../sim/movement';
import { DECLARATION_TURNS, SHARE_MAJORITY, VICTORY_CASH } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import MapView from '../components/MapView';
import ContractBoard from '../components/ContractBoard';
import FleetPanel from '../components/FleetPanel';
import PortPanel from '../components/PortPanel';
import CountingHouse from '../components/CountingHouse';
import PortLedger from '../components/PortLedger';
import RivalFleets from '../components/RivalFleets';
import EventCards from '../components/EventCards';
import NewsBanner from '../components/NewsBanner';
import MarketBoard from '../components/MarketBoard';
import { livePrice, sellsFor } from '../sim/voyage';
import { assetValue } from '../sim/actions';
import { ladingPrice, saleProceeds } from '../sim/pricing';
import { offersAwaiting, shipsAwaitingOrders } from '../sim/attention';
import CaptainsTable from '../components/CaptainsTable';
import ChronicleLog from '../components/ChronicleLog';
import HandoverCard from '../components/HandoverCard';
import { Button, bodySmall, dataText } from '../components/ui';
import GuidedTour, { hasSeenGuidedTour, planFirstRun, type TourPlan } from '../components/GuidedTour';
import type { Contract, GameState, GoodId, PortId } from '../sim/types';
import ThemeToggle from '../components/ThemeToggle';
import MotionToggle from '../components/MotionToggle';
import TeaRacePanel from '../components/TeaRacePanel';
import SeamanshipPanel from '../components/SeamanshipPanel';
import ChartersPanel from '../components/ChartersPanel';
import ShippingGazette, { frontPage } from '../components/ShippingGazette';
import CareerPanel from '../components/CareerPanel';
import EraBanner from '../components/EraBanner';
import LettersPanel from '../components/LettersPanel';
import { TeaChest, Vignette } from '../components/Art';
import { RACE_FINISH, TEA_RACE_PORTS, openRace, raceLots } from '../sim/seamanship';
import { LoadingScreen, SIGN_IN_AGAIN } from '../lib/Loading';
import { SESSION_EXPIRED } from '../hooks/useGameCloud';
import { clearToken } from '../lib/portalAuth';

export default function GameScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, error, loadGame, dispatch } = useGameHybrid();

  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [targetPort, setTargetPort] = useState<PortId | null>(null);
  const [focusedContract, setFocusedContract] = useState<Contract | null>(null);

  useEffect(() => {
    if (id && (!state || state.id !== id)) loadGame(id);
    // loadGame is stable per hook; re-running on every state change would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const captain = state?.captains[state.activeIndex] ?? null;
  const myShips = useMemo(
    () => (state && captain ? state.ships.filter(s => s.ownerId === captain.id) : []),
    [state, captain],
  );

  // Keep a sensible ship selected as turns pass, without fighting the player's own choice.
  useEffect(() => {
    if (!captain) return;
    if (selectedShipId && myShips.some(s => s.id === selectedShipId)) return;
    const docked = myShips.find(s => s.location);
    setSelectedShipId((docked ?? myShips[0])?.id ?? null);
    setTargetPort(null);
  }, [captain, myShips, selectedShipId]);

  /**
   * Ships of yours tied up with their dice already rolled and nowhere to go — a wasted roll, and
   * very easy to miss at a four-ship fleet. See sim/attention.ts; the judgement lives there so the
   * harness can hold it down.
   *
   * Placed above the `if (!state)` bail-out below, not beside the code that uses it: hooks after an
   * early return render conditionally, and React counts them. Putting it lower crashed the whole
   * screen with "rendered more hooks than during the previous render" — which typechecks perfectly
   * and only shows up in a browser.
   */
  const awaiting = useMemo(
    () =>
      state && captain && state.phase === 'act' && captain.id === state.captains[state.activeIndex]?.id
        ? shipsAwaitingOrders(state, captain.id)
        : [],
    [state, captain],
  );
  // Offers at sea that lapse with the turn. Above the early return for the same reason as `awaiting`.
  const offers = useMemo(
    () => (state && captain && state.phase === 'act' ? offersAwaiting(state, captain.id) : []),
    [state, captain],
  );
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  // The computer captains' turns, replayed on the board after you end yours. Above the early
  // return, like every hook here.
  const replay = useAiReplay(state);

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
  const boardRef = useRef<HTMLElement | null>(null);
  const ordersRef = useRef<HTMLElement | null>(null);

  // Orders slide in once a human captain has rolled: that is the moment there is something to do.
  const actKey = state && captain?.kind === 'human' && state.phase === 'act' ? `${state.turn}` : null;
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
   * on purpose: the plan is chosen from the board as it stood when the tour opened, and a plan
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
    if (tourOffered || !state || !captain) return;
    if (captain.kind !== 'human' || state.phase === 'over' || state.round > 1 || state.turn > 1) return;
    setTourOffered(true);
    if (hasSeenGuidedTour()) return;
    const ship = state.ships.find(sh => sh.ownerId === captain.id && sh.location) ?? null;
    if (!ship) return;
    const plan = planFirstRun(state, captain, ship, priceLookup(state, captain.id));
    if (plan) setTourPlan(plan);
  }, [state, captain, tourOffered]);

  if (!state) {
    return (
      <LoadingScreen
        motif="clipper"
        caption="Loading the voyage…"
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

  const selectedShip = state.ships.find(s => s.id === selectedShipId) ?? null;
  /**
   * What the shared board shows: the real state, or a step of the computer captains' turns while
   * they are being replayed. Only the public board follows the replay — the chart, the exchange,
   * the table and the log. Your own panels and the turn controls always read the real state, so
   * nothing you can do is ever behind the playback.
   */
  const view = replay.frame?.state ?? state;
  const replayCaptain = replay.frame ? view.captains.find(c => c.id === replay.frame!.captainId) ?? null : null;
  const priceFor = priceLookup(state, captain?.id ?? '');
  const isHuman = captain?.kind === 'human';
  const canAct = state.phase === 'act' && isHuman;

  const mustRoll = state.phase === 'roll' && isHuman;
  const over = state.phase === 'over';
  const season = (state.hazards?.weather ?? false) ? seasonOf(state.round) : null;

  /** The course drawn on the chart: what the selected ship is running, or what she's being sent on. */
  const plannedRoute: PortId[] | null = (() => {
    if (!selectedShip) return null;
    if (selectedShip.voyage) return [selectedShip.voyage.legFrom, ...selectedShip.voyage.route];
    if (selectedShip.location && targetPort && targetPort !== selectedShip.location) {
      // Draw the course she would actually be given: fastest in this season when there is weather,
      // shortest when there is not.
      const route = season
        ? planFastestRoute(selectedShip.location, targetPort, season, selectedShip.fittings?.copper)
        : planRoute(selectedShip.location, targetPort);
      return route ? [selectedShip.location, ...route.path] : null;
    }
    if (focusedContract) {
      const from = selectedShip.location;
      if (!from) return null;
      const carrying = selectedShip.hold.some(lot => lot.good === focusedContract.good);
      // Empty, she wants the nearest port that stocks it — the card names a buyer, not a seller.
      const to = carrying
        ? focusedContract.destination
        : sourcesFor(focusedContract.good, from)[0];
      if (!to) return null;
      const route = planRoute(from, to);
      return route ? [from, ...route.path] : null;
    }
    return null;
  })();

  const winner = state.winnerId ? state.captains.find(c => c.id === state.winnerId) : null;

  /** A run the tour could teach from where the fleet stands right now, or null if there isn't one
   *  (nothing affordable, nothing reachable, or every ship at sea). Cheap enough to recompute. */
  const tourCandidate: TourPlan | null = (() => {
    if (!captain || !isHuman || over) return null;
    const docked = myShips.find(sh => sh.location) ?? null;
    return docked ? planFirstRun(state, captain, docked, priceFor) : null;
  })();

  const tourOwner = tourPlan ? state.captains.find(c => c.id === tourPlan.captainId) ?? null : null;
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
  const focusPort = targetPort ?? selectedShip?.location ?? myShips.find(sh => sh.location)?.location ?? null;

  // The race, if one is running. Plain values, not a hook — this is below the early return.
  const race = openRace(view);
  const chartRace = race
    ? {
        ports: TEA_RACE_PORTS,
        finish: RACE_FINISH,
        runners: new Set(view.ships.filter(sh => raceLots(sh, race).length > 0).map(sh => sh.id)),
      }
    : null;

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

        {captain && !over && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: captain.colour }} />
              <span style={{ fontFamily: FONT.display, fontSize: '0.92rem' }}>{captain.name}</span>
            </span>
            <span style={{ ...dataText, fontSize: '0.8rem', color: UI.brass }}>
              <Counted key={captain.id} value={captain.cash} format={money} float />
            </span>
            <span style={{ ...dataText, fontSize: '0.8rem', color: UI.verdigris }}>
              {state.rules === 'voyage' ? (
                <>
                  worth <Counted key={captain.id} value={assetValue(state, captain)} format={money} />
                </>
              ) : (
                <>
                  <Counted key={captain.id} value={captain.shares} /> share{captain.shares === 1 ? '' : 's'}
                </>
              )}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <MotionToggle style={{ borderColor: UI.rule, color: UI.textSoft }} />
          <ThemeToggle style={{ borderColor: UI.rule, color: UI.textSoft }} />
          {/* Offered whenever a run can actually be planned from where the fleet stands, not only
              on turn one: a player who skipped the tour, or who came back to a half-played game,
              should still be able to ask for it. */}
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
            year {voyageYear(state.round)} · turns in {roundsLeftInSeason(state.round)} round
            {roundsLeftInSeason(state.round) === 1 ? '' : 's'}
          </span>
          <span className="tr-hide-phone" style={{ ...bodySmall, fontSize: '0.76rem' }}>
            Green chevrons on the chart point the way the wind is fair. Crossed swords mark piratical
            waters.
          </span>
        </div>
      )}

      {/* --- The era, when the game ramps up over time ----------------------------------- */}
      {!over && <EraBanner state={state} />}

      {/* --- Declaration clock ----------------------------------------------------------- */}
      {/* --- The news ---------------------------------------------------------------------- */}
      {!over && <NewsBanner events={state.events ?? []} round={state.round} />}

      {state.declaration && !over && (
        <div style={declarationBanner} role="status">
          <strong style={{ color: UI.warn }}>
            {state.captains.find(c => c.id === state.declaration!.captainId)?.name} has claimed the
            company.
          </strong>{' '}
          {state.declaration.turnsRemaining} of {DECLARATION_TURNS} turns left. At the close they
          must still hold {SHARE_MAJORITY} shares, {money(VICTORY_CASH)} and a ship.
        </div>
      )}

      {/* --- Board -------------------------------------------------------------------- */}
      {/* The chart is the board and fills it. The exchange floats in from the left and the fleet
          and orders from the right, each when wanted; the turn's one big button sits on the chart
          along the bottom. `.tr-panel` in styles.css turns both panels into bottom sheets on a
          phone. */}
      <main ref={boardRef} style={board} className="tr-board">
        <MapView
          ships={view.ships}
          captains={view.captains}
          contracts={view.contracts}
          selectedShipId={selectedShipId}
          plannedRoute={plannedRoute}
          viewerId={captain?.id ?? null}
          season={season}
          showPiracy={state.hazards?.piracy ?? false}
          race={chartRace}
          errandPorts={isHuman && captain ? (captain.errands ?? []).map(e => e.port) : []}
          focusPort={focusPort}
          inset={insetPx}
          onPortClick={portId => {
            setTargetPort(portId);
            setFocusedContract(null);
            if (canAct) openOrders(true);
          }}
        />

        {/* What the rest of the table did while you waited, at the top of your own turn. */}
        {isHuman && captain && !over && (
          // Kept mounted but out of sight under a phone's sheet, and while the rivals' turns replay
          // (the replay is showing the same news as it happens): it remembers being folded, and an
          // unmount would forget that and print the paper again.
          <div
            className="tr-gazette"
            style={{
              ...gazetteSlot,
              left: insetPx.left + 12,
              right: insetPx.right + 12,
              display: replay.frame || (layout.sheet && (exchangeOpen || ordersOpen)) ? 'none' : undefined,
            }}
          >
            <ShippingGazette key={captain.id} state={state} viewer={captain} />
          </div>
        )}

        {/* The rivals' turns, narrated one step at a time while the chart and the exchange play
            them back. Skip (or any key or click) shows the result at once. */}
        {replay.frame && replayCaptain && (
          <div className="tr-gazette" style={{ ...replaySlot, left: insetPx.left + 12, right: insetPx.right + 12 }}>
            <div style={{ ...replayBar, borderLeftColor: replayCaptain.colour }} role="status" aria-live="polite" data-replay-bar>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: replayCaptain.colour, flex: '0 0 auto' }} />
              {replay.frame.action.type === 'ROLL' && (
                <span key={`dice-${replay.index}`} style={{ display: 'inline-flex', gap: '0.2rem', alignItems: 'center' }}>
                  {view.ships
                    .filter(sh => sh.ownerId === replayCaptain.id && view.dice[sh.id])
                    .slice(0, 4)
                    .map(sh => (
                      <TumblingDice key={sh.id} values={view.dice[sh.id]} tumble size={15} tone={UI.brass} />
                    ))}
                </span>
              )}
              <span key={replay.index} className="tm-anim-rise" style={{ ...bodySmall, fontSize: '0.8rem', flex: '1 1 16rem', minWidth: 0 }}>
                {replay.frame.text}
              </span>
              <span style={{ ...dataText, fontSize: '0.66rem', color: UI.textFaint }}>
                {replay.index + 1}/{replay.count}
              </span>
              <Button tone="quiet" onClick={replay.skip} title="Show the result now (or press any key)">
                Skip
              </Button>
            </div>
          </div>
        )}

        {/* With a panel away, the button that brings it back waits at its edge of the chart. */}
        {!exchangeOpen && (
          <button type="button" className="tr-launcher" style={{ ...launcher, left: 12 }} onClick={() => openExchange(true)}>
            The exchange
            <span style={launcherNote}>{state.rules === 'voyage' ? 'prices' : `${state.contracts.filter(c => c.fills.length < 2).length} commissions`}</span>
          </button>
        )}
        {!ordersOpen && (
          <button type="button" className="tr-launcher" style={{ ...launcher, right: 12 }} onClick={() => openOrders(true)}>
            {captain?.kind === 'human' ? 'Your fleet and orders' : 'Fleets and log'}
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
          {/* While the race is on it is the most important thing on the board, so it leads. */}
            {race && <TeaRacePanel state={view} viewerId={captain?.id ?? null} />}
            {state.rules === 'voyage' ? (
              <MarketBoard
                state={view}
                reference={selectedShip}
                onPortClick={port => setTargetPort(port as PortId)}
              />
            ) : (
            <ContractBoard
              contracts={view.contracts}
              captains={view.captains}
              reference={selectedShip}
              round={state.round}
              deadlines={state.hazards?.deadlines ?? false}
              focusedId={focusedContract?.id ?? null}
              onFocus={contract => {
                setFocusedContract(prev => (prev?.id === contract.id ? null : contract));
                setTargetPort(null);
              }}
            />
            )}
            {!race && <TeaRacePanel state={view} viewerId={captain?.id ?? null} />}
            <CaptainsTable state={view} />
            <PortLedger
              contracts={state.contracts}
              reference={selectedShip}
              targetPort={targetPort}
              onPortClick={portId => {
                setTargetPort(portId);
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
          <PanelHead title={captain?.kind === 'human' ? 'Your fleet and orders' : 'Fleets and log'} onClose={() => setOrdersOpen(false)} />
          <div style={panelBody} className="tr-panel-body">
          {captain && (
            <>
              <FleetPanel
                ships={myShips}
                captain={captain}
                sailPoints={state.sailPoints}
                dice={state.dice}
                selectedShipId={selectedShipId}
                rolled={state.phase === 'act'}
                turn={state.turn}
                deadlines={state.hazards?.deadlines ?? false}
                raceYear={race?.year ?? null}
                crackedOn={state.crackedOn}
                renownOn={state.hazards?.renown ?? false}
                onSelect={shipId => {
                  setSelectedShipId(shipId);
                  setTargetPort(null);
                }}
              />

              {/* Orders first: in a panel that slides in, what you do every turn must not sit
                  below what you read once a game. */}
              {/* Keyed by ship and berth, so a new port's business arrives with a short rise. */}
              <div
                key={`${selectedShip?.id ?? 'none'}@${selectedShip?.location ?? 'sea'}`}
                className="tm-anim-rise"
              >
              <PortPanel
                ship={selectedShip}
                captain={captain}
                contracts={state.contracts}
                sailPoints={state.sailPoints}
                targetPort={targetPort}
                onClearTarget={() => setTargetPort(null)}
                dispatch={dispatch}
                enabled={canAct}
                sellable={state.hazards?.quaysideSales ?? false}
                agentsOn={state.hazards?.agents ?? false}
                shipSaleOn={(state.hazards?.wages || state.hazards?.loans) ?? false}
                fleetSize={myShips.length}
                priceFor={priceFor}
                paysFor={(port, good) =>
                  (state.rules === 'voyage' ? sellsFor(state, port, good) : null) ??
                  saleProceeds(state, captain?.id ?? '', port, good)
                }
                season={season}
                piracyOn={state.hazards?.piracy ?? false}
              />
              </div>

              <SeamanshipPanel
                state={state}
                captain={captain}
                ships={myShips}
                dispatch={dispatch}
                enabled={canAct}
              />

              {/* Beside the other things that lapse with the turn: a letter unanswered is declined. */}
              <LettersPanel state={state} captain={captain} dispatch={dispatch} enabled={canAct} />

              <CountingHouse
                state={state}
                captain={captain}
                fleetSize={myShips.length}
                ships={myShips}
                dispatch={dispatch}
                enabled={canAct}
              />

              <CareerPanel state={state} captain={captain} dispatch={dispatch} enabled={isHuman && (state.phase === 'act' || state.phase === 'roll')} />

              <ChartersPanel state={state} captain={captain} />
            </>
          )}

          <RivalFleets state={view} viewerId={captain?.id ?? null} />
          <ChronicleLog log={view.log} captains={view.captains} />
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
                {/* Free play closes with a reckoning, not a company changing hands. */}
                {winner
                  ? state.rules === 'voyage'
                    ? `The season closes. ${winner.name} finishes richest.`
                    : `${winner.name} carried the company.`
                  : 'The voyage is over.'}
              </span>
            ) : mustRoll ? (
              <>
                <Button id="roll-button" tone="primary" onClick={() => dispatch({ type: 'ROLL' })}>
                  Take the wind — roll for {myShips.length === 1 ? 'her' : 'the fleet'}
                </Button>
                <span className="tr-hide-phone" style={{ ...bodySmall, fontSize: '0.78rem', color: UI.textFaint }}>
                  2d6 per ship. Ships already at sea sail on the moment you roll
                  {state.hazards?.pressSail ? ', and may then be driven for one more die' : ''}.
                </span>
              </>
            ) : canAct ? (
              <>
                <Button
                  id="end-turn-button"
                  tone={confirmingEnd ? 'primary' : undefined}
                  onClick={() => {
                    // One extra click, never a block: waiting in port for cash or a better card is
                    // a real move, so the warning must be dismissible by simply repeating yourself.
                    if ((awaiting.length > 0 || offers.length > 0) && !confirmingEnd) {
                      setConfirmingEnd(true);
                      return;
                    }
                    setConfirmingEnd(false);
                    setOrdersOpen(false);
                    replay.arm(state);
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
                    color: awaiting.length > 0 || offers.length > 0 ? UI.warn : UI.textFaint,
                  }}
                >
                  {offers.length > 0 && (
                    <>
                      {offers.map(o => `${o.headline} — unanswered, it lapses when you end the turn`).join('. ')}.{' '}
                    </>
                  )}
                  {awaiting.length > 0
                    ? awaiting
                        .map(
                          w =>
                            `${w.shipName} lies at ${w.portName} with ${w.pointsUnspent} pts unspent — ${w.hint}`,
                        )
                        .join('. ') + '.'
                    : selectedShip?.location
                      ? `${selectedShip.name} lies at ${portName(selectedShip.location)}.`
                      : selectedShip && destinationOf(selectedShip)
                        ? `${selectedShip.name} is at sea.`
                        : 'Give your ships their orders.'}
                </span>
              </>
            ) : (
              <span style={{ ...bodySmall, color: UI.textFaint }}>
                {captain?.name} is taking their turn…
              </span>
            )}
          </div>
      </main>

      {/* Notable events pop as cards so the game can be watched rather than read. */}
      <EventCards
        log={view.log}
        captains={view.captains}
        viewerId={captain?.id ?? null}
        inGazette={isHuman && captain && !over ? new Set(frontPage(state, captain).map(st => st.seq)) : undefined}
      />

      {/* --- Overlays -------------------------------------------------------------------- */}
      {/* Kept mounted through the hot-seat handover (`hidden`), never unmounted: remounting threw
          away the step and the tour's memory and restarted it from the welcome card. The view is
          the plan owner's, not the active seat's — see `TourPlan.captainId`.
          Also hidden while the rivals' turns replay: its scrim would dim the replay, and its card would
          be talking about the player's own move while the screen shows someone else's. */}
      {tourPlan && tourOwner && !over && (
        <GuidedTour
          onTargetChange={revealTourTarget}
          view={{
            state,
            captain: tourOwner,
            ship: state.ships.find(sh => sh.id === tourPlan.shipId) ?? null,
            targetPort,
            focusedContract,
            selectedShipId,
            priceFor: priceLookup(state, tourOwner.id),
          }}
          plan={tourPlan}
          hidden={state.phase === 'handover' || !!replay.frame}
          onFinish={() => setTourPlan(null)}
        />
      )}

      {state.phase === 'handover' && captain && (
        <HandoverCard
          state={state}
          next={captain}
          onReady={() => dispatch({ type: 'ACKNOWLEDGE_HANDOVER' })}
        />
      )}

      {over && winner && (
        <div style={backdrop}>
          <div style={{ ...victoryCard, borderColor: winner.colour }}>
            <Vignette kind={state.rules === 'voyage' ? 'deliver' : 'victory'} size={64} colour={winner.colour} />
            <span style={{ ...dataText, fontSize: '0.62rem', letterSpacing: '0.2em', color: UI.textFaint }}>
              ROUND {state.round}
            </span>
            <h2 style={{ fontFamily: FONT.display, fontSize: '1.9rem', margin: 0, color: winner.colour }}>
              {state.rules === 'voyage'
                ? `${winner.name} finishes richest`
                : `${winner.name} carries the company`}
            </h2>
            <p style={{ ...bodySmall, margin: 0 }}>
              {state.rules === 'voyage' ? (
                <>
                  Worth {money(assetValue(state, winner))} at the close — {money(winner.cash)} in
                  hand, {state.ships.filter(s => s.ownerId === winner.id).length} ship
                  {state.ships.filter(s => s.ownerId === winner.id).length === 1 ? '' : 's'} and
                  whatever was still in the holds.
                </>
              ) : (
                <>
                  {winner.shares} shares, {money(winner.cash)} in hand and{' '}
                  {state.ships.filter(s => s.ownerId === winner.id).length} ship
                  {state.ships.filter(s => s.ownerId === winner.id).length === 1 ? '' : 's'} still
                  afloat.
                </>
              )}
            </p>
            {/* The final standings, so the close reads as the end of a race rather than one name. */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT.data, fontSize: '0.72rem' }}>
              <tbody>
                {[...state.captains]
                  .sort((a, b) =>
                    a.id === winner.id ? -1 : b.id === winner.id ? 1 : assetValue(state, b) - assetValue(state, a),
                  )
                  .map((c, i) => (
                    <tr key={c.id} style={{ borderTop: `1px solid ${UI.rule}` }}>
                      <td style={{ padding: '0.3rem 0.2rem', color: UI.textFaint }}>{i + 1}</td>
                      <td style={{ padding: '0.3rem 0.2rem', color: c.colour, fontFamily: FONT.body, fontSize: '0.82rem' }}>{c.name}</td>
                      {state.rules !== 'voyage' && (
                        <td style={{ padding: '0.3rem 0.2rem', textAlign: 'right', color: UI.textSoft }}>{c.shares} sh</td>
                      )}
                      <td style={{ padding: '0.3rem 0.2rem', textAlign: 'right', color: UI.textSoft }}>
                        worth {money(assetValue(state, c))}
                      </td>
                      {state.hazards?.teaRace && state.rules !== 'voyage' && (
                        <td style={{ padding: '0.3rem 0.2rem', textAlign: 'right', color: UI.brass, whiteSpace: 'nowrap' }}>
                          <TeaChest size={11} /> {c.teaRaceWins ?? 0}/{c.teaRaceSeconds ?? 0}
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
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

/**
 * What a quay charges for a good under the ruleset in play. Hoisted out of the Orders panel's props
 * so the guided run prices its plan exactly the way the panel will price the button it spotlights.
 */
function priceLookup(state: GameState, captainId: string) {
  return (port: PortId, good: GoodId): number =>
    state.rules === 'voyage' ? livePrice(state, port, good) : ladingPrice(state, captainId, port, good);
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

/**
 * The narration of the rivals' turns while they replay. It floats where the Shipping Gazette sits
 * (top of the chart, between the launchers), which waits for the replay to finish before it shows.
 */
const replaySlot: React.CSSProperties = {
  position: 'absolute',
  top: 56,
  zIndex: 33,
  margin: '0 auto',
  maxWidth: 620,
  boxShadow: `0 6px 20px ${UI.shadow}`,
  transition: 'left 0.25s ease, right 0.25s ease',
};

const replayBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  flexWrap: 'wrap',
  border: `1px solid ${UI.ruleStrong}`,
  borderLeftWidth: 3,
  background: UI.panel,
  backgroundImage: `linear-gradient(${UI.tintBrass}, ${UI.tintBrass})`,
  padding: '0.45rem 0.75rem',
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
