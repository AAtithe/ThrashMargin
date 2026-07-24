import { Fragment, useEffect, useRef, useState } from 'react';
import { CITIES, ROUTES, findCity } from '../sim/content';
import { BACKDROP, GEO_STROKE } from '../sim/geography';
import type { Vessel } from '../sim/types';

const INK = '#4a3d28';
const PARCHMENT = '#c9b88a';
const GOLD = '#e8d5a3';
const SHIP_COLOR = '#b5451a';
const COURIER_COLOR = '#3a6b5a';
const VOID_COLOR = '#0e0b07';
const SEA_COLOR = '#182430';

/**
 * Recolored palette for the real-geography backdrop (see `sim/geography.ts`), tuned into this
 * file's existing dark ink/gold/parchment family rather than the source project's own white-paper
 * look — confirmed by actually building and screenshotting a recolored test render before settling
 * on these. Enclosed seas/lakes reuse `SEA_COLOR` directly (no separate "paper" tone — they
 * visually disappear into the surrounding ocean, which is the correct read); the graticule and
 * region labels reuse `PARCHMENT` at low opacity rather than `GOLD`, partly so the graticule isn't
 * mistaken for the existing dashed-gold trade-route lines.
 */
const GEO_COAST = '#998965'; // coastline ink — a muted gold (50/50 GOLD/INK): plain INK has too
// little contrast against LAND_COLOR/SEA_COLOR here, and plain GOLD already means
// "reachable/selected" elsewhere in this file.
const GEO_COAST_GHOST = '#716347'; // the fainter doubled "sketch" stroke, pulled further toward INK.
const GEO_HATCH = '#695c40'; // hachure texture — a first, darker attempt read as invisible in testing.
const GEO_RELIEF = '#817253'; // mountain "caterpillar" strokes, between GEO_COAST and GEO_COAST_GHOST.
const GEO_WATER = '#747c82'; // rivers + sea-name label text — SEA_COLOR lightened toward white,
// deliberately not COURIER_COLOR even though both are teal-adjacent (couriers already own that hue).

/** Real-world geography's viewBox dimensions, imported so they can never drift out of sync with
 * the projector in `sim/geography.ts` — never hand-copied literals. */
const VB_WIDTH = BACKDROP.width;
const VB_HEIGHT = BACKDROP.height;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.5;

/** Scale factor for this file's own hand-authored "chrome" (the compass rose, the decorative
 * border frame) — neither is part of the ported geography backdrop (which scales itself via
 * `sim/geography.ts`'s own `P.scale()`), and neither is a gameplay icon (those, per design
 * decision, stay a fixed pixel size regardless of canvas size — see `CASTLE_HALF_SIZE`/
 * `DOCK_RADIUS` below). This preserves their old relative appearance (authored against the
 * previous 780px-wide canvas) at the new, much larger canvas size. */
const CHROME = VB_WIDTH / 780;

const neatlinePath = `M ${BACKDROP.neatline.map(p => p.join(' ')).join(' L ')} Z`;

/** Default pan/zoom: frames every city currently in the game (CITIES is already the concatenation
 * of every shipped chapter's own city array), not the whole Ptolemaic world — at zoom=1 the full
 * Thule-to-Timbuktu domain would compress the actual playable area into a small corner, exactly
 * the "clutter" this whole change exists to fix. Computed once from static data, not hardcoded, so
 * a future chapter adding more cities updates this automatically with zero code change here. */
const DEFAULT_VIEW = (() => {
  const xs = CITIES.map(c => c.x);
  const ys = CITIES.map(c => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const MARGIN_FACTOR = 1.2; // ~20% margin so cities don't sit flush against the pane's edge
  const zoom = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.min(VB_WIDTH / (bw * MARGIN_FACTOR), VB_HEIGHT / (bh * MARGIN_FACTOR))),
  );
  return { panX: VB_WIDTH / 2 - cx * zoom, panY: VB_HEIGHT / 2 - cy * zoom, zoom };
})();

