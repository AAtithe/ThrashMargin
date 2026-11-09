import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MISSIONS, missionById } from '../campaign/missions';
import { PERKS, RANKS, applyOutcome, buyPerk, heroesFor, missionContext, missionUnlocked, perkProblem, rankFor } from '../campaign/progression';
import type { CampaignSave, CampaignState, PerkBranch, PerkSpec } from '../campaign/types';
import { HeroPortrait, RankInsignia } from '../components/CampaignArt';
import { drawMap, hasCampaignArt, nodeHitRadius, nodePosition, type CampaignMapNode } from '../components/campaignArtBridge';
import { campaignActOf } from '../game/campaignArt';
import { clockOf, heroName, levelProgress } from '../components/CampaignHud';
import ThemeToggle from '../components/ThemeToggle';
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

type Panel = null | 'commander' | 'heroes' | { briefing: string };

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
    const campaign = { ...c, lastMission: spec.id };
    const battle = createMissionState(spec, missionContext(campaign, spec, csRef.current.id, Date.now()));
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
}: {
  cs: CampaignSave;
  panel: Panel;
  setPanel: (p: Panel) => void;
  saveError: string | null;
  onResume: () => void;
  onAbandon: () => void;
  onDeploy: (spec: MissionSpec) => void;
  onBuy: (perk: PerkSpec['id']) => void;
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
  const briefing = panel && typeof panel === 'object' ? missionById(panel.briefing) : undefined;
  const won = nodes.filter(n => n.state === 'won').length;
  // Act two opens with its first mission; until then only act one is shown.
  const firstOfActTwo = missions.find(m => campaignActOf(m.order) === 1);
  const actTwoOpen = !!firstOfActTwo && missionUnlocked(c, firstOfActTwo.id);
  const [chosenAct, setAct] = useState<0 | 1>(() => openingAct(c, missions, actTwoOpen));
  const act: 0 | 1 = actTwoOpen ? chosenAct : 0;
  const shown = missions.map((m, i) => ({ m, n: nodes[i] })).filter(x => campaignActOf(x.m.order) === act);
  const shownNodes = shown.map(x => x.n);

  return (
    <div className="fl-camp" data-testid="campaign-map">
      <header className="fl-camp-top">
        <button style={chromeBtn} onClick={() => navigate('/')}>
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
            <span>{nodes.reduce((a, n) => a + n.stars, 0)} ★</span>
          </div>
          {cs.battle && (
            <div className="fl-camp-inbattle" data-testid="battle-in-progress">
              <strong>{inBattle ? `Mission ${inBattle.order}: ${inBattle.title}` : 'A battle'} is in progress</strong>
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
              <TheatreCanvas nodes={shownNodes} act={act} onOpen={id => setPanel({ briefing: id })} selected={briefing?.id} />
              <ol className="fl-missions" data-testid="mission-list">
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
                        <span className="fl-mission-no">{m.order}</span>
                        <span className="fl-mission-text">
                          <strong>{m.title}</strong>
                          <span>{n.state === 'locked' ? 'Locked' : m.summary}</span>
                        </span>
                        <span className="fl-mission-stars" aria-label={`${n.stars} of ${n.maxStars} stars`}>
                          {n.state === 'won' ? '★'.repeat(n.stars) + '☆'.repeat(Math.max(0, n.maxStars - n.stars)) : n.state === 'open' ? 'Open' : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
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
          <Briefing spec={briefing} cs={cs} onDeploy={() => onDeploy(briefing)} />
        </Modal>
      )}
    </div>
  );
}

function TheatreCanvas({ nodes, act, onOpen, selected }: { nodes: CampaignMapNode[]; act: 0 | 1; onOpen: (id: string) => void; selected?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => {
      const w = box.clientWidth;
      setSize({ w, h: Math.round(Math.max(240, Math.min(460, w * 0.52))) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
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
    drawMap(
      ctx,
      size.w,
      size.h,
      nodes.map(n => ({ ...n, selected: n.id === selected, hover: n.id === hover })),
    );
  }, [nodes, size, hover, selected]);

  const hit = (e: React.PointerEvent<HTMLCanvasElement>): CampaignMapNode | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: CampaignMapNode | null = null;
    let bestD = nodeHitRadius(size.w, size.h);
    nodes.forEach(n => {
      const p = nodePosition(n.order, size.w, size.h);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    });
    return best;
  };

  const hovered = nodes.find(n => n.id === hover);
  return (
    <div ref={wrap} className="fl-theatre" data-art={hasCampaignArt ? 'campaign' : 'stand-in'} data-act={act + 1}>
      <canvas
        ref={ref}
        data-testid="campaign-canvas"
        style={{ width: size.w || '100%', height: size.h || 240, cursor: hovered && hovered.state !== 'locked' ? 'pointer' : 'default' }}
        aria-hidden="true"
        onPointerMove={e => {
          const n = hit(e);
          setHover(n ? n.id : null);
        }}
        onPointerLeave={() => setHover(null)}
        onClick={e => {
          const n = hit(e as unknown as React.PointerEvent<HTMLCanvasElement>);
          if (n && n.state !== 'locked') onOpen(n.id);
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

function Briefing({ spec, cs, onDeploy }: { spec: MissionSpec; cs: CampaignSave; onDeploy: () => void }) {
  const c = cs.campaign;
  const heroes = heroesFor(c, spec);
  const ctx = missionContext(c, spec, cs.id, cs.createdAt);
  const powers = [...new Set<SupportPower>([...spec.powers, ...ctx.extraPowers])];
  const rec = c.missions[spec.id];
  const newTech = (spec.rewards.unlockTech ?? []).filter(k => !c.tech.includes(k));
  const newHeroes = (spec.rewards.unlockHeroes ?? []).filter(k => !c.heroes[k]?.unlocked);
  const base = spec.player.structures.includes('hq');
  const replacing = cs.battle && cs.battle.mission?.id !== spec.id && !cs.battle.mission?.result;
  return (
    <div className="fl-briefing" data-testid="briefing">
      <div className="fl-briefing-meta">
        <span className="fl-tag">{DIFFICULTIES[spec.difficulty].label}</span>
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
        {base ? `A base and ${spec.player.credits.toLocaleString('en-GB')} credits` : 'No base'}
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
        {newHeroes.length > 0 && ` Unlocks ${newHeroes.map(k => `${heroName(k)}`).join(' and ')}.`}
        {newTech.length > 0 && ` New tech: ${newTech.map(kindName).join(', ')}.`}
      </p>
      {replacing && <p className="fl-small" style={{ margin: 0, color: UI.warn }}>Deploying abandons the battle you have in progress.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="fl-camp-btn primary big" data-testid="deploy" onClick={onDeploy}>
          Deploy →
        </button>
      </div>
    </div>
  );
}

// ---- Debrief --------------------------------------------------------------------------------

function Debrief({ s, campaign, onDone }: { s: GameState; campaign: CampaignState; onDone: (c: CampaignState, retry: MissionSpec | null) => void }) {
  const spec = s.mission ? missionById(s.mission.id) : undefined;
  const outcome: MissionOutcome | null = useMemo(() => missionOutcome(s), [s]);
  const after = useMemo(() => (spec && outcome ? applyOutcome(campaign, spec, outcome) : campaign), [campaign, spec, outcome]);
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
        <p className="fl-eyebrow">{spec ? `Mission ${spec.order}: ${spec.title}` : 'Mission'}</p>
        <h2 className="fl-debrief-title" data-won={won ? '1' : '0'}>
          {won ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}
        </h2>
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
