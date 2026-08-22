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
import ConvoyPanel from '../components/ConvoyPanel';
import CounselPanel from '../components/CounselPanel';
import CounselCallout from '../components/CounselCallout';
import { urgentAdvice } from '../sim/advisors';
import EvidenceBoardPanel from '../components/EvidenceBoardPanel';
import DiviningPanel from '../components/DiviningPanel';
import EstatePanel from '../components/EstatePanel';
import ObjectivesPanel from '../components/ObjectivesPanel';
import ChapterCompleteCard from '../components/ChapterCompleteCard';
import CampaignProgress from '../components/CampaignProgress';
import ChronicleLog from '../components/ChronicleLog';
import SectionRail from '../components/SectionRail';
import SectionPopup from '../components/SectionPopup';
import type { SectionDef } from '../components/SectionRail';
import HotseatDecisionModal from '../components/HotseatDecisionModal';
import EventOverlay from '../components/EventOverlay';
import TutorialOverlay, { hasSeenTutorial, hasSeenChapter0Tutorial } from '../components/TutorialOverlay';
import GuidedTour from '../components/GuidedTour';
import PortalNav from '../components/PortalNav';

/** One entry per popup section (Phase 17 follow-up: menu redesign). `'city'` covers both
 * `CityPreviewPanel` and, when the selected vessel is docked there, `MarketPanel` — they're shown
 * together exactly as they already sat stacked-and-adjacent before this redesign. */
export type SectionId =
  | 'objectives'
  | 'fleet'
  | 'city'
  | 'estate'
  | 'dispatches'
  | 'household'
  | 'secrets'
  | 'houses'
  | 'dossier'
  | 'counsel'
  | 'ledger';

const SECTION_TITLES: Record<SectionId, string> = {
  objectives: 'Chapter objectives',
  fleet: 'Fleet & Household',
  city: 'City & Market',
  estate: 'Estate',
  dispatches: 'Dispatches',
  household: 'Household',
  secrets: 'Secrets',
  houses: 'Houses & Agents',
  dossier: 'Evidence board',
  counsel: 'Counsel',
  ledger: 'Ledger',
};

const STYLE: React.CSSProperties = {
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
  // Positioning context for the slide-out section drawer, which is deliberately scoped to this pane
  // rather than the viewport: a viewport-wide scrim covered the section bar itself, so switching
  // sections silently closed the drawer instead (the same overlay-swallows-clicks trap this codebase
  // has now hit three times). Keeping it in here leaves the header and the bar permanently live.
  position: 'relative',
};

