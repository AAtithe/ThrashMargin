/**
 * War for the Planet: the planet map as a canvas (fireline-planet-design.md, section 17). W4.
 * The drawing is game/planetArt.ts; this owns the canvas, its size, the theme's colours, the
 * click that selects a region, the hovered region (a soft fill and a name tag, mouse and pen only)
 * and the selection ring's slow pulse, which runs only while motion is on and a region is selected.
 * Clicks, hover and drawing all use the one fitPlanet, so what is drawn is what is hit.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { drawPlanetMap, fitPlanet, planetAspect, readPlanetPalette, regionAt, type PlanetPalette } from '../../game/planetArt';
import { usePace } from '../../lib/motion';
import type { PlanetMap, PlanetState, RegionId } from '../../planet/types';

export default function PlanetMapCanvas({
  s,
  map,
  selected,
  targets,
  moves,
  onSelect,
}: {
  s: PlanetState;
  map: PlanetMap;
  selected: RegionId | null;
  targets: RegionId[];
  moves: RegionId[];
  onSelect: (r: RegionId | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [palette, setPalette] = useState<PlanetPalette | null>(null);
  const [hover, setHover] = useState<{ r: RegionId; x: number; y: number } | null>(null);
  const pace = usePace();
  const pulse = useRef(0);
  const moveFrame = useRef(0);

  // The box's size, kept current (measured before the first paint, so the map never flashes empty).
  useLayoutEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => setSize({ w: box.clientWidth, h: box.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // The colours, read from the tokens and again whenever the theme changes.
  useLayoutEffect(() => {
    const read = () => setPalette(readPlanetPalette(document.documentElement));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => mo.disconnect();
  }, []);

  // One draw, from the latest props; the pulse loop calls it too, so it lives in a ref.
  const hoverRegion = hover?.r ?? null;
  const draw = useRef<() => void>(() => {});
  draw.current = () => {
    const c = canvas.current;
    if (!c || !palette || size.w <= 0 || size.h <= 0) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fit = fitPlanet(size.w, size.h, map);
    drawPlanetMap(ctx, map, s, { ...fit, palette, selected, targets, moves, names: size.w >= 640, hover: hoverRegion, pulse: pulse.current });
  };

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || size.w <= 0 || size.h <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(size.w * dpr);
    const h = Math.round(size.h * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  }, [size]);

  useLayoutEffect(() => {
    draw.current();
  }, [s, map, selected, targets, moves, palette, size, hoverRegion]);

  // The selection's pulse: a slow breath while motion is on; a still ring when it is off.
  useEffect(() => {
    if (selected === null || pace === 'off') {
      if (pulse.current !== 0) {
        pulse.current = 0;
        draw.current();
      }
      return;
    }
    let raf = 0;
    const period = pace === 'quick' ? 1100 : 1800;
    const t0 = performance.now();
    const tick = (now: number) => {
      pulse.current = 0.5 - 0.5 * Math.cos(((now - t0) / period) * Math.PI * 2);
      draw.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      pulse.current = 0;
    };
  }, [selected, pace]);

  useEffect(() => () => cancelAnimationFrame(moveFrame.current), []);

  const toPlanet = (el: HTMLCanvasElement, clientX: number, clientY: number) => {
    const box = el.getBoundingClientRect();
    const fit = fitPlanet(box.width, box.height, map);
    return { r: regionAt(map, (clientX - box.left - fit.ox) / fit.scale, (clientY - box.top - fit.oy) / fit.scale), x: clientX - box.left, y: clientY - box.top };
  };

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    onSelect(toPlanet(e.currentTarget, e.clientX, e.clientY).r);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') return;
    const el = e.currentTarget;
    const { clientX, clientY } = e;
    cancelAnimationFrame(moveFrame.current);
    moveFrame.current = requestAnimationFrame(() => {
      const h = toPlanet(el, clientX, clientY);
      el.style.cursor = h.r === null ? 'default' : 'pointer';
      setHover(prev => (h.r === null ? null : prev && prev.r === h.r && Math.abs(prev.x - h.x) < 2 && Math.abs(prev.y - h.y) < 2 ? prev : { r: h.r, x: h.x, y: h.y }));
    });
  };

  const leave = () => {
    cancelAnimationFrame(moveFrame.current);
    setHover(null);
  };

  const hg = hover ? map.regions[hover.r] : null;
  const hOwner = hover ? s.regions[hover.r]?.owner ?? -1 : -1;
  const ownerText = hOwner < 0 ? 'Independents' : hOwner === 0 ? `${s.factions[0]?.name ?? 'You'} (yours)` : s.factions[hOwner]?.name ?? '';
  // Keep the tag inside the box: flip it left of the pointer near the right edge, below it near the top.
  const flipX = hover ? hover.x > size.w - 180 : false;
  const flipY = hover ? hover.y < 48 : false;

  return (
    <div ref={wrap} className="fl-pl-canvas" style={{ aspectRatio: String(planetAspect(map)) }}>
      <canvas
        ref={canvas}
        onClick={click}
        onPointerMove={move}
        onPointerLeave={leave}
        role="img"
        aria-label={`The planet ${map.name}: ${map.regions.length} regions. Choose a region from the map or the list.`}
        id="pl-map"
        data-testid="planet-map"
      />
      {hover && hg && (
        <span
          className="fl-pl-hovertip"
          aria-hidden="true"
          data-owner={hOwner}
          style={{
            left: hover.x,
            top: hover.y,
            transform: `translate(${flipX ? 'calc(-100% - 12px)' : '12px'}, ${flipY ? '14px' : 'calc(-100% - 10px)'})`,
          }}
        >
          <strong>{hg.city}</strong>
          <span>
            {ownerText} · level {s.regions[hover.r]?.city.level}
          </span>
        </span>
      )}
    </div>
  );
}
