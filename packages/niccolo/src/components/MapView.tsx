import { useEffect, useMemo, useRef, useState } from 'react';
import { CITIES, ROUTES, findCity } from '../sim/content';
import {
  CHART,
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

const INK = '#4a3d28';
const PARCHMENT = '#c9b88a';
const GOLD = '#e8d5a3';
const SHIP_COLOR = '#b5451a';
const COURIER_COLOR = '#3a6b5a';
const VOID_COLOR = '#0e0b07';
const SEA_COLOR = '#182430';

/** Chart palette, kept from the previous backdrop so the map still reads as this game's own dark
 * parchment rather than tea-race's printed board. Only the projection underneath changed. */
const GEO_COAST = '#998965';
const GEO_COAST_GHOST = '#716347';
const GEO_HATCH = '#695c40';
const GEO_RELIEF = '#817253';
const GEO_WATER = '#747c82';

/**
 * Marker and text sizes are authored as their approximate on-screen PIXEL size, because every one
 * of them is counter-scaled by 1/zoom at draw time (see `inv` in the component). A glyph therefore
 * ends up at roughly `size * contentScale` screen pixels whatever the zoom.
 *
 * That is the one thing here that could not be copied from tea-race, and it is what makes a
 * real-geography chart usable for this game. Tea-race authors its port marks in world units, which
 * is fine when the nearest two ports are an ocean apart. Bruges and Ghent are 40km apart — half a
 * degree, about 2 viewBox units out of 1600 — so a world-unit marker of any legible size overlaps
 * its neighbours by construction AND STAYS overlapped however far you zoom, because the gap and the
 * marker grow together. Counter-scaling breaks that tie: the gap grows with zoom, the marker does
 * not, so zooming into a cluster genuinely separates it.
 */
const ZOOM_MIN = 1;
/** Far above tea-race's 6, because this game's cities are packed into ~57 degrees of longitude
 * rather than spread round the globe. Measured live: the Flanders cluster is fully separated, with
 * every label showing and zero overlaps of any kind, at about 21x. */
const ZOOM_MAX = 60;
const ZOOM_STEP = 1.12;

/** Castle glyphs are authored around a 24x28 box; this scales that to final screen pixels. */
const CASTLE_SCALE = 1.0;
const PORT_CASTLE_PATH =
  'M -12,14 L -12,-4 L -8,-4 L -8,-9 L -4,-9 L -4,-4 L -1,-4 L -1,-14 L 1,-14 L 1,-4 L 4,-4 L 4,-9 L 8,-9 L 8,-4 L 12,-4 L 12,14 Z';
const INLAND_CASTLE_PATH =
  'M -8,10 L -8,-4 L -5,-4 L -5,-10 L -2,-10 L -2,-4 L 2,-4 L 2,-10 L 5,-10 L 5,-4 L 8,-4 L 8,10 Z';
const PORT_CASTLE_DOOR = { x: -3, y: 2, width: 6, height: 12 };
const INLAND_CASTLE_DOOR = { x: -2, y: 3, width: 4, height: 7 };
const PORT_CASTLE_FLAG = 'M 0,-14 L 0,-20 M 0,-20 L 6,-18 L 0,-16';

/** Half-extent of each castle glyph in chart units, used to clear labels and fan docked vessels.
 * A port's height counts the pennant (which reaches y=-20 in glyph units), not just the towers —
 * otherwise a label tucked above a port sits straight through its flag. */
const CASTLE_HALF = {
  port: { w: 12 * CASTLE_SCALE, h: 20 * CASTLE_SCALE },
  inland: { w: 8 * CASTLE_SCALE, h: 10 * CASTLE_SCALE },
};

/** Halo half-width, in chart units before counter-scaling. Collision boxes have to include it:
 * the painted extent of a haloed label is wider than its glyphs, which is exactly the discrepancy
 * that made `getBoundingClientRect` and `getBBox` disagree when this was measured live. */
const LABEL_HALO = 3;

// Font sizes are pre-counter-scale, so these are close to their final on-screen pixel size.
const CITY_FONT = 13;
const ROUTE_FONT = 10;
const VESSEL_FONT = 12;

/** Label placement, from tea-race's chart. Offsets are in chart units. */
const LABEL_OFFSET: Record<LabelSide, [number, number]> = {
  n: [0, -17],
  s: [0, 23],
  e: [15, 4],
  w: [-15, 4],
};
type TextAnchor = 'start' | 'middle' | 'end';
const LABEL_ANCHOR: Record<LabelSide, TextAnchor> = { n: 'middle', s: 'middle', e: 'start', w: 'end' };

const DOCK_SLOT_ANGLES_DEG: Record<number, number[]> = {
  1: [-90],
  2: [-120, -60],
  3: [-120, -90, -60],
};

const DOCK_RADIUS = {
  port: Math.hypot(CASTLE_HALF.port.w, CASTLE_HALF.port.h) + 8,
  inland: Math.hypot(CASTLE_HALF.inland.w, CASTLE_HALF.inland.h) + 8,
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
const MIN_MARKER_SCALE = 0.42;

/**
 * How large to draw a city's marker at this zoom, as a fraction of full size.
 *
 * Full-size markers are ~24px wide, but Bruges and Ghent are half a degree apart — under 5px at the
 * default framing — so at wide zooms a whole cluster would be one unreadable heap of castles. Rather
 * than aggregate them behind a "3 cities here" badge (which would hide real, clickable places), each
 * marker simply shrinks toward its neighbour's distance and grows back to full size as zoom opens
 * the gap. It is continuous, so nothing pops as you scroll.
 */
function markerScale(c: City, inv: number): number {
  const gap = NEAREST_NEIGHBOUR[c.id] ?? Infinity;
  const fullWidth = 24 * CASTLE_SCALE * inv;
  if (!Number.isFinite(gap) || fullWidth <= 0) return 1;
  return Math.max(MIN_MARKER_SCALE, Math.min(1, (gap * 0.9) / fullWidth));
}

/** Rough text box in chart units; 0.55em per character is deliberately generous for Georgia. */
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
 * adds a city updates this with no code change. Longitudes are unwrapped first, so a game that one
 * day spans the dateline still frames the short way round.
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
 * would still land on a city's icon or name — a route label is decoration, a city name is not.
 */
const ROUTE_LABELS = (() => {
  const cityBoxes: Box[] = [];
  for (const c of CITIES as City[]) {
    const p = cityPoint(c);
    const half = c.port ? CASTLE_HALF.port : CASTLE_HALF.inland;
    cityBoxes.push({ left: p.x - half.w, right: p.x + half.w, top: p.y - half.h, bottom: p.y + half.h });
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
    const off = 3 * (dy > 0 ? -1 : 1);
    const x = a.x + dx / 2 + (-dy / len) * off;
    const y = a.y + dy / 2 + (dx / len) * off;
    const text = `${r.distanceWeeks}w`;
    if (cityBoxes.some(cb => boxesOverlap(textBox(text, ROUTE_FONT, x, y, 'middle'), cb))) return [];
    return [{ id: r.id, x, y, text }];
  });
})();

interface VesselRender {
  vessel: Vessel;
  x: number;
  y: number;
  rotationDeg: number | null;
}

/** Docked vessels fan out to a small ring of slots so they never cover the city's own marker; a
 * vessel under way is interpolated along its leg the short way round the globe. */
function computeVesselRenders(vessels: Vessel[]): VesselRender[] {
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
    const radius = at.port ? DOCK_RADIUS.port : DOCK_RADIUS.inland;
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
  cityInfoAge: Record<string, number | null>;
  previewedCityId?: string | null;
}

/** Fog by information age: fresh news reads solid, old or absent news fades the city out. */
function fogOpacity(age: number | null): number {
  if (age === null) return 0.35;
  if (age <= 2) return 1;
  return Math.max(0.5, 1 - age * 0.04);
}

function CompassRose({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(0.55)`} opacity={0.55} pointerEvents="none">
      <circle r={26} fill="none" stroke={GOLD} strokeWidth={1.4} />
      <circle r={2} fill={GOLD} />
      <line x1={0} y1={-24} x2={0} y2={24} stroke={GOLD} strokeWidth={1.4} />
      <line x1={-24} y1={0} x2={24} y2={0} stroke={GOLD} strokeWidth={1.4} />
      <path d="M 0,-24 L 5,-9 L 0,0 L -5,-9 Z" fill={GOLD} />
      <text y={-30} textAnchor="middle" fontSize={11} fill={GOLD} fontFamily="Georgia, serif">
        N
      </text>
    </g>
  );
}

export default function MapView({
  vessels,
  selectedVesselId,
  onSelectCity,
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
      // A momentarily zero-sized SVG (it happens behind a modal) would make this NaN, and once NaN
      // is in the view state nothing recovers it.
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
  // SVG-scoped listener would leave the drag stuck mid-pan. Pointer events cover mouse, touch and
  // pen from one path; `pointercancel` matters because the browser fires it (and no `pointerup`)
  // when it steals a gesture.
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

  const vesselRenders = useMemo(() => computeVesselRenders(vessels), [vessels]);

  /** Counter-scale for markers and text, so they hold a constant screen size at any zoom. See the
   * note on the size constants at the top of this file for why that is load-bearing here. */
  const inv = 1 / view.zoom;

  /**
   * Which city labels to draw at this zoom. Every label is a constant screen size, so in world
   * units it covers `size / zoom` — shrinking as you zoom in. Labels are placed greedily in
   * priority order and any that would collide with one already placed is dropped, so a dense
   * cluster shows a few names when far out and all of them once you zoom in. The city under the
   * cursor, and the one open in the sidebar, always win a slot.
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
      // Same geometry as the drawn label, expressed in world units at this zoom.
      const ms = markerScale(c, inv);
      const raw = textBox(c.name, CITY_FONT * inv, p.x + dx * inv * ms, p.y + dy * inv * ms, LABEL_ANCHOR[side]);
      const pad = LABEL_HALO * inv;
      const box = { left: raw.left - pad, right: raw.right + pad, top: raw.top - pad, bottom: raw.bottom + pad };
      // The city in the sidebar and the one under the cursor are shown come what may — but they
      // must still RESERVE their space, or a later label is placed straight on top of them. (That
      // was a real bug: Bruges is previewed by default, so Antwerp's label landed over it.)
      const forced = c.id === previewedCityId || c.id === hoveredCityId;
      const clashes =
        !forced &&
        (placed.some(q => boxesOverlap(box, q)) ||
          (CITIES as City[]).some(o => {
            if (o.id === c.id) return false;
            const op = cityPoint(o);
            const oh = o.port ? CASTLE_HALF.port : CASTLE_HALF.inland;
            const os = markerScale(o, inv);
            return boxesOverlap(box, {
              left: op.x - oh.w * inv * os, right: op.x + oh.w * inv * os,
              top: op.y - oh.h * inv * os, bottom: op.y + oh.h * inv * os,
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
      <path d={CHART.graticule} fill="none" stroke={PARCHMENT} strokeWidth={0.25} opacity={0.12} vectorEffect="non-scaling-stroke" />
      <path d={CHART.equator} fill="none" stroke={PARCHMENT} strokeWidth={0.4} opacity={0.2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />

      {CHART.land.map((d, i) => (
        <path
          key={`l${i}`}
          d={d}
          fill="url(#geo-hatch)"
          stroke={GEO_COAST}
          strokeWidth={0.55}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {CHART.seas.map((d, i) => (
        <path key={`s${i}`} d={d} fill={SEA_COLOR} stroke={GEO_COAST} strokeWidth={0.45} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}

      <path d={CHART.rivers} fill="none" stroke={GEO_WATER} strokeWidth={0.35} strokeLinecap="round" opacity={0.8} vectorEffect="non-scaling-stroke" />
      <path d={CHART.mountains} fill="none" stroke={GEO_RELIEF} strokeWidth={0.4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />

      {CHART.labels.map((lb, i) => (
        <text
          key={i}
          x={lb.x}
          y={lb.y}
          textAnchor="middle"
          fontStyle="italic"
          fontSize={(lb.kind === 'sea' ? 14 : 12) * inv}
          fill={lb.kind === 'sea' ? GEO_WATER : PARCHMENT}
          fillOpacity={lb.kind === 'sea' ? 0.5 : 0.45}
          fontFamily="Georgia, serif"
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
            stroke={GOLD}
            strokeWidth={0.5}
            strokeDasharray={r.type === 'sea' ? '2 1.6' : r.type === 'river' ? '0.8 0.8' : undefined}
            opacity={0.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {offset === 0 &&
        ROUTE_LABELS.map(rl => (
          <text
            key={rl.id}
            x={rl.x}
            y={rl.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={ROUTE_FONT * inv}
            fill={GOLD}
            fillOpacity={0.65}
            fontFamily="Georgia, serif"
            stroke={VOID_COLOR}
            strokeWidth={2.5 * inv}
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
        const fill = reachable ? GOLD : PARCHMENT;
        const half = c.port ? CASTLE_HALF.port : CASTLE_HALF.inland;
        const mScale = markerScale(c, inv);
        const ring = Math.hypot(half.w, half.h) * mScale + 4;
        const side: LabelSide = c.labelSide ?? 'e';
        const [ldx, ldy] = LABEL_OFFSET[side];
        // Only the centre copy carries ids/labels; the wrapped copies are pure decoration, so a
        // duplicate of every label does not fight the real one for space.
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
            {isPreviewed && (
              <circle cx={p.x} cy={p.y} r={ring * inv} fill="none" stroke={GOLD} strokeWidth={1.4 * inv} />
            )}
            {isHovered && !isPreviewed && (
              <circle
                cx={p.x} cy={p.y} r={ring * inv}
                fill="none" stroke={GOLD} strokeWidth={1 * inv} opacity={0.55}
                pointerEvents="none"
              />
            )}
            <g transform={`translate(${p.x},${p.y}) scale(${CASTLE_SCALE * inv * mScale})`} fillOpacity={opacity}>
              <path d={c.port ? PORT_CASTLE_PATH : INLAND_CASTLE_PATH} fill={fill} stroke={INK} strokeWidth={1.5} />
              <rect {...(c.port ? PORT_CASTLE_DOOR : INLAND_CASTLE_DOOR)} fill={INK} />
              {c.port && <path d={PORT_CASTLE_FLAG} fill="none" stroke={fill} strokeWidth={1.5} />}
            </g>
            {showLabel && (
              <text
                x={p.x + ldx * inv * mScale}
                y={p.y + ldy * inv * mScale}
                textAnchor={LABEL_ANCHOR[side]}
                fontSize={CITY_FONT * inv}
                fill={isHovered ? GOLD : PARCHMENT}
                fillOpacity={opacity}
                fontFamily="Georgia, serif"
                stroke={VOID_COLOR}
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
        return (
          <g
            key={v.id}
            onPointerEnter={() => setHoveredVesselId(v.id)}
            onPointerLeave={() => setHoveredVesselId(id => (id === v.id ? null : id))}
            style={{ cursor: 'default' }}
          >
            {v.kind === 'ship' ? (
              <path
                d="M 0,-7 L 6,6 L -6,6 Z"
                transform={`translate(${x},${y}) scale(${1.0 * inv})`}
                fill={color}
                stroke={isSelected ? GOLD : '#000'}
                strokeWidth={isSelected ? 2 : 1}
              />
            ) : (
              <g transform={`translate(${x},${y}) scale(${0.42 * inv})`}>
                <circle r={isSelected ? 6 : 5} fill={color} stroke={isSelected ? GOLD : '#000'} strokeWidth={isSelected ? 2 : 1} />
                {rotationDeg !== null && (
                  <path d="M 5,0 L -3,-4 L -3,4 Z" transform={`rotate(${rotationDeg})`} fill={color} stroke="#000" strokeWidth={0.75} />
                )}
              </g>
            )}
            {showLabel && (
              <text
                x={x + 10 * inv}
                y={y + 4 * inv}
                fontSize={VESSEL_FONT * inv}
                fill={GOLD}
                fontFamily="Georgia, serif"
                stroke={VOID_COLOR}
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
          background: VOID_COLOR,
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
            <line x1={0} y1={0} x2={0} y2={3.2} stroke={GEO_HATCH} strokeWidth={0.35 * inv} />
          </pattern>
        </defs>

        {/* Outside the transformed group on purpose: inside it, the sea would pan away and leave
            bare void at the sheet's edges.
            Deliberately drawn far larger than the viewBox. The pane's aspect ratio won't generally
            match the viewBox's, so `preserveAspectRatio`'s default letterboxes the chart — and the
            wrapped world copies happily draw coastline into those letterbox bars, while a
            viewBox-sized sea rect does not, leaving bare void stripes down both edges with land
            floating in them. Overdrawing costs nothing and covers the bars at any pane shape. */}
        <rect
          x={-VB_WIDTH}
          y={-VB_HEIGHT}
          width={VB_WIDTH * 3}
          height={VB_HEIGHT * 3}
          fill={SEA_COLOR}
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

const ZOOM_BUTTON: React.CSSProperties = {
  width: 44,
  height: 44,
  background: '#1a1510',
  border: `1px solid ${INK}`,
  color: PARCHMENT,
  fontFamily: 'Georgia, serif',
  fontSize: '1.1rem',
  lineHeight: 1,
  cursor: 'pointer',
  borderRadius: 2,
  opacity: 0.92,
};
