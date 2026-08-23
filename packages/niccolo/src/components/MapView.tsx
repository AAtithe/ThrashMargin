import { useEffect, useMemo, useRef, useState } from 'react';
import { CHART, FONT, GEO, UI } from '../theme';
import { CITIES, ROUTES, findCity, findRouteById, otherEndOfRoute } from '../sim/content';
import {
  CHART as BACKDROP,
  CITY_POINTS,
  VB_HEIGHT,
  VB_WIDTH,
  WORLD_COPIES,
  clampPanY,
  unwrapRun,
  wrapDx,
  wrapPanX,
} from '../sim/geography';
import type { City, LabelSide, Vessel } from '../sim/types';

const SHIP_COLOR = UI.ensign;
const COURIER_COLOR = UI.good;

/**
 * Marker and text sizes are authored as their approximate on-screen PIXEL size, because every one
 * of them is counter-scaled by 1/zoom at draw time (see `inv` in the component). A glyph therefore
 * ends up at roughly `size * contentScale` screen pixels whatever the zoom — the one thing that
 * could not be copied from Tea Race, since Bruges and Ghent sit 40km apart (half a degree, ~2
 * viewBox units of 1600) and a world-unit marker of any legible size would overlap its neighbours
 * at every zoom.
 */
const ZOOM_MIN = 1;
/** Measured live: the Flanders cluster fully separates, every label showing, zero overlaps, at
 * about 21x — this is set well above that. */
const ZOOM_MAX = 60;
const ZOOM_STEP = 1.12;

/** A port's filled dot; an inland city is the same dot left open (see `CityMark` below). Replaces
 * the previous turreted-castle glyph — a plain, larger click target reads at a glance and needs no
 * door/flag detail to stay legible at small sizes. */
const PORT_RADIUS = 9;
const INLAND_RADIUS = 6;
const MARKER_STROKE = 1.8;

/** Half-extent of each marker in chart units, used to clear labels and fan docked vessels. */
const MARKER_HALF = { port: PORT_RADIUS, inland: INLAND_RADIUS };

/** Halo half-width, in chart units before counter-scaling. Collision boxes have to include it:
 * the painted extent of a haloed label is wider than its glyphs. */
const LABEL_HALO = 3;

// Font sizes are pre-counter-scale, so these are close to their final on-screen pixel size.
const CITY_FONT = 13;
const ROUTE_FONT = 10;
const VESSEL_FONT = 12;
/** How far a route's week-count sits off its own line, in screen pixels. */
const ROUTE_LABEL_NUDGE = 7;

const LABEL_OFFSET: Record<LabelSide, [number, number]> = {
  n: [0, -17],
  s: [0, 18],
  e: [13, 4],
  w: [-13, 4],
};
type TextAnchor = 'start' | 'middle' | 'end';
const LABEL_ANCHOR: Record<LabelSide, TextAnchor> = { n: 'middle', s: 'middle', e: 'start', w: 'end' };

const DOCK_SLOT_ANGLES_DEG: Record<number, number[]> = {
  1: [-90],
  2: [-120, -60],
  3: [-120, -90, -60],
};

const DOCK_RADIUS = {
  port: MARKER_HALF.port + 9,
  inland: MARKER_HALF.inland + 9,
};

const cityPoint = (c: City) => CITY_POINTS[c.id];

/** Distance, in world units, from each city to its nearest neighbour. Static, so computed once. */
const NEAREST_NEIGHBOUR: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const a of CITIES as City[]) {
    const pa = cityPoint(a);
    let best = Infinity;
    for (const b of CITIES as City[]) {
      if (b.id === a.id) continue;
      const pb = cityPoint(b);
      best = Math.min(best, Math.hypot(wrapDx(pa.x, pb.x), pb.y - pa.y));
    }
    out[a.id] = best;
  }
  return out;
})();

/** Smallest a crowded marker is allowed to shrink to. Below this it stops reading as a place. */
const MIN_MARKER_SCALE = 0.5;

