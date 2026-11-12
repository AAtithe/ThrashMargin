import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PortalNav from '../components/PortalNav';
import GamePacePicker, { attackText } from '../components/GamePacePicker';
import SkirmishSetupPanel, { RESEARCH_TEXT, SetupStep, TECH_TEXT, freshSeed, readStoredSetup, storeSetup } from '../components/SkirmishSetup';
import { Button, Label, Panel, bodySmall } from '../components/ui';
import { drawMap, mapFontsReady } from '../components/campaignArtBridge';
import { previewView } from '../campaign/theatre';
import { useSaves, type SaveMeta } from '../hooks/useSaves';
import { campaignSaves, isCampaignMeta, isPlanetMeta } from './campaignSaves';
import WarSetup from '../components/planet/WarSetup';
import { startPlanetTour } from '../components/planet/PlanetTour';
import type { LengthPreset } from '../planet/types';
import { MISSIONS } from '../campaign/missions';
import { ACT_TWO } from '../campaign/act2';
import { BusyLabel, LoadingRows } from '../lib/Loading';
import NoGameAccess from '../lib/NoGameAccess';
import { getStoredUser, hasGameAccess } from '../lib/portalAuth';
import { onSchemeChange } from '../lib/colorScheme';
import { currentPace } from '../lib/motion';
import { drawBuilding, drawUnit, TILE } from '../game/art';
import {
  BUILDINGS,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  FACTION_NAMES,
  GAME_PACES,
  GENERAL_FACTION,
  GENERALS,
  MAP_SIZE_NAMES,
  MAP_TYPE_NAMES,
  TICKS_PER_SECOND,
  applyPace,
  difficultyForPace,
  type MapType,
  type SkirmishSetup,
  type BuildingKind,
  type Difficulty,
  type Owner,
  type UnitKind,
} from '../sim/rules';
import { ART, FONT, UI } from '../theme';
import { scaledForSetup } from '../sim/aiScale';

/** The campaign's shape, counted from the mission lists so the lobby's copy cannot go stale again. */
const CAMPAIGN_MISSIONS = MISSIONS.length;
const ACT_TWO_IDS = new Set(ACT_TWO.map(m => m.id));
const ACT_ONE_MISSIONS = MISSIONS.filter(m => !ACT_TWO_IDS.has(m.id)).length;
const ACT_TWO_MISSIONS = CAMPAIGN_MISSIONS - ACT_ONE_MISSIONS;
const HERO_NAMES = MISSIONS.flatMap(m => m.rewards.unlockHeroes ?? []);
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Scroll to one of the lobby's sections, smoothly unless motion is off. */
const goTo = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: currentPace() === 'off' ? 'auto' : 'smooth', block: 'start' });
};

