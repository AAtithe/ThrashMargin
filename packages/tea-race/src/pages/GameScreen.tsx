import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { planRoute, portName } from '../sim/content';
import { destinationOf } from '../sim/movement';
import { DECLARATION_ROUNDS, SHARE_MAJORITY, VICTORY_CASH } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import MapView from '../components/MapView';
import ContractBoard from '../components/ContractBoard';
import FleetPanel from '../components/FleetPanel';
import PortPanel from '../components/PortPanel';
import CountingHouse from '../components/CountingHouse';
import PortLedger from '../components/PortLedger';
import CaptainsTable from '../components/CaptainsTable';
import ChronicleLog from '../components/ChronicleLog';
import HandoverCard from '../components/HandoverCard';
import { Button, bodySmall, dataText } from '../components/ui';
import type { Contract, PortId } from '../sim/types';

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

  if (!state) {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ ...bodySmall, textAlign: 'center', maxWidth: '40ch' }}>
          {error ?? 'Loading the voyage…'}
        </p>
        {error && (
          <Button onClick={() => navigate('/')} style={{ marginTop: '0.8rem' }}>
            Back to the lobby
          </Button>
        )}
      </div>
    );
  }

  const selectedShip = state.ships.find(s => s.id === selectedShipId) ?? null;
  const isHuman = captain?.kind === 'human';
  const canAct = state.phase === 'act' && isHuman;
  const mustRoll = state.phase === 'roll' && isHuman;
  const over = state.phase === 'over';

  /** The course drawn on the chart: what the selected ship is running, or what she's being sent on. */
  const plannedRoute: PortId[] | null = (() => {
    if (!selectedShip) return null;
    if (selectedShip.voyage) return [selectedShip.voyage.legFrom, ...selectedShip.voyage.route];
    if (selectedShip.location && targetPort && targetPort !== selectedShip.location) {
      const route = planRoute(selectedShip.location, targetPort);
      return route ? [selectedShip.location, ...route.path] : null;
    }
    if (focusedContract) {
      const from = selectedShip.location;
      if (!from) return null;
      const carrying = selectedShip.cargo?.good === focusedContract.good;
      const to = carrying ? focusedContract.destination : focusedContract.source;
      const route = planRoute(from, to);
      return route ? [from, ...route.path] : null;
    }
    return null;
  })();

  const winner = state.winnerId ? state.captains.find(c => c.id === state.winnerId) : null;

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

        {captain && !over && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: captain.colour }} />
              <span style={{ fontFamily: FONT.display, fontSize: '0.92rem' }}>{captain.name}</span>
            </span>
            <span style={{ ...dataText, fontSize: '0.8rem', color: UI.brass }}>{money(captain.cash)}</span>
            <span style={{ ...dataText, fontSize: '0.8rem', color: UI.verdigris }}>
              {captain.shares} share{captain.shares === 1 ? '' : 's'}
            </span>
          </div>
        )}

        <Button tone="quiet" onClick={() => navigate('/')}>
          Lobby
        </Button>
      </header>

      {/* --- Declaration clock ----------------------------------------------------------- */}
      {state.declaration && !over && (
        <div style={declarationBanner} role="status">
          <strong style={{ color: UI.warn }}>
            {state.captains.find(c => c.id === state.declaration!.captainId)?.name} has claimed the
            company.
          </strong>{' '}
          {state.declaration.roundsRemaining} of {DECLARATION_ROUNDS} rounds left. At the close they
          must still hold {SHARE_MAJORITY} shares, {money(VICTORY_CASH)} and a ship.
        </div>
      )}

      {/* --- Board -------------------------------------------------------------------- */}
      <main style={board}>
        <div style={mapColumn}>
          <MapView
            ships={state.ships}
            captains={state.captains}
            contracts={state.contracts}
            selectedShipId={selectedShipId}
            plannedRoute={plannedRoute}
            onPortClick={portId => {
              setTargetPort(portId);
              setFocusedContract(null);
            }}
          />

          <div style={turnBar}>
            {over ? (
              <span style={{ ...bodySmall, color: UI.brass }}>
                {winner ? `${winner.name} carried the company.` : 'The voyage is over.'}
              </span>
            ) : mustRoll ? (
              <>
                <Button tone="primary" onClick={() => dispatch({ type: 'ROLL' })}>
                  Take the wind — roll for {myShips.length === 1 ? 'her' : 'the fleet'}
                </Button>
                <span style={{ ...bodySmall, fontSize: '0.78rem', color: UI.textFaint }}>
                  2d6 per ship. Ships already at sea sail on the moment you roll.
                </span>
              </>
            ) : canAct ? (
              <>
                <Button onClick={() => dispatch({ type: 'END_TURN' })}>End the turn</Button>
                <span style={{ ...bodySmall, fontSize: '0.78rem', color: UI.textFaint }}>
                  {selectedShip?.location
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

        <aside style={sidebar} id="game-sidebar">
          <ContractBoard
            contracts={state.contracts}
            captains={state.captains}
            reference={selectedShip}
            focusedId={focusedContract?.id ?? null}
            onFocus={contract => {
              setFocusedContract(prev => (prev?.id === contract.id ? null : contract));
              setTargetPort(null);
            }}
          />

          {captain && (
            <>
              <FleetPanel
                ships={myShips}
                captain={captain}
                sailPoints={state.sailPoints}
                dice={state.dice}
                selectedShipId={selectedShipId}
                rolled={state.phase === 'act'}
                onSelect={shipId => {
                  setSelectedShipId(shipId);
                  setTargetPort(null);
                }}
              />

              <PortPanel
                ship={selectedShip}
                captain={captain}
                contracts={state.contracts}
                sailPoints={state.sailPoints}
                targetPort={targetPort}
                onClearTarget={() => setTargetPort(null)}
                dispatch={dispatch}
                enabled={canAct}
              />

              <CountingHouse
                state={state}
                captain={captain}
                fleetSize={myShips.length}
                dispatch={dispatch}
                enabled={canAct}
              />
            </>
          )}

          <CaptainsTable state={state} />
          <ChronicleLog log={state.log} captains={state.captains} />
        </aside>
      </main>

      {/* --- Overlays -------------------------------------------------------------------- */}
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
            <span style={{ ...dataText, fontSize: '0.62rem', letterSpacing: '0.2em', color: UI.textFaint }}>
              ROUND {state.round}
            </span>
            <h2 style={{ fontFamily: FONT.display, fontSize: '1.9rem', margin: 0, color: winner.colour }}>
              {winner.name} carries the company
            </h2>
            <p style={{ ...bodySmall, margin: 0 }}>
              {winner.shares} shares, {money(winner.cash)} in hand and{' '}
              {state.ships.filter(s => s.ownerId === winner.id).length} ship
              {state.ships.filter(s => s.ownerId === winner.id).length === 1 ? '' : 's'} still afloat.
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

const declarationBanner: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderBottom: `1px solid ${UI.rule}`,
  background: 'rgba(217, 164, 65, 0.09)',
  fontFamily: FONT.body,
  fontSize: '0.82rem',
  color: UI.textSoft,
};

const board: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  gap: '0.9rem',
  padding: '0.9rem',
  flex: 1,
};

const mapColumn: React.CSSProperties = {
  flex: '1 1 560px',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const sidebar: React.CSSProperties = {
  flex: '1 1 330px',
  maxWidth: 420,
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
