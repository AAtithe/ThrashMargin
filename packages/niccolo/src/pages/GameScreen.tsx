import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatWeekDate } from '../sim/clock';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { CITIES, CAMPAIGN_START, HOUSES, findCity, findEvent, findGood, findHouse, findRouteById, otherEndOfRoute } from '../sim/content';
import type { PlannedRoute } from '../sim/content';
import { cargoTotal } from '../sim/market';
import { activeCharacters, assignmentSummary } from '../sim/characters';
import { currentChapterNumber, objectivesForChapter, CHAPTER_TITLES } from '../sim/objectives';
import { canInsureAt } from '../sim/insurance';
import type { Character } from '../sim/types';
import MapView from '../components/MapView';
import MarketPanel from '../components/MarketPanel';
import CityPreviewPanel from '../components/CityPreviewPanel';
import DispatchesPanel from '../components/DispatchesPanel';
import LedgerPanel from '../components/LedgerPanel';
import CountingHousePanel from '../components/CountingHousePanel';
import HouseholdPanel from '../components/HouseholdPanel';
import HousesPanel from '../components/HousesPanel';
import SecretsPanel from '../components/SecretsPanel';
import EstatePanel from '../components/EstatePanel';
import ObjectivesPanel from '../components/ObjectivesPanel';
import ChapterCompleteCard from '../components/ChapterCompleteCard';
import CampaignProgress from '../components/CampaignProgress';
import ChronicleLog from '../components/ChronicleLog';
import PhaseStepper from '../components/PhaseStepper';
import HotseatDecisionModal from '../components/HotseatDecisionModal';
import EventOverlay from '../components/EventOverlay';
import TutorialOverlay, { hasSeenTutorial, hasSeenChapter0Tutorial } from '../components/TutorialOverlay';
import GuidedTour from '../components/GuidedTour';
import PortalNav from '../components/PortalNav';

type TurnPhase = 'trade' | 'household' | 'finance';
const PHASE_TABS_KEY = 'niccolo_phase_tabs_enabled';
function readPhaseTabsEnabled(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(PHASE_TABS_KEY) === 'true';
}
const PHASE_STEPS: { id: TurnPhase; label: string }[] = [
  { id: 'trade', label: 'Trade & Dispatch' },
  { id: 'household', label: 'Household & Intelligence' },
  { id: 'finance', label: 'Counting House' },
];

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
  padding: '0.5rem',
  // Anchors MapView's absolutely-positioned "Reset view" control to this pane's own corner,
  // independent of the map's internal pan/zoom transform.
  position: 'relative',
};

const SIDEBAR: React.CSSProperties = {
  width: '280px',
  padding: '1.2rem',
  borderRight: '1px solid #4a3d28',
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
  // Override the full `border` shorthand, not just `borderColor` — mixing a shorthand and a
  // longhand for the same property across renders of the same element (toggling between BUTTON
  // and BUTTON_ACTIVE, as the vessel selector and the Ledger/Counting House tabs both do) is a
  // real React warning ("Removing borderColor border"), not just a lint nag.
  border: '1px solid #e8d5a3',
  color: '#e8d5a3',
};

