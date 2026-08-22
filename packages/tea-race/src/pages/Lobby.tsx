import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { getStoredUser } from '../lib/portalAuth';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  FACE_UP_CONTRACTS,
  MAX_CAPTAINS,
  PAYOUT_MULTIPLIERS,
  PRESETS,
  SHARE_MAJORITY,
  TOTAL_SHARES,
  VICTORY_CASH,
  type Difficulty,
  type PresetName,
} from '../sim/rules';
import type { Hazards } from '../sim/types';
import { VOYAGE_ROUNDS } from '../sim/voyage';
import { FONT, UI, money } from '../theme';
import PortalNav from '../components/PortalNav';
import { Button, Label, Panel, bodySmall, dataText } from '../components/ui';

/**
 * Every optional rule, in the order they are offered. One row here is the whole of a switch: the
 * checkbox list and the preset comparison are both generated from it.
 */
/**
 * The optional rules, grouped. Each group becomes a collapsible section in the lobby.
 *
 * Grouping is not decoration: ten switches in one flat list is a wall of text nobody reads before a
 * game, and the groups are the same three axes the presets are built along — the world, money, and
 * the shape of the race. Reading the headings tells you what kind of game you are setting up without
 * opening any of them.
 */
type SwitchGroup = 'The world' | 'Money' | 'The race';

export const SWITCH_GROUPS: SwitchGroup[] = ['The world', 'Money', 'The race'];

