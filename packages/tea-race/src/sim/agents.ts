/**
 * Port agents — a standing man on the ground at one quay.
 *
 * The problem this solves is that money has only ever had three uses: cargo, hulls and shares. Cargo
 * and hulls both cap out (three slots, three ships), and shares are the win condition, so a captain
 * having a good season has nowhere to put the proceeds except straight at the endgame. An agent is a
 * permanent, local, compounding investment — you are buying a *place* rather than a thing, which is
 * the one axis this game had nothing on.
 *
 * Deliberately per-port and permanent. A cheaper-loading bonus you can move around is just a
 * discount; one nailed to Foochow makes Foochow worth building a route around, and that is what makes
 * "where you trade" a position you hold rather than a decision you re-make every turn.
 *
 * Three things an agent does, all of them small on their own:
 *
 *  - **Cheaper lading.** He knows the merchants, so you pay less than the quay's asking price.
 *  - **A better price for cargo sold off.** The same relationship, working the other way.
 *  - **Word ahead.** Any commission whose buyer is his port is flagged on the exchange the moment it
 *    is posted, and the harbour's own news reaches you a round early.
 *
 * AUTHORED entirely; the 1988 board has nothing like it. Behind the `agents` toggle.
 */

import { PORT_BY_ID, portName } from './content';
import type { GameState, PortId } from './types';

/**
 * What an agent costs to install. Flat rather than scaled by the port's importance: a scaled price
 * would just mean everybody buys the same two or three quays, and the interesting decision is which
 * corner of the chart you intend to make your own.
 */
export const AGENT_PRICE = 220;

/** How much an agent takes off the asking price at his quay. */
export const AGENT_LADING_DISCOUNT = 0.12;
/** And how much he adds to what the quay pays for cargo sold off it. */
export const AGENT_SALE_UPLIFT = 0.15;

/** At most this many, or a rich captain simply buys the whole chart. */
export const MAX_AGENTS = 4;

/** Does this captain keep an agent here? */
export function hasAgent(state: GameState, captainId: string, port: PortId): boolean {
  if (!state.hazards?.agents) return false;
  return (state.captains.find(c => c.id === captainId)?.agents ?? []).includes(port);
}

/** Every port where anyone keeps an agent, for the chart to mark. */
export function agentPorts(state: GameState, captainId: string): PortId[] {
  if (!state.hazards?.agents) return [];
  return (state.captains.find(c => c.id === captainId)?.agents ?? []).slice();
}

export function canPlaceAgent(state: GameState, captainId: string, port: PortId): boolean {
  if (!state.hazards?.agents) return false;
  if (!PORT_BY_ID[port]) return false;
  const captain = state.captains.find(c => c.id === captainId);
  if (!captain) return false;
  const held = captain.agents ?? [];
  return (
    held.length < MAX_AGENTS && !held.includes(port) && captain.cash >= AGENT_PRICE
  );
}

/** The line the log wants when one is installed. */
export const agentInstalledText = (name: string, port: PortId, held: number): string =>
  `${name} sets up an agent at ${portName(port)} — ${held} of ${MAX_AGENTS}. ` +
  `He lades ${Math.round(AGENT_LADING_DISCOUNT * 100)}% under the asking price, sells ` +
  `${Math.round(AGENT_SALE_UPLIFT * 100)}% over it, and sends word ahead of the market.`;
