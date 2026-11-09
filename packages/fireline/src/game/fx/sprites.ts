/**
 * Soft round sprites, painted once and stamped with drawImage. A radial gradient built per
 * particle per frame is the slow way to draw a puff of smoke; copying a ready-made one, scaled and
 * faded with globalAlpha, costs a fraction of it, which is what lets a large battle keep its frame
 * rate with a thousand particles alive.
 */

export interface Sprites {
  /** Grey smoke puff, soft edged. */
  smoke: HTMLCanvasElement;
  /** Pale dust, for vehicles on dirt. */
  dust: HTMLCanvasElement;
  /** Hot fire: white core, orange body. Drawn with 'lighter'. */
  fire: HTMLCanvasElement;
  /** A warm pool of light, for the ground under a muzzle flash or a blast. Drawn with 'lighter'. */
  light: HTMLCanvasElement;
  /** A dark soft disc, for scorch marks. */
  scorch: HTMLCanvasElement;
}

function radial(size: number, stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const [at, col] of stops) g.addColorStop(at, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

let cache: Sprites | null = null;

export function sprites(): Sprites {
  if (cache) return cache;
  cache = {
    smoke: radial(64, [
      [0, 'rgba(62,58,54,0.9)'],
      [0.45, 'rgba(58,55,51,0.55)'],
      [1, 'rgba(50,48,45,0)'],
    ]),
    dust: radial(48, [
      [0, 'rgba(168,146,108,0.75)'],
      [0.5, 'rgba(160,138,100,0.35)'],
      [1, 'rgba(150,130,95,0)'],
    ]),
    fire: radial(64, [
      [0, 'rgba(255,250,225,1)'],
      [0.2, 'rgba(255,214,120,0.95)'],
      [0.5, 'rgba(255,128,40,0.6)'],
      [0.8, 'rgba(170,50,15,0.18)'],
      [1, 'rgba(120,30,10,0)'],
    ]),
    light: radial(128, [
      [0, 'rgba(255,222,150,0.85)'],
      [0.3, 'rgba(255,170,80,0.4)'],
      [0.7, 'rgba(200,90,30,0.1)'],
      [1, 'rgba(160,60,20,0)'],
    ]),
    scorch: radial(64, [
      [0, 'rgba(16,13,10,0.75)'],
      [0.55, 'rgba(22,18,14,0.45)'],
      [1, 'rgba(26,22,16,0)'],
    ]),
  };
  return cache;
}