const SWITCHES: { key: keyof Hazards & string; group: SwitchGroup; name: string; blurb: string }[] = [
  {
    key: 'weather',
    group: 'The world',
    name: 'Wind and weather',
    blurb:
      'A seasonal wind chart, so the fast way round changes through the year, and storms that cost time.',
  },
  {
    key: 'piracy',
    group: 'The world',
    name: 'Pirates',
    blurb:
      'Ransoms and the occasional seizure in piratical waters. Guns and insurance become worth buying.',
  },
  {
    key: 'events',
    group: 'The world',
    name: 'World events',
    blurb:
      'Dock strikes, embargoes, gluts, shortages and Admiralty bounties. What is worth carrying changes under you.',
  },
  {
    key: 'hostileBids',
    group: 'The race',
    name: 'Hostile bids',
    blurb:
      'Buy a share off anyone, even the leader, whatever your own holding. Cheapest when you hold least, and every bid made by anyone doubles the price for everyone after. Falling behind stops being fatal.',
  },
  {
    key: 'quaysideSales',
    group: 'Money',
    name: 'Quayside sales',
    blurb:
      'Offload cargo you cannot place at a loss instead of dumping it for nothing. A quay that deals in the good pays far better than one that does not.',
  },
  {
    key: 'wages',
    group: 'Money',
    name: 'Crew wages',
    blurb:
      'Every ship costs money every round, and a laden one costs more. Cash stops being a score and becomes a constraint. Games run about half as long again.',
  },
  {
    key: 'loans',
    group: 'Money',
    name: 'Loans',
    blurb:
      'Borrow against your ships and shares at interest. A way through a bad season, and a way to gamble on one good run. What you owe counts against you if a claim is settled on assets.',
  },
  {
    key: 'deadlines',
    group: 'The race',
    name: 'Commissions expire',
    blurb:
      'Cards come off the board if nobody fills them, and cargo loses value the longer it sits in the hold. The race gets a clock.',
  },
  {
    key: 'shipClasses',
    group: 'The race',
    name: 'Ship classes',
    blurb:
      'A fast clipper, a roomy barque and an armed Indiaman, instead of one hull repeated. What your fleet is made of becomes a position.',
  },
  {
    key: 'agents',
    group: 'Money',
    name: 'Port agents',
    blurb:
      'A permanent man on the ground at one quay: cheaper lading, a better price for cargo sold off, and word ahead of the market. Where you trade becomes a position you hold.',
  },
  {
    key: 'stocks',
    group: 'Money',
    name: 'The shipping exchange',
    blurb:
      'Three companies whose share prices rise and fall with the cargo actually landed in their waters. Not another way to win: somewhere for money to go, and a market to read.',
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
  /**
   * The tinkering area is shut on arrival and only one rule group opens at a time.
   *
   * The presets are the front door — showing ten switches and three difficulty buttons before anyone
   * has picked a game is how the screen became unreadable in the first place.
   */
  const [mode, setMode] = useState<'classic' | 'voyage'>('classic');
  const [tinkering, setTinkering] = useState(false);
  const [openGroup, setOpenGroup] = useState<SwitchGroup | null>(null);
  const [level, setLevel] = useState<Difficulty>(DEFAULT_DIFFICULTY);
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
        rules: mode,
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

  /**
   * Every game on the portal requires a real account. **There is no guest path, and none is to be
   * added back** — one existed and was deliberately removed. See CLAUDE.md at the repo root.
   *
   * This check is presentational: it reads `tm_user` from localStorage and decides what to render, so
   * it is trivially satisfied client-side and protects nothing on its own. It still has to stay — it
   * is what stops the app inviting somebody to start a game they cannot save.
   *
   * The real boundary is server-side, in `api/_lib/auth.ts`: `getUser(req)` requires a Bearer JWT
   * verified against JWT_SECRET, and every game endpoint 401s without one. Do not relax either half
   * to make local work easier — to check the UI, set `tm_user` in the browser console instead.
   */
  if (!user) {
    return (
      <div style={page}>
        <PortalNav />
        <main style={{ ...content, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <Panel style={{ width: 380, textAlign: 'center' }}>
            <h2 style={{ ...dataText, fontSize: '1.3rem', margin: '0 0 0.6rem' }}>The Tea Race</h2>
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
          <p style={eyebrow}>After Ocean Trader, Clipper Games, 1988</p>
          <h1 style={title}>The Tea Race</h1>
          {/* Kept honest: a commission names the buyer and the price, never a source port — that
              stopped being true when cards lost their source, and this paragraph still claimed it. */}
          <p style={{ ...bodySmall, maxWidth: '58ch', margin: 0 }}>
            {FACE_UP_CONTRACTS} commissions are posted on the exchange at all times, each naming a
            cargo, the port that wants it and the price it is reckoned at — load it wherever you can
            get it. Only the first two ships home are paid: {PAYOUT_MULTIPLIERS[1]}× the commission
            price a lot, then {PAYOUT_MULTIPLIERS[2]}×, then nothing. Carry {SHARE_MAJORITY} of the{' '}
            {TOTAL_SHARES} company shares, {money(VICTORY_CASH)} and a ship still afloat, and the
            company is yours.
          </p>
          <Link to="/how-to-play" style={{ textDecoration: 'none', alignSelf: 'flex-start' }}>
            <Button tone="quiet">How to play →</Button>
          </Link>
        </header>

        {error && (
          <div style={errorBanner} role="alert">
            {error}
          </div>
        )}

        <Panel title="A new voyage" style={{ marginBottom: '1.5rem' }}>
          <div style={field}>
            <Label>Which game</Label>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              <Button
                tone={mode === 'classic' ? 'primary' : 'quiet'}
                title="The 1988 board game: five commissions, first two ships home paid, a share majority to win."
                onClick={() => setMode('classic')}
              >
                The tea race
              </Button>
              <Button
                tone={mode === 'voyage' ? 'primary' : 'quiet'}
                title="Free play: no commissions, no declaration. Buy where a good is grown, sell where it is wanted, and be worth the most when the season closes."
                onClick={() => setMode('voyage')}
              >
                Free play
              </Button>
            </div>
            <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
              {mode === 'classic'
                ? `The published game. ${FACE_UP_CONTRACTS} commissions, only the first two ships home paid, and ${SHARE_MAJORITY} of the ${TOTAL_SHARES} shares to take the company.`
                : `No commissions and nothing to declare. Every port has its own price for every good, producing ports are cheap and consuming ports are dear, and the market moves as cargo actually changes hands — your own trade included. ${VOYAGE_ROUNDS} rounds, and the largest fortune at the close takes the honours.`}
            </p>
          </div>

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
            <button
              type="button"
              onClick={() => setTinkering(t => !t)}
              style={{ ...sectionHead, borderBottom: 'none', paddingLeft: 0 }}
              aria-expanded={tinkering}
            >
              <span style={{ color: UI.textFaint, width: '0.8rem', display: 'inline-block' }}>
                {tinkering ? '\u2013' : '+'}
              </span>
              <span style={{ color: UI.text }}>Rivals and individual rules</span>
              <span style={{ color: UI.textFaint, marginLeft: 'auto' }}>
                {DIFFICULTIES[level].label}, {SWITCHES.filter(sw => hazards[sw.key]).length} of{' '}
                {SWITCHES.length} rules
              </span>
            </button>
            {tinkering && (
            <>
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
                captains never roll better than you do. Fewer rivals is the other dial: against three,
                one of them takes the company three times in four even when everybody plays equally.
              </p>
            </div>

            {SWITCH_GROUPS.map(group => {
              const inGroup = SWITCHES.filter(sw => sw.group === group);
              const on = inGroup.filter(sw => hazards[sw.key]).length;
              const isOpen = openGroup === group;
              return (
                <div key={group} style={{ width: '100%' }}>
                  <button
                    type="button"
                    onClick={() => setOpenGroup(isOpen ? null : group)}
                    style={sectionHead}
                    aria-expanded={isOpen}
                  >
                    <span style={{ color: UI.textFaint, width: '0.8rem', display: 'inline-block' }}>
                      {isOpen ? '\u2013' : '+'}
                    </span>
                    <span style={{ color: UI.text }}>{group}</span>
                    {/* The count is what makes a closed section still worth reading. */}
                    <span style={{ color: on > 0 ? UI.brass : UI.textFaint, marginLeft: 'auto' }}>
                      {on} of {inGroup.length}
                    </span>
                  </button>
                  {isOpen && (
                    <div style={sectionBody}>
                      {inGroup.map(sw => (
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
                    </div>
                  )}
                </div>
              );
            })}
            <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
              Three cargo slots a ship, the scaling share price and the twelve-turn countdown are the
              published rules and are always on.
            </p>
            </>
            )}
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

        <Panel title="Your voyages" aside={saves.length > 0 ? <Label>{saves.length}</Label> : undefined}>
          {saves.length === 0 ? (
            <p style={{ ...bodySmall, margin: 0, color: UI.textFaint }}>
              No voyages yet. These are saved to your account.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {/* Split, because a finished game and one waiting for your next turn are different
                  things and the list is read to find the second. Niccolo and Thrash Margin have both
                  done this for a while; these two games were the ones still lumping them together. */}
              {([
                ['In progress', saves.filter(v => v.status === 'active')],
                ['Finished', saves.filter(v => v.status !== 'active')],
              ] as const).map(([heading, group]) =>
                group.length === 0 ? null : (
                  <div key={heading} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <Label>
                      {heading} · {group.length}
                    </Label>
                    {group.map(save => {
                      const confirming = confirmDelete === save.id;
                      return (
                        <div key={save.id} style={saveRow}>
                          {/* The whole row opens it. Hunting a button in a list you are scanning is
                              friction for no reason, and it lets the row be one line instead of two. */}
                          <button
                            type="button"
                            style={saveOpen}
                            onClick={() => open(save.id)}
                            title={`Open ${save.name}`}
                          >
                            <span style={saveName}>{save.name}</span>
                            <span style={saveMeta}>
                              {save.rules === 'voyage' ? 'Free play' : 'The tea race'} · round{' '}
                              {save.turn} · {relTime(save.savedAt)}
                              {save.status !== 'active' && (
                                <span style={{ color: UI.brass }}> · finished</span>
                              )}
                            </span>
                          </button>
                          {confirming ? (
                            <span style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                              <span style={{ ...dataText, fontSize: '0.62rem', color: UI.bad }}>
                                Delete?
                              </span>
                              <Button
                                tone="danger"
                                onClick={() => {
                                  deleteGame(save.id);
                                  setConfirmDelete(null);
                                }}
                              >
                                Yes
                              </Button>
                              <Button tone="quiet" onClick={() => setConfirmDelete(null)}>
                                No
                              </Button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              style={saveDelete}
                              title={`Delete ${save.name}`}
                              aria-label={`Delete ${save.name}`}
                              onClick={() => setConfirmDelete(save.id)}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ),
              )}
            </div>
          )}
        </Panel>
      </main>
      <PortalNav variant="footer" />
    </div>
  );
}

/**
 * "3h ago" beats a timestamp for the one question this list is read to answer: which game was I in
 * the middle of? The saves already carried `savedAt` and nothing was showing it.
 */
function relTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
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
  gap: '0.4rem',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  // Tighter than it was: one line rather than a two-line block with two full-size buttons.
  padding: '0.15rem 0.3rem 0.15rem 0.5rem',
};

/** The row itself is the open button, so it fills the space and needs no separate control. */
const saveOpen: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  flexWrap: 'wrap',
  flex: 1,
  minWidth: 0,
  background: 'transparent',
  border: 'none',
  padding: '0.32rem 0',
  cursor: 'pointer',
  textAlign: 'left',
};

const saveName: React.CSSProperties = {
  fontFamily: FONT.display,
  fontSize: '0.92rem',
  color: UI.text,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '14rem',
};

const saveMeta: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.66rem',
  color: UI.textFaint,
  letterSpacing: '0.04em',
};

const saveDelete: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: UI.textFaint,
  fontSize: '0.8rem',
  lineHeight: 1,
  padding: '0.3rem 0.35rem',
  cursor: 'pointer',
  flex: '0 0 auto',
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

const sectionHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.4rem',
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: `1px solid ${UI.rule}`,
  padding: '0.35rem 0.1rem',
  fontFamily: FONT.data,
  fontSize: '0.66rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  textAlign: 'left',
};

const sectionBody: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  padding: '0.5rem 0 0.6rem 1.2rem',
};
