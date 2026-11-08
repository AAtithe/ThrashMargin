import { useEffect, useRef, type CSSProperties } from 'react';
import type { HeroKind } from '../sim/rules';
import { drawInsignia, drawPortrait } from './campaignArtBridge';

/** Canvas wrappers for the campaign's small pieces of art, drawn at the screen's pixel density. */

function useCanvas(size: number, paint: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    paint(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, ...deps]);
  return ref;
}

export function HeroPortrait({
  hero,
  level,
  wounded = false,
  size = 56,
  style,
}: {
  hero: HeroKind;
  level: number;
  wounded?: boolean;
  size?: number;
  style?: CSSProperties;
}) {
  const ref = useCanvas(size, ctx => drawPortrait(ctx, hero, level, 0, 0, size, wounded), [hero, level, wounded]);
  return <canvas ref={ref} aria-hidden="true" className="fl-portrait" style={{ width: size, height: size, flexShrink: 0, ...style }} />;
}

export function RankInsignia({ rank, size = 48, style }: { rank: number; size?: number; style?: CSSProperties }) {
  const ref = useCanvas(size, ctx => drawInsignia(ctx, rank, 0, 0, size), [rank]);
  return <canvas ref={ref} aria-hidden="true" style={{ width: size, height: size, flexShrink: 0, ...style }} />;
}
