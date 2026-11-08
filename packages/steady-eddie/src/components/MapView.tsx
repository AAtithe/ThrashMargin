import { useEffect, useMemo, useRef, useState } from 'react';
import { CHART, FONT } from '../theme';
import { sourcesFor, LEGS, DEPOTS, DEPOT_BY_ID } from '../sim/content';
import { CHART as BACKDROP, DEPOT_POINTS, VB_HEIGHT, VB_WIDTH } from '../sim/geography';
import { destinationOf } from '../sim/movement';
import type { Season } from '../sim/weather';
import { theftRating } from '../sim/hazards';
import type { Haulier, Contract, DepotId, Vehicle } from '../sim/types';

interface MapViewProps {
  vehicles: Vehicle[];
  hauliers: Haulier[];
  contracts: Contract[];
  selectedVehicleId: string | null;
  onDepotClick: (depotId: DepotId) => void;
  plannedRoute: DepotId[] | null;
  /** Null when this game is played without weather — then no weather is drawn on the chart. */
  season: Season | null;
  showTheft: boolean;
  /** Whose vehicles are "mine" — everyone else's get their haulier's name on the chart. */
  viewerId: string | null;
  /**
   * A depot to keep in view: the one just clicked, or where the selected vehicle is parked. When it
   * changes and is hidden under a panel or off the pane, the chart pans to it.
   */
  focusDepot?: DepotId | null;
  /** Screen pixels covered by panels floating over the chart, so fitting and panning avoid them. */
  inset?: { left: number; right: number; bottom: number };
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 8;
const DRAG_THRESHOLD = 5;
/**
 * The smallest a depot name may appear on screen, in pixels. Names are authored at 13 chart units;
 * on a phone or a short laptop the chart is drawn at well under a pixel per unit and they were
 * unreadable. Below this they are lifted; zoomed in they grow normally.
 */
const MIN_LABEL_PX = 12;

/**
 * The playable area: every depot, with room round it for the names. The default view frames this
 * rather than the whole sheet, most of which is sea and Ireland and has nothing to drive to.
 */
const DEPOT_BOUNDS = (() => {
  const pts = DEPOTS.map(d => DEPOT_POINTS[d.id]).filter(Boolean);
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  return { minX: Math.min(...xs) - 40, maxX: Math.max(...xs) + 90, minY: Math.min(...ys) - 40, maxY: Math.max(...ys) + 40 };
})();

type Anchor = 'start' | 'middle' | 'end';
const LABEL_OFFSET: Record<string, [number, number]> = {
  n: [0, -14],
  s: [0, 20],
  e: [12, 5],
  w: [-12, 5],
};
const LABEL_ANCHOR: Record<string, Anchor> = { n: 'middle', s: 'middle', e: 'start', w: 'end' };

export default function MapView({
  vehicles,
  hauliers,
  contracts,
  selectedVehicleId,
  onDepotClick,
  plannedRoute,
  season,
  showTheft,
  viewerId,
  focusDepot = null,
  inset,
}: MapViewProps) {
  const colourOf = useMemo(
    () => Object.fromEntries(hauliers.map(c => [c.id, c.colour])),
    [hauliers],
  );
  const nameOf = useMemo(
    () => Object.fromEntries(hauliers.map(c => [c.id, c.name])),
    [hauliers],
  );

  const contractDepots = useMemo(() => {
    const set = new Set<DepotId>();
    for (const c of contracts) {
      if (c.fills.length >= 2) continue;
      set.add(c.destination);
      // Cards name no source, so every depot stocking the good is on the race — which is rather the
      // point of dropping the source, and the chart should show it.
      for (const seller of sourcesFor(c.good, c.destination)) set.add(seller);
    }
    return set;
  }, [contracts]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [dragging, setDragging] = useState(false);
  const [hoveredDepot, setHoveredDepot] = useState<DepotId | null>(null);

  /**
   * The chart fills its pane. `scale` is screen pixels per chart unit at zoom 1, chosen so the whole
   * sheet fits; the viewBox then matches the pane's own shape, so there is no letterboxing and the
   * sea runs to every edge. The view is fitted to the depots, not the sheet (see `fit`).
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
  const scale = size.w > 0 && size.h > 0 ? Math.min(size.w / VB_WIDTH, size.h / VB_HEIGHT) : 0;
  const vbW = scale > 0 ? size.w / scale : VB_WIDTH;
  const vbH = scale > 0 ? size.h / scale : VB_HEIGHT;
  const insetL = scale > 0 ? (inset?.left ?? 0) / scale : 0;
  const insetR = scale > 0 ? (inset?.right ?? 0) / scale : 0;
  const insetB = scale > 0 ? (inset?.bottom ?? 0) / scale : 0;
  /** How much to enlarge marks and names so they never drop below a readable size on screen. */
  const lift = scale > 0 ? Math.max(1, MIN_LABEL_PX / (13 * scale * view.zoom)) : 1;

  /**
   * Keep the sheet on screen whatever the player does. Along an axis where it is smaller than the
   * open part of the pane it can sit anywhere inside it; where it is larger it can be dragged until
   * its edge shows a narrow band, and no further.
   */
  const clampView = (v: { zoom: number; panX: number; panY: number }) => {
    const axis = (pan: number, len: number, from: number, to: number) => {
      const span = to - from;
      const slack = Math.min(80 / (scale || 1), span * 0.2);
      const lo = len <= span ? from - slack : to - slack - len;
      const hi = len <= span ? to - len + slack : from + slack;
      return Math.min(hi, Math.max(lo, pan));
    };
    return {
      zoom: v.zoom,
      panX: axis(v.panX, VB_WIDTH * v.zoom, insetL, vbW - insetR),
      panY: axis(v.panY, VB_HEIGHT * v.zoom, 0, vbH - insetB),
    };
  };

  /** Frame every depot in the part of the pane the panels leave, as large as fits. */
  const fit = () => {
    const { minX, maxX, minY, maxY } = DEPOT_BOUNDS;
    const availW = Math.max(100, vbW - insetL - insetR);
    const availH = Math.max(100, vbH - insetB);
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(availW / (maxX - minX), availH / (maxY - minY))));
    setView(
      clampView({
        zoom,
        panX: insetL + availW / 2 - ((minX + maxX) / 2) * zoom,
        panY: availH / 2 - ((minY + maxY) / 2) * zoom,
      }),
    );
  };

