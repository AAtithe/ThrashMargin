import { useEffect, useMemo, useRef, useState } from 'react';
import { CHART, FONT } from '../theme';
import { sourcesFor, LEGS, PORTS, PORT_BY_ID } from '../sim/content';
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
import { windFor, type Season } from '../sim/weather';
import { piracyRating } from '../sim/hazards';
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
  ships,
  captains,
  contracts,
  selectedShipId,
  onPortClick,
  plannedRoute,
  season,
  showPiracy,
  viewerId,
}: MapViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [hoveredPort, setHoveredPort] = useState<PortId | null>(null);

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

  const contentScale = () => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return 0;
    return Math.min(rect.width / VB_WIDTH, rect.height / VB_HEIGHT);
  };

  const setViewSafely = (zoom: number, panX: number, panY: number) =>
    setView({ zoom, panX: wrapPanX(panX, zoom), panY: clampPanY(panY, zoom) });

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
        return { zoom, panX: wrapPanX(panX, zoom), panY: clampPanY(panY, zoom) };
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
        panX: wrapPanX(drag.panX + (e.clientX - drag.x) / scale, prev.zoom),
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
      return { zoom, panX: wrapPanX(panX, zoom), panY: clampPanY(panY, zoom) };
    });

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
              fontSize={9}
              textAnchor="middle"
              dominantBaseline="middle"
              pointerEvents="none"
            >
              {leg.distance}
            </text>
            <WindMark leg={leg} />
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
        const [dx, dy] = LABEL_OFFSET[port.labelSide] ?? LABEL_OFFSET.e;
        return (
          <g key={port.id} data-port-id={port.id}>
            {onContract && (
              /* pointerEvents="none" is load-bearing: this ring is wider than the port's own mark,
                 so without it a click landing on the ring's stroke hits decoration and silently
                 does nothing. Same trap the port labels sit in. */
              <circle
                cx={p.x}
                cy={p.y}
                r={9}
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
              r={hoveredPort === port.id ? 6 : 4}
              fill={fill}
              style={{ cursor: 'pointer' }}
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
              fontSize={13}
              textAnchor={LABEL_ANCHOR[port.labelSide] ?? 'start'}
              paintOrder="stroke"
              stroke={CHART.labelHalo}
              strokeWidth={3}
              strokeLinejoin="round"
              /* Always-on labels near clickable marks must not eat their clicks. */
              pointerEvents="none"
            >
              {port.name}
            </text>
          </g>
        );
      })}

      {ships.map(ship => (
        <ShipMarker
          key={ship.id}
          ship={ship}
          colour={colourOf[ship.ownerId] ?? CHART.port}
          selected={ship.id === selectedShipId}
          captainName={nameOf[ship.ownerId] ?? ''}
          isRival={ship.ownerId !== viewerId}
        />
      ))}
    </g>
  );

  return (
    <div style={{ position: 'relative', background: CHART.sea, border: `1px solid ${CHART.coast}` }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        style={{ display: 'block', width: '100%', height: 'auto', touchAction: 'none', cursor: drag ? 'grabbing' : 'grab' }}
        onPointerDown={e => {
          if (e.button !== 0) return;
          setDrag({ x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY });
        }}
        role="img"
        aria-label="World chart of trading ports and sea routes"
      >
        {/* Outside the transformed group on purpose: inside it, it would pan away. */}
        <rect x={0} y={0} width={VB_WIDTH} height={VB_HEIGHT} fill={CHART.sea} />

        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
          {WORLD_COPIES.map(worldCopy)}
        </g>
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
 * The wind mark on a leg: a chevron pointing the way the wind is fair, sized by how hard it blows.
 * A leg with no fair direction gets a small open circle instead — calm is information too.
 */
function WindMark({
  leg,
}: {
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
      <circle cx={mx} cy={my} r={2.6} fill="none" stroke={CHART.windFoul} strokeWidth={1} opacity={0.75} pointerEvents="none">
        <title>{leg.windLabel}</title>
      </circle>
    );
  }

  const sign = leg.fairWay === 'forward' ? 1 : -1;
  const angle = (Math.atan2((leg.y2 - leg.y1) * sign, (leg.x2 - leg.x1) * sign) * 180) / Math.PI;
  const size = 3 + leg.strength * 0.9;

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
}: {
  ship: Ship;
  colour: string;
  selected: boolean;
  captainName: string;
  isRival: boolean;
}) {
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
          ship.hold.map((_, i) => (
            <circle
              key={i}
              cx={(i - (ship.hold.length - 1) / 2) * 4.4}
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
        {isRival ? captainName : ship.name}
      </text>
      <title>
        {`${ship.name} — ${captainName}. ${
          ship.hold.length ? `${ship.hold.length} of 3 slots full` : 'running light'
        }${dest ? `, bound for ${PORT_BY_ID[dest]?.name ?? dest}` : ', in port'}`}
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
