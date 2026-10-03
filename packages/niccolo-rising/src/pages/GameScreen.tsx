import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { advance, whyIllegal } from '../sim/actions';
import { bribeCost } from '../sim/content';
import type { GameAction } from '../sim/types';
import { FONT, UI } from '../theme';
import { duration, gr } from '../lib/format';
import StatusRail from '../components/StatusRail';
import PortalNav from '../components/PortalNav';
import Chronicle from '../components/Chronicle';
import { Button, Panel } from '../components/ui';
import ActButton from '../components/places/ActButton';
import Home from '../components/places/Home';
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

const PLACES = [
  { id: 'home', name: 'Home', Panel: Home },
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

/** The client ticks this often. A TICK that changes nothing returns the same state and is not saved. */
const TICK_MS = 60_000;

export default function GameScreen() {
  const { id } = useParams<{ id: string }>();
  const { state, error, loadGame, dispatch } = useGameHybrid();
  const [tickNow, setNow] = useState(() => Date.now());
  const [place, setPlace] = useState<PlaceId>('home');

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

  const act = useCallback((v: Verb) => dispatch({ ...v, at: Date.now() } as GameAction), [dispatch]);
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

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: UI.ground, color: UI.text, fontFamily: FONT.body }} className="nr-board">
      <StatusRail s={view} now={now} />
      <main style={{ flex: 1, minWidth: 0, padding: '1rem 1.2rem' }}>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '1rem', alignItems: 'center' }}>
          <Link to="/" style={{ color: UI.textSoft, fontSize: '0.78rem', marginRight: '0.6rem', textDecoration: 'none' }}>
            ← Characters
          </Link>
          {PLACES.map(p => (
            <Button key={p.id} tone={p.id === place ? 'primary' : 'quiet'} onClick={() => setPlace(p.id)}>
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
            <ActButton p={props} verb={{ type: 'BRIBE' }}>Bribe the gaoler, {gr(bribeCost(view))}</ActButton>
          </Panel>
        )}

        <Current {...props} />
      </main>
      <Chronicle s={view} />
    </div>
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
