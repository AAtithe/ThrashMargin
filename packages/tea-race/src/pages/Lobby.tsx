import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { getStoredUser } from '../lib/portalAuth';
import { MAX_CAPTAINS, SHARE_MAJORITY, TOTAL_SHARES, VICTORY_CASH } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import PortalNav from '../components/PortalNav';
import { Button, Label, Panel, bodySmall, dataText } from '../components/ui';

export default function Lobby() {
  const navigate = useNavigate();
  const { saves, error, createGame, loadGame, deleteGame } = useGameHybrid();
  const user = getStoredUser();

  const [name, setName] = useState('');
  const [humans, setHumans] = useState(1);
  const [ai, setAi] = useState(3);
  const [seed, setSeed] = useState('');
  const [humanNames, setHumanNames] = useState<string[]>(['You']);
  const [weather, setWeather] = useState(true);
  const [piracy, setPiracy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const total = humans + ai;
  const tooMany = total > MAX_CAPTAINS;

  const setHumanCount = (n: number) => {
    setHumans(n);
    setHumanNames(prev => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(`Captain ${next.length + 1}`);
      return next;
    });
  };

  const begin = async () => {
    if (tooMany || busy) return;
    setBusy(true);
    try {
      const id = await createGame(name, {
        humanNames: humanNames.slice(0, humans),
        aiCount: ai,
        seed: seed.trim() || undefined,
        hazards: { weather, piracy },
      });
      if (id) navigate(`/game/${id}`);
    } finally {
      setBusy(false);
    }
  };

  const open = async (id: string) => {
    await loadGame(id);
    navigate(`/game/${id}`);
  };

  return (
    <div style={page}>
      <PortalNav />
      <main style={content}>
        <header style={{ marginBottom: '2rem' }}>
          <p style={eyebrow}>After Ocean Trader, Clipper Games, 1988</p>
          <h1 style={title}>The Tea Race</h1>
          <p style={{ ...bodySmall, maxWidth: '58ch', margin: 0 }}>
            Five commissions are posted on the exchange at all times, each naming a cargo, the port
            that sells it and the port that wants it. Only the first two ships home are paid — four
            times the purchase price, then twice, then nothing. Carry {SHARE_MAJORITY} of the{' '}
            {TOTAL_SHARES} company shares, {money(VICTORY_CASH)} and a ship still afloat, and the
            company is yours.
          </p>
        </header>

        {error && (
          <div style={errorBanner} role="alert">
            {error}
          </div>
        )}

        <Panel title="A new voyage" style={{ marginBottom: '1.5rem' }}>
          <div style={field}>
            <Label>Name this voyage</Label>
            <input
              style={input}
              value={name}
              placeholder="The 1866 season"
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
            <div style={field}>
              <Label>Human captains</Label>
              <Counter value={humans} min={1} max={MAX_CAPTAINS} onChange={setHumanCount} />
            </div>
            <div style={field}>
              <Label>Computer rivals</Label>
              <Counter value={ai} min={0} max={MAX_CAPTAINS - 1} onChange={setAi} />
            </div>
          </div>

          {humans > 1 && (
            <div style={field}>
              <Label>Who is playing</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {humanNames.slice(0, humans).map((n, i) => (
                  <input
                    key={i}
                    style={{ ...input, width: 150 }}
                    value={n}
                    onChange={e =>
                      setHumanNames(prev => prev.map((x, j) => (j === i ? e.target.value : x)))
                    }
                  />
                ))}
              </div>
              <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
                One device, passed round. Everything on the board is public, so the handover is just
                a pause — nobody has to look away.
              </p>
            </div>
          )}

          <div style={field}>
            <Label>Seed (optional)</Label>
            <input
              style={{ ...input, width: 180 }}
              value={seed}
              placeholder="leave blank for a fresh one"
              onChange={e => setSeed(e.target.value)}
            />
            <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
              The same seed always deals the same cards and rolls the same wind — useful for playing
              the identical season twice.
            </p>
          </div>

          <div style={field}>
            <Label>Hazards</Label>
            <label style={checkRow}>
              <input type="checkbox" checked={weather} onChange={e => setWeather(e.target.checked)} style={{ accentColor: UI.brass }} />
              <span>
                <strong style={{ color: UI.text }}>Wind and weather</strong> — a seasonal wind chart, so
                the fast way round changes through the year, and storms that cost time.
              </span>
            </label>
            <label style={checkRow}>
              <input type="checkbox" checked={piracy} onChange={e => setPiracy(e.target.checked)} style={{ accentColor: UI.brass }} />
              <span>
                <strong style={{ color: UI.text }}>Pirates</strong> — ransoms and the occasional seizure
                in piratical waters. Guns and insurance become worth buying.
              </span>
            </label>
            <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
              Turn both off for the 1988 board's own rules, exactly as published.
            </p>
          </div>

          {tooMany && (
            <p style={{ ...bodySmall, color: UI.bad, margin: 0 }}>
              {total} captains — the table seats {MAX_CAPTAINS}.
            </p>
          )}

          <div>
            <Button tone="primary" disabled={tooMany || busy} onClick={begin}>
              {busy ? 'Casting off…' : `Begin with ${total} captains →`}
            </Button>
          </div>
        </Panel>

        <Panel title="Your voyages">
          {saves.length === 0 ? (
            <p style={{ ...bodySmall, margin: 0, color: UI.textFaint }}>
              No voyages yet.{' '}
              {user ? 'These are saved to your account.' : 'These save in this browser only — sign in to keep them.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {saves.map(save => (
                <div key={save.id} style={saveRow}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: FONT.display, fontSize: '0.95rem', color: UI.text }}>
                      {save.name}
                    </div>
                    <div style={{ ...dataText, fontSize: '0.7rem', color: UI.textFaint }}>
                      round {save.turn}
                      {save.status === 'victory' ? ' · finished' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <Button onClick={() => open(save.id)}>Open</Button>
                    {confirmDelete === save.id ? (
                      <>
                        <Button
                          tone="danger"
                          onClick={() => {
                            deleteGame(save.id);
                            setConfirmDelete(null);
                          }}
                        >
                          Really delete
                        </Button>
                        <Button tone="quiet" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button tone="quiet" onClick={() => setConfirmDelete(save.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Voyage mode" style={{ marginTop: '1.5rem', opacity: 0.72 }}>
          <p style={{ ...bodySmall, margin: 0 }}>
            A deeper ruleset — real weeks instead of dice, prices that move, crew and weather and
            insurance — is designed in <code>tea-race-design.md</code> but not built. The rules
            above are the 1988 board's own.
          </p>
          <div>
            <Button disabled>Voyage mode — later</Button>
          </div>
        </Panel>
      </main>
      <PortalNav variant="footer" />
    </div>
  );
}

function Counter({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <Button tone="quiet" disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </Button>
      <span style={{ ...dataText, fontSize: '1rem', minWidth: '1.2rem', textAlign: 'center' }}>
        {value}
      </span>
      <Button tone="quiet" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </Button>
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

const content: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '2.5rem 1.25rem 3rem',
  flex: 1,
  width: '100%',
  boxSizing: 'border-box',
};

const eyebrow: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.62rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: UI.brass,
  margin: '0 0 0.5rem',
};

const title: React.CSSProperties = {
  fontFamily: FONT.display,
  fontSize: '2.6rem',
  lineHeight: 1.05,
  margin: '0 0 0.7rem',
  color: UI.text,
};

const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  alignItems: 'flex-start',
};

const input: React.CSSProperties = {
  fontFamily: FONT.body,
  fontSize: '0.9rem',
  padding: '0.4rem 0.55rem',
  background: UI.ground,
  border: `1px solid ${UI.ruleStrong}`,
  borderRadius: 2,
  color: UI.text,
  width: '100%',
  maxWidth: 320,
  boxSizing: 'border-box',
};

const saveRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.7rem',
  flexWrap: 'wrap',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  padding: '0.5rem 0.6rem',
};

const checkRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.45rem',
  alignItems: 'flex-start',
  fontFamily: FONT.body,
  fontSize: '0.82rem',
  lineHeight: 1.4,
  color: UI.textSoft,
  cursor: 'pointer',
  maxWidth: '52ch',
};

const errorBanner: React.CSSProperties = {
  border: `1px solid ${UI.bad}`,
  background: 'rgba(194, 96, 106, 0.1)',
  color: UI.bad,
  padding: '0.6rem 0.8rem',
  marginBottom: '1.2rem',
  fontSize: '0.85rem',
  borderRadius: 2,
};
