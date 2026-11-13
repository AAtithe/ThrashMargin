import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHART, FONT } from '../theme';
import { sourcesFor, LEGS, PORTS, PORT_BY_ID, planRoute } from '../sim/content';
import {
  CHART as BACKDROP,
  PORT_POINTS,
  VB_HEIGHT,
  VB_WIDTH,
  WORLD_COPIES,
  unwrapRun,
  wrapDx,
  wrapPanX,
} from '../sim/geography';
import { destinationOf } from '../sim/movement';
import { planFastestRoute, stormRating, windFor, type Season } from '../sim/weather';
import { easeInOut, paced, usePace, useSkipOnInput, useTween } from '../lib/motion';
import { piracyRating } from '../sim/hazards';
import { RENOWN_FAMOUS, RENOWN_SMART } from '../sim/rules';
import type { Captain, Contract, PortId, Ship } from '../sim/types';

interface MapViewProps {
  ships: Ship[];
  captains: Captain[];
  contracts: Contract[];
  selectedShipId: string | null;
  onPortClick: (portId: PortId) => void;
  plannedRoute: PortId[] | null;
  /** Null when this game is played without weather — then no wind is drawn at all. */
  season: Season | null;
  showPiracy: boolean;
  /** Whose ships are "mine" — everyone else's get their captain's name on the chart. */
  viewerId: string | null;
  /** The Great Tea Race, when one is running: its ports are marked and its runners fly a pennant. */
  race?: { ports: PortId[]; finish: PortId; runners: Set<string> } | null;
  /** Ports the viewer carries Admiralty dispatches for, marked with a pennant. */
  errandPorts?: PortId[];
  /**
   * A port to keep in view: the one just clicked, or where the selected ship lies. When it changes
   * and is hidden under a panel or off the edge, the chart pans to it.
   */
  focusPort?: PortId | null;
  /** Screen pixels covered by panels floating over the chart, so fitting and panning avoid them. */
  inset?: { left: number; right: number; bottom: number };
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 7;
const DRAG_THRESHOLD = 5;
/**
 * The smallest a port name may appear on screen, in pixels. Labels are authored at 13 chart units,
 * which is plenty on a big monitor and unreadable on a phone or a short laptop, where the chart is
 * drawn at well under one pixel per unit. Below this they are lifted; zoomed in they grow normally.
 */
const MIN_LABEL_PX = 12;

const LABEL_OFFSET: Record<string, [number, number]> = {
  n: [0, -14],
  s: [0, 20],
  e: [12, 5],
  w: [-12, 5],
};
type Anchor = 'start' | 'middle' | 'end';
const LABEL_ANCHOR: Record<string, Anchor> = { n: 'middle', s: 'middle', e: 'start', w: 'end' };

/** Vertical pan is clamped so the sheet's top and bottom edges never scroll into view. */
const clampPanY = (panY: number, zoom: number) =>
  Math.min(0, Math.max(VB_HEIGHT * (1 - zoom), panY));

export default function MapView({
  ships,
  captains,
  contracts,
  selectedShipId,
  onPortClick,
  plannedRoute,
  season,
  showPiracy,
  viewerId,
  race = null,
  errandPorts = [],
  focusPort = null,
  inset,
}: MapViewProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [hoveredPort, setHoveredPort] = useState<PortId | null>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * The chart fills its pane. Its height always shows the whole sheet from pole to pole; its width
   * shows as much of the world as the pane has room for, so a wide screen sees past the date line
   * into the repeated copy beyond it and a phone sees an ocean at a time and pans round. `scale` is
   * screen pixels per chart unit at zoom 1, and `vbWidth` the chart units across.
   */
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize(prev => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = size.h > 0 ? size.h / VB_HEIGHT : 0;
  const vbWidth = scale > 0 ? size.w / scale : VB_WIDTH;
  const insetL = scale > 0 ? (inset?.left ?? 0) / scale : 0;
  const insetR = scale > 0 ? (inset?.right ?? 0) / scale : 0;
  const insetB = scale > 0 ? (inset?.bottom ?? 0) / scale : 0;
  /** How much to enlarge marks and names so they never drop below a readable size on screen. */
  const lift = scale > 0 ? Math.max(1, MIN_LABEL_PX / (13 * scale * view.zoom)) : 1;

  const colourOf = useMemo(
    () => Object.fromEntries(captains.map(c => [c.id, c.colour])),
    [captains],
  );
  const nameOf = useMemo(
    () => Object.fromEntries(captains.map(c => [c.id, c.name.replace('Capt. ', '')])),
    [captains],
  );

  const contractPorts = useMemo(() => {
    const set = new Set<PortId>();
    for (const c of contracts) {
      if (c.fills.length >= 2) continue;
      set.add(c.destination);
      // Cards name no source, so every port stocking the good is on the race — which is rather the
      // point of dropping the source, and the chart should show it.
      for (const seller of sourcesFor(c.good, c.destination)) set.add(seller);
    }
    return set;
  }, [contracts]);

  /** Pan so a chart point sits mid-way across the part of the pane no panel covers. */
  const centreOn = (x: number, y: number | null, zoom: number) => {
    const midX = (insetL + vbWidth - insetR) / 2;
    const midY = (VB_HEIGHT - insetB) / 2;
    return {
      zoom,
      panX: wrapPanX(midX - x * zoom, zoom),
      panY: y === null ? clampPanY(0, zoom) : clampPanY(midY - y * zoom, zoom),
    };
  };

  /** Back to the whole sheet's height, centred on the port in focus (the player's own waters). */
  const fit = () => {
    const p = focusPort ? PORT_POINTS[focusPort] : null;
    setView(centreOn(p ? p.x : VB_WIDTH / 2, null, 1));
  };

  // Fit once the pane has a size. Not again on resize: that would throw away the player's view.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || scale <= 0) return;
    fitted.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // A port newly in focus that is hidden under a panel or off the pane is brought into the open.
  useEffect(() => {
    if (!focusPort || scale <= 0) return;
    const p = PORT_POINTS[focusPort];
    if (!p) return;
    setView(prev => {
      // The port is drawn in every copy of the world; measure the copy nearest the middle.
      const mid = (insetL + vbWidth - insetR) / 2;
      let sx = prev.panX + p.x * prev.zoom;
      const span = VB_WIDTH * prev.zoom;
      while (sx - mid > span / 2) sx -= span;
      while (mid - sx > span / 2) sx += span;
      const sy = prev.panY + p.y * prev.zoom;
      const margin = 50 / scale;
      if (sx > insetL + margin && sx < vbWidth - insetR - margin && sy > margin && sy < VB_HEIGHT - insetB - margin) return prev;
      return centreOn(p.x, p.y, prev.zoom);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPort]);

  /** Zoom about a point given in chart units across the pane (the pane's middle when omitted). */
  const zoomAt = (factor: number, vbX?: number, vbY?: number) =>
    setView(prev => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
      const cx = vbX ?? (insetL + vbWidth - insetR) / 2;
      const cy = vbY ?? (VB_HEIGHT - insetB) / 2;
      const panX = cx - ((cx - prev.panX) / prev.zoom) * zoom;
      const panY = cy - ((cy - prev.panY) / prev.zoom) * zoom;
      return { zoom, panX: wrapPanX(panX, zoom), panY: clampPanY(panY, zoom) };
    });
  const zoomBy = (factor: number) => zoomAt(factor);

  // Kept in a ref so the native listeners below, attached once, always see the current geometry.
  const live = useRef({ scale, zoomAt });
  live.current = { scale, zoomAt };

  // Scroll-to-zoom needs a real native listener: React registers `wheel` passively and silently
  // ignores preventDefault() inside a JSX onWheel handler.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { scale: sc, zoomAt: z } = live.current;
      // A momentarily zero-sized pane (it happens behind a modal) would make this NaN, and once NaN
      // is in the view state nothing recovers it.
      if (!Number.isFinite(sc) || sc <= 0) return;
      const rect = el.getBoundingClientRect();
      // Trackpads send many small deltas, a mouse wheel a few large ones: scale by the delta.
      const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.0035);
      z(factor, (e.clientX - rect.left) / sc, (e.clientY - rect.top) / sc);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keyboard: + and - zoom, 0 fits. Ignored while typing in a field.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') live.current.zoomAt(1.3);
      else if (e.key === '-' || e.key === '_') live.current.zoomAt(1 / 1.3);
      else if (e.key === '0') fitRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Drag to pan, pinch to zoom. The pane only captures the pointer once it has moved past a few
   * pixels, so a tap on a port still reaches the port; a click that ends a drag is swallowed so
   * letting go over a port does not also lay a course to it.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const travelled = useRef(0);
  const pinch = useRef<number | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) travelled.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prevPt = pointers.current.get(e.pointerId);
    if (!prevPt || scale <= 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = wrapRef.current?.getBoundingClientRect();
      if (pinch.current && rect) zoomAt(d / pinch.current, ((a.x + b.x) / 2 - rect.left) / scale, ((a.y + b.y) / 2 - rect.top) / scale);
      pinch.current = d;
      travelled.current = 99;
      return;
    }
    const dx = e.clientX - prevPt.x, dy = e.clientY - prevPt.y;
    travelled.current += Math.abs(dx) + Math.abs(dy);
    if (travelled.current <= DRAG_THRESHOLD) return;
    if (!wrapRef.current?.hasPointerCapture(e.pointerId)) wrapRef.current?.setPointerCapture(e.pointerId);
    if (!dragging) setDragging(true);
    setView(prev => ({
      zoom: prev.zoom,
      panX: wrapPanX(prev.panX + dx / scale, prev.zoom),
      panY: clampPanY(prev.panY + dy / scale, prev.zoom),
    }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  /** The copies of the world the pane can currently see, as offsets in chart units. */
  const copies = (() => {
    const start = -view.panX / view.zoom;
    const end = start + vbWidth / view.zoom;
    const out: number[] = [];
    for (let k = Math.floor(start / VB_WIDTH) - 1; k <= Math.floor(end / VB_WIDTH); k++) out.push(k * VB_WIDTH);
    return out;
  })();

  /**
   * Every leg, already unwrapped so Pacific crossings run the short way off the edge, and carrying
   * this season's wind.
   *
   * The wind mark is the point of this: a chevron at the leg's midpoint pointing the way the wind
   * is fair, so the chart answers "which way round is fast this season" at a glance rather than
   * making the player discover it by sailing. Legs with no fair direction get no chevron.
   */
  const drawnLegs = useMemo(
    () =>
      LEGS.map(leg => {
        const a = PORT_POINTS[leg.a];
        const b = PORT_POINTS[leg.b];
        const dx = wrapDx(a.x, b.x);

        // Ask both directions; the fair one, if either is, decides where the chevron points.
        const forward = season ? windFor(leg.a, leg.b, season) : null;
        const back = season ? windFor(leg.b, leg.a, season) : null;
        let fairWay: 'forward' | 'back' | null = null;
        let strength = 0;
        let label = '';
        if (forward && back) {
          if (forward.modifier > 0 && forward.modifier >= back.modifier) {
            fairWay = 'forward';
            strength = forward.modifier;
            label = forward.label;
          } else if (back.modifier > 0) {
            fairWay = 'back';
            strength = back.modifier;
            label = back.label;
          } else {
            // Neither way is fair — the doldrums and the horse latitudes.
            label = forward.label;
          }
        }

        return {
          key: `${leg.a}-${leg.b}`,
          x1: a.x,
          y1: a.y,
          x2: a.x + dx,
          y2: b.y,
          distance: leg.distance,
          /** True for the four Pacific legs — drawn twice so both edges of the seam are covered. */
          wraps: Math.abs(dx) !== Math.abs(b.x - a.x),
          fairWay,
          strength,
          windLabel: label,
          becalmed: Boolean(forward && back && forward.modifier < 0 && back.modifier < 0),
          piracy: showPiracy ? piracyRating(leg.a, leg.b) : 0,
          storm: season ? stormRating(leg.a, leg.b, season) : 0,
        };
      }),
    [season, showPiracy],
  );

  const routePath = useMemo(() => {
    if (!plannedRoute || plannedRoute.length < 2) return null;
    const pts = unwrapRun(plannedRoute.map(id => PORT_POINTS[id]).filter(Boolean));
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
  }, [plannedRoute]);

  /** One full copy of the world's in-map content, offset east or west. */
  const worldCopy = (offset: number) => (
    <g key={offset} transform={`translate(${offset} 0)`}>
      {/* A faint engraved swell, so the sea reads as water rather than a flat fill. */}
      <rect x={0} y={0} width={VB_WIDTH} height={VB_HEIGHT} fill="url(#tr-swell)" pointerEvents="none" />
      {BACKDROP.graticule.map((d, i) => (
        <path key={`g${i}`} d={d} stroke={CHART.graticule} strokeWidth={0.7} fill="none" />
      ))}
      <path d={BACKDROP.equator} stroke={CHART.equator} strokeWidth={1.1} fill="none" strokeDasharray="10 6" />

      {BACKDROP.land.map((d, i) => (
        <path key={`l${i}`} d={d} fill={CHART.land} stroke={CHART.coast} strokeWidth={1.1} strokeLinejoin="round" />
      ))}

      {drawnLegs.map(leg =>
        // A wrapping leg is drawn from each end, so whichever edge the viewport is looking at has
        // the line running off it.
        (leg.wraps ? [0, leg.x2 > leg.x1 ? -VB_WIDTH : VB_WIDTH] : [0]).map(shift => (
          <g key={`${leg.key}:${shift}`} transform={shift ? `translate(${shift} 0)` : undefined}>
            <line
              x1={leg.x1}
              y1={leg.y1}
              x2={leg.x2}
              y2={leg.y2}
              stroke={leg.piracy > 0 ? CHART.piracy : CHART.route}
              strokeWidth={leg.piracy > 0 ? 1.6 : 1.3}
              strokeDasharray={leg.piracy > 0 ? '2 4' : '5 5'}
              opacity={leg.piracy > 0 ? 0.85 : 0.75}
            />
            <text
              x={(leg.x1 + leg.x2) / 2}
              y={(leg.y1 + leg.y2) / 2 - 6}
              fill={CHART.distance}
              fontFamily={FONT.data}
              fontSize={9 * Math.min(lift, 1.3)}
              textAnchor="middle"
              dominantBaseline="middle"
              pointerEvents="none"
            >
              {leg.distance}
            </text>
            <WindMark leg={leg} lift={lift} />
            {/* This season's worst weather, a third of the way along; the worst pirate waters two
                thirds along, clear of the wind chevron and the distance at the midpoint. */}
            {leg.storm >= 3 && (
              <StormCloud x={leg.x1 + (leg.x2 - leg.x1) / 3} y={leg.y1 + (leg.y2 - leg.y1) / 3} severe={leg.storm >= 4} lift={lift} />
            )}
            {leg.piracy >= 2 && (
              <BlackFlag x={leg.x1 + ((leg.x2 - leg.x1) * 2) / 3} y={leg.y1 + ((leg.y2 - leg.y1) * 2) / 3} lift={lift} />
            )}
            {leg.piracy > 0 && (
              <text
                x={(leg.x1 + leg.x2) / 2}
                y={(leg.y1 + leg.y2) / 2 + 12}
                fill={CHART.piracy}
                fontFamily={FONT.data}
                fontSize={9}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {'\u2694'.repeat(Math.min(3, leg.piracy))}
              </text>
            )}
          </g>
        )),
      )}

      {routePath && (
        <path
          d={routePath}
          stroke={CHART.routeLive}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}

      {PORTS.map(port => {
        const p = PORT_POINTS[port.id];
        const onContract = contractPorts.has(port.id);
        const fill = port.home ? CHART.portHome : onContract ? CHART.portContract : CHART.port;
        const [ox, oy] = LABEL_OFFSET[port.labelSide] ?? LABEL_OFFSET.e;
        const dx = ox * lift, dy = oy * lift;
        return (
          <g key={port.id} data-port-id={port.id}>
            {onContract && (
              /* pointerEvents="none" is load-bearing: this ring is wider than the port's own mark,
                 so without it a click landing on the ring's stroke hits decoration and silently
                 does nothing. Same trap the port labels sit in. */
              <circle
                cx={p.x}
                cy={p.y}
                r={9 * lift}
                fill="none"
                stroke={CHART.portContract}
                strokeWidth={1.4}
                opacity={0.8}
                pointerEvents="none"
              />
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={(hoveredPort === port.id ? 6 : 4) * lift}
              fill={fill}
              pointerEvents="none"
            />
            {/* The click target: invisible and larger than the mark, so a finger can find it. */}
            <circle
              cx={p.x}
              cy={p.y}
              r={Math.max(9 * lift, 14 / (scale * view.zoom || 1))}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              data-port-hit={port.id}
              onPointerEnter={() => setHoveredPort(port.id)}
              onPointerLeave={() => setHoveredPort(null)}
              onClick={e => {
                e.stopPropagation();
                onPortClick(port.id);
              }}
            />
            <text
              x={p.x + dx}
              y={p.y + dy}
              fill={CHART.label}
              fontFamily={FONT.body}
              fontSize={13 * lift}
              textAnchor={LABEL_ANCHOR[port.labelSide] ?? 'start'}
              paintOrder="stroke"
              stroke={CHART.labelHalo}
              strokeWidth={3 * lift}
              strokeLinejoin="round"
              /* Always-on labels near clickable marks must not eat their clicks. */
              pointerEvents="none"
            >
              {port.name}
            </text>
          </g>
        );
      })}

      {race && <RaceMarks race={race} lift={lift} />}
      {errandPorts.map(id => (
        <AdmiraltyPennant key={id} port={id} lift={lift} />
      ))}

      {ships.map(ship => (
        <ShipMarker
          key={ship.id}
          ship={ship}
          colour={colourOf[ship.ownerId] ?? CHART.port}
          selected={ship.id === selectedShipId}
          captainName={nameOf[ship.ownerId] ?? ''}
          isRival={ship.ownerId !== viewerId}
          racing={race?.runners.has(ship.id) ?? false}
          season={season}
          lift={lift}
        />
      ))}
    </g>
  );

  return (
    <div
      ref={wrapRef}
      className="tr-chart"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: CHART.sea, touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={e => {
        if (travelled.current > DRAG_THRESHOLD) e.stopPropagation();
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vbWidth.toFixed(2)} ${VB_HEIGHT}`}
        preserveAspectRatio="xMinYMin meet"
        style={{ display: 'block', width: '100%', height: '100%', userSelect: 'none' }}
        role="img"
        aria-label="World chart of trading ports and sea routes"
      >
        <defs>
          <pattern id="tr-swell" width={36} height={22} patternUnits="userSpaceOnUse">
            <path d="M2 8 q4 -3 8 0 t8 0" fill="none" stroke={CHART.graticule} strokeWidth={0.8} opacity={0.75} />
            <path d="M20 19 q4 -3 8 0 t8 0" fill="none" stroke={CHART.graticule} strokeWidth={0.8} opacity={0.5} />
          </pattern>
        </defs>
        {/* Outside the transformed group on purpose: inside it, it would pan away. */}
        <rect x={0} y={0} width={vbWidth} height={VB_HEIGHT} fill={CHART.sea} />

        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
          {copies.map(worldCopy)}
        </g>

        {/* Fixed to the pane, not the world: a compass rose and the chart's cartouche, kept clear
            of the panels and of the controls along the bottom edge. */}
        <CompassRose x={insetL + 58} y={VB_HEIGHT - insetB - 70} />
        {vbWidth - insetL - insetR > 700 && <Cartouche x={(insetL + vbWidth - insetR) / 2 - 106} y={14} />}
      </svg>

      <div className="tr-zoom" style={{ ...zoomControls, right: 10 + (inset?.right ?? 0), bottom: 10 + (inset?.bottom ?? 0) }}>
        <button style={zoomButton} onClick={() => zoomBy(1.4)} aria-label="Zoom in (+)" title="Zoom in (+)">
          +
        </button>
        <button style={zoomButton} onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out (-)" title="Zoom out (-)">
          −
        </button>
        <button
          style={{ ...zoomButton, fontSize: '0.6rem' }}
          onClick={fit}
          aria-label="Fit the whole chart (0)"
          title="Fit the whole chart (0)"
        >
          fit
        </button>
      </div>
    </div>
  );
}

/**
 * The wind mark on a leg: a chevron pointing the way the wind is fair, sized by how hard it blows.
 * A leg with no fair direction gets a small open circle instead — calm is information too.
 */
function WindMark({
  leg,
  lift = 1,
}: {
  lift?: number;
  leg: {
    x1: number; y1: number; x2: number; y2: number;
    fairWay: 'forward' | 'back' | null; strength: number; windLabel: string; becalmed: boolean;
  };
}) {
  const mx = (leg.x1 + leg.x2) / 2;
  const my = (leg.y1 + leg.y2) / 2;

  if (!leg.fairWay) {
    if (!leg.becalmed) return null;
    return (
      <circle cx={mx} cy={my} r={2.6 * Math.min(lift, 1.6)} fill="none" stroke={CHART.windFoul} strokeWidth={1} opacity={0.75} pointerEvents="none">
        <title>{leg.windLabel}</title>
      </circle>
    );
  }

  const sign = leg.fairWay === 'forward' ? 1 : -1;
  const angle = (Math.atan2((leg.y2 - leg.y1) * sign, (leg.x2 - leg.x1) * sign) * 180) / Math.PI;
  const size = (3 + leg.strength * 0.9) * Math.min(lift, 1.6);

  return (
    <g transform={`translate(${mx} ${my}) rotate(${angle})`} pointerEvents="none">
      <path
        d={`M${-size} ${-size * 0.72} L${size} 0 L${-size} ${size * 0.72}`}
        fill="none"
        stroke={CHART.windFair}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
      <title>{leg.windLabel}</title>
    </g>
  );
}

/**
 * A clipper on the chart.
 *
 * Deliberately chunky and filled in her captain's colour, with a wake showing where she is bound.
 * The earlier marker was a thin outline at the same size for everyone, which made it genuinely hard
 * to tell what a rival was up to — and in a game where the whole board is public information, not
 * being able to see the race is just friction.
 */
function ShipMarker({
  ship,
  colour,
  selected,
  captainName,
  isRival,
  racing,
  season,
  lift = 1,
}: {
  ship: Ship;
  colour: string;
  selected: boolean;
  captainName: string;
  isRival: boolean;
  racing: boolean;
  season: Season | null;
  /** Enlargement so she stays visible when the chart is drawn small (see MIN_LABEL_PX). */
  lift?: number;
}) {
  // Positioned at her true place, so a move glides but a zoom (which changes `lift`) does not.
  const pos = shipPosition(ship);
  const pace = usePace();
  // Where she was drawn last time, so a move can glide rather than jump. Skipped on the first draw
  // and on a Pacific crossing, where the chart wraps and a glide would sweep across the whole world.
  // This straight CSS glide is what motion "off" keeps, unchanged; at full and quick pace the
  // sailing below replaces it.
  const last = useRef<{ x: number; y: number } | null>(null);
  const glide =
    pace === 'off' && pos !== null && last.current !== null && Math.abs(pos.x - last.current.x) < VB_WIDTH / 3;

  // Sailing: when her position changes she follows the route port by port from where she was last
  // drawn, rather than cutting straight across land to the new spot. Display only — the reducer
  // has already moved her; this is the chart catching up.
  const prevShip = useRef<Ship | null>(null);
  const sailSeq = useRef(0);
  // `baseMs` is the full-pace duration; the shared tween paces it.
  const [sail, setSail] = useState<{ id: number; pts: Pt[]; baseMs: number } | null>(null);
  useLayoutEffect(() => {
    const before = prevShip.current;
    prevShip.current = ship;
    if (!before || !pos || pace === 'off' || anchorOf(before) === anchorOf(ship)) return;
    const from = last.current ?? shipPosition(before);
    if (!from) return;
    const via = waypointsBetween(before, ship, season);
    if (via === null && Math.abs(pos.x - from.x) >= VB_WIDTH / 3) {
      setSail(null);
      return;
    }
    const pts = unwrapPath([from, ...(via ?? []).map(id => PORT_POINTS[id]).filter(Boolean), pos]);
    const length = pathLength(pts);
    if (length < 0.5) return;
    // Long enough to read as a passage, short enough never to hold the eye.
    const baseMs = Math.min(950, Math.max(380, 260 + length * 1.2));
    if (paced(baseMs, pace) <= 0) return;
    setSail({ id: ++sailSeq.current, pts, baseMs });
    // `pos` is derived from `ship`; watching the anchor is watching her position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorOf(ship)]);
  // The shared tween is key-aware: the very render that starts a passage already reads t = 0, so
  // she is never drawn one frame at the destination first.
  const { t, playing: underWay, skip } = useTween(sail ? sail.id : null, sail ? sail.baseMs : 0);
  useSkipOnInput(underWay, skip);
  const at = underWay && sail ? pointAlong(sail.pts, easeInOut(t)) : null;

  useEffect(() => {
    if (at) last.current = { x: at.x, y: at.y };
    else if (pos) last.current = { x: pos.x, y: pos.y };
  });
  if (!pos) return null;
  const { x, y, heading, wake } = at ? { ...pos, x: at.x, y: at.y, heading: at.heading, wake: null } : pos;

  const dest = destinationOf(ship);
  const laden = ship.hold.length > 0;
  const size = selected ? 15 : 12;

  return (
    <g pointerEvents="none">
      {/* Where she has come from on this leg, so a rival's direction is readable at a glance. */}
      {wake && (
        <line
          x1={wake.x}
          y1={wake.y}
          x2={x}
          y2={y}
          stroke={colour}
          strokeWidth={selected ? 2.4 : 1.6}
          strokeDasharray="3 4"
          opacity={0.55}
        />
      )}
      <g
        style={{
          transform: `translate(${x}px, ${y}px)`,
          transition: glide ? 'transform 700ms cubic-bezier(0.33, 0, 0.2, 1)' : 'none',
        }}
      >
      {/* Enlarged about her own centre; a ship in port is also nudged further off the quay, since
          the port's mark has grown with her. */}
      <g transform={lift !== 1 ? `translate(${ship.location ? 13 * (lift - 1) : 0} ${ship.location ? -13 * (lift - 1) : 0}) scale(${lift})` : undefined}>
      <g transform={`rotate(${heading})`}>
        {selected && (
          <circle cx={0} cy={0} r={size + 7} fill="none" stroke={colour} strokeWidth={2} opacity={0.9} />
        )}
        {/* A dark keel under the hull so a pale colour still reads on pale sea. */}
        <path d={hullPath(size)} fill={CHART.labelHalo} opacity={0.85} transform="translate(0 1.5)" />
        {/* A clipper seen from aloft: a long fine hull, pointed bow, and her yards braced across. */}
        <path
          d={hullPath(size)}
          fill={colour}
          fillOpacity={laden ? 1 : 0.55}
          stroke={CHART.port}
          strokeWidth={0.9}
          strokeLinejoin="round"
        />
        {[-0.42, 0.02, 0.44].map((f, i) => {
          const half = size * (0.62 - Math.abs(f) * 0.28);
          const broken = ship.damaged && i === 0;
          return (
            <path
              key={f}
              d={`M${-half} ${size * f} Q0 ${size * f - size * 0.22} ${half} ${size * f}`}
              fill="none"
              stroke={broken ? CHART.damage : CHART.labelHalo}
              strokeWidth={broken ? 1.4 : 2.1}
              strokeLinecap="round"
              strokeDasharray={broken ? '2 2' : undefined}
              opacity={0.95}
            />
          );
        })}
        {/* Cargo pips along her centreline: how full she is, without needing a panel. */}
        {laden &&
          ship.hold.map((lot, i) => (
            <rect
              key={i}
              x={-1.4}
              y={size * 0.62 - i * 3.2}
              width={2.8}
              height={2.4}
              fill={racing && lot.good === 'tea' ? CHART.tea : CHART.port}
              opacity={0.9}
            />
          ))}
        {racing && (
          <path d={`M0 ${-size * 0.2} l${size * 0.75} ${-size * 0.35} l${-size * 0.75} ${-size * 0.2} Z`} fill={CHART.tea} stroke={CHART.port} strokeWidth={0.5} />
        )}
      </g>
      {/* Renown, as stars over a ship that has earned it. Unrotated, so they always read upright. */}
      {(ship.renown ?? 0) >= RENOWN_SMART &&
        Array.from({ length: (ship.renown ?? 0) >= RENOWN_FAMOUS ? 2 : 1 }, (_, i) => (
          <path
            key={i}
            d="M0 -3.2 L0.9 -1 L3.2 -1 L1.4 0.4 L2 2.7 L0 1.4 L-2 2.7 L-1.4 0.4 L-3.2 -1 L-0.9 -1 Z"
            transform={`translate(${-size * 0.9 - i * 6.5} ${-size * 0.9})`}
            fill={CHART.tea}
            stroke={CHART.port}
            strokeWidth={0.4}
          />
        ))}
      {ship.damaged && (
        <path
          d={`M${size * 0.7} ${-size * 0.9} l5 5 m0 -5 l-5 5`}
          stroke={CHART.damage}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      )}
      <text
        x={0}
        y={size + 13}
        fill={colour}
        fontFamily={FONT.data}
        fontSize={10}
        textAnchor="middle"
        paintOrder="stroke"
        stroke={CHART.labelHalo}
        strokeWidth={3}
        strokeLinejoin="round"
        opacity={isRival ? 0.95 : 0.75}
      >
        {isRival ? captainName : ship.name}
      </text>
      </g>
      </g>
      <title>
        {`${ship.name}, ${captainName}. ${
          ship.hold.length ? `${ship.hold.length} of 3 slots full` : 'running light'
        }${dest ? `, bound for ${PORT_BY_ID[dest]?.name ?? dest}` : ', in port'}`}
      </title>
    </g>
  );
}

type Pt = { x: number; y: number };

/** Everything about a ship's position that changes when she moves. */
function anchorOf(ship: Ship): string {
  if (ship.location) return ship.location;
  const v = ship.voyage;
  return v ? `${v.legFrom}>${v.route.join('>')}:${v.legRemaining}/${v.legDistance}` : '';
}

/**
 * The ports a ship sailed through between two of her positions, in order, or null when that cannot
 * be told for certain (then she glides straight, as she always did).
 *
 * At sea the remaining route is in her voyage. Leaving port it is not — the reducer plotted it — so
 * it is planned again the way doSailTo plans it (fastest for the season with weather, shortest
 * without) and accepted only if it agrees with where she actually is now.
 */
function waypointsBetween(before: Ship, after: Ship, season: Season | null): PortId[] | null {
  const here = after.location ?? after.voyage?.legFrom ?? null;
  if (!here) return null;
  if (before.voyage) {
    if (here === before.voyage.legFrom) return [];
    const k = before.voyage.route.indexOf(here);
    if (k < 0) return null;
    // Arriving in port, the last stop is her berth, drawn as the end point.
    return before.voyage.route.slice(0, after.location ? k : k + 1);
  }
  if (!before.location) return null;
  if (here === before.location) return [];
  const dest = after.location ?? destinationOf(after);
  if (!dest) return null;
  // A player may pick the shortest course over the fastest, so both are tried.
  const from = before.location;
  const candidates = [
    season ? planFastestRoute(from, dest, season, before.fittings?.copper) : null,
    planRoute(from, dest),
  ];
  for (const planned of candidates) {
    if (!planned) continue;
    const full = [from, ...planned.path];
    const k = full.indexOf(here);
    if (k < 0) continue;
    if (after.voyage && full[k + 1] !== after.voyage.route[0]) continue;
    // Her remaining route must be the rest of this one, or it is not the course she was given.
    if (after.voyage && full.slice(k + 1).join('>') !== after.voyage.route.join('>')) continue;
    return full.slice(1, after.location ? k : k + 1);
  }
  return null;
}

/** Make each step take the short way round the wrapped chart. */
function unwrapPath(pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[i - 1];
    out.push({ x: prev.x + wrapDx(prev.x, pts[i].x), y: pts[i].y });
  }
  // The last point is where she is really drawn; keep it exact when the unwrap agrees.
  return out;
}

function pathLength(pts: Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return n;
}

/** The point a fraction `t` of the way along a polyline, and the heading of that stretch. */
function pointAlong(pts: Pt[], t: number): Pt & { heading: number } {
  const total = pathLength(pts);
  let left = total * Math.min(1, Math.max(0, t));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    if (left <= seg || i === pts.length - 1) {
      const f = Math.min(1, left / seg);
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        heading: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90,
      };
    }
    left -= seg;
  }
  const end = pts[pts.length - 1];
  return { ...end, heading: 0 };
}

/** Where a ship is drawn, which way she heads, and the start of her leg for the wake. */
function shipPosition(
  ship: Ship,
): { x: number; y: number; heading: number; wake: { x: number; y: number } | null } | null {
  let x: number;
  let y: number;
  let heading = 0;
  let wake: { x: number; y: number } | null = null;

  if (ship.location) {
    const p = PORT_POINTS[ship.location];
    if (!p) return null;
    // Just off the quay so she never covers the port's own mark.
    x = p.x + 13;
    y = p.y - 13;
  } else if (ship.voyage) {
    const from = PORT_POINTS[ship.voyage.legFrom];
    const to = PORT_POINTS[ship.voyage.route[0]];
    if (!from || !to) return null;
    const progress =
      ship.voyage.legDistance > 0 ? 1 - ship.voyage.legRemaining / ship.voyage.legDistance : 0;
    const dx = wrapDx(from.x, to.x);
    x = from.x + dx * progress;
    y = from.y + (to.y - from.y) * progress;
    heading = (Math.atan2(to.y - from.y, dx) * 180) / Math.PI + 90;
    wake = { x: from.x, y: from.y };
  } else {
    return null;
  }
  return { x, y, heading, wake };
}

/** A clipper hull from above, bow up: fine entry, full quarters, a square transom. */
const hullPath = (s: number) =>
  `M0 ${-s} C${s * 0.42} ${-s * 0.55} ${s * 0.48} ${s * 0.35} ${s * 0.3} ${s * 0.86} L${-s * 0.3} ${s * 0.86} C${-s * 0.48} ${s * 0.35} ${-s * 0.42} ${-s * 0.55} 0 ${-s} Z`;

/**
 * The race on the chart: a tea chest at each port the new season comes down to, and a chequered
 * flag over London. Only while a race is running, so the chart is not carrying furniture for a
 * contest that is not on.
 */
function RaceMarks({ race, lift = 1 }: { race: { ports: PortId[]; finish: PortId }; lift?: number }) {
  const finish = PORT_POINTS[race.finish];
  return (
    <g pointerEvents="none">
      {race.ports.map(id => {
        const p = PORT_POINTS[id];
        if (!p) return null;
        return (
          <g key={id} transform={`translate(${p.x} ${p.y}) scale(${lift}) translate(-19 -8)`}>
            <rect x={0} y={0} width={9} height={7.5} fill={CHART.labelHalo} stroke={CHART.tea} strokeWidth={1.2} />
            <path d="M0 2.6 H9 M4.5 0 V7.5" stroke={CHART.tea} strokeWidth={0.7} />
            <title>New-season tea is loading here</title>
          </g>
        );
      })}
      {finish && (
        <g transform={`translate(${finish.x} ${finish.y}) scale(${lift}) translate(-4 -30)`}>
          <line x1={0} y1={0} x2={0} y2={24} stroke={CHART.port} strokeWidth={1.4} />
          <rect x={0} y={0} width={14} height={9} fill={CHART.labelHalo} stroke={CHART.port} strokeWidth={0.8} />
          {[0, 1, 2, 3].map(i => (
            <rect key={i} x={(i % 2) * 7 + (i > 1 ? 3.5 : 0)} y={i > 1 ? 4.5 : 0} width={3.5} height={4.5} fill={CHART.tea} />
          ))}
          <title>The tea race finishes in London</title>
        </g>
      )}
    </g>
  );
}

/** A storm cloud with rain, over a leg that is dangerous this season. Gently drifts. */
function StormCloud({ x, y, severe, lift = 1 }: { x: number; y: number; severe: boolean; lift?: number }) {
  // Lifted like the wind marks, and capped the same way, so a small chart still shows the weather.
  return (
    <g transform={`translate(${x} ${y}) scale(${Math.min(lift, 1.6)}) translate(0 -10)`} pointerEvents="none" opacity={0.85}>
      <g className="tr-drift">
        <path
          d="M-11 2 Q-12 -4 -6 -4 Q-4 -10 2 -8 Q8 -11 10 -4 Q15 -3 13 2 Z"
          fill={CHART.labelHalo}
          stroke={CHART.coast}
          strokeWidth={0.9}
        />
        <path d="M-6 5 l-2 4 M0 5 l-2 4 M6 5 l-2 4" stroke={CHART.windFoul} strokeWidth={1} strokeLinecap="round" />
        {severe && <path d="M2 4 L-1 9 L2 9 L0 14" fill="none" stroke={CHART.windFoul} strokeWidth={1.2} strokeLinejoin="round" />}
      </g>
      <title>{severe ? 'The worst weather of the season' : 'Stormy this season'}</title>
    </g>
  );
}

/** The black flag, over the most piratical waters on the chart. */
function BlackFlag({ x, y, lift = 1 }: { x: number; y: number; lift?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${Math.min(lift, 1.6)}) translate(0 -14)`} pointerEvents="none">
      <line x1={0} y1={0} x2={0} y2={14} stroke={CHART.port} strokeWidth={1} />
      <path d="M0 0 H10 L8.5 3.5 L10 7 H0 Z" fill={CHART.port} />
      <circle cx={4.6} cy={2.8} r={1.3} fill={CHART.labelHalo} />
      <path d="M2.8 5.4 L6.4 6.2 M6.4 5.4 L2.8 6.2" stroke={CHART.labelHalo} strokeWidth={0.6} />
      <title>Notorious pirate waters</title>
    </g>
  );
}

/** A blue Admiralty pennant over a port the viewer carries dispatches for. */
function AdmiraltyPennant({ port, lift = 1 }: { port: PortId; lift?: number }) {
  const p = PORT_POINTS[port];
  if (!p) return null;
  return (
    <g transform={`translate(${p.x} ${p.y}) scale(${lift}) translate(6 -26)`} pointerEvents="none">
      <line x1={0} y1={0} x2={0} y2={20} stroke={CHART.port} strokeWidth={1.2} />
      <path d="M0 0 L14 3.5 L0 7 Z" fill={CHART.portContract} stroke={CHART.port} strokeWidth={0.5} />
      <title>Your Admiralty dispatches are for here</title>
    </g>
  );
}

/** An eight-point compass rose, engraved in the chart's own coast colour. */
function CompassRose({ x, y }: { x: number; y: number }) {
  const r = 36;
  const point = (angle: number, long: boolean) => {
    const len = long ? r : r * 0.55;
    const w = long ? 7 : 5;
    return (
      <g key={angle} transform={`rotate(${angle})`}>
        <path d={`M0 ${-len} L${w} 0 L0 0 Z`} fill={CHART.coast} opacity={0.85} />
        <path d={`M0 ${-len} L${-w} 0 L0 0 Z`} fill={CHART.land} stroke={CHART.coast} strokeWidth={0.7} />
      </g>
    );
  };
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none" opacity={0.9}>
      <circle r={r * 0.78} fill="none" stroke={CHART.coast} strokeWidth={0.8} />
      <circle r={r * 0.7} fill="none" stroke={CHART.coast} strokeWidth={0.4} strokeDasharray="1.5 2.5" />
      {[45, 135, 225, 315].map(a => point(a, false))}
      {[0, 90, 180, 270].map(a => point(a, true))}
      <circle r={3} fill={CHART.coast} />
      <text y={-r - 6} textAnchor="middle" fontFamily={FONT.body} fontSize={13} fontWeight={700} fill={CHART.label}>
        N
      </text>
    </g>
  );
}

/** The chart's title block, after the cartouches on Admiralty sheets. */
function Cartouche({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <rect x={0} y={0} width={212} height={54} fill={CHART.land} stroke={CHART.coast} strokeWidth={1.2} opacity={0.92} />
      <rect x={4} y={4} width={204} height={46} fill="none" stroke={CHART.coast} strokeWidth={0.5} />
      <text x={106} y={24} textAnchor="middle" fontFamily={FONT.display} fontSize={15} fill={CHART.label} letterSpacing="0.06em">
        THE TEA RACE
      </text>
      <text x={106} y={40} textAnchor="middle" fontFamily={FONT.body} fontSize={10} fontStyle="italic" fill={CHART.distance}>
        A chart of the clipper routes, 1860s
      </text>
    </g>
  );
}

const zoomControls: React.CSSProperties = {
  position: 'absolute',
  right: 10,
  bottom: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

/* Driven by the chart palette, not hardcoded — these sit on the sea, so they have to change with
   it. A dark-chart button over the pale printed board would be a black box in the ocean. */
const zoomButton: React.CSSProperties = {
  width: 44,
  height: 44,
  border: `1px solid ${CHART.coast}`,
  background: CHART.sea,
  // The label ink, not the coastline: the coast colour on the sea is a line colour, too faint for
  // the symbols (about 3.2:1 on the printed chart).
  color: CHART.label,
  fontFamily: FONT.data,
  fontSize: '1.1rem',
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: 2,
};
