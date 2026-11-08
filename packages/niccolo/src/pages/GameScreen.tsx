import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { UI, FONT } from '../theme';
import { formatWeekDate } from '../sim/clock';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { CITIES, CAMPAIGN_START, HOUSES, findCity, findEvent, findGood, findHouse, findRouteById, otherEndOfRoute } from '../sim/content';
import type { PlannedRoute } from '../sim/content';
import { cargoTotal } from '../sim/market';
import { currentChapterNumber, objectivesForChapter, CHAPTER_TITLES } from '../sim/objectives';
import type { GradeId } from '../sim/types';
import MapView from '../components/MapView';
import FleetPanel from '../components/FleetPanel';
import OrdersPanel from '../components/OrdersPanel';
import { Panel } from '../components/ui';
import DispatchesPanel from '../components/DispatchesPanel';
import LedgerPanel from '../components/LedgerPanel';
import CountingHousePanel from '../components/CountingHousePanel';
import HouseholdPanel from '../components/HouseholdPanel';
import HousesPanel from '../components/HousesPanel';
import SecretsPanel from '../components/SecretsPanel';
import EpilogueScreen from '../components/EpilogueScreen';
import CounselPanel from '../components/CounselPanel';
import CounselCallout from '../components/CounselCallout';
import { urgentAdvice } from '../sim/advisors';
import EvidenceBoardPanel from '../components/EvidenceBoardPanel';
import DiviningPanel from '../components/DiviningPanel';
import EstatePanel from '../components/EstatePanel';
import WarehousePanel from '../components/WarehousePanel';
import StandingsPanel from '../components/StandingsPanel';
import { freeplayGoalLabel, isFreeplay, playerNetWorth, standings } from '../sim/freeplay';
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
import ThemeToggle from '../components/ThemeToggle';

/**
 * One entry per popup section. Fleet selection, giving a vessel her orders (the old 'city' section
 * — city info, dispatch, buy/sell), chapter objectives and the household's counsel are no longer
 * among them: those four are always-visible sidebars now (`FleetPanel`/`OrdersPanel` on the right,
 * `ObjectivesPanel`/`CounselPanel` on the left), the same "assign and move ships without opening a
 * menu first" layout Tea Race already used. Everything left here is the lower-frequency,
 * more-bureaucratic half of the game — Estate, Storage, the Ledger and so on — where a drawer that
 * has to be explicitly opened is still the right amount of ceremony.
 */
export type SectionId =
  | 'estate'
  | 'warehouse'
  | 'standings'
  | 'dispatches'
  | 'household'
  | 'secrets'
  | 'houses'
  | 'dossier'
  | 'ledger';

const SECTION_TITLES: Record<SectionId, string> = {
  estate: 'Estate',
  warehouse: 'Warehouses',
  standings: 'Standings',
  dispatches: 'Dispatches',
  household: 'Household',
  secrets: 'Secrets',
  houses: 'Houses & Agents',
  dossier: 'Evidence board',
  ledger: 'Ledger',
};

const STYLE: React.CSSProperties = {
  height: '100vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  background: UI.ground,
  color: UI.text,
  fontFamily: FONT.body,
};

const HEADER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '1.2rem 2rem',
  borderBottom: `1px solid ${UI.rule}`,
};

const TITLE: React.CSSProperties = {
  fontSize: '1.6rem',
  letterSpacing: '0.1em',
  color: UI.brass,
  margin: 0,
};

const CLOCK: React.CSSProperties = {
  fontSize: '1rem',
  letterSpacing: '0.08em',
  color: UI.textSoft,
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

/**
 * Reference column (left): read-only — chapter objectives and the household's counsel, always
 * visible rather than tabs to open, the same role Tea Race gives its own left column ("reference,
 * not controls"). The section drawer's own `left:0` absolute positioning (see `SectionPopup.tsx`)
 * docks against `BODY`'s edge and so slides out *over* this column when a drawer section is open —
 * deliberate: it leaves the map (the thing you actually need to keep seeing) untouched.
 */
const LEFT_SIDEBAR: React.CSSProperties = {
  flex: '0 0 260px',
  minWidth: 0,
  overflowY: 'auto',
  padding: '0.6rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  borderRight: `1px solid ${UI.rule}`,
};

const MAP_PANE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '0.5rem',
  // Anchors MapView's absolutely-positioned "Reset view" control to this pane's own corner,
  // independent of the map's internal pan/zoom transform.
  position: 'relative',
};

