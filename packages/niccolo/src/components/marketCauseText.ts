import { findGood } from '../sim/content';
import type { PriceCauseNote } from '../sim/types';

/**
 * Turns a `PriceCauseNote` (Phase 16) into the one fixed sentence its `kind` always uses — no
 * phrasing variety in this first outing, matching the zero-variation precedent
 * `GameScreen.tsx`'s own `lastVoyageEvent`/`lastSabotageEvent` lines already set. Shared by every
 * panel that shows a cause (`DispatchesPanel`, `CityPreviewPanel`, `MarketPanel`) so a corrected
 * report and a true one read identically regardless of which panel is looking at them.
 */
export function describeMarketCause(cause: PriceCauseNote, cityName: string): string {
  const good = findGood(cause.goodId)?.name ?? cause.goodId;
  switch (cause.kind) {
    case 'house_trade':
      return `${cause.houseName ?? 'A rival house'}'s factors have reportedly been ${
        cause.direction === 1 ? 'buying' : 'selling'
      } ${good} in ${cityName}.`;
    case 'settling':
      return `${good} prices in ${cityName} are settling back toward the old rate.`;
    case 'demand_shift':
      // Deliberately vague about the cause: the *event* carries its own authored narration, which
      // the player sees in full only at a city they can actually see into. A report from three
      // weeks away should tell them the demand moved, not hand over the local gossip verbatim.
      return `Something in ${cityName} has changed what ${good} is worth there — demand, not trade.`;
    case 'unknown_flows':
    default:
      return `Merchants unknown to you have been trading ${good} hard in ${cityName}.`;
  }
}
