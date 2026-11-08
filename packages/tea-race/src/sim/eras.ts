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
import { levelFor } from './career';
import type { GameState, Hazards } from './types';

export interface Era {
  era: number;
  /** The first round of the era, on the round schedule. */
  from: number;
  /** The career level that opens it, on the level schedule. */
  level?: number;
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
    blurb: 'Pirates, encounters at sea, cracking on, the post, and a world that throws strikes and gluts.',
    brings: ['piracy', 'encounters', 'pressSail', 'events', 'letters'],
  },
  {
    era: 3,
    from: 31,
    name: 'The race is on',
    blurb: 'The Great Tea Race, commissions on a clock, and hostile bids for the company.',
    brings: ['teaRace', 'deadlines', 'hostileBids'],
  },
];

/**
 * AUTHORED — the level schedule, used when careers are on as well: the game grows as the captain
 * does, not as the calendar turns.
 *
 * The owner's brief: start as a very simple game and get more complicated as you level up, so you
 * build into it rather than being overwhelmed on the first turn. So the first stage is the 1988
 * board and nothing else but the career that drives the rest, and every later stage is one coherent
 * layer — the chart, then the dangers, then the whole economy and the race. `from` is unused here;
 * it is set so the timeline can still be drawn in rounds if ever wanted.
 *
 * Owners' charters are in no stage, so they are in force from the first turn, and that was measured
 * rather than chosen. With them held back to level 2, the round-30 share leader won 48.5% of 293
 * games against 40.7% with every rule in from the start: the plain board locks in an early leader
 * (71% on the 1988 board itself), and charters carry the game's catch-up payment. From level 1,
 * 43.7%, inside the noise. They suit a beginner too: a charter says what to aim for.
 */
export const LEVEL_ERAS: Era[] = [
  { era: 1, from: 1, level: 1, name: 'The 1988 board', blurb: "Dice, five commissions, ten shares, and your owners' charters. Learn the loop.", brings: [] },
  {
    era: 2,
    from: 1,
    level: 2,
    name: 'The chart opens',
    blurb: 'Wind and weather, hulls to choose between, and cargo you can sell off at the quay.',
    brings: ['weather', 'shipClasses', 'quaysideSales'],
  },
  {
    era: 3,
    from: 1,
    level: 3,
    name: 'Rough seas',
    blurb: 'Pirates, encounters at sea, cracking on, ships that make a name, and the post.',
    brings: ['piracy', 'encounters', 'pressSail', 'renown', 'letters'],
  },
  {
    era: 4,
    from: 1,
    level: 4,
    name: 'The full race',
    blurb: 'The world, the money and the race: events, wages, loans, the tea race, the clock, the exchange, agents, hostile bids.',
    brings: ['events', 'wages', 'loans', 'teaRace', 'deadlines', 'stocks', 'agents', 'hostileBids'],
  },
];

/** True when the game grows with the captain rather than the calendar: careers and eras both on. */
export const levelDriven = (plan: Hazards | undefined, rules: GameState['rules']): boolean =>
  Boolean(plan?.ramp && plan?.career) && rules === 'classic';

/** Which schedule a game's eras follow. */
export const scheduleFor = (plan: Hazards | undefined, rules: GameState['rules']): Era[] =>
  levelDriven(plan, rules) ? LEVEL_ERAS : ERAS;

/**
 * The level that sets the pace: the highest human captain's, so a computer captain racing ahead
 * never drags a learner into rules they have not reached; on an all-computer table, the highest
 * captain's. With two humans at one screen the stronger sets it, so neither is held back.
 */
export function tableLevel(state: GameState): number {
  const humans = state.captains.filter(c => c.kind === 'human');
  const pool = humans.length > 0 ? humans : state.captains;
  return Math.max(1, ...pool.map(c => levelFor(c.xp)));
}

/** The era a game should be in now, on whichever schedule it follows. */
export function currentEra(state: GameState): Era {
  if (!levelDriven(state.rampPlan, state.rules)) return eraFor(state.round);
  const level = tableLevel(state);
  let current = LEVEL_ERAS[0];
  for (const e of LEVEL_ERAS) if (level >= (e.level ?? 1)) current = e;
  return current;
}

/** The next era on a game's schedule, if any. */
export const nextEraOf = (state: GameState): Era | null => {
  const schedule = scheduleFor(state.rampPlan, state.rules);
  return schedule.find(e => e.era === (state.era ?? 1) + 1) ?? null;
};

/** Every rule an era holds back until its time. */
export const STAGED: (keyof Hazards)[] = ERAS.flatMap(e => e.brings);

export function eraFor(round: number): Era {
  let current = ERAS[0];
  for (const e of ERAS) if (round >= e.from) current = e;
  return current;
}

export const nextEra = (era: number): Era | null => ERAS.find(e => e.era === era + 1) ?? null;

/** The rules in force in an era: the plan, less whatever is still to come. */
export function hazardsForEra(plan: Hazards, era: number, schedule: Era[] = ERAS): Hazards {
  const out: Hazards = { ...plan };
  for (const e of schedule) {
    if (e.era <= era) continue;
    for (const key of e.brings) if (key in out) (out as unknown as Record<string, boolean>)[key] = false;
  }
  return out;
}

