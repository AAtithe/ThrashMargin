/**
 * Wind, seasons and weather.
 *
 * The wind is **derived from real geography**, not authored per leg. Authoring 49 legs across 4
 * seasons would be 196 numbers nobody could keep coherent; instead the band a leg sails through
 * comes from its own mid-latitude and the direction it is sailed, exactly the way the chart's
 * coordinates already drive everything else in this game.
 *
 * Two properties matter more than the numbers:
 *
 *  1. **Wind is directional.** The same leg has opposite modifiers depending on which way you sail
 *     it. That is the entire substance of clipper routing, and without it every captain races round
 *     the world in the same direction because raw distance is all that distinguishes one route from
 *     another.
 *  2. **The monsoon reverses.** It is the reason seasons exist here at all: the Bombay and Calcutta
 *     runs are fast one half of the year and slow the other, so *when* you sail is a real decision
 *     alongside *where*.
 */
import { PORTS, PORT_BY_ID, legBetween, legDistance, searchRoute, type Route } from './content';
import { next } from './rng';
import {
  COPPER_STORM_REDUCTION,
  ROUNDS_PER_SEASON,
  STORM_CHANCE_PER_RATING,
  STORM_SETBACK,
  WIND,
} from './rules';
import type { PortId, Ship } from './types';

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const SEASON_NAMES: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};

/**
 * The season is a pure function of the round — derived, never stored, so there is nothing to migrate
 * and the same round always yields the same season on every client.
 */
export function seasonOf(round: number): Season {
  const index = Math.floor(Math.max(0, round - 1) / ROUNDS_PER_SEASON) % SEASONS.length;
  return SEASONS[index];
}

/** Rounds until the season turns. Shown in the header so a captain can time a passage. */
export function roundsLeftInSeason(round: number): number {
  return ROUNDS_PER_SEASON - (Math.max(0, round - 1) % ROUNDS_PER_SEASON);
}

/** Which year of the voyage this is, 1-based. Flavour for the header. */
export const voyageYear = (round: number): number =>
  Math.floor(Math.max(0, round - 1) / (ROUNDS_PER_SEASON * SEASONS.length)) + 1;

/**
 * Which way the monsoon is blowing, and how hard.
 *
 * Four seasons only mean something if they behave four different ways. A first pass had the monsoon
 * simply reverse at the half-year and the Forties strengthen for the other half, which made
 * spring identical to summer and autumn identical to winter — two seasons wearing four names.
 * The real monsoon has two settled phases and two turning ones, so that is what this returns.
 */
type MonsoonPhase = 'south-west' | 'north-east' | 'turning to the south-west' | 'turning to the north-east';

function monsoonPhase(season: Season): { phase: MonsoonPhase; settled: boolean; towardsNorthEastIsFair: boolean } {
  switch (season) {
    // The south-west monsoon proper: fair for anything running up towards the north-east.
    case 'summer':
      return { phase: 'south-west', settled: true, towardsNorthEastIsFair: true };
    // The north-east monsoon proper, blowing back down the other way.
    case 'winter':
      return { phase: 'north-east', settled: true, towardsNorthEastIsFair: false };
    // The turning months: light, unsettled airs leaning towards the monsoon that is coming.
    case 'spring':
      return { phase: 'turning to the south-west', settled: false, towardsNorthEastIsFair: true };
    case 'autumn':
      return { phase: 'turning to the north-east', settled: false, towardsNorthEastIsFair: false };
  }
}

/**
 * Extra strength in the Southern Ocean, by season.
 *
 * Note these are NORTHERN season names — the game is played from Liverpool — so the Forties are at
 * their worst in "summer", which is the southern winter. The northern westerlies peak in northern
 * winter, six months apart from this. That asymmetry is real, and it is what makes an eastbound
 * Southern Ocean passage a different decision from a westbound North Atlantic one.
 */
const FORTIES_SEASONAL: Record<Season, number> = {
  summer: 2,
  spring: 1,
  autumn: 1,
  winter: 0,
};

