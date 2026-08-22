import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { getStoredUser } from '../lib/portalAuth';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  MAX_HAULIERS,
  PRESETS,
  SHARE_MAJORITY,
  TOTAL_SHARES,
  VICTORY_CASH,
  type Difficulty,
  type PresetName,
} from '../sim/rules';
import type { Hazards } from '../sim/types';
import { FONT, UI, money } from '../theme';
import PortalNav from '../components/PortalNav';
import { Button, Label, Panel, bodySmall, dataText } from '../components/ui';

/**
 * Every optional rule, in the order they are offered. One row here is the whole of a switch: the
 * checkbox list and the preset comparison are both generated from it.
 */
const SWITCHES: { key: keyof Hazards & string; name: string; blurb: string }[] = [
  {
    key: 'weather',
    name: 'Road and weather',
    blurb:
      'A seasonal forecast, so fog- and flood-prone legs get worse through the year, and delays that cost time.',
  },
  {
    key: 'theft',
    name: 'Theft',
    blurb:
      'Hold-ups and the occasional seizure on theft-prone roads. Tracker and insurance become worth buying.',
  },
  {
    key: 'events',
    name: 'World events',
    blurb:
      'Driver strikes, low-emission bans, gluts, shortages and DVSA bounties. What is worth carrying changes under you.',
  },
  {
    key: 'hostileBids',
    name: 'Hostile bids',
    blurb:
      'Buy a share off anyone, even the leader, whatever your own holding. Cheapest when you hold least, and every bid made by anyone doubles the price for everyone after. Falling behind stops being fatal.',
  },
  {
    key: 'depotSales',
    name: 'Depot sales',
    blurb:
      'Offload cargo you cannot place at a loss instead of dumping it for nothing. A depot that deals in the good pays far better than one that does not.',
  },
  {
    key: 'wages',
    name: 'Driver wages',
    blurb:
      'Every vehicle costs money every round, and a laden one costs more. Cash stops being a score and becomes a constraint. Games run about half as long again.',
  },
  {
    key: 'loans',
    name: 'Loans',
    blurb:
      'Borrow against your vehicles and shares at interest. A way through a bad season, and a way to gamble on one good run. What you owe counts against you if a claim is settled on assets.',
  },
  {
    key: 'deadlines',
    name: 'Commissions expire',
    blurb:
      'Cards come off the board if nobody fills them, and cargo loses value the longer it sits in the load bed. The race gets a clock.',
  },
  {
    key: 'vehicleClasses',
    name: 'Vehicle classes',
    blurb:
      'A quick 7.5-tonner, a pacy 18-tonne rigid or a roomy 44-tonne artic, instead of one vehicle repeated. What your fleet is made of becomes a position.',
  },
  {
    key: 'stocks',
    name: 'The haulage exchange',
    blurb:
      'Three rival haulage firms whose share prices rise and fall with the cargo actually landed in their region. Not another way to win: somewhere for money to go, and a market to read.',
  },
];

/** Hazards with every optional field filled in, so comparisons never trip over undefined. */
type FullHazards = Required<Hazards>;

const normalise = (h: Hazards): FullHazards =>
  Object.fromEntries(SWITCHES.map(sw => [sw.key, h[sw.key] ?? false])) as FullHazards;

/** Which preset these settings are, if any. Generic, so a new switch needs no change here. */
function presetFor(h: FullHazards): PresetName | null {
  for (const key of Object.keys(PRESETS) as PresetName[]) {
    const want = normalise(PRESETS[key].hazards);
    if (SWITCHES.every(sw => want[sw.key] === h[sw.key])) return key;
  }
  return null;
}

