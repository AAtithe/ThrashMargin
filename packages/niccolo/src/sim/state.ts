import { CHARACTERS } from './content';
import { STARTING_CONSCIENCE } from './characters';
import { initialExchangeRates } from './currency';
import { initialScarcity } from './market';
import { generateNews, resolveArrivals } from './news';
import type { GameState } from './types';

/** Starting stake: small and dangerous, as the design pillar demands. */
const STARTING_CASH = 40;
const SHIP_CAPACITY = 20;

export function createInitialState(id: string): GameState {
  const scarcity = initialScarcity();
  const characters = CHARACTERS.map(c => ({ ...c, skills: { ...c.skills } }));
  const seedNews = generateNews(scarcity, 0, {}, characters);
  const { arrived, stillPending } = resolveArrivals(seedNews, 0);
  const knownPrices: GameState['knownPrices'] = {};
  for (const item of arrived) knownPrices[item.cityId] = item;

  return {
    id,
    week: 0,
    cash: STARTING_CASH,
    scarcity,
    pendingNews: stillPending,
    knownPrices,
    courierInvestment: {},
    exchangeRates: initialExchangeRates(),
    obligations: [],
    insolvent: false,
    characters,
    conscience: STARTING_CONSCIENCE,
    vessels: [
      {
        id: 'ship_1',
        kind: 'ship',
        name: 'The Charetty ship',
        location: 'bruges',
        destination: null,
        routeId: null,
        weeksRemaining: 0,
        cargo: {},
        capacity: SHIP_CAPACITY,
      },
      {
        id: 'courier_1',
        kind: 'courier',
        name: 'The dispatch rider',
        location: 'bruges',
        destination: null,
        routeId: null,
        weeksRemaining: 0,
        cargo: {},
        capacity: 0,
      },
    ],
  };
}
