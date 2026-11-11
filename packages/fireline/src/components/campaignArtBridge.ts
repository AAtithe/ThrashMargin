import {
  campaignMarkerRadius,
  campaignRegionAt,
  drawCampaignMap,
  drawHeroPortrait,
  drawRankInsignia,
  mapFontsReady,
  type CampaignMapOptions,
} from '../game/campaignArt';
import type { TheatreView } from '../campaign/theatre';

/** Resolves once the map's typeface has loaded; draw the map again then. */
export { mapFontsReady };
import type { HeroKind } from '../sim/rules';

/**
 * The campaign screens' view of the canvas art in `game/campaignArt.ts`.
 *
 * This began as a guarded bridge with stand-in drawings, written while the art was being built
 * in parallel. It now calls the real module directly. What it still does is keep hit-testing on
 * exactly the mapping the map is drawn with: an earlier version passed (index, count, w, h) to a
 * function that took (order, w, h), which returned plausible numbers, so clicks landed somewhere
 * other than the drawn nodes. Pass `regionAt` the same act and options the map was drawn with.
 */

type Ctx = CanvasRenderingContext2D;

/** Kept for the screens' data attribute; the art is always present now. */
export const hasCampaignArt = true;

export type { CampaignMapOptions, TheatreView };

/** One mission as the campaign screen lists it (the operations index). The map itself takes a TheatreView. */
export interface CampaignMapNode {
  id: string;
  /** 1-based position in the campaign. */
  order: number;
  title: string;
  state: 'locked' | 'open' | 'won';
  stars: number;
  maxStars: number;
}

/**
 * Paints the theatre map for this view into (0, 0)-(w, h): the whole country, turned to face
 * `view.act` (or all of it with `opts.whole`). The layers are cached per size, act, colour mode
 * and view, so calling this every frame is cheap; `t` (seconds) moves only the pulses on what is
 * open. `opts.scheme` defaults to the page's mode, `opts.compact` to a width under 640,
 * `opts.motion` to true (pass false under reduced motion for still rings), and `opts.capture`
 * plays regions changing hands.
 */
export function drawMap(ctx: Ctx, w: number, h: number, view: TheatreView, t = 0, opts: CampaignMapOptions = {}): void {
  drawCampaignMap(ctx, w, h, view, t, opts);
}

/** The region under canvas point (x, y) of a map `w` by `h` drawn for `act` with these options, or null. */
export function regionAt(x: number, y: number, w: number, h: number, act: 0 | 1, opts: { compact?: boolean; whole?: boolean } = {}): string | null {
  return campaignRegionAt(x, y, w, h, act, opts);
}

/** Radius of an objective's badge on a map `w` by `h`. */
export function markerRadius(w: number, h: number): number {
  return campaignMarkerRadius(w, h);
}

export function drawInsignia(ctx: Ctx, rankIndex: number, x: number, y: number, size: number): void {
  drawRankInsignia(ctx, rankIndex, x, y, size);
}

export function drawPortrait(ctx: Ctx, hero: HeroKind, level: number, x: number, y: number, size: number, wounded: boolean): void {
  drawHeroPortrait(ctx, hero, level, x, y, size, wounded);
}
