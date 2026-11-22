/**
 * The lobby's War for the Planet preview: one generated planet, drawn once, so the section shows
 * what the mode looks like before anybody starts a war.
 *
 * Read-only use of the war's own code: the planet comes from newPlanetState and planetMapOf on a
 * fixed seed (the same generator a real war uses, so the picture cannot drift from the game), and
 * the drawing is game/planetArt.ts's drawPlanetMap with nothing selected. Static: no loop, no
 * pulse, so there is nothing for reduced motion to stop; it redraws only on a resize or a change
 * of theme. The lobby loads this file with a dynamic import and it generates the planet after the
 * browser is idle, so neither the code nor the work sits in front of the lobby's first paint.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { drawPlanetMap, fitPlanet, planetAspect, readPlanetPalette, type PlanetPalette } from '../game/planetArt';
import { planetMapOf } from '../planet/map';
import { newPlanetState } from '../planet/state';
import { PRESETS } from '../planet/rules';
import type { LengthPreset, PlanetMap, PlanetState } from '../planet/types';

const SEED = 'fireline-lobby';

type World = { s: PlanetState; map: PlanetMap };
const planets: Partial<Record<LengthPreset, World>> = {};
/** The preview's planet for a length, generated on first call and kept for the life of the page. */
function previewPlanet(preset: LengthPreset): World {
  let w = planets[preset];
  if (!w) {
    const s = newPlanetState({ seedText: SEED, preset, difficulty: 'normal', commander: 'You', createdAt: 0 });
    w = planets[preset] = { s, map: planetMapOf(s) };
  }
  return w;
}

const NO_REGIONS: number[] = [];
/** CSS pixels of sea between the land and the frame. */
const PAD = 10;

/** Run fn once the browser is idle (or soon, where requestIdleCallback is missing). */
function whenIdle(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 1200 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}

export default function PlanetPreview({ preset = 'short' }: { preset?: LengthPreset }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [world, setWorld] = useState<World | null>(planets[preset] ?? null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [palette, setPalette] = useState<PlanetPalette | null>(null);

  // The first planet waits for an idle moment; a change of length afterwards draws at once.
  useEffect(() => {
    if (world === planets[preset]) return;
    if (!world) return whenIdle(() => setWorld(previewPlanet(preset)));
    setWorld(previewPlanet(preset));
  }, [preset, world]);

  useLayoutEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => setSize(prev => (prev.w === box.clientWidth && prev.h === box.clientHeight ? prev : { w: box.clientWidth, h: box.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // The colours come from the --pl-* tokens on the root, read again whenever the theme changes.
  useLayoutEffect(() => {
    const read = () => setPalette(readPlanetPalette(document.documentElement));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c || !world || !palette || size.w <= 0 || size.h <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(size.w * dpr);
    const h = Math.round(size.h * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A little sea all round, so no coast touches the frame.
    const fit = fitPlanet(Math.max(1, size.w - 2 * PAD), Math.max(1, size.h - 2 * PAD), world.map);
    drawPlanetMap(ctx, world.map, world.s, { scale: fit.scale, ox: fit.ox + PAD, oy: fit.oy + PAD, palette, selected: null, targets: NO_REGIONS, moves: NO_REGIONS, names: false });
  }, [world, palette, size]);

  const o = PRESETS[preset];
  const factions = world ? world.s.factions : [];
  return (
    <figure className="fl-war-preview" data-testid="lobby-planet-preview" data-ready={world ? '1' : '0'}>
      <div ref={wrap} className="fl-war-preview-map" style={world ? { aspectRatio: String(planetAspect(world.map)) } : undefined}>
        <canvas
          ref={canvas}
          role="img"
          aria-label={`A generated planet${world ? `, ${world.map.name}` : ''}: ${o.regions} regions on ${o.continents} continents, held by ${o.factions} factions and the independents.`}
        />
      </div>
      <figcaption className="fl-war-preview-key">
        <span className="fl-war-preview-name">{world ? `Planet ${world.map.name}` : 'A generated planet'}</span>
        <span className="fl-war-preview-size">
          {o.regions} regions · {o.continents} continents · {o.factions} factions
        </span>
        <ul className="fl-war-preview-legend" aria-label="Key">
          {factions.map((f, i) => (
            <li key={f.name}>
              <span className="fl-war-preview-swatch" style={{ background: `var(--pl-f${i})` }} aria-hidden="true" />
              {f.name}
              {i === 0 ? ' (you)' : ''}
            </li>
          ))}
          {world && (
            <li>
              <span className="fl-war-preview-swatch" style={{ background: 'var(--pl-land-neutral)' }} aria-hidden="true" />
              Independents (N)
            </li>
          )}
        </ul>
        <span className="fl-war-preview-note">A star marks each capital. Dashed lines are sea crossings.</span>
      </figcaption>
    </figure>
  );
}
