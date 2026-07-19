import { useState } from 'react';
import { formatWeekDate } from '@repo/engine';
import { useGameLocal } from './hooks/useGameLocal';
import { CITIES, CAMPAIGN_START, findCity, findEvent } from './sim/content';
import { cargoTotal } from './sim/market';
import MapView from './components/MapView';
import MarketPanel from './components/MarketPanel';
import DispatchesPanel from './components/DispatchesPanel';
import LedgerPanel from './components/LedgerPanel';
import HouseholdPanel from './components/HouseholdPanel';
import EventOverlay from './components/EventOverlay';
import PortalNav from './components/PortalNav';

const STYLE: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: '#0e0b07',
  color: '#c9b88a',
  fontFamily: '"Georgia", "Times New Roman", serif',
};

const HEADER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '1.2rem 2rem',
  borderBottom: '1px solid #4a3d28',
};

const TITLE: React.CSSProperties = {
  fontSize: '1.6rem',
  letterSpacing: '0.1em',
  color: '#e8d5a3',
  margin: 0,
};

const CLOCK: React.CSSProperties = {
  fontSize: '1rem',
  letterSpacing: '0.08em',
  color: '#8a7a5a',
};

const BODY: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const MAP_PANE: React.CSSProperties = {
  flex: 1,
  padding: '1rem',
};

const SIDEBAR: React.CSSProperties = {
  width: '320px',
  padding: '1.2rem',
  borderLeft: '1px solid #4a3d28',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.2rem',
  overflowY: 'auto',
};

const BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.5rem 0.9rem',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  textAlign: 'left',
};

const BUTTON_ACTIVE: React.CSSProperties = {
  ...BUTTON,
  borderColor: '#e8d5a3',
  color: '#e8d5a3',
};

