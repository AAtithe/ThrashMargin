import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameLocal as useGame } from '../hooks/useGameLocal';
import {
  BUILDINGS, LV, MAX_LV,
  FACTION_COLORS, FACTION_NAMES, FACTION_BORDER,
  TECH_TREE, MAP_DEFS,
  TERRAIN_COLORS, TERRAIN_LABELS, getTerrainBonus,
  getSlots, getTroopCap, getGoldProd, getFoodProd, getMatProd, getDefStr, getNeighbours,
  prodTotals, resolveCombat,
} from 'shared/engine-reference';
import { PLAYER, NEUTRAL, isEnemy } from 'shared/types';
import type { BuildingType, GameState, Territory, TurnEvent } from 'shared/types';

export default function Game() {
  const { id } = useParams<{ id: string }>();
  const { state, loading, loadGame, sendAction } = useGame();
  const nav = useNavigate();

  const [selId, setSelId] = useState<number | null>(null);
  const [tgtId, setTgtId] = useState<number | null>(null);
  const [recruitAmt, setRecruitAmt] = useState(1);
  const [attackAmt, setAttackAmt] = useState(1);
  const [moveAmt,   setMoveAmt]   = useState(1);
  const [tooltip, setTooltip] = useState<{ id: number; x: number; y: number } | null>(null);
  const [showPassScreen, setShowPassScreen] = useState(false);

  useEffect(() => {
    if (id) loadGame(id);
  }, [id]); // eslint-disable-line

  const prevActivePlayerRef = useRef<number>(1);
  useEffect(() => {
    if (!state) return;
    const prev = prevActivePlayerRef.current;
    const cur  = state.activePlayer ?? 1;
    if (cur !== prev) {
      setShowPassScreen(true); // show pass screen any time the active player changes
      prevActivePlayerRef.current = cur;
    }
  }, [state?.activePlayer]);

  const sel = state && selId !== null ? state.nodes[selId] : null;
  const tgt = state && tgtId !== null ? state.nodes[tgtId] : null;

  const neighbours = useMemo(() => {
    if (!state || selId === null) return [];
    return getNeighbours(state.edges, selId);
  }, [state, selId]);

  const attackable = useMemo(
    () => sel?.owner === (state?.activePlayer ?? PLAYER)
      ? neighbours.filter(nid => state!.nodes[nid].owner !== (state!.activePlayer ?? PLAYER))
      : [],
    [sel, neighbours, state],
  );

  const movable = useMemo(
    () => sel?.owner === (state?.activePlayer ?? PLAYER)
      ? neighbours.filter(nid => state!.nodes[nid].owner === (state!.activePlayer ?? PLAYER) && nid !== selId)
      : [],
    [sel, neighbours, state, selId],
  );

  const annexable = useMemo(() => {
    if (!state?.config.enableDiplomacy || sel?.owner !== (state?.activePlayer ?? PLAYER)) return [];
    return neighbours.filter(nid => state!.nodes[nid].owner === NEUTRAL);
  }, [sel, neighbours, state]);

  const tgtIsMove = tgtId !== null && state !== null && state.nodes[tgtId]?.owner === PLAYER;

  const research = state?.research ?? [];

  const prod = useMemo(() => state ? prodTotals(state.nodes, PLAYER, research) : { gold: 0, food: 0, mat: 0 }, [state, research]);
  const upkeep = useMemo(() => {
    if (!state) return 0;
    return state.nodes.filter(n => n.owner === PLAYER).reduce((sum, n) => sum + n.troops, 0) * state.config.upkeep;
  }, [state]);

  const influenceRate = useMemo(() => {
    if (!state || !state.config.enableDiplomacy) return 0;
    const playerNodes = state.nodes.filter(n => n.owner === PLAYER);
    const marketCount = playerNodes.filter(n => n.buildings.includes('market')).length;
    return Math.floor(playerNodes.length / 3) + marketCount;
  }, [state]);

  const visibleIds = useMemo(() => {
    if (!state) return new Set<number>();
    if (research.includes('cartography')) return new Set(state.nodes.map(n => n.id));
    if (!state.config.fogOfWar) return new Set(state.nodes.map(n => n.id));
    const vis = new Set<number>();
    state.nodes.forEach(n => {
      if (n.owner === PLAYER) {
        vis.add(n.id);
        getNeighbours(state.edges, n.id).forEach(nid => vis.add(nid));
      }
    });
    return vis;
  }, [state, research]);

  const handleNodeClick = (nid: number) => {
    if (!state) return;
    if (nid === selId) { setSelId(null); setTgtId(null); return; }
    if (selId !== null && sel?.owner === (state.activePlayer ?? PLAYER) && attackable.includes(nid)) {
      setTgtId(nid);
      setAttackAmt(Math.max(1, Math.floor((state.nodes[selId].troops - 1) / 2)));
      return;
    }
    if (selId !== null && sel?.owner === (state.activePlayer ?? PLAYER) && movable.includes(nid)) {
      setTgtId(nid);
      setMoveAmt(Math.max(1, Math.floor((state.nodes[selId].troops - 1) / 2)));
      return;
    }
    setSelId(nid); setTgtId(null); setRecruitAmt(1); setAttackAmt(1); setMoveAmt(1);
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

  const cfg = state.config;

  // Victory / defeat summary stats
  const playerTerrs  = state.nodes.filter(n => n.owner === PLAYER).length;
  const playerTroops = state.nodes.filter(n => n.owner === PLAYER).reduce((s, n) => s + n.troops, 0);
  const eliminatedFactions: number[] = [];
  for (let f = 2; f <= 1 + (cfg.enemyFactions ?? 1); f++) {
    if (!state.nodes.some(n => n.owner === f)) eliminatedFactions.push(f);
  }
  const isOver   = state.status !== 'active';
  const maxAtk   = selId !== null ? Math.max(1, state.nodes[selId].troops - 1) : 1;
  const maxRec   = sel ? Math.max(0, getTroopCap(sel) - sel.troops) : 0;
  const clampRec = Math.min(recruitAmt, maxRec);

  const mapDef = MAP_DEFS.find(m => m.id === cfg.mapId);
  const viewBox = mapDef?.viewBox ?? '30 10 560 400';

  const endBtnText = isOver
    ? (state.status === 'victory'
      ? state.victoryType === 'economic' ? '💰 Economic Victory!'
      : state.victoryType === 'research' ? '🔬 Research Victory!'
      : '🏆 Victory!'
      : '💀 Defeated')
    : loading ? '…'
    : cfg.hotseat ? `End P${state.activePlayer ?? 1} Turn →`
    : 'End Turn →';

  const tooltipNode = tooltip !== null ? state.nodes[tooltip.id] : null;

  return (
    <div style={s.page}>
      {/* ── Victory / defeat overlay ── */}
      {isOver && (
        <VictoryScreen
          state={state}
          playerTerrs={playerTerrs}
          playerTroops={playerTroops}
          eliminatedFactions={eliminatedFactions}
          onLobby={() => nav('/')}
        />
      )}

      {/* ── Hot-seat pass screen ── */}
      {showPassScreen && !isOver && (
        <PassScreen toPlayer={state.activePlayer ?? 1} onReady={() => setShowPassScreen(false)} />
      )}

      {/* ── Territory hover tooltip ── */}
      {tooltipNode && (
        <TooltipCard
          node={tooltipNode}
          visible={visibleIds.has(tooltipNode.id)}
          x={tooltip!.x}
          y={tooltip!.y}
          research={research}
        />
      )}

      {/* ── Top bar ── */}
      <div style={s.bar}>
        <button onClick={() => nav('/')} style={s.back}>← Lobby</button>
        <span style={s.turnLabel}>
          {cfg.hotseat ? `Turn ${state.turn} — P${state.activePlayer ?? 1}` : `Turn ${state.turn}`}
        </span>
        {(cfg.apPerTurn ?? 4) < 99 && <ApBar ap={state.actionsLeft ?? cfg.apPerTurn} max={cfg.apPerTurn} />}
        <div style={s.resRow}>
          <Res icon="⚙" label="Gold" val={state.resources.gold} rate={prod.gold} color="#f59e0b" />
          <Res icon="🌾" label="Food" val={state.resources.food} rate={prod.food - upkeep} color="#34d399" />
          <Res icon="⛏" label="Mat"  val={state.resources.mat}  rate={prod.mat}  color="#a78bfa" />
          {cfg.enableDiplomacy && (
            <Res icon="👑" label="Inf" val={state.resources.influence ?? 0} rate={influenceRate} color="#ec4899" />
          )}
        </div>
        <button onClick={doEndTurn} disabled={isOver || loading} style={{ ...s.endBtn, ...(isOver ? s.endOver : {}) }}>
          {endBtnText}
        </button>
      </div>

      <div style={s.body}>
        {/* ── Map ── */}
        <div style={s.mapWrap} onMouseLeave={() => setTooltip(null)}>
          <svg viewBox={viewBox} style={s.svg}
            onClick={() => { setSelId(null); setTgtId(null); }}>
            {/* edges */}
            {state.edges.map(([a, b], i) => {
              const na = state.nodes[a], nb = state.nodes[b];
              return <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke="#30363d" strokeWidth={1.5} />;
            })}
            {/* nodes */}
            {state.nodes.map(n => <Node
              key={n.id} n={n} selId={selId} tgtId={tgtId} tgtIsMove={tgtIsMove}
              neighbours={neighbours} attackable={attackable} movable={movable} annexable={annexable}
              isVisible={visibleIds.has(n.id)}
              onClick={handleNodeClick}
              onHover={(nid, x, y) => setTooltip({ id: nid, x, y })}
            />)}
          </svg>
        </div>

        {/* ── Sidebar ── */}
        <div style={s.sidebar}>
          {/* Tutorial panel */}
          {cfg.mapId === 'tutorial' && (
            <TutorialPanel state={state} selId={selId} tgtId={tgtId} />
          )}
          {sel ? (
            <Panel
              sel={sel} tgt={tgt} tgtIsMove={tgtIsMove} state={state}
              attackAmt={attackAmt} setAttackAmt={setAttackAmt} maxAtk={maxAtk}
              clampRec={clampRec} recruitAmt={recruitAmt} setRecruitAmt={setRecruitAmt} maxRec={maxRec}
              moveAmt={moveAmt} setMoveAmt={setMoveAmt}
              attackable={attackable} movable={movable} annexable={annexable}
              ap={state.actionsLeft ?? cfg.apPerTurn}
              isOver={isOver} loading={loading}
              onAttack={() => act({ type: 'ATTACK', fromId: selId!, toId: tgtId!, troops: attackAmt }).then(() => setTgtId(null))}
              onRecruit={() => act({ type: 'RECRUIT', nodeId: selId!, amount: clampRec })}
              onBuild={(b: BuildingType) => act({ type: 'BUILD', nodeId: selId!, building: b })}
              onUpgrade={() => act({ type: 'UPGRADE', nodeId: selId! })}
              onMove={() => act({ type: 'MOVE', fromId: selId!, toId: tgtId!, troops: moveAmt }).then(() => setTgtId(null))}
              onAnnex={() => act({ type: 'ANNEX', nodeId: tgtId! }).then(() => setTgtId(null))}
            />
          ) : (
            <div style={{ padding: 8 }}>
              <p style={s.muted}>Click a territory to select it.</p>
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Dynamic faction legend */}
                {[PLAYER, ...Array.from({ length: cfg.enemyFactions ?? 1 }, (_, i) => i + 2), NEUTRAL].map(owner => {
                  const label = owner === PLAYER ? 'Your territories'
                    : owner === NEUTRAL ? 'Neutral territories'
                    : `${FACTION_NAMES[owner] ?? `Faction ${owner}`}`;
                  return (
                    <div key={owner} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: FACTION_COLORS[owner] ?? '#52525b' }} />
                      <span style={{ fontSize: 12, color: '#7d8590' }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Research panel */}
          {cfg.enableTechTree && (
            <ResearchPanel state={state} onResearch={techId => act({ type: 'RESEARCH', techId })} ap={state.actionsLeft ?? cfg.apPerTurn} isOver={isOver} loading={loading} />
          )}

          {/* Event banner */}
          {state.lastEvent && <EventBanner event={state.lastEvent} />}

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
function Node({ n, selId, tgtId, tgtIsMove, neighbours, attackable, movable, annexable, isVisible, onClick, onHover }: {
  n: Territory; selId: number | null; tgtId: number | null; tgtIsMove: boolean;
  neighbours: number[]; attackable: number[]; movable: number[]; annexable: number[];
  isVisible: boolean;
  onClick: (id: number) => void;
  onHover: (id: number, x: number, y: number) => void;
}) {
  const isSel  = selId === n.id;
  const isTgt  = tgtId === n.id;
  const isAtk  = attackable.includes(n.id);
  const isMov  = movable.includes(n.id);
  const isAnx  = annexable.includes(n.id);
  const isNbr  = neighbours.includes(n.id);
  const r = n.capital ? 22 : 18;

  const hasBlds = n.buildings.length > 0;
  const fillColor  = FACTION_COLORS[n.owner] ?? '#52525b';
  const borderColor = FACTION_BORDER[n.owner] ?? '#71717a';

  if (!isVisible) {
    return (
      <g onClick={e => { e.stopPropagation(); onClick(n.id); }} onMouseMove={e => { e.stopPropagation(); onHover(n.id, e.clientX, e.clientY); }} style={{ cursor: 'pointer' }}>
        {isTgt && <circle cx={n.x} cy={n.y} r={r+6} fill="none" stroke="#f97316" strokeWidth={2.5} opacity={0.9} />}
        <circle cx={n.x} cy={n.y} r={r} fill={fillColor} stroke="#30363d" strokeWidth={1.5} opacity={0.35} />
        <text x={n.x} y={n.y+1} textAnchor="middle" dominantBaseline="middle"
          fill="#4b5563" fontSize={11} fontWeight={700} style={{ pointerEvents: 'none' }}>?</text>
        <text x={n.x} y={n.y + r + 11} textAnchor="middle"
          fill="#374151" fontSize={9} style={{ pointerEvents: 'none' }}>{n.name}</text>
      </g>
    );
  }

  return (
    <g onClick={e => { e.stopPropagation(); onClick(n.id); }} onMouseMove={e => { e.stopPropagation(); onHover(n.id, e.clientX, e.clientY); }} style={{ cursor: 'pointer' }}>
      {isSel  && <circle cx={n.x} cy={n.y} r={r+6} fill="none" stroke="#fff"    strokeWidth={2.5} opacity={0.9} />}
      {isTgt && !tgtIsMove && <circle cx={n.x} cy={n.y} r={r+6} fill="none" stroke="#f97316" strokeWidth={2.5} opacity={0.9} />}
      {isTgt && tgtIsMove  && <circle cx={n.x} cy={n.y} r={r+6} fill="none" stroke="#2dd4bf" strokeWidth={2.5} opacity={0.9} />}
      {isAtk && !isTgt && <circle cx={n.x} cy={n.y} r={r+5} fill="none" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />}
      {isMov && !isTgt && !isSel && <circle cx={n.x} cy={n.y} r={r+5} fill="none" stroke="#2dd4bf" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />}
      {isAnx && !isAtk && !isTgt && <circle cx={n.x} cy={n.y} r={r+5} fill="none" stroke="#ec4899" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />}
      {isNbr && !isAtk && !isMov && !isAnx && !isSel && <circle cx={n.x} cy={n.y} r={r+4} fill="none" stroke="#7d8590" strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />}

      {/* Capital gold glow ring */}
      {n.capital && <circle cx={n.x} cy={n.y} r={r+4} fill="none" stroke="#fbbf24" strokeWidth={2.5} opacity={0.85} />}

      <circle cx={n.x} cy={n.y} r={r}
        fill={fillColor}
        stroke={n.capital ? '#fbbf24' : isSel ? '#fff' : borderColor}
        strokeWidth={n.capital ? 2.5 : isSel ? 2.5 : 1.5}
      />

      {/* Capital crown ♛ */}
      {n.capital && (
        <text x={n.x} y={n.y - r - 5} textAnchor="middle" dominantBaseline="middle"
          fill="#fbbf24" fontSize={13} style={{ pointerEvents: 'none' }}>
          ♛
        </text>
      )}

      {/* Stronghold star ★ */}
      {n.stronghold && (
        <text x={n.x} y={n.y - r - (n.capital ? 20 : 5)} textAnchor="middle" dominantBaseline="middle"
          fill="#f59e0b" fontSize={11} style={{ pointerEvents: 'none' }}>
          ★
        </text>
      )}

      <text x={n.x} y={n.y+1} textAnchor="middle" dominantBaseline="middle"
        fill="#fff" fontSize={n.troops > 9 ? 11 : 13} fontWeight={700} style={{ pointerEvents: 'none' }}>
        {n.troops}
      </text>
      <text x={n.x} y={n.y + r + 11} textAnchor="middle"
        fill="#6b7280" fontSize={9} style={{ pointerEvents: 'none' }}>
        {n.name}
      </text>

      {/* Terrain badge */}
      {n.terrain && n.terrain !== 'plains' && (
        <text x={n.x} y={n.y + r + 22} textAnchor="middle"
          fill={TERRAIN_COLORS[n.terrain]} fontSize={8} fontWeight={600}
          style={{ pointerEvents: 'none' }}>
          {n.terrain.charAt(0).toUpperCase() + n.terrain.slice(1)}
        </text>
      )}

      {/* Building indicator dots */}
      {hasBlds && (() => {
        const bldY = n.terrain && n.terrain !== 'plains' ? n.y + r + 30 : n.y + r + 16;
        return n.buildings.map((b, i) => {
          const totalW = n.buildings.length * 7 - 2;
          const x0 = n.x - totalW / 2 + i * 7;
          return (
            <rect key={i} x={x0} y={bldY} width={5} height={5} rx={1}
              fill={BUILDINGS[b]?.col ?? '#555'} opacity={0.9} style={{ pointerEvents: 'none' }} />
          );
        });
      })()}
    </g>
  );
}

/* ─── Sidebar panel ─── */
function Panel({ sel, tgt, tgtIsMove, state, attackAmt, setAttackAmt, maxAtk, clampRec, recruitAmt, setRecruitAmt, maxRec,
  moveAmt, setMoveAmt, attackable, movable, annexable, ap, isOver, loading, onAttack, onRecruit, onBuild, onUpgrade, onMove, onAnnex }: {
  sel: Territory; tgt: Territory | null; tgtIsMove: boolean; state: GameState;
  attackAmt: number; setAttackAmt: (n: number) => void; maxAtk: number;
  clampRec: number; recruitAmt: number; setRecruitAmt: (n: number) => void; maxRec: number;
  moveAmt: number; setMoveAmt: (n: number) => void;
  attackable: number[]; movable: number[]; annexable: number[]; ap: number; isOver: boolean; loading: boolean;
  onAttack: () => void; onRecruit: () => void;
  onBuild: (b: BuildingType) => void; onUpgrade: () => void; onMove: () => void; onAnnex: () => void;
}) {
  const activePlayer = state.activePlayer ?? PLAYER;
  const isPlayer = sel.owner === activePlayer;
  const slots    = getSlots(sel);
  const hasSlot  = sel.buildings.length < slots;
  const canUp    = isPlayer && sel.lv < MAX_LV;
  const upCost   = canUp ? { mat: LV.upCostMat[sel.lv], gold: LV.upCostGold[sel.lv] } : null;
  const canAfUp  = upCost ? state.resources.mat >= upCost.mat && state.resources.gold >= upCost.gold : false;
  const disabled = isOver || loading;
  const noAp1    = ap < 1;
  const noAp2    = ap < 2;
  const research = state.research ?? [];
  const attackCost = research.includes('iron_will') ? 1 : 2;
  const noAtkAp  = ap < attackCost;

  const ownerLabel = sel.owner === activePlayer ? 'Yours'
    : isEnemy(sel.owner) ? (FACTION_NAMES[sel.owner] ?? 'Enemy')
    : 'Neutral';

  const influenceCost = research.includes('colonisation') ? 12 : 20;
  const canAnnex = (state.resources.influence ?? 0) >= influenceCost && !noAp1;
  const tgtIsAnnex = tgt !== null && tgt.owner === NEUTRAL && !tgtIsMove;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Territory info */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <p style={s.cardTitle}>{sel.name}{sel.stronghold ? ' ★' : ''}</p>
            <p style={s.cardSub}>
              {ownerLabel}
              {' · '}Lv{sel.lv}{sel.capital ? ' · Capital' : ''}
            </p>
          </div>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: FACTION_COLORS[sel.owner] ?? '#52525b', marginTop: 4 }} />
        </div>
        <div style={s.grid4}>
          <Stat label="Troops"   value={`${sel.troops}/${getTroopCap(sel)}`} />
          <Stat label="Defence"  value={String(getDefStr(sel, research))} />
          <Stat label="Gold/t"   value={`+${getGoldProd(sel, research)}`} />
          <Stat label="Food/t"   value={`+${getFoodProd(sel)}`} />
          <Stat label="Mat/t"    value={`+${getMatProd(sel, research)}`} />
          <Stat label="Slots"    value={`${sel.buildings.length}/${slots}`} />
        </div>
        {sel.terrain && sel.terrain !== 'plains' && (
          <div style={{ marginTop: 8 }}>
            <Stat label="Terrain" value={TERRAIN_LABELS[sel.terrain] ?? sel.terrain} />
          </div>
        )}
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
          {tgt && !tgtIsMove ? (
            <>
              <p style={{ color: '#e6edf3', fontSize: 13, margin: '0 0 8px' }}>
                → <strong>{tgt.name}</strong> &nbsp;
                <span style={{ color: '#7d8590' }}>{tgt.troops} troops · def {getDefStr(tgt, research)}</span>
              </p>
              <Slider label="Send" val={attackAmt} min={1} max={maxAtk} onChange={setAttackAmt} />
              <CombatPreview sending={attackAmt} tgt={tgt} playerBonus={state.config.playerBonus} research={research} />
              <Btn onClick={onAttack} disabled={disabled || noAtkAp} dim={noAtkAp}>⚔ Attack with {attackAmt} <ApCost n={attackCost} ap={ap} /></Btn>
              {/* Annex option for neutral target when diplomacy enabled */}
              {tgt.owner === NEUTRAL && state.config.enableDiplomacy && (
                <Btn onClick={onAnnex} disabled={disabled || !canAnnex} dim={!canAnnex}>
                  👑 Annex ({influenceCost} influence) <ApCost n={1} ap={ap} />
                </Btn>
              )}
            </>
          ) : (
            <p style={s.muted}>Click an orange-ringed territory to set target.</p>
          )}
        </div>
      )}

      {/* Annex (when no attack target set but there are annexable neighbours) */}
      {isPlayer && annexable.length > 0 && attackable.length === 0 && (
        <div style={s.card}>
          <p style={s.label}>Annex</p>
          {tgt && tgtIsAnnex ? (
            <>
              <p style={{ color: '#e6edf3', fontSize: 13, margin: '0 0 10px' }}>
                → <strong>{tgt.name}</strong> &nbsp;
                <span style={{ color: '#7d8590' }}>Peaceful annexation</span>
              </p>
              <p style={{ ...s.muted, marginBottom: 8 }}>
                Cost: {influenceCost} influence · Have {state.resources.influence ?? 0}
              </p>
              <Btn onClick={onAnnex} disabled={disabled || !canAnnex} dim={!canAnnex}>
                👑 Annex ({influenceCost} influence) <ApCost n={1} ap={ap} />
              </Btn>
            </>
          ) : (
            <p style={s.muted}>Click a pink-ringed neutral territory to annex it peacefully.</p>
          )}
        </div>
      )}

      {/* Recruit */}
      {isPlayer && maxRec > 0 && (
        <div style={s.card}>
          <p style={s.label}>Recruit</p>
          <Slider label="Hire" val={clampRec} min={1} max={maxRec} onChange={setRecruitAmt} />
          <p style={{ ...s.muted, marginBottom: 8 }}>Cost: {clampRec * state.config.recruitCost}g · Have {state.resources.gold}g</p>
          <Btn onClick={onRecruit} disabled={disabled || noAp1 || state.resources.gold < state.config.recruitCost} dim={noAp1}>
            + Recruit {clampRec} <ApCost n={1} ap={ap} />
          </Btn>
        </div>
      )}

      {/* Move troops */}
      {isPlayer && movable.length > 0 && (
        <div style={s.card}>
          <p style={s.label}>Move Troops</p>
          {tgt && tgtIsMove ? (
            <>
              <p style={{ color: '#e6edf3', fontSize: 13, margin: '0 0 10px' }}>
                → <strong>{tgt.name}</strong> &nbsp;
                <span style={{ color: '#7d8590' }}>{tgt.troops}/{getTroopCap(tgt)} troops</span>
              </p>
              <Slider label="Send" val={moveAmt} min={1} max={Math.max(1, sel.troops - 1)} onChange={setMoveAmt} />
              <Btn onClick={onMove} disabled={disabled || noAp1} dim={noAp1}>↗ Move {moveAmt} troops <ApCost n={1} ap={ap} /></Btn>
            </>
          ) : (
            <p style={s.muted}>Click a teal-ringed friendly territory to move troops there.</p>
          )}
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
                const ok = state.resources.gold >= info.cost.gold && state.resources.mat >= info.cost.mat && !noAp1;
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
          <Btn onClick={onUpgrade} disabled={disabled || noAp1 || !canAfUp} dim={!canAfUp || noAp1}>
            ↑ Upgrade settlement <ApCost n={1} ap={ap} />
          </Btn>
        </div>
      )}

      {/* Enemy territory hint */}
      {isEnemy(sel.owner) && (
        <div style={s.card}>
          <p style={s.muted}>Select one of your adjacent territories to launch an attack on this one.</p>
        </div>
      )}

      {sel.owner === NEUTRAL && !isPlayer && (
        <div style={s.card}>
          <p style={s.muted}>Neutral territory. Select an adjacent territory you own to attack or annex it.</p>
        </div>
      )}
    </div>
  );
}

/* ─── Research Panel ─── */
function ResearchPanel({ state, onResearch, ap, isOver, loading }: {
  state: GameState;
  onResearch: (techId: string) => void;
  ap: number;
  isOver: boolean;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const research = state.research ?? [];
  const count = research.length;
  const disabled = isOver || loading || ap < 1;

  const branches = ['military', 'economic', 'expansion'] as const;

  return (
    <div style={s.card}>
      <button
        style={{ background: 'none', border: 'none', color: '#9198a1', cursor: 'pointer', width: '100%', textAlign: 'left', padding: 0, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}
        onClick={() => setOpen(v => !v)}
      >
        {open ? '▾' : '▸'} 🔬 Research ({count}/12)
      </button>

      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {branches.map(branch => {
            const techs = TECH_TREE.filter(t => t.branch === branch);
            return (
              <div key={branch}>
                <p style={{ ...s.label, marginBottom: 4, color: branch === 'military' ? '#ef4444' : branch === 'economic' ? '#f59e0b' : '#3b82f6' }}>
                  {branch.charAt(0).toUpperCase() + branch.slice(1)}
                </p>
                {techs.map(tech => {
                  const unlocked = research.includes(tech.id);
                  const prereqMet = tech.prereq === null || research.includes(tech.prereq);
                  const canAfford = state.resources.gold >= tech.cost.gold && state.resources.mat >= tech.cost.mat;
                  const canResearch = !unlocked && prereqMet && canAfford && !disabled;

                  return (
                    <div key={tech.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                      padding: '5px 0', borderBottom: '1px solid #21262d',
                      opacity: unlocked ? 1 : prereqMet ? 1 : 0.4,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: unlocked ? '#3fb950' : '#e6edf3' }}>
                            {unlocked ? '✓ ' : ''}{tech.name}
                          </span>
                          {!unlocked && (
                            <span style={{ fontSize: 9, color: '#6b7280' }}>{tech.cost.gold}g {tech.cost.mat}m</span>
                          )}
                        </div>
                        <p style={{ fontSize: 10, color: '#6b7280', margin: 0 }}>{tech.desc}</p>
                      </div>
                      {!unlocked && prereqMet && (
                        <button
                          onClick={() => onResearch(tech.id)}
                          disabled={!canResearch}
                          style={{
                            marginLeft: 6, flexShrink: 0,
                            background: canResearch ? '#1f3a5f' : '#0d1117',
                            border: `1px solid ${canResearch ? '#1f6feb' : '#30363d'}`,
                            color: canResearch ? '#e6edf3' : '#4b5563',
                            borderRadius: 4, padding: '3px 7px', fontSize: 10, cursor: canResearch ? 'pointer' : 'default',
                          }}
                        >
                          Unlock
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
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

function ApBar({ ap, max }: { ap: number; max: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '5px 10px' }}>
      <span style={{ fontSize: 13 }}>⚡</span>
      <div>
        <div style={{ color: '#6b7280', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>Actions</div>
        <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
          {Array.from({ length: max }).map((_, i) => (
            <div key={i} style={{
              width: 9, height: 9, borderRadius: 2,
              background: i < ap ? '#f59e0b' : '#21262d',
              border: '1px solid #30363d',
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ApCost({ n, ap }: { n: number; ap: number }) {
  return (
    <span style={{ fontSize: 10, color: ap >= n ? '#f59e0b' : '#f85149', marginLeft: 4, opacity: 0.8 }}>
      ({n}⚡)
    </span>
  );
}

function EventBanner({ event }: { event: TurnEvent }) {
  const colors: Record<string, { border: string; label: string; bg: string }> = {
    positive: { border: '#3fb950', label: '#3fb950', bg: 'rgba(63,185,80,0.08)' },
    negative: { border: '#f85149', label: '#f85149', bg: 'rgba(248,81,73,0.08)' },
    neutral:  { border: '#7d8590', label: '#9198a1', bg: 'rgba(125,133,144,0.06)' },
  };
  const c = colors[event.type] ?? colors.neutral;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6, padding: '10px 12px', marginBottom: 8 }}>
      <p style={{ color: c.label, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 4px' }}>
        📜 {event.title}
      </p>
      <p style={{ color: '#9198a1', fontSize: 11, margin: 0, lineHeight: 1.4 }}>{event.message}</p>
    </div>
  );
}

function Res({ icon, label, val, rate, color }: { icon: string; label: string; val: number; rate: number; color: string }) {
  const rateStr = rate >= 0 ? `+${rate}` : `${rate}`;
  const rateColor = rate > 0 ? '#3fb950' : rate < 0 ? '#f85149' : '#7d8590';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '5px 10px' }}>
      <span style={{ fontSize: 15 }}>{icon}</span>
      <div>
        <div style={{ color: '#6b7280', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ color, fontSize: 16, fontWeight: 700, lineHeight: 1 }}>{val}</span>
          <span style={{ color: rateColor, fontSize: 10, fontWeight: 600 }}>{rateStr}/t</span>
        </div>
      </div>
    </div>
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

/* ─── Combat preview ─── */
function CombatPreview({ sending, tgt, playerBonus, research }: {
  sending: number; tgt: Territory; playerBonus: number; research: string[];
}) {
  const result = resolveCombat(sending, tgt, playerBonus, research);
  const ratio = (sending * (1 + playerBonus) * (research.includes('siege_craft') ? 1.25 : 1)) / Math.max(1, sending);
  const strengthColor = result.won
    ? (result.attackerLoss / sending < 0.3 ? '#3fb950' : '#f59e0b')
    : '#f85149';
  const outcomeLabel = result.won ? '✓ CAPTURE' : '✗ REPELLED';

  return (
    <div style={{ background: '#0a0f16', border: `1px solid ${strengthColor}33`, borderRadius: 5, padding: '8px 10px', marginBottom: 8, fontSize: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: strengthColor, fontWeight: 700, fontSize: 12 }}>{outcomeLabel}</span>
        <span style={{ color: '#7d8590' }}>ratio {((sending * (1 + playerBonus) * (research.includes('siege_craft') ? 1.25 : 1)) / Math.max(getDefStr(tgt, research), 1)).toFixed(1)}×</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
        <span style={{ color: '#7d8590' }}>Your losses</span>
        <span style={{ color: '#e6edf3', fontWeight: 600 }}>~{result.attackerLoss} troops</span>
        {result.won ? (
          <>
            <span style={{ color: '#7d8590' }}>Garrison after</span>
            <span style={{ color: '#3fb950', fontWeight: 600 }}>{result.surviving} troops</span>
          </>
        ) : (
          <>
            <span style={{ color: '#7d8590' }}>Defender losses</span>
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>{result.defenderLoss} troops</span>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Terrain helpers ─── */
function getTerrainDesc(t: string): string {
  return ({ forest: '+1 food, -1 def', mountain: '+3 def, -1 gold', coast: '+2 gold', desert: '+1 mat, -1 food' } as Record<string, string>)[t] ?? '';
}

/* ─── Territory hover tooltip ─── */
function TooltipCard({ node, visible, x, y, research }: {
  node: Territory; visible: boolean; x: number; y: number; research: string[];
}) {
  const ownerLabel = node.owner === PLAYER ? 'Yours'
    : isEnemy(node.owner) ? (FACTION_NAMES[node.owner] ?? 'Enemy')
    : 'Neutral';
  const color = FACTION_COLORS[node.owner] ?? '#52525b';

  return (
    <div style={{
      position: 'fixed', left: x + 14, top: y - 10,
      background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
      padding: '8px 12px', pointerEvents: 'none', zIndex: 1000,
      minWidth: 140, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 12 }}>
          {node.name}{node.stronghold ? ' ★' : ''}{node.capital ? ' ♛' : ''}
        </span>
      </div>
      <div style={{ color: '#7d8590', fontSize: 11 }}>{ownerLabel} · Lv{node.lv}</div>
      {node.terrain && node.terrain !== 'plains' && (
        <div style={{ color: TERRAIN_COLORS[node.terrain], fontSize: 10, marginTop: 2, fontWeight: 600 }}>
          {TERRAIN_LABELS[node.terrain]} — {getTerrainDesc(node.terrain)}
        </div>
      )}
      {visible ? (
        <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11 }}>
            <span style={{ color: '#9198a1' }}>Troops</span>
            <span style={{ color: '#e6edf3', fontWeight: 600 }}>{node.troops}/{getTroopCap(node)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11 }}>
            <span style={{ color: '#9198a1' }}>Defence</span>
            <span style={{ color: '#e6edf3', fontWeight: 600 }}>{getDefStr(node, research)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11 }}>
            <span style={{ color: '#9198a1' }}>Gold/t</span>
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>+{getGoldProd(node, research)}</span>
          </div>
          {node.buildings.length > 0 && (
            <div style={{ marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {node.buildings.map((b, i) => (
                <span key={i} style={{ background: '#21262d', borderRadius: 3, padding: '1px 5px', fontSize: 10, color: '#9198a1' }}>
                  {BUILDINGS[b]?.name ?? b}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: '#4b5563', fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>Hidden by fog of war</div>
      )}
    </div>
  );
}

/* ─── Victory / defeat summary ─── */
function VictoryScreen({ state, playerTerrs, playerTroops, eliminatedFactions, onLobby }: {
  state: GameState;
  playerTerrs: number;
  playerTroops: number;
  eliminatedFactions: number[];
  onLobby: () => void;
}) {
  const won = state.status === 'victory';
  const cfg = state.config;
  const totalFactions = cfg.enemyFactions ?? 1;

  const victoryLabel = !won ? 'DEFEAT'
    : state.victoryType === 'economic' ? 'ECONOMIC VICTORY'
    : state.victoryType === 'research' ? 'RESEARCH VICTORY'
    : 'CONQUEST';

  const victoryDesc = !won
    ? 'Your realm has fallen. The enemy stands triumphant.'
    : state.victoryType === 'economic'
    ? `Your treasury overflowed with ${state.resources.gold} gold — wealth beyond compare.`
    : state.victoryType === 'research'
    ? `You mastered the ${state.researchBranch ?? ''} branch of knowledge and changed the world.`
    : 'All enemy factions have been crushed. The continent is yours.';

  const accentColor = won ? '#3fb950' : '#f85149';

  const stats: { label: string; value: string }[] = [
    { label: 'Turns played',        value: String(state.turn) },
    { label: 'Territories held',    value: String(playerTerrs) },
    { label: 'Troops deployed',     value: String(playerTroops) },
    { label: 'Techs researched',    value: `${state.research.length}/12` },
    { label: 'Factions eliminated', value: `${eliminatedFactions.length}/${totalFactions}` },
    { label: 'Gold in treasury',    value: `${state.resources.gold}` },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: '#161b22', border: `1px solid ${accentColor}55`, borderRadius: 12, padding: '36px 44px', maxWidth: 440, width: '90%', textAlign: 'center', boxShadow: `0 0 60px ${accentColor}22` }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>{won ? '🏆' : '💀'}</div>
        <h1 style={{ color: accentColor, fontSize: 26, fontWeight: 800, margin: '0 0 8px', letterSpacing: 1 }}>{victoryLabel}</h1>
        <p style={{ color: '#7d8590', fontSize: 13, margin: '0 0 28px', lineHeight: 1.5 }}>{victoryDesc}</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: 28, textAlign: 'left' }}>
          {stats.map(({ label, value }) => (
            <div key={label}>
              <div style={{ color: '#4b5563', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
              <div style={{ color: '#e6edf3', fontSize: 16, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>

        <button onClick={onLobby} style={{ background: accentColor, border: 'none', borderRadius: 7, color: '#0d1117', fontWeight: 700, fontSize: 15, padding: '12px 32px', cursor: 'pointer', width: '100%' }}>
          ← Return to Lobby
        </button>
      </div>
    </div>
  );
}

/* ─── Tutorial Panel ─── */
function getTutorialHint(state: GameState, selId: number | null, tgtId: number | null): { step: number; title: string; message: string } {
  const playerTerrs = state.nodes.filter(n => n.owner === PLAYER).length;
  const turn = state.turn;
  const actionsUsed = (state.config.apPerTurn ?? 4) - (state.actionsLeft ?? 0) > 0;

  if (playerTerrs === 1 && selId === null)
    return { step: 1, title: 'Select your territory', message: 'Click Ironhold (your blue capital) to select it and see your options.' };
  if (playerTerrs === 1 && selId !== null && tgtId === null)
    return { step: 2, title: 'Recruit or Attack', message: 'You can Recruit more troops, or click an adjacent territory (dashed ring) to attack. Try attacking Meadowkeep to expand your realm.' };
  if (playerTerrs === 1 && tgtId !== null)
    return { step: 3, title: 'Launch the attack', message: 'Drag the slider to set how many troops to send, then click ⚔ Attack. Keep 1 troop at home!' };
  if (playerTerrs === 2 && turn === 1)
    return { step: 4, title: 'Build for income', message: 'Select one of your territories and build a Farm (food) or Mine (materials). Then click End Turn →.' };
  if (playerTerrs >= 2 && playerTerrs < 6)
    return { step: 5, title: 'Keep expanding', message: 'Capture more territories to grow your army. Each territory earns gold each turn. The enemy capital Ashpeak is your ultimate target.' };
  if (playerTerrs >= 6)
    return { step: 6, title: 'Final push', message: 'Almost there! Ashpeak is the enemy capital. Muster your strongest army and crush it to win the tutorial.' };

  void actionsUsed; void turn;
  return { step: 1, title: 'Welcome', message: 'Click Ironhold to begin.' };
}

function TutorialPanel({ state, selId, tgtId }: { state: GameState; selId: number | null; tgtId: number | null }) {
  const hint = getTutorialHint(state, selId, tgtId);
  return (
    <div style={{ background: '#0f2a1a', border: '1px solid #15803d', borderRadius: 6, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>🎓</span>
        <span style={{ color: '#3fb950', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tutorial — Step {hint.step}</span>
      </div>
      <p style={{ color: '#86efac', fontSize: 12, fontWeight: 600, margin: '0 0 4px' }}>{hint.title}</p>
      <p style={{ color: '#6b9f7a', fontSize: 11, margin: 0, lineHeight: 1.5 }}>{hint.message}</p>
    </div>
  );
}

/* ─── Pass Screen (Hot Seat) ─── */
function PassScreen({ toPlayer, onReady }: { toPlayer: number; onReady: () => void }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:3000 }}>
      <div style={{ textAlign:'center', maxWidth:360 }}>
        <div style={{ fontSize:52, marginBottom:12 }}>🎮</div>
        <h2 style={{ color:'#e6edf3', fontSize:22, fontWeight:800, margin:'0 0 10px' }}>
          Player {toPlayer}'s Turn
        </h2>
        <p style={{ color:'#7d8590', fontSize:14, margin:'0 0 28px', lineHeight:1.5 }}>
          Pass the device to Player {toPlayer}.<br/>
          When ready, press the button below.
        </p>
        <button onClick={onReady}
          style={{ background: toPlayer === 2 ? '#dc2626' : '#2563eb', border:'none', borderRadius:8, color:'#fff', fontWeight:700, fontSize:16, padding:'14px 40px', cursor:'pointer', width:'100%' }}>
          I'm ready — Let's go! →
        </button>
      </div>
    </div>
  );
}

/* ─── Styles ─── */
const s: Record<string, React.CSSProperties> = {
  page:     { height: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui,sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  bar:      { background: '#161b22', borderBottom: '1px solid #30363d', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 },
  back:     { background: 'none', border: 'none', color: '#7d8590', cursor: 'pointer', fontSize: 13, padding: '4px 8px' },
  turnLabel:{ color: '#e6edf3', fontWeight: 700, fontSize: 15 },
  resRow:   { display: 'flex', gap: 8, marginLeft: 4 },
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
  btn:      { width: '100%', padding: '8px 0', background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', marginTop: 4 },
  log:      { marginTop: 'auto', borderTop: '1px solid #21262d', paddingTop: 10, paddingBottom: 4 },
  logHdr:   { color: '#6b7280', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 6px' },
  logLine:  { color: '#7d8590', fontSize: 11, margin: '0 0 5px', lineHeight: 1.4 },
  logT:     { color: '#52525b', fontWeight: 600 },
};