export default function Lobby() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const savesApi = useSaves();
  const { saves: allSaves, savesLoaded, error, create, remove } = savesApi;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const camp = useMemo(() => campaignSaves(savesApi), [savesApi.cloud, savesApi.load, savesApi.save]);
  const saves = allSaves.filter(s => !isCampaignMeta(s) && !isPlanetMeta(s));
  const campaigns = allSaves.filter(isCampaignMeta);
  // The campaign the theatre preview shows and the war-room card offers to continue: the latest saved.
  const latest = campaigns.reduce<SaveMeta | null>((a, s) => (!a || s.savedAt > a.savedAt ? s : a), null);
  const wars = allSaves.filter(isPlanetMeta);
  const [warError, setWarError] = useState<string | null>(null);
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
  // The new-battle panel opens on the game size cards every visit; Customise shows the full setup.
  const [setupStep, setSetupStep] = useState<'size' | 'custom'>('size');
  const newBattleRef = useRef<HTMLElement>(null);
  const stepChanged = useRef(false);
  useEffect(() => {
    // Switching step replaces most of the panel: bring its top back into view, not on first render.
    if (!stepChanged.current) {
      stepChanged.current = true;
      return;
    }
    const el = newBattleRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  }, [setupStep]);
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

  const latestWon = latest ? Math.min(CAMPAIGN_MISSIONS, Math.max(0, latest.turn)) : 0;
  const mapLabel = setup.map === 'random' ? 'Random map' : `${MAP_TYPE_NAMES[setup.map]}`;

  return (
    <div style={page}>
      <PortalNav />
      <main style={content} className="fl-lobby">
        <HeroScene>
          <div className="fl-hero-actions">
            <button type="button" className="fl-hero-cta" data-tone="primary" onClick={() => goTo('fl-campaign')}>
              <span className="fl-hero-cta-num">01</span>
              {latest ? 'Continue the campaign' : 'Campaign'}
            </button>
            <button type="button" className="fl-hero-cta" onClick={() => goTo('fl-war')}>
              <span className="fl-hero-cta-num">02</span>
              War for the Planet
            </button>
            <button type="button" className="fl-hero-cta" onClick={() => goTo('fl-skirmish')}>
              <span className="fl-hero-cta-num">03</span>
              Skirmish
            </button>
            <Link to="/how-to-play" className="fl-hero-cta" data-tone="quiet">
              How to play →
            </Link>
          </div>
        </HeroScene>

        <div className="fl-lobby-intro">
          <p style={{ ...bodySmall, margin: 0 }}>
            Command the Meridian Corps against the Ashen Combine. Build a base from a single Command Yard, send haulers out for
            ore, keep the generators ahead of demand, and train an army of riflemen, rocketeers, buggies, tanks and artillery.
            Destroy every enemy structure to win; lose all of yours and it is over.
          </p>
          <nav className="fl-lobby-path" aria-label="Lobby sections">
            <button type="button" onClick={() => goTo('fl-campaign')}>
              <span>01</span>Campaign
            </button>
            <button type="button" onClick={() => goTo('fl-war')}>
              <span>02</span>War for the Planet{wars.length > 0 ? ` (${wars.length})` : ''}
            </button>
            <button type="button" onClick={() => goTo('fl-skirmish')}>
              <span>03</span>Skirmish
            </button>
            <button type="button" onClick={() => goTo('fl-battles')}>
              <span>04</span>Your battles{saves.length > 0 ? ` (${saves.length})` : ''}
            </button>
          </nav>
        </div>

        <WhatsNew />

        {error && (
          <div style={errorBanner} role="alert">
            {error}
          </div>
        )}

        <section id="fl-campaign" className="fl-lobby-section fl-campaign-card" aria-labelledby="fl-campaign-title">
          <SectionHead num="01" kicker="Primary operation" title="Campaign" id="fl-campaign-title">
            <Label>
              {CAMPAIGN_MISSIONS} missions · 2 acts
            </Label>
          </SectionHead>
          <div className="fl-campaign-grid">
            <CampaignTheatre
              won={latestWon}
              label={latest ? `Theatre map: open ${latest.name}, ${latestWon} of ${CAMPAIGN_MISSIONS} missions won` : 'Theatre map: begin a campaign'}
              onOpen={() => (latest ? navigate(`/game/${latest.id}`) : beginCampaign())}
              caption={latest ? latest.name : 'A fresh campaign'}
            />
            <div className="fl-campaign-brief">
              <p style={{ ...bodySmall, margin: 0 }}>
                {capital(inWords(CAMPAIGN_MISSIONS))} missions against the Ashen Combine, in two acts: {inWords(ACT_ONE_MISSIONS)} along
                the southern coast, then {inWords(ACT_TWO_MISSIONS)} more on the northern coast and in the highlands. Your Commander earns
                rank and skill points to spend on economy, industry and support powers.
              </p>
              <dl className="fl-campaign-facts">
                <div>
                  <dt>Missions</dt>
                  <dd>{CAMPAIGN_MISSIONS}</dd>
                </div>
                <div>
                  <dt>Acts</dt>
                  <dd>2</dd>
                </div>
                <div>
                  <dt>Heroes</dt>
                  <dd>{HERO_NAMES.length}</dd>
                </div>
              </dl>
              <p className="fl-campaign-heroes">
                Joining along the way, and keeping their experience from mission to mission: <strong>the Spy</strong>,{' '}
                <strong>the Commando</strong>, <strong>the Engineer</strong> and <strong>the Ace</strong>.
              </p>
              {latest && (
                <div className="fl-campaign-latest">
                  <div style={{ minWidth: 0 }}>
                    <span className="fl-campaign-latest-kicker">Latest campaign</span>
                    <strong>{latest.name}</strong>
                    <Progress won={latestWon} />
                  </div>
                  <Button tone="primary" onClick={() => navigate(`/game/${latest.id}`)}>
                    Continue →
                  </Button>
                </div>
              )}
              <div className="fl-campaign-new">
                <span className="fl-campaign-latest-kicker">{latest ? 'Or begin another' : 'Begin a campaign'}</span>
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
                  <Button tone={latest ? 'default' : 'primary'} disabled={campBusy} onClick={beginCampaign}>
                    {campBusy ? <BusyLabel>Starting…</BusyLabel> : 'Start a new campaign →'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          {!savesLoaded ? (
            <LoadingRows rows={1} label="Loading your campaigns" />
          ) : (
            campaigns.length > 0 && (
              <div className="fl-saves" data-testid="campaign-saves">
                <span className="fl-saves-label">Your campaigns</span>
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
        </section>

        <section id="fl-war" className="fl-lobby-section" aria-labelledby="fl-war-title">
          <SectionHead num="02" kicker="Strategic campaign" title="War for the Planet" id="fl-war-title">
            <Label>Turn-based · every attack a battle</Label>
          </SectionHead>
          <WarSetup
            defaultCommander={commander}
            onBegin={async (req, guided) => {
              setWarError(null);
              try {
                const id = await camp.createPlanet(req);
                if (id) {
                  if (guided) startPlanetTour(id);
                  navigate(`/game/${id}`);
                  return true;
                }
              } catch {
                /* Reported below. */
              }
              setWarError('The war could not be started. Try again in a moment.');
              return false;
            }}
          />
          {warError && (
            <div style={{ ...errorBanner, marginTop: '1rem' }} role="alert">
              {warError}
            </div>
          )}
          {!savesLoaded ? (
            <LoadingRows rows={1} label="Loading your wars" />
          ) : (
            wars.length > 0 && (
              <div className="fl-saves" data-testid="war-saves">
                <span className="fl-saves-label">Your wars</span>
                {wars.map(s => (
                  <SaveRow
                    key={s.id}
                    s={s}
                    war
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
        </section>

        <section id="fl-skirmish" ref={newBattleRef} className="fl-lobby-section" aria-labelledby="fl-skirmish-title">
          <SectionHead num="03" kicker="Skirmish" title="A new battle" id="fl-skirmish-title">
            <Label>{setupStep === 'size' ? 'You against the computer' : `Customise · ${GAME_PACES[setup.pace].name}`}</Label>
          </SectionHead>
          {setupStep === 'custom' && (
            <div className="fl-steps-back">
              <Button tone="quiet" testId="setup-back" onClick={() => setSetupStep('size')}>
                ← Game size
              </Button>
            </div>
          )}
          <ol className="fl-steps">
            {setupStep === 'size' && (
              <SetupStep n={1} title="Game size" hint="How long a battle, on how much ground. Customise changes any of it.">
                <GamePacePicker value={setup} onPick={pace => setSetup(applyPace(setup, pace))} />
              </SetupStep>
            )}
            <SetupStep n={setupStep === 'size' ? 2 : 1} title="Enemy commander" hint="How hard, and how soon, the other side comes for you.">
              <div className="fl-levels" role="group" aria-label="Enemy commander">
                {(Object.keys(DIFFICULTIES) as Difficulty[]).map(d => {
                  const spec = scaledForSetup(setup, difficultyForPace(d, setup.pace));
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
              <p className="fl-setup-note">
                {DIFFICULTIES[level].blurb}
                {GAME_PACES[setup.pace].attackMul !== 1 &&
                  ` At ${GAME_PACES[setup.pace].name} size every attack comes ${attackText(GAME_PACES[setup.pace].attackMul).toLowerCase()}${(setup.size ?? 'standard') !== 'standard' ? ', and later still on a larger map' : ''}: the first at about ${minutes(scaledForSetup(setup, difficultyForPace(level, setup.pace)).firstAttack)} minutes.`}{' '}
                At every level the computer sees the whole map, pays for everything it builds and fights with the same units you do.
              </p>
            </SetupStep>
            {setupStep === 'custom' && (
              <SkirmishSetupPanel
                value={setup}
                onChange={setSetup}
                seedText={seedText}
                seedSlot={
                  <div className="fl-setup-field">
                    <Label>Map seed</Label>
                    <div className="fl-seed">
                      <input
                        style={{ ...input, width: 200, fontFamily: FONT.mono }}
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
                    <p className="fl-setup-note">
                      Leave it as it is for a fresh map, or type any word: the same seed and settings always draw the same battlefield.
                    </p>
                  </div>
                }
              />
            )}
            <SetupStep
              n={setupStep === 'size' ? 3 : 5}
              title="Deploy"
              hint={setupStep === 'size' ? 'Check the orders and go, or customise the map, sides and terms first.' : 'Check the orders, name the operation and go.'}
            >
              <ul className="fl-orders" aria-label="Battle orders" data-testid="setup-summary">
                <Order k="Game size">{GAME_PACES[setup.pace].name}</Order>
                <Order k="Enemy">{DIFFICULTIES[level].label}</Order>
                <Order k="Map">{mapLabel}</Order>
                <Order k="Sides">{setup.sides === 2 ? '1 against 1' : setup.mode === 'teams' ? (setup.sides === 4 ? '2 against 2' : '2 against 1') : `${setup.sides}, free for all`}</Order>
                <Order k="Tech">{TECH_TEXT[setup.tech].name}</Order>
                {setup.tech === 'advanced' && <Order k="Research">{RESEARCH_TEXT[setup.research].name}</Order>}
                <Order k="Credits">{setup.credits.toLocaleString('en-GB')}</Order>
                <Order k="Ore">{capital(setup.ore)}</Order>
                <Order k="Map size">{MAP_SIZE_NAMES[setup.size ?? 'standard']}</Order>
                <Order k="Sites">{setup.sites ? 'On' : 'Off'}</Order>
                {/* Round 6: each seat's army and doctrine General, and the two advanced-tech options. */}
                <Order k="Armies">{armiesLabel(setup)}</Order>
                <Order k="Your General">{generalLabel(setup)}</Order>
                {setup.tech === 'advanced' && <Order k="Heroes">{setup.heroes ? 'On' : 'Off'}</Order>}
                {setup.tech === 'advanced' && <Order k="Generals">{setup.generals ? 'On' : 'Off'}</Order>}
                <Order k="Seed">{seedText}</Order>
              </ul>
              <div className="fl-deploy">
                <div style={{ ...field, flex: '1 1 220px', marginBottom: 0 }}>
                  <Label>Name this battle</Label>
                  <input style={input} value={name} placeholder="Operation Fireline" maxLength={60} onChange={e => setName(e.target.value)} />
                </div>
                <div className="fl-begin-row">
                  <Button tone="primary" disabled={busy} onClick={begin} style={{ padding: '0.6rem 1.1rem', fontSize: '0.9rem' }}>
                    {busy ? <BusyLabel>Deploying…</BusyLabel> : 'Begin the battle →'}
                  </Button>
                  {setupStep === 'size' && (
                    <Button tone="quiet" testId="setup-customise" onClick={() => setSetupStep('custom')}>
                      Customise →
                    </Button>
                  )}
                </div>
              </div>
              <p className="fl-setup-note">Best with a mouse and keyboard on a laptop or desktop screen.</p>
            </SetupStep>
          </ol>
        </section>

        <section id="fl-battles" className="fl-lobby-section" aria-labelledby="fl-battles-title">
          <SectionHead num="04" kicker="Field reports" title="Your battles" id="fl-battles-title">
            {saves.length > 0 ? <Label>{saves.length} saved</Label> : undefined}
          </SectionHead>
          {!savesLoaded ? (
            <LoadingRows rows={2} label="Loading your battles" />
          ) : saves.length === 0 ? (
            <p className="fl-saves-empty">No battles yet. They are saved to your account as you play.</p>
          ) : (
            <div className="fl-saves">
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
        </section>
      </main>
      <PortalNav variant="footer" />
    </div>
  );
}

/** A numbered section heading: the lobby reads 01 Campaign, 02 War for the Planet, 03 Skirmish, 04 Your battles. */
function SectionHead({ num, kicker, title, id, children }: { num: string; kicker: string; title: string; id: string; children?: ReactNode }) {
  return (
    <header className="fl-lobby-head">
      <span className="fl-lobby-num" aria-hidden="true">
        {num}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="fl-lobby-kicker">{kicker}</p>
        <h2 className="fl-lobby-title" id={id}>
          {title}
        </h2>
      </div>
      {children && <div className="fl-lobby-aside">{children}</div>}
    </header>
  );
}

/** The deploy summary's armies: yours first, then the computer seats', by short name. */
function armiesLabel(setup: SkirmishSetup): string {
  const short = (i: number) => FACTION_NAMES[setup.factions?.[i] ?? 'meridian'].split(' ')[0];
  const others = Array.from({ length: setup.sides - 1 }, (_, i) => short(i + 1));
  return setup.sides === 2 ? `${short(0)} against ${others[0]}` : `${short(0)} against ${others.join(', ')}`;
}

/** Your doctrine General in the deploy summary, or None (a pick from the other army reads as none). */
function generalLabel(setup: SkirmishSetup): string {
  const g = setup.generalPicks?.[0] ?? null;
  return g && GENERAL_FACTION[g] === (setup.factions?.[0] ?? 'meridian') ? GENERALS[g].name : 'None';
}

/** One line of the deploy step's summary of orders. */
function Order({ k, children }: { k: string; children: ReactNode }) {
  return (
    <li>
      <span>{k}</span>
      {children}
    </li>
  );
}

/** Missions won, as a ruled bar of one segment per mission with a break between the acts. */
function Progress({ won }: { won: number }) {
  return (
    <span className="fl-progress" aria-label={`${won} of ${CAMPAIGN_MISSIONS} missions won`}>
      <span className="fl-progress-bar" aria-hidden="true">
        {Array.from({ length: CAMPAIGN_MISSIONS }, (_, i) => (
          <span key={i} data-on={i < won ? '1' : '0'} data-act-break={i === ACT_ONE_MISSIONS ? '1' : undefined} />
        ))}
      </span>
      <span className="fl-progress-text">
        {won} of {CAMPAIGN_MISSIONS} won
      </span>
    </span>
  );
}

/**
 * The campaign's theatre map, drawn small and still on the war-room card by the campaign screen's
 * own art: the whole country. The saves list carries only missions won, so the territory is rebuilt
 * from that (previewView): home ground and the regions of the missions won held, the next one's
 * region open, the rest the enemy's; side battles are not known here. The whole map is one button: continue, or start a new campaign.
 */
function CampaignTheatre({ won, label, caption, onOpen }: { won: number; label: string; caption: string; onOpen: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scheme, setSchemeTick] = useState(0);
  // The lettering's web font may land after the first paint: draw again when it does.
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    let live = true;
    void mapFontsReady().then(() => live && setFontTick(n => n + 1));
    return () => {
      live = false;
    };
  }, []);
  const actTwo = won >= ACT_ONE_MISSIONS && ACT_TWO_MISSIONS > 0;
  const view = useMemo(() => previewView(won), [won]);

  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => {
      const w = box.clientWidth;
      setSize({ w, h: Math.round(Math.max(200, Math.min(380, w * 0.62))) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    // The map's paper and ink may follow the light or dark choice: draw it again when that changes.
    const off = onSchemeChange(() => setSchemeTick(n => n + 1));
    return () => {
      ro.disconnect();
      off();
    };
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      drawMap(ctx, size.w, size.h, view, 0, { whole: true, compact: true });
    } catch {
      /* The map is decoration here: a failed drawing leaves the sheet blank rather than the lobby. */
    }
  }, [view, size, scheme, fontTick]);

  return (
    <div className="fl-lobby-theatre">
      <button type="button" className="fl-lobby-theatre-sheet" onClick={onOpen} aria-label={label} data-testid="lobby-theatre">
        <span className="fl-lobby-theatre-corner" data-c="tl" aria-hidden="true" />
        <span className="fl-lobby-theatre-corner" data-c="tr" aria-hidden="true" />
        <span className="fl-lobby-theatre-corner" data-c="bl" aria-hidden="true" />
        <span className="fl-lobby-theatre-corner" data-c="br" aria-hidden="true" />
        <div ref={wrap} className="fl-lobby-theatre-map">
          <canvas ref={ref} aria-hidden="true" style={{ height: size.h || 240 }} />
        </div>
      </button>
      <div className="fl-lobby-theatre-caption" aria-hidden="true">
        <span>
          Theatre map · Act {actTwo ? 'two: the northern coast' : 'one: the southern coast'}
        </span>
        <span>{caption}</span>
      </div>
    </div>
  );
}

/** What changed lately: a strip of headings, opened for a line on each. */
function WhatsNew() {
  return (
    <details className="fl-new">
      <summary>
        <span className="fl-new-kicker">What is new</span>
        <span className="fl-new-strip">
          {WHATS_NEW.map(n => (
            <span key={n.title} className="fl-new-chip">
              {n.title}
            </span>
          ))}
        </span>
        <span className="fl-new-more" aria-hidden="true" />
      </summary>
      <ul>
        {WHATS_NEW.map(n => (
          <li key={n.title}>
            <strong>{n.title}</strong>
            {n.text}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One saved battle or campaign in a list. */
function SaveRow({
  s,
  campaign = false,
  war = false,
  confirming,
  onOpen,
  onAsk,
  onKeep,
  onDelete,
}: {
  s: SaveMeta;
  campaign?: boolean;
  /** A War for the Planet save: labelled "War" with its length and turn. */
  war?: boolean;
  confirming: boolean;
  onOpen: () => void;
  onAsk: () => void;
  onKeep: () => void;
  onDelete: () => void;
}) {
  const status = campaign ? 'campaign' : s.status;
  const statusText = campaign ? 'Campaign' : s.status === 'victory' ? 'Victory' : s.status === 'defeated' ? 'Defeat' : 'In progress';
  const facts = campaign
    ? []
    : war
      ? [s.preset ? `${PRESET_NAMES[s.preset]} war` : 'War', `turn ${s.turn}`]
      : [`${s.turn} min`, mapTypeOf(s) ? MAP_TYPE_NAMES[mapTypeOf(s)!] : null, sizeOfSave(s), sidesOfSave(s)].filter((x): x is string => !!x);
  return (
    <div className="fl-save" data-kind={campaign ? 'campaign' : war ? 'planet' : 'skirmish'} data-status={status} data-confirming={confirming ? '1' : undefined}>
      <span className="fl-save-status">{statusText}</span>
      <div className="fl-save-main">
        <strong className="fl-save-name">
          {campaign && <span className="fl-badge">Campaign</span>}
          {war && <span className="fl-badge">War</span>}
          {s.name}
        </strong>
        <span className="fl-save-meta">
          {campaign ? <Progress won={Math.min(CAMPAIGN_MISSIONS, Math.max(0, s.turn))} /> : facts.map(f => <span key={f}>{f}</span>)}
          <span className="fl-save-when">saved {new Date(s.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </span>
      </div>
      <div className="fl-save-actions">
        {confirming ? (
          <>
            <span className="fl-save-ask">{campaign ? 'Delete this campaign?' : war ? 'Delete this war?' : 'Delete this battle?'}</span>
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
            <Button tone="quiet" onClick={onAsk} title={campaign ? 'Delete this campaign' : war ? 'Delete this war' : 'Delete this battle'}>
              ✕
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const PRESET_NAMES: Record<LengthPreset, string> = { short: 'Short', long: 'Long', veryLong: 'Very long' };

/** The battle's map type, when the saves list carries it (older rows and servers do not). */
const mapTypeOf = (s: SaveMeta): MapType | null => {
  const t = (s as SaveMeta & { mapType?: unknown }).mapType;
  return typeof t === 'string' && t in MAP_TYPE_NAMES ? (t as MapType) : null;
};

/** "Large map" or "Huge map" for a battle on a larger map (round 5); null for standard size and older rows. */
const sizeOfSave = (s: SaveMeta): string | null => {
  const z = (s as SaveMeta & { size?: unknown }).size;
  return z === 'large' ? 'Large map' : z === 'huge' ? 'Huge map' : null;
};

/** "3 sides, free for all", "2 against 2" or "2 against 1" for a battle of more than two sides; null for two. */
const sidesOfSave = (s: SaveMeta): string | null => {
  const n = (s as SaveMeta & { sides?: unknown }).sides;
  if (n !== 3 && n !== 4) return null;
  return s.mode === 'teams' ? (n === 4 ? '2 against 2' : '2 against 1') : `${n} sides, free for all`;
};

const page: CSSProperties = { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body };
const content: CSSProperties = { flex: 1, width: '100%', maxWidth: 1080, margin: '0 auto', padding: '1.5rem 1rem 3rem', boxSizing: 'border-box' };
const eyebrow: CSSProperties = { margin: 0, fontSize: '0.7rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: UI.accent };
const eyebrowOnArt: CSSProperties = { ...eyebrow, color: 'var(--ui-on-art-soft)' };
const title: CSSProperties = { margin: 0, fontFamily: FONT.display, fontSize: 'clamp(2.6rem, 9vw, 4.6rem)', letterSpacing: '0.12em', lineHeight: 0.95 };
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
  boxSizing: 'border-box',
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

/** The scene is laid out on a 210-pixel-tall stage and scaled to fit the banner's real height. */
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

function HeroScene({ children }: { children?: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const box = wrap.current;
    if (!canvas || !box) return;
    // Still when the system asks for reduced motion or the portal's motion setting is off.
    const still = currentPace() === 'off';
    let ground: HTMLCanvasElement | null = null;
    let w = 0;
    let boxW = 0;
    let boxH = 0;
    let raf = 0;
    const smoke: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    let lastNow = 0;
    const draw = (now: number) => {
      const t = still ? 4.2 : now / 1000;
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = box.clientWidth;
      const ch = box.clientHeight;
      if (cw <= 0 || ch <= 0) {
        // Not laid out yet: a zero-width canvas cannot be drawn. Try again next frame.
        if (!still) raf = requestAnimationFrame(draw);
        return;
      }
      // k scales the 210-pixel stage up to the banner; w is the stage's width at that scale.
      const k = ch / HERO_H;
      if (cw !== boxW || ch !== boxH || !ground) {
        boxW = cw;
        boxH = ch;
        w = cw / k;
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        ground = paintHeroGround(Math.ceil(w), HERO_H);
      }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
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
      if (still) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    });
    ro.observe(box);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return (
    <div className="fl-hero">
      <div ref={wrap} className="fl-hero-stage">
        <canvas ref={ref} aria-hidden="true" data-testid="lobby-hero" />
      </div>
      <div className="fl-hero-grid" aria-hidden="true" />
      <div className="fl-hero-readout" aria-hidden="true">
        <span>Sector 7 · Southern coast</span>
        <span className="fl-hero-live">Contact</span>
      </div>
      <div className="fl-hero-text">
        <p style={eyebrowOnArt}>Real-time strategy · Briefing room</p>
        <h1 style={title}>FIRELINE</h1>
        <p className="fl-hero-line">One Command Yard, a field of ore, and an enemy who is already building. Hold the line.</p>
        {children}
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
  { title: 'War for the Planet', text: 'A whole planet of cities, trade and treaties against two to four rival factions, every attack a real battle.' },
  { title: 'Seven battlefields', text: 'River, Highlands, Lakes, Plains, Canyon, Coast or Classic, or let the seed choose. See each map before you deploy.' },
  { title: 'Advanced tech', text: 'Grenadiers, Medics, Flame Tanks, Missile Carriers, the Bastion, walls, a Repair Bay, and powers: recon, barrage, missile.' },
  { title: 'The campaign', text: `${capital(inWords(CAMPAIGN_MISSIONS))} missions in two acts, a Commander who ranks up and learns perks, ${inWords(HERO_NAMES.length)} heroes who level up, and support powers.` },
  { title: 'A battlefield that remembers', text: 'Tread marks, burnt-out wrecks and rubble where structures fell. Bigger explosions, living water, drifting cloud.' },
  { title: 'Richer art', text: 'Detailed tanks and structures with working machinery, and damage you can see: scorch, holes, sparks and fire.' },
  { title: 'Veterans and stances', text: 'Units promote at 3 and 7 kills. Set each group to aggressive, guard or hold fire.' },
  { title: 'Waypoints', text: 'Shift + right-click queues orders. Crews run out of fallen structures.' },
  { title: 'Faster commands', text: 'The letter on each build button builds it, Tab switches lists, Shift queues five. Hover anything for its numbers.' },
  { title: 'Combat alerts', text: 'Attacks on your base or haulers ping the radar; Space jumps there. Low power and short funds are flagged.' },
];
