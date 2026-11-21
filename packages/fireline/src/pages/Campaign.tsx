import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MISSIONS, missionById } from '../campaign/missions';
import { CAMPAIGN_LEVEL, CAMPAIGN_LEVELS } from '../campaign/difficulty';
import {
  PERKS,
  RANKS,
  applyOutcome,
  buyPerk,
  campaignLevel,
  campaignMission,
  heroesFor,
  missionContext,
  missionUnlocked,
  perkProblem,
  rankFor,
  setCampaignLevel,
} from '../campaign/progression';
import { regionById, regionOfMission, type TheatreRegion, type TheatreView } from '../campaign/theatre';
import {
  applyEngagementOutcome,
  battleSpec,
  engagementProblem,
  engagementSpec,
  isEngagementId,
  openEngagements,
  regionControl,
  regionOfEngagement,
  territoryHeld,
  theatreView,
} from '../campaign/territory';
import type { CampaignSave, CampaignState, PerkBranch, PerkSpec } from '../campaign/types';
import { HeroPortrait, RankInsignia } from '../components/CampaignArt';
import { drawMap, hasCampaignArt, mapFontsReady, regionAt, type CampaignMapNode } from '../components/campaignArtBridge';
import { campaignActOf } from '../game/campaignArt';
import { clockOf, heroName, levelProgress } from '../components/CampaignHud';
import ThemeToggle from '../components/ThemeToggle';
import { currentScheme, onSchemeChange, type Scheme } from '../lib/colorScheme';
import { usePace } from '../lib/motion';
import { createMissionState, missionOutcome, objectiveLabel } from '../sim/mission';
import {
  BUILDINGS,
  DIFFICULTIES,
  HERO_ABILITY,
  HERO_KINDS,
  HERO_LEVEL_XP,
  HERO_MAX_LEVEL,
  POWERS,
  UNITS,
  heroLevelFor,
  type BuildingKind,
  type Difficulty,
  type HeroKind,
  type SupportPower,
  type UnitKind,
} from '../sim/rules';
import type { GameState, MissionOutcome, MissionSpec, ObjectiveRuntime } from '../sim/types';
import { FONT, UI } from '../theme';
import { Battle, chromeBtn } from './GameScreen';

/**
 * The campaign, from the theatre map to the debrief. One CampaignSave holds the whole career and
 * the battle in progress; every change here is saved as the whole CampaignSave.
 *
 * Views: the map (with the Commander, Heroes and Briefing panels over it) and the battle, which is
 * the skirmish <Battle> with the campaign layer switched on and the debrief drawn over it at the end.
 * An outcome is folded into the campaign only when the player leaves the debrief (Back to the map or
 * Retry), so reopening a finished battle shows the same debrief again without paying it twice.
 */

/** A mission's briefing, or a region of the theatre (an engagement's briefing, or a short note). */
type Panel = null | 'commander' | 'heroes' | { briefing: string } | { region: string };

/** The campaign's two acts, each on its own theatre map (see campaignArt.ts). */
const ACT_NAMES = [
  { title: 'Act one', place: 'The Southern Coast' },
  { title: 'Act two', place: 'The Northern Front' },
] as const;

/** The act of the next mission not yet won (the last act once all are won), or act one while act two is shut. */
function openingAct(c: CampaignState, missions: MissionSpec[], actTwoOpen: boolean): 0 | 1 {
  if (!actTwoOpen) return 0;
  const next = missions.find(m => !c.missions[m.id]?.won);
  return next ? campaignActOf(next.order) : 1;
}

const kindName = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? BUILDINGS[k as BuildingKind].name : UNITS[k as UnitKind].name);
const maxStars = (spec: MissionSpec) => 1 + spec.bonus.length;

export default function CampaignFlow({
  initial,
  save,
  saveError,
  lastSaved,
  cloud,
}: {
  initial: CampaignSave;
  save: (x: CampaignSave) => void;
  saveError: string | null;
  lastSaved: number | null;
  cloud: boolean;
}) {
  const [cs, setCs] = useState(initial);
  const csRef = useRef(initial);
  // A battle in progress opens straight into it, debrief included; otherwise the map.
  const [view, setView] = useState<'map' | 'battle'>(initial.battle ? 'battle' : 'map');
  const [panel, setPanel] = useState<Panel>(null);
  // Each deployed battle gets its own number; saves from a battle that has since been left are dropped.
  const [session, setSession] = useState(0);
  const sessionRef = useRef(0);

  const commit = useCallback(
    (next: CampaignSave) => {
      csRef.current = next;
      setCs(next);
      save(next);
    },
    [save],
  );

  const saveBattle = useMemo(() => {
    const mine = session;
    return (b: GameState) => {
      if (sessionRef.current !== mine || !csRef.current.battle) return;
      const next = { ...csRef.current, battle: b };
      csRef.current = next;
      save(next);
    };
  }, [session, save]);

  const startBattle = (next: CampaignSave) => {
    sessionRef.current += 1;
    setSession(sessionRef.current);
    commit(next);
    setPanel(null);
    setView('battle');
  };

  const deploy = (spec: MissionSpec, c: CampaignState = csRef.current.campaign) => {
    // An engagement is not a mission: "Continue" keeps pointing at the story.
    const campaign = isEngagementId(spec.id) ? c : { ...c, lastMission: spec.id };
    const battle = createMissionState(campaignMission(campaign, spec), missionContext(campaign, spec, csRef.current.id, Date.now()));
    startBattle({ ...csRef.current, campaign, battle });
  };

  const leaveBattle = () => {
    // The battle stays in the save; the map offers to resume it.
    sessionRef.current += 1;
    setSession(sessionRef.current);
    setCs(csRef.current);
    setView('map');
  };

  const finish = (outcomeCampaign: CampaignState, retry: MissionSpec | null) => {
    if (retry) {
      deploy(retry, outcomeCampaign);
      return;
    }
    sessionRef.current += 1;
    setSession(sessionRef.current);
    commit({ ...csRef.current, campaign: outcomeCampaign, battle: null });
    setView('map');
  };

  if (view === 'battle' && cs.battle) {
    return (
      <Battle
        key={session}
        initial={cs.battle}
        save={saveBattle}
        saveError={saveError}
        lastSaved={lastSaved}
        cloud={cloud}
        campaign={{
          leaveLabel: 'Campaign',
          onLeave: leaveBattle,
          renderEnd: s => <Debrief s={s} campaign={csRef.current.campaign} onDone={finish} />,
        }}
      />
    );
  }

  return (
    <CampaignMap
      cs={cs}
      panel={panel}
      setPanel={setPanel}
      saveError={saveError}
      onResume={() => {
        sessionRef.current += 1;
        setSession(sessionRef.current);
        setView('battle');
      }}
      onAbandon={() => commit({ ...csRef.current, battle: null })}
      onDeploy={spec => deploy(spec)}
      onBuy={perk => {
        const next = buyPerk(csRef.current.campaign, perk);
        if (next !== csRef.current.campaign) commit({ ...csRef.current, campaign: next });
      }}
      onLevel={level => {
        const next = setCampaignLevel(csRef.current.campaign, level);
        if (next !== csRef.current.campaign) commit({ ...csRef.current, campaign: next });
      }}
    />
  );
}

