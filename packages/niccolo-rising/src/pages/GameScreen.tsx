import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { advance, whyIllegal } from '../sim/actions';
import { bribeCost } from '../sim/content';
import type { GameAction } from '../sim/types';
import { FONT, UI } from '../theme';
import { duration, gr } from '../lib/format';
import StatusRail, { statusLine } from '../components/StatusRail';
import TownMap, { type Landmark } from '../components/TownMap';
import { missionReady } from '../sim/missions';
import { BAR_IDS } from '../sim/types';
import { barMax } from '../sim/content';
import { BAR_COLOURS } from '../theme';
import PortalNav from '../components/PortalNav';
import { LoadingScreen, SIGN_IN_AGAIN } from '../lib/Loading';
import { SESSION_EXPIRED } from '../hooks/useGameCloud';
import { clearToken } from '../lib/portalAuth';
import Chronicle from '../components/Chronicle';
import { Button, Panel } from '../components/ui';
import ActButton from '../components/places/ActButton';
import Home from '../components/places/Home';
import Missions from '../components/places/Missions';
import Yards from '../components/places/Yards';
import Schemes from '../components/places/Schemes';
import Work from '../components/places/Work';
import Schooling from '../components/places/Schooling';
import Travel from '../components/places/Travel';
import Waterhalle from '../components/places/Waterhalle';
import Lodging from '../components/places/Lodging';
import Duels from '../components/places/Duels';
import Bank from '../components/places/Bank';
import type { PlaceProps, Verb } from '../components/types';
import ThemeToggle from '../components/ThemeToggle';
import GuidedTour, { hasSeenGuidedTour, planFirstHours, type TourPlan } from '../components/GuidedTour';

/**
 * Every place the character can go, and where it stands on the town map. The ids are the guided
 * run's (`nr-place-<id>` is the landmark it points at to send the player somewhere).
 */
const PLACES = [
  { id: 'home', name: 'Home', Panel: Home, where: 'The Charetty dyeworks', x: 712, y: 318, icon: 'house' },
  { id: 'missions', name: 'Missions', Panel: Missions, where: 'The Stadhuis, on the Burg', x: 599, y: 404, icon: 'hall' },
  { id: 'yard', name: 'Training yard', Panel: Yards, where: 'By the Kruispoort', x: 810, y: 440, icon: 'sword' },
  { id: 'schemes', name: 'Schemes', Panel: Schemes, where: 'The back lanes of the Speelmansrei', x: 300, y: 395, icon: 'dagger' },
  { id: 'duels', name: 'Duels', Panel: Duels, where: 'The field by the Smedenpoort', x: 205, y: 515, icon: 'duel' },
  { id: 'work', name: 'Work', Panel: Work, where: 'The crane on the Kraanplein', x: 520, y: 270, icon: 'crane' },
  { id: 'school', name: 'Schooling', Panel: Schooling, where: 'The college of Ter Duinen', x: 370, y: 250, icon: 'book' },
  { id: 'travel', name: 'Travel', Panel: Travel, where: 'The Dampoort, for Damme and the Zwin', x: 640, y: 170, icon: 'ship' },
  { id: 'market', name: 'Waterhalle', Panel: Waterhalle, where: 'On the Markt', x: 505, y: 428, icon: 'scales' },
  { id: 'lodging', name: 'Lodging', Panel: Lodging, where: 'The inns of the Zuidzand', x: 300, y: 600, icon: 'bed' },
  { id: 'bank', name: 'Bank', Panel: Bank, where: 'The Medici, at the Hof Bladelin', x: 405, y: 360, icon: 'coins' },
] as const;

/** Names to one side where a neighbour sits close enough for the names to touch on a phone. */
const LABEL_SIDE: Partial<Record<PlaceId, Landmark['labelSide']>> = { missions: 'right', bank: 'right', work: 'right', home: 'right' };
const LANDMARKS: Landmark[] = PLACES.map(({ id, name, where, x, y, icon }) => ({ id, name, where, x, y, icon, labelSide: LABEL_SIDE[id] }));

