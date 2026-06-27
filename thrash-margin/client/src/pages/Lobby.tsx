import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameLocal } from '../hooks/useGameLocal';
import type { GameConfig, Difficulty } from 'shared/types';

const DIFF_PRESETS: Record<Difficulty, Partial<GameConfig>> = {
  easy:   { diff: 'easy',   playerBonus: 0.25, neutralStr: 2, aggro: 0.65, growth: 1 },
  normal: { diff: 'normal', playerBonus: 0,    neutralStr: 3, aggro: 0.85, growth: 2 },
  hard:   { diff: 'hard',   playerBonus: -0.1, neutralStr: 4, aggro: 0.90, growth: 3 },
  brutal: { diff: 'brutal', playerBonus: -0.2, neutralStr: 5, aggro: 0.95, growth: 4 },
};

const DIFF_DESC: Record<Difficulty, string> = {
  easy:   'Weaker neutrals, less aggressive AI, attack bonus for you',
  normal: 'Balanced — recommended for first games',
  hard:   'Tough neutrals, aggressive AI, slight penalty to your attacks',
  brutal: 'Max AI aggression, strong neutrals, significant attack penalty',
};

export default function Lobby() {
  const { createGame, loading } = useGameLocal();
  const nav = useNavigate();

  const [showSettings, setShowSettings] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [startGold, setStartGold] = useState(25);
  const [startFood, setStartFood] = useState(20);
  const [startMat,  setStartMat]  = useState(12);
  const [recruitCost, setRecruitCost] = useState(4);
  const [upkeep, setUpkeep] = useState(1);

  const handleNew = () => {
    const config: Partial<GameConfig> = {
      ...DIFF_PRESETS[difficulty],
      startGold,
      startFood,
      startMat,
      recruitCost,
      upkeep,
    };
    const id = createGame(config);
    nav(`/game/${id}`);
  };

  const saved = (() => {
    try {
      const raw = localStorage.getItem('tm_local_game');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s.status && s.id ? s : null;
    } catch { return null; }
  })();

  return (
    <div style={s.page}>
      <div style={s.header}>
        <span style={s.logo}>Thrash Margin</span>
      </div>

      <div style={s.content}>
        <h2 style={s.heading}>Campaigns</h2>

        {saved && (
          <div style={s.card}>
            <div style={s.cardRow}>
              <div>
                <p style={s.cardTitle}>Campaign in progress</p>
                <p style={s.cardSub}>
                  Turn {saved.turn} · Status: <span style={statusColour(saved.status)}>{saved.status}</span>
                </p>
              </div>
              <button style={s.continueBtn} onClick={() => nav(`/game/${saved.id}`)}>
                {saved.status === 'active' ? 'Continue →' : 'View result'}
              </button>
            </div>
          </div>
        )}

        {/* Settings toggle */}
        <div style={s.settingsWrap}>
          <button style={s.settingsToggle} onClick={() => setShowSettings(v => !v)}>
            {showSettings ? '▾' : '▸'} Game settings
          </button>

          {showSettings && (
            <div style={s.settingsPanel}>
              {/* Difficulty */}
              <div style={s.settingsSection}>
                <p style={s.settingsLabel}>Difficulty</p>
                <div style={s.diffRow}>
                  {(Object.keys(DIFF_PRESETS) as Difficulty[]).map(d => (
                    <button key={d} style={{ ...s.diffBtn, ...(difficulty === d ? s.diffActive : {}) }}
                      onClick={() => setDifficulty(d)}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
                <p style={s.diffDesc}>{DIFF_DESC[difficulty]}</p>
              </div>

              {/* Starting resources */}
              <div style={s.settingsSection}>
                <p style={s.settingsLabel}>Starting resources</p>
                <div style={s.settingsGrid}>
                  <SettingNum label="⚙ Gold"  value={startGold} min={5}  max={100} onChange={setStartGold} />
                  <SettingNum label="🌾 Food"  value={startFood} min={5}  max={100} onChange={setStartFood} />
                  <SettingNum label="⛏ Mat"   value={startMat}  min={5}  max={100} onChange={setStartMat}  />
                </div>
              </div>

              {/* Economy */}
              <div style={s.settingsSection}>
                <p style={s.settingsLabel}>Economy</p>
                <div style={s.settingsGrid}>
                  <SettingNum label="Recruit cost (g)" value={recruitCost} min={1} max={12} onChange={setRecruitCost} />
                  <SettingNum label="Troop upkeep (g)" value={upkeep}      min={0} max={4}  onChange={setUpkeep}      />
                </div>
              </div>
            </div>
          )}
        </div>

        <button style={s.newBtn} onClick={handleNew} disabled={loading}>
          {loading ? 'Starting…' : '+ New campaign'}
        </button>
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

function statusColour(status: string): React.CSSProperties {
  if (status === 'victory')  return { color: '#3fb950' };
  if (status === 'defeated') return { color: '#f85149' };
  return { color: '#e6edf3' };
}

const s: Record<string, React.CSSProperties> = {
  page:           { minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui,sans-serif' },
  header:         { background: '#161b22', borderBottom: '1px solid #30363d', padding: '14px 32px' },
  logo:           { fontSize: 18, fontWeight: 700, color: '#e6edf3' },
  content:        { maxWidth: 600, margin: '48px auto', padding: '0 24px' },
  heading:        { fontSize: 20, fontWeight: 600, margin: '0 0 24px' },
  card:           { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px', marginBottom: 16 },
  cardRow:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:      { color: '#e6edf3', fontSize: 14, fontWeight: 600, margin: '0 0 4px' },
  cardSub:        { color: '#7d8590', fontSize: 12, margin: 0 },
  continueBtn:    { background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  settingsWrap:   { marginBottom: 16 },
  settingsToggle: { background: 'none', border: 'none', color: '#7d8590', cursor: 'pointer', fontSize: 13, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6 },
  settingsPanel:  { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 16 },
  settingsSection:{ display: 'flex', flexDirection: 'column', gap: 8 },
  settingsLabel:  { color: '#9198a1', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: 0 },
  settingsGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 16px' },
  diffRow:        { display: 'flex', gap: 6 },
  diffBtn:        { flex: 1, background: '#0d1117', border: '1px solid #30363d', color: '#7d8590', borderRadius: 5, padding: '6px 0', cursor: 'pointer', fontSize: 12 },
  diffActive:     { background: '#1f3a5f', border: '1px solid #1f6feb', color: '#e6edf3', fontWeight: 600 },
  diffDesc:       { color: '#6b7280', fontSize: 11, margin: 0, fontStyle: 'italic' },
  nudge:          { background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', width: 22, height: 22, borderRadius: 4, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  newBtn:         { background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, padding: '10px 22px', cursor: 'pointer', fontSize: 14 },
};