export default function Lobby() {
  const navigate = useNavigate();
  const { saves, error, createGame, loadGame, deleteGame } = useGameHybrid();
  const user = getStoredUser();

  const [name, setName] = useState('');
  const [humans, setHumans] = useState(1);
  const [ai, setAi] = useState(3);
  const [seed, setSeed] = useState('');
  const [humanNames, setHumanNames] = useState<string[]>(['You']);
  /**
   * One object rather than ten booleans.
   *
   * The switches were previously ten `useState` calls with the preset comparison hand-written in
   * three separate places, which meant adding the eleventh meant editing six sites and silently
   * mis-matching a preset if you missed one. Now a switch is one row of the SWITCHES table below.
   */
  const [hazards, setHazards] = useState<FullHazards>(() => normalise(PRESETS.full.hazards));
  const chosen = presetFor(hazards);
  const [level, setLevel] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const total = humans + ai;
  const tooMany = total > MAX_HAULIERS;

  const setHumanCount = (n: number) => {
    setHumans(n);
    setHumanNames(prev => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(`Haulier ${next.length + 1}`);
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
        difficulty: level,
        seed: seed.trim() || undefined,
        hazards,
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

  // Every game on the portal now requires a real account — there is no anonymous/guest path in.
  if (!user) {
    return (
      <div style={page}>
        <PortalNav />
        <main style={{ ...content, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <Panel style={{ width: 380, textAlign: 'center' }}>
            <h2 style={{ ...dataText, fontSize: '1.3rem', margin: '0 0 0.6rem' }}>Steady Eddie</h2>
            <p style={{ ...bodySmall, color: UI.textSoft, margin: '0 0 1.6rem', lineHeight: 1.5 }}>
              Sign in to keep your campaigns on your account.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <Button tone="primary" onClick={() => { window.location.href = '/thrash-margin/login'; }}>
                Sign in / Register →
              </Button>
            </div>
          </Panel>
        </main>
        <PortalNav variant="footer" />
      </div>
    );
  }

  return (
    <div style={page}>
      <PortalNav />
      <main style={content}>
        <header style={{ marginBottom: '2rem' }}>
          <p style={eyebrow}>A road fork of The Tea Race, after Ocean Trader, Clipper Games, 1988</p>
          <h1 style={title}>Steady Eddie</h1>
          <p style={{ ...bodySmall, maxWidth: '58ch', margin: 0 }}>
            Five commissions are posted on the exchange at all times, each naming a cargo, the depot
            that sells it and the depot that wants it. Only the first two vehicles home are paid — four
            times the purchase price, then twice, then nothing. Carry {SHARE_MAJORITY} of the{' '}
            {TOTAL_SHARES} company shares, {money(VICTORY_CASH)} and a vehicle still on the road, and the
            company is yours.
          </p>
        </header>

        {error && (
          <div style={errorBanner} role="alert">
            {error}
          </div>
        )}

        <Panel title="A new run" style={{ marginBottom: '1.5rem' }}>
          <div style={field}>
            <Label>Name this run</Label>
            <input
              style={input}
              value={name}
              placeholder="The Warrington run"
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
            <div style={field}>
              <Label>Human hauliers</Label>
              <Counter value={humans} min={1} max={MAX_HAULIERS} onChange={setHumanCount} />
            </div>
            <div style={field}>
              <Label>Computer rivals</Label>
              <Counter value={ai} min={0} max={MAX_HAULIERS - 1} onChange={setAi} />
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
              The same seed always deals the same cards and rolls the same dice — useful for playing
              the identical season twice.
            </p>
          </div>

          <div style={field}>
            <Label>How to play</Label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {(Object.keys(PRESETS) as PresetName[]).map(key => {
                const preset = PRESETS[key];
                return (
                  <Button
                    key={key}
                    tone={chosen === key ? 'primary' : 'default'}
                    title={preset.blurb}
                    onClick={() => setHazards(normalise(preset.hazards))}
                  >
                    {preset.label}
                  </Button>
                );
              })}
            </div>
            <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
              {chosen
                ? PRESETS[chosen].blurb
                : 'A mixture of your own — set the switches below however you like.'}
            </p>
          </div>

          <div style={field}>
            <Label>Or pick your own</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.5rem' }}>
              <Label>How well the rivals play</Label>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {(Object.keys(DIFFICULTIES) as Difficulty[]).map(id => (
                  <Button
                    key={id}
                    tone={level === id ? 'primary' : 'quiet'}
                    title={DIFFICULTIES[id].blurb}
                    onClick={() => setLevel(id)}
                  >
                    {DIFFICULTIES[id].label}
                  </Button>
                ))}
              </div>
              <p style={{ ...bodySmall, fontSize: '0.74rem', margin: 0, color: UI.textFaint }}>
                {DIFFICULTIES[level].blurb} Every handicap is knowledge or discipline — the computer
                hauliers never roll better than you do. Fewer rivals is the other dial: against three,
                one of them takes the company three times in four even when everybody plays equally.
              </p>
            </div>

            {SWITCHES.map(sw => (
              <label key={sw.key} style={checkRow}>
                <input
                  type="checkbox"
                  checked={hazards[sw.key]}
                  onChange={e =>
                    setHazards((h: FullHazards) => ({ ...h, [sw.key]: e.target.checked }))
                  }
                  style={{ accentColor: UI.brass }}
                />
                <span>
                  <strong style={{ color: UI.text }}>{sw.name}</strong> — {sw.blurb}
                </span>
              </label>
            ))}
            <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
              Two cargo slots a vehicle, the scaling share price and the twelve-turn countdown are the
              core rules and are always on.
            </p>
          </div>

          {tooMany && (
            <p style={{ ...bodySmall, color: UI.bad, margin: 0 }}>
              {total} hauliers — the table seats {MAX_HAULIERS}.
            </p>
          )}

          <div>
            <Button tone="primary" disabled={tooMany || busy} onClick={begin}>
              {busy ? 'Casting off…' : `Begin with ${total} hauliers →`}
            </Button>
          </div>
        </Panel>

        <Panel title="Your runs">
          {saves.length === 0 ? (
            <p style={{ ...bodySmall, margin: 0, color: UI.textFaint }}>
              No runs yet. These are saved to your account.
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

        <Panel title="Free-haulage mode" style={{ marginTop: '1.5rem', opacity: 0.72 }}>
          <p style={{ ...bodySmall, margin: 0 }}>
            A deeper ruleset — real days instead of dice, prices that move continuously, standing
            wages and weather and insurance running all the time rather than in this game's turn
            structure — is designed in <code>steady-eddie-design.md</code> but not built, the same
            way The Tea Race deferred its own "Voyage mode". The rules above are this fork's own
            core rules.
          </p>
          <div>
            <Button disabled>Free-haulage mode — later</Button>
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
