import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ACHIEVEMENTS, CAMPAIGN_SCENARIOS, DEFAULT_CONFIG, DIFFICULTY, FACTION_COLORS, MAP_BY_ID, MAP_DEFS, PRESETS,
  PRESET_BLURB, UNLIMITED_AP, createInitialState, presetConfig,
  type CampaignScenario, type Difficulty, type GameConfig,
} from 'shared/sim';
import Icon from '../components/Icon';
import PortalNav from '../components/PortalNav';
import { Button, Label, Modal, ModalHeader, Muted } from '../components/ui';
import { useGameHybrid } from '../hooks/useGameHybrid';
import type { SaveMeta } from '../hooks/types';
import { clearToken, getStoredUser } from '../lib/token';
import { FONT, MAP, UI } from '../theme';

const SETTINGS_KEY = 'tm_last_settings_v2';

interface Setup {
  name: string;
  mapId: string;
  diff: Difficulty;
  overrides: Partial<GameConfig>;
}

function loadSetup(): Setup {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (raw && typeof raw === 'object' && MAP_BY_ID[raw.mapId] && raw.diff in PRESETS) return { name: '', mapId: raw.mapId, diff: raw.diff, overrides: raw.overrides ?? {} };
  } catch { /* fall through */ }
  return { name: '', mapId: 'heartlands', diff: 'normal', overrides: {} };
}

function relTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Lobby() {
  const { saves, createGame, deleteGame, loading, error } = useGameHybrid();
  const nav = useNavigate();
  const user = getStoredUser();
  const [setup, setSetup] = useState<Setup>(loadSetup);
  const [advanced, setAdvanced] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [review, setReview] = useState(false);

  const config = useMemo(() => presetConfig(setup.diff, { mapId: setup.mapId, ...setup.overrides }), [setup]);

  const start = async (cfg: Partial<GameConfig>, name?: string) => {
    const id = await createGame(cfg, name);
    if (id) nav(`/game/${id}`);
  };

  const startNew = () => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mapId: setup.mapId, diff: setup.diff, overrides: setup.overrides })); } catch { /* ignore */ }
    void start(config, setup.name.trim() || undefined);
  };

  const active = saves.filter(s => s.status === 'active');
  const finished = saves.filter(s => s.status !== 'active');

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
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground }}>
        <PortalNav variant="header" />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: UI.panel, border: `1px solid ${UI.rule}`, borderRadius: 12, padding: '32px 28px', maxWidth: 400, width: '100%', textAlign: 'center' }}>
            <h1 style={{ fontFamily: FONT.display, fontSize: 32, margin: '0 0 6px', fontWeight: 600 }}>Thrash Margin</h1>
            <Muted style={{ fontSize: 13.5, marginBottom: 20 }}>Sign in to keep your campaigns on your account.</Muted>
            <Button tone="primary" onClick={() => nav('/login')}>Sign in or register</Button>
          </div>
        </div>
        <PortalNav variant="footer" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: UI.ground }}>
      <PortalNav variant="header" />
      <header style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px 8px', display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontFamily: FONT.display, fontSize: 38, margin: 0, fontWeight: 600, letterSpacing: '-0.01em' }}>Thrash Margin</h1>
          <p style={{ margin: '4px 0 0', color: UI.textSoft, fontSize: 14 }}>Every border is a balance sheet. Take land, feed the army, out-earn your rivals.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: UI.textSoft }}>
          <span>{user.username}</span>
          <Button small tone="quiet" onClick={() => { clearToken(); window.location.reload(); }}>Sign out</Button>
        </div>
      </header>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '12px 20px 40px', display: 'grid', gap: 26 }}>
        {error && <div role="alert" style={{ background: '#2e1d1b', border: `1px solid ${UI.bad}`, color: '#f3c6c1', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>{error}</div>}

        {active.length > 0 && (
          <Section title="Continue">
            <div className="tm-lobby-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
              {active.map(s => (
                <SaveCard key={s.id} save={s} confirming={confirmDelete === s.id} onConfirm={setConfirmDelete}
                  onOpen={() => nav(`/game/${s.id}`)} onDelete={() => { void deleteGame(s.id); setConfirmDelete(null); }} />
              ))}
            </div>
          </Section>
        )}

        <Section title="New campaign">
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 10, background: '#16261c', border: '1px solid #3b6b48', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>New here?</div>
                <Muted>Eight territories, one rival and a coach that walks you through your first turns.</Muted>
              </div>
              <Button tone="primary" onClick={() => void start(presetConfig('easy', { mapId: 'tutorial' }), 'Tutorial')} disabled={loading}>Play the tutorial</Button>
            </div>

            <div>
              <Label style={{ marginBottom: 8 }}>Map</Label>
              <div className="tm-map-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {MAP_DEFS.filter(m => m.id !== 'tutorial').map(m => (
                  <MapCard key={m.id} id={m.id} active={setup.mapId === m.id} diff={setup.diff}
                    onClick={() => setSetup(s => ({ ...s, mapId: m.id, overrides: { ...s.overrides, enemyFactions: Math.min(s.overrides.enemyFactions ?? PRESETS[s.diff].enemyFactions, m.maxRivals) } }))} />
                ))}
              </div>
            </div>

            <div>
              <Label style={{ marginBottom: 8 }}>Difficulty</Label>
              <div className="tm-lobby-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {(Object.keys(PRESETS) as Difficulty[]).map(d => (
                  <button key={d} type="button" className="tm-btn" onClick={() => setSetup(s => ({ ...s, diff: d, overrides: {} }))}
                    style={{ textAlign: 'left', padding: 12, borderRadius: 10, cursor: 'pointer', background: setup.diff === d ? '#2a2414' : UI.panel, border: `1px solid ${setup.diff === d ? UI.accent : UI.rule}` }}>
                    <div style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 600, color: setup.diff === d ? UI.accent : UI.text }}>{DIFFICULTY[d].label}</div>
                    <div style={{ fontSize: 11.5, color: UI.textSoft, marginTop: 4, lineHeight: 1.45 }}>{PRESET_BLURB[d]}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'grid', gap: 4, flex: '1 1 220px' }}>
                <Label>Name</Label>
                <input value={setup.name} maxLength={40} placeholder={`Campaign ${saves.length + 1}`}
                  onChange={e => setSetup(s => ({ ...s, name: e.target.value }))}
                  style={{ background: UI.panelSunk, border: `1px solid ${UI.ruleStrong}`, borderRadius: 7, padding: '8px 10px', color: UI.text, fontSize: 13.5 }} />
              </label>
              <Segment label="Rivals" value={config.enemyFactions} options={Array.from({ length: MAP_BY_ID[setup.mapId].maxRivals }, (_, i) => [i + 1, String(i + 1)] as [number, string])}
                onChange={v => setSetup(s => ({ ...s, overrides: { ...s.overrides, enemyFactions: v } }))} />
              <Segment label="Players" value={config.hotseat ? 2 : 1} options={[[1, 'Solo'], [2, 'Hot seat']]}
                onChange={v => setSetup(s => ({ ...s, overrides: { ...s.overrides, hotseat: v === 2 } }))} />
            </div>

            <div>
              <button type="button" onClick={() => setAdvanced(v => !v)} style={{ background: 'none', border: 'none', color: UI.textSoft, cursor: 'pointer', padding: 0, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-flex', transform: advanced ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><Icon name="next" size={12} /></span>
                Advanced rules
              </button>
              {advanced && <Advanced config={config} onChange={patch => setSetup(s => ({ ...s, overrides: { ...s.overrides, ...patch } }))} onReset={() => setSetup(s => ({ ...s, overrides: {} }))} />}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button tone="quiet" onClick={() => setReview(true)}>Review settings</Button>
              <Button tone="primary" icon="next" onClick={startNew} disabled={loading}>{loading ? 'Starting…' : 'Start campaign'}</Button>
            </div>
          </div>
        </Section>

        <Section title="The campaign">
          <Muted style={{ marginBottom: 10 }}>Three linked acts of rising difficulty. Win an act to unlock the next, with gold and technologies carried forward.</Muted>
          <CampaignActs saves={saves} onStart={sc => void start(presetConfig(sc.diff, {
            mapId: sc.mapId, campaignScenario: sc.index, campaignBonusGold: sc.bonusGold, campaignBonusTechs: sc.bonusTechs,
          }), sc.title)} />
        </Section>

        <Section title="Achievements">
          <Achievements saves={saves} />
        </Section>

        {finished.length > 0 && (
          <Section title="Finished">
            <div className="tm-lobby-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
              {finished.map(s => (
                <SaveCard key={s.id} save={s} confirming={confirmDelete === s.id} onConfirm={setConfirmDelete}
                  onOpen={() => nav(`/game/${s.id}`)} onDelete={() => { void deleteGame(s.id); setConfirmDelete(null); }} />
              ))}
            </div>
          </Section>
        )}
      </main>

      {review && (
        <Modal onClose={() => setReview(false)} label="Review settings" width={480}>
          <ModalHeader kicker={`${MAP_BY_ID[config.mapId].name} · ${DIFFICULTY[config.diff].label}`} title={setup.name.trim() || `Campaign ${saves.length + 1}`} onClose={() => setReview(false)} />
          <div style={{ padding: 18, display: 'grid', gap: 6, fontSize: 12.5 }}>
            {summary(config).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${UI.rule}`, padding: '4px 0' }}>
                <span style={{ color: UI.textSoft }}>{k}</span><span>{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <Button tone="quiet" onClick={() => setReview(false)}>Back</Button>
              <Button tone="primary" icon="next" onClick={() => { setReview(false); startNew(); }}>Start campaign</Button>
            </div>
          </div>
        </Modal>
      )}
      <PortalNav variant="footer" />
    </div>
  );
}

function summary(c: GameConfig): Array<[string, string]> {
  const on = (b: boolean) => (b ? 'On' : 'Off');
  return [
    ['Rivals', `${c.enemyFactions}, starting on ${c.enemyTerritories} territor${c.enemyTerritories === 1 ? 'y' : 'ies'} each`],
    ['Rival income', `${Math.round(DIFFICULTY[c.diff].incomeMult * 100)}% of yours`],
    ['Players', c.hotseat ? 'Two, hot seat' : 'One'],
    ['Actions per turn', c.apPerTurn >= UNLIMITED_AP ? 'Unlimited' : String(c.apPerTurn)],
    ['Starting treasury', `${c.startGold} gold, ${c.startFood} food, ${c.startMat} materials`],
    ['Recruit cost / upkeep', `${c.recruitCost} gold / ${c.upkeep} food per troop`],
    ['Your attack bonus', `${c.playerBonus >= 0 ? '+' : ''}${Math.round(c.playerBonus * 100)}%`],
    ['Neutral garrisons', String(c.neutralStr)],
    ['Fog of war', on(c.fogOfWar)],
    ['Events', on(c.enableEvents)],
    ['Tech tree', on(c.enableTechTree)],
    ['Diplomacy', on(c.enableDiplomacy)],
    ['Spies', on(c.enableSpies)],
    ['Strongholds', on(c.enableStrongholds)],
    ['Alternative victories', c.enableAltVictory ? `On (${c.altVictoryGold} gold)` : 'Off'],
  ];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={{ fontFamily: FONT.display, fontSize: 21, fontWeight: 600, margin: '0 0 12px', borderBottom: `1px solid ${UI.rule}`, paddingBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function Segment<T extends number>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <Label>{label}</Label>
      <div style={{ display: 'flex', border: `1px solid ${UI.ruleStrong}`, borderRadius: 7, overflow: 'hidden' }}>
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(v)}
            style={{ padding: '7px 12px', fontSize: 13, background: value === v ? UI.accent : UI.panelSunk, color: value === v ? UI.accentInk : UI.textSoft, border: 'none', borderRight: `1px solid ${UI.rule}`, cursor: 'pointer', fontWeight: value === v ? 700 : 500 }}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Advanced({ config, onChange, onReset }: { config: GameConfig; onChange: (p: Partial<GameConfig>) => void; onReset: () => void }) {
  const num = (key: keyof GameConfig, label: string, min: number, max: number, step = 1) => (
    <label key={key} style={{ display: 'grid', gap: 3 }}>
      <span style={{ fontSize: 11.5, color: UI.textSoft }}>{label}</span>
      <input type="number" min={min} max={max} step={step} value={config[key] as number}
        onChange={e => onChange({ [key]: Number(e.target.value) } as Partial<GameConfig>)}
        style={{ background: UI.panelSunk, border: `1px solid ${UI.ruleStrong}`, borderRadius: 6, padding: '6px 8px', color: UI.text, width: '100%' }} />
    </label>
  );
  const tog = (key: keyof GameConfig, label: string, desc: string) => (
    <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
      <input type="checkbox" checked={config[key] as boolean} onChange={e => onChange({ [key]: e.target.checked } as Partial<GameConfig>)} style={{ marginTop: 3 }} />
      <span><span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span><br /><span style={{ fontSize: 11.5, color: UI.textSoft }}>{desc}</span></span>
    </label>
  );
  return (
    <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: UI.panel, border: `1px solid ${UI.rule}`, display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {num('startGold', 'Starting gold', 0, 500)}
        {num('startFood', 'Starting food', 0, 500)}
        {num('startMat', 'Starting materials', 0, 500)}
        {num('recruitCost', 'Gold per recruit', 1, 20)}
        {num('upkeep', 'Food per troop per turn', 0, 4)}
        {num('apPerTurn', 'Actions per turn (99 = unlimited)', 2, 99)}
        {num('neutralStr', 'Neutral garrison', 1, 12)}
        {num('enemyTerritories', 'Rival starting territories', 1, 4)}
        {num('enemyTroopScale', 'Rival garrison scale', 0.25, 3, 0.25)}
        {num('playerBonus', 'Your attack bonus (0.25 = +25%)', -0.5, 1, 0.05)}
        {num('altVictoryGold', 'Economic victory gold', 100, 5000, 50)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {tog('fogOfWar', 'Fog of war', 'Only see garrisons next to your land.')}
        {tog('enableEvents', 'Events', 'Windfalls, plagues and decisions at the start of your turn.')}
        {tog('enableTechTree', 'Tech tree', 'Twelve technologies in three branches.')}
        {tog('enableDiplomacy', 'Diplomacy', 'Influence buys ceasefires and peaceful annexation.')}
        {tog('enableSpies', 'Spies', 'Influence buys reveals and sabotage.')}
        {tog('enableStrongholds', 'Strongholds', 'Fortified neutrals worth +3 gold a turn.')}
        {tog('enableAltVictory', 'Alternative victories', 'Win on gold, or by completing a tech branch. Rivals can too.')}
        {tog('enemyStartBuildings', 'Rivals start built up', 'Rival capitals begin with two buildings.')}
      </div>
      <div><Button small tone="quiet" icon="reset" onClick={onReset}>Back to the preset</Button></div>
    </div>
  );
}

function MapCard({ id, active, diff, onClick }: { id: string; active: boolean; diff: Difficulty; onClick: () => void }) {
  const def = MAP_BY_ID[id];
  const preview = useMemo(() => createInitialState('preview', { ...DEFAULT_CONFIG, ...PRESETS[diff], mapId: id, enemyFactions: def.maxRivals }, { seed: 1, createdAt: 0 }), [id, diff, def.maxRivals]);
  const [vx, vy, vw, vh] = def.viewBox.split(' ').map(Number);
  return (
    <button type="button" className="tm-btn" onClick={onClick}
      style={{ textAlign: 'left', padding: 0, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: UI.panel, border: `1px solid ${active ? UI.accent : UI.rule}`, boxShadow: active ? `0 0 0 1px ${UI.accent}` : 'none' }}>
      <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} style={{ width: '100%', height: 110, display: 'block', background: MAP.sea }}>
        {preview.edges.map(([a, b], i) => (
          <line key={i} x1={preview.nodes[a].x} y1={preview.nodes[a].y} x2={preview.nodes[b].x} y2={preview.nodes[b].y} stroke="#3a4653" strokeWidth={3} />
        ))}
        {preview.nodes.map(n => (
          <circle key={n.id} cx={n.x} cy={n.y} r={n.capital ? 16 : 11} fill={FACTION_COLORS[n.owner].fill} stroke={n.capital ? UI.accent : '#0b0f14'} strokeWidth={n.capital ? 4 : 2} />
        ))}
      </svg>
      <div style={{ padding: '9px 11px' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: active ? UI.accent : UI.text }}>{def.name}</div>
        <div style={{ fontSize: 11, color: UI.textFaint }}>{def.style} · {def.territories} territories · up to {def.maxRivals} rival{def.maxRivals === 1 ? '' : 's'}</div>
        <div style={{ fontSize: 11.5, color: UI.textSoft, marginTop: 3, lineHeight: 1.4 }}>{def.desc}</div>
      </div>
    </button>
  );
}

function SaveCard({ save, confirming, onConfirm, onOpen, onDelete }: {
  save: SaveMeta; confirming: boolean; onConfirm: (id: string | null) => void; onOpen: () => void; onDelete: () => void;
}) {
  const map = save.mapId ? MAP_BY_ID[save.mapId]?.name : undefined;
  const statusColor = save.status === 'victory' ? UI.good : save.status === 'defeated' ? UI.bad : UI.accent;
  return (
    <div style={{ background: UI.panel, border: `1px solid ${UI.rule}`, borderRadius: 10, padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{save.name}</div>
        <div style={{ fontSize: 11.5, color: UI.textSoft, marginTop: 3 }}>
          <span style={{ color: statusColor }}>{save.status === 'active' ? `Turn ${save.turn}` : save.status === 'victory' ? 'Won' : 'Lost'}</span>
          {map ? ` · ${map}` : ''} · {DIFFICULTY[save.diff as Difficulty]?.label ?? save.diff} · {relTime(save.savedAt)}
        </div>
      </div>
      {confirming ? (
        <>
          <Button small tone="danger" onClick={onDelete}>Delete</Button>
          <Button small tone="quiet" onClick={() => onConfirm(null)}>Keep</Button>
        </>
      ) : (
        <>
          <Button small tone={save.status === 'active' ? 'primary' : 'default'} onClick={onOpen}>{save.status === 'active' ? 'Continue' : 'View'}</Button>
          <button type="button" aria-label={`Delete ${save.name}`} title="Delete" onClick={() => onConfirm(save.id)} style={{ background: 'none', border: 'none', color: UI.textFaint, cursor: 'pointer', padding: 4 }}>
            <Icon name="close" size={14} />
          </button>
        </>
      )}
    </div>
  );
}

function CampaignActs({ saves, onStart }: { saves: SaveMeta[]; onStart: (s: CampaignScenario) => void }) {
  const best = saves.filter(s => s.status === 'victory' && s.campaignScenario !== undefined).reduce((m, s) => Math.max(m, s.campaignScenario!), -1);
  return (
    <div className="tm-lobby-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
      {CAMPAIGN_SCENARIOS.map(sc => {
        const unlocked = sc.index <= best + 1;
        const done = sc.index <= best;
        return (
          <div key={sc.index} style={{ background: UI.panel, border: `1px solid ${done ? '#3b6b48' : UI.rule}`, borderRadius: 10, padding: 14, opacity: unlocked ? 1 : 0.5, display: 'grid', gap: 6, alignContent: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 600, flex: 1 }}>{sc.title}</span>
              {done && <Icon name="check" color={UI.good} />}
            </div>
            <div style={{ fontSize: 11.5, color: UI.textFaint }}>{MAP_BY_ID[sc.mapId].name} · {DIFFICULTY[sc.diff].label}</div>
            <Muted>{sc.desc}</Muted>
            {sc.bonusGold > 0 && <div style={{ fontSize: 11.5, color: UI.gold }}>Carried forward: {sc.bonusGold} gold{sc.bonusTechs.length ? ` and ${sc.bonusTechs.length} technolog${sc.bonusTechs.length === 1 ? 'y' : 'ies'}` : ''}</div>}
            <div style={{ marginTop: 4 }}>
              {unlocked ? <Button small tone={done ? 'default' : 'primary'} onClick={() => onStart(sc)}>{done ? 'Replay' : 'Begin'}</Button>
                : <span style={{ fontSize: 11.5, color: UI.textFaint }}>Win the previous act to unlock.</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Achievements({ saves }: { saves: SaveMeta[] }) {
  const earned = new Set(saves.flatMap(s => s.achievements ?? []));
  return (
    <div>
      <Muted style={{ marginBottom: 10 }}>{earned.size} of {ACHIEVEMENTS.length} earned across your campaigns.</Muted>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {ACHIEVEMENTS.map(a => {
          const got = earned.has(a.id);
          return (
            <div key={a.id} style={{ padding: '9px 11px', borderRadius: 8, background: got ? '#2a2414' : UI.panel, border: `1px solid ${got ? UI.accent : UI.rule}`, opacity: got ? 1 : 0.6 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: got ? UI.accent : UI.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                {got && <Icon name="check" size={12} />}{a.name}
              </div>
              <div style={{ fontSize: 11, color: UI.textSoft, marginTop: 2 }}>{a.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
