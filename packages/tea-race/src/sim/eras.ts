/**
 * Eras: the world's dangers and contests arrive in stages. Pure.
 *
 * The owner asked for play that ramps up over time. A game used to open with every rule in force
 * from the first roll — pirates, strikes, expiring cards, encounters — which is a great deal to take
 * in at once and leaves nowhere for the game to go. With eras on, the opening is trade and the wind;
 * the sea turns dangerous in the second era, and the race proper — the tea race, the clock on the
 * commissions, the hostile bid — arrives in the third. Only rules the game was set up with ever
 * arrive: an era switches on what is in the plan, never anything the players turned off.
 *
 * The economy (wages, loans, the exchange, agents, hulls, quayside sales) is in force from the start
 * whatever the era. Those rules carry state from round one, and switching them on mid-game would
 * mean inventing an opening position for each.
 */
import type { Hazards } from './types';

export interface Era {
  era: number;
  /** The first round of the era. */
  from: number;
  name: string;
  blurb: string;
  /** Rules this era brings, if the game was set up with them. */
  brings: (keyof Hazards)[];
}

/** AUTHORED — the eras. Era III opens on the round of the second year's tea race, so it starts with one. */
export const ERAS: Era[] = [
  { era: 1, from: 1, name: 'Fair winds', blurb: 'Trade and the wind. Learn the chart.', brings: [] },
  {
    era: 2,
    from: 13,
    name: 'Rough seas',
    blurb: 'Pirates, encounters at sea, cracking on, and a world that throws strikes and gluts.',
    brings: ['piracy', 'encounters', 'pressSail', 'events'],
  },
  {
    era: 3,
    from: 31,
    name: 'The race is on',
    blurb: 'The Great Tea Race, commissions on a clock, and hostile bids for the company.',
    brings: ['teaRace', 'deadlines', 'hostileBids'],
  },
];

/** Every rule an era holds back until its time. */
export const STAGED: (keyof Hazards)[] = ERAS.flatMap(e => e.brings);

export function eraFor(round: number): Era {
  let current = ERAS[0];
  for (const e of ERAS) if (round >= e.from) current = e;
  return current;
}

export const nextEra = (era: number): Era | null => ERAS.find(e => e.era === era + 1) ?? null;

/** The rules in force in an era: the plan, less whatever is still to come. */
export function hazardsForEra(plan: Hazards, era: number): Hazards {
  const out: Hazards = { ...plan };
  for (const e of ERAS) {
    if (e.era <= era) continue;
    for (const key of e.brings) if (key in out) (out as unknown as Record<string, boolean>)[key] = false;
  }
  return out;
}
