import {
  campaignNodePosition,
  campaignNodeRadius,
  drawCampaignMap,
  drawHeroPortrait,
  drawRankInsignia,
} from '../game/campaignArt';
import type { HeroKind } from '../sim/rules';

/**
 * The campaign screens' view of the canvas art in `game/campaignArt.ts`.
 *
 * This began as a guarded bridge with stand-in drawings, written while the art was being built
 * in parallel. It now calls the real module directly. The one thing it still does is adapt the
 * screens' node list to the art's, and keep hit-testing on exactly the positions the map is drawn
 * at: an earlier version passed (index, count, w, h) to a function that takes (order, w, h), which
 * returned plausible numbers, so clicks landed somewhere other than the drawn nodes.
 */

/** One mission on the theatre map, as the campaign screen describes it. */
export interface CampaignMapNode {
  id: string;
  /** 1-based position in the campaign. */
  order: number;
  title: string;
  state: 'locked' | 'open' | 'won';
  stars: number;
  maxStars: number;
  /** The node the briefing is open for. */
  selected?: boolean;
  /** The node under the pointer. */
  hover?: boolean;
}

type Ctx = CanvasRenderingContext2D;

/** Kept for the screens' data attribute; the art is always present now. */
export const hasCampaignArt = true;

/** Where the node with this 1-based order sits on a map `w` by `h` CSS pixels. */
export function nodePosition(order: number, w: number, h: number): { x: number; y: number } {
  return campaignNodePosition(order, w, h);
}

/** How close a click must be to a node's centre to pick it. */
export function nodeHitRadius(w: number, h: number): number {
  return campaignNodeRadius(w, h) + 4;
}

export function drawMap(ctx: Ctx, w: number, h: number, nodes: CampaignMapNode[], t = 0): void {
  drawCampaignMap(
    ctx,
    w,
    h,
    nodes.map(n => ({ id: n.id, order: n.order, title: n.title, state: n.state, stars: n.stars, selected: !!n.selected, hover: !!n.hover })),
    t,
  );
}

export function drawInsignia(ctx: Ctx, rankIndex: number, x: number, y: number, size: number): void {
  drawRankInsignia(ctx, rankIndex, x, y, size);
}

export function drawPortrait(ctx: Ctx, hero: HeroKind, level: number, x: number, y: number, size: number, wounded: boolean): void {
  drawHeroPortrait(ctx, hero, level, x, y, size, wounded);
}