type PlaceId = (typeof PLACES)[number]['id'];

/** The client ticks this often. A TICK that changes nothing returns the same state and is not saved. */
const TICK_MS = 60_000;

export default function GameScreen() {
  const { id } = useParams<{ id: string }>();
  const { state, error, loadGame, dispatch } = useGameHybrid();
  const navigate = useNavigate();
  const [tickNow, setNow] = useState(() => Date.now());
  const [place, setPlace] = useState<PlaceId>('home');
  /**
   * The map is the board; a place's screen slides out over it when the player picks the place, and
   * the character sheet and the chronicle share a panel on the other side. Both start away.
   */
  const [placeOpen, setPlaceOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'character' | 'chronicle'>('character');
  const layout = usePanelLayout();
  const openPlace = (open: boolean) => {
    setPlaceOpen(open);
    if (open && layout.oneAtATime) setSideOpen(false);
  };
  const openSide = (open: boolean, tab?: 'character' | 'chronicle') => {
    if (tab) setSideTab(tab);
    setSideOpen(open);
    if (open && layout.oneAtATime) setPlaceOpen(false);
  };
  const placeRef = useRef<HTMLElement | null>(null);
  const sideRef = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLElement | null>(null);
  /** A landmark the guided run is pointing at, brought into view on the map. */
  const [mapFocus, setMapFocus] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPlaceOpen(false);
      setSideOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * The guided first hour, once started. Latched in state rather than recomputed per render: the
   * plan names a particular yard, scheme and post, chosen from the character as they stood when
   * the run opened, and one that re-picked itself on every tick would rewrite the steps under the
   * player's feet — this screen re-renders once a second.
   */
  const [tourPlan, setTourPlan] = useState<TourPlan | null>(null);
  /** Whether the once-per-browser offer has already been considered for this character. */
  const [tourOffered, setTourOffered] = useState(false);

  // Every hook sits above the early returns below: a hook after one renders conditionally, which
  // both tsc and the driver miss and which leaves a blank screen.
  useEffect(() => {
    if (id && state?.id !== id) loadGame(id);
  }, [id, state?.id, loadGame]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!state) return;
    dispatch({ type: 'TICK', at: Date.now() });
    const t = setInterval(() => dispatch({ type: 'TICK', at: Date.now() }), TICK_MS);
    return () => clearInterval(t);
    // Re-arm only when a different character is loaded, not on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.id, dispatch]);

  // The display clock ticks once a second, so it can trail the moment an action was stamped. Never
  // render earlier than the save's own clock, or a journey just begun reads longer than it is.
  const now = Math.max(tickNow, state?.clock ?? 0);
  const view = useMemo(() => (state ? advance(state, now) : null), [state, now]);

  // Offer the guided first hour unasked to a character who has not done anything yet, the first
  // time this browser sees one. Every hook sits above the early returns below.
  useEffect(() => {
    if (tourOffered || !view) return;
    const untouched = view.counters.schemes === 0 && view.job === null && view.missions.done.length === 0;
    if (!untouched) return;
    setTourOffered(true);
    if (hasSeenGuidedTour()) return;
    const plan = planFirstHours(view);
    if (plan) setTourPlan(plan);
  }, [view, tourOffered]);

  const act = useCallback((v: Verb) => dispatch({ ...v, at: Date.now() } as GameAction), [dispatch]);
  const why = useCallback(
    (v: Verb) => (view ? whyIllegal(view, { ...v, at: now } as GameAction) : 'Loading'),
    [view, now],
  );

  if (!view) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body }}>
        <PortalNav variant="header" />
        <LoadingScreen
          fullPage={false}
          motif="coins"
          caption="The bells of the Belfort ring the hour. Fetching your character…"
          error={state ? null : error === SESSION_EXPIRED ? SIGN_IN_AGAIN : error}
          actions={
            error === SESSION_EXPIRED ? (
              <Button tone="primary" onClick={() => { clearToken(); navigate('/'); }}>Sign in again</Button>
            ) : (
              <>
                {id && <Button tone="primary" onClick={() => void loadGame(id)}>Try again</Button>}
                <Link to="/" style={{ color: UI.brass, fontSize: '0.85rem', alignSelf: 'center' }}>← Back to your characters</Link>
              </>
            )
          }
        />
        <PortalNav variant="footer" />
      </div>
    );
  }

  const props: PlaceProps = { s: view, now, act, why };
  const Current = PLACES.find(p => p.id === place)!.Panel;
  const st = view.status;
  /** A first hour the run could teach from where the character stands, or null if there isn't one. */
  const tourCandidate: TourPlan | null = tourPlan || st.kind !== 'free' ? null : planFirstHours(view);

  const placeDef = PLACES.find(p => p.id === place)!;

  /**
   * The guided run is pointing at something. A control in a panel: open that panel, then once it
   * has finished sliding in, scroll the control into the middle of it (any earlier measures a panel
   * still in motion). A landmark on the map: bring it into view, and on a phone put the sheet away,
   * since the sheet covers most of the map.
   */
  const revealTourTarget = (targetId: string | null) => {
    if (!targetId) return;
    if (targetId.startsWith('nr-place-')) {
      setMapFocus(targetId.slice('nr-place-'.length));
      if (layout.sheet) { setPlaceOpen(false); setSideOpen(false); }
      return;
    }
    const el = document.getElementById(targetId);
    if (!el) return;
    const inSide = sideRef.current?.contains(el);
    const inPlace = placeRef.current?.contains(el);
    if (!inSide && !inPlace) return;
    const wasOpen = inSide ? sideOpen : placeOpen;
    if (inSide) openSide(true, 'character');
    else openPlace(true);
    window.setTimeout(() => {
      const target = document.getElementById(targetId);
      const body = target?.closest('.nr-panel-body');
      if (!target || !body) return;
      const t = target.getBoundingClientRect(), b = body.getBoundingClientRect();
      if (t.top < b.top + 8 || t.bottom > b.bottom - 8) body.scrollTop += t.top - b.top - b.height / 2 + t.height / 2;
    }, wasOpen ? 0 : 320);
  };

  const boardH = boardRef.current?.clientHeight ?? window.innerHeight;
  const inset = layout.sheet
    ? { left: 0, right: 0, bottom: placeOpen || sideOpen ? Math.round(boardH * 0.66) : 0 }
    : { left: sideOpen ? layout.sideWidth + 20 : 0, right: placeOpen ? layout.placeWidth + 20 : 0, bottom: 0 };

  const status = statusLine(view, now);
  const at =
    st.kind === 'infirmary' ? { site: 'infirmary' as const }
    : st.kind === 'steen' ? { site: 'steen' as const }
    : st.kind === 'travelling' || st.kind === 'abroad' ? { site: 'gate' as const, label: status.text }
    : { landmark: placeOpen ? place : 'home' };
  const badges: Record<string, string | undefined> = {
    missions: view.missions.active && missionReady(view) ? 'A mission ready to report' : undefined,
    school: view.course ? 'A course under way' : undefined,
  };

  return (
    <div className="nr-board" style={{ height: '100dvh', minHeight: '100vh', overflow: 'clip', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body }}>
      {/* --- Header: who, how much, where, and how the bars stand, without opening anything. --- */}
      <header className="nr-header" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem 0.9rem', padding: '0.5rem 1rem', borderBottom: `1px solid ${UI.rule}`, background: UI.panel, flexShrink: 0 }}>
        <Link to="/" style={{ color: UI.textSoft, fontSize: '0.78rem', textDecoration: 'none' }}>← Characters</Link>
        <span style={{ fontFamily: FONT.display, fontSize: '1.05rem', color: UI.brass }}>{view.name}</span>
        <span className="nr-hide-phone" style={{ fontSize: '0.75rem', color: UI.textSoft }}>Level {view.level}</span>
        <span style={{ fontFamily: FONT.data, fontSize: '0.85rem' }}>{gr(view.groats)}</span>
        <span style={{ fontSize: '0.78rem', color: status.colour }}>{status.text}</span>
        <button type="button" onClick={() => openSide(true, 'character')} title="Your bars: open the character sheet"
          style={{ display: 'flex', gap: 5, alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          {BAR_IDS.map(bar => {
            const b = view.bars[bar];
            const max = barMax(view, bar);
            return (
              <span key={bar} title={`${bar} ${b.cur}/${max}`} style={{ width: 34, height: 6, borderRadius: 3, background: UI.rule, overflow: 'hidden', display: 'inline-block' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.min(100, (b.cur / max) * 100)}%`, background: BAR_COLOURS[bar] }} />
              </span>
            );
          })}
        </button>
        <span style={{ flex: 1 }} />
        {tourCandidate && (
          <Button tone="quiet" onClick={() => setTourPlan(tourCandidate)}>Guided first hour</Button>
        )}
        <ThemeToggle style={{ borderColor: UI.rule, color: UI.textSoft }} />
      </header>

      {error && <p style={{ fontSize: '0.8rem', color: UI.bad, margin: 0, padding: '0.4rem 1rem', borderBottom: `1px solid ${UI.rule}` }}>{error}</p>}

      {/* --- The board: the town map, with the panels floating over it. --- */}
      <main ref={boardRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'clip' }}>
        <TownMap
          landmarks={LANDMARKS}
          selected={placeOpen ? place : null}
          onPick={id => { setPlace(id as PlaceId); openPlace(true); }}
          at={at}
          badges={badges}
          focus={mapFocus}
          inset={inset}
        />

        {/* Where the town has put you overrides everything: it floats over the map, unmissable. */}
        {(st.kind === 'infirmary' || st.kind === 'steen') && (
          <div style={{ position: 'absolute', top: 60, left: inset.left + 12, right: inset.right + 12, margin: '0 auto', maxWidth: 520, zIndex: 35, boxShadow: `0 10px 30px ${UI.shadow}` }}>
            {st.kind === 'infirmary' ? (
              <Panel title="The Infirmary of St John" style={{ borderColor: UI.bad, margin: 0 }}>
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>
                  Laid up after {st.reason}. Out in {duration(st.until - now)}. Bandages and theriac shorten the stay.
                </p>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <ActButton p={props} verb={{ type: 'USE_ITEM', itemId: 'bandage' }}>Use bandages ({view.inventory.bandage ?? 0})</ActButton>
                  <ActButton p={props} verb={{ type: 'USE_ITEM', itemId: 'theriac' }}>Use theriac ({view.inventory.theriac ?? 0})</ActButton>
                </div>
              </Panel>
            ) : (
              <Panel title="The Steen" style={{ borderColor: UI.bad, margin: 0 }}>
                <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>
                  Taken for {st.reason.toLowerCase()}. Released in {duration(st.until - now)}, or sooner if the gaoler is paid.
                </p>
                <ActButton p={props} verb={{ type: 'BRIBE' }}>Bribe the gaoler, {gr(bribeCost(view))}</ActButton>
              </Panel>
            )}
          </div>
        )}

        {/* With a panel away, the button that brings it back waits at its edge of the map. */}
        {!sideOpen && (
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 30, display: 'flex', gap: 6 }}>
            <button type="button" className="nr-launcher" style={launcher} onClick={() => openSide(true, 'character')}>Character</button>
            <button type="button" className="nr-launcher" style={launcher} onClick={() => openSide(true, 'chronicle')}>Chronicle</button>
          </div>
        )}
        {!placeOpen && (
          <div className="nr-hint" style={{ position: 'absolute', top: 12, right: 12, zIndex: 30, ...launcher, cursor: 'default', color: UI.textSoft, fontFamily: FONT.body, fontStyle: 'italic', fontSize: '0.8rem' }}>
            Choose a place on the map
          </div>
        )}

        <aside ref={sideRef} className={`nr-panel nr-panel-left${sideOpen ? ' open' : ''}`} aria-hidden={!sideOpen} aria-label="Your character and the chronicle">
          <div style={panelHead}>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['character', 'chronicle'] as const).map(t => (
                <button key={t} type="button" onClick={() => setSideTab(t)}
                  style={{ background: 'none', border: 'none', borderBottom: `2px solid ${sideTab === t ? UI.brass : 'transparent'}`, color: sideTab === t ? UI.brass : UI.textSoft, cursor: 'pointer', fontFamily: FONT.display, fontSize: '0.95rem', padding: '0.2rem 0.4rem' }}>
                  {t === 'character' ? 'Character' : 'Chronicle'}
                </button>
              ))}
            </div>
            <button type="button" style={panelClose} onClick={() => setSideOpen(false)} aria-label="Close (Esc)" title="Close (Esc)">✕</button>
          </div>
          <div className="nr-panel-body" style={panelBody}>
            {/* Both stay mounted, one hidden: the guided run's spotlight on the bars needs them to exist. */}
            <div id="nr-character" style={{ display: sideTab === 'character' ? 'block' : 'none' }}><StatusRail s={view} now={now} embedded /></div>
            <div id="nr-chronicle" style={{ display: sideTab === 'chronicle' ? 'block' : 'none' }}><Chronicle s={view} embedded /></div>
          </div>
        </aside>

        <aside ref={placeRef} className={`nr-panel nr-panel-right${placeOpen ? ' open' : ''}`} aria-hidden={!placeOpen} aria-label={placeDef.name}>
          <div style={panelHead}>
            <div>
              <div style={{ fontFamily: FONT.display, fontSize: '1rem', color: UI.brass }}>{placeDef.name}</div>
              <div style={{ fontSize: '0.72rem', color: UI.textFaint, fontStyle: 'italic' }}>{placeDef.where}</div>
            </div>
            <button type="button" style={panelClose} onClick={() => setPlaceOpen(false)} aria-label={`Close ${placeDef.name} (Esc)`} title="Close (Esc)">✕</button>
          </div>
          <div className="nr-panel-body" style={panelBody}>
            <Current {...props} />
          </div>
        </aside>
      </main>

      {tourPlan && (
        <GuidedTour
          hidden={st.kind !== 'free'}
          view={{ s: view, place: placeOpen ? place : '' }}
          plan={tourPlan}
          onFinish={() => setTourPlan(null)}
          onTargetChange={revealTourTarget}
        />
      )}
    </div>
  );
}

const launcher: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.ruleStrong}`,
  boxShadow: `0 4px 14px ${UI.shadow}`,
  color: UI.text,
  cursor: 'pointer',
  fontFamily: FONT.display,
  fontSize: '0.9rem',
  padding: '0.4rem 0.75rem',
  borderRadius: 2,
};

const panelHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.5rem 0.6rem 0.5rem 0.8rem',
  borderBottom: `1px solid ${UI.rule}`,
  flexShrink: 0,
};

const panelClose: React.CSSProperties = {
  background: 'none',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  color: UI.textSoft,
  cursor: 'pointer',
  width: 30,
  height: 28,
  flexShrink: 0,
};

const panelBody: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '0.8rem',
};

/**
 * How the panels sit, matching `.nr-panel` in styles.css: beside each other over a wide map, one at
 * a time over a narrower one, and as a bottom sheet on a phone.
 */
function usePanelLayout() {
  const read = () => {
    const w = window.innerWidth;
    return { sheet: w <= 720, oneAtATime: w <= 1360, sideWidth: w <= 1100 ? 260 : 290, placeWidth: w <= 1100 ? 440 : 520 };
  };
  const [layout, setLayout] = useState(read);
  useEffect(() => {
    const onResize = () =>
      setLayout(prev => {
        const next = read();
        return prev.sheet === next.sheet && prev.oneAtATime === next.oneAtATime && prev.sideWidth === next.sideWidth ? prev : next;
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return layout;
}

/** The portal chrome and a titled card, for the moments before a character is on screen. */
