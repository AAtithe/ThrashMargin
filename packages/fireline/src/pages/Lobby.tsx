import { useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PortalNav from '../components/PortalNav';
import { Button, Label, Panel, bodySmall } from '../components/ui';
import { useSaves } from '../hooks/useSaves';
import { BusyLabel, LoadingRows } from '../lib/Loading';
import NoGameAccess from '../lib/NoGameAccess';
import { getStoredUser, hasGameAccess } from '../lib/portalAuth';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, type Difficulty } from '../sim/rules';
import { FONT, UI } from '../theme';

export default function Lobby() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const { saves, savesLoaded, error, create, remove } = useSaves();
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [level, setLevel] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await create(name.trim() || 'Operation Fireline', { seed: seed.trim() || undefined, difficulty: level });
      if (id) navigate(`/game/${id}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Every game on the portal requires a real account. There is no guest path, and none is to be
   * added back: one existed and was deliberately removed. See CLAUDE.md at the repo root.
   *
   * This check is presentational: it reads `tm_user` from localStorage and decides what to render,
   * so it protects nothing on its own. It still has to stay, because it is what stops the app
   * inviting somebody to start a battle they cannot save. The real boundary is server-side, in
   * `api/_lib/auth.ts`: every game endpoint 401s without a verified Bearer JWT. Do not relax either
   * half to make local work easier; to check the UI, set `tm_user` in the browser console instead.
   */
  if (!user) {
    return (
      <div style={page}>
        <PortalNav />
        <main style={{ ...content, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <Panel style={{ width: 380, textAlign: 'center' }}>
            <h2 style={{ fontFamily: FONT.display, fontSize: '1.4rem', margin: '0 0 0.6rem', letterSpacing: '0.06em' }}>FIRELINE</h2>
            <p style={{ ...bodySmall, margin: '0 0 1.6rem' }}>Sign in to keep your battles on your account.</p>
            <Button tone="primary" onClick={() => (window.location.href = '/thrash-margin/login?next=/fireline/')}>
              Sign in / Register →
            </Button>
          </Panel>
        </main>
        <PortalNav variant="footer" />
      </div>
    );
  }

  // Game access, set per account on the Admin page. Presentational, like the check above: the
  // server refuses every request to a game the account does not have (api/play/[kind].ts).
  if (!hasGameAccess(user, 'fireline')) {
    return <NoGameAccess title="Fireline" header={<PortalNav variant="header" />} footer={<PortalNav variant="footer" />} />;
  }

  return (
    <div style={page}>
      <PortalNav />
      <main style={content}>
        <header style={{ marginBottom: '1.8rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <p style={eyebrow}>Real-time strategy</p>
          <h1 style={title}>FIRELINE</h1>
          <p style={{ ...bodySmall, maxWidth: '62ch', margin: 0 }}>
            Command the Meridian Corps against the Ashen Combine. Build a base from a single Command Yard, send
            haulers out for ore, keep the generators ahead of demand, and train an army of riflemen, rocketeers,
            buggies, tanks and artillery. Destroy every enemy structure to win; lose all of yours and it is over.
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

        <Panel title="A new battle" style={{ marginBottom: '1.5rem' }}>
          <div style={field}>
            <Label>Name this battle</Label>
            <input style={input} value={name} placeholder="Operation Fireline" maxLength={60} onChange={e => setName(e.target.value)} />
          </div>
          <div style={field}>
            <Label>Enemy commander</Label>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {(Object.keys(DIFFICULTIES) as Difficulty[]).map(d => (
                <Button key={d} tone={level === d ? 'primary' : 'quiet'} onClick={() => setLevel(d)}>
                  {DIFFICULTIES[d].label}
                </Button>
              ))}
            </div>
            <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0, color: UI.textFaint }}>
              {DIFFICULTIES[level].blurb} At every level the computer sees the whole map, pays for everything it builds and
              fights with the same units you do.
            </p>
          </div>
          <div style={field}>
            <Label>Map seed (optional)</Label>
            <input style={{ ...input, width: 200 }} value={seed} placeholder="leave blank for a fresh map" maxLength={64} onChange={e => setSeed(e.target.value)} />
            <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0, color: UI.textFaint }}>
              The same seed always draws the same battlefield. Every map is mirrored, so both sides start with the same
              ground and the same ore.
            </p>
          </div>
          <div>
            <Button tone="primary" disabled={busy} onClick={begin}>
              {busy ? <BusyLabel>Deploying…</BusyLabel> : 'Begin the battle →'}
            </Button>
          </div>
          <p style={{ ...bodySmall, fontSize: '0.74rem', margin: 0, color: UI.textFaint }}>
            Best with a mouse and keyboard on a laptop or desktop screen.
          </p>
        </Panel>

        <Panel title="Your battles" aside={saves.length > 0 ? <Label>{saves.length}</Label> : undefined}>
          {!savesLoaded ? (
            <LoadingRows rows={2} label="Loading your battles" />
          ) : saves.length === 0 ? (
            <p style={{ ...bodySmall, margin: 0, color: UI.textFaint }}>No battles yet. They are saved to your account as you play.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {saves.map(s => (
                <div key={s.id} style={row}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <strong style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</strong>
                    <span style={{ fontSize: '0.74rem', color: UI.textFaint }}>
                      {s.status === 'victory' ? (
                        <span style={{ color: UI.good }}>Victory</span>
                      ) : s.status === 'defeated' ? (
                        <span style={{ color: UI.bad }}>Defeat</span>
                      ) : (
                        'In progress'
                      )}{' '}
                      · {s.turn} min · saved {new Date(s.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {confirmDelete === s.id ? (
                      <>
                        <Button tone="danger" onClick={() => remove(s.id).then(() => setConfirmDelete(null))}>
                          Delete
                        </Button>
                        <Button tone="quiet" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button tone={s.status === 'active' ? 'primary' : 'default'} onClick={() => navigate(`/game/${s.id}`)}>
                          {s.status === 'active' ? 'Resume' : 'View'}
                        </Button>
                        <Button tone="quiet" onClick={() => setConfirmDelete(s.id)}>
                          ✕
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </main>
      <PortalNav variant="footer" />
    </div>
  );
}

const page: CSSProperties = { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body };
const content: CSSProperties = { flex: 1, width: '100%', maxWidth: 820, margin: '0 auto', padding: '2rem 1rem 3rem' };
const eyebrow: CSSProperties = { margin: 0, fontSize: '0.7rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: UI.accent };
const title: CSSProperties = { margin: 0, fontFamily: FONT.display, fontSize: 'clamp(2rem, 6vw, 3rem)', letterSpacing: '0.12em', lineHeight: 1 };
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.4rem' };
const input: CSSProperties = {
  font: 'inherit',
  fontSize: '0.9rem',
  padding: '0.45rem 0.6rem',
  border: `1px solid ${UI.rule}`,
  background: UI.ground,
  color: UI.text,
  borderRadius: 3,
  maxWidth: '100%',
};
const row: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  padding: '0.55rem 0.7rem',
  border: `1px solid ${UI.rule}`,
  background: UI.panelRaised,
  borderRadius: 3,
};
const errorBanner: CSSProperties = {
  padding: '0.6rem 0.8rem',
  marginBottom: '1rem',
  border: `1px solid ${UI.bad}`,
  background: UI.tintBad,
  color: UI.bad,
  fontSize: '0.85rem',
};