const SMALL_BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.2rem 0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  cursor: 'pointer',
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
  const [previewCityId, setPreviewCityId] = useState<string | null>(null);
  const [insureNext, setInsureNext] = useState(false);
  // Phase 15: whether to insure the next leg of a *queued* journey, keyed per vessel since more
  // than one vessel could have a plan queued at once — separate from `insureNext` above, which is
  // scoped to the CityPreviewPanel's own direct-dispatch flow and would otherwise carry a stale
  // checked/unchecked value across an unrelated vessel's "Continue?" prompt.
  const [continueInsure, setContinueInsure] = useState<Record<string, boolean>>({});
  const [showTutorial, setShowTutorial] = useState(false);
  const [showGuidedTour, setShowGuidedTour] = useState(false);
  const [showChronicle, setShowChronicle] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<'ledger' | 'countingHouse'>('ledger');
  // Multi-step turns (Phase 14): a local UI preference, not campaign state (mirrors
  // hasSeenTutorial()'s own reasoning) — organizational tabs only, never a gate, so it's safe to
  // flip mid-campaign or leave off entirely without affecting the simulation at all.
  const [phaseTabsEnabled, setPhaseTabsEnabled] = useState(readPhaseTabsEnabled);
  const [activePhase, setActivePhase] = useState<TurnPhase>('trade');
  const [visitedPhases, setVisitedPhases] = useState<Set<TurnPhase>>(new Set(['trade']));
  const [showHotseatModal, setShowHotseatModal] = useState(false);

  useEffect(() => {
    if (id) loadGame(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedVesselId(state?.vessels[0]?.id ?? null);
  }, [state?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setInsureNext(false);
    // Default the preview to wherever the newly-selected vessel actually is, so the sidebar shows
    // something useful immediately rather than staying empty until the map is clicked.
    setPreviewCityId(state?.vessels.find(v => v.id === selectedVesselId)?.location ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVesselId]);

  // Show once per browser, the first time this screen is reached with no scripted event already
  // in the way — a shorter Chapter-0-specific walkthrough while the prologue is still running (its
  // own "no capital, a handcart" framing), then the main one once Chapter 0 concludes and the real
  // resources ("You hold 40 florins, a ship...") actually exist. Tracked as two separate one-time
  // flags so a campaign that plays through both chapters sees each, once. A local UI preference,
  // not campaign state, so neither flag lives in GameState/saves.
  useEffect(() => {
    if (!state) return;
    if (state.pendingEvents.length > 0) return;
    if (state.flags.chapter0_complete) {
      if (hasSeenTutorial()) return;
    } else {
      if (hasSeenChapter0Tutorial()) return;
    }
    setShowTutorial(true);
  }, [state?.id, state?.pendingEvents.length, state?.flags.chapter0_complete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Multi-step turns: a new week starts back on the first tab, with a fresh "visited" slate —
  // fresh arrivals/prices/wages are worth reviewing from the top, not wherever last week's stepper
  // happened to end up.
  useEffect(() => {
    setActivePhase('trade');
    setVisitedPhases(new Set(['trade']));
  }, [state?.week]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePhaseTabs = () => {
    setPhaseTabsEnabled(prev => {
      const next = !prev;
      localStorage.setItem(PHASE_TABS_KEY, String(next));
      return next;
    });
  };

  const selectPhase = (id: string) => {
    const phase = id as TurnPhase;
    setActivePhase(phase);
    setVisitedPhases(prev => new Set(prev).add(phase));
  };

  // The tour's Household/Finance steps spotlight controls that live inside a phase tab — force the
  // right one open exactly when that step becomes current (not just once for the tour's whole
  // duration, so backing up or resuming mid-tour still lands on an unhidden target). Both panels in
  // each group stay mounted regardless (toggled via `display`), so a hidden target would otherwise
  // measure as a zero-size rect instead of spotlighting anything.
  const handleTourStepChange = (requiresPhase: 'household' | 'finance' | undefined) => {
    if (!requiresPhase) return;
    if (phaseTabsEnabled) selectPhase(requiresPhase);
    if (requiresPhase === 'finance') setLedgerTab('countingHouse');
  };

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

  // Clicking a city (reachable or not) only previews it — see CityPreviewPanel — so the player
  // can check prices before committing. Dispatch is a separate, explicit confirmation.
  const handlePreviewCity = (cityId: string) => setPreviewCityId(cityId);

  const handleConfirmDispatch = () => {
    if (!selectedVessel || !previewCityId) return;
    dispatch({ type: 'DISPATCH_VESSEL', vesselId: selectedVessel.id, destinationId: previewCityId, insure: insureNext });
    setInsureNext(false);
  };

  // Phase 15: dispatches the first hop of a multi-leg plan and queues the rest — the vessel still
  // stops, docks, and becomes tradeable at every intermediate city exactly as a manual redispatch
  // would; only the "what to do next" reminder is automated.
  const handleQueueRoute = (plan: PlannedRoute) => {
    if (!selectedVessel) return;
    const firstRoute = findRouteById(plan.routeIds[0]);
    if (!firstRoute) return;
    const firstHop = otherEndOfRoute(firstRoute, selectedVessel.location);
    dispatch({
      type: 'DISPATCH_VESSEL',
      vesselId: selectedVessel.id,
      destinationId: firstHop,
      insure: insureNext,
      plannedRoute: plan.routeIds.slice(1),
    });
    setInsureNext(false);
  };

  // The guided tour's trade-loop steps need the ship to actually exist and be free to dispatch —
  // true once Chapter 0 hands it over (or immediately, for a skip-prologue campaign). It's no
  // longer tied to week 0: Chapter 0 itself now owns the player's very first moves, and this tour
  // covers the systems that come after — Household, Dispatches, the Ledger — that a prologue
  // player wouldn't have touched yet either.
  const ship = state.vessels.find(v => v.id === 'ship_1');
  const canGuidedTour = !!state.flags.chapter0_complete && !!ship && !ship.destination;

  const activePolicy = selectedVessel ? state.insurance.find(i => i.vesselId === selectedVessel.id) : undefined;
  const previewCity = previewCityId ? findCity(previewCityId) : undefined;
  const expeditionVessel = state.expedition ? state.vessels.find(v => v.id === state.expedition!.vesselId) : undefined;

  // Hotseat house experiment (Phase 14): if a house is seated this campaign, "Advance one week"
  // opens a decision prompt instead of dispatching immediately — see HotseatDecisionModal.
  const hotseatHouse = state.hotseatHouseId ? findHouse(state.hotseatHouseId) : undefined;
  const hotseatSabotageEligible = !!(
    hotseatHouse &&
    state.vessels.some(v => !v.destination && v.location === hotseatHouse.homeCity && cargoTotal(v.cargo) > 0)
  );
  const handleAdvanceClick = () => {
    if (hotseatHouse) setShowHotseatModal(true);
    else dispatch({ type: 'ADVANCE_WEEK' });
  };

  const objectiveChapter = currentChapterNumber(state);
  const objectiveProgress = state.objectivesHidden ? [] : objectivesForChapter(state, objectiveChapter);

  // Phase 15: reaching chapter1/2/3_complete used to produce zero UI feedback — the next chapter's
  // own opening event fires the same tick, in the exact render slot a full-screen ending used to
  // occupy before it got moved forward each time a new chapter shipped. `lastAcknowledgedChapter`
  // is persisted (not a component-local ref) precisely so a reload between the flag flipping and
  // the player clicking "Continue" can't silently skip the card — see its own doc comment.
  const lastAcknowledgedChapter = state.lastAcknowledgedChapter ?? 0;
  const showChapterCompleteCard = objectiveChapter > lastAcknowledgedChapter;
  const closedChapterNumber = objectiveChapter - 1;
  const closedChapterProgress =
    showChapterCompleteCard && !state.objectivesHidden ? objectivesForChapter(state, closedChapterNumber) : [];

  // Chronicle (Phase 15 fast-follow): every chapter already closed, oldest first — same read-only
  // projection as the live panel, just re-read for a past chapter number.
  const chronicleChapters = state.objectivesHidden
    ? []
    : Array.from({ length: objectiveChapter }, (_, n) => ({
        chapterNumber: n,
        title: CHAPTER_TITLES[n] ?? `Chapter ${n}`,
        progress: objectivesForChapter(state, n),
      }));

  // Everything currently owned that isn't cash: cargo held across every vessel, combined — shown
  // in the header so "what you own" is visible at a glance without opening each vessel in turn.
  const heldGoods: Record<string, number> = {};
  for (const v of state.vessels) {
    for (const [goodId, quantity] of Object.entries(v.cargo)) {
      if (quantity > 0) heldGoods[goodId] = (heldGoods[goodId] ?? 0) + quantity;
    }
  }
  const heldGoodsSummary = Object.entries(heldGoods)
    .map(([goodId, quantity]) => `${quantity} ${findGood(goodId)?.name ?? goodId}`)
    .join(', ');

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

  if (state.flags.chapter4_complete) {
    const secretsUsed = state.secrets.filter(s => s.used).length;
    const secretsExpired = state.secrets.filter(s => s.expired).length;
    const departed = state.characters.filter(c => c.status === 'departed');
    const gambiaSucceeded = !!state.flags.gambia_expedition_success;
    const umarShownMercy = !!state.flags.umars_choice_mercy;
    return (
      <div style={STYLE}>
        <PortalNav variant="header" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
          <h1 style={TITLE}>Chapter 4 — Scales of Gold</h1>
          <p style={{ color: '#e8d5a3', maxWidth: '30rem', textAlign: 'center' }}>
            {gambiaSucceeded
              ? "The ship came back from the Gambia with gold in its hold and fewer hands than sailed with it — a fortune the house's Bruges ledger has no real precedent for, and a river that took its own price regardless."
              : "The Gambia venture cost more than it returned. Whatever the fever and the current didn't take, the delay finally did, and the house's ledger shows it plainly."}
          </p>
          <p style={{ color: '#8a7a5a', maxWidth: '30rem', textAlign: 'center', fontSize: '0.9rem' }}>
            Concluded in {formatWeekDate(state.week, CAMPAIGN_START)}, {Math.round(state.cash)}f on hand, conscience{' '}
            {Math.round(state.conscience)}. {umarShownMercy ? "Umar's kin were bought clear of Timbuktu." : "Umar's own business at Timbuktu was left to him."}{' '}
            Secrets used: {secretsUsed}, expired unused: {secretsExpired}.
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

  // Fleet & Household: one combined "who is where" list replacing the old plain Vessels list —
  // every officer nested under whichever vessel they're aboard, or listed with their own plain
  // assignment line below. At most ~6 characters and 3 vessels ever exist, so a partition pass is
  // simplest — no need for a Map keyed by vessel id.
  const activeRoster = activeCharacters(state.characters);
  const aboardRoster = activeRoster.filter(
    (c): c is Character & { assignment: { type: 'aboard'; vesselId: string } } => c.assignment.type === 'aboard',
  );
  const notAboardRoster = activeRoster.filter(c => c.assignment.type !== 'aboard');

  return (
    <div style={STYLE}>
      {showChapterCompleteCard ? (
        <ChapterCompleteCard
          chapterNumber={closedChapterNumber}
          title={CHAPTER_TITLES[closedChapterNumber] ?? `Chapter ${closedChapterNumber}`}
          progress={closedChapterProgress}
          onContinue={() => dispatch({ type: 'ACKNOWLEDGE_CHAPTER', chapterNumber: objectiveChapter })}
        />
      ) : (
        pendingEvent && (
          <EventOverlay
            event={pendingEvent}
            onChoose={choiceIndex => dispatch({ type: 'RESOLVE_EVENT', eventId: pendingEvent.id, choiceIndex })}
          />
        )
      )}
      {showChronicle && (
        <ChronicleLog chapters={chronicleChapters} onClose={() => setShowChronicle(false)} />
      )}
      {showTutorial && !showGuidedTour && !pendingEvent && !showChapterCompleteCard && (
        <TutorialOverlay
          variant={state.flags.chapter0_complete ? 'main' : 'chapter0'}
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
      {showGuidedTour && !showTutorial && !pendingEvent && !showChapterCompleteCard && (
        <GuidedTour
          state={state}
          selectedVesselId={selectedVesselId}
          previewCityId={previewCityId}
          onFinish={() => setShowGuidedTour(false)}
          onStepChange={handleTourStepChange}
        />
      )}
      {showHotseatModal && hotseatHouse && (
        <HotseatDecisionModal
          house={hotseatHouse}
          sabotageEligible={hotseatSabotageEligible}
          onCancel={() => setShowHotseatModal(false)}
          onConfirm={hotseatDecision => {
            setShowHotseatModal(false);
            dispatch({ type: 'ADVANCE_WEEK', hotseatDecision });
          }}
        />
      )}
      <PortalNav variant="header" />
      <header style={HEADER}>
        <h1 style={TITLE}>{state.name ?? 'Banco di Niccolo'}</h1>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.2rem', flexWrap: 'wrap', rowGap: '0.5rem' }}>
          <span style={CLOCK}>
            {Math.round(state.cash)}f &nbsp;·&nbsp; hold: {heldGoodsSummary || 'nothing'}
            &nbsp;·&nbsp; {formatWeekDate(state.week, CAMPAIGN_START)}
            &nbsp;·&nbsp; conscience {Math.round(state.conscience)}
          </span>
          <CampaignProgress chapterNumber={objectiveChapter} title={CHAPTER_TITLES[objectiveChapter] ?? `Chapter ${objectiveChapter}`} />
          <button
            id="advance-week-button"
            style={{ ...BUTTON, padding: '0.35rem 0.7rem', fontSize: '0.75rem' }}
            onClick={handleAdvanceClick}
          >
            Advance one week
          </button>
          <button
            style={{ ...BUTTON, padding: '0.35rem 0.7rem', fontSize: '0.75rem', color: phaseTabsEnabled ? '#e8d5a3' : '#6a5a40' }}
            onClick={togglePhaseTabs}
          >
            Multi-step turns: {phaseTabsEnabled ? 'on' : 'off'}
          </button>
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
          {!state.objectivesHidden && objectiveChapter > 0 && (
            <button
              style={{ ...BUTTON, padding: '0.35rem 0.7rem', fontSize: '0.75rem' }}
              onClick={() => setShowChronicle(true)}
            >
              Chronicle
            </button>
          )}
          <button
            style={{ ...BUTTON, padding: '0.35rem 0.7rem', fontSize: '0.75rem', color: '#6a5a40' }}
            onClick={() => nav('/')}
          >
            ← Back to campaigns
          </button>
          <button
            style={{ ...BUTTON, padding: '0.35rem 0.7rem', fontSize: '0.75rem', color: '#6a5a40' }}
            onClick={abandonAndReturn}
          >
            Abandon this campaign
          </button>
        </div>
      </header>

      <div style={BODY}>
        <div id="game-sidebar" style={SIDEBAR}>
          <ObjectivesPanel chapterNumber={objectiveChapter} progress={objectiveProgress} />

          <div>
            <p style={{ fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8a7a5a' }}>
              Fleet &amp; Household
            </p>
            {state.vessels.map(v => {
              const at = findCity(v.location);
              const to = v.destination ? findCity(v.destination) : null;
              const held = cargoTotal(v.cargo);
              const crew = aboardRoster.filter(c => c.assignment.vesselId === v.id);
              return (
                <div key={v.id}>
                  <button
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
                  {crew.map(c => (
                    <p key={c.id} style={{ fontSize: '0.72rem', color: '#8a7a5a', margin: '0.15rem 0 0.4rem 0.9rem' }}>
                      {c.name} — aboard
                    </p>
                  ))}
                  {!v.destination && v.plannedRoute && v.plannedRoute.length > 0 && (() => {
                    const nextRoute = findRouteById(v.plannedRoute[0]);
                    if (!nextRoute) return null;
                    const nextCity = findCity(otherEndOfRoute(nextRoute, v.location));
                    // Real bug, confirmed live: EventOverlay/ChapterCompleteCard are full-viewport
                    // backdrops (position:fixed, inset:0) that sit visually on top of this whole
                    // sidebar but only darken it (rgba, not opaque) — the Continue/Not yet buttons
                    // still render at normal-looking brightness underneath, so a click here is
                    // silently swallowed by the backdrop with zero feedback. From the player's side
                    // this reads as "I clicked Continue and the ship just sits there, no matter how
                    // many weeks I advance" — exactly the reported bug. Fix: don't render a
                    // clickable-looking control that can't actually be clicked; explain why instead,
                    // so the plan's survival is visible even while blocked.
                    if (pendingEvent || showChapterCompleteCard) {
                      return (
                        <p style={{ margin: '0.15rem 0 0.5rem 0.9rem', fontSize: '0.72rem', color: '#6a5a40', fontStyle: 'italic' }}>
                          Continuing on to {nextCity?.name ?? nextRoute.id} waits on the matter above being resolved first.
                        </p>
                      );
                    }
                    const canInsureNextLeg = canInsureAt(v.location) && held > 0;
                    return (
                      <div style={{ margin: '0.15rem 0 0.5rem 0.9rem', fontSize: '0.72rem' }}>
                        <p style={{ color: '#8a7a5a', margin: '0 0 0.3rem' }}>
                          Continue on to {nextCity?.name ?? nextRoute.id}? {v.plannedRoute.length} leg
                          {v.plannedRoute.length === 1 ? '' : 's'} remaining.
                        </p>
                        {canInsureNextLeg && (
                          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', color: '#8a7a5a', margin: '0 0 0.3rem' }}>
                            <input
                              type="checkbox"
                              checked={!!continueInsure[v.id]}
                              onChange={e => setContinueInsure(prev => ({ ...prev, [v.id]: e.target.checked }))}
                            />
                            <span>Insure this cargo for this leg.</span>
                          </label>
                        )}
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            style={SMALL_BUTTON}
                            onClick={() =>
                              dispatch({ type: 'CONTINUE_PLANNED_ROUTE', vesselId: v.id, insure: !!continueInsure[v.id] })
                            }
                          >
                            Continue
                          </button>
                          <button style={SMALL_BUTTON} onClick={() => dispatch({ type: 'CANCEL_PLANNED_ROUTE', vesselId: v.id })}>
                            Not yet
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
            {notAboardRoster.map(c => (
              <p key={c.id} style={{ fontSize: '0.78rem', color: '#c9b88a', margin: '0.3rem 0' }}>
                {c.name} <span style={{ color: '#8a7a5a' }}>— {assignmentSummary(c, state.vessels)}</span>
              </p>
            ))}
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

          {state.lastSabotageEvent && (
            <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: 0 }}>
              Week {state.lastSabotageEvent.week}: {state.lastSabotageEvent.houseName} got to{' '}
              {state.lastSabotageEvent.vesselName}'s cargo at {findCity(state.lastSabotageEvent.cityId)?.name ?? state.lastSabotageEvent.cityId} —
              lost {state.lastSabotageEvent.quantityLost} {state.lastSabotageEvent.goodId}.
            </p>
          )}

          {state.lastExpeditionEvent && (
            <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: 0 }}>
              Week {state.lastExpeditionEvent.week}: {state.lastExpeditionEvent.vesselName}'s crew turn{' '}
              {state.lastExpeditionEvent.healthStatus} — {state.lastExpeditionEvent.cashCost}f spent on physicians and delay.
            </p>
          )}

          {state.expedition && (
            <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: 0 }}>
              {expeditionVessel?.name ?? 'The vessel'} is {state.expedition.weeksUpriver} week
              {state.expedition.weeksUpriver === 1 ? '' : 's'} into the Gambia's interior — crew health:{' '}
              {state.expedition.healthStatus}.
            </p>
          )}

          <p style={{ fontSize: '0.8rem', color: '#8a7a5a', margin: 0 }}>
            {selectedVessel
              ? selectedVessel.destination
                ? `${selectedVessel.name} cannot be redirected while under way.`
                : 'Click any city on the map to see what\'s known about it.'
              : 'Select a vessel.'}
          </p>

          {activePolicy && (
            <p style={{ fontSize: '0.75rem', color: '#3a6b5a', margin: 0 }}>
              Insured for {Math.round(activePolicy.coverage)}f this voyage (premium {activePolicy.premiumPaid}f paid).
            </p>
          )}

          {previewCity && (
            <CityPreviewPanel
              city={previewCity}
              isLive={dockedCityIds.has(previewCity.id)}
              report={state.knownPrices[previewCity.id]}
              week={state.week}
              scarcity={state.scarcity}
              vessel={selectedVessel}
              insureNext={insureNext}
              onInsureChange={setInsureNext}
              onConfirmDispatch={handleConfirmDispatch}
              onQueueRoute={handleQueueRoute}
            />
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

          {phaseTabsEnabled && (
            <PhaseStepper steps={PHASE_STEPS} active={activePhase} visited={visitedPhases} onSelect={selectPhase} />
          )}

          <div style={{ display: !phaseTabsEnabled || activePhase === 'trade' ? 'block' : 'none' }}>
            <EstatePanel
              estate={state.estate}
              flags={state.flags}
              cash={state.cash}
              selectedVessel={selectedVessel}
              onEstablish={() => dispatch({ type: 'ESTABLISH_ESTATE' })}
              onHarvest={() => dispatch({ type: 'HARVEST_ESTATE' })}
              onShip={(vesselId, quantity) => dispatch({ type: 'SHIP_ESTATE_GOODS', vesselId, quantity })}
            />
          </div>

          <div style={{ display: !phaseTabsEnabled || activePhase === 'household' ? 'block' : 'none' }}>
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
              wagesSuspended={!state.flags.chapter0_complete}
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
              flags={state.flags}
              onPlaceAgent={(placement, name) => dispatch({ type: 'PLACE_AGENT', placement, name })}
            />
          </div>

          <div style={{ display: !phaseTabsEnabled || activePhase === 'finance' ? 'block' : 'none' }}>
          {!state.flags.chapter0_complete && phaseTabsEnabled && (
            <p style={{ fontSize: '0.78rem', color: '#6a5a40', margin: 0 }}>
              Not available yet — credit isn't Claes's to extend until he's formally made the house's factor.
            </p>
          )}
          {state.flags.chapter0_complete && (
            <div>
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.3rem' }}>
                <button style={ledgerTab === 'ledger' ? BUTTON_ACTIVE : BUTTON} onClick={() => setLedgerTab('ledger')}>
                  Ledger
                </button>
                <button
                  style={ledgerTab === 'countingHouse' ? BUTTON_ACTIVE : BUTTON}
                  onClick={() => setLedgerTab('countingHouse')}
                >
                  Counting House
                </button>
              </div>
              <div style={{ display: ledgerTab === 'ledger' ? 'block' : 'none' }}>
                <LedgerPanel
                  week={state.week}
                  cash={state.cash}
                  exchangeRates={state.exchangeRates}
                  obligations={state.obligations}
                  flags={state.flags}
                  onDiscount={obligationId => dispatch({ type: 'DISCOUNT_OBLIGATION', obligationId })}
                />
              </div>
              <div style={{ display: ledgerTab === 'countingHouse' ? 'block' : 'none' }}>
                <CountingHousePanel
                  flags={state.flags}
                  onWriteBill={(cityId, florins, termWeeks) => dispatch({ type: 'WRITE_BILL', cityId, florins, termWeeks })}
                  onTakeDeposit={(florins, termWeeks) => dispatch({ type: 'TAKE_DEPOSIT', florins, termWeeks })}
                  onWriteLoan={(kind, florins, termWeeks) => dispatch({ type: 'WRITE_LOAN', kind, florins, termWeeks })}
                />
              </div>
            </div>
          )}
          </div>

          {error && <p style={{ fontSize: '0.8rem', color: '#b5451a', margin: 0 }}>{error}</p>}
        </div>

        <div style={MAP_PANE}>
          <MapView
            key={state.id}
            vessels={state.vessels}
            selectedVesselId={selectedVesselId}
            onSelectCity={handlePreviewCity}
            cityInfoAge={cityInfoAge}
            previewedCityId={previewCityId}
          />
        </div>
      </div>
      <PortalNav variant="footer" />
    </div>
  );
}