export default function App() {
  const { state, error, dispatch, resetGame } = useGameLocal();
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(state.vessels[0]?.id ?? null);

  const selectedVessel = state.vessels.find(v => v.id === selectedVesselId) ?? null;
  const dockedCityIds = new Set(state.vessels.filter(v => !v.destination).map(v => v.location));
  const cityInfoAge: Record<string, number | null> = {};
  for (const c of CITIES) {
    const report = state.knownPrices[c.id];
    cityInfoAge[c.id] = dockedCityIds.has(c.id) ? 0 : report ? state.week - report.trueAsOfWeek : null;
  }

  const handleSelectCity = (cityId: string) => {
    if (!selectedVessel) return;
    dispatch({ type: 'DISPATCH_VESSEL', vesselId: selectedVessel.id, destinationId: cityId });
  };

  if (state.insolvent) {
    return (
      <div style={STYLE}>
        <PortalNav variant="header" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
          <h1 style={TITLE}>The house is insolvent</h1>
          <p style={{ color: '#8a7a5a', maxWidth: '28rem', textAlign: 'center' }}>
            A matured obligation could not be met, even after a forced sale of every docked cargo.
            The company is ruined in {formatWeekDate(state.week, CAMPAIGN_START)}.
          </p>
          <button style={BUTTON} onClick={resetGame}>
            Start a new campaign
          </button>
        </div>
        <PortalNav variant="footer" />
      </div>
    );
  }

  const pendingEvent = state.pendingEvents[0] ? findEvent(state.pendingEvents[0]) : null;

  return (
    <div style={STYLE}>
      {pendingEvent && (
        <EventOverlay
          event={pendingEvent}
          onChoose={choiceIndex => dispatch({ type: 'RESOLVE_EVENT', eventId: pendingEvent.id, choiceIndex })}
        />
      )}
      <PortalNav variant="header" />
      <header style={HEADER}>
        <h1 style={TITLE}>Banco di Niccolo</h1>
        <span style={CLOCK}>
          {Math.round(state.cash)}f &nbsp;·&nbsp; {formatWeekDate(state.week, CAMPAIGN_START)}
          &nbsp;·&nbsp; conscience {Math.round(state.conscience)}
        </span>
      </header>

      <div style={BODY}>
        <div style={MAP_PANE}>
          <MapView
            vessels={state.vessels}
            selectedVesselId={selectedVesselId}
            onSelectCity={handleSelectCity}
            cityInfoAge={cityInfoAge}
          />
        </div>

        <div style={SIDEBAR}>
          <div>
            <p style={{ fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8a7a5a' }}>
              Vessels
            </p>
            {state.vessels.map(v => {
              const at = findCity(v.location);
              const to = v.destination ? findCity(v.destination) : null;
              const held = cargoTotal(v.cargo);
              return (
                <button
                  key={v.id}
                  style={v.id === selectedVesselId ? BUTTON_ACTIVE : BUTTON}
                  onClick={() => setSelectedVesselId(v.id)}
                >
                  {v.name}
                  <br />
                  <span style={{ fontSize: '0.75rem', color: '#8a7a5a' }}>
                    {to
                      ? `en route to ${to.name} — ${v.weeksRemaining} week${v.weeksRemaining === 1 ? '' : 's'} left`
                      : `docked at ${at?.name ?? v.location}`}
                    {v.capacity > 0 && ` · hold ${held}/${v.capacity}`}
                  </span>
                </button>
              );
            })}
          </div>

          <p style={{ fontSize: '0.8rem', color: '#8a7a5a', margin: 0 }}>
            {selectedVessel
              ? selectedVessel.destination
                ? `${selectedVessel.name} cannot be redirected while under way.`
                : `Select a lit city on the map to send ${selectedVessel.name} there.`
              : 'Select a vessel.'}
          </p>

          {selectedVessel && !selectedVessel.destination && selectedVessel.capacity > 0 && (
            <MarketPanel
              cityId={selectedVessel.location}
              cityName={findCity(selectedVessel.location)?.name ?? selectedVessel.location}
              cash={state.cash}
              cargo={selectedVessel.cargo}
              capacity={selectedVessel.capacity}
              scarcity={state.scarcity}
              onBuy={(goodId, quantity) =>
                dispatch({ type: 'BUY_GOOD', vesselId: selectedVessel.id, goodId, quantity })
              }
              onSell={(goodId, quantity) =>
                dispatch({ type: 'SELL_GOOD', vesselId: selectedVessel.id, goodId, quantity })
              }
            />
          )}

          <DispatchesPanel
            week={state.week}
            cash={state.cash}
            knownPrices={state.knownPrices}
            pendingNews={state.pendingNews}
            courierInvestment={state.courierInvestment}
            characters={state.characters}
            dockedCityIds={dockedCityIds}
            onInvest={cityId => dispatch({ type: 'INVEST_COURIER', cityId })}
          />

          <HouseholdPanel
            characters={state.characters}
            vessels={state.vessels}
            cash={state.cash}
            conscience={state.conscience}
            onAssign={(characterId, assignment) => dispatch({ type: 'ASSIGN_CHARACTER', characterId, assignment })}
          />

          <LedgerPanel
            week={state.week}
            cash={state.cash}
            exchangeRates={state.exchangeRates}
            obligations={state.obligations}
            onWriteBill={(cityId, florins, termWeeks) => dispatch({ type: 'WRITE_BILL', cityId, florins, termWeeks })}
            onTakeDeposit={(florins, termWeeks) => dispatch({ type: 'TAKE_DEPOSIT', florins, termWeeks })}
            onWriteLoan={(kind, florins, termWeeks) => dispatch({ type: 'WRITE_LOAN', kind, florins, termWeeks })}
            onDiscount={obligationId => dispatch({ type: 'DISCOUNT_OBLIGATION', obligationId })}
          />

          {error && <p style={{ fontSize: '0.8rem', color: '#b5451a', margin: 0 }}>{error}</p>}

          <button style={BUTTON} onClick={() => dispatch({ type: 'ADVANCE_WEEK' })}>
            Advance one week
          </button>

          <button style={{ ...BUTTON, marginTop: 'auto', color: '#6a5a40' }} onClick={resetGame}>
            Reset campaign
          </button>
        </div>
      </div>
      <PortalNav variant="footer" />
    </div>
  );
}
