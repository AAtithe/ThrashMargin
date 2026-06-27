import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGame } from '../hooks/useGame';
import { getToken } from '../lib/token';
import {
  BUILDINGS, LV, MAX_LV,
  getSlots, getTroopCap, getGoldProd, getFoodProd, getMatProd, getDefStr, getNeighbours,
} from 'shared/engine-reference';
import { PLAYER, ENEMY, NEUTRAL } from 'shared/types';
import type { BuildingType, GameState, Territory } from 'shared/types';

const OWNER_COLOR  = ['#52525b', '#2563eb', '#dc2626'] as const;
const OWNER_BORDER = ['#71717a', '#3b82f6', '#ef4444'] as const;

export default function Game() {
  const { id } = useParams<{ id: string }>();
  const { state, loading, loadGame, sendAction } = useGame();
  const nav = useNavigate();

  const [selId, setSelId] = useState<number | null>(null);
  const [tgtId, setTgtId] = useState<number | null>(null);
  const [recruitAmt, setRecruitAmt] = useState(1);
  const [attackAmt, setAttackAmt] = useState(1);

  useEffect(() => {
    if (!getToken()) { nav('/login'); return; }
    if (id) loadGame(id);
  }, [id]); // eslint-disable-line

  const sel = state && selId !== null ? state.nodes[selId] : null;
  const tgt = state && tgtId !== null ? state.nodes[tgtId] : null;

  const neighbours = useMemo(() => {
    if (!state || selId === null) return [];
    return getNeighbours(state.edges, selId);
  }, [state, selId]);

  const attackable = useMemo(
    () => sel?.owner === PLAYER ? neighbours.filter(nid => state!.nodes[nid].owner !== PLAYER) : [],
    [sel, neighbours, state],
  );

  const handleNodeClick = (nid: number) => {
    if (!state) return;
    if (nid === selId) { setSelId(null); setTgtId(null); return; }
    if (selId !== null && sel?.owner === PLAYER && attackable.includes(nid)) {
      setTgtId(nid);
      setAttackAmt(Math.max(1, Math.floor((state.nodes[selId].troops - 1) / 2)));
      return;
    }
    setSelId(nid); setTgtId(null); setRecruitAmt(1); setAttackAmt(1);
  };

  const act = async (action: Parameters<typeof sendAction>[1]) => {
    if (!id) return;
    await sendAction(id, action);
  };

  const doEndTurn = async () => {
    setSelId(null); setTgtId(null);
    await act({ type: 'END_TURN' });
  };

  if (!state && loading) return <Blank>Loading campaign…</Blank>;
  if (!state)            return <Blank>Campaign not found. <button onClick={() => nav('/')} style={{ color: '#1f6feb', background: 'none', border: 'none', cursor: 'pointer' }}>← Back</button></Blank>;

  const isOver   = state.status !== 'active';
  const maxAtk   = selId !== null ? Math.max(1, state.nodes[selId].troops - 1) : 1;
  const maxRec   = sel ? Math.max(0, getTroopCap(sel) - sel.troops) : 0;
  const clampRec = Math.min(recruitAmt, maxRec);

  return (
    <div style={s.page}>
      {/* ── Top bar ── */}
      <div style={s.bar}>
        <button onClick={() => nav('/')} style={s.back}>← Lobby</button>
        <span style={s.turnLabel}>Turn {state.turn}</span>
        <div style={s.resRow}>
          <Res icon="⚙" val={state.resources.gold} unit="g" color="#f59e0b" />
          <Res icon="🌾" val={state.resources.food} unit="f" color="#34d399" />
          <Res icon="⛏" val={state.resources.mat}  unit="m" color="#a78bfa" />
        </div>
        <button onClick={doEndTurn} disabled={isOver || loading} style={{ ...s.endBtn, ...(isOver ? s.endOver : {}) }}>
          {isOver
            ? state.status === 'victory' ? '🏆 Victory!' : '💀 Defeated'
            : loading ? '…' : 'End Turn →'}
        </button>
      </div>

      <div style={s.body}>
        {/* ── Map ── */}
        <div style={s.mapWrap}>
          <svg viewBox="30 10 560 400" style={s.svg}
            onClick={() => { setSelId(null); setTgtId(null); }}>
            {/* edges */}
            {state.edges.map(([a, b], i) => {
              const na = state.nodes[a], nb = state.nodes[b];
              return <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke="#30363d" strokeWidth={1.5} />;
            })}
            {/* nodes */}
            {state.nodes.map(n => <Node
              key={n.id} n={n} selId={selId} tgtId={tgtId}
              neighbours={neighbours} attackable={attackable}
              onClick={handleNodeClick}
            />)}
          </svg>
        </div>

        {/* ── Sidebar ── */}
        <div style={s.sidebar}>
          {sel ? (
            <Panel
              sel={sel} tgt={tgt} state={state}
              attackAmt={attackAmt} setAttackAmt={setAttackAmt} maxAtk={maxAtk}
              clampRec={clampRec} recruitAmt={recruitAmt} setRecruitAmt={setRecruitAmt} maxRec={maxRec}
              attackable={attackable}
              isOver={isOver} loading={loading}
              onAttack={() => act({ type: 'ATTACK', fromId: selId!, toId: tgtId!, troops: attackAmt }).then(() => setTgtId(null))}
              onRecruit={() => act({ type: 'RECRUIT', nodeId: selId!, amount: clampRec })}
              onBuild={(b: BuildingType) => act({ type: 'BUILD', nodeId: selId!, building: b })}
              onUpgrade={() => act({ type: 'UPGRADE', nodeId: selId! })}
            />
          ) : (
            <div style={{ padding: 8 }}>
              <p style={s.muted}>Click a territory to select it.</p>
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([['#2563eb', 'Your territories'], ['#dc2626', 'Enemy territories'], ['#52525b', 'Neutral territories']] as const).map(([c, l]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
                    <span style={{ fontSize: 12, color: '#7d8590' }}>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Log */}
          <div style={s.log}>
            <p style={s.logHdr}>Battle log</p>
            {state.log.slice(0, 20).map((entry, i) => (
              <p key={i} style={s.logLine}>
                <span style={s.logT}>T{entry.turn}</span> {entry.message}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── SVG Node ─── */
function Node({ n, selId, tgtId, neighbours, attackable, onClick }: {
  n: Territory; selId: number | null; tgtId: number | null;
  neighbours: number[]; attackable: number[];
  onClick: (id: number) => void;
}) {
  const isSel = selId === n.id;
  const isTgt = tgtId === n.id;
  const isAtk = attackable.includes(n.id);
  const isNbr = neighbours.includes(n.id);
  const r = n.capital ? 22 : 18;

  return (
    <g onClick={e => { e.stopPropagation(); onClick(n.id); }} style={{ cursor: 'pointer' }}>
      {isSel  && <circle cx={n.x} cy={n.y} r={r+6} fill="none" stroke="#fff"    strokeWidth={2.5} opacity={0.9} />}
      {isTgt  && <circle cx={n.x} cy={n.y} r={r+6} fill="none" stroke="#f97316" strokeWidth={2.5} opacity={0.9} />}
      {isAtk && !isTgt && <circle cx={n.x} cy={n.y} r={r+5} fill="none" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />}
      {isNbr && !isAtk && !isSel && <circle cx={n.x} cy={n.y} r={r+4} fill="none" stroke="#7d8590" strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />}

      <circle cx={n.x} cy={n.y} r={r}
        fill={OWNER_COLOR[n.owner]}
        stroke={isSel ? '#fff' : OWNER_BORDER[n.owner]}
        strokeWidth={isSel ? 2.5 : 1.5}
      />
      {n.capital && <circle cx={n.x} cy={n.y - r + 6} r={3.5} fill="rgba(255,255,255,0.85)" />}
      <text x={n.x} y={n.y+1} textAnchor="middle" dominantBaseline="middle"
        fill="#fff" fontSize={n.troops > 9 ? 11 : 13} fontWeight={700} style={{ pointerEvents: 'none' }}>
        {n.troops}
      </text>
      <text x={n.x} y={n.y + r + 11} textAnchor="middle"
        fill="#6b7280" fontSize={9} style={{ pointerEvents: 'none' }}>
        {n.name}
      </text>
    </g>
  );
}

/* ─── Sidebar panel ─── */
function Panel({ sel, tgt, state, attackAmt, setAttackAmt, maxAtk, clampRec, recruitAmt, setRecruitAmt, maxRec,
  attackable, isOver, loading, onAttack, onRecruit, onBuild, onUpgrade }: {
  sel: Territory; tgt: Territory | null; state: GameState;
  attackAmt: number; setAttackAmt: (n: number) => void; maxAtk: number;
  clampRec: number; recruitAmt: number; setRecruitAmt: (n: number) => void; maxRec: number;
  attackable: number[]; isOver: boolean; loading: boolean;
  onAttack: () => void; onRecruit: () => void;
  onBuild: (b: BuildingType) => void; onUpgrade: () => void;
}) {
  const isPlayer = sel.owner === PLAYER;
  const slots    = getSlots(sel);
  const hasSlot  = sel.buildings.length < slots;
  const canUp    = isPlayer && sel.lv < MAX_LV;
  const upCost   = canUp ? { mat: LV.upCostMat[sel.lv], gold: LV.upCostGold[sel.lv] } : null;
  const canAfUp  = upCost ? state.resources.mat >= upCost.mat && state.resources.gold >= upCost.gold : false;
  const disabled = isOver || loading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Territory info */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <p style={s.cardTitle}>{sel.name}</p>
            <p style={s.cardSub}>
              {sel.owner === PLAYER ? 'Yours' : sel.owner === ENEMY ? 'Enemy' : 'Neutral'}
              {' · '}Lv{sel.lv}{sel.capital ? ' · Capital' : ''}
            </p>
          </div>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: OWNER_COLOR[sel.owner], marginTop: 4 }} />
        </div>
        <div style={s.grid4}>
          <Stat label="Troops"   value={`${sel.troops}/${getTroopCap(sel)}`} />
          <Stat label="Defence"  value={String(getDefStr(sel))} />
          <Stat label="Gold/t"   value={`+${getGoldProd(sel)}`} />
          <Stat label="Food/t"   value={`+${getFoodProd(sel)}`} />
          <Stat label="Mat/t"    value={`+${getMatProd(sel)}`} />
          <Stat label="Slots"    value={`${sel.buildings.length}/${slots}`} />
        </div>
        {sel.buildings.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {sel.buildings.map((b, i) => (
              <span key={i} style={s.tag}>{BUILDINGS[b].name}</span>
            ))}
          </div>
        )}
      </div>

      {/* Attack */}
      {isPlayer && attackable.length > 0 && (
        <div style={s.card}>
          <p style={s.label}>Attack</p>
          {tgt ? (
            <>
              <p style={{ color: '#e6edf3', fontSize: 13, margin: '0 0 10px' }}>
                → <strong>{tgt.name}</strong> &nbsp;
                <span style={{ color: '#7d8590' }}>{tgt.troops} troops · def {getDefStr(tgt)}</span>
              </p>
              <Slider label="Send" val={attackAmt} min={1} max={maxAtk} onChange={setAttackAmt} />
              <Btn onClick={onAttack} disabled={disabled}>⚔ Attack with {attackAmt}</Btn>
            </>
          ) : (
            <p style={s.muted}>Click an orange-ringed territory to set target.</p>
          )}
        </div>
      )}

      {/* Recruit */}
      {isPlayer && maxRec > 0 && (
        <div style={s.card}>
          <p style={s.label}>Recruit</p>
          <Slider label="Hire" val={clampRec} min={1} max={maxRec} onChange={setRecruitAmt} />
          <p style={{ ...s.muted, marginBottom: 8 }}>Cost: {clampRec * state.config.recruitCost}g · Have {state.resources.gold}g</p>
          <Btn onClick={onRecruit} disabled={disabled || state.resources.gold < state.config.recruitCost}>
            + Recruit {clampRec}
          </Btn>
        </div>
      )}

      {/* Build */}
      {isPlayer && hasSlot && (
        <div style={s.card}>
          <p style={s.label}>Build ({sel.buildings.length}/{slots} slots)</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(Object.keys(BUILDINGS) as BuildingType[])
              .filter(b => !sel.buildings.includes(b))
              .map(b => {
                const info = BUILDINGS[b];
                const ok = state.resources.gold >= info.cost.gold && state.resources.mat >= info.cost.mat;
                return (
                  <button key={b} onClick={() => onBuild(b)} disabled={disabled || !ok}
                    style={{ ...s.buildRow, opacity: ok ? 1 : 0.4 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{info.name}</span>
                    <span style={{ color: '#7d8590', fontSize: 11 }}>{info.cost.gold}g + {info.cost.mat}m · {info.desc}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Upgrade */}
      {canUp && upCost && (
        <div style={s.card}>
          <p style={s.label}>Upgrade to Lv{sel.lv + 1}</p>
          <p style={{ ...s.muted, marginBottom: 8 }}>
            {upCost.mat}m + {upCost.gold}g → new building slot, +troops cap, +gold/turn
          </p>
          <Btn onClick={onUpgrade} disabled={disabled || !canAfUp} dim={!canAfUp}>
            ↑ Upgrade settlement
          </Btn>
        </div>
      )}

      {/* Enemy territory hint */}
      {sel.owner === ENEMY && (
        <div style={s.card}>
          <p style={s.muted}>Select one of your adjacent territories to launch an attack on this one.</p>
        </div>
      )}

      {sel.owner === NEUTRAL && !isPlayer && (
        <div style={s.card}>
          <p style={s.muted}>Neutral territory. Select an adjacent territory you own to attack it.</p>
        </div>
      )}
    </div>
  );
}

/* ─── Small helpers ─── */
function Blank({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7d8590', fontFamily: 'system-ui,sans-serif' }}>
      {children}
    </div>
  );
}

function Res({ icon, val, unit, color }: { icon: string; val: number; unit: string; color: string }) {
  return (
    <span style={{ color, fontSize: 13, fontWeight: 600 }}>
      {icon} {val}<span style={{ color: '#7d8590', fontWeight: 400 }}>{unit}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 10, margin: '0 0 2px', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ color: '#e6edf3', fontSize: 12, margin: 0, fontWeight: 600 }}>{value}</p>
    </div>
  );
}

function Slider({ label, val, min, max, onChange }: { label: string; val: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ color: '#7d8590', fontSize: 12, minWidth: 28 }}>{label}</span>
      <input type="range" min={min} max={max} value={val} onChange={e => onChange(Number(e.target.value))} style={{ flex: 1 }} />
      <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14, minWidth: 22, textAlign: 'right' }}>{val}</span>
    </div>
  );
}

function Btn({ children, onClick, disabled, dim }: {
  children: React.ReactNode; onClick: () => void;
  disabled?: boolean; dim?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ ...s.btn, opacity: dim ? 0.45 : 1 }}>
      {children}
    </button>
  );
}

/* ─── Styles ─── */
const s: Record<string, React.CSSProperties> = {
  page:     { height: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui,sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  bar:      { background: '#161b22', borderBottom: '1px solid #30363d', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 },
  back:     { background: 'none', border: 'none', color: '#7d8590', cursor: 'pointer', fontSize: 13, padding: '4px 8px' },
  turnLabel:{ color: '#e6edf3', fontWeight: 700, fontSize: 15 },
  resRow:   { display: 'flex', gap: 20, marginLeft: 4 },
  endBtn:   { marginLeft: 'auto', background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, padding: '8px 20px', cursor: 'pointer', fontSize: 14 },
  endOver:  { background: '#21262d', cursor: 'default' },
  body:     { display: 'flex', flex: 1, overflow: 'hidden' },
  mapWrap:  { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, overflow: 'hidden' },
  svg:      { width: '100%', height: '100%', maxHeight: 'calc(100vh - 60px)' },
  sidebar:  { width: 272, background: '#161b22', borderLeft: '1px solid #30363d', overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: 10, gap: 0 },
  card:     { background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: 12, marginBottom: 8 },
  cardTitle:{ color: '#e6edf3', fontSize: 15, fontWeight: 700, margin: '0 0 2px' },
  cardSub:  { color: '#7d8590', fontSize: 11, margin: '0' },
  label:    { color: '#9198a1', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 8px' },
  muted:    { color: '#7d8590', fontSize: 12, margin: 0 },
  grid4:    { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 12px', marginTop: 8 },
  tag:      { background: '#21262d', border: '1px solid #30363d', borderRadius: 4, padding: '2px 7px', fontSize: 10, color: '#9198a1' },
  buildRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#161b22', border: '1px solid #30363d', borderRadius: 5, cursor: 'pointer', color: '#e6edf3', textAlign: 'left', gap: 8 },
  btn:      { width: '100%', padding: '8px 0', background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  log:      { marginTop: 'auto', borderTop: '1px solid #21262d', paddingTop: 10, paddingBottom: 4 },
  logHdr:   { color: '#6b7280', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 6px' },
  logLine:  { color: '#7d8590', fontSize: 11, margin: '0 0 5px', lineHeight: 1.4 },
  logT:     { color: '#52525b', fontWeight: 600 },
};
