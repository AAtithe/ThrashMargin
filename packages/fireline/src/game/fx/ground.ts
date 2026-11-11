/**
 * Where things meet the ground. A structure stands on a skirt of packed earth and gravel that its
 * builders trampled flat, darkening to a soft occlusion shadow tight against its walls and reaching
 * further down and to the right, away from the light (top left, as everywhere in art.ts). A unit
 * gets a small soft contact shadow. Without these the art sits on the terrain like a sticker.
 *
 * Every shape is soft, so each is painted once at world scale per footprint size and stamped with
 * one drawImage. Shadows are made with shadowBlur rather than ctx.filter, which not every browser
 * has.
 */

/** How far past a footprint its skirt and shadow reach, in world pixels. */
export const SKIRT = 16;

const cache = new Map<string, HTMLCanvasElement>();

function hash(n: number): number {
  let h = Math.imul(n ^ 0x2545f491, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * The ground under a structure `w` by `h` world pixels: its skirt (when `skirt` is set) and its
 * occlusion shadow, on a canvas SKIRT pixels larger on every side.
 */
export function footprint(w: number, h: number, skirt: boolean): HTMLCanvasElement {
  const key = `${w}x${h}${skirt ? 's' : ''}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = w + SKIRT * 2;
  c.height = h + SKIRT * 2;
  const g = c.getContext('2d')!;
  const off = 4000; // Shapes are drawn off the canvas and only their shadows land on it.
  if (skirt) {
    // Packed earth, its edge feathered.
    g.shadowColor = 'rgba(124,110,82,0.68)';
    g.shadowBlur = 6;
    g.shadowOffsetX = off;
    g.fillStyle = '#000';
    rounded(g, SKIRT - 7 - off, SKIRT - 6, w + 14, h + 14, 8);
    g.fill();
    // Gravel: pale and dark grains, thickest near the walls.
    g.shadowColor = 'transparent';
    g.shadowBlur = 0;
    g.shadowOffsetX = 0;
    const n = Math.round((w + h) * 1.6);
    for (let i = 0; i < n; i++) {
      const side = hash(i * 3 + w * 7 + h) * 4;
      const along = hash(i * 5 + 11 + w);
      const out = Math.pow(hash(i * 7 + 23 + h), 1.8) * 9;
      let x: number;
      let y: number;
      if (side < 1) [x, y] = [SKIRT - 3 + along * (w + 6), SKIRT - out];
      else if (side < 2) [x, y] = [SKIRT + w + out, SKIRT - 3 + along * (h + 6)];
      else if (side < 3) [x, y] = [SKIRT - 3 + along * (w + 6), SKIRT + h + out + 1];
      else [x, y] = [SKIRT - out, SKIRT - 3 + along * (h + 6)];
      g.fillStyle = hash(i * 13 + 1) < 0.55 ? 'rgba(60,52,38,0.5)' : 'rgba(186,174,146,0.45)';
      const s = 0.7 + hash(i * 17 + 3) * 1.1;
      g.fillRect(x, y, s, s);
    }
  }
  // Occlusion: tight and dark at the walls, then a wider, fainter pool cast down and to the right.
  g.shadowOffsetX = off;
  g.fillStyle = '#000';
  g.shadowColor = 'rgba(0,0,0,0.34)';
  g.shadowBlur = 3;
  rounded(g, SKIRT - off - 1, SKIRT - 1, w + 2, h + 2, 4);
  g.fill();
  g.shadowColor = 'rgba(0,0,0,0.3)';
  g.shadowBlur = 12;
  rounded(g, SKIRT - off + 3, SKIRT + 4, w + 2, h + 2, 6);
  g.fill();
  cache.set(key, c);
  return c;
}

/** A unit's contact shadow: a soft dark ellipse, 64 by 40 pixels, scaled to the unit. */
export function contactShadow(): HTMLCanvasElement {
  let c = cache.get('contact');
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 64;
  c.height = 40;
  const g = c.getContext('2d')!;
  g.translate(32, 20);
  g.scale(1, 0.62);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 31);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, 31, 0, Math.PI * 2);
  g.fill();
  cache.set('contact', c);
  return c;
}