// ---------------------------------------------------------------------------
// Wind bands
// ---------------------------------------------------------------------------

export type WindBand =
  | 'doldrums'
  | 'trades'
  | 'horse'
  | 'westerlies'
  | 'forties'
  | 'monsoon';

export const BAND_NAMES: Record<WindBand, string> = {
  doldrums: 'the doldrums',
  trades: 'the trades',
  horse: 'the horse latitudes',
  westerlies: 'the westerlies',
  forties: 'the Roaring Forties',
  monsoon: 'the monsoon',
};

export interface Wind {
  band: WindBand;
  /** Sail points added to the roll. Negative is a beat. */
  modifier: number;
  /** One short phrase for the UI and the log. */
  label: string;
}

/** Signed east–west component of the passage, accounting for the chart's wrap. */
function eastwardness(from: PortId, to: PortId): number {
  const a = PORT_BY_ID[from];
  const b = PORT_BY_ID[to];
  if (!a || !b) return 0;
  let dlon = b.lon - a.lon;
  // Take the short way round, the same way the chart draws it.
  if (dlon > 180) dlon -= 360;
  if (dlon < -180) dlon += 360;
  return dlon;
}

/** Signed north–south component. */
function northwardness(from: PortId, to: PortId): number {
  const a = PORT_BY_ID[from];
  const b = PORT_BY_ID[to];
  if (!a || !b) return 0;
  return b.lat - a.lat;
}

const midLatitude = (from: PortId, to: PortId) =>
  ((PORT_BY_ID[from]?.lat ?? 0) + (PORT_BY_ID[to]?.lat ?? 0)) / 2;

const midLongitude = (from: PortId, to: PortId) => {
  const a = PORT_BY_ID[from]?.lon ?? 0;
  return a + eastwardness(from, to) / 2;
};

/** The Indian Ocean box the monsoon governs. */
function inMonsoon(from: PortId, to: PortId): boolean {
  const lat = midLatitude(from, to);
  const lon = midLongitude(from, to);
  return lat > -12 && lat < 26 && lon > 38 && lon < 104;
}

function bandFor(from: PortId, to: PortId): WindBand {
  if (inMonsoon(from, to)) return 'monsoon';
  const lat = midLatitude(from, to);
  const abs = Math.abs(lat);
  if (abs <= 5) return 'doldrums';
  if (lat <= -35) return 'forties';
  if (abs >= 35) return 'westerlies';
  if (abs >= 30) return 'horse';
  return 'trades';
}

/**
 * The wind on a leg, sailed in a specific direction, in a specific season.
 *
 * Note this takes an ordered pair: `windFor(a, b, s)` and `windFor(b, a, s)` are different
 * questions, and in every directional band they give opposite answers.
 */
