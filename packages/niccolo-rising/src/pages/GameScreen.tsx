import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { advance, whyIllegal } from '../sim/actions';
import { bribeCost } from '../sim/content';
import { BATTLE_STATS, WORK_STATS } from '../sim/types';
import type { GameAction, GameState } from '../sim/types';
import { FONT, UI } from '../theme';
import { duration, gr } from '../lib/format';
import StatusRail from '../components/StatusRail';
import PortalNav from '../components/PortalNav';
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
import MotionToggle from '../components/MotionToggle';
import { Countdown, OutcomeContext } from '../components/motion';
import type { Gain, Outcome } from '../components/motion';
import { currentPace } from '../lib/motion';
import GuidedTour, { hasSeenGuidedTour, planFirstHours, type TourPlan } from '../components/GuidedTour';

const PLACES = [
  { id: 'home', name: 'Home', Panel: Home },
  { id: 'missions', name: 'Missions', Panel: Missions },
  { id: 'yard', name: 'Training yard', Panel: Yards },
  { id: 'schemes', name: 'Schemes', Panel: Schemes },
  { id: 'duels', name: 'Duels', Panel: Duels },
  { id: 'work', name: 'Work', Panel: Work },
  { id: 'school', name: 'Schooling', Panel: Schooling },
  { id: 'travel', name: 'Travel', Panel: Travel },
  { id: 'market', name: 'Waterhalle', Panel: Waterhalle },
  { id: 'lodging', name: 'Lodging', Panel: Lodging },
  { id: 'bank', name: 'Bank', Panel: Bank },
] as const;

type PlaceId = (typeof PLACES)[number]['id'];

/**
 * What an action visibly gained, for the floating markers by its button: battle and working stats and
 * standing. Bars, groats and experience float in the status rail instead, where they are shown.
 */
function gainsOf(prev: GameState, next: GameState): Gain[] {
  const out: Gain[] = [];
  const add = (d: number, label: string, dp: number) => {
    if (Math.abs(d) < 0.5 * 10 ** -dp) return;
    out.push({ text: `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(dp)} ${label}`, good: d > 0 });
  };
  for (const k of BATTLE_STATS) add(next.battle[k] - prev.battle[k], k, 2);
  for (const k of WORK_STATS) add(next.work[k] - prev.work[k], k, 2);
  add(next.standing - prev.standing, 'standing', 0);
  return out.slice(0, 3);
}

/** The client ticks this often. A TICK that changes nothing returns the same state and is not saved. */
const TICK_MS = 60_000;