/**
 * City markers: a crenellated-castle silhouette instead of a plain dot — larger and more
 * figurative, per the owner's "medieval style" ask (mocked up and approved before drawing these:
 * https://claude.ai/code/artifact/737981ee-d174-4955-a6a4-2fa4e8270191, option A). Port cities get
 * a wider 3-tower version with a small pennant (half-width 12, half-height 14 — the tallest,
 * center merlon reaches y=-14); inland cities get a single-tower version (half-width 8,
 * half-height 10). Both centered on `(c.x, c.y)`, same as the circle they replace.
 */
const PORT_CASTLE_PATH =
  'M -12,14 L -12,-4 L -8,-4 L -8,-9 L -4,-9 L -4,-4 L -1,-4 L -1,-14 L 1,-14 L 1,-4 L 4,-4 L 4,-9 L 8,-9 L 8,-4 L 12,-4 L 12,14 Z';
const INLAND_CASTLE_PATH =
  'M -8,10 L -8,-4 L -5,-4 L -5,-10 L -2,-10 L -2,-4 L 2,-4 L 2,-10 L 5,-10 L 5,-4 L 8,-4 L 8,10 Z';
const PORT_CASTLE_DOOR = { x: -3, y: 2, width: 6, height: 12 };
const INLAND_CASTLE_DOOR = { x: -2, y: 3, width: 4, height: 7 };
/** Pennant flag, port cities only — a small accent on the tallest (center) tower. */
const PORT_CASTLE_FLAG = 'M 0,-14 L 0,-20 M 0,-20 L 6,-18 L 0,-16';

/** Half-width/half-height of each castle glyph, used both to clear the city's own label and to
 * recalibrate how far a docked vessel must fan out to clear the icon (see `DOCK_RADIUS`).
 * Deliberately NOT scaled with the bigger canvas: icon size is a design choice independent of the
 * projection, and the real-geography city spacing already gives every pair of cities generous
 * clearance at these fixed sizes (verified directly against the actual new coordinates) —
 * scaling icons up would make them relatively larger exactly where there's least new room
 * (Flanders, Cyprus — the clusters that are genuinely tight in reality, not just on the old
 * hand-drawn map), which is backwards. */
const CASTLE_HALF_SIZE = {
  port: { w: 12, h: 14 },
  inland: { w: 8, h: 10 },
};

/** Cities whose label flips to the left of their icon (`x - 14`, right-aligned) instead of the
 * usual right-side offset. Empty for now: the previous two special cases (Ghent, Kouklia) were
 * both solving label crowding the real-geography spacing already fixes — verified directly against
 * the actual new coordinates, neither pair's label rects still overlap. Milan/Genoa came out as a
 * new, much closer call by the same estimate (~5.5px apart on one axis) — check live in the browser
 * and add here only if it actually reads as crowded on screen, the same way Ghent's original flip
 * was found by visual inspection, not computed. */
const FLIPPED_LABEL_CITY_IDS = new Set<string>();

/**
 * Slot angles (degrees, SVG convention) for vessels docked at the same city, fanned within a
 * 60°-wide arc centered straight up — away from the city's own label and clear of every route
 * line touching the crowded Bruges/Ghent cluster. At most 3 vessels ever exist in this game (a
 * ship, a courier, and Chapter 0's handcart, which is never removed), so a fixed set of slots is
 * enough — no "N vessels here" badge needed. A single vessel gets the center slot (reads as
 * deliberate, not an arbitrary pick); two get the outer slots for symmetry; three get all of them.
 */
const DOCK_SLOT_ANGLES_DEG: Record<number, number[]> = {
  1: [-90],
  2: [-120, -60],
  3: [-120, -90, -60],
};

/** Clearance radius for a vessel fanned out around a city — `Math.hypot(halfWidth, halfHeight) + 9`,
 * the diagonal slots (±60°/±120°) are the binding case since a castle's crenellations poke out near
 * its top corners, not straight up. */
