/**
 * Seamanship: the Great Tea Race, cracking on, and encounters at sea.
 *
 * Pure helpers only; the reducer in actions.ts applies them and writes the log. All three systems
 * are optional (`Hazards.teaRace`, `pressSail`, `encounters`) and off in the 1988 preset.
 *
 * Why they exist: a ship at sea had no decisions at all. `ROLL` advanced her and that was the whole
 * of her turn, so most of a captain's fleet spent most of the game as spectators. Cracking on and
 * encounters both put a choice on a ship already under way; the race gives the whole table one
 * contest a year that everybody can see coming and plan towards.
 */
import { GOODS, GOOD_BY_ID, PORTS, goodName, legBetween, portName } from './content';
import { next, nextInt } from './rng';
import {
  ENCOUNTER_CHANCE,
  ROUNDS_PER_SEASON,
  SPAR_CARRIED_ON,
  TEA_RACE_FINISH,
  TEA_RACE_OPENS_IN_YEAR,
  TEA_RACE_PREMIUM,
  TEA_RACE_PURSE,
  TEA_RACE_ROUNDS,
  slotsOf,
} from './rules';
import type { CargoLot, Encounter, EncounterKind, GameState, Ship, TeaRace } from './types';

const ROUNDS_PER_YEAR = ROUNDS_PER_SEASON * 4;

/** The ports the new season's tea comes down to. Derived from the content, never listed by hand. */
export const TEA_RACE_PORTS: string[] = PORTS.filter(p => p.supplies.includes('tea')).map(p => p.id);

/** Which year of the game a round falls in, 1-based. */
export const yearOf = (round: number): number => Math.floor(Math.max(0, round - 1) / ROUNDS_PER_YEAR) + 1;

/** True on the round each year's race opens. */
export const raceOpensOn = (round: number): boolean =>
  (Math.max(0, round - 1) % ROUNDS_PER_YEAR) === TEA_RACE_OPENS_IN_YEAR - 1;

/** The round the next race opens, from this one. For the UI's "the tea comes down in N rounds". */
export function nextRaceRound(round: number): number {
  const inYear = Math.max(0, round - 1) % ROUNDS_PER_YEAR;
  const start = round - inYear;
  const thisYear = start + TEA_RACE_OPENS_IN_YEAR - 1;
  return thisYear >= round ? thisYear : thisYear + ROUNDS_PER_YEAR;
}

/** A fresh race for the year starting this round. */
export function newRace(round: number): TeaRace {
  return {
    year: yearOf(round),
    opensOn: round,
    closesOn: round + TEA_RACE_ROUNDS - 1,
    placings: [],
    closed: false,
  };
}

/** This year's race if it is running and still has a place to win, else null. */
export function openRace(s: GameState): TeaRace | null {
  if (!s.hazards?.teaRace || s.rules !== 'classic') return null;
  const race = s.teaRace;
  if (!race || race.closed || race.placings.length >= 2 || s.round > race.closesOn) return null;
  return race;
}

/** Does a lot of tea loaded here, now, count as the new season's? */
export const isNewSeasonLading = (s: GameState, port: string, good: string): boolean =>
  good === 'tea' && TEA_RACE_PORTS.includes(port) && openRace(s) !== null;

/** The lots in a hold that are running in this year's race. */
export const raceLots = (ship: Ship, race: TeaRace): CargoLot[] =>
  ship.hold.filter(lot => lot.good === 'tea' && lot.season === race.year);

/** What landing these lots in London pays, for the next place. Null when there is no place left. */
export function racePrize(race: TeaRace, units: number): { rank: 1 | 2; purse: number; premium: number } | null {
  if (units <= 0) return null;
  const rank = (race.placings.length + 1) as 1 | 2;
  if (rank > 2) return null;
  const premium = units * (GOOD_BY_ID.tea?.basePrice ?? 60) * TEA_RACE_PREMIUM[rank];
  return { rank, purse: TEA_RACE_PURSE[rank], premium };
}

export const RACE_FINISH = TEA_RACE_FINISH;

// ---------------------------------------------------------------------------
// Cracking on
// ---------------------------------------------------------------------------

/**
 * The extra die at or below which she carries away a spar. One worse rounding a great cape with the
 * weather in play: driving a ship hard off the Horn is a different proposition from the trades.
 */
