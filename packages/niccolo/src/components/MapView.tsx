import { useEffect, useMemo, useRef, useState } from 'react';
import { CHART, FONT, GEO, UI } from '../theme';
import { CITIES, ROUTES, findCity, findRouteById, otherEndOfRoute } from '../sim/content';
import {
  CHART as BACKDROP,
  CITY_POINTS,
  VB_HEIGHT,
  VB_WIDTH,
  clampPanY,
  unwrapRun,
  wrapDx,
  wrapPanX,
} from '../sim/geography';
import type { City, LabelSide, Vessel } from '../sim/types';
import { easeInOut, useSkipOnInput, useTweenOnChange } from '../lib/motion';

const SHIP_COLOR = UI.ensign;
const COURIER_COLOR = UI.good;

/**
 * Marker and text sizes are authored as their on-screen PIXEL size, because every one of them is
 * counter-scaled at draw time by both the zoom and the chart's own scale on screen (see `inv` in
 * the component). They used to be counter-scaled by the zoom alone, which held them at
 * `size * contentScale` pixels: on a pane well under the sheet's 1600 units across that put city
 * names at six or seven pixels, which is most of why the chart was hard to read. This is the one thing that
 * could not be copied from Tea Race, since Bruges and Ghent sit 40km apart (half a degree, ~2
 * viewBox units of 1600) and a world-unit marker of any legible size would overlap its neighbours
 * at every zoom.
 */
const ZOOM_MIN = 1;
/** Measured live: the Flanders cluster fully separates, every label showing, zero overlaps, at
 * about 21x — this is set well above that. */
const ZOOM_MAX = 60;
const ZOOM_STEP = 1.12;
const DRAG_THRESHOLD = 5;

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
 * here (see the file-level note on counter-scaling). Smaller than the full `PORT_RADIUS` since
 * these became true pixels: at the opening framing a full-size disc on every city read as a heap
 * of grey coins over the Low Countries. */
const PORT_RADIUS_AT_MIN_ZOOM = 6;
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
function markerScale(c: City, inv: number, zoom: number): number {
  const growth = Math.min(1, Math.max(0, (zoom - ZOOM_MIN) / (MARKER_GROWTH_ZOOM - ZOOM_MIN)));
  const desiredRadius = PORT_RADIUS_AT_MIN_ZOOM + (PORT_RADIUS_AT_MAX_GROWTH - PORT_RADIUS_AT_MIN_ZOOM) * growth;
  const gap = NEAREST_NEIGHBOUR[c.id] ?? Infinity;
  // The gap is in world units and `1 / inv` is screen pixels per world unit, so this is the gap on
  // screen: two neighbours can each claim up to 0.45 of it before their full extents would touch.
  const crowdCap = Number.isFinite(gap) ? (gap * 0.45) / inv : Infinity;
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
 * The playable area: every city in the game, laid out the short way round. The default view frames
 * this rather than the whole globe, which would leave the cities a sliver. Computed from `CITIES`,
 * so a future chapter that adds a city updates it with no code change.
 */
const CITY_BOUNDS = (() => {
  const pts = unwrapRun((CITIES as City[]).map(cityPoint));
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
})();

/**
 * The default view for a pane `vbWidth` chart units across, with `inset` units covered by panels on
 * each side: every city framed in the part of the pane that is left, as large as fits.
 */
function fitView(vbWidth: number, inset: { l: number; r: number; b: number }) {
  const { minX, maxX, minY, maxY } = CITY_BOUNDS;
  const availW = Math.max(120, vbWidth - inset.l - inset.r);
  const availH = Math.max(120, VB_HEIGHT - inset.b);
  const MARGIN = 1.2;
  const zoom = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.min(availW / ((maxX - minX) * MARGIN), availH / ((maxY - minY) * MARGIN))),
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    zoom,
    panX: wrapPanX(inset.l + availW / 2 - cx * zoom, zoom),
    panY: clampPanY(availH / 2 - cy * zoom, zoom),
  };
}

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
  // `inv` here is screen pixels to world units, so a docked vessel sits a fixed distance off the
  // city's mark on screen at any zoom.
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

