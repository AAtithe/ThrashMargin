import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PortalNav from '../components/PortalNav';
import SkirmishSetupPanel, { freshSeed, readStoredSetup, storeSetup } from '../components/SkirmishSetup';
import { Button, Label, Panel, bodySmall } from '../components/ui';
import { useSaves, type SaveMeta } from '../hooks/useSaves';
import { campaignSaves, isCampaignMeta } from './campaignSaves';
import { BusyLabel, LoadingRows } from '../lib/Loading';
import NoGameAccess from '../lib/NoGameAccess';
import { getStoredUser, hasGameAccess } from '../lib/portalAuth';
import { drawBuilding, drawUnit, TILE } from '../game/art';
import {
  BUILDINGS,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  MAP_TYPE_NAMES,
  TICKS_PER_SECOND,
  type MapType,
  type SkirmishSetup,
  type BuildingKind,
  type Difficulty,
  type Owner,
  type UnitKind,
} from '../sim/rules';
import { ART, FONT, UI } from '../theme';

export default function Lobby() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const savesApi = useSaves();
  const { saves: allSaves, savesLoaded, error, create, remove } = savesApi;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const camp = useMemo(() => campaignSaves(savesApi), [savesApi.cloud, savesApi.load, savesApi.save]);
  const saves = allSaves.filter(s => !isCampaignMeta(s));
  const campaigns = allSaves.filter(isCampaignMeta);
  const [commander, setCommander] = useState(() => getStoredUser()?.username ?? '');
  const [campName, setCampName] = useState('');
  const [campBusy, setCampBusy] = useState(false);
  const [campError, setCampError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  // A blank seed field still has a seed: this one, shown as the placeholder, so the previews draw
  // the very map the battle will use. "New map" draws another.
  const [autoSeed, setAutoSeed] = useState(freshSeed);
  const [setup, setSetupState] = useState<SkirmishSetup>(readStoredSetup);
  const setSetup = (v: SkirmishSetup) => {
    setSetupState(v);
    storeSetup(v);
  };
  const seedText = seed.trim() || autoSeed;
  const [level, setLevel] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await create(name.trim() || 'Operation Fireline', { seed: seedText, difficulty: level, setup });
      if (id) navigate(`/game/${id}`);
    } finally {
      setBusy(false);
    }
  };

  const beginCampaign = async () => {
    if (campBusy) return;
    setCampBusy(true);
    setCampError(null);
    try {
      const id = await camp.createCampaign(campName.trim() || 'The Fireline campaign', commander.trim() || 'Commander');
      if (id) navigate(`/game/${id}`);
      else setCampError('The campaign could not be started. Try again in a moment.');
    } catch {
      setCampError('The campaign could not be started. Try again in a moment.');
    } finally {
      setCampBusy(false);
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
        <HeroScene />
        <header style={{ marginBottom: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <p style={{ ...bodySmall, maxWidth: '62ch', margin: 0 }}>
            Command the Meridian Corps against the Ashen Combine. Build a base from a single Command Yard, send
            haulers out for ore, keep the generators ahead of demand, and train an army of riflemen, rocketeers,
            buggies, tanks and artillery. Destroy every enemy structure to win; lose all of yours and it is over.
          </p>
          <Link to="/how-to-play" style={{ textDecoration: 'none', alignSelf: 'flex-start' }}>
            <Button tone="quiet">How to play →</Button>
          </Link>
        </header>

        <section aria-label="What is new" style={{ marginBottom: '0.2rem' }}>
          <p style={eyebrow}>What is new</p>
          <ul className="fl-new" style={{ marginTop: '0.45rem' }}>
            {WHATS_NEW.map(n => (
              <li key={n.title}>
                <strong>{n.title}</strong>
                {n.text}
              </li>
            ))}
          </ul>
        </section>

        {error && (
          <div style={errorBanner} role="alert">
            {error}
          </div>
        )}

        <Panel title="Campaign" aside={<Label>8 missions</Label>} style={{ marginBottom: '1.5rem' }}>
          <div className="fl-campaign-pitch">
            <p style={{ ...bodySmall, margin: 0 }}>
              Eight missions against the Ashen Combine, one after another. Your Commander earns rank and skill points to spend on
              economy, industry and support powers. Four heroes join along the way and carry their experience from mission to
              mission: <strong>the Spy</strong>, <strong>the Commando</strong>, <strong>the Engineer</strong> and{' '}
              <strong>the Ace</strong>.
            </p>
          </div>
          <div className="fl-campaign-form">
            <div style={field}>
              <Label>Commander's name</Label>
              <input
                style={input}
                value={commander}
                placeholder="Commander"
                maxLength={32}
                data-testid="commander-name"
                onChange={e => setCommander(e.target.value)}
              />
            </div>
            <div style={field}>
              <Label>Name this campaign</Label>
              <input style={input} value={campName} placeholder="The Fireline campaign" maxLength={60} onChange={e => setCampName(e.target.value)} />
            </div>
          </div>
          {campError && (
            <div style={errorBanner} role="alert">
              {campError}
            </div>
          )}
          <div>
            <Button tone="primary" disabled={campBusy} onClick={beginCampaign}>
              {campBusy ? <BusyLabel>Starting…</BusyLabel> : 'Start a new campaign →'}
            </Button>
          </div>
          {!savesLoaded ? (
            <LoadingRows rows={1} label="Loading your campaigns" />
          ) : (
            campaigns.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="campaign-saves">
                {campaigns.map(s => (
                  <SaveRow
                    key={s.id}
                    s={s}
                    campaign
                    confirming={confirmDelete === s.id}
                    onOpen={() => navigate(`/game/${s.id}`)}
                    onAsk={() => setConfirmDelete(s.id)}
                    onKeep={() => setConfirmDelete(null)}
                    onDelete={() => remove(s.id).then(() => setConfirmDelete(null))}
                  />
                ))}
              </div>
            )
          )}
        </Panel>

        <Panel title="A new battle" aside={<Label>Skirmish</Label>} style={{ marginBottom: '1.5rem' }}>
          <div style={field}>
            <Label>Name this battle</Label>
            <input style={input} value={name} placeholder="Operation Fireline" maxLength={60} onChange={e => setName(e.target.value)} />
          </div>
          <div style={field}>
            <Label>Enemy commander</Label>
            <div className="fl-levels" role="group" aria-label="Enemy commander">
              {(Object.keys(DIFFICULTIES) as Difficulty[]).map(d => {
                const spec = DIFFICULTIES[d];
                return (
                  <button key={d} type="button" className="fl-level" aria-pressed={level === d} data-testid={`level-${d}`} onClick={() => setLevel(d)}>
                    <span className="fl-level-name">{spec.label}</span>
                    <span className="fl-level-attack">First attack ~{minutes(spec.firstAttack)} min</span>
                    <span className="fl-level-facts">
                      Waves of {spec.firstWave}, growing to {spec.waveCap}, every ~{minutes(spec.attackInterval)} min.{' '}
                      {spec.refineries} {spec.refineries === 1 ? 'refinery' : 'refineries'}, {spec.factories}{' '}
                      {spec.factories === 1 ? 'factory' : 'factories'}, up to {spec.turrets} turrets
                      {spec.income !== 1 ? `; income ×${spec.income}` : ''}.
                    </span>
                  </button>
                );
              })}
            </div>
            <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0, color: UI.textFaint }}>
              {DIFFICULTIES[level].blurb} At every level the computer sees the whole map, pays for everything it builds and
              fights with the same units you do.
            </p>
          </div>
          <div style={field}>
            <Label>Map seed</Label>
            <div className="fl-seed">
              <input
                style={{ ...input, width: 200 }}
                value={seed}
                placeholder={autoSeed}
                aria-label="Map seed"
                data-testid="seed"
                maxLength={64}
                onChange={e => setSeed(e.target.value)}
              />
              <Button
                tone="quiet"
                onClick={() => {
                  setSeed('');
                  setAutoSeed(freshSeed());
                }}
              >
                New map
              </Button>
            </div>
            <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0, color: UI.textFaint }}>
              Leave it as it is for a fresh map, or type any word: the same seed and settings always draw the same battlefield.
            </p>
          </div>
          <SkirmishSetupPanel value={setup} onChange={setSetup} seedText={seedText} />
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
                <SaveRow
                  key={s.id}
                  s={s}
                  confirming={confirmDelete === s.id}
                  onOpen={() => navigate(`/game/${s.id}`)}
                  onAsk={() => setConfirmDelete(s.id)}
                  onKeep={() => setConfirmDelete(null)}
                  onDelete={() => remove(s.id).then(() => setConfirmDelete(null))}
                />
              ))}
            </div>
          )}
        </Panel>
      </main>
      <PortalNav variant="footer" />
    </div>
  );
}

