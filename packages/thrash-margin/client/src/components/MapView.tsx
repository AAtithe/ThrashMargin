/**
 * The board. Organic Voronoi regions (map/regionGeometry.ts) tinted by owner over a terrain
 * texture, a troop badge per territory, and overlays for whatever the player is planning: attack
 * targets, move destinations, annexable neutrals, and arrows from every column of an assault.
 *
 * Pan with a drag, zoom with the wheel, a pinch or the buttons. A click that moved more than a
 * few pixels was a pan, not a selection.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { BUILDINGS, FACTION_COLORS, mapDefFor, type GameState, type Territory } from 'shared/sim';
import { computeMapGeometry } from '../map/regionGeometry';
import { MAP, UI } from '../theme';
import Icon from './Icon';

export interface MapMarks {
  attack: Set<number>;
  move: Set<number>;
  annex: Set<number>;
  /** Territories committing troops to the planned assault, and how many. */
  columns: Map<number, number>;
  /** Territories hit while the player was away. */
  hit: Set<number>;
}

export const NO_MARKS: MapMarks = { attack: new Set(), move: new Set(), annex: new Set(), columns: new Map(), hit: new Set() };

interface Props {
  state: GameState;
  visible: Set<number>;
  selected: number | null;
  target: number | null;
  marks: MapMarks;
  flash: Set<number>;
  onPick: (id: number | null) => void;
  onHover: (id: number | null, x: number, y: number) => void;
  /** Territory to keep in view on small screens. */
  focus?: number | null;
}

const MOVE_THRESHOLD = 5;