/** How long a vessel takes to glide from last week's position to this week's, before pacing. */
const GLIDE_MS = 1100;

/** Where each vessel is drawn — the only thing that should make the fleet glide. A trade changes
 * the vessels array too (cargo), and that must not replay a voyage. */
const positionKey = (vs: Vessel[]) =>
  vs.map(v => `${v.id}:${v.location}>${v.destination ?? ''}@${v.weeksRemaining}`).join('|');
const samePositions = (a: Vessel[], b: Vessel[]) => a === b || positionKey(a) === positionKey(b);

/**
 * Last week's renders blended into this week's, `t` from 0 to 1. Presentation only: the vessels
 * have already moved in the state (and the save); this just lets the eye follow them there. A
 * vessel that reached port and sailed straight on (a queued route) is routed through that port
 * rather than cutting the corner. A vessel with no previous render (just bought) simply appears.
 */
function glideRenders(fromVessels: Vessel[], to: VesselRender[], inv: number, t: number): VesselRender[] {
  if (t >= 1) return to;
  const from = new Map(computeVesselRenders(fromVessels, inv).map(r => [r.vessel.id, r]));
  const e = easeInOut(t);
  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, s: number) => ({
    x: a.x + wrapDx(a.x, b.x) * s,
    y: a.y + (b.y - a.y) * s,
  });
  return to.map(r => {
    const f = from.get(r.vessel.id);
    if (!f) return r;
    const passedPort = f.vessel.destination && f.vessel.destination === r.vessel.location && r.vessel.destination;
    const via = passedPort ? findCity(f.vessel.destination!) : undefined;
    let p: { x: number; y: number };
    if (via) {
      const mid = cityPoint(via);
      p = e < 0.5 ? lerp(f, mid, e * 2) : lerp(mid, r, (e - 0.5) * 2);
    } else {
      p = lerp(f, r, e);
    }
    const rotationDeg = via && e < 0.5 ? f.rotationDeg : r.rotationDeg ?? f.rotationDeg;
    return { ...r, x: p.x, y: p.y, rotationDeg };
  });
}