/** A port's on-screen radius at `ZOOM_MIN`, in the same pixel terms as every other size constant
 * here — see the file-level note on counter-scaling. */
const PORT_RADIUS_AT_MIN_ZOOM = PORT_RADIUS;
/** Where a port's marker grows to once there's room for it — about the size the old castle glyph
 * drew at, and comfortably above the ~24px a mouse or fingertip actually wants to land on. */
const PORT_RADIUS_AT_MAX_GROWTH = 16;
/** Zoom level by which a marker has grown to its full size. Chosen well short of `ZOOM_MAX` (60):
 * the top of the range exists to separate the tightest clusters (Bruges/Ghent), not to keep
 * growing an already-comfortable target. */
const MARKER_GROWTH_ZOOM = 10;

/**
 * How large to draw a city's marker at this zoom, as a multiple of its base radius.
 *
 * This used to cap out at exactly 1 (full size) and stay there — full-size ports are ~18px wide,
 * fine as a click target on their own, but fixed at that size forever meant zooming in bought you
 * a bigger *map* without ever buying a bigger, easier-to-click *marker*, which read as the icons
 * shrinking relative to everything else that did grow. Now the target itself grows with zoom, up
 * to `PORT_RADIUS_AT_MAX_GROWTH`, and only the crowding check below still holds it back.
 *
 * The crowding check is unchanged in spirit: Bruges and Ghent are half a degree apart — under 5px
 * at the default framing — so at wide zooms a whole cluster would be one unreadable heap of dots.
 * Rather than aggregate them behind a "3 cities here" badge (which would hide real, clickable
 * places), each marker's growth is capped by its neighbour's own distance and catches up once zoom
 * opens the gap. Both curves are continuous, so nothing pops as you scroll or zoom.
 */
function markerScale(c: City, inv: number): number {
  const zoom = 1 / inv;
  const growth = Math.min(1, Math.max(0, (zoom - ZOOM_MIN) / (MARKER_GROWTH_ZOOM - ZOOM_MIN)));
  const desiredRadius = PORT_RADIUS_AT_MIN_ZOOM + (PORT_RADIUS_AT_MAX_GROWTH - PORT_RADIUS_AT_MIN_ZOOM) * growth;
  const gap = NEAREST_NEIGHBOUR[c.id] ?? Infinity;
  // The gap is in world units; at this zoom two neighbours can each claim up to 0.45 of it
  // (screen-pixel terms, same convention as `ring` below) before their full extents would touch.
  const crowdCap = Number.isFinite(gap) ? gap * 0.45 * zoom : Infinity;
  return Math.max(MIN_MARKER_SCALE, Math.min(desiredRadius, crowdCap) / PORT_RADIUS);
}

/** Rough text box in chart units. */
function textBox(text: string, fontSize: number, x: number, y: number, anchor: TextAnchor) {
  const w = text.length * fontSize * 0.55;
  const h = fontSize * 1.1;
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { left, right: left + w, top: y - h * 0.8, bottom: y + h * 0.2 };
}
type Box = ReturnType<typeof textBox>;
const boxesOverlap = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Default view: frames every city currently in the game rather than the whole globe, which at
 * zoom 1 would leave the playable area a sliver. Computed from `CITIES`, so a future chapter that
 * adds a city updates this with no code change.
 */
const DEFAULT_VIEW = (() => {
  const pts = unwrapRun((CITIES as City[]).map(cityPoint));
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const MARGIN = 1.25;
  const zoom = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.min(VB_WIDTH / ((maxX - minX) * MARGIN), VB_HEIGHT / ((maxY - minY) * MARGIN))),
  );
  return {
    zoom,
    panX: wrapPanX(VB_WIDTH / 2 - cx * zoom, zoom),
    panY: clampPanY(VB_HEIGHT / 2 - cy * zoom, zoom),
  };
})();

/**
 * Where each route's sailing-time label goes, and whether it can be drawn at all. Nudged
 * perpendicular to its own leg so it sits beside the line rather than on it, then dropped if it
 * would still land on a city's icon or name.
 */