  // Fit once the pane has a size. Not again on resize: that would throw away the player's view.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || scale <= 0) return;
    fitted.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // A depot newly in focus that is hidden under a panel or off the pane is brought into the open.
  useEffect(() => {
    if (!focusDepot || scale <= 0) return;
    const p = DEPOT_POINTS[focusDepot];
    if (!p) return;
    setView(prev => {
      const sx = prev.panX + p.x * prev.zoom;
      const sy = prev.panY + p.y * prev.zoom;
      const margin = 50 / scale;
      if (sx > insetL + margin && sx < vbW - insetR - margin && sy > margin && sy < vbH - insetB - margin) return prev;
      return clampView({
        zoom: prev.zoom,
        panX: (insetL + vbW - insetR) / 2 - p.x * prev.zoom,
        panY: (vbH - insetB) / 2 - p.y * prev.zoom,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDepot]);

  /** Zoom about a point in chart units across the pane (the open part's middle when omitted). */
  const zoomAt = (factor: number, vbX?: number, vbY?: number) =>
    setView(prev => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
      const cx = vbX ?? (insetL + vbW - insetR) / 2;
      const cy = vbY ?? (vbH - insetB) / 2;
      return clampView({
        zoom,
        panX: cx - ((cx - prev.panX) / prev.zoom) * zoom,
        panY: cy - ((cy - prev.panY) / prev.zoom) * zoom,
      });
    });
  const zoomBy = (factor: number) => zoomAt(factor);

  // The native listeners below are attached once; this keeps them reading the current geometry.
  const live = useRef({ scale, zoomAt, fit });
  live.current = { scale, zoomAt, fit };

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') live.current.zoomAt(1.3);
      else if (e.key === '-' || e.key === '_') live.current.zoomAt(1 / 1.3);
      else if (e.key === '0') live.current.fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Drag to pan, pinch to zoom. The pane only captures the pointer once it has moved past a few
   * pixels, so a tap on a depot still reaches the depot; the click that ends a drag is swallowed so
   * letting go over a depot does not also lay a course to it.
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
    setView(prev => clampView({ zoom: prev.zoom, panX: prev.panX + dx / scale, panY: prev.panY + dy / scale }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  /**
   * Every leg, carrying whatever hazard ratings this game plays with. No wrap-around handling here
   * — the whole point of a UK-only map, unlike The Tea Race's world chart, is that no leg comes
   * anywhere near half the sheet wide, so a plain straight line between two projected points is
   * always the short way round.
   */
  const drawnLegs = useMemo(
    () =>
      LEGS.map(leg => {
        const a = DEPOT_POINTS[leg.a];
        const b = DEPOT_POINTS[leg.b];
        return {
          key: `${leg.a}-${leg.b}`,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          distance: leg.distance,
          weatherRisk: season ? leg.weatherRisk ?? 0 : 0,
          theft: showTheft ? theftRating(leg.a, leg.b) : 0,
        };
      }),
    [season, showTheft],
  );

  const routePath = useMemo(() => {
    if (!plannedRoute || plannedRoute.length < 2) return null;
    const pts = plannedRoute.map(id => DEPOT_POINTS[id]).filter(Boolean);
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
  }, [plannedRoute]);

  const map = (
    <g>
      {BACKDROP.graticule.map((d, i) => (
        <path key={`g${i}`} d={d} stroke={CHART.graticule} strokeWidth={0.7} fill="none" />
      ))}

      {BACKDROP.land.map((d, i) => (
        <path key={`l${i}`} d={d} fill={CHART.land} stroke={CHART.coast} strokeWidth={1.1} strokeLinejoin="round" />
      ))}

      {drawnLegs.map(leg => (
        <g key={leg.key}>
          <line
            x1={leg.x1}
            y1={leg.y1}
            x2={leg.x2}
            y2={leg.y2}
            stroke={leg.theft > 0 ? CHART.theft : leg.weatherRisk > 0 ? CHART.weatherRisk : CHART.route}
            strokeWidth={leg.theft > 0 || leg.weatherRisk > 0 ? 1.6 : 1.3}
            strokeDasharray={leg.theft > 0 ? '2 4' : leg.weatherRisk > 0 ? '1 3' : '5 5'}
            opacity={leg.theft > 0 || leg.weatherRisk > 0 ? 0.85 : 0.75}
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
          {leg.weatherRisk > 0 && (
            <text
              x={(leg.x1 + leg.x2) / 2 - 10}
              y={(leg.y1 + leg.y2) / 2 + 12}
              fill={CHART.weatherRisk}
              fontFamily={FONT.data}
              fontSize={9}
              textAnchor="middle"
              dominantBaseline="middle"
              pointerEvents="none"
            >
              {'\u2601'.repeat(Math.min(3, leg.weatherRisk))}
            </text>
          )}
          {leg.theft > 0 && (
            <text
              x={(leg.x1 + leg.x2) / 2 + 10}
              y={(leg.y1 + leg.y2) / 2 + 12}
              fill={CHART.theft}
              fontFamily={FONT.data}
              fontSize={9}
              textAnchor="middle"
              dominantBaseline="middle"
              pointerEvents="none"
            >
              {'\u2694'.repeat(Math.min(3, leg.theft))}
            </text>
          )}
        </g>
      ))}

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

      {DEPOTS.map(depot => {
        const p = DEPOT_POINTS[depot.id];
        const onContract = contractDepots.has(depot.id);
        const fill = depot.home ? CHART.depotHome : onContract ? CHART.depotContract : CHART.depot;
        const [ox, oy] = LABEL_OFFSET[depot.labelSide] ?? LABEL_OFFSET.e;
        const dx = ox * lift, dy = oy * lift;
        return (
          <g key={depot.id} data-depot-id={depot.id}>
            {onContract && (
              /* pointerEvents="none" is load-bearing: this ring is wider than the depot's own mark,
                 so without it a click landing on the ring's stroke hits decoration and silently
                 does nothing. Same trap the depot labels sit in. */
              <circle
                cx={p.x}
                cy={p.y}
                r={9 * lift}
                fill="none"
                stroke={CHART.depotContract}
                strokeWidth={1.4}
                opacity={0.8}
                pointerEvents="none"
              />
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={(hoveredDepot === depot.id ? 6 : 4) * lift}
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
              onPointerEnter={() => setHoveredDepot(depot.id)}
              onPointerLeave={() => setHoveredDepot(null)}
              onClick={e => {
                e.stopPropagation();
                onDepotClick(depot.id);
              }}
            />
            <text
              x={p.x + dx}
              y={p.y + dy}
              fill={CHART.label}
              fontFamily={FONT.body}
              fontSize={13 * lift}
              textAnchor={LABEL_ANCHOR[depot.labelSide] ?? 'start'}
              paintOrder="stroke"
              stroke={CHART.labelHalo}
              strokeWidth={3 * lift}
              strokeLinejoin="round"
              /* Always-on labels near clickable marks must not eat their clicks. */
              pointerEvents="none"
            >
              {depot.name}
            </text>
          </g>
        );
      })}

      {vehicles.map(vehicle => (
        <VehicleMarker
          key={vehicle.id}
          vehicle={vehicle}
          colour={colourOf[vehicle.ownerId] ?? CHART.depot}
          selected={vehicle.id === selectedVehicleId}
          haulierName={nameOf[vehicle.ownerId] ?? ''}
          isRival={vehicle.ownerId !== viewerId}
          lift={lift}
        />
      ))}
    </g>
  );

  return (
    <div
      ref={wrapRef}
      className="se-chart"
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
        viewBox={`0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}`}
        preserveAspectRatio="xMinYMin meet"
        style={{ display: 'block', width: '100%', height: '100%', userSelect: 'none' }}
        role="img"
        aria-label="Chart of UK depots and road routes"
      >
        {/* Outside the transformed group on purpose: inside it, it would pan away. */}
        <rect x={0} y={0} width={vbW} height={vbH} fill={CHART.sea} />

        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>{map}</g>
      </svg>

      <div style={{ ...zoomControls, right: 10 + (inset?.right ?? 0), bottom: 10 + (inset?.bottom ?? 0) }}>
        <button style={zoomButton} onClick={() => zoomBy(1.4)} aria-label="Zoom in (+)" title="Zoom in (+)">
          +
        </button>
        <button style={zoomButton} onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out (-)" title="Zoom out (-)">
          −
        </button>
        <button
          style={{ ...zoomButton, fontSize: '0.6rem' }}
          onClick={fit}
          aria-label="Fit every depot in view (0)"
          title="Fit every depot in view (0)"
        >
          fit
        </button>
      </div>
    </div>
  );
}

/**
 * A vehicle marker on the chart.
 *
 * Deliberately chunky and filled in her haulier's colour, with a wake showing where she is bound.
 * The earlier marker was a thin outline at the same size for everyone, which made it genuinely hard
 * to tell what a rival was up to — and in a game where the whole board is public information, not
 * being able to see the race is just friction.
 */
function VehicleMarker({
  vehicle,
  colour,
  selected,
  haulierName,
  isRival,
  lift = 1,
}: {
  vehicle: Vehicle;
  colour: string;
  selected: boolean;
  haulierName: string;
  isRival: boolean;
  /** Enlargement so she stays visible when the chart is drawn small (see MIN_LABEL_PX). */
  lift?: number;
}) {
  let x: number;
  let y: number;
  let heading = 0;
  let wake: { x: number; y: number } | null = null;

  if (vehicle.location) {
    const p = DEPOT_POINTS[vehicle.location];
    if (!p) return null;
    // Just off the depot so she never covers the depot's own mark.
    x = p.x + 13 * lift;
    y = p.y - 13 * lift;
  } else if (vehicle.run) {
    const from = DEPOT_POINTS[vehicle.run.legFrom];
    const to = DEPOT_POINTS[vehicle.run.route[0]];
    if (!from || !to) return null;
    const progress =
      vehicle.run.legDistance > 0 ? 1 - vehicle.run.legRemaining / vehicle.run.legDistance : 0;
    const dx = to.x - from.x;
    x = from.x + dx * progress;
    y = from.y + (to.y - from.y) * progress;
    heading = (Math.atan2(to.y - from.y, dx) * 180) / Math.PI + 90;
    wake = { x: from.x, y: from.y };
  } else {
    return null;
  }

  const dest = destinationOf(vehicle);
  const laden = vehicle.hold.length > 0;
  const size = (selected ? 15 : 12) * lift;

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
      <g transform={`translate(${x} ${y}) rotate(${heading})`}>
        {selected && (
          <circle cx={0} cy={0} r={size + 7} fill="none" stroke={colour} strokeWidth={2} opacity={0.9} />
        )}
        {/* A dark keel under the hull so a pale colour still reads on pale sea. */}
        <path
          d={`M0 ${-size} L${size * 0.62} ${size * 0.7} L0 ${size * 0.34} L${-size * 0.62} ${size * 0.7} Z`}
          fill={CHART.labelHalo}
          opacity={0.85}
          transform="translate(0 1.5)"
        />
        <path
          d={`M0 ${-size} L${size * 0.62} ${size * 0.7} L0 ${size * 0.34} L${-size * 0.62} ${size * 0.7} Z`}
          fill={colour}
          fillOpacity={laden ? 1 : 0.5}
          stroke={colour}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        {/* Cargo pips: how full she is, without needing a panel. */}
        {laden &&
          vehicle.hold.map((_, i) => (
            <circle
              key={i}
              cx={(i - (vehicle.hold.length - 1) / 2) * 4.4 * lift}
              cy={size * 0.16}
              r={1.5 * lift}
              fill={CHART.labelHalo}
              opacity={0.9}
            />
          ))}
      </g>
      <text
        x={x}
        y={y + size + 13 * lift}
        fill={colour}
        fontFamily={FONT.data}
        fontSize={10 * lift}
        textAnchor="middle"
        paintOrder="stroke"
        stroke={CHART.labelHalo}
        strokeWidth={3 * lift}
        strokeLinejoin="round"
        opacity={isRival ? 0.95 : 0.75}
      >
        {isRival ? haulierName : vehicle.name}
      </text>
      <title>
        {`${vehicle.name} — ${haulierName}. ${
          vehicle.hold.length ? `${vehicle.hold.length} of 3 slots full` : 'running light'
        }${dest ? `, bound for ${DEPOT_BY_ID[dest]?.name ?? dest}` : ', in depot'}`}
      </title>
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
  color: CHART.coast,
  fontFamily: FONT.data,
  fontSize: '1.1rem',
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: 2,
  opacity: 0.92,
};