/** One saved battle or campaign in a list. */
function SaveRow({
  s,
  campaign = false,
  confirming,
  onOpen,
  onAsk,
  onKeep,
  onDelete,
}: {
  s: SaveMeta;
  campaign?: boolean;
  confirming: boolean;
  onOpen: () => void;
  onAsk: () => void;
  onKeep: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={row} data-kind={campaign ? 'campaign' : 'skirmish'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <strong style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {campaign && <span className="fl-badge">Campaign</span>}
          {s.name}
        </strong>
        <span style={{ fontSize: '0.74rem', color: UI.textFaint }}>
          {campaign ? (
            'Career in progress'
          ) : s.status === 'victory' ? (
            <span style={{ color: UI.good }}>Victory</span>
          ) : s.status === 'defeated' ? (
            <span style={{ color: UI.bad }}>Defeat</span>
          ) : (
            'In progress'
          )}
          {!campaign && ` · ${s.turn} min`}
          {!campaign && mapTypeOf(s) && ` · ${MAP_TYPE_NAMES[mapTypeOf(s)!]}`}
          {!campaign && sidesOfSave(s) && ` · ${sidesOfSave(s)}`} · saved {new Date(s.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {confirming ? (
          <>
            <Button tone="danger" onClick={onDelete}>
              Delete
            </Button>
            <Button tone="quiet" onClick={onKeep}>
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button tone={campaign || s.status === 'active' ? 'primary' : 'default'} onClick={onOpen}>
              {campaign ? 'Continue' : s.status === 'active' ? 'Resume' : 'View'}
            </Button>
            <Button tone="quiet" onClick={onAsk} title={campaign ? 'Delete this campaign' : 'Delete this battle'}>
              ✕
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** The battle's map type, when the saves list carries it (older rows and servers do not). */
const mapTypeOf = (s: SaveMeta): MapType | null => {
  const t = (s as SaveMeta & { mapType?: unknown }).mapType;
  return typeof t === 'string' && t in MAP_TYPE_NAMES ? (t as MapType) : null;
};

/** "3 sides, free for all", "2 against 2" or "2 against 1" for a battle of more than two sides; null for two. */
const sidesOfSave = (s: SaveMeta): string | null => {
  const n = (s as SaveMeta & { sides?: unknown }).sides;
  if (n !== 3 && n !== 4) return null;
  return s.mode === 'teams' ? (n === 4 ? '2 against 2' : '2 against 1') : `${n} sides, free for all`;
};

const page: CSSProperties = { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body };
const content: CSSProperties = { flex: 1, width: '100%', maxWidth: 820, margin: '0 auto', padding: '2rem 1rem 3rem' };
const eyebrow: CSSProperties = { margin: 0, fontSize: '0.7rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: UI.accent };
const eyebrowOnArt: CSSProperties = { ...eyebrow, color: 'var(--ui-on-art-soft)' };
const title: CSSProperties = { margin: 0, fontFamily: FONT.display, fontSize: 'clamp(2rem, 6vw, 3rem)', letterSpacing: '0.12em', lineHeight: 1 };
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.4rem' };
const input: CSSProperties = {
  fontFamily: 'inherit',
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

// ---- The hero banner ----------------------------------------------------------------------
// A small battle drawn with the game's own art functions: the Meridian Corps pushing into an
// Ashen Combine outpost. Canvas paint, so it may use the battlefield's hex palette.

const HERO_H = 210;
const UNIT_SCALE = 1.45;

type HeroUnit = { kind: UnitKind; owner: Owner; x: number; y: number; face: number; target: number; period: number; offset: number };
type HeroBuilding = { kind: BuildingKind; owner: Owner; x: number; y: number };

/** Positions are fractions of the banner's width (x) and pixels (y). */
const HERO_BUILDINGS: HeroBuilding[] = [
  { kind: 'hq', owner: 0, x: 0.02, y: 28 },
  { kind: 'power', owner: 0, x: 0.17, y: 118 },
  { kind: 'uplink', owner: 1, x: 0.9, y: 24 },
  { kind: 'barracks', owner: 1, x: 0.8, y: 128 },
  { kind: 'turret', owner: 1, x: 0.74, y: 70 },
];

const HERO_UNITS: HeroUnit[] = [
  { kind: 'tank', owner: 0, x: 0.47, y: 70, face: 0.08, target: 4, period: 2.6, offset: 0 },
  { kind: 'tank', owner: 0, x: 0.52, y: 132, face: -0.1, target: 12, period: 2.9, offset: 1.1 },
  { kind: 'rocketeer', owner: 0, x: 0.57, y: 98, face: 0, target: 4, period: 3.4, offset: 0.6 },
  { kind: 'rifleman', owner: 0, x: 0.6, y: 118, face: 0, target: 13, period: 1.1, offset: 0.2 },
  { kind: 'rifleman', owner: 0, x: 0.585, y: 146, face: 0, target: 13, period: 1.2, offset: 0.7 },
  { kind: 'buggy', owner: 0, x: 0.41, y: 168, face: -0.2, target: -1, period: 0, offset: 0 },
  { kind: 'hauler', owner: 0, x: 0.3, y: 60, face: 0.3, target: -1, period: 0, offset: 0 },
  { kind: 'tank', owner: 1, x: 0.71, y: 150, face: Math.PI + 0.15, target: 6, period: 2.7, offset: 1.6 },
  { kind: 'rifleman', owner: 1, x: 0.69, y: 112, face: Math.PI, target: 8, period: 1.15, offset: 0.4 },
];

function paintHeroGround(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = ART.grass[0];
  g.fillRect(0, 0, w, h);
  // Deterministic speckle, so the ground does not shimmer on resize.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (w * h) / 90; i++) {
    g.fillStyle = ART.grass[Math.floor(rnd() * ART.grass.length)];
    g.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 6, 3 + rnd() * 6);
  }
  for (let i = 0; i < 9; i++) {
    g.fillStyle = ART.dirt[i % ART.dirt.length];
    g.globalAlpha = 0.55;
    g.beginPath();
    g.ellipse(rnd() * w, rnd() * h, 30 + rnd() * 60, 14 + rnd() * 24, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // A churned track between the two bases.
  g.strokeStyle = ART.dirtDark;
  g.globalAlpha = 0.35;
  g.lineWidth = 26;
  g.beginPath();
  g.moveTo(0.1 * w, 100);
  g.bezierCurveTo(0.35 * w, 140, 0.55 * w, 70, 0.95 * w, 110);
  g.stroke();
  g.globalAlpha = 1;
  // An ore field.
  for (let i = 0; i < 60; i++) {
    const x = 0.3 * w + (rnd() - 0.5) * 130;
    const y = 150 + (rnd() - 0.5) * 70;
    g.fillStyle = ART.oreGround;
    g.fillRect(x - 6, y - 6, 12, 12);
    g.fillStyle = rnd() < 0.3 ? ART.oreGlow : ART.ore;
    g.beginPath();
    g.arc(x, y, 1.5 + rnd() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  // Trees along the top edge.
  for (let i = 0; i < w / 26; i++) {
    const x = rnd() * w;
    const y = rnd() * 14;
    g.fillStyle = ART.treeDark;
    g.beginPath();
    g.arc(x + 2, y + 3, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rnd() < 0.5 ? ART.tree : ART.treeLight;
    g.beginPath();
    g.arc(x, y, 9, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function HeroScene() {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const box = wrap.current;
    if (!canvas || !box) return;
    let still = false;
    try {
      still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      still = false;
    }
    let ground: HTMLCanvasElement | null = null;
    let w = 0;
    let raf = 0;
    const smoke: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    let lastNow = 0;
    const draw = (now: number) => {
      const t = still ? 4.2 : now / 1000;
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = box.clientWidth;
      if (cw <= 0) {
        // Not laid out yet: a zero-width canvas cannot be drawn. Try again next frame.
        if (!still) raf = requestAnimationFrame(draw);
        return;
      }
      if (cw !== w || !ground) {
        w = cw;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(HERO_H * dpr);
        ground = paintHeroGround(w, HERO_H);
      }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(ground, 0, 0);
      const pos = (u: { x: number; y: number }) => ({ x: u.x * w, y: u.y });
      const targetOf = (i: number) => {
        if (i < 0) return null;
        return i < HERO_BUILDINGS.length
          ? { x: HERO_BUILDINGS[i].x * w + (BUILDINGS[HERO_BUILDINGS[i].kind].w * TILE) / 2, y: HERO_BUILDINGS[i].y + (BUILDINGS[HERO_BUILDINGS[i].kind].h * TILE) / 2 }
          : (() => {
              const u = HERO_UNITS[i - HERO_BUILDINGS.length];
              return u ? pos(u) : null;
            })();
      };
      for (const b of HERO_BUILDINGS) {
        const turret = b.kind === 'turret' ? Math.atan2(132 - b.y, 0.52 * w - b.x * w) : 0;
        drawBuilding(ctx, b.kind, b.owner, b.x * w, b.y, { t, rise: 1, lowPower: false, turret, sinceShot: ((t + 0.8) % 2.4) });
      }
      const shots: { x: number; y: number; tx: number; ty: number; age: number; heavy: boolean }[] = [];
      for (const u of HERO_UNITS) {
        const p = pos(u);
        const tg = targetOf(u.target);
        const aim = tg ? Math.atan2(tg.y - p.y, tg.x - p.x) : u.face;
        const since = u.period ? (t + u.offset) % u.period : 9;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(UNIT_SCALE, UNIT_SCALE);
        drawUnit(ctx, u.kind, u.owner, 0, 0, {
          hull: u.kind === 'rifleman' || u.kind === 'rocketeer' ? aim : u.face,
          turret: aim,
          t,
          moving: u.kind === 'buggy' || u.kind === 'hauler',
          cargo: u.kind === 'hauler' ? 0.7 : 0,
          sinceShot: since,
        });
        ctx.restore();
        if (tg && since < 0.35) shots.push({ x: p.x, y: p.y, tx: tg.x, ty: tg.y, age: since, heavy: u.kind !== 'rifleman' });
      }
      // The turret answers the nearer tank.
      const turret = HERO_BUILDINGS[4];
      const ts = (t + 0.8) % 2.4;
      if (ts < 0.35) shots.push({ x: turret.x * w + 16, y: turret.y + 16, tx: 0.52 * w, ty: 132, age: ts, heavy: true });
      for (const s of shots) {
        const k = s.age / 0.35;
        if (k < 0.3) {
          ctx.strokeStyle = s.heavy ? 'rgba(255, 214, 140, 0.9)' : 'rgba(255, 240, 170, 0.8)';
          ctx.lineWidth = s.heavy ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + (s.tx - s.x) * (k / 0.3), s.y + (s.ty - s.y) * (k / 0.3));
          ctx.stroke();
        }
        if (s.heavy && k > 0.25) {
          const r = 4 + k * 12;
          ctx.fillStyle = `rgba(255, ${Math.round(170 - k * 90)}, 60, ${0.9 * (1 - k)})`;
          ctx.beginPath();
          ctx.arc(s.tx + Math.sin(s.x) * 6, s.ty + Math.cos(s.y) * 6, r, 0, Math.PI * 2);
          ctx.fill();
          if (!still && Math.random() < 0.3) smoke.push({ x: s.tx, y: s.ty, vx: (Math.random() - 0.5) * 6, vy: -8 - Math.random() * 6, life: 1 });
        }
      }
      // Smoke from the burning barracks and the impacts.
      if (!still && Math.random() < dt * 8) {
        const b = HERO_BUILDINGS[3];
        smoke.push({ x: b.x * w + 20 + Math.random() * 20, y: b.y + 18, vx: 4 + Math.random() * 4, vy: -10 - Math.random() * 6, life: 1 });
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        const p = smoke[i];
        p.life -= dt * 0.45;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life <= 0) {
          smoke.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `rgba(40, 40, 38, ${0.35 * p.life})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 + (1 - p.life) * 12, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => {
      if (still) raf = requestAnimationFrame(draw);
    });
    ro.observe(box);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return (
    <div ref={wrap} className="fl-hero">
      <canvas ref={ref} aria-hidden="true" data-testid="lobby-hero" style={{ height: HERO_H }} />
      <div className="fl-hero-text">
        <p style={eyebrowOnArt}>Real-time strategy</p>
        <h1 style={title}>FIRELINE</h1>
        <p style={{ fontSize: '0.84rem', lineHeight: 1.45 }}>One Command Yard, a field of ore, and an enemy who is already building. Hold the line.</p>
      </div>
    </div>
  );
}

const minutes = (ticks: number) => {
  const m = ticks / TICKS_PER_SECOND / 60;
  return Number.isInteger(m) ? `${m}` : m.toFixed(1);
};

/** What changed lately, in a line each. */
const WHATS_NEW: { title: string; text: string }[] = [
  { title: 'Six battlefields', text: 'River, Highlands, Lakes, Plains, Canyon or Classic, or let the seed choose. See each map before you deploy.' },
  { title: 'Advanced tech', text: 'Grenadiers, Medics, Flame Tanks, Missile Carriers, the Bastion, walls, a Repair Bay, and powers: recon, barrage, missile.' },
  { title: 'The campaign', text: 'Eight missions, a Commander who ranks up and learns perks, four heroes who level up, and support powers.' },
  { title: 'A battlefield that remembers', text: 'Tread marks, burnt-out wrecks and rubble where structures fell. Bigger explosions, living water, drifting cloud.' },
  { title: 'Richer art', text: 'Detailed tanks and structures with working machinery, and damage you can see: scorch, holes, sparks and fire.' },
  { title: 'Veterans and stances', text: 'Units promote at 3 and 7 kills. Set each group to aggressive, guard or hold fire.' },
  { title: 'Waypoints', text: 'Shift + right-click queues orders. Crews run out of fallen structures.' },
  { title: 'Faster commands', text: 'The letter on each build button builds it, Tab switches lists, Shift queues five. Hover anything for its numbers.' },
  { title: 'Combat alerts', text: 'Attacks on your base or haulers ping the radar; Space jumps there. Low power and short funds are flagged.' },
];
