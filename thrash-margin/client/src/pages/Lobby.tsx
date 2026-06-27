import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameLocal, type SaveMeta } from '../hooks/useGameLocal';
import { MAP_DEFS } from 'shared/engine-reference';
import type { GameConfig, Difficulty } from 'shared/types';

const SETTINGS_KEY = 'tm_last_settings';
function loadLastSettings(): Record<string, unknown> | null {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'); }
  catch { return null; }
}
function saveLastSettings(s: Record<string, unknown>) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

const DIFF_PRESETS: Record<Difficulty, Partial<GameConfig>> = {
  easy:   { diff: 'easy',   playerBonus: 0.25, neutralStr: 2, aggro: 0.65, growth: 1, enemyTerritories: 1, enemyTroopScale: 0.5,  enemyStartBuildings: false, apPerTurn: 99, fogOfWar: false, enableEvents: false, enemyFactions: 1, enableDiplomacy: false, enableTechTree: false, enableAltVictory: false, enableStrongholds: false },
  normal: { diff: 'normal', playerBonus: 0,    neutralStr: 3, aggro: 0.80, growth: 2, enemyTerritories: 2, enemyTroopScale: 0.75, enemyStartBuildings: false, apPerTurn: 4,  fogOfWar: false, enableEvents: true,  enemyFactions: 1, enableDiplomacy: false, enableTechTree: true,  enableAltVictory: false, enableStrongholds: false },
  hard:   { diff: 'hard',   playerBonus: -0.1, neutralStr: 4, aggro: 0.90, growth: 3, enemyTerritories: 4, enemyTroopScale: 1.0,  enemyStartBuildings: true,  apPerTurn: 4,  fogOfWar: true,  enableEvents: true,  enemyFactions: 2, enableDiplomacy: true,  enableTechTree: true,  enableAltVictory: true,  enableStrongholds: true  },
  brutal: { diff: 'brutal', playerBonus: -0.2, neutralStr: 5, aggro: 0.95, growth: 4, enemyTerritories: 4, enemyTroopScale: 1.5,  enemyStartBuildings: true,  apPerTurn: 3,  fogOfWar: true,  enableEvents: true,  enemyFactions: 3, enableDiplomacy: true,  enableTechTree: true,  enableAltVictory: true,  enableStrongholds: true  },
};

const DIFF_DESC: Record<Difficulty, string> = {
  easy:   '1 enemy faction, half troops, unlimited AP, no fog, no events — learning the ropes',
  normal: '1 enemy faction, reduced troops, 4 AP/turn — balanced for most players',
  hard:   '2 enemy factions, full troops + buildings, fog of war, diplomacy & strongholds',
  brutal: '3 enemy factions, 1.5× troops, fog, only 3 AP/turn — relentless',
};

function relTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Lobby() {
  const { saves, createGame, deleteGame, loading } = useGameLocal();
  const nav = useNavigate();

  // New campaign form
  const [campaignName, setCampaignName] = useState('');
  const [showSettings, setShowSettings] = useState(true);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => {
    const last = loadLastSettings();
    return (last?.difficulty as Difficulty) ?? 'normal';
  });
  const [startGold, setStartGold] = useState<number>(() => {
    const last = loadLastSettings();
    return (last?.startGold as number) ?? 25;
  });
  const [startFood, setStartFood] = useState<number>(() => {
    const last = loadLastSettings();
    return (last?.startFood as number) ?? 20;
  });
  const [startMat, setStartMat] = useState<number>(() => {
    const last = loadLastSettings();
    return (last?.startMat as number) ?? 12;
  });
  const [recruitCost, setRecruitCost] = useState<number>(() => {
    const last = loadLastSettings();
    return (last?.recruitCost as number) ?? 4;
  });
  const [upkeep, setUpkeep] = useState<number>(() => {
    const last = loadLastSettings();
    return (last?.upkeep as number) ?? 1;
  });
  const [enemyTerritories, setEnemyTerritories] = useState<number>(() => {
    const last = loadLastSettings();
    return (last?.enemyTerritories as number) ?? 2;
  });
  const [enemyTroopScale, setEnemyTroopScale] = useState<number>(() => {
    const last = loadLastSettings();
    return (last?.enemyTroopScale as number) ?? 0.75;
  });
  const [enemyStartBuildings, setEnemyStartBuildings] = useState<boolean>(() => {
    const last = loadLastSettings();
    return (last?.enemyStartBuildings as boolean) ?? false;
  });
  const [apPerTurn, setApPerTurn] = useState<number>(() => {
    const last = loadLastSettings();
    return (last?.apPerTurn as number) ?? 4;
  });
  const [fogOfWar, setFogOfWar] = useState<boolean>(() => {
    const last = loadLastSettings();
    return (last?.fogOfWar as boolean) ?? false;
  });
  const [enableEvents, setEnableEvents] = useState<boolean>(() => {
    const last = loadLastSettings();
    return (last?.enableEvents as boolean) ?? true;
  });
  const [enemyFactions, setEnemyFactions] = useState<number>(() => {
    const last = loadLastSettings();
    return (last?.enemyFactions as number) ?? 1;
  });
  const [enableDiplomacy, setEnableDiplomacy] = useState<boolean>(() => {
    const last = loadLastSettings();
    return (last?.enableDiplomacy as boolean) ?? false;
  });
  const [enableTechTree, setEnableTechTree] = useState<boolean>(() => {
    const last = loadLastSettings();
    return (last?.enableTechTree as boolean) ?? true;
  });
  const [enableAltVictory, setEnableAltVictory] = useState<boolean>(() => {
    const last = loadLastSettings();
    return (last?.enableAltVictory as boolean) ?? false;
  });
  const [enableStrongholds, setEnableStrongholds] = useState<boolean>(() => {
    const last = loadLastSettings();
    return (last?.enableStrongholds as boolean) ?? false;
  });
  const [hotseat, setHotseat] = useState<boolean>(() => {
    const last = loadLastSettings();
    return (last?.hotseat as boolean) ?? false;
  });

  const [selectedMap, setSelectedMap] = useState<string>(() => {
    const last = loadLastSettings();
    return (last?.selectedMap as string) ?? 'heartlands';
  });
  const [showConfirm, setShowConfirm] = useState(false);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const applyDifficulty = (d: Difficulty) => {
    setDifficulty(d);
    const p = DIFF_PRESETS[d];
    if (p.enemyTerritories    !== undefined) setEnemyTerritories(p.enemyTerritories);
    if (p.enemyTroopScale     !== undefined) setEnemyTroopScale(p.enemyTroopScale);
    if (p.enemyStartBuildings !== undefined) setEnemyStartBuildings(p.enemyStartBuildings);
    if (p.apPerTurn           !== undefined) setApPerTurn(p.apPerTurn);
    if (p.fogOfWar            !== undefined) setFogOfWar(p.fogOfWar);
    if (p.enableEvents        !== undefined) setEnableEvents(p.enableEvents);
    if (p.enemyFactions       !== undefined) setEnemyFactions(p.enemyFactions);
    if (p.enableDiplomacy     !== undefined) setEnableDiplomacy(p.enableDiplomacy);
    if (p.enableTechTree      !== undefined) setEnableTechTree(p.enableTechTree);
    if (p.enableAltVictory    !== undefined) setEnableAltVictory(p.enableAltVictory);
    if (p.enableStrongholds   !== undefined) setEnableStrongholds(p.enableStrongholds);
  };

  const handleNew = () => {
    saveLastSettings({
      difficulty, selectedMap,
      startGold, startFood, startMat, recruitCost, upkeep,
      enemyTerritories, enemyTroopScale, enemyStartBuildings,
      apPerTurn, fogOfWar, enableEvents,
      enemyFactions, enableDiplomacy, enableTechTree, enableAltVictory, enableStrongholds,
      hotseat,
    });
    const config: Partial<GameConfig> = {
      ...DIFF_PRESETS[difficulty],
      startGold, startFood, startMat, recruitCost, upkeep,
      enemyTerritories, enemyTroopScale, enemyStartBuildings,
      apPerTurn, fogOfWar, enableEvents,
      mapId: selectedMap,
      enemyFactions, enableDiplomacy, enableTechTree, enableAltVictory, enableStrongholds,
      hotseat,
    };
    const name = campaignName.trim() || undefined;
    const id = createGame(config, name);
    nav(`/game/${id}`);
  };

  const handleDelete = (id: string) => {
    deleteGame(id);
    setConfirmDelete(null);
  };

  const active    = saves.filter(s => s.status === 'active');
  const completed = saves.filter(s => s.status !== 'active');

  return (
    <div style={s.page}>
      <div style={s.header}>
        <span style={s.logo}>Thrash Margin</span>
      </div>

      <div style={s.content}>

        {/* ── Active campaigns ── */}
        <Section title="Active Campaigns" empty={active.length === 0} emptyMsg="No active campaigns — start one below.">
          {active.map(save => (
            <SaveCard key={save.id} save={save}
              confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
              onContinue={() => nav(`/game/${save.id}`)}
              onDelete={() => handleDelete(save.id)} />
          ))}
        </Section>

        {/* ── History ── */}
        {completed.length > 0 && (
          <Section title="History">
            {completed.map(save => (
              <SaveCard key={save.id} save={save}
                confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
                onContinue={() => nav(`/game/${save.id}`)}
                onDelete={() => handleDelete(save.id)} />
            ))}
          </Section>
        )}

        {/* ── How to Play ── */}
        <HowToPlay />

        {/* ── New campaign ── */}
        <Section title="New Campaign">
          {/* Name input */}
          <div style={s.nameRow}>
            <label style={s.nameLabel}>Campaign name</label>
            <input
              style={s.nameInput}
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              placeholder={`Campaign #${saves.length + 1}`}
              maxLength={32}
            />
          </div>

          {/* Tutorial quick-start */}
          <div style={{ background: '#0f2a1a', border: '1px solid #15803d', borderRadius: 8, padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ color: '#3fb950', fontSize: 13, fontWeight: 700, margin: '0 0 3px' }}>🎓 New to the game?</p>
                <p style={{ color: '#6b9f7a', fontSize: 11, margin: 0 }}>Play the guided tutorial — 8 territories, unlimited actions, step-by-step hints.</p>
              </div>
              <button
                onClick={() => { setSelectedMap('tutorial'); applyDifficulty('easy'); }}
                style={{ background: '#15803d', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, fontSize: 12, padding: '8px 14px', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 12 }}
              >
                Start Tutorial →
              </button>
            </div>
          </div>

          {/* Map selection */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ ...s.sLabel, marginBottom: 8 }}>Choose map</p>
            <div style={s.mapGrid}>
              {MAP_DEFS.map(m => {
                const isActive = selectedMap === m.id;
                return (
                  <button key={m.id} style={{ ...s.mapCard, ...(isActive ? s.mapCardActive : {}) }}
                    onClick={() => setSelectedMap(m.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? '#e6edf3' : '#c9d1d9' }}>{m.name}</span>
                      <span style={{ ...s.styleTag, ...(isActive ? s.styleTagActive : {}) }}>{m.style}</span>
                    </div>
                    <p style={{ fontSize: 11, color: isActive ? '#9198a1' : '#6b7280', margin: '0 0 5px', lineHeight: 1.4, textAlign: 'left' }}>{m.desc}</p>
                    <p style={{ fontSize: 10, color: isActive ? '#58a6ff' : '#4b5563', margin: 0, textAlign: 'left' }}>{m.territories} territories</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Settings toggle */}
          <button style={s.settingsToggle} onClick={() => setShowSettings(v => !v)}>
            {showSettings ? '▾' : '▸'} Game settings
          </button>

          {showSettings && (
            <div style={s.settingsPanel}>

              {/* Difficulty */}
              <div style={s.sSection}>
                <p style={s.sLabel}>Difficulty</p>
                <div style={s.diffRow}>
                  {(Object.keys(DIFF_PRESETS) as Difficulty[]).map(d => (
                    <button key={d} style={{ ...s.diffBtn, ...(difficulty === d ? s.diffActive : {}) }}
                      onClick={() => applyDifficulty(d)}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
                <p style={s.diffDesc}>{DIFF_DESC[difficulty]}</p>
              </div>

              {/* Starting resources */}
              <div style={s.sSection}>
                <p style={s.sLabel}>Starting resources</p>
                <div style={s.sGrid}>
                  <SettingNum label="⚙ Gold"  value={startGold} min={5}  max={100} onChange={setStartGold} />
                  <SettingNum label="🌾 Food"  value={startFood} min={5}  max={100} onChange={setStartFood} />
                  <SettingNum label="⛏ Mat"   value={startMat}  min={5}  max={100} onChange={setStartMat}  />
                </div>
              </div>

              {/* Economy */}
              <div style={s.sSection}>
                <p style={s.sLabel}>Economy</p>
                <div style={s.sGrid}>
                  <SettingNum label="Recruit cost (g)" value={recruitCost} min={1} max={12} onChange={setRecruitCost} />
                  <SettingNum label="Troop upkeep (g)" value={upkeep}      min={0} max={4}  onChange={setUpkeep}      />
                </div>
              </div>

              {/* Mechanics */}
              <div style={s.sSection}>
                <p style={s.sLabel}>Mechanics</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <p style={s.subLabel}>Action points per turn (Off = unlimited — lower = harder)</p>
                    <div style={s.diffRow}>
                      {([['Off', 99], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]] as [string | number, number][]).map(([label, val]) => (
                        <button key={val}
                          style={{ ...s.diffBtn, ...(apPerTurn === val ? s.diffActive : {}) }}
                          onClick={() => setApPerTurn(val)}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <p style={s.diffDesc}>Attack costs 2 AP · Recruit / Build / Move / Upgrade / Annex / Research cost 1 AP each</p>
                  </div>
                  <div>
                    <p style={s.subLabel}>Fog of war (hide troop counts beyond your borders)</p>
                    <ToggleRow value={fogOfWar} onChange={setFogOfWar} />
                  </div>
                  <div>
                    <p style={s.subLabel}>Random turn events (supply windfalls, plagues, unrest)</p>
                    <ToggleRow value={enableEvents} onChange={setEnableEvents} />
                  </div>
                  <div>
                    <p style={s.subLabel}>Tech tree (12 techs across 3 branches — research for bonuses and victory)</p>
                    <ToggleRow value={enableTechTree} onChange={setEnableTechTree} />
                  </div>
                  <div>
                    <p style={s.subLabel}>Diplomacy (influence resource + peaceful annexation of neutral territories)</p>
                    <ToggleRow value={enableDiplomacy} onChange={setEnableDiplomacy} />
                  </div>
                  <div>
                    <p style={s.subLabel}>Alternative victories (economic: 400g, research: complete a full tech branch)</p>
                    <ToggleRow value={enableAltVictory} onChange={setEnableAltVictory} />
                  </div>
                  <div>
                    <p style={s.subLabel}>Neutral strongholds (fortified neutral territories with high production)</p>
                    <ToggleRow value={enableStrongholds} onChange={setEnableStrongholds} />
                  </div>
                  <div>
                    <p style={s.subLabel}>Hot Seat — two players alternate turns on the same device</p>
                    <ToggleRow value={hotseat} onChange={v => { setHotseat(v); if (v && enemyFactions < 1) setEnemyFactions(1); }} />
                  </div>
                </div>
              </div>

              {/* Enemy setup */}
              <div style={s.sSection}>
                <p style={s.sLabel}>Enemy Setup</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <p style={s.subLabel}>Enemy factions (1 = classic, 2-3 = multi-faction chaos)</p>
                    <div style={s.diffRow}>
                      {[1, 2, 3].map(n => (
                        <button key={n}
                          style={{ ...s.diffBtn, ...(enemyFactions === n ? s.diffActive : {}) }}
                          onClick={() => setEnemyFactions(n)}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p style={s.subLabel}>Starting territories per faction (1 = easier, 4 = hardest)</p>
                    <div style={s.diffRow}>
                      {[1, 2, 3, 4].map(n => (
                        <button key={n}
                          style={{ ...s.diffBtn, ...(enemyTerritories === n ? s.diffActive : {}) }}
                          onClick={() => setEnemyTerritories(n)}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p style={s.subLabel}>Starting troop strength</p>
                    <div style={s.diffRow}>
                      {([['Weak', 0.5], ['Normal', 1.0], ['Strong', 1.5], ['Brutal', 2.0]] as [string, number][]).map(([label, val]) => (
                        <button key={label}
                          style={{ ...s.diffBtn, ...(enemyTroopScale === val ? s.diffActive : {}) }}
                          onClick={() => setEnemyTroopScale(val)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p style={s.subLabel}>Enemy starts with pre-built buildings</p>
                    <ToggleRow value={enemyStartBuildings} onChange={setEnemyStartBuildings} />
                  </div>
                </div>
              </div>

            </div>
          )}

          <button style={s.newBtn} onClick={() => setShowConfirm(true)} disabled={loading}>
            Review &amp; start →
          </button>
        </Section>

      </div>

      {showConfirm && (
        <ConfirmModal
          campaignName={campaignName.trim() || `Campaign #${saves.length + 1}`}
          mapId={selectedMap}
          difficulty={difficulty}
          enemyFactions={enemyFactions}
          enemyTerritories={enemyTerritories}
          enemyTroopScale={enemyTroopScale}
          enemyStartBuildings={enemyStartBuildings}
          apPerTurn={apPerTurn}
          fogOfWar={fogOfWar}
          enableEvents={enableEvents}
          enableDiplomacy={enableDiplomacy}
          enableTechTree={enableTechTree}
          enableAltVictory={enableAltVictory}
          enableStrongholds={enableStrongholds}
          hotseat={hotseat}
          startGold={startGold}
          startFood={startFood}
          startMat={startMat}
          recruitCost={recruitCost}
          upkeep={upkeep}
          onBack={() => setShowConfirm(false)}
          onConfirm={() => { setShowConfirm(false); handleNew(); }}
        />
      )}
    </div>
  );
}

/* ── Sub-components ── */

function HowToPlay() {
  const [open, setOpen] = React.useState<string | null>(null);
  const toggle = (k: string) => setOpen(v => v === k ? null : k);

  const sections = [
    {
      key: 'basics',
      title: '⚔ The Basics',
      content: `Thrash Margin is a turn-based territory strategy game. Each turn you spend Action Points (AP) on attacks, recruiting, building, and research. When you run out of AP, end your turn — then the enemy factions take theirs.\n\nYour goal is to conquer all enemy capitals, accumulate enough gold for an Economic Victory, or complete a full Tech Tree branch for a Research Victory.`,
    },
    {
      key: 'combat',
      title: '🗡 Combat',
      content: `Select one of your territories, then click an adjacent enemy or neutral territory to set it as your target. A combat preview shows whether you'll win or lose before you commit.\n\nThe attack ratio determines outcome — sending twice as many effective troops as the defender's defence strength guarantees a win with minimal losses. Techs like Siege Craft (+25% attack) and Iron Will (attack costs 1 AP instead of 2) can tilt the odds in your favour.`,
    },
    {
      key: 'economy',
      title: '💰 Resources',
      content: `Gold funds recruiting and research. Food feeds your troops — if food runs out, troops starve. Materials are needed for building and upgrades.\n\nEach territory produces resources each turn based on its level and buildings. Build Farms for food, Mines for materials, Markets for gold, Barracks to raise troop cap, and Towers for defence.\n\nInfluence (when Diplomacy is enabled) lets you peacefully annex neutral territories instead of fighting for them.`,
    },
    {
      key: 'techtree',
      title: '🔬 Tech Tree',
      content: `The Research panel (▸ in the sidebar) gives access to 12 technologies across three branches:\n\n• Military — cheaper attacks, stronger offence, reduced losses\n• Economic — more gold, better food security, stronger markets\n• Expansion — fog lifted, cheaper annexation, stronger towers, +1 AP/turn\n\nComplete all 4 tiers of any branch for a Research Victory. Each tech costs 1 AP and some gold + materials.`,
    },
    {
      key: 'terrain',
      title: '🌍 Terrain',
      content: `Territories have terrain types that affect their stats:\n\n• Plains — no modifiers (default)\n• Forest — +1 food/turn, -1 defence (easier to attack, productive)\n• Mountain — +3 defence, -1 gold/turn (hard to crack, poor income)\n• Coast — +2 gold/turn (rich trade routes)\n• Desert — +1 mat/turn, -1 food/turn (good for materials)\n\nTerrain is shown as a small label below each territory name on the map.`,
    },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ color: '#e6edf3', fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>How to Play</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sections.map(sec => (
          <div key={sec.key} style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, overflow: 'hidden' }}>
            <button
              onClick={() => toggle(sec.key)}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#e6edf3', padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              {sec.title}
              <span style={{ color: '#7d8590', fontSize: 11 }}>{open === sec.key ? '▲' : '▼'}</span>
            </button>
            {open === sec.key && (
              <div style={{ padding: '0 14px 12px', color: '#7d8590', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                {sec.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children, empty, emptyMsg }: {
  title: string; children?: React.ReactNode;
  empty?: boolean; emptyMsg?: string;
}) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={s.sectionTitle}>{title}</h2>
      {empty ? (
        <p style={s.emptyMsg}>{emptyMsg}</p>
      ) : children}
    </div>
  );
}

function SaveCard({ save, confirmDelete, setConfirmDelete, onContinue, onDelete }: {
  save: SaveMeta;
  confirmDelete: string | null;
  setConfirmDelete: (id: string | null) => void;
  onContinue: () => void;
  onDelete: () => void;
}) {
  const isConfirming = confirmDelete === save.id;
  const diff = save.diff.charAt(0).toUpperCase() + save.diff.slice(1);

  return (
    <div style={s.saveCard}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={s.saveName}>{save.name}</p>
        <p style={s.saveMeta}>
          {diff} · Turn {save.turn} · {relTime(save.savedAt)}
          {save.status === 'victory'  && <span style={{ color: '#3fb950' }}> · 🏆 Victory</span>}
          {save.status === 'defeated' && <span style={{ color: '#f85149' }}> · 💀 Defeated</span>}
        </p>
      </div>
      <div style={s.saveActions}>
        {isConfirming ? (
          <>
            <span style={{ color: '#f85149', fontSize: 11, marginRight: 4 }}>Delete?</span>
            <button style={s.deleteConfirmBtn} onClick={onDelete}>Yes</button>
            <button style={s.cancelBtn} onClick={() => setConfirmDelete(null)}>No</button>
          </>
        ) : (
          <>
            <button style={s.continueBtn} onClick={onContinue}>
              {save.status === 'active' ? 'Continue →' : 'View'}
            </button>
            <button style={s.deleteBtn} onClick={() => setConfirmDelete(save.id)}>🗑</button>
          </>
        )}
      </div>
    </div>
  );
}

function SettingNum({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (n: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ color: '#7d8590', fontSize: 11 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={s.nudge} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
        <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14, minWidth: 28, textAlign: 'center' }}>{value}</span>
        <button style={s.nudge} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </div>
  );
}

function ToggleRow({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ ...s.diffRow, width: 'fit-content' }}>
      {([['On', true], ['Off', false]] as [string, boolean][]).map(([label, val]) => (
        <button key={label}
          style={{ ...s.diffBtn, minWidth: 60, ...(value === val ? s.diffActive : {}) }}
          onClick={() => onChange(val)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function ConfirmModal({ campaignName, mapId, difficulty, enemyFactions, enemyTerritories, enemyTroopScale,
  enemyStartBuildings, apPerTurn, fogOfWar, enableEvents, enableDiplomacy, enableTechTree,
  enableAltVictory, enableStrongholds, hotseat, startGold, startFood, startMat,
  recruitCost, upkeep, onBack, onConfirm }: {
  campaignName: string; mapId: string; difficulty: Difficulty;
  enemyFactions: number; enemyTerritories: number; enemyTroopScale: number; enemyStartBuildings: boolean;
  apPerTurn: number; fogOfWar: boolean; enableEvents: boolean;
  enableDiplomacy: boolean; enableTechTree: boolean; enableAltVictory: boolean; enableStrongholds: boolean;
  hotseat: boolean;
  startGold: number; startFood: number; startMat: number;
  recruitCost: number; upkeep: number;
  onBack: () => void; onConfirm: () => void;
}) {
  const map = MAP_DEFS.find(m => m.id === mapId) ?? MAP_DEFS[0];
  const troopLabel = ({ 0.5: 'Weak', 0.75: 'Reduced', 1.0: 'Normal', 1.5: 'Strong', 2.0: 'Brutal' } as Record<number, string>)[enemyTroopScale] ?? `${enemyTroopScale}×`;
  const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid #21262d' }}>
      <span style={{ color: '#7d8590', fontSize: 12 }}>{label}</span>
      <span style={{ color: '#e6edf3', fontSize: 12, fontWeight: 600 }}>{value}</span>
    </div>
  );

  return (
    <div style={s.modalBackdrop} onClick={onBack}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ color: '#e6edf3', fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Ready to start?</h2>
        <p style={{ color: '#7d8590', fontSize: 12, margin: '0 0 18px' }}>Review your settings before launching.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <p style={s.sLabel}>Campaign</p>
            <Row label="Name"   value={campaignName} />
            <Row label="Map"    value={`${map.name} — ${map.style} (${map.territories} territories)`} />
            <Row label="Difficulty" value={diffLabel} />
          </div>

          <div>
            <p style={s.sLabel}>Enemy Setup</p>
            <Row label="Enemy factions"       value={String(enemyFactions)} />
            <Row label="Starting territories" value={String(enemyTerritories)} />
            <Row label="Troop strength"        value={troopLabel} />
            <Row label="Pre-built buildings"   value={enemyStartBuildings ? 'Yes' : 'No'} />
          </div>

          <div>
            <p style={s.sLabel}>Mechanics</p>
            <Row label="Action points / turn" value={apPerTurn >= 99 ? 'Unlimited' : String(apPerTurn)} />
            <Row label="Fog of war"           value={fogOfWar ? 'On' : 'Off'} />
            <Row label="Random events"        value={enableEvents ? 'On' : 'Off'} />
            <Row label="Tech tree"            value={enableTechTree ? 'On' : 'Off'} />
            <Row label="Diplomacy"            value={enableDiplomacy ? 'On' : 'Off'} />
            <Row label="Alt. victories"       value={enableAltVictory ? 'On' : 'Off'} />
            <Row label="Strongholds"          value={enableStrongholds ? 'On' : 'Off'} />
            {hotseat && <Row label="Mode" value="Hot Seat (2 players)" />}
          </div>

          <div>
            <p style={s.sLabel}>Starting Resources &amp; Economy</p>
            <Row label="Gold / Food / Mat"  value={`${startGold} / ${startFood} / ${startMat}`} />
            <Row label="Recruit cost"       value={`${recruitCost}g per troop`} />
            <Row label="Troop upkeep"       value={`${upkeep}f per troop / turn`} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button style={s.backBtn} onClick={onBack}>← Back</button>
          <button style={{ ...s.newBtn, flex: 1 }} onClick={onConfirm}>Start campaign →</button>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ── */
const s: Record<string, React.CSSProperties> = {
  page:           { minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui,sans-serif' },
  header:         { background: '#161b22', borderBottom: '1px solid #30363d', padding: '14px 32px' },
  logo:           { fontSize: 18, fontWeight: 700 },
  content:        { maxWidth: 640, margin: '40px auto', padding: '0 24px' },
  sectionTitle:   { fontSize: 13, fontWeight: 600, color: '#9198a1', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' },
  emptyMsg:       { color: '#4b5563', fontSize: 13, margin: 0 },

  saveCard:       { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 },
  saveName:       { color: '#e6edf3', fontSize: 14, fontWeight: 600, margin: '0 0 3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  saveMeta:       { color: '#7d8590', fontSize: 11, margin: 0 },
  saveActions:    { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  continueBtn:    { background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' },
  deleteBtn:      { background: 'none', border: '1px solid #30363d', color: '#7d8590', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  deleteConfirmBtn:{ background: '#b91c1c', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  cancelBtn:      { background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },

  nameRow:        { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  nameLabel:      { color: '#7d8590', fontSize: 12, whiteSpace: 'nowrap' },
  nameInput:      { flex: 1, background: '#161b22', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '7px 12px', fontSize: 13, outline: 'none' },

  settingsToggle: { background: 'none', border: 'none', color: '#7d8590', cursor: 'pointer', fontSize: 13, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 },
  settingsPanel:  { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 16 },

  sSection:       { display: 'flex', flexDirection: 'column', gap: 8 },
  sLabel:         { color: '#9198a1', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: 0 },
  subLabel:       { color: '#6b7280', fontSize: 11, margin: '0 0 5px' },
  sGrid:          { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' },
  diffRow:        { display: 'flex', gap: 6 },
  diffBtn:        { flex: 1, background: '#0d1117', border: '1px solid #30363d', color: '#7d8590', borderRadius: 5, padding: '6px 0', cursor: 'pointer', fontSize: 12 },
  diffActive:     { background: '#1f3a5f', border: '1px solid #1f6feb', color: '#e6edf3', fontWeight: 600 },
  diffDesc:       { color: '#6b7280', fontSize: 11, margin: '4px 0 0', fontStyle: 'italic' },
  nudge:          { background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', width: 22, height: 22, borderRadius: 4, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },

  newBtn:         { background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, padding: '10px 22px', cursor: 'pointer', fontSize: 14 },

  mapGrid:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  mapCard:        { background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'left' as const, transition: 'border-color 0.15s' },
  mapCardActive:  { background: '#0f1f38', border: '1px solid #1f6feb' },
  styleTag:       { fontSize: 9, background: '#21262d', color: '#7d8590', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' as const },
  styleTagActive: { background: '#1f3a5f', color: '#58a6ff' },

  modalBackdrop:  { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '16px' },
  modal:          { background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '24px', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' as const },
  backBtn:        { background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', borderRadius: 6, padding: '10px 18px', cursor: 'pointer', fontSize: 13 },
};