const ROUTE_LABELS = (() => {
  const cityBoxes: Box[] = [];
  for (const c of CITIES as City[]) {
    const p = cityPoint(c);
    const half = c.port ? MARKER_HALF.port : MARKER_HALF.inland;
    cityBoxes.push({ left: p.x - half, right: p.x + half, top: p.y - half, bottom: p.y + half });
    const side: LabelSide = c.labelSide ?? 'e';
    const [dx, dy] = LABEL_OFFSET[side];
    cityBoxes.push(textBox(c.name, CITY_FONT, p.x + dx, p.y + dy, LABEL_ANCHOR[side]));
  }
  return ROUTES.flatMap(r => {
    const from = findCity(r.from);
    const to = findCity(r.to);
    if (!from || !to) return [];
    const a = cityPoint(from);
    const b = cityPoint(to);
    const dx = wrapDx(a.x, b.x);
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const sign = dy > 0 ? -1 : 1;
    const mx = a.x + dx / 2;
    const my = a.y + dy / 2;
    const nx = (-dy / len) * sign;
    const ny = (dx / len) * sign;
    const text = `${r.distanceWeeks}w`;
    if (cityBoxes.some(cb => boxesOverlap(textBox(text, ROUTE_FONT, mx + nx * ROUTE_LABEL_NUDGE, my + ny * ROUTE_LABEL_NUDGE, 'middle'), cb))) {
      return [];
    }
    return [{ id: r.id, mx, my, nx, ny, text }];
  });
})();

interface VesselRender {
  vessel: Vessel;
  x: number;
  y: number;
  rotationDeg: number | null;
}

/**
 * Docked vessels fan out to a small ring of slots so they never cover the city's own marker; a
 * vessel under way is interpolated along its leg the short way round the globe.
 */
function computeVesselRenders(vessels: Vessel[], inv: number): VesselRender[] {
  const dockedGroups = new Map<string, Vessel[]>();
  for (const v of vessels) {
    if (v.destination) continue;
    const group = dockedGroups.get(v.location) ?? [];
    group.push(v);
    dockedGroups.set(v.location, group);
  }
  for (const group of dockedGroups.values()) group.sort((a, b) => a.id.localeCompare(b.id));

  const renders: VesselRender[] = [];
  for (const v of vessels) {
    if (v.destination) {
      const at = findCity(v.location);
      const to = findCity(v.destination);
      const route = ROUTES.find(r => r.id === v.routeId);
      if (!at || !to || !route) continue;
      const a = cityPoint(at);
      const b = cityPoint(to);
      const dx = wrapDx(a.x, b.x);
      const dy = b.y - a.y;
      const t = (route.distanceWeeks - v.weeksRemaining) / route.distanceWeeks;
      renders.push({
        vessel: v,
        x: a.x + dx * t,
        y: a.y + dy * t,
        rotationDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      });
      continue;
    }
    const at = findCity(v.location);
    if (!at) continue;
    const p = cityPoint(at);
    const group = dockedGroups.get(v.location) ?? [v];
    const slotIndex = Math.max(0, group.findIndex(gv => gv.id === v.id));
    const angles = DOCK_SLOT_ANGLES_DEG[group.length] ?? DOCK_SLOT_ANGLES_DEG[3];
    const rad = (angles[slotIndex % angles.length] * Math.PI) / 180;
    const radius = (at.port ? DOCK_RADIUS.port : DOCK_RADIUS.inland) * inv;
    renders.push({
      vessel: v,
      x: p.x + radius * Math.cos(rad),
      y: p.y + radius * Math.sin(rad),
      rotationDeg: null,
    });
  }
  return renders;
}

interface MapViewProps {
  vessels: Vessel[];
  selectedVesselId: string | null;
  onSelectCity: (cityId: string) => void;
  onSelectVessel: (vesselId: string) => void;
  cityInfoAge: Record<string, number | null>;
  previewedCityId?: string | null;
}

