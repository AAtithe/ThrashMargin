/**
 * Battlefield events on the map (2026-11-28; src/sim/events.ts): supply crates, the relief beacon with
 * its hold ring, and the fading ring of a fresh ore strike. Drawn above the fog: every event is
 * announced on the radio, so side 0 knows where it is even before it can see the ground.
 *
 * Canvas art only, like art.ts: colours are the canvas's own (team colours from theme.ts), never CSS.
 * With motion reduced nothing pulses or bobs; the shapes still show.
 */
import { RELIEF_HOLD_TICKS, RELIEF_RANGE, type FieldEvent } from '../../sim/events';
import type { Owner } from '../../sim/rules';
import type { GameState } from '../../sim/types';
import { TEAM } from '../../theme';

const TILE = 32;
type Ctx = CanvasRenderingContext2D;

/** The colour of a team: its lowest side's. */
function teamColour(s: GameState, team: number): string {
  const side = s.teams.findIndex(t => t === team);
  return TEAM[(side < 0 ? 0 : side) as Owner].main;
}

function crate(ctx: Ctx, x: number, y: number, t: number, still: boolean): void {
  const bob = still ? 0 : Math.sin(t * 3) * 1.5;
  ctx.save();
  ctx.translate(x, y + bob);
  // Shadow on the ground.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(2, 11 - bob, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // The crate: planks and a strap.
  ctx.fillStyle = '#9a6b34';
  ctx.fillRect(-9, -9, 18, 18);
  ctx.strokeStyle = '#5a3a14';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-9, -9, 18, 18);
  ctx.beginPath();
  ctx.moveTo(-9, -9);
  ctx.lineTo(9, 9);
  ctx.moveTo(9, -9);
  ctx.lineTo(-9, 9);
  ctx.stroke();
  ctx.fillStyle = '#e8d27a';
  ctx.fillRect(-9, -2, 18, 4);
  // A flashing marker lamp on top.
  const on = still || Math.sin(t * 6) > 0;
  ctx.fillStyle = on ? '#ffe36a' : '#8a7a30';
  ctx.beginPath();
  ctx.arc(0, -12, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function beacon(ctx: Ctx, s: GameState, e: FieldEvent, x: number, y: number, t: number, still: boolean): void {
  ctx.save();
  // The ring units must stand inside to hold it.
  ctx.strokeStyle = 'rgba(255, 236, 160, 0.55)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, RELIEF_RANGE * TILE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // The hold so far, in the holding team's colour.
  if (e.hold) {
    ctx.strokeStyle = teamColour(s, e.hold.team);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, RELIEF_RANGE * TILE - 6, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * e.hold.ticks) / RELIEF_HOLD_TICKS);
    ctx.stroke();
  }
  // The mast and its signal.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 6, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#40474b';
  ctx.fillRect(x - 2, y - 22, 4, 28);
  ctx.fillStyle = '#d8dee0';
  ctx.fillRect(x - 8, y + 2, 16, 5);
  const pulse = still ? 0.6 : (t * 0.8) % 1;
  ctx.strokeStyle = `rgba(255, 236, 160, ${0.9 * (1 - pulse)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y - 22, 6 + pulse * 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffec9a';
  ctx.beginPath();
  ctx.arc(x, y - 22, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function oreMark(ctx: Ctx, x: number, y: number, t: number, left: number, still: boolean): void {
  const a = Math.max(0, Math.min(1, left));
  const r = (still ? 3 : 3 + Math.sin(t * 2.5) * 0.4) * TILE;
  ctx.save();
  ctx.strokeStyle = `rgba(255, 214, 102, ${0.7 * a})`;
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Every live event, above the fog. `still` is reduced motion. */
export function drawEventLayer(ctx: Ctx, s: GameState, t: number, still: boolean): void {
  const live = s.events?.live;
  if (!live || !live.length) return;
  for (const e of live) {
    const x = (e.x + 0.5) * TILE;
    const y = (e.y + 0.5) * TILE;
    if (e.kind === 'drop') crate(ctx, x, y, t + e.id * 0.37, still);
    else if (e.kind === 'relief') beacon(ctx, s, e, x, y, t, still);
    else oreMark(ctx, x, y, t, (e.until - s.tick) / 200, still);
  }
}

/** Their marks on the minimap: a small bright square per crate or beacon, at the minimap's scale. */
export function drawEventMarks(ctx: Ctx, s: GameState, scale: number): void {
  const live = s.events?.live;
  if (!live || !live.length) return;
  for (const e of live) {
    ctx.fillStyle = e.kind === 'ore' ? '#ffd666' : e.kind === 'drop' ? '#ffe36a' : '#ffffff';
    const size = Math.max(3, scale * 2);
    ctx.fillRect(e.x * scale + scale / 2 - size / 2, e.y * scale + scale / 2 - size / 2, size, size);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    ctx.strokeRect(e.x * scale + scale / 2 - size / 2 + 0.5, e.y * scale + scale / 2 - size / 2 + 0.5, size - 1, size - 1);
  }
}