interface MapViewProps {
  vessels: Vessel[];
  selectedVesselId: string | null;
  onSelectCity: (cityId: string) => void;
  onSelectVessel: (vesselId: string) => void;
  cityInfoAge: Record<string, number | null>;
  previewedCityId?: string | null;
  /** Screen pixels covered by panels floating over the chart; fitting and panning avoid them. */
  inset?: { left: number; right: number; bottom: number };
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
      // News landing from a city firms its mark up over a moment rather than in one frame. The
      // duration is scaled by the portal pace, so with motion off this is an instant change.
      style={{ transition: 'fill-opacity calc(700ms * var(--tm-motion, 1)), stroke-opacity calc(700ms * var(--tm-motion, 1))' }}
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
  inset,
}: MapViewProps) {
  const selected = vessels.find(v => v.id === selectedVesselId) ?? null;
  const [hoveredVesselId, setHoveredVesselId] = useState<string | null>(null);
  const [hoveredCityId, setHoveredCityId] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  /**
   * The chart fills its pane. Its height shows the sheet from pole to pole at zoom 1; its width
   * shows as much of the world as the pane has room for, wrapping round past the date line. `scale`
   * is screen pixels per chart unit at zoom 1 and `vbWidth` the chart units across the pane.
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
  const insetU = {
    l: scale > 0 ? (inset?.left ?? 0) / scale : 0,
    r: scale > 0 ? (inset?.right ?? 0) / scale : 0,
    b: scale > 0 ? (inset?.bottom ?? 0) / scale : 0,
  };

  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const fit = () => setView(fitView(vbWidth, insetU));
  // Frame the cities once the pane has a size. Not again on resize: that would throw away the view.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || scale <= 0) return;
    fitted.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  /** Zoom about a point in chart units across the pane (the open part's middle when omitted). */
  const zoomAt = (factor: number, vbX?: number, vbY?: number) =>
    setView(prev => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
      const cx = vbX ?? (insetU.l + vbWidth - insetU.r) / 2;
      const cy = vbY ?? (VB_HEIGHT - insetU.b) / 2;
      return {
        zoom,
        panX: wrapPanX(cx - ((cx - prev.panX) / prev.zoom) * zoom, zoom),
        panY: clampPanY(cy - ((cy - prev.panY) / prev.zoom) * zoom, zoom),
      };
    });
  const zoomBy = (factor: number) => zoomAt(factor);

  // The native listeners below are attached once; this keeps them reading the current geometry.
  const live = useRef({ scale, zoomAt, fit });
  live.current = { scale, zoomAt, fit };

  // Scroll-to-zoom toward the cursor. Must be a real native listener: React registers `wheel`
  // passively and silently ignores preventDefault() inside a JSX onWheel handler.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { scale: sc, zoomAt: z } = live.current;
      if (!Number.isFinite(sc) || sc <= 0) return;
      const rect = el.getBoundingClientRect();
      // Trackpads send many small deltas, a mouse wheel a few large ones: scale by the delta.
      const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004);
      z(factor, (e.clientX - rect.left) / sc, (e.clientY - rect.top) / sc);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keyboard: + and - zoom, 0 frames the cities again. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') live.current.zoomAt(ZOOM_STEP ** 3);
      else if (e.key === '-' || e.key === '_') live.current.zoomAt(1 / ZOOM_STEP ** 3);
      else if (e.key === '0') live.current.fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Drag to pan, pinch to zoom. The pane captures the pointer only once it has moved past a few
   * pixels, so a tap on a city still reaches the city; the click that ends a drag is swallowed so
   * letting go over a city does not also preview it.
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
    if (!isDragging) setIsDragging(true);
    setView(prev => ({
      zoom: prev.zoom,
      panX: wrapPanX(prev.panX + dx / scale, prev.zoom),
      panY: clampPanY(prev.panY + dy / scale, prev.zoom),
    }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setIsDragging(false);
  };

  // A city newly previewed that sits under a panel or off the pane is brought into the open part.
  useEffect(() => {
    if (!previewedCityId || scale <= 0) return;
    const city = findCity(previewedCityId);
    if (!city) return;
    const p = cityPoint(city);
    setView(prev => {
      const mid = (insetU.l + vbWidth - insetU.r) / 2;
      let sx = prev.panX + p.x * prev.zoom;
      const span = VB_WIDTH * prev.zoom;
      while (sx - mid > span / 2) sx -= span;
      while (mid - sx > span / 2) sx += span;
      const sy = prev.panY + p.y * prev.zoom;
      const margin = 50 / scale;
      if (sx > insetU.l + margin && sx < vbWidth - insetU.r - margin && sy > margin && sy < VB_HEIGHT - insetU.b - margin) return prev;
      return {
        zoom: prev.zoom,
        panX: wrapPanX(mid - p.x * prev.zoom, prev.zoom),
        panY: clampPanY((VB_HEIGHT - insetU.b) / 2 - p.y * prev.zoom, prev.zoom),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewedCityId]);

  /** The copies of the world the pane can currently see, as offsets in chart units. */
  const copies = (() => {
    const start = -view.panX / view.zoom;
    const end = start + vbWidth / view.zoom;
    const out: number[] = [];
    for (let k = Math.floor(start / VB_WIDTH) - 1; k <= Math.floor(end / VB_WIDTH); k++) out.push(k * VB_WIDTH);
    return out;
  })();

  /**
   * Counter-scale for markers and text: world units per screen pixel, so a size of 13 is 13 pixels
   * on screen at any zoom and any pane size. `invZoom` counter-scales only the zoom, for the land's
   * hachure, which should keep the density it was drawn at rather than become a pixel pattern.
   */
  const inv = scale > 0 ? 1 / (view.zoom * scale) : 1 / view.zoom;
  const invZoom = 1 / view.zoom;
  const zoomNow = view.zoom;

  const liveRenders = useMemo(() => computeVesselRenders(vessels, inv), [vessels, inv]);
  // Between weeks the fleet glides from where it was to where it now is (any click or key finishes
  // it at once; with motion off `t` is always 1 and this is exactly `liveRenders`).
  const glide = useTweenOnChange(vessels, GLIDE_MS, samePositions);
  useSkipOnInput(glide.playing, glide.skip);
  const vesselRenders = useMemo(
    () => glideRenders(glide.from, liveRenders, inv, glide.t),
    [glide.from, liveRenders, inv, glide.t],
  );

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
      const ms = markerScale(c, inv, zoomNow);
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
            const os = markerScale(o, inv, zoomNow);
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
  }, [inv, zoomNow, previewedCityId, hoveredCityId]);

  /** One full copy of the world's content, offset east or west. Drawing three of these side by
   * side is what makes panning round the world seamless. */
  /** The copy that carries ids, labels and the planned path: the one under the open pane's middle. */
  const primaryOffset =
    Math.floor(((insetU.l + vbWidth - insetU.r) / 2 - view.panX) / view.zoom / VB_WIDTH) * VB_WIDTH;
  const worldCopy = (copyOffset: number) => {
    const offset = copyOffset - primaryOffset;
    return (
    <g key={copyOffset} transform={copyOffset ? `translate(${copyOffset} 0)` : undefined}>
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
        const mScale = markerScale(c, inv, zoomNow);
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
  };

  return (
    <div
      ref={wrapRef}
      className="niccolo-chart"
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab' }}
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
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          background: GEO.void,
          userSelect: 'none',
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
            patternTransform={`rotate(35) scale(${invZoom})`}
          >
            {/* Opaque ground inside the tile, slightly oversized so rotated tiles leave no seams. */}
            <rect x={-0.5} y={-0.5} width={4.2} height={4.2} fill={GEO.landGround} />
            <line x1={0} y1={0} x2={0} y2={3.2} stroke={GEO.hatch} strokeWidth={0.35 * invZoom} opacity={0.5} />
          </pattern>
        </defs>

        {/* Outside the transformed group on purpose: inside it, the sea would pan away and leave
            bare ground at the sheet's edges. Deliberately drawn far larger than the viewBox to
            cover the pane's letterbox bars at any aspect ratio. */}
        <rect
          x={-vbWidth}
          y={-VB_HEIGHT}
          width={vbWidth * 3}
          height={VB_HEIGHT * 3}
          fill={CHART.sea}
        />

        <g transform={`translate(${view.panX},${view.panY}) scale(${view.zoom})`}>
          {copies.map(worldCopy)}
        </g>

        {/* Fixed to the pane, clear of the panels; drawn in screen pixels like everything else. */}
        <g transform={`translate(${vbWidth - insetU.r - 42 / (scale || 1)},${46 / (scale || 1)}) scale(${1 / (scale || 1)})`}>
          <CompassRose x={0} y={0} />
        </g>
      </svg>

      <div style={{ ...ZOOM_CONTROLS, right: `calc(0.6rem + ${inset?.right ?? 0}px)`, bottom: `calc(0.6rem + ${inset?.bottom ?? 0}px)` }}>
        <button style={ZOOM_BUTTON} onClick={() => zoomBy(ZOOM_STEP ** 3)} aria-label="Zoom in (+)" title="Zoom in (+)">
          +
        </button>
        <button style={ZOOM_BUTTON} onClick={() => zoomBy(1 / ZOOM_STEP ** 3)} aria-label="Zoom out (-)" title="Zoom out (-)">
          −
        </button>
        <button
          style={{ ...ZOOM_BUTTON, fontSize: '0.6rem' }}
          onClick={fit}
          aria-label="Fit every city in view (0)"
          title="Fit every city in view (0)"
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