export default function GameScreen() {
  const { id } = useParams<{ id: string }>();
  const { state, error, loadGame, dispatch } = useGameHybrid();
  const [tickNow, setNow] = useState(() => Date.now());
  const [place, setPlace] = useState<PlaceId>('home');

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


  // Presentation only: after an action, tell the button that sent it how it went. The state has
  // already changed (and gone to the save queue) by the time this looks; it never delays either.
  const stateRef = useRef(state);
  stateRef.current = state;
  const outcomeSeq = useRef(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const act = useCallback(
    (v: Verb, origin?: string) => {
      const prev = stateRef.current;
      dispatch({ ...v, at: Date.now() } as GameAction);
      if (!origin || !prev || currentPace() === 'off') return;
      // React has committed the press's update by the next task; compare then.
      window.setTimeout(() => {
        const next = stateRef.current;
        if (!next) return;
        const seq = ++outcomeSeq.current;
        if (next === prev) {
          setOutcome({ seq, origin, result: 'rejected', gains: [] });
          return;
        }
        const lastSeq = prev.log.length ? prev.log[prev.log.length - 1].seq : -1;
        const bad = next.log.some(e => e.seq > lastSeq && e.tone === 'bad');
        setOutcome({ seq, origin, result: bad ? 'bad' : 'ok', gains: gainsOf(prev, next) });
      }, 0);
    },
    [dispatch],
  );
  const why = useCallback(
    (v: Verb) => (view ? whyIllegal(view, { ...v, at: now } as GameAction) : 'Loading'),
    [view, now],
  );

  if (error && !state) {
    return (
      <Holding>
        <p style={{ color: UI.bad, fontSize: '0.88rem', margin: '0 0 1rem', lineHeight: 1.5 }}>{error}</p>
        <Link to="/" style={{ color: UI.brass, fontSize: '0.85rem' }}>← Back to your characters</Link>
      </Holding>
    );
  }
  if (!view) {
    return (
      <Holding>
        <p style={{ color: UI.textSoft, fontSize: '0.85rem', margin: 0, fontStyle: 'italic' }}>
          The bells of the Belfort ring the hour. Fetching your character…
        </p>
      </Holding>
    );
  }

  const props: PlaceProps = { s: view, now, act, why };
  const Current = PLACES.find(p => p.id === place)!.Panel;
  const st = view.status;
  /** A first hour the run could teach from where the character stands, or null if there isn't one. */
  const tourCandidate: TourPlan | null = tourPlan || st.kind !== 'free' ? null : planFirstHours(view);

  return (
    <OutcomeContext.Provider value={outcome}>
      <div style={{ display: 'flex', minHeight: '100vh', background: UI.ground, color: UI.text, fontFamily: FONT.body }} className="nr-board">
        <StatusRail s={view} now={now} />
        <main style={{ flex: 1, minWidth: 0, padding: '1rem 1.2rem' }}>
          <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '1rem', alignItems: 'center' }}>
            <Link to="/" style={{ color: UI.textSoft, fontSize: '0.78rem', marginRight: '0.6rem', textDecoration: 'none' }}>
              ← Characters
            </Link>
            <MotionToggle style={{ borderColor: UI.rule, color: UI.textSoft, marginRight: '0.6rem' }} />
            <ThemeToggle style={{ borderColor: UI.rule, color: UI.textSoft, marginRight: '0.6rem' }} />
            {tourCandidate && (
              <Button tone="quiet" onClick={() => setTourPlan(tourCandidate)} style={{ marginRight: '0.6rem' }}>
                Guided first hour
              </Button>
            )}
            {PLACES.map(p => (
              <Button key={p.id} id={`nr-place-${p.id}`} tone={p.id === place ? 'primary' : 'quiet'} onClick={() => setPlace(p.id)}>
                {p.name}
              </Button>
            ))}
          </nav>

          {error && <p style={{ fontSize: '0.8rem', color: UI.bad, margin: '0 0 0.8rem' }}>{error}</p>}

          {st.kind === 'infirmary' && (
            <Panel title="The Infirmary of St John" style={{ borderColor: UI.bad }}>
              <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>
                Laid up after {st.reason}. Out in {duration(st.until - now)}. Bandages and theriac shorten the stay.
              </p>
              <Countdown since={st.since} until={st.until} now={now} colour={UI.bad} />
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <ActButton p={props} verb={{ type: 'USE_ITEM', itemId: 'bandage' }}>Use bandages ({view.inventory.bandage ?? 0})</ActButton>
                <ActButton p={props} verb={{ type: 'USE_ITEM', itemId: 'theriac' }}>Use theriac ({view.inventory.theriac ?? 0})</ActButton>
              </div>
            </Panel>
          )}
          {st.kind === 'steen' && (
            <Panel title="The Steen" style={{ borderColor: UI.bad }}>
              <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>
                Taken for {st.reason.toLowerCase()}. Released in {duration(st.until - now)}, or sooner if the gaoler is paid.
              </p>
              <Countdown since={st.since} until={st.until} now={now} colour={UI.bad} />
              <ActButton p={props} verb={{ type: 'BRIBE' }}>Bribe the gaoler, {gr(bribeCost(view))}</ActButton>
            </Panel>
          )}

          <Current {...props} />
        </main>
        <Chronicle s={view} />

        {tourPlan && st.kind === 'free' && (
          <GuidedTour
            view={{ s: view, place }}
            plan={tourPlan}
            onFinish={() => setTourPlan(null)}
          />
        )}
      </div>
    </OutcomeContext.Provider>
  );
}

/** The portal chrome and a titled card, for the moments before a character is on screen. */
function Holding({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body }}>
      <PortalNav variant="header" />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.5rem' }}>
        <div style={{ border: `1px solid ${UI.rule}`, background: UI.panelRaised, padding: '2rem 2.2rem', maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontFamily: FONT.display, fontSize: '1.8rem', letterSpacing: '0.08em', color: UI.brass, margin: '0 0 0.8rem', fontWeight: 'normal' }}>
            Niccolò Rising
          </h1>
          {children}
        </div>
      </div>
      <PortalNav variant="footer" />
    </div>
  );
}
