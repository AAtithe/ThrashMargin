import { useEffect, useMemo, useRef, useState } from 'react';
import { CHART, FONT } from '../theme';
import { sourcesFor, LEGS, DEPOTS, DEPOT_BY_ID } from '../sim/content';
import { CHART as BACKDROP, DEPOT_POINTS, VB_HEIGHT, VB_WIDTH, clampPanX } from '../sim/geography';
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
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

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
  vehicles,
  hauliers,
  contracts,
  selectedVehicleId,
  onDepotClick,
  plannedRoute,
  season,
  showTheft,
  viewerId,
}: MapViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [hoveredDepot, setHoveredDepot] = useState<DepotId | null>(null);

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

  const contentScale = () => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return 0;
    return Math.min(rect.width / VB_WIDTH, rect.height / VB_HEIGHT);
  };

  const setViewSafely = (zoom: number, panX: number, panY: number) =>
    setView({ zoom, panX: clampPanX(panX, zoom), panY: clampPanY(panY, zoom) });

  // Scroll-to-zoom needs a real native listener: React registers `wheel` passively and silently
  // ignores preventDefault() inside a JSX onWheel handler.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = contentScale();
      // A momentarily zero-sized SVG (it happens behind a modal) would make this NaN, and once NaN
      // is in the view state nothing recovers it.
      if (!Number.isFinite(scale) || scale <= 0) return;

      const rect = svg.getBoundingClientRect();
      const offsetX = (rect.width - VB_WIDTH * scale) / 2;
      const offsetY = (rect.height - VB_HEIGHT * scale) / 2;
      const vbX = (e.clientX - rect.left - offsetX) / scale;
      const vbY = (e.clientY - rect.top - offsetY) / scale;

      setView(prev => {
        const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        const panX = vbX - ((vbX - prev.panX) / prev.zoom) * zoom;
        const panY = vbY - ((vbY - prev.panY) / prev.zoom) * zoom;
        return { zoom, panX: clampPanX(panX, zoom), panY: clampPanY(panY, zoom) };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Drag listeners live on the window, not the SVG: a fast drag can leave the map pane, and an
  // SVG-scoped listener would leave the drag stuck mid-pan.
  useEffect(() => {
    if (!drag) return;
    const scale = contentScale();
    const onMove = (e: PointerEvent) => {
      if (!Number.isFinite(scale) || scale <= 0) return;
      setView(prev => ({
        zoom: prev.zoom,
        panX: clampPanX(drag.panX + (e.clientX - drag.x) / scale, prev.zoom),
        panY: clampPanY(drag.panY + (e.clientY - drag.y) / scale, prev.zoom),
      }));
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag]);

  const zoomBy = (factor: number) =>
    setView(prev => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
      const cx = VB_WIDTH / 2;
      const cy = VB_HEIGHT / 2;
      const panX = cx - ((cx - prev.panX) / prev.zoom) * zoom;
      const panY = cy - ((cy - prev.panY) / prev.zoom) * zoom;
      return { zoom, panX: clampPanX(panX, zoom), panY: clampPanY(panY, zoom) };
    });

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
            fontSize={9}
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
        const [dx, dy] = LABEL_OFFSET[depot.labelSide] ?? LABEL_OFFSET.e;
        return (
          <g key={depot.id} data-depot-id={depot.id}>
            {onContract && (
              /* pointerEvents="none" is load-bearing: this ring is wider than the depot's own mark,
                 so without it a click landing on the ring's stroke hits decoration and silently
                 does nothing. Same trap the depot labels sit in. */
              <circle
                cx={p.x}
                cy={p.y}
                r={9}
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
              r={hoveredDepot === depot.id ? 6 : 4}
              fill={fill}
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
              fontSize={13}
              textAnchor={LABEL_ANCHOR[depot.labelSide] ?? 'start'}
              paintOrder="stroke"
              stroke={CHART.labelHalo}
              strokeWidth={3}
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
        />
      ))}
    </g>
  );

  return (
    <div
      style={{
        position: 'relative',
        background: CHART.sea,
        border: `1px solid ${CHART.coast}`,
        alignSelf: 'center',
        maxWidth: '100%',
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        style={{
          display: 'block',
          // Height-driven, not width-driven: this map's viewBox is portrait (taller than it is
          // wide, to match Britain's own shape), unlike The Tea Race's landscape world chart. A
          // width:100% map in a wide desktop column came out taller than the whole viewport —
          // the fleet/orders panels below it were only reachable by scrolling. Capping by height
          // and letting width follow from the aspect ratio keeps the whole board on screen;
          // maxWidth still shrinks it to fit a narrow (mobile-stacked) column instead of
          // overflowing sideways.
          height: 'min(68vh, 820px)',
          width: 'auto',
          maxWidth: '100%',
          touchAction: 'none',
          cursor: drag ? 'grabbing' : 'grab',
        }}
        onPointerDown={e => {
          if (e.button !== 0) return;
          setDrag({ x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY });
        }}
        role="img"
        aria-label="Chart of UK depots and road routes"
      >
        {/* Outside the transformed group on purpose: inside it, it would pan away. */}
        <rect x={0} y={0} width={VB_WIDTH} height={VB_HEIGHT} fill={CHART.sea} />

        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>{map}</g>
      </svg>

      <div style={zoomControls}>
        <button style={zoomButton} onClick={() => zoomBy(1.4)} aria-label="Zoom in">
          +
        </button>
        <button style={zoomButton} onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
          −
        </button>
        <button
          style={{ ...zoomButton, fontSize: '0.6rem' }}
          onClick={() => setViewSafely(1, 0, 0)}
          aria-label="Fit the whole chart"
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
}: {
  vehicle: Vehicle;
  colour: string;
  selected: boolean;
  haulierName: string;
  isRival: boolean;
}) {
  let x: number;
  let y: number;
  let heading = 0;
  let wake: { x: number; y: number } | null = null;

  if (vehicle.location) {
    const p = DEPOT_POINTS[vehicle.location];
    if (!p) return null;
    // Just off the depot so she never covers the depot's own mark.
    x = p.x + 13;
    y = p.y - 13;
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
              cx={(i - (vehicle.hold.length - 1) / 2) * 4.4}
              cy={size * 0.16}
              r={1.5}
              fill={CHART.labelHalo}
              opacity={0.9}
            />
          ))}
      </g>
      <text
        x={x}
        y={y + size + 13}
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