// ---- The theatre map ------------------------------------------------------------------------

function CampaignMap({
  cs,
  panel,
  setPanel,
  saveError,
  onResume,
  onAbandon,
  onDeploy,
  onBuy,
  onLevel,
}: {
  cs: CampaignSave;
  panel: Panel;
  setPanel: (p: Panel) => void;
  saveError: string | null;
  onResume: () => void;
  onAbandon: () => void;
  onDeploy: (spec: MissionSpec) => void;
  onBuy: (perk: PerkSpec['id']) => void;
  onLevel: (level: Difficulty) => void;
}) {
  const navigate = useNavigate();
  const c = cs.campaign;
  const missions = [...MISSIONS].sort((a, b) => a.order - b.order);
  const nodes: CampaignMapNode[] = missions.map(m => {
    const rec = c.missions[m.id];
    return {
      id: m.id,
      order: m.order,
      title: m.title,
      state: rec?.won ? 'won' : missionUnlocked(c, m.id) ? 'open' : 'locked',
      stars: rec?.stars ?? 0,
      maxStars: maxStars(m),
    };
  });
  const inBattle = cs.battle?.mission ? missionById(cs.battle.mission.id) : undefined;
  const inEngagement = cs.battle?.mission ? regionOfEngagement(cs.battle.mission.id) : undefined;
  const briefing = panel && typeof panel === 'object' && 'briefing' in panel ? missionById(panel.briefing) : undefined;
  const region = panel && typeof panel === 'object' && 'region' in panel ? regionById(panel.region) : undefined;
  const territory = territoryHeld(c);
  const won = nodes.filter(n => n.state === 'won').length;
  // Act two opens with its first mission; until then only act one is shown.
  const firstOfActTwo = missions.find(m => campaignActOf(m.order) === 1);
  const actTwoOpen = !!firstOfActTwo && missionUnlocked(c, firstOfActTwo.id);
  const [chosenAct, setAct] = useState<0 | 1>(() => openingAct(c, missions, actTwoOpen));
  const act: 0 | 1 = actTwoOpen ? chosenAct : 0;
  const shown = missions.map((m, i) => ({ m, n: nodes[i] })).filter(x => campaignActOf(x.m.order) === act);
  const shownNodes = shown.map(x => x.n);
  const view = theatreView(c, act, region?.id ?? (briefing ? regionOfMission(briefing.id)?.id : undefined));
  const engagementsShown = openEngagements(c, act);
  // A region clicked on the map: its mission's briefing, its engagement's, or a note.
  const openRegion = (id: string) => {
    const r = regionById(id);
    if (!r) return;
    if (r.missionId && (c.missions[r.missionId]?.won || missionUnlocked(c, r.missionId))) setPanel({ briefing: r.missionId });
    else setPanel({ region: r.id });
  };

  return (
    <div className="fl-camp" data-testid="campaign-map">
      <header className="fl-camp-top">
        <button type="button" className="fl-chrome-btn" style={chromeBtn} onClick={() => navigate('/')}>
          ← Lobby
        </button>
        <strong style={{ fontFamily: FONT.display, fontSize: '1rem', letterSpacing: '0.04em' }}>FIRELINE</strong>
        <span className="fl-camp-name">Campaign · {cs.name}</span>
        <span style={{ flex: 1 }} />
        {saveError && (
          <span style={{ fontSize: '0.72rem', color: UI.bad }} title={saveError}>
            Not saving
          </span>
        )}
        <ThemeToggle style={{ padding: '4px 8px' }} />
      </header>
      {saveError && <div className="fl-camp-error">{saveError}</div>}

      <main className="fl-camp-main">
        <aside className="fl-camp-side">
          <CommanderCard c={c} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="fl-camp-btn" data-testid="open-commander" onClick={() => setPanel('commander')}>
              Commander
              {c.commander.points > 0 && <span className="fl-dot-count">{c.commander.points}</span>}
            </button>
            <button className="fl-camp-btn" data-testid="open-heroes" onClick={() => setPanel('heroes')}>
              Heroes
            </button>
          </div>
          <div className="fl-camp-progress">
            <span>
              {won} of {missions.length} missions won
            </span>
            <span data-testid="campaign-level">{CAMPAIGN_LEVEL[campaignLevel(c)].label}</span>
            <span>{nodes.reduce((a, n) => a + n.stars, 0)} ★</span>
          </div>
          <div className="fl-camp-territory" data-testid="territory">
            Territory: {territory.held} of {territory.total} regions held
          </div>
          {cs.battle && (
            <div className="fl-camp-inbattle" data-testid="battle-in-progress">
              <strong>{inBattle ? `Mission ${inBattle.order}: ${inBattle.title}` : inEngagement ? `The engagement in ${inEngagement.name}` : 'A battle'} is in progress</strong>
              <span>{cs.battle.mission?.result ? 'It is over: the debrief is waiting.' : `${clockOf(cs.battle.tick)} played.`}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="fl-camp-btn primary" onClick={onResume}>
                  {cs.battle.mission?.result ? 'Debrief' : 'Resume'}
                </button>
                {!cs.battle.mission?.result && (
                  <button className="fl-camp-btn" onClick={onAbandon} title="Leave this battle; nothing is won or lost">
                    Abandon
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>

        <section className="fl-camp-theatre" aria-label="Campaign map">
          {missions.length === 0 ? (
            <p className="fl-camp-empty">The missions are still being written. Check back soon.</p>
          ) : (
            <>
              {actTwoOpen && (
                <div className="fl-acts" role="tablist" aria-label="Campaign acts" data-testid="act-tabs">
                  {ACT_NAMES.map((a, i) => {
                    const inAct = missions.filter(m => campaignActOf(m.order) === i);
                    const wonInAct = inAct.filter(m => c.missions[m.id]?.won).length;
                    return (
                      <button
                        key={a.title}
                        type="button"
                        role="tab"
                        aria-selected={act === i}
                        className="fl-act-tab"
                        data-on={act === i ? '1' : '0'}
                        data-testid={`act-${i + 1}`}
                        onClick={() => setAct(i as 0 | 1)}
                      >
                        <strong>{a.title}</strong>
                        <span>
                          {a.place} · {wonInAct} of {inAct.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <TheatreCanvas view={view} onOpenRegion={openRegion} campaignId={cs.id} />
              <h2 className="fl-camp-index">
                Operations index <span>{ACT_NAMES[act].title} · {ACT_NAMES[act].place}</span>
              </h2>
              <ol className="fl-missions fl-camp-cards" data-testid="mission-list">
                {shown.map(({ m, n }) => {
                  return (
                    <li key={m.id} data-state={n.state}>
                      <button
                        type="button"
                        disabled={n.state === 'locked'}
                        data-testid={`mission-${m.id}`}
                        onClick={() => setPanel({ briefing: m.id })}
                        title={n.state === 'locked' ? 'Win the mission before it first' : 'Open the briefing'}
                      >
                        <span className="fl-mission-no">
                          <small aria-hidden="true">OBJ</small>
                          {m.order}
                        </span>
                        <span className="fl-mission-text">
                          <strong>{m.title}</strong>
                          <span>{n.state === 'locked' ? 'Locked: intelligence only' : m.summary}</span>
                        </span>
                        <span className="fl-mission-stars" aria-label={`${n.stars} of ${n.maxStars} stars`}>
                          {n.state === 'won' ? (
                            <>
                              <span className="fl-camp-stamp" data-kind="taken" aria-hidden="true">
                                Taken
                              </span>
                              {'★'.repeat(n.stars) + '☆'.repeat(Math.max(0, n.maxStars - n.stars))}
                            </>
                          ) : n.state === 'open' ? (
                            <span className="fl-camp-stamp" data-kind="next">
                              Open
                            </span>
                          ) : (
                            ''
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <h2 className="fl-camp-index">
                Engagements <span>{engagementsShown.length ? `${engagementsShown.length} open on this front` : 'None open on this front'}</span>
              </h2>
              {engagementsShown.length > 0 ? (
                <ol className="fl-missions fl-camp-cards fl-eng-cards" data-testid="engagement-list">
                  {engagementsShown.map(r => {
                    const spec = engagementSpec(c, r.id);
                    const rec = c.engagements[r.id];
                    return (
                      <li key={r.id} data-state="open">
                        <button type="button" data-testid={`engagement-${r.id}`} onClick={() => setPanel({ region: r.id })} title="Open the engagement briefing">
                          <span className="fl-mission-no">
                            <small aria-hidden="true">ENG</small>
                            {r.kind === 'city' ? '◆' : '◇'}
                          </span>
                          <span className="fl-mission-text">
                            <strong>{r.name}</strong>
                            <span>{spec?.summary ?? 'A side battle for this region.'}</span>
                          </span>
                          <span className="fl-mission-stars">
                            <span className="fl-camp-stamp" data-kind="next">
                              {rec && !rec.won ? 'Retry' : 'Open'}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="fl-small fl-eng-none">Win the next mission, or take a region next to held ground, to open more.</p>
              )}
            </>
          )}
        </section>
      </main>

      {panel === 'commander' && (
        <Modal title="Commander" onClose={() => setPanel(null)} wide>
          <SkillTree c={c} onBuy={onBuy} />
        </Modal>
      )}
      {panel === 'heroes' && (
        <Modal title="Heroes" onClose={() => setPanel(null)} wide>
          <Roster c={c} />
        </Modal>
      )}
      {briefing && (
        <Modal title={`Mission ${briefing.order}: ${briefing.title}`} onClose={() => setPanel(null)}>
          <Briefing spec={briefing} cs={cs} onDeploy={() => onDeploy(briefing)} onLevel={onLevel} />
        </Modal>
      )}
      {region && (
        <RegionPanel
          region={region}
          cs={cs}
          onClose={() => setPanel(null)}
          onDeploy={onDeploy}
          onLevel={onLevel}
          onOpenMission={id => setPanel({ briefing: id })}
        />
      )}
    </div>
  );
}

/** How long a region takes to change hands on the map, in seconds. */
const CAPTURE_SECONDS = 1.5;

/** Changes of territory already compared this session, by campaign and held set: the fill that is playing, or null. */
const capturesPlayed = new Map<string, { regions: string[]; start: number } | null>();

/** The held regions this campaign's map last showed, so the next visit can play what changed. */
function seenKey(campaignId: string): string {
  return `fl_theatre_seen:${campaignId}`;
}

function readSeen(campaignId: string | undefined): string[] | null {
  if (!campaignId) return null;
  try {
    const raw = localStorage.getItem(seenKey(campaignId));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as string[]) : null;
  } catch {
    return null;
  }
}

function writeSeen(campaignId: string | undefined, held: string[]) {
  if (!campaignId) return;
  try {
    localStorage.setItem(seenKey(campaignId), JSON.stringify(held));
  } catch {
    /* Private window or storage full: the map simply will not replay the change next time. */
  }
}

/**
 * The theatre map: the whole country, turned to the act in view. A click on a region opens it. Regions newly taken since this campaign's map was last shown
 * fill in from the border they share with older held ground, unless motion is off.
 */
function TheatreCanvas({ view, onOpenRegion, campaignId }: { view: TheatreView; onOpenRegion: (regionId: string) => void; campaignId?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => {
      const w = box.clientWidth;
      // A phone gets a tall sheet, and the map turns to fill it (see campaignArt's camera).
      setSize({ w, h: Math.round(w < 560 ? Math.min(620, w * 1.38) : Math.max(260, Math.min(460, w * 0.5))) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const pace = usePace();
  const [scheme, setScheme] = useState<Scheme>(currentScheme);
  useEffect(() => onSchemeChange(setScheme), []);
  // The lettering's web font may land after the first paint: draw again when it does.
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    let live = true;
    void mapFontsReady().then(() => live && setFontTick(n => n + 1));
    return () => {
      live = false;
    };
  }, []);

  // Regions taken since the map last showed this campaign. Compared once per change of what is
  // held; the new state is remembered at once, so a reload mid-fill does not play it twice.
  const heldSig = Object.keys(view.control)
    .filter(id => view.control[id] === 'held')
    .sort()
    .join(',');
  const [capture, setCapture] = useState<{ regions: string[]; start: number } | null>(null);
  useEffect(() => {
    // Once per change, remembered outside the component: the map may be mounted again while the
    // fill is playing (or React may run this twice), and by then the change reads as already seen.
    const once = `${campaignId}|${heldSig}`;
    const pending = capturesPlayed.get(once);
    if (pending !== undefined) {
      setCapture(pending && performance.now() - pending.start < CAPTURE_SECONDS * 1000 ? pending : null);
      return;
    }
    const held = heldSig ? heldSig.split(',') : [];
    const seen = readSeen(campaignId);
    writeSeen(campaignId, held);
    const before = new Set(seen ?? []);
    const fresh = held.filter(id => !before.has(id));
    const next = seen && pace !== 'off' && fresh.length ? { regions: fresh, start: performance.now() } : null;
    capturesPlayed.set(once, next);
    setCapture(next);
    // `pace` is read, not watched: changing it mid-fill should not replay the fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldSig, campaignId]);

  // Every region answers a click: its briefing, its engagement's, or a note on who holds it.
  const openable = useMemo(() => new Set(Object.keys(view.control)), [view]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const motion = pace !== 'off';
    const speed = pace === 'quick' ? 2.5 : 1;
    const paint = (now: number, t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      const progress = capture ? ((now - capture.start) / 1000 / CAPTURE_SECONDS) * speed : 1;
      drawMap(ctx, size.w, size.h, view, t, {
        scheme,
        motion,
        hover: hover && openable.has(hover) ? hover : undefined,
        capture: capture && progress < 1 ? { regions: capture.regions, progress } : undefined,
      });
      return progress;
    };
    const start = performance.now();
    paint(start, 0);
    // The pulses on what is open, and a region changing hands. About 30 frames a second.
    const pulsing = motion && (view.missions.some(m => m.state === 'open') || view.engagements.some(e => e.state === 'open'));
    if (!pulsing && !capture) return;
    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 32) return;
      last = now;
      const p = paint(now, (now - start) / 1000);
      if (p >= 1 && capture) setCapture(null);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [view, size, hover, scheme, pace, fontTick, capture, openable]);

  const hit = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>): string | null => {
    const r = e.currentTarget.getBoundingClientRect();
    return regionAt(e.clientX - r.left, e.clientY - r.top, size.w, size.h, view.act);
  };

  return (
    <div ref={wrap} className="fl-theatre" data-art={hasCampaignArt ? 'campaign' : 'stand-in'} data-act={view.act + 1} data-capturing={capture ? '1' : undefined}>
      <canvas
        ref={ref}
        data-testid="campaign-canvas"
        style={{ width: size.w || '100%', height: size.h || 240, cursor: hover && openable.has(hover) ? 'pointer' : 'default' }}
        aria-hidden="true"
        onPointerMove={e => setHover(hit(e))}
        onPointerLeave={() => setHover(null)}
        onClick={e => {
          if (capture) setCapture(null);
          const id = hit(e);
          if (id && openable.has(id)) onOpenRegion(id);
        }}
      />
    </div>
  );
}

// ---- The Commander --------------------------------------------------------------------------

function rankBar(xp: number) {
  const i = rankFor(xp);
  const lo = RANKS[i]?.xp ?? 0;
  const hi = RANKS[i + 1]?.xp;
  return { index: i, name: RANKS[i]?.name ?? 'Commander', next: RANKS[i + 1]?.name ?? null, lo, hi: hi ?? null, frac: hi ? Math.max(0, Math.min(1, (xp - lo) / (hi - lo))) : 1 };
}

function CommanderCard({ c }: { c: CampaignState }) {
  const r = rankBar(c.commander.xp);
  return (
    <div className="fl-commander" data-testid="commander-card">
      <RankInsignia rank={r.index} size={56} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span className="fl-eyebrow">{r.name}</span>
        <strong className="fl-commander-name">{c.commander.name}</strong>
        <span className="fl-bar fl-bar-xp fl-bar-wide" title={r.hi ? `${c.commander.xp} / ${r.hi} xp to ${r.next}` : 'Highest rank'}>
          <span style={{ width: `${Math.round(r.frac * 100)}%` }} />
        </span>
        <span className="fl-small">
          {r.hi ? `${c.commander.xp.toLocaleString('en-GB')} / ${r.hi.toLocaleString('en-GB')} xp to ${r.next}` : `${c.commander.xp.toLocaleString('en-GB')} xp, highest rank`}
          {' · '}
          <span style={{ color: c.commander.points ? UI.accent : undefined }}>
            {c.commander.points} skill {c.commander.points === 1 ? 'point' : 'points'}
          </span>
        </span>
      </div>
    </div>
  );
}

const BRANCHES: { key: PerkBranch; title: string; blurb: string }[] = [
  { key: 'economy', title: 'Economy', blurb: 'More credits, sooner.' },
  { key: 'industry', title: 'Industry', blurb: 'Build faster and cheaper.' },
  { key: 'command', title: 'Command', blurb: 'Tougher units and support powers.' },
];

function SkillTree({ c, onBuy }: { c: CampaignState; onBuy: (perk: PerkSpec['id']) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="skill-tree">
      <CommanderCard c={c} />
      <p className="fl-small" style={{ margin: 0 }}>
        A skill point for every rank, and one for each mission's first three-star finish. Perks apply to every campaign battle from now on.
      </p>
      <div className="fl-branches">
        {BRANCHES.map(br => (
          <section key={br.key} className="fl-branch" aria-label={br.title}>
            <h3>{br.title}</h3>
            <p className="fl-small">{br.blurb}</p>
            {PERKS.filter(p => p.branch === br.key).map(p => {
              const level = c.commander.perks[p.id] ?? 0;
              const problem = perkProblem(c, p.id);
              const maxed = level >= p.maxLevel;
              const req = p.requires ? PERKS.find(x => x.id === p.requires!.perk) : undefined;
              return (
                <div key={p.id} className="fl-perk" data-level={level} data-maxed={maxed ? '1' : '0'} data-testid={`perk-${p.id}`}>
                  <div className="fl-perk-head">
                    <strong>{p.name}</strong>
                    <span className="fl-pips" aria-label={`Level ${level} of ${p.maxLevel}`}>
                      {Array.from({ length: p.maxLevel }, (_, j) => (
                        <span key={j} data-on={j < level ? '1' : '0'} />
                      ))}
                    </span>
                  </div>
                  <span className="fl-small">{p.blurb}</span>
                  {req && (
                    <span className="fl-small" style={{ color: (c.commander.perks[req.id] ?? 0) >= p.requires!.level ? UI.textFaint : UI.warn }}>
                      Needs {req.name}
                      {req.maxLevel > 1 ? ` ${p.requires!.level}` : ''}
                    </span>
                  )}
                  {maxed ? (
                    <span className="fl-tag" style={{ alignSelf: 'flex-start', color: UI.good, borderColor: UI.good }}>
                      Learned
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="fl-camp-btn primary"
                      disabled={!!problem}
                      title={problem ?? undefined}
                      onClick={() => onBuy(p.id)}
                    >
                      Learn · {p.cost[level]} {p.cost[level] === 1 ? 'point' : 'points'}
                    </button>
                  )}
                  {problem && !maxed && (!req || (c.commander.perks[req.id] ?? 0) >= p.requires!.level) && (
                    <span className="fl-small fl-perk-why">{problem}</span>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

// ---- Heroes ---------------------------------------------------------------------------------

function unlockedBy(kind: HeroKind): MissionSpec | undefined {
  return MISSIONS.find(m => m.rewards.unlockHeroes?.includes(kind));
}

function Roster({ c }: { c: CampaignState }) {
  return (
    <div className="fl-roster" data-testid="roster">
      {HERO_KINDS.map(kind => {
        const rec = c.heroes[kind];
        const level = heroLevelFor(rec?.xp ?? 0);
        const ab = HERO_ABILITY[kind];
        const by = unlockedBy(kind);
        const unlocked = !!rec?.unlocked;
        return (
          <article key={kind} className="fl-roster-card" data-unlocked={unlocked ? '1' : '0'} data-testid={`roster-${kind}`}>
            <HeroPortrait hero={kind} level={level} wounded={!!rec?.wounded} size={72} style={{ opacity: unlocked ? 1 : 0.45 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
              <div className="fl-perk-head">
                <strong>{UNITS[kind].name}</strong>
                {unlocked ? (
                  <span className="fl-pips" aria-label={`Level ${level} of ${HERO_MAX_LEVEL}`}>
                    {Array.from({ length: HERO_MAX_LEVEL }, (_, j) => (
                      <span key={j} data-on={j < level ? '1' : '0'} />
                    ))}
                  </span>
                ) : (
                  <span className="fl-tag">Locked</span>
                )}
              </div>
              {unlocked ? (
                <>
                  <span className="fl-bar fl-bar-xp fl-bar-wide">
                    <span style={{ width: `${Math.round(levelProgress(rec.xp, level) * 100)}%` }} />
                  </span>
                  <span className="fl-small">
                    Level {level}
                    {level < HERO_MAX_LEVEL ? ` · ${HERO_LEVEL_XP[level] - rec.xp} xp to level ${level + 1}` : ' · top level'}
                    {rec.wounded && <span style={{ color: UI.bad }}> · Wounded: starts the next mission at half health</span>}
                  </span>
                </>
              ) : (
                <span className="fl-small">{by ? `Joins in mission ${by.order}, ${by.title}.` : 'Joins later in the campaign.'}</span>
              )}
              <span className="fl-small" style={{ color: UI.text }}>
                <strong>{ab.name}.</strong> {ab.blurb}
              </span>
              <span className="fl-small">{UNITS[kind].blurb}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ---- Briefing -------------------------------------------------------------------------------

const plural = (name: string) => (/man$/.test(name) ? name.replace(/man$/, 'men') : /y$/.test(name) && !/Artillery$/.test(name) ? name.replace(/y$/, 'ies') : /Artillery$/.test(name) ? `${name} pieces` : `${name}s`);

function countKinds(list: UnitKind[]): string {
  const m = new Map<UnitKind, number>();
  for (const k of list) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([k, n]) => (n > 1 ? `${n} ${plural(UNITS[k].name)}` : `1 ${UNITS[k].name}`)).join(', ');
}

function countBuildings(list: BuildingKind[]): string {
  const m = new Map<BuildingKind, number>();
  for (const k of list) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([k, n]) => (n > 1 ? `${n} ${plural(BUILDINGS[k].name)}` : `1 ${BUILDINGS[k].name}`)).join(', ');
}

const POSTURE: Record<MissionSpec['enemy']['ai'], string> = {
  passive: 'Holds its ground and makes no plans.',
  defend: 'Dug in: repairs and fights for every structure, sends no one out.',
  raid: 'Sends raiding parties at you on a timer.',
  normal: 'Builds up and attacks in waves.',
};

/** A mission's briefing; with `region`, the briefing of that region's engagement. */
function Briefing({
  spec: written,
  cs,
  onDeploy,
  onLevel,
  region,
}: {
  spec: MissionSpec;
  cs: CampaignSave;
  onDeploy: () => void;
  onLevel: (level: Difficulty) => void;
  region?: TheatreRegion;
}) {
  const c = cs.campaign;
  // Everything below reads the mission as it will be fought at the campaign's difficulty.
  const level = campaignLevel(c);
  const spec = campaignMission(c, written);
  const heroes = heroesFor(c, spec);
  const ctx = missionContext(c, spec, cs.id, cs.createdAt);
  const powers = [...new Set<SupportPower>([...spec.powers, ...ctx.extraPowers])];
  const rec = region ? c.engagements[region.id] : c.missions[spec.id];
  const newTech = (spec.rewards.unlockTech ?? []).filter(k => !c.tech.includes(k));
  const newHeroes = (spec.rewards.unlockHeroes ?? []).filter(k => !c.heroes[k]?.unlocked);
  const base = spec.player.structures.includes('hq');
  const replacing = cs.battle && cs.battle.mission?.id !== spec.id && !cs.battle.mission?.result;
  return (
    <div className="fl-briefing" data-testid={region ? 'engagement-briefing' : 'briefing'} data-region={region?.id}>
      <div className="fl-briefing-meta">
        {region && <span className="fl-tag fl-eng-tag">Engagement · {region.kind === 'city' ? 'City' : 'Province'}</span>}
        <span className="fl-tag" title="The enemy commander's tier at this campaign difficulty">Enemy {DIFFICULTIES[spec.difficulty].label.toLowerCase()}</span>
        {spec.timeLimit && <span className="fl-tag">Time limit {clockOf(spec.timeLimit)}</span>}
        <span className="fl-tag">{base ? 'Base mission' : 'No base'}</span>
        {rec?.won && (
          <span className="fl-tag" style={{ color: UI.good, borderColor: UI.good }}>
            Won · {'★'.repeat(rec.stars)}
          </span>
        )}
      </div>
      {spec.briefing.map((p, i) => (
        <p key={i} className="fl-briefing-text">
          {p}
        </p>
      ))}
      {region && (
        <>
          <h3>What is known of the enemy</h3>
          <dl className="fl-eng-intel" data-testid="engagement-intel">
            <dt>Position</dt>
            <dd>
              {spec.enemy.base === 'full' ? 'A Command Yard and its base' : 'An outpost, no Command Yard'}: {countBuildings(spec.enemy.structures)}.
            </dd>
            <dt>Garrison</dt>
            <dd>{spec.enemy.units.length ? countKinds(spec.enemy.units) : 'None seen'}.</dd>
            <dt>Posture</dt>
            <dd>{POSTURE[spec.enemy.ai]}</dd>
          </dl>
        </>
      )}
      <h3>Objectives</h3>
      <ul className="fl-brief-list">
        {spec.objectives.map((o, i) => (
          <li key={i}>{objectiveLabel(o)}</li>
        ))}
      </ul>
      {spec.bonus.length > 0 && (
        <>
          <h3>Bonus objectives · a star each</h3>
          <ul className="fl-brief-list bonus">
            {spec.bonus.map((o, i) => (
              <li key={i}>{objectiveLabel(o)}</li>
            ))}
          </ul>
        </>
      )}
      <h3>Your forces</h3>
      <p className="fl-small" style={{ margin: 0 }}>
        {base
          ? `A base and ${spec.player.credits.toLocaleString('en-GB')} credits`
          : `No base${spec.player.credits > 0 ? `, ${spec.player.credits.toLocaleString('en-GB')} credits` : ''}`}
        {spec.player.units.length ? `; ${countKinds(spec.player.units)}` : ''}.
        {powers.length > 0 && ` Support: ${powers.map(p => POWERS[p].name).join(', ')}.`}
      </p>
      {heroes.length > 0 && (
        <div className="fl-brief-heroes">
          {heroes.map(k => {
            const h = c.heroes[k];
            const level = heroLevelFor(h.xp);
            return (
              <div key={k} className="fl-brief-hero">
                <HeroPortrait hero={k} level={level} wounded={h.wounded} size={48} />
                <span>
                  <strong>{UNITS[k].name}</strong>
                  <span className="fl-small">
                    Level {level}
                    {h.wounded && <span style={{ color: UI.bad }}> · wounded, half health</span>}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <h3>Rewards</h3>
      <p className="fl-small" style={{ margin: 0 }}>
        {spec.rewards.xp} xp to the Commander for a win, more for each star.
        {region && ` ${region.name} flies Meridian colours, and the regions beyond it open. Engagements bring no new tech or heroes.`}
        {newHeroes.length > 0 && ` Unlocks ${newHeroes.map(k => `${heroName(k)}`).join(' and ')}.`}
        {newTech.length > 0 && ` New tech: ${newTech.map(kindName).join(', ')}.`}
      </p>
      <h3>Difficulty</h3>
      <div className="fl-levels" role="radiogroup" aria-label="Campaign difficulty" data-testid="campaign-levels">
        {CAMPAIGN_LEVELS.map(l => (
          <button key={l} type="button" role="radio" className="fl-level" aria-checked={level === l} data-testid={`level-${l}`} onClick={() => onLevel(l)}>
            <span className="fl-level-name">{CAMPAIGN_LEVEL[l].label}</span>
            <span className="fl-level-facts">{CAMPAIGN_LEVEL[l].blurb}</span>
          </button>
        ))}
      </div>
      <p className="fl-small" style={{ margin: 0 }}>
        For the whole campaign, from the next deployment. Change it whenever you like.
        {cs.battle && !cs.battle.mission?.result && ' A battle already in progress keeps the difficulty it started with.'}
      </p>
      {region && rec && !rec.won && <p className="fl-small" style={{ margin: 0 }}>Fought here before and lost. The Combine has not moved: the same battle waits.</p>}
      {replacing && <p className="fl-small" style={{ margin: 0, color: UI.warn }}>Deploying abandons the battle you have in progress.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="fl-camp-btn primary big" data-testid="deploy" onClick={onDeploy}>
          Deploy →
        </button>
      </div>
    </div>
  );
}

// ---- A region of the theatre ------------------------------------------------------------------

/** A region opened from the map: an open engagement's briefing, or a short read-only note. */
function RegionPanel({
  region: r,
  cs,
  onClose,
  onDeploy,
  onLevel,
  onOpenMission,
}: {
  region: TheatreRegion;
  cs: CampaignSave;
  onClose: () => void;
  onDeploy: (spec: MissionSpec) => void;
  onLevel: (level: Difficulty) => void;
  onOpenMission: (id: string) => void;
}) {
  const c = cs.campaign;
  const control = regionControl(c, r.id);
  const spec = engagementSpec(c, r.id);
  if (spec && control === 'open' && !engagementProblem(c, r.id)) {
    return (
      <Modal title={`Engagement: ${r.name}`} onClose={onClose}>
        <Briefing spec={spec} cs={cs} region={r} onDeploy={() => onDeploy(spec)} onLevel={onLevel} />
      </Modal>
    );
  }
  const mission = r.missionId ? missionById(r.missionId) : undefined;
  const before = mission ? MISSIONS.find(m => m.order === mission.order - 1) : undefined;
  const rec = c.engagements[r.id];
  const firstOfAct = [...MISSIONS].sort((a, b) => a.order - b.order).find(m => campaignActOf(m.order) === r.act);
  let note: string;
  if (r.home) note = `Home ground. The Meridian Corps has held ${r.name} since the campaign began.`;
  else if (mission && c.missions[mission.id]?.won) note = `Taken in Mission ${mission.order}, ${mission.title}. ${r.name} flies Meridian colours.`;
  else if (mission) note = `Mission ${mission.order}, ${mission.title}, is fought here.${before ? ` It opens when Mission ${before.order}, ${before.title}, is won.` : ''}`;
  else if (rec?.won) note = `Taken. ${r.name} flies Meridian colours${rec.stars ? `, ${'★'.repeat(rec.stars)}` : ''}${rec.bestTicks !== null ? ` in ${clockOf(rec.bestTicks)}` : ''}.`;
  else if (control === 'enemy' && firstOfAct && !missionUnlocked(c, firstOfAct.id)) note = `Combine ground on the ${ACT_NAMES[r.act].place.replace(/^The /, '').toLowerCase()}. This front opens with Mission ${firstOfAct.order}, ${firstOfAct.title}.`;
  else note = `Combine ground. Take a region next to it first: nothing can reach ${r.name} until then.`;
  return (
    <Modal title={r.name} onClose={onClose}>
      <div className="fl-region-note" data-testid="region-note" data-control={control} data-region={r.id}>
        <span className="fl-tag" data-control={control}>
          {r.kind === 'city' ? 'City' : 'Province'} · {control === 'held' ? 'Held' : 'Combine ground'}
        </span>
        <p className="fl-briefing-text">{note}</p>
        {mission && c.missions[mission.id]?.won && (
          <button type="button" className="fl-camp-btn" onClick={() => onOpenMission(mission.id)}>
            Mission briefing
          </button>
        )}
      </div>
    </Modal>
  );
}

// ---- Debrief --------------------------------------------------------------------------------

function Debrief({ s, campaign, onDone }: { s: GameState; campaign: CampaignState; onDone: (c: CampaignState, retry: MissionSpec | null) => void }) {
  const region = regionOfEngagement(s.mission?.id);
  const spec = useMemo(() => battleSpec(campaign, s.mission?.id), [campaign, s.mission?.id]);
  const outcome: MissionOutcome | null = useMemo(() => missionOutcome(s), [s]);
  const after = useMemo(
    () => (spec && outcome ? (region ? applyEngagementOutcome(campaign, region.id, outcome) : applyOutcome(campaign, spec, outcome)) : campaign),
    [campaign, spec, region, outcome],
  );
  const taken = !!region && won0(outcome, s) && !campaign.engagements[region.id]?.won;
  const [fill, setFill] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setFill(true), 250);
    return () => window.clearTimeout(t);
  }, []);
  const m = s.mission!;
  const won = outcome ? outcome.won : m.result === 'won';
  const before = rankBar(campaign.commander.xp);
  const now = rankBar(after.commander.xp);
  const xp = after.commander.xp - campaign.commander.xp;
  const points = after.commander.points - campaign.commander.points;
  const ranked = now.index > before.index;
  const heroes = (Object.keys(outcome?.heroes ?? {}) as HeroKind[]).filter(k => HERO_KINDS.includes(k));
  const newHeroes = HERO_KINDS.filter(k => after.heroes[k]?.unlocked && !campaign.heroes[k]?.unlocked);
  const newTech = after.tech.filter(k => !campaign.tech.includes(k));
  const stars = outcome?.stars ?? 0;
  const secs = Math.floor(s.tick / 10);

  return (
    <div className="fl-scrim fixed">
      <div className="fl-debrief" data-testid="debrief" data-result={won ? 'won' : 'lost'} role="dialog" aria-label="Debrief">
        <p className="fl-eyebrow">{region ? `Engagement: ${region.name}` : spec ? `Mission ${spec.order}: ${spec.title}` : 'Mission'}</p>
        <h2 className="fl-debrief-title" data-won={won ? '1' : '0'}>
          {region ? (won ? 'REGION TAKEN' : 'ENGAGEMENT LOST') : won ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}
        </h2>
        {region && (
          <p className="fl-debrief-region" data-testid="debrief-region" data-taken={won ? '1' : '0'}>
            {won
              ? `${region.name} ${taken ? 'now flies' : 'still flies'} Meridian colours.${taken ? ' The regions beyond it are open to us.' : ''}`
              : `${region.name} stays in Combine hands. The same battle waits when you are ready.`}
          </p>
        )}
        {spec && (
          <div className="fl-debrief-stars" aria-label={`${stars} of ${maxStars(spec)} stars`}>
            {Array.from({ length: maxStars(spec) }, (_, i) => (
              <span key={i} data-on={i < stars ? '1' : '0'} style={{ animationDelay: `${0.3 + i * 0.25}s` }}>
                ★
              </span>
            ))}
          </div>
        )}
        <p className="fl-small" style={{ margin: 0 }}>
          {won ? 'Every objective met' : m.lostBecause ?? 'The objectives were not met'} in {Math.floor(secs / 60)} min {secs % 60} s.
          {outcome && ` ${outcome.kills} enemy destroyed, ${outcome.losses} lost.`}
        </p>

        <ul className="fl-debrief-objectives">
          {m.objectives.map((o, i) => (
            <DebriefObjective key={`p${i}`} o={o} />
          ))}
          {m.bonus.map((o, i) => (
            <DebriefObjective key={`b${i}`} o={o} bonus />
          ))}
        </ul>

        <div className="fl-debrief-commander">
          <RankInsignia rank={fill ? now.index : before.index} size={44} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="fl-small">
              <strong style={{ color: UI.text }}>{campaign.commander.name}</strong> · +{xp} xp
              {ranked && <strong style={{ color: UI.accent }}> · Promoted to {now.name}</strong>}
              {points > 0 && <span style={{ color: UI.accent }}> · +{points} skill {points === 1 ? 'point' : 'points'}</span>}
            </span>
            <span className="fl-bar fl-bar-xp fl-bar-wide fl-bar-anim">
              <span style={{ width: `${Math.round((fill ? now.frac : before.frac) * 100)}%` }} />
            </span>
          </div>
        </div>

        {heroes.length > 0 && (
          <div className="fl-debrief-heroes">
            {heroes.map(k => {
              const o = outcome!.heroes[k]!;
              const was = heroLevelFor(campaign.heroes[k]?.xp ?? 0);
              const is = heroLevelFor(after.heroes[k]?.xp ?? o.xp);
              const gained = (after.heroes[k]?.xp ?? o.xp) - (campaign.heroes[k]?.xp ?? 0);
              return (
                <div key={k} className="fl-brief-hero" data-testid={`debrief-${k}`}>
                  <HeroPortrait hero={k} level={is} wounded={!o.alive} size={44} />
                  <span>
                    <strong>{UNITS[k].name}</strong>
                    <span className="fl-small">
                      +{Math.max(0, gained)} xp
                      {is > was && <strong style={{ color: UI.accent }}> · Level {is}!</strong>}
                      {!o.alive && <span style={{ color: UI.bad }}> · Wounded</span>}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {(newHeroes.length > 0 || newTech.length > 0) && (
          <p className="fl-debrief-unlocks">
            <strong>Unlocked:</strong> {[...newHeroes.map(k => `${heroName(k)}`), ...newTech.map(kindName)].join(', ')}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {spec && (
            <button type="button" className="fl-camp-btn" data-testid="retry" onClick={() => onDone(after, spec)}>
              Retry
            </button>
          )}
          <button type="button" className="fl-camp-btn primary" data-testid="back-to-map" onClick={() => onDone(after, null)}>
            Back to the campaign map
          </button>
        </div>
      </div>
    </div>
  );
}

const won0 = (outcome: MissionOutcome | null, s: GameState) => (outcome ? outcome.won : s.mission?.result === 'won');

function DebriefObjective({ o, bonus = false }: { o: ObjectiveRuntime; bonus?: boolean }) {
  const state = o.failed ? 'failed' : o.done ? 'done' : 'open';
  return (
    <li className="fl-objective" data-state={state} data-bonus={bonus ? '1' : '0'}>
      <span className="fl-objective-mark">{state === 'done' ? '✓' : state === 'failed' ? '✕' : '–'}</span>
      <span className="fl-objective-text">
        {o.label}
        {bonus && <em> (bonus)</em>}
      </span>
    </li>
  );
}

// ---- A modal panel over the map ---------------------------------------------------------------

function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', key);
    box.current?.focus();
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="fl-scrim fixed" onClick={onClose}>
      <div
        ref={box}
        className="fl-modal"
        style={{ maxWidth: wide ? 900 : 620 } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" className="fl-camp-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="fl-modal-body fl-scroll">{children}</div>
      </div>
    </div>
  );
}
