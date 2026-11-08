/**
 * The board. Organic Voronoi regions (map/regionGeometry.ts) tinted by owner over a terrain
 * texture, a troop badge per territory, and overlays for whatever the player is planning: attack
 * targets, move destinations, annexable neutrals, and arrows from every column of an assault.
 *
 * The board fills the screen; panels float over it and report how much they cover (`inset`).
 * Pan with a drag, zoom with the wheel, a pinch, the buttons or the + and - keys (0 fits the
 * map). A click that moved more than a few pixels was a pan, not a selection.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
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

/**
 * Short-lived effects on the board (presentation only, see game/replay.ts): a pop on a territory
 * just taken, a shake on one just lost or held, and floating numbers for the troops each side lost.
 * Bump `key` to replay the same effect on the same territory.
 */
export type FxKind = 'pop' | 'shake' | 'hit';
export interface MapFx {
  key: number;
  nodes: Map<number, FxKind>;
  floats: Array<{ node: number; text: string; tone: 'bad' | 'good' | 'plain'; dx?: number }>;
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
  /** Territory to keep in view: brought out from under the panel when it is picked. */
  focus?: number | null;
  /**
   * Screen space covered by panels floating over the board (the side panel on a wide screen,
   * the sheet's handle on a phone). The fit and the focus pan both work in what is left.
   */
  inset?: { right: number; bottom: number };
  /** Effects for the current beat of a replay, or the battle just fought. */
  fx?: MapFx | null;
  /**
   * Drawn over the board, outside the pan and zoom (the AI replay banner), and laid out in the
   * part of the board the inset leaves uncovered so it centres on what can be seen.
   */
  overlay?: ReactNode;
}

const MOVE_THRESHOLD = 5;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 6;

type View = { x: number; y: number; k: number };

