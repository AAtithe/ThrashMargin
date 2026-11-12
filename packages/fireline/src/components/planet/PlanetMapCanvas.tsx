/**
 * War for the Planet: the planet map as a canvas (fireline-planet-design.md, section 17). W4.
 * The drawing is game/planetArt.ts; this owns the canvas, its size, the theme's colours and the
 * click that selects a region.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { drawPlanetMap, fitPlanet, readPlanetPalette, regionAt, type PlanetPalette } from '../../game/planetArt';
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

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !palette || size.w <= 0 || size.h <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fit = fitPlanet(size.w, size.h);
    drawPlanetMap(ctx, map, s, { ...fit, palette, selected, targets, moves, names: size.w >= 640 });
  }, [s, map, selected, targets, moves, palette, size]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const fit = fitPlanet(box.width, box.height);
    const x = (e.clientX - box.left - fit.ox) / fit.scale;
    const y = (e.clientY - box.top - fit.oy) / fit.scale;
    onSelect(regionAt(map, x, y));
  };

  return (
    <div ref={wrap} className="fl-pl-canvas">
      <canvas ref={canvas} onClick={click} role="img" aria-label={`The planet ${map.name}: ${map.regions.length} regions. Choose a region from the map or the list.`} id="pl-map" data-testid="planet-map" />
    </div>
  );
}