const DOCK_RADIUS = {
  port: Math.hypot(CASTLE_HALF_SIZE.port.w, CASTLE_HALF_SIZE.port.h) + 9,
  inland: Math.hypot(CASTLE_HALF_SIZE.inland.w, CASTLE_HALF_SIZE.inland.h) + 9,
};

interface VesselRender {
  vessel: Vessel;
  x: number;
  y: number;
  /** Degrees to rotate a directional glyph toward the destination; null while docked (no facing). */
  rotationDeg: number | null;
}

/**
 * Docked vessels used to render at the exact same (x,y) as their city's own dot — invisible when
 * more than one shared a city, and liable to sit on top of (and swallow clicks meant for) the city
 * marker itself. Docked vessels now fan out to a small ring of slots around the city instead;
 * vessels under way keep the existing route-interpolated position, unchanged.
 */
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
      const traveled = (route.distanceWeeks - v.weeksRemaining) / route.distanceWeeks;
      renders.push({
        vessel: v,
        x: at.x + (to.x - at.x) * traveled,
        y: at.y + (to.y - at.y) * traveled,
        rotationDeg: (Math.atan2(to.y - at.y, to.x - at.x) * 180) / Math.PI,
      });
      continue;
    }

    const at = findCity(v.location);
    if (!at) continue;
    const group = dockedGroups.get(v.location) ?? [v];
    const slotIndex = Math.max(0, group.findIndex(gv => gv.id === v.id));
    const angles = DOCK_SLOT_ANGLES_DEG[group.length] ?? DOCK_SLOT_ANGLES_DEG[3];
    const angleDeg = angles[slotIndex % angles.length];
    const radius = at.port ? DOCK_RADIUS.port : DOCK_RADIUS.inland;
    const rad = (angleDeg * Math.PI) / 180;
    renders.push({
      vessel: v,
      x: at.x + radius * Math.cos(rad),
      y: at.y + radius * Math.sin(rad),
      rotationDeg: null,
    });
  }
  return renders;
}

interface MapViewProps {
  vessels: Vessel[];
  selectedVesselId: string | null;
  /** Clicking any city — reachable or not — calls this to preview it; dispatching the selected
   * vessel there is a separate, explicit confirmation in the sidebar, not the click itself. */
  onSelectCity: (cityId: string) => void;
  /** cityId -> weeks since the player's known report on that city was true; null if no report yet. */
  cityInfoAge: Record<string, number | null>;
  /** The city currently shown in the sidebar's preview panel, if any — highlighted distinctly
   * from "reachable" so the player can see which marker their click actually landed on. */
  previewedCityId?: string | null;
}

/** Fog by information age: fresh news reads solid, old or absent news fades the city out. */
function fogOpacity(age: number | null): number {
  if (age === null) return 0.35;
  if (age <= 2) return 1;
  return Math.max(0.5, 1 - age * 0.04);
}

/** A simple compass rose in the map's one empty corner — decoration only, no gameplay meaning.
 * This is the game's own UI chrome (kept regardless of the source backdrop's own, disabled,
 * compass layer), so it takes an explicit `scale` to preserve its old relative size against the
 * much bigger canvas rather than being authored in backdrop-projection units. */