export default function MapView({ state, visible, selected, target, marks, flash, onPick, onHover, focus, inset, fx, overlay }: Props) {
  const def = mapDefFor(state.config.mapId);
  // Positions and edges never change during a game, so geometry is computed once per game.
  const geometry = useMemo(
    () => computeMapGeometry(state.nodes, state.edges, def.viewBox),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.id, state.nodes.length, def.viewBox],
  );
  const box = geometry.bounds;
  const insetRight = inset?.right ?? 0;
  const insetBottom = inset?.bottom ?? 0;

  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  /** Off while a finger or the mouse is dragging, so the board tracks it without lag. */
  const [glide, setGlide] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef({ x: 0, y: 0 });
  const travelled = useRef(0);
  const pinch = useRef<number | null>(null);

  // Where a board point lands on screen at zoom 1 (the SVG letterboxes with "meet"), plus the
  // on-screen box the whole board occupies at zoom 1.
  const project = useCallback((px: number, py: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    const s0 = Math.min(rect.width / box.w, rect.height / box.h);
    const ox = (rect.width - box.w * s0) / 2, oy = (rect.height - box.h * s0) / 2;
    return { x: ox + (px - box.x) * s0, y: oy + (py - box.y) * s0, rect, s0, ox, oy };
  }, [box]);

  /**
   * Keep the land on screen whatever the player does. Along an axis where the board is smaller
   * than the view it can sit anywhere inside it; where it is larger it can be dragged until its
   * edge shows a narrow band of sea, and no further. Without this one flick loses the map.
   */
  const clamp = useCallback((v: View): View => {
    const p = project(box.x, box.y);
    if (!p) return v;
    const axis = (pos: number, origin: number, size: number, span: number) => {
      const lead = origin * v.k, len = size * v.k;
      const slack = Math.min(90, span * 0.18);
      const lo = len <= span ? -lead - slack : span - slack - lead - len;
      const hi = len <= span ? span - lead - len + slack : slack - lead;
      return Math.min(hi, Math.max(lo, pos));
    };
    return {
      x: axis(v.x, p.ox, box.w * p.s0, p.rect.width - insetRight),
      y: axis(v.y, p.oy, box.h * p.s0, p.rect.height - insetBottom),
      k: v.k,
    };
  }, [project, box, insetRight, insetBottom]);

  /**
   * Fit the whole land into the space the panels leave. Where that would make the board too
   * small to read (a tall, narrow phone against a wide map) zoom in on the player's capital
   * instead, filling the height, and let them pan out from there.
   */
  const fit = useCallback(() => {
    const p0 = project(box.x, box.y);
    if (!p0) return;
    const w = p0.rect.width - insetRight, h = p0.rect.height - insetBottom;
    if (w < 40 || h < 40) return;
    const bw = box.w * p0.s0, bh = box.h * p0.s0; // board size on screen at zoom 1
    const kFit = Math.min(w / bw, h / bh);
    // Readable means a territory badge about 18px across or more: below that, go to the capital.
    const badge = 21 * p0.s0 * kFit;
    if (badge >= 15) {
      const x = w / 2 - (p0.ox + bw / 2) * kFit;
      const y = h / 2 - (p0.oy + bh / 2) * kFit;
      setView(clamp({ x, y, k: kFit }));
      return;
    }
    const cap = state.nodes.find(n => n.owner === state.activeFaction && n.capital) ?? state.nodes[0];
    const c = geometry.centroids.get(cap.id) ?? cap;
    const p = project(c.x, c.y);
    if (!p) return;
    const k = Math.min(MAX_ZOOM, Math.max(kFit, h / bh, 18 / (21 * p0.s0)));
    setView(clamp({ x: w / 2 - p.x * k, y: h * 0.45 - p.y * k, k }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, clamp, geometry, box, insetRight, insetBottom, state.id]);

  // Fit once the board has a size, and again whenever the window is resized.
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current) { fitted.current = true; fit(); }
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fit]);

  // A picked territory under a panel, or off the edge, is brought into the open part of the board.
  useEffect(() => {
    if (focus === null || focus === undefined) return;
    const c = geometry.centroids.get(focus);
    if (!c) return;
    setView(v => {
      const p = project(c.x, c.y);
      if (!p) return v;
      const w = p.rect.width - insetRight, h = p.rect.height - insetBottom;
      const sx = p.x * v.k + v.x, sy = p.y * v.k + v.y;
      const margin = 70;
      if (sx > margin && sx < w - margin && sy > margin && sy < h - margin) return v;
      return clamp({ ...v, x: w / 2 - p.x * v.k, y: h / 2 - p.y * v.k });
    });
  }, [focus, geometry, project, clamp, insetRight, insetBottom]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView(v => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      const rect = wrap.current?.getBoundingClientRect();
      if (!rect) return { ...v, k };
      const mx = cx !== undefined ? cx - rect.left : (rect.width - insetRight) / 2;
      const my = cy !== undefined ? cy - rect.top : (rect.height - insetBottom) / 2;
      return clamp({ x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k), k });
    });
  }, [clamp, insetRight, insetBottom]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpads send many small deltas, a mouse wheel a few large ones: scale by the delta.
      const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.0035);
      zoomAt(factor, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Keyboard zoom: + and - (and =, which is + without shift), 0 to fit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') zoomAt(1.25);
      else if (e.key === '-' || e.key === '_') zoomAt(0.8);
      else if (e.key === '0') fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomAt, fit]);

  const down = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      last.current = { x: e.clientX, y: e.clientY };
      travelled.current = 0;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
      setGlide(false);
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
      setGlide(false);
      setView(v => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const up = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) { wrap.current?.classList.remove('tm-grabbing'); setGlide(true); }
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
        viewBox={geometry.viewBox} preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0', userSelect: 'none', transition: glide ? 'transform 0.18s ease-out' : 'none', willChange: 'transform' }}
        onClick={() => click(null)}
      >
        <MapDefs />

        {/* Shallows: a pale band round every coast, drawn under the land, so the sea reads as
            wrapping the continent rather than the land being cut off at a frame. */}
        <g style={{ pointerEvents: 'none' }}>
          {state.nodes.map(n => (
            <path key={`s${n.id}`} d={geometry.cellPaths.get(n.id) ?? ''} fill={MAP.shallow} stroke={MAP.shallow} strokeWidth={30} strokeLinejoin="round" />
          ))}
          {state.nodes.map(n => (
            <path key={`c${n.id}`} d={geometry.cellPaths.get(n.id) ?? ''} fill={MAP.coast} stroke={MAP.coast} strokeWidth={11} strokeLinejoin="round" opacity={0.55} />
          ))}
          {/* Land under the territories, a little proud of them, so the corners each region rounds
              off where three meet are filled with land rather than showing the coast through. */}
          {state.nodes.map(n => (
            <path key={`l${n.id}`} d={geometry.cellPaths.get(n.id) ?? ''} fill={MAP.land} stroke={MAP.land} strokeWidth={8} strokeLinejoin="round" />
          ))}
        </g>

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
            fx={fx?.nodes.get(n.id)} fxKey={fx?.nodes.has(n.id) ? fx.key : undefined}
            onClick={click} onHover={onHover}
          />
        ))}

        {/* Floating troop losses over the territories in the current effect */}
        {fx && fx.floats.map((f, i) => {
          const c = nodeAt(f.node);
          return (
            <text
              key={`${fx.key}-${i}`} className="tm-anim-float"
              x={c.x + (f.dx ?? 0)} y={c.y - 16} textAnchor="middle" fontSize={11} fontWeight={800}
              fill={f.tone === 'bad' ? UI.bad : f.tone === 'good' ? UI.good : MAP.label}
              stroke={MAP.labelHalo} strokeWidth={3} paintOrder="stroke"
              style={{ pointerEvents: 'none', transformBox: 'fill-box' }}
            >
              {f.text}
            </text>
          );
        })}

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

      {overlay && (
        <div style={{ position: 'absolute', left: 0, top: 0, right: insetRight, bottom: insetBottom, pointerEvents: 'none', transition: 'right 0.25s ease' }}>
          {overlay}
        </div>
      )}

      <div style={{ position: 'absolute', right: 10 + insetRight, bottom: 10 + insetBottom, display: 'flex', flexDirection: 'column', gap: 6, transition: 'right 0.25s ease' }} className="tm-zoom">
        {([['plus', () => zoomAt(1.4), 'Zoom in (+)'], ['reset', fit, 'Fit the map (0)'], ['minus', () => zoomAt(0.7), 'Zoom out (-)']] as const).map(([icon, fn, label]) => (
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
  fx?: FxKind;
  fxKey?: number;
  onClick: (id: number) => void;
  onHover: (id: number | null, x: number, y: number) => void;
}

const Region = memo(function Region({ n, path, c, seen, sel, tgt, attack, move, annex, column, hit, flash, fx, fxKey, onClick, onHover }: RegionProps) {
  const fc = FACTION_COLORS[n.owner] ?? FACTION_COLORS[0];
  const neutral = n.owner === 0;
  const terrain = n.terrain ?? 'plains';
  const r = 10.5;
  const ring = tgt ? (move ? UI.move : annex ? UI.annex : UI.attack) : null;
  const plan = !tgt && (attack ? UI.attack : move ? UI.move : annex ? UI.annex : null);

  return (
    <g
      data-territory-id={n.id}
      // Spotlight target for the guided turn. On the `<g>` so the ring encloses the label and the
      // troop count as well as the shape, which is what the player is being pointed at.
      id={`tm-territory-${n.id}`}
      onClick={e => { e.stopPropagation(); onClick(n.id); }}
      onMouseMove={e => onHover(n.id, e.clientX, e.clientY)}
      style={{ cursor: 'pointer' }}
      role="button" aria-label={`${n.name}${seen ? `, ${n.troops} troops` : ''}`}
    >
      <path d={path} fill={seen ? `url(#tm-${terrain})` : 'url(#tm-fog)'} />
      <path d={path} fill={fc.fill} opacity={neutral ? 0.12 : seen ? 0.5 : 0.28} />
      {flash && <path d={path} fill={fc.edge} style={{ animation: 'tm-flash 1.1s ease-out forwards', pointerEvents: 'none' }} />}
      {fx && <path key={`fx-${fxKey}`} d={path} fill={fx === 'hit' ? UI.bad : fc.edge} style={{ animation: 'tm-flash calc(900ms * var(--tm-motion)) ease-out forwards', opacity: 0, pointerEvents: 'none' }} />}
      <path d={path} fill="none" stroke={neutral ? MAP.neutralEdge : fc.edge} strokeWidth={neutral ? 1 : 1.6} strokeOpacity={neutral ? 1 : 0.85} />
      {plan && <path d={path} fill={plan} fillOpacity={0.12} stroke={plan} strokeWidth={2} strokeDasharray="6 4" style={{ animation: 'tm-ants 0.9s linear infinite' }} />}
      {ring && <path d={path} fill={ring} fillOpacity={0.18} stroke={ring} strokeWidth={3} />}
      {sel && <path d={path} fill="#fff" fillOpacity={0.08} stroke="#fff" strokeWidth={2.6} />}
      {column !== undefined && !sel && <path d={path} fill="none" stroke={UI.attack} strokeWidth={2} strokeOpacity={0.8} />}

      {/* Troop badge (wrapped so a replay can pop or shake it) */}
      <g key={fx ? `badge-${fxKey}` : 'badge'} className={fx === 'pop' ? 'tm-anim-pop' : fx ? 'tm-anim-shake' : undefined} style={fx ? BADGE_FX : undefined}>
        <circle cx={c.x} cy={c.y} r={r} fill={neutral ? MAP.neutralFill : fc.fill} stroke={n.capital ? UI.accent : neutral ? MAP.neutralRing : fc.edge} strokeWidth={n.capital ? 2.2 : 1.4} />
        <text x={c.x} y={c.y + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={seen ? (n.troops > 99 ? 8 : n.troops > 9 ? 10 : 11.5) : 11} fontWeight={800} fill={seen ? '#fff' : '#8b939c'} style={{ pointerEvents: 'none' }}>
          {seen ? n.troops : '?'}
        </text>
      </g>
      {fx === 'hit' && <circle key={`ring-${fxKey}`} cx={c.x} cy={c.y} r={r + 4} fill="none" stroke={UI.bad} strokeWidth={2.4} style={{ animation: 'tm-flash calc(900ms * var(--tm-motion)) ease-out forwards', opacity: 0, pointerEvents: 'none' }} />}
      {hit && <circle cx={c.x} cy={c.y} r={r + 4} fill="none" stroke={UI.bad} strokeWidth={2} style={{ animation: 'tm-hit-pulse 1.4s ease-in-out infinite', pointerEvents: 'none' }} />}

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

/** SVG transforms default to the canvas origin: scale and shake the badge about its own centre. */
const BADGE_FX = { transformBox: 'fill-box', transformOrigin: 'center' } as const;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export const PIP: Record<string, string> = {
  farm: UI.food,
  mine: UI.mat,
  barracks: '#7fa7d9',
  market: UI.gold,
  tower: '#c98e8e',
};