export function windFor(from: PortId, to: PortId, season: Season): Wind {
  const band = bandFor(from, to);
  const east = eastwardness(from, to);
  const north = northwardness(from, to);

  // A passage that barely moves east or west is not really running with or against a zonal wind.
  const zonal = Math.abs(east) > Math.abs(north) * 0.6;

  switch (band) {
    case 'doldrums':
      return { band, modifier: WIND.doldrums, label: 'becalmed at the line' };

    case 'trades': {
      // The trades blow east to west, so westward is the fair way.
      if (!zonal) return { band, modifier: WIND.slack, label: 'across the trades' };
      return east < 0
        ? { band, modifier: WIND.fair, label: 'running down the trades' }
        : { band, modifier: WIND.foul, label: 'beating against the trades' };
    }

    case 'horse':
      return { band, modifier: WIND.fitful, label: 'fitful airs' };

    case 'westerlies': {
      // Northern westerlies blow west to east.
      if (!zonal) return { band, modifier: WIND.slack, label: 'across the westerlies' };
      return east > 0
        ? { band, modifier: WIND.favourable, label: 'with the westerlies' }
        : { band, modifier: WIND.contrary, label: 'against the westerlies' };
    }

    case 'forties': {
      // The Southern Ocean, and the strongest wind on the chart. Eastward is very fast, westward
      // is a punishment — which is exactly why the real clippers ran their easting down.
      const seasonal = FORTIES_SEASONAL[season];
      if (!zonal) return { band, modifier: WIND.slack, label: 'across the Forties' };
      return east > 0
        ? { band, modifier: WIND.fair + seasonal, label: 'running the easting down' }
        : { band, modifier: WIND.hard - seasonal, label: 'beating west against the Forties' };
    }

    case 'monsoon': {
      const { phase, settled, towardsNorthEastIsFair } = monsoonPhase(season);
      const towardsNorthEast = east + north > 0;
      const fairNow = towardsNorthEast === towardsNorthEastIsFair;

      // A settled monsoon is the strongest steady wind in the game; the turning months are only a
      // lean, which is what keeps spring distinct from summer and autumn from winter.
      if (settled) {
        return fairNow
          ? { band, modifier: WIND.fair, label: `with the ${phase} monsoon` }
          : { band, modifier: WIND.foul, label: `against the ${phase} monsoon` };
      }
      return fairNow
        ? { band, modifier: WIND.light, label: `light airs, ${phase}` }
        : { band, modifier: WIND.lightFoul, label: `slack airs, ${phase}` };
    }
  }
}

/** The wind on the leg a ship is currently sailing, or null if she is in port. */
export function windForShip(ship: Ship, season: Season): Wind | null {
  if (!ship.voyage) return null;
  return windFor(ship.voyage.legFrom, ship.voyage.route[0], season);
}

// ---------------------------------------------------------------------------
// Storms
// ---------------------------------------------------------------------------

/**
 * How storm-prone a leg is, 0 upward. Derived, except for the `cape` flag already sitting on six
 * legs in legs.json — which was authored as decoration when the chart was built and finally earns
 * its keep here.
 */
export function stormRating(from: PortId, to: PortId, season: Season): number {
  const lat = midLatitude(from, to);
  const abs = Math.abs(lat);
  let rating = 0;

  // High latitudes are simply worse, north or south.
  if (abs >= 50) rating += 2;
  else if (abs >= 38) rating += 1;

  // The Southern Ocean is in a class of its own.
  if (lat <= -38) rating += 2;

  // Rounding a great cape.
  if (legBetween(from, to)?.cape) rating += 2;

  // Each band has its bad season: northern winter gales, southern winter in the Forties, and the
  // typhoon and hurricane seasons in the tropics come late summer.
  const band = bandFor(from, to);
  // Northern gales peak in northern winter; the Southern Ocean peaks in northern summer, which is
  // its own winter. Six months apart, deliberately.
  if (band === 'westerlies' && season === 'winter') rating += 2;
  else if (band === 'westerlies' && season === 'autumn') rating += 1;
  if (band === 'forties') rating += FORTIES_SEASONAL[season];
  // The monsoon brings its worst weather as it blows hardest, and the typhoon and hurricane seasons
  // fall in late northern summer.
  if (band === 'monsoon' && season === 'summer') rating += 2;
  else if (band === 'monsoon' && season === 'autumn') rating += 1;
  if (band === 'trades' && (season === 'summer' || season === 'autumn') && abs > 12) rating += 1;

  return rating;
}

export interface StormOutcome {
  /** Sail points the ship is driven back along her current leg. Zero means she rode it out. */
  setback: number;
  rating: number;
  seed: number;
}

/**
 * Rolls for weather on a ship at sea. Storms cost **time only** — never a ship, never a cargo.
 * Keeping that line clean is what stops weather and piracy feeling like one undifferentiated tax:
 * the sea delays you, pirates rob you.
 */