/** Action column (right): everything you actually do to a ship — select her, then give her orders.
 * Tea Race's own `FleetPanel` + `PortPanel` pair, permanently on screen instead of behind a menu. */
const RIGHT_SIDEBAR: React.CSSProperties = {
  flex: '0 0 340px',
  minWidth: 0,
  overflowY: 'auto',
  padding: '0.6rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  borderLeft: `1px solid ${UI.rule}`,
};

/** Either sidebar collapsed to a bare toggle strip — the map behind it gets the reclaimed width
 * (both `LEFT_SIDEBAR`/`RIGHT_SIDEBAR` are `flex: 0 0 <width>`, so shrinking just this one number
 * is all `MAP_PANE`'s own `flex: 1` needs to fill the rest). Kept as a real width rather than
 * `display: none` so the toggle button itself never disappears — the one way back is always visible.
 */
const SIDEBAR_COLLAPSED_WIDTH = 34;

const SIDEBAR_TOGGLE: React.CSSProperties = {
  alignSelf: 'flex-start',
  flexShrink: 0,
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  color: UI.textSoft,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  lineHeight: 1,
  padding: '0.35rem 0.5rem',
};

const BUTTON: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  color: UI.text,
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
  // and BUTTON_ACTIVE, as the Ledger/Counting House tabs do) is a real React warning ("Removing
  // borderColor border"), not just a lint nag.
  border: `1px solid ${UI.brass}`,
  color: UI.brass,
};

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={STYLE}>
      <PortalNav variant="header" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: UI.textSoft }}>{children}</p>
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
  // scoped to the Orders panel's own direct-dispatch flow and would otherwise carry a stale
  // checked/unchecked value across an unrelated vessel's "Continue?" prompt.
  const [continueInsure, setContinueInsure] = useState<Record<string, boolean>>({});
  const [showTutorial, setShowTutorial] = useState(false);
  const [showGuidedTour, setShowGuidedTour] = useState(false);
  const [showChronicle, setShowChronicle] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<'ledger' | 'countingHouse'>('ledger');
  // Which drawer section (if any) is open — Fleet/Orders/Objectives/Counsel are no longer among
  // these; see the SectionId comment above.
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const [showHotseatModal, setShowHotseatModal] = useState(false);
  // Either sidebar can be tucked away to give the map the room back — a preference for this visit,
  // not campaign state, so it isn't persisted to the save.
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  useEffect(() => {
    if (id) loadGame(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedVesselId(state?.vessels[0]?.id ?? null);
  }, [state?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setInsureNext(false);
    // Default the preview to wherever the newly-selected vessel actually is, so the Orders panel
    // shows something useful immediately rather than starting empty until the map is clicked.
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

  // Clicking a city (reachable or not) only previews it — so the player can check prices before
  // committing. Dispatch is a separate, explicit confirmation.
  const handlePreviewCity = (cityId: string) => {
    setPreviewCityId(cityId);
  };

  // Clicking a vessel's own marker on the map selects it, mirroring the city-click shortcut above —
  // both panels reacting to it (Fleet's highlighted row, Orders' contents) are always on screen, so
  // there's no popup left to open.
  const handleSelectVessel = (vesselId: string) => {
    setSelectedVesselId(vesselId);
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

  const handleSetContinueInsure = (vesselId: string, checked: boolean) =>
    setContinueInsure(prev => ({ ...prev, [vesselId]: checked }));
  const handleSetSailNow = (vesselId: string, insure: boolean) =>
    dispatch({ type: 'CONTINUE_PLANNED_ROUTE', vesselId, insure });
  const handleCancelRoute = (vesselId: string) => dispatch({ type: 'CANCEL_PLANNED_ROUTE', vesselId });
  const handleBuyGood = (vesselId: string, goodId: string, quantity: number, grade?: GradeId) =>
    dispatch({ type: 'BUY_GOOD', vesselId, goodId, quantity, grade });
  const handleSellGood = (vesselId: string, goodId: string, quantity: number, grade?: GradeId) =>
    dispatch({ type: 'SELL_GOOD', vesselId, goodId, quantity, grade });
  const handleBuyVessel = (typeId: string, name?: string) => dispatch({ type: 'BUY_VESSEL', typeId, name });
  const handleSellVessel = (vesselId: string) => dispatch({ type: 'SELL_VESSEL', vesselId });

  // The guided tour's trade-loop steps need the ship to actually exist and be free to dispatch —
  // true once Chapter 0 hands it over (or immediately, for a skip-prologue campaign). It's no
  // longer tied to week 0: Chapter 0 itself now owns the player's very first moves, and this tour
  // covers the systems that come after — Household, Dispatches, the Ledger — that a prologue
  // player wouldn't have touched yet either.
  const ship = state.vessels.find(v => v.id === 'ship_1');
  const canGuidedTour = !!state.flags.chapter0_complete && !!ship && !ship.destination;

  const previewCity = previewCityId ? findCity(previewCityId) : undefined;

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
          <p style={{ color: UI.textSoft, maxWidth: '28rem', textAlign: 'center' }}>
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

  // Chapter 8 ends the campaign rather than freezing it, so it gets the epilogue rather than
  // another "chapter complete" card — see EpilogueScreen for why the net-worth figure belongs here
  // and only here.
  if (state.flags.chapter8_complete) {
    return <EpilogueScreen state={state} onReturn={() => nav('/')} />;
  }

  const pendingEvent = state.pendingEvents[0] ? findEvent(state.pendingEvents[0]) : null;

  const estateUnlocked = !!state.estate || !!state.flags.kouklia_estate_available;

  // Warehousing is a standing commercial system rather than chapter content, so it is gated only on
  // the prologue: an apprentice does not sign leases, which is the same line `resolveWeeklyUpkeep`
  // draws for wages. From Chapter 1 the tab is always there, because "should I be storing this
  // instead of dumping it?" is a question the player should be able to ask at any port.
  const warehousingUnlocked = !!state.flags.chapter0_complete;
  // Free play only (Phase 27). The campaign has no rivals to stand against and no target to reach,
  // and an always-present Standings tab there would be exactly the ambient score §11 rules out.
  const freeplayMode = isFreeplay(state);
  // A lease lost this week, or rent being paid on an empty shed — both are money leaving quietly,
  // which is exactly what a badge is for.
  const warehouseHasNews =
    (state.lastWarehouseLapses ?? []).some(l => l.week === state.week) ||
    Object.values(state.warehouses ?? {}).some(w => Object.values(w.cargo).every(n => n <= 0));

  // The Evidence board (design doc §11 screen 7) only appears in the rail once there is something on
  // it — the dossier and the divining gift are both Chapter 5 content, and an always-present tab
  // that reads "nothing pinned here yet" for four chapters is worse than no tab. Same conditional-
  // inclusion pattern the Estate tab already uses, and the same reason.
  // Counsel (Phase 21): a pure read-only projection, recomputed per render — nothing is stored. The
  // callout only interrupts for genuinely urgent counsel, only once per week, and never while a
  // scripted event or the chapter card already owns the screen (this codebase's own recurring
  // backdrop-swallows-clicks trap — see CounselCallout's header comment).
  const counselUrgent = urgentAdvice(state);
  const counselDismissed = state.counselDismissedWeek === state.week;

  const dossierUnlocked =
    (state.evidence?.length ?? 0) > 0 || !!state.flags.divining_unlocked || !!state.flags.chapter4_complete;

  // Grouped (Trade / House, plus a lone Dossier under its own "Story" label) rather than one flat
  // run of tabs — same idea as Tea Race folding its eleven toggles into three named clusters.
  const SECTIONS: SectionDef[] = [
    ...(dossierUnlocked ? [{ id: 'dossier' as const, glyph: '✎', label: 'Dossier', group: 'Story' }] : []),
    ...(estateUnlocked ? [{ id: 'estate' as const, glyph: '⚘', label: 'Estate', group: 'Trade' }] : []),
    ...(warehousingUnlocked
      ? [{ id: 'warehouse' as const, glyph: '▤', label: 'Storage', badge: warehouseHasNews, group: 'Trade' }]
      : []),
    ...(freeplayMode
      ? [{ id: 'standings' as const, glyph: '⚑', label: 'Standings', badge: state.freeplayWonWeek !== undefined, group: 'Trade' }]
      : []),
    { id: 'dispatches', glyph: '✉', label: 'Dispatches', group: 'Trade' },
    { id: 'household', glyph: '⌂', label: 'Household', group: 'House' },
    { id: 'secrets', glyph: '🔍', label: 'Secrets', group: 'House' },
    { id: 'houses', glyph: '⚜', label: 'Houses', group: 'House' },
    { id: 'ledger', glyph: '📖', label: 'Ledger', group: 'House' },
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
        <CounselCallout advice={counselUrgent} onDismiss={() => dispatch({ type: 'DISMISS_COUNSEL' })} />
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
          {/* Free play has no chapters, so it gets the standings instead of a chapter title — the
              header should always say what the player is actually playing toward. Without this the
              sandbox announced "Chapter 1 — Niccolo Rising" above a game with no story in it. */}
          {freeplayMode ? (
            <span style={{ ...CLOCK, fontSize: '0.8rem', color: UI.brass }}>
              {(() => {
                const table = standings(state);
                const me = table.findIndex(r => r.isPlayer) + 1;
                // Says what winning means in *this* game (Phase 30), not always the florin target —
                // in a `by_year` game the target is meaningless and in `survivor` it is misleading.
                return `${me} of ${table.length} · ${playerNetWorth(state).toLocaleString()}f · ${freeplayGoalLabel(state)}`;
              })()}
            </span>
          ) : (
            <CampaignProgress chapterNumber={objectiveChapter} title={CHAPTER_TITLES[objectiveChapter] ?? `Chapter ${objectiveChapter}`} />
          )}
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
          <ThemeToggle style={{ borderColor: UI.rule, color: UI.textSoft }} />
          <button
            style={{ ...BUTTON, padding: '0.35rem 0.7rem', fontSize: '0.75rem', color: UI.textFaint }}
            onClick={() => nav('/')}
          >
            ← Back to campaigns
          </button>
          <button
            style={{ ...BUTTON, padding: '0.35rem 0.7rem', fontSize: '0.75rem', color: UI.textFaint }}
            onClick={abandonAndReturn}
          >
            Abandon this campaign
          </button>
        </div>
      </header>

      {error && (
        <p style={{ fontSize: '0.8rem', color: UI.bad, margin: 0, padding: '0.5rem 2rem', borderBottom: `1px solid ${UI.rule}` }}>
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
        <aside style={leftCollapsed ? { ...LEFT_SIDEBAR, flex: `0 0 ${SIDEBAR_COLLAPSED_WIDTH}px`, padding: '0.6rem 0.4rem' } : LEFT_SIDEBAR}>
          <button
            style={SIDEBAR_TOGGLE}
            onClick={() => setLeftCollapsed(v => !v)}
            aria-label={leftCollapsed ? 'Show objectives and counsel' : 'Hide objectives and counsel'}
            title={leftCollapsed ? 'Show objectives and counsel' : 'Hide objectives and counsel'}
          >
            {leftCollapsed ? '›' : '‹'}
          </button>
          {!leftCollapsed && (
            <>
              {!freeplayMode && (
                <Panel title={`Chapter ${objectiveChapter} objectives`}>
                  <ObjectivesPanel chapterNumber={objectiveChapter} progress={objectiveProgress} />
                </Panel>
              )}
              <Panel title="Counsel">
                <CounselPanel state={state} />
              </Panel>
            </>
          )}
        </aside>

        <div style={MAP_PANE}>
          <MapView
            key={state.id}
            vessels={state.vessels}
            selectedVesselId={selectedVesselId}
            onSelectCity={handlePreviewCity}
            onSelectVessel={handleSelectVessel}
            cityInfoAge={cityInfoAge}
            previewedCityId={previewCityId}
          />

          {activeSection && (
            <SectionPopup title={SECTION_TITLES[activeSection]} onClose={() => setActiveSection(null)}>
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

              {activeSection === 'warehouse' && (
                <WarehousePanel
                  state={state}
                  selectedVessel={selectedVessel}
                  onLease={cityId => dispatch({ type: 'LEASE_WAREHOUSE', cityId })}
                  onExpand={cityId => dispatch({ type: 'EXPAND_WAREHOUSE', cityId })}
                  onStore={(vesselId, goodId, quantity, grade) =>
                    dispatch({ type: 'STORE_GOOD', vesselId, goodId, quantity, grade })
                  }
                  onWithdraw={(vesselId, goodId, quantity, grade) =>
                    dispatch({ type: 'WITHDRAW_GOOD', vesselId, goodId, quantity, grade })
                  }
                />
              )}

              {activeSection === 'standings' && (
                <StandingsPanel
                  state={state}
                  onPlaceAgent={traderId => dispatch({ type: 'PLACE_AGENT', placement: { type: 'rival', traderId } })}
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
                    <p style={{ fontSize: '0.78rem', color: UI.textFaint, margin: 0 }}>
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

              {activeSection === 'ledger' && (
                <>
                  {!state.flags.chapter0_complete ? (
                    <p style={{ fontSize: '0.78rem', color: UI.textFaint, margin: 0 }}>
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

        <aside
          style={rightCollapsed ? { ...RIGHT_SIDEBAR, flex: `0 0 ${SIDEBAR_COLLAPSED_WIDTH}px`, padding: '0.6rem 0.4rem' } : RIGHT_SIDEBAR}
          id="game-sidebar"
        >
          <button
            style={{ ...SIDEBAR_TOGGLE, alignSelf: 'flex-end' }}
            onClick={() => setRightCollapsed(v => !v)}
            aria-label={rightCollapsed ? 'Show fleet and orders' : 'Hide fleet and orders'}
            title={rightCollapsed ? 'Show fleet and orders' : 'Hide fleet and orders'}
          >
            {rightCollapsed ? '‹' : '›'}
          </button>
          {!rightCollapsed && (
            <>
              <FleetPanel
                state={state}
                selectedVesselId={selectedVesselId}
                onSelect={setSelectedVesselId}
                blocked={!!pendingEvent || showChapterCompleteCard}
                continueInsure={continueInsure}
                onSetContinueInsure={handleSetContinueInsure}
                onSetSailNow={handleSetSailNow}
                onCancelRoute={handleCancelRoute}
                onFormConvoy={vesselIds => dispatch({ type: 'FORM_CONVOY', vesselIds })}
                onDisbandConvoy={() => dispatch({ type: 'DISBAND_CONVOY' })}
                onHireEscort={escortName => dispatch({ type: 'HIRE_ESCORT', escortName })}
                onBuyVessel={handleBuyVessel}
                onSellVessel={handleSellVessel}
              />
              <OrdersPanel
                state={state}
                selectedVessel={selectedVessel}
                previewCity={previewCity}
                dockedCityIds={dockedCityIds}
                insureNext={insureNext}
                onInsureChange={setInsureNext}
                onConfirmDispatch={handleConfirmDispatch}
                onQueueRoute={handleQueueRoute}
                onBuy={handleBuyGood}
                onSell={handleSellGood}
              />
            </>
          )}
        </aside>
      </div>

      <PortalNav variant="footer" />
    </div>
  );
}
