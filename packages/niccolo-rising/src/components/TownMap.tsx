/**
 * The board: a town map of Bruges, with a landmark for every place the character can go. Clicking
 * one opens that place's panel (GameScreen). The map is drawn, not projected: the walls, the moat,
 * the Reie, the Markt and the Burg are where they were in 1460 to within the accuracy of a woodcut,
 * which is all a place picker needs.
 *
 * Marks and names are drawn in screen pixels at any zoom (`inv` below), so the map can be zoomed for
 * room without the labels growing or vanishing. Pan with a drag, zoom with the wheel, a pinch, the
 * buttons or the + and - keys; 0 fits the town. A click that ends a drag is swallowed, so letting
 * go over a landmark does not also open it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FONT, TOWN, UI } from '../theme';

export interface Landmark {
  id: string;
  name: string;
  /** Where in Bruges it is, shown under the name. */
  where: string;
  x: number;
  y: number;
  icon: IconName;
  /** Which side of the mark the name sits. Below by default; to one side where a neighbour is close. */
  labelSide?: 'below' | 'left' | 'right';
}

/** Places on the map that are not places you choose to go: where the town puts you. */
export interface Site {
  id: 'infirmary' | 'steen' | 'gate';
  name: string;
  x: number;
  y: number;
}

interface Props {
  landmarks: Landmark[];
  /** The place whose panel is open, ringed on the map. */
  selected: string | null;
  onPick: (id: string) => void;
  /** Where the character is: a landmark id, or a site when the town has put them somewhere. */
  at: { landmark?: string; site?: Site['id']; label?: string };
  /** Small notes on landmarks: a mission ready to report, a course under way. */
  badges: Record<string, string | undefined>;
  /** A landmark to bring into view when it changes (the guided run pointing at one). */
  focus?: string | null;
  /** Screen pixels covered by panels floating over the map; fitting and panning avoid them. */
  inset?: { left: number; right: number; bottom: number };
}

const W = 1000;
const H = 820;
/** The town inside its walls, with room for the gates and the fields: what "fit" frames. */
const BOUNDS = { minX: 80, maxX: 920, minY: 40, maxY: 815 };
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 6;
const DRAG_THRESHOLD = 5;

export const SITES: Site[] = [
  { id: 'infirmary', name: 'Sint-Janshospitaal', x: 455, y: 615 },
  { id: 'steen', name: 'The Steen', x: 640, y: 470 },
  { id: 'gate', name: 'The Dampoort', x: 712, y: 118 },
];

/** The walls: Bruges is an egg with its point to the north. Clockwise from the Dampoort. */
const WALL =
  'M712 118 C800 160 878 260 892 380 C906 500 860 620 772 696 C690 766 590 790 500 788 ' +
  'C400 786 300 760 228 690 C150 614 112 500 120 390 C128 280 190 190 280 140 C380 86 520 70 620 86 ' +
  'C660 94 690 104 712 118 Z';
/** The Reie: in from the Minnewater, past the Burg, out to the Dampoort and the canal to Damme. */
const REIE =
  'M475 760 C468 700 500 660 488 610 C476 560 520 530 560 500 C610 462 650 430 628 380 ' +
  'C610 340 560 330 548 290 C536 250 566 214 606 190 C650 164 690 140 712 118 L760 40';
/** The Langerei and the Speelmansrei: the long canal north and the western arm. */
const CANALS = [
  'M606 190 C580 150 560 110 560 70',
  'M488 610 C430 560 380 520 330 470 C300 440 260 430 200 430',
];
/** Streets: every gate's road comes into the Markt. */
const GATES: Array<[string, number, number]> = [
  ['Dampoort', 712, 118],
  ['Kruispoort', 892, 390],
  ['Gentpoort', 772, 696],
  ['Katelijnepoort', 530, 788],
  ['Boeveriepoort', 236, 696],
  ['Smedenpoort', 120, 420],
  ['Ezelpoort', 270, 150],
];
const MARKT = { x: 470, y: 400, w: 70, h: 56 };
const BURG = { x: 575, y: 388, w: 48, h: 40 };