export function resolveStorm(seed: number, ship: Ship, season: Season): StormOutcome {
  if (!ship.voyage) return { setback: 0, rating: 0, seed };

  const rating = stormRating(ship.voyage.legFrom, ship.voyage.route[0], season);
  if (rating <= 0) return { setback: 0, rating, seed };

  const roll = next(seed);
  if (roll.value >= rating * STORM_CHANCE_PER_RATING) {
    return { setback: 0, rating, seed: roll.seed };
  }

  const magnitude = next(roll.seed);
  let setback =
    STORM_SETBACK.min +
    Math.floor(magnitude.value * (STORM_SETBACK.max - STORM_SETBACK.min + 1));

  if (ship.fittings?.copper) setback = Math.max(1, Math.round(setback * COPPER_STORM_REDUCTION));

  // She can be driven back, but never behind the port she sailed from — otherwise a long enough
  // run of bad weather could push a ship's remaining distance past her own leg length.
  const room = ship.voyage.legDistance - ship.voyage.legRemaining;
  return { setback: Math.min(setback, room), rating, seed: magnitude.seed };
}

// ---------------------------------------------------------------------------
// Effective speed, for route planning and for the AI
// ---------------------------------------------------------------------------

/** Average sail points a ship makes on a given passage: the 2d6 mean plus wind, floored at 1. */
export function effectiveSpeed(from: PortId, to: PortId, season: Season, copper = false): number {
  const wind = windFor(from, to, season);
  return Math.max(1, 7 + wind.modifier + (copper ? 1 : 0));
}

/**
 * Turns a passage is expected to take. This — not raw distance — is what route planning costs
 * edges by once the wind is in play.
 */
export function expectedTurns(
  from: PortId,
  to: PortId,
  distance: number,
  season: Season,
  copper = false,
): number {
  return distance / effectiveSpeed(from, to, season, copper);
}

// ---------------------------------------------------------------------------
// Wind-aware route planning
// ---------------------------------------------------------------------------

/**
 * The fastest route in a given season, which is emphatically not always the shortest one.
 *
 * This is the function that makes the wind a routing game rather than a tax. Costing edges by
 * expected turns instead of raw distance means a longer passage with the wind behind you can be the
 * right answer, and — because the wind is directional — that the way home can differ from the way
 * out.
 */
export function planFastestRoute(
  from: PortId,
  to: PortId,
  season: Season,
  copper = false,
): Route | null {
  const route = searchRoute(from, to, (a, b, distance) =>
    expectedTurns(a, b, distance, season, copper),
  );
  if (!route) return null;
  return { ...route, turns: routeTurns(from, route.path, season, copper) };
}

/** Expected turns for a whole path, leg by leg, each with its own wind. */
export function routeTurns(
  from: PortId,
  path: PortId[],
  season: Season,
  copper = false,
): number {
  let total = 0;
  let cursor = from;
  for (const step of path) {
    total += expectedTurns(cursor, step, legDistance(cursor, step), season, copper);
    cursor = step;
  }
  return total;
}

/**
 * Expected turns between every pair of ports, per season. Four 26×26 tables built once at module
 * load — trivial for a graph this size, and it keeps the AI's scoring cheap now that it has to
 * think about wind on every contract it considers.
 */
export const SEASON_TURN_MATRIX: Record<Season, Record<PortId, Record<PortId, number>>> = (() => {
  const out = {} as Record<Season, Record<PortId, Record<PortId, number>>>;
  for (const season of SEASONS) {
    const table: Record<PortId, Record<PortId, number>> = {};
    for (const from of PORTS) {
      table[from.id] = { [from.id]: 0 };
      for (const to of PORTS) {
        if (to.id === from.id) continue;
        table[from.id][to.id] = planFastestRoute(from.id, to.id, season)?.turns ?? Infinity;
      }
    }
    out[season] = table;
  }
  return out;
})();

/** Expected turns from a to b in a season, by the fastest route. */
export const turnsBetween = (a: PortId, b: PortId, season: Season): number =>
  SEASON_TURN_MATRIX[season]?.[a]?.[b] ?? Infinity;