const MAP_PANE: React.CSSProperties = {
  flex: 1,
  padding: '0.5rem',
  // Anchors MapView's absolutely-positioned "Reset view" control to this pane's own corner,
  // independent of the map's internal pan/zoom transform.
  position: 'relative',
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

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.5rem',
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
  // Phase 17 follow-up: which section's popup (if any) is open — replaces the old always-stacked
  // scrolling sidebar entirely (and the "multi-step turns" phase-tab grouping it grew, which this
  // supersedes rather than layers alongside).
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const [showHotseatModal, setShowHotseatModal] = useState(false);

  useEffect(() => {
    if (id) loadGame(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedVesselId(state?.vessels[0]?.id ?? null);
  }, [state?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setInsureNext(false);
    // Default the preview to wherever the newly-selected vessel actually is, so opening the City
    // popup shows something useful immediately rather than starting empty until the map is clicked.
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

  // The tour's later steps spotlight controls that live inside a specific popup section — force it
  // open exactly when that step becomes current (not just once for the tour's whole duration, so
  // backing up or resuming mid-tour still lands on an unhidden target). Just as important: a step
  // that targets the map or header (e.g. "click this city's marker") must actively *close* whatever
  // popup a previous step opened — the popup's own full-viewport backdrop would otherwise sit on
  // top of the map, silently swallowing that click exactly like `EventOverlay`'s own backdrop bug.
  const handleTourStepChange = (requiresSection: SectionId | undefined) => {
    setActiveSection(requiresSection ?? null);
    if (requiresSection === 'ledger') setLedgerTab('countingHouse');
  };

  const abandonAndReturn = () => {
    if (id) deleteGame(id);
    nav('/');
  };

  if (!state) {
    return <CenteredMessage>{error ?? 'Loading campaign…'}</CenteredMessage>;
  }

  const selectedVessel = state.vessels.find(v => v.id === selectedVesselId) ?? null;
  const dockedCityIds = new Set(state.vessels.filter(v => !v.destination).map(v => v.location));
  const cityInfoAge: Record<string, number | null> = {};
  for (const c of CITIES) {
    const report = state.knownPrices[c.id];
    cityInfoAge[c.id] = dockedCityIds.has(c.id) ? 0 : report ? state.week - report.trueAsOfWeek : null;
  }

  // Clicking a city (reachable or not) only previews it — see CityPreviewPanel — so the player
  // can check prices before committing. Dispatch is a separate, explicit confirmation. Opens the
  // City popup directly, per the redesign's own concept ("opened directly from the map").
  const handlePreviewCity = (cityId: string) => {
    setPreviewCityId(cityId);
    setActiveSection('city');
  };

  const handleConfirmDispatch = () => {
    if (!selectedVessel || !previewCityId) return;
    dispatch({ type: 'DISPATCH_VESSEL', vesselId: selectedVessel.id, destinationId: previewCityId, insure: insureNext });
    setInsureNext(false);
  };

  // Phase 15: dispatches the first hop of a multi-leg plan and queues the rest — the vessel still
  // stops, docks, and becomes tradeable at every intermediate city exactly as a manual redispatch
  // would. Phase 17 follow-up: continuing to the next leg is now automatic (`sim/actions.ts`'s
  // `autoContinuePlannedRoutes`, one ADVANCE_WEEK after each arrival) rather than needing a manual
  // "Continue" click at every stop — cancelling the plan is still an explicit action.
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

  if (state.flags.chapter6_complete) {
    const secretsUsed = state.secrets.filter(s => s.used).length;
    const secretsExpired = state.secrets.filter(s => s.expired).length;
    const departed = state.characters.filter(c => c.status === 'departed');
    const icelandSucceeded = !!state.flags.iceland_venture_success;
    const volterraRuin = !!state.flags.volterra_ruin;
    const stayedClearOfBurgundy = !!state.flags.burgundy_stayed_clear;
    const tookTheRefugees = !!state.flags.iceland_refugees_taken;
    const parentagePieces = (state.evidence ?? []).filter(e => e.track === 'parentage').length;
    return (
      <div style={STYLE}>
        <PortalNav variant="header" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
          <h1 style={TITLE}>Chapter 6 — To Lie with Lions</h1>
          <p style={{ color: '#e8d5a3', maxWidth: '30rem', textAlign: 'center' }}>
            {icelandSucceeded
              ? 'Three hulls came up the Zwin together with more dried fish aboard than Bruges had seen out of one Flemish house, and the northern trade stopped being a speculation and became the house\'s own.'
              : 'The season shut in the north with the holds part-full, and what the venture proved was only how much tonnage the trade actually needs.'}
          </p>
          <p style={{ color: '#e8d5a3', maxWidth: '30rem', textAlign: 'center' }}>
            {volterraRuin
              ? 'Volterra was taken in two days by seven thousand men, and every florin the house had standing in the alum went with it — a position perfectly priced, perfectly documented, and gone.'
              : 'Volterra was taken in two days by seven thousand men, and the house\'s money was standing somewhere else. Three houses it deals with weekly were not so placed.'}
          </p>
          <p style={{ color: '#8a7a5a', maxWidth: '30rem', textAlign: 'center', fontSize: '0.9rem' }}>
            Concluded in {formatWeekDate(state.week, CAMPAIGN_START)}, {Math.round(state.cash)}f on hand, conscience{' '}
            {Math.round(state.conscience)}.{' '}
            {stayedClearOfBurgundy
              ? 'The house lent Burgundy nothing, and was unpopular in Flanders for it.'
              : 'The house is a creditor of a duke who went to Trier for a crown and came home without one.'}{' '}
            {tookTheRefugees ? 'A hold that should have carried fish carried families out from under the ash.' : ''}{' '}
            Parentage dossier: {parentagePieces} piece{parentagePieces === 1 ? '' : 's'} pinned. Secrets used: {secretsUsed},
            expired unused: {secretsExpired}.
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

  // A vessel with a queued plan still waiting to continue — worth flagging on the Fleet tab even
  // when its own popup isn't open, since it's easy to forget a ship is mid-journey otherwise.
  const fleetHasNews =
    state.vessels.some(v => !v.destination && v.plannedRoute && v.plannedRoute.length > 0) ||
    state.lastVoyageEvent?.week === state.week ||
    state.lastSabotageEvent?.week === state.week ||
    state.lastExpeditionEvent?.week === state.week;

  const estateUnlocked = !!state.estate || !!state.flags.kouklia_estate_available;

  // The Evidence board (design doc §11 screen 7) only appears in the rail once there is something on
  // it — the dossier and the divining gift are both Chapter 5 content, and an always-present tab
  // that reads "nothing pinned here yet" for four chapters is worse than no tab. Same conditional-
  // inclusion pattern the Estate tab already uses, and the same reason.
  // Counsel (Phase 21): a pure read-only projection, recomputed per render — nothing is stored.
  // The callout only interrupts for genuinely urgent counsel, only once per week, and never while a
  // scripted event or the chapter card already owns the screen (this codebase's own recurring
  // backdrop-swallows-clicks trap — see CounselCallout's header comment).
  const counselUrgent = urgentAdvice(state);
  const counselHasUrgent = !!counselUrgent;
  const counselDismissed = state.counselDismissedWeek === state.week;

  const dossierUnlocked =
    (state.evidence?.length ?? 0) > 0 || !!state.flags.divining_unlocked || !!state.flags.chapter4_complete;

  const SECTIONS: SectionDef[] = [
    { id: 'objectives', glyph: '✦', label: 'Objectives' },
    { id: 'fleet', glyph: '⚓', label: 'Fleet', badge: fleetHasNews },
    { id: 'city', glyph: '⚖', label: 'Market' },
    ...(estateUnlocked ? [{ id: 'estate', glyph: '⚘', label: 'Estate' }] : []),
    { id: 'dispatches', glyph: '✉', label: 'Dispatches' },
    { id: 'household', glyph: '⌂', label: 'Household' },
    { id: 'secrets', glyph: '🔍', label: 'Secrets' },
    { id: 'houses', glyph: '⚜', label: 'Houses' },
    ...(dossierUnlocked ? [{ id: 'dossier', glyph: '✎', label: 'Dossier' }] : []),
    { id: 'counsel', glyph: '☙', label: 'Counsel', badge: counselHasUrgent },
    { id: 'ledger', glyph: '📖', label: 'Ledger' },
  ];

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
      {counselUrgent && !counselDismissed && !pendingEvent && !showChapterCompleteCard && !showGuidedTour && (
        <CounselCallout
          advice={counselUrgent}
          onDismiss={() => dispatch({ type: 'DISMISS_COUNSEL' })}
          onOpenCounsel={() => {
            dispatch({ type: 'DISMISS_COUNSEL' });
            setActiveSection('counsel');
          }}
        />
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

      {error && (
        <p style={{ fontSize: '0.8rem', color: '#b5451a', margin: 0, padding: '0.5rem 2rem', borderBottom: '1px solid #2a2117' }}>
          {error}
        </p>
      )}

      {/* Horizontal section bar above the map — see SectionRail's own comment on why this is a row
          and not the vertical column it began as (tabs below the fold read as missing entirely).
          Clicking the open section again closes it, so the bar is a real toggle. */}
      <SectionRail
        sections={SECTIONS}
        active={activeSection}
        onSelect={id => setActiveSection(prev => (prev === id ? null : (id as SectionId)))}
      />

      <div style={BODY}>
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

      {activeSection && (
        <SectionPopup title={SECTION_TITLES[activeSection]} onClose={() => setActiveSection(null)}>
          {activeSection === 'objectives' && (
            <ObjectivesPanel chapterNumber={objectiveChapter} progress={objectiveProgress} />
          )}

          {activeSection === 'fleet' && (
            <>
              <div>
                <p style={SECTION_LABEL}>Vessels</p>
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
                        // Real bug, confirmed live: EventOverlay/ChapterCompleteCard are
                        // full-viewport backdrops (position:fixed, inset:0) that sit visually on
                        // top of this whole popup but only darken it (rgba, not opaque) — the
                        // Continue/Cancel buttons still render at normal-looking brightness
                        // underneath, so a click here is silently swallowed by the backdrop with
                        // zero feedback. Fix: don't render a clickable-looking control that can't
                        // actually be clicked; explain why instead.
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
                              Continuing on to {nextCity?.name ?? nextRoute.id} next week — {v.plannedRoute.length} leg
                              {v.plannedRoute.length === 1 ? '' : 's'} remaining.
                            </p>
                            {canInsureNextLeg && (
                              <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', color: '#8a7a5a', margin: '0 0 0.3rem' }}>
                                <input
                                  type="checkbox"
                                  checked={!!continueInsure[v.id]}
                                  onChange={e => setContinueInsure(prev => ({ ...prev, [v.id]: e.target.checked }))}
                                />
                                <span>Insure this cargo for this leg, and set sail now.</span>
                              </label>
                            )}
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              {canInsureNextLeg && (
                                <button
                                  style={SMALL_BUTTON}
                                  onClick={() =>
                                    dispatch({ type: 'CONTINUE_PLANNED_ROUTE', vesselId: v.id, insure: !!continueInsure[v.id] })
                                  }
                                >
                                  Set sail now
                                </button>
                              )}
                              <button style={SMALL_BUTTON} onClick={() => dispatch({ type: 'CANCEL_PLANNED_ROUTE', vesselId: v.id })}>
                                Cancel journey
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

              <ConvoyPanel
                state={state}
                onForm={vesselIds => dispatch({ type: 'FORM_CONVOY', vesselIds })}
                onDisband={() => dispatch({ type: 'DISBAND_CONVOY' })}
                onHireEscort={escortName => dispatch({ type: 'HIRE_ESCORT', escortName })}
              />
            </>
          )}

          {activeSection === 'city' && (
            <>
              <p style={{ fontSize: '0.8rem', color: '#8a7a5a', margin: 0 }}>
                {selectedVessel
                  ? selectedVessel.destination
                    ? `${selectedVessel.name} cannot be redirected while under way.`
                    : "Click any city on the map to see what's known about it."
                  : 'Select a vessel from the Fleet menu.'}
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
                  liveCauses={state.lastMarketCauses?.[previewCity.id]}
                  marketEvents={state.marketEvents}
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
                  cargoGrades={selectedVessel.cargoGrades}
                  capacity={selectedVessel.capacity}
                  scarcity={state.scarcity}
                  causes={state.lastMarketCauses?.[selectedVessel.location]}
                  marketEvents={state.marketEvents}
                  onBuy={(goodId, quantity, grade) =>
                    dispatch({ type: 'BUY_GOOD', vesselId: selectedVessel.id, goodId, quantity, grade })
                  }
                  onSell={(goodId, quantity, grade) =>
                    dispatch({ type: 'SELL_GOOD', vesselId: selectedVessel.id, goodId, quantity, grade })
                  }
                />
              )}
            </>
          )}

          {activeSection === 'estate' && (
            <EstatePanel
              estate={state.estate}
              flags={state.flags}
              cash={state.cash}
              selectedVessel={selectedVessel}
              onEstablish={() => dispatch({ type: 'ESTABLISH_ESTATE' })}
              onHarvest={() => dispatch({ type: 'HARVEST_ESTATE' })}
              onShip={(vesselId, quantity) => dispatch({ type: 'SHIP_ESTATE_GOODS', vesselId, quantity })}
            />
          )}

          {activeSection === 'dispatches' && (
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
          )}

          {activeSection === 'household' && (
            <>
              {!state.flags.chapter0_complete && (
                <p style={{ fontSize: '0.78rem', color: '#6a5a40', margin: 0 }}>
                  Wages are suspended while Claes remains an apprentice, not yet the house's factor.
                </p>
              )}
              <HouseholdPanel
                characters={state.characters}
                vessels={state.vessels}
                cash={state.cash}
                conscience={state.conscience}
                condotta={state.condotta}
                wagesSuspended={!state.flags.chapter0_complete}
                onAssign={(characterId, assignment) => dispatch({ type: 'ASSIGN_CHARACTER', characterId, assignment })}
              />
            </>
          )}

          {activeSection === 'secrets' && (
            <SecretsPanel
              secrets={state.secrets}
              week={state.week}
              onUse={secretId => dispatch({ type: 'USE_SECRET', secretId })}
            />
          )}

          {activeSection === 'houses' && (
            <HousesPanel
              houses={HOUSES}
              houseRelations={state.houseRelations}
              agents={state.agents}
              cash={state.cash}
              flags={state.flags}
              onPlaceAgent={(placement, name) => dispatch({ type: 'PLACE_AGENT', placement, name })}
            />
          )}

          {activeSection === 'dossier' && (
            <>
              <EvidenceBoardPanel evidence={state.evidence ?? []} houses={HOUSES} flags={state.flags} />
              <DiviningPanel state={state} onUse={purpose => dispatch({ type: 'USE_DIVINING', purpose })} />
            </>
          )}

          {activeSection === 'counsel' && <CounselPanel state={state} />}

          {activeSection === 'ledger' && (
            <>
              {!state.flags.chapter0_complete ? (
                <p style={{ fontSize: '0.78rem', color: '#6a5a40', margin: 0 }}>
                  Not available yet — credit isn't Claes's to extend until he's formally made the house's factor.
                </p>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.8rem' }}>
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
            </>
          )}
        </SectionPopup>
      )}
      </div>

      <PortalNav variant="footer" />
    </div>
  );
}