/** Deterministic house blocks: a few hundred small rectangles inside the walls, off the squares. */
const BLOCKS = (() => {
  let seed = 1460;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: Array<{ x: number; y: number; w: number; h: number; r: number }> = [];
  const inEgg = (x: number, y: number) => ((x - 505) / 370) ** 2 + ((y - 430) / 340) ** 2 < 0.92;
  for (let i = 0; i < 900 && out.length < 340; i++) {
    const x = 140 + rnd() * 740;
    const y = 90 + rnd() * 690;
    if (!inEgg(x, y)) continue;
    if (x > MARKT.x - 20 && x < MARKT.x + MARKT.w + 20 && y > MARKT.y - 20 && y < MARKT.y + MARKT.h + 20) continue;
    if (x > BURG.x - 14 && x < BURG.x + BURG.w + 14 && y > BURG.y - 14 && y < BURG.y + BURG.h + 14) continue;
    out.push({ x, y, w: 10 + rnd() * 16, h: 7 + rnd() * 10, r: (rnd() - 0.5) * 30 });
  }
  return out;
})();

export default function TownMap({ landmarks, selected, onPick, at, badges, focus, inset }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  // The map fills its pane; the viewBox takes the pane's shape so there is no letterboxing.
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
  const scale = size.w > 0 && size.h > 0 ? Math.min(size.w / W, size.h / H) : 0;
  const vbW = scale > 0 ? size.w / scale : W;
  const vbH = scale > 0 ? size.h / scale : H;
  const insetL = scale > 0 ? (inset?.left ?? 0) / scale : 0;
  const insetR = scale > 0 ? (inset?.right ?? 0) / scale : 0;
  const insetB = scale > 0 ? (inset?.bottom ?? 0) / scale : 0;
  /** World units per screen pixel: a size of 13 times this is 13 pixels on screen at any zoom. */
  const inv = scale > 0 ? 1 / (scale * view.zoom) : 1;

  /** Keep the town on screen: it can be dragged until its edge shows a narrow band, and no further. */
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
      panX: axis(v.panX, W * v.zoom, insetL, vbW - insetR),
      panY: axis(v.panY, H * v.zoom, 0, vbH - insetB),
    };
  };

  /** Frame the whole town in the part of the pane the panels leave. */
  const fit = () => {
    userMoved.current = false;
    const availW = Math.max(100, vbW - insetL - insetR);
    const availH = Math.max(100, vbH - insetB);
    const bw = BOUNDS.maxX - BOUNDS.minX, bh = BOUNDS.maxY - BOUNDS.minY;
    // The whole town, even on a phone: every place has to be reachable without hunting for it, and
    // the marks and names are drawn in screen pixels, so they stay readable however small the town.
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(availW / bw, availH / bh) * 0.96));
    setView(
      clampView({
        zoom,
        panX: insetL + availW / 2 - ((BOUNDS.minX + BOUNDS.maxX) / 2) * zoom,
        panY: availH / 2 - ((BOUNDS.minY + BOUNDS.maxY) / 2) * zoom,
      }),
    );
  };

  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || scale <= 0) return;
    fitted.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  /**
   * A panel sliding in from the side takes part of the map. Re-fit the town into what is left, so
   * no landmark ends up under the panel where it cannot be clicked, unless the player has zoomed or
   * dragged since the last fit: then keep their view and only slide it by half the change, so what
   * was in the middle stays in the middle. A phone's sheet (the bottom inset) is left alone: it
   * covers most of the screen, and the player puts it away to choose another place.
   */
  const userMoved = useRef(false);
  const lastSide = useRef({ l: insetL, r: insetR });
  useEffect(() => {
    if (scale <= 0 || !fitted.current) return;
    const dl = insetL - lastSide.current.l, dr = insetR - lastSide.current.r;
    lastSide.current = { l: insetL, r: insetR };
    if (!dl && !dr) return;
    if (!userMoved.current) { fit(); return; }
    setView(prev => clampView({ ...prev, panX: prev.panX + (dl - dr) / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insetL, insetR]);

  // A landmark in focus that is under a panel or off the pane is brought into the open part.
  useEffect(() => {
    if (!focus || scale <= 0) return;
    const lm = landmarks.find(l => l.id === focus);
    if (!lm) return;
    setView(prev => {
      const sx = prev.panX + lm.x * prev.zoom;
      const sy = prev.panY + lm.y * prev.zoom;
      const margin = 60 / scale;
      if (sx > insetL + margin && sx < vbW - insetR - margin && sy > margin && sy < vbH - insetB - margin) return prev;
      return clampView({
        zoom: prev.zoom,
        panX: (insetL + vbW - insetR) / 2 - lm.x * prev.zoom,
        panY: (vbH - insetB) / 2 - lm.y * prev.zoom,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, insetL, insetR, insetB]);

  const zoomAt = (factor: number, vbX?: number, vbY?: number) => {
    userMoved.current = true;
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
  };

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
      if (!Number.isFinite(sc) || sc <= 0) return;
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.0035);
      z(factor, (e.clientX - rect.left) / sc, (e.clientY - rect.top) / sc);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

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
    userMoved.current = true;
    setView(prev => clampView({ zoom: prev.zoom, panX: prev.panX + dx / scale, panY: prev.panY + dy / scale }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  const streets = useMemo(
    () => GATES.map(([name, x, y]) => {
      const mx = MARKT.x + MARKT.w / 2, my = MARKT.y + MARKT.h / 2;
      // A gentle bend, so the roads read as streets rather than spokes.
      const cx = (x + mx) / 2 + (y - my) * 0.12, cy = (y + my) / 2 - (x - mx) * 0.12;
      return { name, d: `M${mx} ${my} Q${cx} ${cy} ${x} ${y}` };
    }),
    [],
  );

  const R = 15; // landmark disc radius, in screen pixels
  const atSite = at.site ? SITES.find(s => s.id === at.site) : null;
  const atLandmark = at.landmark ? landmarks.find(l => l.id === at.landmark) : null;
  const you = atSite ?? atLandmark ?? null;

  return (
    <div
      ref={wrapRef}
      className="nr-townmap"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: TOWN.fields, touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={e => {
        if (travelled.current > DRAG_THRESHOLD) e.stopPropagation();
      }}
    >
      <svg
        viewBox={`0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}`}
        preserveAspectRatio="xMinYMin meet"
        style={{ display: 'block', width: '100%', height: '100%', userSelect: 'none' }}
        role="img"
        aria-label="Map of Bruges. Each place you can go is a landmark; choose one to open it."
      >
        <rect x={0} y={0} width={vbW} height={vbH} fill={TOWN.fields} />
        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
          {/* Field strips outside the walls. */}
          {Array.from({ length: 16 }, (_, i) => (
            <path key={i} d={`M${-200 + i * 90} -100 L${100 + i * 90} 1000`} stroke={TOWN.block} strokeWidth={1} opacity={0.35} />
          ))}
          {/* The canal to Damme and the sea. */}
          <path d="M712 118 L760 40 L800 -60" fill="none" stroke={TOWN.water} strokeWidth={14} strokeLinecap="round" />
          {/* Moat, then the town inside the wall. */}
          <path d={WALL} fill="none" stroke={TOWN.waterEdge} strokeWidth={34} strokeLinejoin="round" />
          <path d={WALL} fill="none" stroke={TOWN.water} strokeWidth={28} strokeLinejoin="round" />
          <path d={WALL} fill={TOWN.town} stroke={TOWN.wall} strokeWidth={5} strokeLinejoin="round" />

          {BLOCKS.map((b, i) => (
            <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={TOWN.block} transform={`rotate(${b.r} ${b.x + b.w / 2} ${b.y + b.h / 2})`} />
          ))}

          {streets.map(s => (
            <path key={s.name} d={s.d} fill="none" stroke={TOWN.street} strokeWidth={9} strokeLinecap="round" />
          ))}

          {/* The Reie and its arms, with the Minnewater at the south. */}
          <ellipse cx={478} cy={742} rx={34} ry={22} fill={TOWN.water} stroke={TOWN.waterEdge} strokeWidth={1.5} />
          {[REIE, ...CANALS].map((d, i) => (
            <g key={i}>
              <path d={d} fill="none" stroke={TOWN.waterEdge} strokeWidth={i ? 9 : 13} strokeLinecap="round" />
              <path d={d} fill="none" stroke={TOWN.water} strokeWidth={i ? 6 : 10} strokeLinecap="round" />
            </g>
          ))}

          {/* The Markt, with the Belfort on its south side, and the Burg. */}
          <rect x={MARKT.x} y={MARKT.y} width={MARKT.w} height={MARKT.h} fill={TOWN.square} stroke={TOWN.wall} strokeWidth={1} />
          <rect x={MARKT.x + MARKT.w / 2 - 6} y={MARKT.y + MARKT.h - 4} width={12} height={16} fill={TOWN.wall} />
          <rect x={BURG.x} y={BURG.y} width={BURG.w} height={BURG.h} fill={TOWN.square} stroke={TOWN.wall} strokeWidth={1} />

          {/* Gate towers on the wall. */}
          {GATES.map(([name, x, y]) => (
            <g key={name}>
              <rect x={x - 9} y={y - 9} width={18} height={18} fill={TOWN.wall} transform={`rotate(45 ${x} ${y})`} />
              <title>{name}</title>
            </g>
          ))}

          {/* Background names, in screen pixels: the squares and the river. */}
          {[
            // Beside the square, not above or below: the pennant marking where you are stands over
            // the Waterhalle, and its name and description run underneath.
            ['Markt', MARKT.x - 24, MARKT.y + 10],
            ['Minnewater', 478, 778],
            ['to Damme and the Zwin', 770, 30],
          ].map(([t, x, y]) => (
            <text key={t as string} x={x as number} y={y as number} textAnchor="middle" fontFamily={FONT.body} fontStyle="italic" fontSize={11 * inv} fill={TOWN.label} opacity={0.55} pointerEvents="none">
              {t}
            </text>
          ))}

          {/* Where the town has put you, when it is not a place you chose. */}
          {SITES.map(s => {
            const here = atSite?.id === s.id;
            if (s.id === 'gate' && !here) return null;
            return (
              <g key={s.id} pointerEvents="none" opacity={here ? 1 : 0.6}>
                <rect x={s.x - 7 * inv} y={s.y - 7 * inv} width={14 * inv} height={14 * inv} fill={here ? UI.bad : TOWN.block} stroke={TOWN.wall} strokeWidth={1.2 * inv} />
                <text x={s.x} y={s.y + 20 * inv} textAnchor="middle" fontFamily={FONT.body} fontSize={11 * inv} fill={TOWN.label} stroke={TOWN.labelHalo} strokeWidth={3 * inv} paintOrder="stroke">
                  {s.name}
                </text>
              </g>
            );
          })}

          {landmarks.map(l => {
            const sel = selected === l.id;
            const hov = hovered === l.id;
            const badge = badges[l.id];
            return (
              <g
                key={l.id}
                id={`nr-place-${l.id}`}
                role="button"
                tabIndex={0}
                aria-label={`${l.name}, ${l.where}${badge ? `. ${badge}` : ''}`}
                aria-pressed={sel}
                style={{ cursor: 'pointer', outline: 'none' }}
                onClick={e => { e.stopPropagation(); onPick(l.id); }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(l.id); } }}
                onPointerEnter={() => setHovered(l.id)}
                onPointerLeave={() => setHovered(h => (h === l.id ? null : h))}
              >
                {/* The click target, bigger than the mark so a finger can find it. */}
                <circle cx={l.x} cy={l.y} r={24 * inv} fill="transparent" />
                {sel && <circle cx={l.x} cy={l.y} r={(R + 6) * inv} fill="none" stroke={TOWN.markEdge} strokeWidth={2.5 * inv} />}
                <circle cx={l.x} cy={l.y} r={(hov ? R + 2 : R) * inv} fill={sel ? TOWN.markEdge : TOWN.mark} stroke={TOWN.markEdge} strokeWidth={2 * inv} />
                <g transform={`translate(${l.x - 8 * inv} ${l.y - 8 * inv}) scale(${inv})`} pointerEvents="none">
                  <Icon name={l.icon} colour={sel ? TOWN.mark : TOWN.markIcon} />
                </g>
                {badge && <circle cx={l.x + 11 * inv} cy={l.y - 11 * inv} r={5 * inv} fill={UI.good} stroke={TOWN.labelHalo} strokeWidth={1.5 * inv} pointerEvents="none" />}
                {(() => {
                  const side = l.labelSide ?? 'below';
                  const lx = side === 'below' ? l.x : l.x + (side === 'right' ? 1 : -1) * (R + 5) * inv;
                  const ly = side === 'below' ? l.y + (R + 15) * inv : l.y + 4.5 * inv;
                  const anchor = side === 'below' ? 'middle' : side === 'right' ? 'start' : 'end';
                  return (
                    <>
                      <text x={lx} y={ly} textAnchor={anchor} fontFamily={FONT.display} fontSize={13 * inv} fill={TOWN.label} stroke={TOWN.labelHalo} strokeWidth={3.5 * inv} paintOrder="stroke" strokeLinejoin="round" pointerEvents="none">
                        {l.name}
                      </text>
                      {(sel || hov) && (
                        <text x={lx} y={ly + 14 * inv} textAnchor={anchor} fontFamily={FONT.body} fontStyle="italic" fontSize={11 * inv} fill={TOWN.label} stroke={TOWN.labelHalo} strokeWidth={3 * inv} paintOrder="stroke" pointerEvents="none">
                          {badge ?? l.where}
                        </text>
                      )}
                    </>
                  );
                })()}
              </g>
            );
          })}

          {/* You: a pennant over wherever the character is. */}
          {you && (
            <g transform={`translate(${you.x} ${you.y - (atLandmark ? R + 4 : 9) * inv}) scale(${inv})`} pointerEvents="none">
              <line x1={0} y1={0} x2={0} y2={-26} stroke={TOWN.label} strokeWidth={2} />
              <path d="M0 -26 L16 -20 L0 -14 Z" fill={UI.ensign} stroke={TOWN.labelHalo} strokeWidth={1} />
              {at.label && (
                <text x={20} y={-16} fontFamily={FONT.body} fontSize={11} fill={TOWN.label} stroke={TOWN.labelHalo} strokeWidth={3} paintOrder="stroke">
                  {at.label}
                </text>
              )}
            </g>
          )}
        </g>
      </svg>

      <div style={{ position: 'absolute', right: 10 + (inset?.right ?? 0), bottom: 10 + (inset?.bottom ?? 0), display: 'flex', flexDirection: 'column', gap: 6, transition: 'right 0.25s ease, bottom 0.25s ease' }}>
        {([['+', () => zoomAt(1.4), 'Zoom in (+)'], ['−', () => zoomAt(1 / 1.4), 'Zoom out (-)'], ['fit', fit, 'Fit the town (0)']] as const).map(([t, fn, label]) => (
          <button key={t} type="button" onClick={fn} aria-label={label} title={label}
            style={{ width: 40, height: 40, borderRadius: 3, background: TOWN.control, border: `1px solid ${UI.ruleStrong}`, color: UI.text, cursor: 'pointer', fontFamily: FONT.data, fontSize: t === 'fit' ? '0.6rem' : '1.1rem' }}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

export type IconName = 'house' | 'hall' | 'sword' | 'dagger' | 'duel' | 'crane' | 'book' | 'ship' | 'scales' | 'bed' | 'coins';

/** Sixteen-pixel line icons, one per place. */
function Icon({ name, colour }: { name: IconName; colour: string }) {
  const p = { fill: 'none', stroke: colour, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'house':
      return <g {...p}><path d="M2.5 8 8 3l5.5 5" /><path d="M4 7v6.5h8V7" /><path d="M7 13.5v-3h2v3" /></g>;
    case 'hall':
      return <g {...p}><path d="M2 13.5h12M3 6h10M8 2.5 3 6M8 2.5 13 6" /><path d="M4.5 6v7.5M8 6v7.5M11.5 6v7.5" /></g>;
    case 'sword':
      return <g {...p}><path d="M3 13 11.5 4.5M10 3h3v3" /><path d="M4.5 9.5l2 2M3 13l1.5-1.5" /></g>;
    case 'dagger':
      return <g {...p}><path d="M8 2v8M5.5 10h5M8 10v4" /><circle cx="8" cy="14.2" r="0.6" /></g>;
    case 'duel':
      return <g {...p}><path d="M3 3l10 10M13 3 3 13" /><path d="M3 10.5l2.5 2.5M13 10.5 10.5 13" /></g>;
    case 'crane':
      return <g {...p}><path d="M4 14V3h8" /><path d="M11 3v5" /><path d="M9.5 8h3v2.5h-3z" /><path d="M2.5 14h4" /></g>;
    case 'book':
      return <g {...p}><path d="M8 4.5C6.5 3.5 4.5 3 2.5 3.2v9.3c2-.2 4 .3 5.5 1.3 1.5-1 3.5-1.5 5.5-1.3V3.2C11.5 3 9.5 3.5 8 4.5z" /><path d="M8 4.5v9.3" /></g>;
    case 'ship':
      return <g {...p}><path d="M2 10.5h12l-2 3H4z" /><path d="M8 10.5V2.5l4.5 6H8" /></g>;
    case 'scales':
      return <g {...p}><path d="M8 2.5v11M5 13.5h6M3 5h10" /><path d="M3 5 1.5 9h3zM13 5l-1.5 4h3z" /></g>;
    case 'bed':
      return <g {...p}><path d="M2 12.5V5M2 10h12v2.5M14 10V8.5a1.5 1.5 0 0 0-1.5-1.5H7v3" /><circle cx="4.5" cy="8" r="1.2" /></g>;
    case 'coins':
      return <g {...p}><ellipse cx="8" cy="5" rx="4.5" ry="1.8" /><path d="M3.5 5v3c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V5" /><path d="M3.5 8v3c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V8" /></g>;
  }
}
