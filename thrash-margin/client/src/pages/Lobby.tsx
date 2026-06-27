import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameLocal, type SaveMeta } from '../hooks/useGameLocal';
import { MAP_DEFS } from 'shared/engine-reference';
import type { GameConfig, Difficulty } from 'shared/types';

const DIFF_PRESETS: Record<Difficulty, Partial<GameConfig>> = {
  easy:   { diff: 'easy',   playerBonus: 0.25, neutralStr: 2, aggro: 0.65, growth: 1, enemyTerritories: 1, enemyTroopScale: 0.5,  enemyStartBuildings: false, apPerTurn: 99, fogOfWar: false, enableEvents: false },
  normal: { diff: 'normal', playerBonus: 0,    neutralStr: 3, aggro: 0.80, growth: 2, enemyTerritories: 2, enemyTroopScale: 0.75, enemyStartBuildings: false, apPerTurn: 4,  fogOfWar: false, enableEvents: true  },
  hard:   { diff: 'hard',   playerBonus: -0.1, neutralStr: 4, aggro: 0.90, growth: 3, enemyTerritories: 4, enemyTroopScale: 1.0,  enemyStartBuildings: true,  apPerTurn: 4,  fogOfWar: true,  enableEvents: true  },
  brutal: { diff: 'brutal', playerBonus: -0.2, neutralStr: 5, aggro: 0.95, growth: 4, enemyTerritories: 4, enemyTroopScale: 1.5,  enemyStartBuildings: true,  apPerTurn: 3,  fogOfWar: true,  enableEvents: true  },
};

const DIFF_DESC: Record<Difficulty, string> = {
  easy:   '1 enemy, half troops, unlimited AP, no fog, no events — learning the ropes',
  normal: '2 enemies, reduced troops, 4 AP/turn — balanced for most players',
  hard:   '4 enemies, full troops + buildings, fog of war, 4 AP/turn',
  brutal: '4 enemies, 1.5× troops, fog, only 3 AP/turn — relentless',
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
  const [showSettings, setShowSettings] = useState(false);
  const [difficulty,   setDifficulty]   = useState<Difficulty>('normal');
  const [startGold,    setStartGold]    = useState(25);
  const [startFood,    setStartFood]    = useState(20);
  const [startMat,     setStartMat]     = useState(12);
  const [recruitCost,  setRecruitCost]  = useState(4);
  const [upkeep,       setUpkeep]       = useState(1);
  const [enemyTerritories,    setEnemyTerritories]    = useState(DIFF_PRESETS.normal.enemyTerritories    ?? 2);
  const [enemyTroopScale,     setEnemyTroopScale]     = useState(DIFF_PRESETS.normal.enemyTroopScale     ?? 0.75);
  const [enemyStartBuildings, setEnemyStartBuildings] = useState(DIFF_PRESETS.normal.enemyStartBuildings ?? false);
  const [apPerTurn,    setApPerTurn]    = useState(DIFF_PRESETS.normal.apPerTurn    ?? 4);
  const [fogOfWar,     setFogOfWar]     = useState(DIFF_PRESETS.normal.fogOfWar     ?? false);
  const [enableEvents, setEnableEvents] = useState(DIFF_PRESETS.normal.enableEvents ?? true);

  const [selectedMap, setSelectedMap] = useState('heartlands');

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
  };

  const handleNew = () => {
    const config: Partial<GameConfig> = {
      ...DIFF_PRESETS[difficulty],
      startGold, startFood, startMat, recruitCost, upkeep,
      enemyTerritories, enemyTroopScale, enemyStartBuildings,
      apPerTurn, fogOfWar, enableEvents,
      mapId: selectedMap,
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

          {/* Map selection */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ ...s.sLabel, marginBottom: 8 }}>Choose map</p>
            <div style={s.mapGrid}>
              {MAP_DEFS.map(m => {
                const active = selectedMap === m.id;
                return (
                  <button key={m.id} style={{ ...s.mapCard, ...(active ? s.mapCardActive : {}) }}
                    onClick={() => setSelectedMap(m.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: active ? '#e6edf3' : '#c9d1d9' }}>{m.name}</span>
                      <span style={{ ...s.styleTag, ...(active ? s.styleTagActive : {}) }}>{m.style}</span>
                    </div>
                    <p style={{ fontSize: 11, color: active ? '#9198a1' : '#6b7280', margin: '0 0 5px', lineHeight: 1.4, textAlign: 'left' }}>{m.desc}</p>
                    <p style={{ fontSize: 10, color: active ? '#58a6ff' : '#4b5563', margin: 0, textAlign: 'left' }}>{m.territories} territories</p>
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
                    <p style={s.diffDesc}>Attack costs 2 AP · Recruit / Build / Move / Upgrade cost 1 AP each</p>
                  </div>
                  <div>
                    <p style={s.subLabel}>Fog of war (hide troop counts beyond your borders)</p>
                    <ToggleRow value={fogOfWar} onChange={setFogOfWar} />
                  </div>
                  <div>
                    <p style={s.subLabel}>Random turn events (supply windfalls, plagues, unrest)</p>
                    <ToggleRow value={enableEvents} onChange={setEnableEvents} />
                  </div>
                </div>
              </div>

              {/* Enemy setup */}
              <div style={s.sSection}>
                <p style={s.sLabel}>Enemy Setup</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <p style={s.subLabel}>Starting territories (1 = easier, 4 = hardest)</p>
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

          <button style={s.newBtn} onClick={handleNew} disabled={loading}>
            {loading ? 'Starting…' : '+ Start campaign'}
          </button>
        </Section>

      </div>
    </div>
  );
}

/* ── Sub-components ── */

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
};