export function sparRisk(ship: Ship, weather: boolean): number {
  const v = ship.voyage;
  if (!weather || !v) return SPAR_CARRIED_ON;
  return legBetween(v.legFrom, v.route[0])?.cape ? SPAR_CARRIED_ON + 1 : SPAR_CARRIED_ON;
}

/** Can this ship be driven this turn? Mirrors the reducer's own checks, for the UI and the AI. */
export function canCrackOn(s: GameState, ship: Ship): boolean {
  if (!s.hazards?.pressSail || s.phase !== 'act') return false;
  if (ship.damaged || s.crackedOn?.[ship.id] !== undefined) return false;
  if (ship.voyage) return true;
  // In port she must still have this turn's wind to add to — a ship that has already arrived has
  // forfeited it, and one that never rolled has none.
  return (s.sailPoints[ship.id] ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

const ENCOUNTER_KINDS: EncounterKind[] = ['derelict', 'castaways', 'trader', 'pilot'];

/** Goods worth a trader's while, so an offer is never for something that pays nothing anywhere. */
const TRADED = GOODS.filter(g => g.basePrice >= 30);

const money = (n: number) => `£${n.toLocaleString('en-GB')}`;

/**
 * Maybe meet something. Drawn once per ship per turn at sea, after she has run her distance and
 * weathered whatever the sea did to her.
 *
 * Kinds that need a free slot are only offered to a ship that has one, so every encounter offered
 * is one she could actually take up.
 */
export function drawEncounter(seed: number, ship: Ship): { seed: number; encounter: Encounter | null } {
  if (!ship.voyage) return { seed, encounter: null };
  const roll = next(seed);
  let s = roll.seed;
  if (roll.value >= ENCOUNTER_CHANCE) return { seed: s, encounter: null };

  const roomy = ship.hold.length < slotsOf(ship.shipClass);
  const kinds = roomy ? ENCOUNTER_KINDS : ENCOUNTER_KINDS.filter(k => k === 'castaways' || k === 'pilot');
  const pick = nextInt(s, 0, kinds.length - 1);
  s = pick.seed;
  const kind = kinds[pick.value];
  const near = portName(ship.voyage.route[0]);

  switch (kind) {
    case 'derelict': {
      const g = nextInt(s, 0, GOODS.length - 1);
      s = g.seed;
      const good = GOODS[g.value].id;
      return {
        seed: s,
        encounter: {
          kind,
          shipId: ship.id,
          good,
          points: 3,
          headline: `${ship.name} sights a derelict`,
          detail:
            `A barque drifting dismasted off ${near}, crew long gone and hatches still battened. ` +
            `Heaving to and putting a boat across costs 3 points of ground; ` +
            `there is a lot of ${goodName(good)} in her that is yours for the taking.`,
        },
      };
    }
    case 'castaways': {
      const r = nextInt(s, 30, 60);
      s = r.seed;
      const reward = Math.round(r.value / 5) * 5;
      return {
        seed: s,
        encounter: {
          kind,
          shipId: ship.id,
          points: 2,
          reward,
          headline: `${ship.name} finds castaways`,
          detail:
            `Smoke from a reef on the way to ${near}: the crew of a wrecked brig. Standing in to take ` +
            `them off costs 2 points of ground. Their owners pay ${money(reward)} salvage on the spot.`,
        },
      };
    }
    case 'trader': {
      const g = nextInt(s, 0, TRADED.length - 1);
      s = g.seed;
      const good = TRADED[g.value];
      const price = Math.round(good.basePrice * 0.6);
      return {
        seed: s,
        encounter: {
          kind,
          shipId: ship.id,
          good: good.id,
          price,
          headline: `${ship.name} speaks a country ship`,
          detail:
            `A country trader bound the other way has a lot of ${good.name} she would rather not ` +
            `carry home, and offers it across at ${money(price)} — well under the reckoning of ` +
            `${money(good.basePrice)}. No card may want it yet.`,
        },
      };
    }
    case 'pilot': {
      const r = nextInt(s, 20, 40);
      s = r.seed;
      const price = Math.round(r.value / 5) * 5;
      return {
        seed: s,
        encounter: {
          kind,
          shipId: ship.id,
          price,
          points: 4,
          headline: `${ship.name} is hailed by a pilot`,
          detail:
            `A local pilot offers to take her through the inshore passage toward ${near} for ` +
            `${money(price)}: 4 points made good at once. Most of them know the reefs. One in six ` +
            `does not, and she takes the ground and strains her hull.`,
        },
      };
    }
  }
}
