import { BUILDINGS, type BuildingKind, type UnitKind } from '../sim/rules';
import { drawBuilding, drawUnit, TILE } from './art';

/**
 * Build-menu icons, drawn once with the same functions that draw the battlefield, then kept as
 * data URLs. A structure is scaled to fit; a unit is drawn large and facing right.
 */
const cache = new Map<string, string>();

export function iconFor(kind: BuildingKind | UnitKind): string {
  const hit = cache.get(kind);
  if (hit) return hit;
  const W = 96;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3e5a2c');
  g.addColorStop(1, '#2b3f1f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // A little ground texture (fixed, so every icon matches) and a soft vignette to seat the art.
  for (let i = 0; i < 70; i++) {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 12345.6789;
    ctx.fillStyle = i % 2 ? 'rgba(110,140,70,0.35)' : 'rgba(25,40,15,0.35)';
    ctx.fillRect((a - Math.floor(a)) * W, (b - Math.floor(b)) * H, 1.2, 2.2);
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  if (kind in BUILDINGS) {
    const spec = BUILDINGS[kind as BuildingKind];
    const s = Math.min((W - 10) / (spec.w * TILE), (H - 8) / (spec.h * TILE), 1.2);
    ctx.save();
    ctx.translate((W - spec.w * TILE * s) / 2 - 2, (H - spec.h * TILE * s) / 2 - 2);
    ctx.scale(s, s);
    drawBuilding(ctx, kind as BuildingKind, 0, 0, 0, { t: 1, rise: 1, lowPower: false, turret: -0.6, sinceShot: 9 });
    ctx.restore();
  } else {
    const infantry = kind === 'rifleman' || kind === 'rocketeer';
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(infantry ? 2.6 : 1.9, infantry ? 2.6 : 1.9);
    drawUnit(ctx, kind as UnitKind, 0, 0, 0, { hull: -0.35, turret: -0.35, t: 0, moving: false, cargo: kind === 'hauler' ? 0.8 : 0, sinceShot: 9 });
    ctx.restore();
  }
  const url = c.toDataURL();
  cache.set(kind, url);
  return url;
}
