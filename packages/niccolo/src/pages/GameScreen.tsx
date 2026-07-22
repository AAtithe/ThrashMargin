import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatWeekDate } from '../sim/clock';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { CITIES, CAMPAIGN_START, HOUSES, findCity, findEvent } from '../sim/content';
import { canInsureAt } from '../sim/insurance';
import { cargoTotal } from '../sim/market';
import MapView from '../components/MapView';
import MarketPanel from '../components/MarketPanel';
import DispatchesPanel from '../components/DispatchesPanel';
import LedgerPanel from '../components/LedgerPanel';
import HouseholdPanel from '../components/HouseholdPanel';
import HousesPanel from '../components/HousesPanel';
import SecretsPanel from '../components/SecretsPanel';
import EstatePanel from '../components/EstatePanel';
import EventOverlay from '../components/EventOverlay';
import TutorialOverlay, { hasSeenTutorial } from '../components/TutorialOverlay';
import GuidedTour from '../components/GuidedTour';
import PortalNav from '../components/PortalNav';

const STYLE: React.CSSProperties = {
  // Bounded to the viewport (not just a minimum) so BODY's flex:1 has a real cap to divide —
  // otherwise the sidebar's own content height (many stacked panels) stretches this whole
  // container taller, and MAP_PANE's height:100% svg stretches right along with it, pushing
  // cities near the bottom of the map below the fold. SIDEBAR already scrolls internally
  // (overflowY: auto); this is what lets that actually take effect instead of growing the page.
  height: '100vh',
  overflow: 'hidden',
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

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={STYLE}>
      <PortalNav variant="header" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#8a7a5a' }}>{children}</p>
      </div>
      <PortalNav variant="footer" />
    </div>
  );
}