export default function MapView({ state, visible, selected, target, marks, flash, onPick, onHover, focus }: Props) {
  const def = mapDefFor(state.config.mapId);
  // Positions and edges never change during a game, so geometry is computed once per game.
  const geometry = useMemo(
    () => computeMapGeometry(state.nodes, state.edges, def.viewBox),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.id, state.nodes.length, def.viewBox],
  );

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const wrap = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef({ x: 0, y: 0 });
  const travelled = useRef(0);
  const pinch = useRef<number | null>(null);

  // Where a board point lands on screen at zoom 1 (the SVG letterboxes with "meet").
  const project = useCallback((px: number, py: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    const [vx, vy, vw, vh] = def.viewBox.split(' ').map(Number);
    if (!rect) return null;
    const s0 = Math.min(rect.width / vw, rect.height / vh);
    return { x: (rect.width - vw * s0) / 2 + (px - vx) * s0, y: (rect.height - vh * s0) / 2 + (py - vy) * s0, rect, fill: Math.max(rect.width / vw, rect.height / vh) / s0 };
  }, [def.viewBox]);

  /** Zoom so the board fills a tall, narrow screen, centred on the player's capital. */
  const fit = useCallback(() => {
    const cap = state.nodes.find(n => n.owner === state.activeFaction && n.capital) ?? state.nodes[0];
    const c = geometry.centroids.get(cap.id) ?? cap;
    const p = project(c.x, c.y);
    if (!p || p.fill < 1.25) { setView({ x: 0, y: 0, k: 1 }); return; }
    const k = Math.min(3, p.fill);
    const x = Math.min(0, Math.max(p.rect.width - p.rect.width * k, p.rect.width / 2 - p.x * k));
    const y = Math.min(0, Math.max(p.rect.height - p.rect.height * k, p.rect.height * 0.4 - p.y * k));
    setView({ x, y, k });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, geometry, state.id]);

  useEffect(() => { fit(); }, [fit]);

  // On a phone the bottom sheet covers the lower half: bring a picked territory into the top half.
  useEffect(() => {
    if (focus === null || focus === undefined || window.innerWidth > 720) return;
    const c = geometry.centroids.get(focus);
    if (!c) return;
    setView(v => {
      const p = project(c.x, c.y);
      if (!p) return v;
      const sy = p.y * v.k + v.y;
      if (sy > 60 && sy < p.rect.height * 0.32) return v;
      return { ...v, x: p.rect.width / 2 - p.x * v.k, y: p.rect.height * 0.2 - p.y * v.k };
    });
  }, [focus, geometry, project]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView(v => {
      const k = Math.min(5, Math.max(0.6, v.k * factor));
      const rect = wrap.current?.getBoundingClientRect();
      if (!rect) return { ...v, k };
      const mx = (cx ?? rect.left + rect.width / 2) - rect.left;
      const my = (cy ?? rect.top + rect.height / 2) - rect.top;
      return { x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k), k };
    });
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const down = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      last.current = { x: e.clientX, y: e.clientY };
      travelled.current = 0;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const moveP = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) zoomAt(d / pinch.current, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.current = d;
      travelled.current = 99;
      return;
    }
    const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y;
    travelled.current += Math.abs(dx) + Math.abs(dy);
    last.current = { x: e.clientX, y: e.clientY };
    if (travelled.current > MOVE_THRESHOLD) {
      if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      wrap.current?.classList.add('tm-grabbing');
      setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const up = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) wrap.current?.classList.remove('tm-grabbing');
  };

  const click = (id: number | null) => {
    if (travelled.current > MOVE_THRESHOLD) return;
    onPick(id);
  };

  const nodeAt = (id: number) => geometry.centroids.get(id) ?? { x: state.nodes[id].x, y: state.nodes[id].y, radius: 18 };

  return (
    <div
      ref={wrap} className="tm-mapwrap"
      onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up}
      onPointerLeave={() => onHover(null, 0, 0)}
      style={{ position: 'relative', flex: 1, overflow: 'hidden', background: `radial-gradient(ellipse at 50% 40%, ${MAP.sea}, ${MAP.seaDeep})` }}
    >
      <svg
        viewBox={def.viewBox} preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0', userSelect: 'none' }}
        onClick={() => click(null)}
      >
        <MapDefs />

        {/* Roads between territories whose regions do not touch */}
        {state.edges.map(([a, b]) => {
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          if (geometry.geometricEdgeSet.has(key)) return null;
          const ca = nodeAt(a), cb = nodeAt(b);
          return <line key={key} x1={ca.x} y1={ca.y} x2={cb.x} y2={cb.y} stroke="#8a8170" strokeWidth={1.6} strokeDasharray="5 4" opacity={0.7} />;
        })}

        {state.nodes.map(n => (
          <Region
            key={n.id} n={n} path={geometry.cellPaths.get(n.id) ?? ''} c={nodeAt(n.id)}
            seen={visible.has(n.id)} sel={selected === n.id} tgt={target === n.id}
            attack={marks.attack.has(n.id)} move={marks.move.has(n.id)} annex={marks.annex.has(n.id)}
            column={marks.columns.get(n.id)} hit={marks.hit.has(n.id)} flash={flash.has(n.id)}
            onClick={click} onHover={onHover}
          />
        ))}

        {/* Assault arrows from every committed column into the target */}
        {target !== null && [...marks.columns.entries()].map(([from, n]) => {
          const a = nodeAt(from), b = nodeAt(target);
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const x1 = a.x + ux * 14, y1 = a.y + uy * 14, x2 = b.x - ux * 16, y2 = b.y - uy * 16;
          return (
            <g key={from} style={{ pointerEvents: 'none' }}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={UI.attack} strokeWidth={3} markerEnd="url(#tm-arrow)" opacity={0.95} />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} textAnchor="middle" fontSize={10} fontWeight={800} fill="#fff" stroke={MAP.labelHalo} strokeWidth={3} paintOrder="stroke">{n}</text>
            </g>
          );
        })}
      </svg>

      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }} className="tm-zoom">
        {([['plus', () => zoomAt(1.25), 'Zoom in'], ['reset', fit, 'Reset view'], ['minus', () => zoomAt(0.8), 'Zoom out']] as const).map(([icon, fn, label]) => (
          <button key={icon} type="button" onClick={fn} aria-label={label} title={label}
            style={{ width: 32, height: 32, borderRadius: 7, background: MAP.control, border: `1px solid ${UI.ruleStrong}`, color: UI.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}

function MapDefs() {
  const t = MAP.terrain;
  return (
    <defs>
      <pattern id="tm-plains" width="18" height="18" patternUnits="userSpaceOnUse">
        <rect width="18" height="18" fill={t.plains} />
        <circle cx="4" cy="5" r="0.8" fill="#fff" opacity="0.07" /><circle cx="13" cy="12" r="0.8" fill="#000" opacity="0.1" />
      </pattern>
      <pattern id="tm-forest" width="12" height="12" patternUnits="userSpaceOnUse">
        <rect width="12" height="12" fill={t.forest} />
        <path d="M3 9 6 3l3 6z" fill="#000" opacity="0.16" />
      </pattern>
      <pattern id="tm-mountain" width="18" height="12" patternUnits="userSpaceOnUse">
        <rect width="18" height="12" fill={t.mountain} />
        <path d="M0 12 5 3l5 9M9 12l5-8 4 8" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1" />
      </pattern>
      <pattern id="tm-coast" width="20" height="10" patternUnits="userSpaceOnUse">
        <rect width="20" height="10" fill={t.coast} />
        <path d="M0 6q5-4 10 0t10 0" fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="1.2" />
      </pattern>
      <pattern id="tm-desert" width="14" height="14" patternUnits="userSpaceOnUse">
        <rect width="14" height="14" fill={t.desert} />
        <circle cx="3" cy="3" r="0.9" fill="#fff" opacity="0.12" /><circle cx="10" cy="9" r="0.9" fill="#000" opacity="0.12" />
      </pattern>
      <pattern id="tm-fog" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" fill={MAP.fog} />
        <line x1="0" y1="0" x2="0" y2="8" stroke={MAP.fogEdge} strokeWidth="2" />
      </pattern>
      <marker id="tm-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0 0 10 5 0 10z" fill={UI.attack} />
      </marker>
    </defs>
  );
}

interface RegionProps {
  n: Territory;
  path: string;
  c: { x: number; y: number; radius: number };
  seen: boolean;
  sel: boolean;
  tgt: boolean;
  attack: boolean;
  move: boolean;
  annex: boolean;
  column?: number;
  hit: boolean;
  flash: boolean;
  onClick: (id: number) => void;
  onHover: (id: number | null, x: number, y: number) => void;
}

const Region = memo(function Region({ n, path, c, seen, sel, tgt, attack, move, annex, column, hit, flash, onClick, onHover }: RegionProps) {
  const fc = FACTION_COLORS[n.owner] ?? FACTION_COLORS[0];
  const neutral = n.owner === 0;
  const terrain = n.terrain ?? 'plains';
  const r = 10.5;
  const ring = tgt ? (move ? UI.move : annex ? UI.annex : UI.attack) : null;
  const plan = !tgt && (attack ? UI.attack : move ? UI.move : annex ? UI.annex : null);

  return (
    <g
      data-territory-id={n.id}
      onClick={e => { e.stopPropagation(); onClick(n.id); }}
      onMouseMove={e => onHover(n.id, e.clientX, e.clientY)}
      style={{ cursor: 'pointer' }}
      role="button" aria-label={`${n.name}${seen ? `, ${n.troops} troops` : ''}`}
    >
      <path d={path} fill={seen ? `url(#tm-${terrain})` : 'url(#tm-fog)'} />
      <path d={path} fill={fc.fill} opacity={neutral ? 0.12 : seen ? 0.5 : 0.28} />
      {flash && <path d={path} fill={fc.edge} style={{ animation: 'tm-flash 1.1s ease-out forwards', pointerEvents: 'none' }} />}
      <path d={path} fill="none" stroke={neutral ? MAP.neutralEdge : fc.edge} strokeWidth={neutral ? 1 : 1.6} strokeOpacity={neutral ? 1 : 0.85} />
      {plan && <path d={path} fill={plan} fillOpacity={0.12} stroke={plan} strokeWidth={2} strokeDasharray="6 4" style={{ animation: 'tm-ants 0.9s linear infinite' }} />}
      {ring && <path d={path} fill={ring} fillOpacity={0.18} stroke={ring} strokeWidth={3} />}
      {sel && <path d={path} fill="#fff" fillOpacity={0.08} stroke="#fff" strokeWidth={2.6} />}
      {column !== undefined && !sel && <path d={path} fill="none" stroke={UI.attack} strokeWidth={2} strokeOpacity={0.8} />}

      {/* Troop badge */}
      <circle cx={c.x} cy={c.y} r={r} fill={neutral ? MAP.neutralFill : fc.fill} stroke={n.capital ? UI.accent : neutral ? MAP.neutralRing : fc.edge} strokeWidth={n.capital ? 2.2 : 1.4} />
      <text x={c.x} y={c.y + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={seen ? (n.troops > 99 ? 8 : n.troops > 9 ? 10 : 11.5) : 11} fontWeight={800} fill={seen ? '#fff' : '#8b939c'} style={{ pointerEvents: 'none' }}>
        {seen ? n.troops : '?'}
      </text>
      {hit && <circle cx={c.x} cy={c.y} r={r + 4} fill="none" stroke={UI.bad} strokeWidth={2} style={{ animation: 'tm-pulse 1.4s ease-in-out infinite', pointerEvents: 'none' }} />}

      {/* Capital crown and stronghold star above the badge */}
      {n.capital && (
        <path transform={`translate(${c.x - 6} ${c.y - r - 11}) scale(0.75)`} d="M2.5 12h11L12.5 5 10 7.5 8 3.5 6 7.5 3.5 5z" fill={UI.accent} stroke={MAP.labelHalo} strokeWidth={1} style={{ pointerEvents: 'none' }} />
      )}
      {n.stronghold && (
        <path transform={`translate(${c.x + (n.capital ? 4 : -6)} ${c.y - r - 11}) scale(0.75)`} d="M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z" fill="#f0b64f" stroke={MAP.labelHalo} strokeWidth={1} style={{ pointerEvents: 'none' }} />
      )}

      {/* Name, level and building pips under the badge */}
      <text x={c.x} y={c.y + r + 10} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={MAP.label} stroke={MAP.labelHalo} strokeWidth={2.6} paintOrder="stroke" style={{ pointerEvents: 'none' }}>
        {n.name}{seen && n.lv > 1 ? ` ${ROMAN[n.lv]}` : ''}
      </text>
      {seen && n.buildings.length > 0 && (
        <g style={{ pointerEvents: 'none' }}>
          {n.buildings.map((b, i) => {
            const w = n.buildings.length * 6 - 2;
            return <rect key={i} x={c.x - w / 2 + i * 6} y={c.y + r + 14} width={4} height={4} rx={1} fill={PIP[BUILDINGS[b].family]} stroke={MAP.labelHalo} strokeWidth={0.6} />;
          })}
        </g>
      )}
    </g>
  );
});

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export const PIP: Record<string, string> = {
  farm: UI.food,
  mine: UI.mat,
  barracks: '#7fa7d9',
  market: UI.gold,
  tower: '#c98e8e',
};