/** Fog by information age: fresh news reads solid, old or absent news fades the city out. */
function fogOpacity(age: number | null): number {
  if (age === null) return 0.4;
  if (age <= 2) return 1;
  return Math.max(0.55, 1 - age * 0.035);
}

/** A one-line hover summary — what the city popup would otherwise make you click to find out. */
function cityTooltip(c: City, age: number | null, reachable: boolean, hasSelection: boolean): string {
  const report =
    age === null ? 'no report yet' : age <= 2 ? 'prices are fresh' : `report is ${age} week${age === 1 ? '' : 's'} stale`;
  const reach = hasSelection ? (reachable ? ' — reachable in one hop' : ' — not directly reachable') : '';
  return `${c.name} (${report})${reach}`;
}

function CompassRose({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(0.55)`} opacity={0.6} pointerEvents="none">
      <circle r={26} fill="none" stroke={CHART.label} strokeWidth={1.4} />
      <circle r={2} fill={CHART.label} />
      <line x1={0} y1={-24} x2={0} y2={24} stroke={CHART.label} strokeWidth={1.4} />
      <line x1={-24} y1={0} x2={24} y2={0} stroke={CHART.label} strokeWidth={1.4} />
      <path d="M 0,-24 L 5,-9 L 0,0 L -5,-9 Z" fill={CHART.label} />
      <text y={-30} textAnchor="middle" fontSize={11} fill={CHART.label} fontFamily={FONT.body}>
        N
      </text>
    </g>
  );
}

/**
 * A city's mark: a filled dot for a port, the same dot left open for an inland city — Tea Race's
 * own marker, unchanged, since both games' charts now share one visual language. `fill` carries
 * whatever state colour applies (reachable highlight vs. the plain chart colour); an inland city
 * always draws with `fill="none"` so "port vs. inland" reads as filled-vs-open at any zoom, the one
 * distinction the previous castle/tower glyphs existed to make.
 */
function CityMark({ port, fill, opacity }: { port: boolean; fill: string; opacity: number }) {
  const r = port ? PORT_RADIUS : INLAND_RADIUS;
  return (
    <circle
      r={r}
      fill={port ? fill : 'none'}
      stroke={fill}
      strokeWidth={MARKER_STROKE}
      fillOpacity={opacity}
      strokeOpacity={opacity}
    />
  );
}

export default function MapView({
  vessels,
  selectedVesselId,
  onSelectCity,
  onSelectVessel,
  cityInfoAge,
  previewedCityId,
}: MapViewProps) {
  const selected = vessels.find(v => v.id === selectedVesselId) ?? null;
  const [hoveredVesselId, setHoveredVesselId] = useState<string | null>(null);
  const [hoveredCityId, setHoveredCityId] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [view, setView] = useState(DEFAULT_VIEW);

  /** Rendered scale of the viewBox inside the element, accounting for letterboxing. */
  const contentScale = () => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return 0;
    return Math.min(rect.width / VB_WIDTH, rect.height / VB_HEIGHT);
  };

  // Scroll-to-zoom toward the cursor. Must be a real native listener: React registers `wheel`
  // passively and silently ignores preventDefault() inside a JSX onWheel handler.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = contentScale();
      if (!Number.isFinite(scale) || scale <= 0) return;
      const rect = svg.getBoundingClientRect();
      const vbX = (e.clientX - rect.left - (rect.width - VB_WIDTH * scale) / 2) / scale;
      const vbY = (e.clientY - rect.top - (rect.height - VB_HEIGHT * scale) / 2) / scale;
      setView(prev => {
        const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)));
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
    if (!isDragging) return;
    const scale = contentScale();
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !Number.isFinite(scale) || scale <= 0) return;
      setView(prev => ({
        zoom: prev.zoom,
        panX: wrapPanX(drag.panX + (e.clientX - drag.x) / scale, prev.zoom),
        panY: clampPanY(drag.panY + (e.clientY - drag.y) / scale, prev.zoom),
      }));
    };
    const end = () => {
      setIsDragging(false);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [isDragging]);

  const zoomBy = (factor: number) =>
    setView(prev => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
      const cx = VB_WIDTH / 2;
      const cy = VB_HEIGHT / 2;
      return {
        zoom,
        panX: wrapPanX(cx - ((cx - prev.panX) / prev.zoom) * zoom, zoom),
        panY: clampPanY(cy - ((cy - prev.panY) / prev.zoom) * zoom, zoom),
      };
    });

  /** Counter-scale for markers and text, so they hold a constant screen size at any zoom. */
  const inv = 1 / view.zoom;

  const vesselRenders = useMemo(() => computeVesselRenders(vessels, inv), [vessels, inv]);

  /**
   * The selected vessel's own path, current leg plus every queued leg after it — Tea Race draws
   * its selected ship's route the same way. Without this, "where is this vessel actually headed"
   * only exists in the Fleet popup's text; a queued multi-hop plan (Phase 15) had no visual trace
   * on the chart at all. Starts from the vessel's own live position (mid-leg if under way), not
   * just its origin port, so the line always begins exactly where the ship marker is drawn.
   */
  const plannedPath = useMemo(() => {
    if (!selected) return null;
    const startRender = vesselRenders.find(r => r.vessel.id === selected.id);
    const start = startRender ? { x: startRender.x, y: startRender.y } : cityPoint(findCity(selected.location)!);
    const stops = [start];
    let cursorId = selected.location;
    if (selected.destination) {
      const dest = findCity(selected.destination);
      if (!dest) return null;
      stops.push(cityPoint(dest));
      cursorId = selected.destination;
    }
    for (const routeId of selected.plannedRoute ?? []) {
      const route = findRouteById(routeId);
      if (!route) break;
      const nextId = otherEndOfRoute(route, cursorId);
      const nextCity = findCity(nextId);
      if (!nextCity) break;
      stops.push(cityPoint(nextCity));
      cursorId = nextId;
    }
    if (stops.length < 2) return null;
    return unwrapRun(stops)
      .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join('');
  }, [selected, vesselRenders]);

  /**
   * Which city labels to draw at this zoom. Every label is a constant screen size, so in world
   * units it covers `size / zoom` — shrinking as you zoom in. Labels are placed greedily in
   * priority order and any that would collide with one already placed is dropped.
   */
  const visibleLabels = useMemo(() => {
    const ranked = [...(CITIES as City[])].sort((a, b) => {
      const rank = (c: City) =>
        (c.id === previewedCityId ? 0 : c.id === hoveredCityId ? 1 : c.port ? 2 : 3);
      return rank(a) - rank(b) || a.name.length - b.name.length;
    });
    const placed: Box[] = [];
    const keep = new Set<string>();
    for (const c of ranked) {
      const p = cityPoint(c);
      const side: LabelSide = c.labelSide ?? 'e';
      const [dx, dy] = LABEL_OFFSET[side];
      const ms = markerScale(c, inv);
      const raw = textBox(c.name, CITY_FONT * inv, p.x + dx * inv * ms, p.y + dy * inv * ms, LABEL_ANCHOR[side]);
      const pad = LABEL_HALO * inv;
      const box = { left: raw.left - pad, right: raw.right + pad, top: raw.top - pad, bottom: raw.bottom + pad };
      const forced = c.id === previewedCityId || c.id === hoveredCityId;
      const clashes =
        !forced &&
        (placed.some(q => boxesOverlap(box, q)) ||
          (CITIES as City[]).some(o => {
            if (o.id === c.id) return false;
            const op = cityPoint(o);
            const oh = o.port ? MARKER_HALF.port : MARKER_HALF.inland;
            const os = markerScale(o, inv);
            return boxesOverlap(box, {
              left: op.x - oh * inv * os, right: op.x + oh * inv * os,
              top: op.y - oh * inv * os, bottom: op.y + oh * inv * os,
            });
          }));
      if (!clashes) {
        placed.push(box);
        keep.add(c.id);
      }
    }
    return keep;
  }, [inv, previewedCityId, hoveredCityId]);

  /** One full copy of the world's content, offset east or west. Drawing three of these side by
   * side is what makes panning round the world seamless. */
  const worldCopy = (offset: number) => (
    <g key={offset} transform={offset ? `translate(${offset} 0)` : undefined}>
      <path d={BACKDROP.graticule} fill="none" stroke={CHART.graticule} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <path d={BACKDROP.equator} fill="none" stroke={CHART.equator} strokeWidth={0.7} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />

      {BACKDROP.land.map((d, i) => (
        <path
          key={`l${i}`}
          d={d}
          fill="url(#geo-hatch)"
          stroke={GEO.hatch}
          strokeWidth={0.7}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {BACKDROP.seas.map((d, i) => (
        <path key={`s${i}`} d={d} fill={CHART.sea} stroke={GEO.hatch} strokeWidth={0.55} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}

      <path d={BACKDROP.rivers} fill="none" stroke={GEO.water} strokeWidth={0.4} strokeLinecap="round" opacity={0.85} vectorEffect="non-scaling-stroke" />
      <path d={BACKDROP.mountains} fill="none" stroke={GEO.relief} strokeWidth={0.45} strokeLinecap="round" vectorEffect="non-scaling-stroke" />

      {BACKDROP.labels.map((lb, i) => (
        <text
          key={i}
          x={lb.x}
          y={lb.y}
          textAnchor="middle"
          fontStyle="italic"
          fontSize={(lb.kind === 'sea' ? 14 : 12) * inv}
          fill={lb.kind === 'sea' ? GEO.water : CHART.label}
          fillOpacity={lb.kind === 'sea' ? 0.55 : 0.4}
          fontFamily={FONT.body}
          pointerEvents="none"
        >
          {lb.text}
        </text>
      ))}

      {ROUTES.map(r => {
        const from = findCity(r.from);
        const to = findCity(r.to);
        if (!from || !to) return null;
        const a = cityPoint(from);
        const b = cityPoint(to);
        const dx = wrapDx(a.x, b.x);
        return (
          <line
            key={r.id}
            x1={a.x}
            y1={a.y}
            x2={a.x + dx}
            y2={b.y}
            stroke={CHART.route}
            strokeWidth={0.7}
            strokeDasharray={r.type === 'sea' ? '2 1.6' : r.type === 'river' ? '0.8 0.8' : undefined}
            opacity={0.75}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {offset === 0 && plannedPath && (
        <path d={plannedPath} stroke={CHART.routeLive} strokeWidth={2.2} fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.85} pointerEvents="none" />
      )}

      {offset === 0 &&
        ROUTE_LABELS.map(rl => (
          <text
            key={rl.id}
            x={rl.mx + rl.nx * ROUTE_LABEL_NUDGE * inv}
            y={rl.my + rl.ny * ROUTE_LABEL_NUDGE * inv}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={ROUTE_FONT * inv}
            fill={CHART.distance}
            fontFamily={FONT.data}
            stroke={CHART.labelHalo}
            strokeWidth={3 * inv}
            paintOrder="stroke"
            strokeLinejoin="round"
            pointerEvents="none"
          >
            {rl.text}
          </text>
        ))}

      {(CITIES as City[]).map(c => {
        const p = cityPoint(c);
        const reachable = selected
          ? ROUTES.some(r => {
              if (selected.kind === 'courier' && r.type !== 'land') return false;
              return (r.from === selected.location && r.to === c.id) || (r.to === selected.location && r.from === c.id);
            })
          : false;
        const opacity = fogOpacity(cityInfoAge[c.id] ?? null);
        const isPreviewed = c.id === previewedCityId;
        const isHovered = c.id === hoveredCityId;
        const fill = reachable ? CHART.routeLive : CHART.port;
        const half = c.port ? MARKER_HALF.port : MARKER_HALF.inland;
        const mScale = markerScale(c, inv);
        const ring = half * mScale + 5;
        const side: LabelSide = c.labelSide ?? 'e';
        const [ldx, ldy] = LABEL_OFFSET[side];
        const showLabel = offset === 0 && (visibleLabels.has(c.id) || isPreviewed || isHovered);
        return (
          <g
            key={c.id}
            id={offset === 0 ? `city-node-${c.id}` : undefined}
            onClick={() => onSelectCity(c.id)}
            onPointerEnter={() => setHoveredCityId(c.id)}
            onPointerLeave={() => setHoveredCityId(id => (id === c.id ? null : id))}
            style={{ cursor: 'pointer' }}
          >
            <title>{cityTooltip(c, cityInfoAge[c.id] ?? null, reachable, !!selected)}</title>
            {isPreviewed && (
              <circle cx={p.x} cy={p.y} r={ring * inv} fill="none" stroke={CHART.routeLive} strokeWidth={1.6 * inv} />
            )}
            {isHovered && !isPreviewed && (
              <circle
                cx={p.x} cy={p.y} r={ring * inv}
                fill="none" stroke={CHART.routeLive} strokeWidth={1.2 * inv} opacity={0.6}
                pointerEvents="none"
              />
            )}
            {/* The real click/tap target — deliberately bigger than the visible mark and always
                filled, even for an inland city's own open ring. Without this, an inland city (fill
                "none") is only clickable on its thin 1.8px stroke, and even a filled port is no
                easier to hit than its plain visual radius. Invisible, so it never changes what the
                chart looks like. */}
            <circle cx={p.x} cy={p.y} r={Math.max(half * mScale, 11) * inv} fill="transparent" pointerEvents="all" />
            <g transform={`translate(${p.x},${p.y}) scale(${inv * mScale})`} pointerEvents="none">
              <CityMark port={c.port} fill={fill} opacity={opacity} />
            </g>
            {showLabel && (
              <text
                x={p.x + ldx * inv * mScale}
                y={p.y + ldy * inv * mScale}
                textAnchor={LABEL_ANCHOR[side]}
                fontSize={CITY_FONT * inv}
                fill={isHovered ? CHART.routeLive : CHART.label}
                fillOpacity={opacity}
                fontFamily={FONT.body}
                stroke={CHART.labelHalo}
                strokeWidth={3 * inv}
                paintOrder="stroke"
                strokeLinejoin="round"
                /* Load-bearing: a label extends past its own icon, so without this it covers — and
                   eats the click meant for — whichever neighbour it overlaps. */
                pointerEvents="none"
              >
                {c.name}
              </text>
            )}
          </g>
        );
      })}

      {vesselRenders.map(({ vessel: v, x, y, rotationDeg }) => {
        const color = v.kind === 'ship' ? SHIP_COLOR : COURIER_COLOR;
        const isSelected = v.id === selectedVesselId;
        const showLabel = isSelected || v.id === hoveredVesselId;
        const at = findCity(v.location);
        const to = v.destination ? findCity(v.destination) : null;
        return (
          <g
            key={v.id}
            onClick={() => onSelectVessel(v.id)}
            onPointerEnter={() => setHoveredVesselId(v.id)}
            onPointerLeave={() => setHoveredVesselId(id => (id === v.id ? null : id))}
            style={{ cursor: 'pointer' }}
          >
            <title>{`${v.name} — ${to ? `en route to ${to.name}` : `docked at ${at?.name ?? v.location}`}`}</title>
            {/* Same fixed-minimum invisible hit target as a city mark — a selected ship's own
                triangle is only ~12px and a docked courier's dot smaller still. */}
            <circle cx={x} cy={y} r={11 * inv} fill="transparent" pointerEvents="all" />
            {v.kind === 'ship' ? (
              <path
                d="M 0,-7 L 6,6 L -6,6 Z"
                transform={`translate(${x},${y}) scale(${1.0 * inv})`}
                fill={color}
                stroke={isSelected ? CHART.routeLive : CHART.labelHalo}
                strokeWidth={isSelected ? 2 : 1}
              />
            ) : (
              <g transform={`translate(${x},${y}) scale(${0.42 * inv})`}>
                <circle r={isSelected ? 6 : 5} fill={color} stroke={isSelected ? CHART.routeLive : CHART.labelHalo} strokeWidth={isSelected ? 2 : 1} />
                {rotationDeg !== null && (
                  <path d="M 5,0 L -3,-4 L -3,4 Z" transform={`rotate(${rotationDeg})`} fill={color} stroke={CHART.labelHalo} strokeWidth={0.75} />
                )}
              </g>
            )}
            {showLabel && (
              <text
                x={x + 10 * inv}
                y={y + 4 * inv}
                fontSize={VESSEL_FONT * inv}
                fill={CHART.label}
                fontFamily={FONT.body}
                stroke={CHART.labelHalo}
                strokeWidth={3 * inv}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {v.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        style={{
          width: '100%',
          height: '100%',
          background: GEO.void,
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={e => {
          if (e.button !== 0) return;
          dragRef.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
          setIsDragging(true);
        }}
        role="img"
        aria-label="World chart of trading cities and routes"
      >
        <defs>
          {/* Counter-scaled like every other mark: the pattern's user space is the zoomed group's,
              so without this the hachure spreads into wide slabs as you zoom in instead of holding
              its density. */}
          <pattern
            id="geo-hatch"
            width={3.2}
            height={3.2}
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(35) scale(${inv})`}
          >
            {/* Opaque ground inside the tile, slightly oversized so rotated tiles leave no seams. */}
            <rect x={-0.5} y={-0.5} width={4.2} height={4.2} fill={GEO.landGround} />
            <line x1={0} y1={0} x2={0} y2={3.2} stroke={GEO.hatch} strokeWidth={0.35 * inv} opacity={0.5} />
          </pattern>
        </defs>

        {/* Outside the transformed group on purpose: inside it, the sea would pan away and leave
            bare ground at the sheet's edges. Deliberately drawn far larger than the viewBox to
            cover the pane's letterbox bars at any aspect ratio. */}
        <rect
          x={-VB_WIDTH}
          y={-VB_HEIGHT}
          width={VB_WIDTH * 3}
          height={VB_HEIGHT * 3}
          fill={CHART.sea}
        />

        <g transform={`translate(${view.panX},${view.panY}) scale(${view.zoom})`}>
          {WORLD_COPIES.map(worldCopy)}
        </g>

        <CompassRose x={VB_WIDTH - 42} y={46} />
      </svg>

      <div style={ZOOM_CONTROLS}>
        <button style={ZOOM_BUTTON} onClick={() => zoomBy(ZOOM_STEP ** 3)} aria-label="Zoom in">
          +
        </button>
        <button style={ZOOM_BUTTON} onClick={() => zoomBy(1 / ZOOM_STEP ** 3)} aria-label="Zoom out">
          −
        </button>
        <button
          style={{ ...ZOOM_BUTTON, fontSize: '0.6rem' }}
          onClick={() => setView(DEFAULT_VIEW)}
          aria-label="Fit every city in view"
        >
          fit
        </button>
      </div>
    </div>
  );
}

const ZOOM_CONTROLS: React.CSSProperties = {
  position: 'absolute',
  right: '0.6rem',
  bottom: '0.6rem',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

/* Driven by the chart palette, not hardcoded — these sit on the sea, so they have to change with
   it (a dark-chart button over a pale printed board would be a black box floating in the water). */
const ZOOM_BUTTON: React.CSSProperties = {
  width: 44,
  height: 44,
  background: CHART.sea,
  border: `1px solid ${CHART.coast}`,
  color: CHART.coast,
  fontFamily: FONT.data,
  fontSize: '1.1rem',
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: 2,
  opacity: 0.92,
};