export default function GameScreen() {
  const { id } = useParams<{ id: string }>();
  const { state, error, dispatch, loadGame, deleteGame } = useGameHybrid();
  const nav = useNavigate();
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [insureNext, setInsureNext] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showGuidedTour, setShowGuidedTour] = useState(false);

  useEffect(() => {
    if (id) loadGame(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedVesselId(state?.vessels[0]?.id ?? null);
  }, [state?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setInsureNext(false);
  }, [selectedVesselId]);

  // Show once per browser, the first time this screen is reached with no scripted event already
  // in the way — a local UI preference, not campaign state, so it isn't part of GameState/saves.
  useEffect(() => {
    if (!state) return;
    if (state.pendingEvents.length > 0) return;
    if (hasSeenTutorial()) return;
    setShowTutorial(true);
  }, [state?.id, state?.pendingEvents.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const abandonAndReturn = () => {
    if (id) deleteGame(id);
    nav('/');
  };

  if (!state) {
    return <CenteredMessage>Loading campaign…</CenteredMessage>;
  }

  const selectedVessel = state.vessels.find(v => v.id === selectedVesselId) ?? null;
  const dockedCityIds = new Set(state.vessels.filter(v => !v.destination).map(v => v.location));
  const cityInfoAge: Record<string, number | null> = {};
  for (const c of CITIES) {
    const report = state.knownPrices[c.id];
    cityInfoAge[c.id] = dockedCityIds.has(c.id) ? 0 : report ? state.week - report.trueAsOfWeek : null;
  }

  const handleSelectCity = (cityId: string) => {
    if (!selectedVessel) return;
    dispatch({ type: 'DISPATCH_VESSEL', vesselId: selectedVessel.id, destinationId: cityId, insure: insureNext });
    setInsureNext(false);
  };

  // The guided tour's steps are scripted for a fresh campaign's exact starting position (the
  // ship docked, empty-handed, at Bruges) — only offer it while that's still true, rather than
  // risk a stale instruction ("click Ghent") that no longer matches where the ship actually is.
  const ship = state.vessels.find(v => v.id === 'ship_1');
  const canGuidedTour = state.week === 0 && !!ship && ship.location === 'bruges' && !ship.destination;

  const activePolicy = selectedVessel ? state.insurance.find(i => i.vesselId === selectedVessel.id) : undefined;
  const canOfferInsurance =
    !!selectedVessel &&
    !selectedVessel.destination &&
    canInsureAt(selectedVessel.location) &&
    cargoTotal(selectedVessel.cargo) > 0;

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
          <button style={BUTTON} onClick={() => nav('/')}>
            Return to campaigns
          </button>
        </div>
        <PortalNav variant="footer" />
      </div>
    );
  }

  if (state.flags.chapter3_complete) {
    const secretsUsed = state.secrets.filter(s => s.used).length;
    const secretsExpired = state.secrets.filter(s => s.expired).length;
    const departed = state.characters.filter(c => c.status === 'departed');
    const siegeSurvived = !!state.flags.famagusta_siege_survived;
    return (
      <div style={STYLE}>
        <PortalNav variant="header" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
          <h1 style={TITLE}>Chapter 3 — Race of Scorpions</h1>
          <p style={{ color: '#e8d5a3', maxWidth: '30rem', textAlign: 'center' }}>
            {siegeSurvived
              ? "Famagusta falls, but the house got its people and Kouklia's sugar out first. A crown changed hands on its own schedule; the branch outlasts the war around it."
              : "Famagusta falls before the house could get everything clear of it. A branch survives Cyprus. Not everyone does."}
          </p>
          <p style={{ color: '#8a7a5a', maxWidth: '30rem', textAlign: 'center', fontSize: '0.9rem' }}>
            Concluded in {formatWeekDate(state.week, CAMPAIGN_START)}, {Math.round(state.cash)}f on hand, conscience{' '}
            {Math.round(state.conscience)}. Secrets used: {secretsUsed}, expired unused: {secretsExpired}.
            {departed.length > 0
              ? ` Left the company along the way: ${departed.map(c => c.name).join(', ')}.`
              : ' The household is intact.'}
          </p>
          <button style={BUTTON} onClick={() => nav('/')}>
            Return to campaigns
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
      {showTutorial && !showGuidedTour && !pendingEvent && (
        <TutorialOverlay
          onClose={() => setShowTutorial(false)}
          onStartGuidedTour={
            canGuidedTour
              ? () => {
                  setShowTutorial(false);
                  setShowGuidedTour(true);
                }
              : undefined
          }
        />
      )}
      {showGuidedTour && !showTutorial && !pendingEvent && (
        <GuidedTour state={state} selectedVesselId={selectedVesselId} onFinish={() => setShowGuidedTour(false)} />
      )}
      <PortalNav variant="header" />
      <header style={HEADER}>
        <h1 style={TITLE}>{state.name ?? 'Banco di Niccolo'}</h1>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.2rem' }}>
          <span style={CLOCK}>
            {Math.round(state.cash)}f &nbsp;·&nbsp; {formatWeekDate(state.week, CAMPAIGN_START)}
            &nbsp;·&nbsp; conscience {Math.round(state.conscience)}
          </span>
          {canGuidedTour && (
            <button
              style={{ ...BUTTON, padding: '0.35rem 0.7rem', fontSize: '0.75rem' }}
              onClick={() => { setShowTutorial(false); setShowGuidedTour(true); }}
            >
              Guided tour
            </button>
          )}
          <button
            style={{ ...BUTTON, padding: '0.35rem 0.7rem', fontSize: '0.75rem' }}
            onClick={() => { setShowGuidedTour(false); setShowTutorial(true); }}
          >
            How to play
          </button>
        </div>
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

        <div id="game-sidebar" style={SIDEBAR}>
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
                  id={`vessel-button-${v.id}`}
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

          {state.lastVoyageEvent && (
            <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: 0 }}>
              Week {state.lastVoyageEvent.week}: storm struck {state.lastVoyageEvent.vesselName} — lost{' '}
              {state.lastVoyageEvent.quantityLost} {state.lastVoyageEvent.goodId}.{' '}
              {state.lastVoyageEvent.insured
                ? <span style={{ color: '#3a6b5a' }}>Insurance paid {state.lastVoyageEvent.payout}f.</span>
                : <span style={{ color: '#b5451a' }}>Uninsured — a total loss.</span>}
            </p>
          )}

          <p style={{ fontSize: '0.8rem', color: '#8a7a5a', margin: 0 }}>
            {selectedVessel
              ? selectedVessel.destination
                ? `${selectedVessel.name} cannot be redirected while under way.`
                : `Select a lit city on the map to send ${selectedVessel.name} there.`
              : 'Select a vessel.'}
          </p>

          {activePolicy && (
            <p style={{ fontSize: '0.75rem', color: '#3a6b5a', margin: 0 }}>
              Insured for {Math.round(activePolicy.coverage)}f this voyage (premium {activePolicy.premiumPaid}f paid).
            </p>
          )}

          {canOfferInsurance && (
            <label style={{ fontSize: '0.75rem', color: '#8a7a5a', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={insureNext} onChange={e => setInsureNext(e.target.checked)} />
              <span>
                Insure this cargo before it departs — underwritten here at{' '}
                {findCity(selectedVessel!.location)?.name}. Premium reflects the route's risk and how stale our
                own word from the destination is; charged when you choose where to send{' '}
                {selectedVessel!.name}.
              </span>
            </label>
          )}

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
            condotta={state.condotta}
            onAssign={(characterId, assignment) => dispatch({ type: 'ASSIGN_CHARACTER', characterId, assignment })}
          />

          <SecretsPanel
            secrets={state.secrets}
            week={state.week}
            onUse={secretId => dispatch({ type: 'USE_SECRET', secretId })}
          />

          <HousesPanel
            houses={HOUSES}
            houseRelations={state.houseRelations}
            agents={state.agents}
            cash={state.cash}
            onPlaceAgent={(placement, name) => dispatch({ type: 'PLACE_AGENT', placement, name })}
          />

          <EstatePanel
            estate={state.estate}
            flags={state.flags}
            cash={state.cash}
            selectedVessel={selectedVessel}
            onEstablish={() => dispatch({ type: 'ESTABLISH_ESTATE' })}
            onHarvest={() => dispatch({ type: 'HARVEST_ESTATE' })}
            onShip={(vesselId, quantity) => dispatch({ type: 'SHIP_ESTATE_GOODS', vesselId, quantity })}
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

          <button id="advance-week-button" style={BUTTON} onClick={() => dispatch({ type: 'ADVANCE_WEEK' })}>
            Advance one week
          </button>

          <button style={{ ...BUTTON, marginTop: 'auto', color: '#6a5a40' }} onClick={() => nav('/')}>
            ← Back to campaigns
          </button>
          <button style={{ ...BUTTON, color: '#6a5a40' }} onClick={abandonAndReturn}>
            Abandon this campaign
          </button>
        </div>
      </div>
      <PortalNav variant="footer" />
    </div>
  );
}