function CompassRose({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`} opacity={0.55}>
      <circle r={26} fill="none" stroke={GOLD} strokeWidth={1} />
      <circle r={2} fill={GOLD} />
      <line x1={0} y1={-24} x2={0} y2={24} stroke={GOLD} strokeWidth={1} />
      <line x1={-24} y1={0} x2={24} y2={0} stroke={GOLD} strokeWidth={1} />
      <path d="M 0,-24 L 5,-9 L 0,0 L -5,-9 Z" fill={GOLD} />
      <text y={-32} textAnchor="middle" fontSize={10} fill={GOLD} fontFamily="Georgia, serif">
        N
      </text>
    </g>
  );
}

/** Actual rendered content scale/offset for the SVG's `viewBox`, accounting for letterboxing —
 * `MAP_PANE` won't generally match the viewBox's own aspect ratio, so the default
 * `preserveAspectRatio` (`xMidYMid meet`) centers the content within the rendered box rather than
 * stretching it. A naive `viewBoxWidth / renderedWidth` ratio is wrong whenever there's a
 * letterbox bar on either axis; screen-to-viewBox conversion must go through this instead. */
function getContentScale(svgEl: SVGSVGElement): { scale: number; offsetX: number; offsetY: number } {
  const rect = svgEl.getBoundingClientRect();
  const scale = Math.min(rect.width / VB_WIDTH, rect.height / VB_HEIGHT);
  return {
    scale,
    offsetX: (rect.width - VB_WIDTH * scale) / 2,
    offsetY: (rect.height - VB_HEIGHT * scale) / 2,
  };
}

function clientToViewBox(svgEl: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svgEl.getBoundingClientRect();
  const { scale, offsetX, offsetY } = getContentScale(svgEl);
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale,
  };
}

const RESET_VIEW_BUTTON: React.CSSProperties = {
  position: 'absolute',
  right: '0.6rem',
  bottom: '0.6rem',
  background: '#1a1510',
  border: `1px solid ${INK}`,
  color: PARCHMENT,
  padding: '0.3rem 0.6rem',
  fontFamily: 'Georgia, serif',
  fontSize: '0.72rem',
  cursor: 'pointer',
};

export default function MapView({ vessels, selectedVesselId, onSelectCity, cityInfoAge, previewedCityId }: MapViewProps) {
  const selected = vessels.find(v => v.id === selectedVesselId) ?? null;
  const [hoveredVesselId, setHoveredVesselId] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [view, setView] = useState(DEFAULT_VIEW);

  // Drag-to-pan: window-level listeners (not SVG-level) so a fast drag that exits the map pane
  // into the sidebar still ends cleanly on mouseup, rather than getting stuck mid-drag.
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const svgEl = svgRef.current;
      const drag = dragRef.current;
      if (!svgEl || !drag) return;
      const { scale } = getContentScale(svgEl);
      const dx = (e.clientX - drag.startClientX) / scale;
      const dy = (e.clientY - drag.startClientY) / scale;
      setView(prev => ({ ...prev, panX: drag.startPanX + dx, panY: drag.startPanY + dy }));
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Scroll-to-zoom toward the cursor. Must be a real native listener, not JSX onWheel: React
  // registers wheel as passive by default, so preventDefault() inside a synthetic onWheel handler
  // is silently ignored and the page scrolls anyway.
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vb = clientToViewBox(svgEl, e.clientX, e.clientY);
      setView(prev => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
        const contentX = (vb.x - prev.panX) / prev.zoom;
        const contentY = (vb.y - prev.panY) / prev.zoom;
        return { zoom: newZoom, panX: vb.x - contentX * newZoom, panY: vb.y - contentY * newZoom };
      });
    };
    svgEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => svgEl.removeEventListener('wheel', handleWheel);
  }, []);

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startPanX: view.panX, startPanY: view.panY };
    setIsDragging(true);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        style={{ width: '100%', height: '100%', background: VOID_COLOR, cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
      >
        <g transform={`translate(${view.panX},${view.panY}) scale(${view.zoom})`}>
          <rect x={0} y={0} width={VB_WIDTH} height={VB_HEIGHT} fill={SEA_COLOR} />

          <defs>
            <pattern
              id="geo-hatch"
              width={GEO_STROKE.hatchGap}
              height={GEO_STROKE.hatchGap}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(35)"
            >
              <line x1={0} y1={0} x2={0} y2={GEO_STROKE.hatchGap} stroke={GEO_HATCH} strokeWidth={GEO_STROKE.hatchLine} />
            </pattern>
            <clipPath id="geo-sheet">
              <path d={neatlinePath} />
            </clipPath>
          </defs>

          <g clipPath="url(#geo-sheet)">
            <path
              d={BACKDROP.graticule}
              fill="none"
              stroke={PARCHMENT}
              strokeWidth={GEO_STROKE.grid}
              opacity={0.12}
            />

            <path
              id="geo-land"
              d={BACKDROP.land}
              fill="url(#geo-hatch)"
              stroke={GEO_COAST}
              strokeWidth={GEO_STROKE.coast}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <use
              href="#geo-land"
              fill="none"
              stroke={GEO_COAST_GHOST}
              strokeWidth={GEO_STROKE.ghost}
              opacity={0.6}
              transform={`translate(${GEO_STROKE.ghostOffsetX},${GEO_STROKE.ghostOffsetY})`}
            />

            {BACKDROP.seas.map(sea => (
              <Fragment key={sea.id}>
                <path
                  id={`geo-sea-${sea.id}`}
                  d={sea.d}
                  fill={SEA_COLOR}
                  stroke={GEO_COAST}
                  strokeWidth={GEO_STROKE.coast * 0.85}
                  strokeLinejoin="round"
                />
                <use
                  href={`#geo-sea-${sea.id}`}
                  fill="none"
                  stroke={GEO_COAST_GHOST}
                  strokeWidth={GEO_STROKE.ghost}
                  opacity={0.6}
                  transform={`translate(${GEO_STROKE.ghostOffsetX},${GEO_STROKE.ghostOffsetY})`}
                />
              </Fragment>
            ))}

            {BACKDROP.islands.map(isl => (
              <Fragment key={isl.id}>
                <path
                  id={`geo-isl-${isl.id}`}
                  d={isl.d}
                  fill="url(#geo-hatch)"
                  stroke={GEO_COAST}
                  strokeWidth={GEO_STROKE.coast * 0.85}
                  strokeLinejoin="round"
                />
                <use
                  href={`#geo-isl-${isl.id}`}
                  fill="none"
                  stroke={GEO_COAST_GHOST}
                  strokeWidth={GEO_STROKE.ghost}
                  opacity={0.6}
                  transform={`translate(${GEO_STROKE.ghostOffsetX},${GEO_STROKE.ghostOffsetY})`}
                />
              </Fragment>
            ))}

            <path d={BACKDROP.rivers} fill="none" stroke={GEO_WATER} strokeWidth={GEO_STROKE.river} strokeLinecap="round" />
            {BACKDROP.lakes.map(lk => (
              <ellipse
                key={lk.id}
                cx={lk.cx} cy={lk.cy} rx={lk.rx} ry={lk.ry}
                fill={SEA_COLOR}
                stroke={GEO_COAST_GHOST}
                strokeWidth={GEO_STROKE.coast * 0.6}
              />
            ))}

            <path d={BACKDROP.mountains} fill="none" stroke={GEO_RELIEF} strokeWidth={GEO_STROKE.relief} strokeLinecap="round" />
          </g>

          {BACKDROP.labels.map((lb, i) => (
            <text
              key={i}
              x={lb.x} y={lb.y}
              textAnchor="middle"
              fontStyle="italic"
              fontSize={lb.kind === 'sea' ? 11 : 9}
              fill={lb.kind === 'sea' ? GEO_WATER : PARCHMENT}
              fillOpacity={lb.kind === 'sea' ? 0.5 : 0.45}
              fontFamily="Georgia, serif"
            >
              {lb.text}
            </text>
          ))}

          <CompassRose x={VB_WIDTH - 45 * CHROME} y={55 * CHROME} scale={CHROME} />

          {ROUTES.map(r => {
            const from = findCity(r.from)!;
            const to = findCity(r.to)!;
            return (
              <line
                key={r.id}
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={GOLD}
                strokeWidth={1.25}
                strokeDasharray={r.type === 'sea' ? '5 4' : r.type === 'river' ? '2 2' : undefined}
                opacity={0.5}
              />
            );
          })}

          {CITIES.map(c => {
            const reachable = selected
              ? ROUTES.some(r => {
                  if (selected.kind === 'courier' && r.type !== 'land') return false;
                  return (r.from === selected.location && r.to === c.id) ||
                         (r.to === selected.location && r.from === c.id);
                })
              : false;
            const opacity = fogOpacity(cityInfoAge[c.id] ?? null);
            const isPreviewed = c.id === previewedCityId;
            const fill = reachable ? GOLD : PARCHMENT;
            const half = c.port ? CASTLE_HALF_SIZE.port : CASTLE_HALF_SIZE.inland;
            const ringRadius = Math.hypot(half.w, half.h) + 3;
            const flipLabel = FLIPPED_LABEL_CITY_IDS.has(c.id);
            return (
              <g
                key={c.id}
                id={`city-node-${c.id}`}
                onClick={() => onSelectCity(c.id)}
                style={{ cursor: 'pointer' }}
              >
                {isPreviewed && (
                  <circle cx={c.x} cy={c.y} r={ringRadius} fill="none" stroke={GOLD} strokeWidth={1.5} />
                )}
                <g transform={`translate(${c.x},${c.y})`} fillOpacity={opacity}>
                  <path d={c.port ? PORT_CASTLE_PATH : INLAND_CASTLE_PATH} fill={fill} stroke={INK} strokeWidth={1.5} />
                  <rect {...(c.port ? PORT_CASTLE_DOOR : INLAND_CASTLE_DOOR)} fill={INK} />
                  {c.port && <path d={PORT_CASTLE_FLAG} fill="none" stroke={fill} strokeWidth={1.5} />}
                </g>
                <text
                  x={flipLabel ? c.x - 14 : c.x + 14}
                  y={c.y + 4}
                  textAnchor={flipLabel ? 'end' : 'start'}
                  fontSize={12}
                  fill={PARCHMENT}
                  fillOpacity={opacity}
                  fontFamily="Georgia, serif"
                >
                  {c.name}
                </text>
              </g>
            );
          })}

          {computeVesselRenders(vessels).map(({ vessel: v, x, y, rotationDeg }) => {
            const color = v.kind === 'ship' ? SHIP_COLOR : COURIER_COLOR;
            const isSelected = v.id === selectedVesselId;
            const showLabel = isSelected || v.id === hoveredVesselId;
            return (
              <g
                key={v.id}
                onMouseEnter={() => setHoveredVesselId(v.id)}
                onMouseLeave={() => setHoveredVesselId(id => (id === v.id ? null : id))}
                style={{ cursor: 'default' }}
              >
                {v.kind === 'ship' ? (
                  <path
                    d="M 0,-7 L 6,6 L -6,6 Z"
                    transform={`translate(${x},${y})`}
                    fill={color}
                    stroke={isSelected ? GOLD : '#000'}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                ) : (
                  <g transform={`translate(${x},${y})`}>
                    <circle r={isSelected ? 6 : 5} fill={color} stroke={isSelected ? GOLD : '#000'} strokeWidth={isSelected ? 2 : 1} />
                    {rotationDeg !== null && (
                      <path d="M 5,0 L -3,-4 L -3,4 Z" transform={`rotate(${rotationDeg})`} fill={color} stroke="#000" strokeWidth={0.75} />
                    )}
                  </g>
                )}
                {showLabel && (
                  <text
                    x={x + 10} y={y + 4}
                    fontSize={11}
                    fill={GOLD}
                    fontFamily="Georgia, serif"
                    stroke={VOID_COLOR}
                    strokeWidth={3}
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

        <rect
          x={6 * CHROME} y={6 * CHROME}
          width={VB_WIDTH - 12 * CHROME} height={VB_HEIGHT - 12 * CHROME}
          fill="none" stroke={INK} strokeWidth={2 * CHROME} opacity={0.8}
        />
        <rect
          x={11 * CHROME} y={11 * CHROME}
          width={VB_WIDTH - 22 * CHROME} height={VB_HEIGHT - 22 * CHROME}
          fill="none" stroke={INK} strokeWidth={1 * CHROME} opacity={0.45}
        />
      </svg>
      <button style={RESET_VIEW_BUTTON} onClick={() => setView(DEFAULT_VIEW)}>
        Reset view
      </button>
    </div>
  );
}
