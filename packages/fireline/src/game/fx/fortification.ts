/**
 * Round 7: the Fortification line's effects on the battlefield (fireline-round7-fortification.md).
 * Canvas drawing, like the rest of src/game/fx: the colours are the battlefield's own, not UI tokens.
 *
 *  - drawIntercept: a Point Defence shot, a bright tracer from the emplacement to the point in the air
 *    where it met the projectile, and there a white flash and a ring of fragments when it brought the
 *    projectile down, or a small grey puff when it missed.
 *  - drawBatteryMark: a counter-battery reveal, a red crosshair ring on the traced firing position
 *    that pulses and fades out as its seconds run down. Drawn above the fog, like the recon sweep.
 */
type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

/** How high above the ground (px) an intercept is drawn: shells and bombs are met in the air. */
export const INTERCEPT_LIFT = 14;

/** One Point Defence shot; age in ticks since it was fired (lasts 6). Coordinates in px. */
export function drawIntercept(ctx: Ctx, x: number, y: number, fromX: number, fromY: number, down: boolean, age: number): void {
  if (age > 6) return;
  const f = age / 6;
  const ty = y - INTERCEPT_LIFT;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // The tracer: over in the first two ticks.
  if (age < 2.2) {
    const a = 1 - age / 2.2;
    ctx.strokeStyle = `rgba(150,230,255,${0.9 * a})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY - 6);
    ctx.lineTo(x, ty);
    ctx.stroke();
  }
  if (down) {
    // The flash and a ring of fragments flying out.
    const R = 4 + f * 12;
    ctx.fillStyle = `rgba(255,250,225,${(1 - f) * (1 - f)})`;
    ctx.beginPath();
    ctx.arc(x, ty, 2 + (1 - f) * 4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,215,140,${0.8 * (1 - f)})`;
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 8; k++) {
      const q = (k / 8) * TAU + 0.3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(q) * R * 0.6, ty + Math.sin(q) * R * 0.6);
      ctx.lineTo(x + Math.cos(q) * R, ty + Math.sin(q) * R);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  if (!down) {
    ctx.fillStyle = `rgba(70,72,70,${0.4 * (1 - f)})`;
    ctx.beginPath();
    ctx.arc(x, ty, 2 + f * 4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** A traced battery: centre and radius in px, `t` the animation clock (s), secondsLeft until it fades. */
export function drawBatteryMark(ctx: Ctx, cx: number, cy: number, r: number, t: number, secondsLeft: number): void {
  const fade = Math.max(0, Math.min(1, secondsLeft / 1.5));
  const pulse = 0.75 + 0.25 * Math.sin(t * 6);
  ctx.save();
  ctx.strokeStyle = `rgba(255,90,70,${0.85 * fade * pulse})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.lineDashOffset = t * 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  const inner = Math.max(6, r * 0.35);
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, TAU);
  ctx.stroke();
  // The crosshair's four ticks, from the inner ring outward.
  for (let k = 0; k < 4; k++) {
    const q = (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(q) * inner * 0.4, cy + Math.sin(q) * inner * 0.4);
    ctx.lineTo(cx + Math.cos(q) * (inner + 8), cy + Math.sin(q) * (inner + 8));
    ctx.stroke();
  }
  ctx.restore();
}
