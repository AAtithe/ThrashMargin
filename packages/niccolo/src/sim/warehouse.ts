import { findCity, findGood, marketGoodsAt } from './content';
import { addGrade, gradeHeld, removeGrade } from './grades';
import { cargoTotal, priceAt } from './market';
import { cityBarred, tradeBlockedAt } from './marketEvents';
import type { GameState, GradeId, Warehouse, WarehouseLapse } from './types';

/**
 * City warehousing (`freeplay-and-trading-design.md` Part 2, built as Phase 26).
 *
 * **What it is for.** Every trade before this one had to be a round trip through a hold: buy here,
 * sail, sell there, and sell *all of it at once* because the hull is needed for the next leg. That
 * makes the price-crash rule (`sellGood` depresses the local price; buying never lifts it) a wall
 * rather than a decision — dumping twenty units into a small market was simply the worst way to
 * trade, and the player had no alternative to it. A warehouse decouples buying from selling **in
 * time**: land the cargo, pay rent, and meter the sale out over the weeks it takes the price to
 * recover. That is the intended new lever, and it is strategy rather than an exploit — see the
 * exploit note on `storeGood`.
 *
 * **Grade-aware from the first line.** `WarehouseStock` was only ever a phrase in the design doc,
 * never code, so there is no retrofit to do here: `Warehouse` reuses `Vessel`'s exact `cargo` +
 * `grades` shape, which means `gradeHeld`/`addGrade`/`removeGrade` from `sim/grades.ts` work on a
 * warehouse without a single change. A graded lot can be stored and withdrawn at its grade, and
 * `common` stays derived rather than stored, exactly as it is aboard ship.
 */

/** A first lease is cheaper than an escort (60f) and dearer than the Kouklia estate (25f), against
 * 40f of starting capital — so it is a real decision in Chapter 1 and routine by Chapter 4. */
export const WAREHOUSE_LEASE_COST = 30;

/** One hull's worth, deliberately: the first thing a warehouse buys you is the ability to land a
 * full hold and sail on. */
export const WAREHOUSE_BASE_CAPACITY = 20;

export const WAREHOUSE_EXPANSION_CAPACITY = 15;
export const WAREHOUSE_EXPANSION_COST = 25;

/** Three expansions and no more. A warehouse that can be grown without limit turns the price-crash
 * rule into a rounding error — buy the whole market cheap, sit on it, and meter it out forever —
 * which is the exact dynamic §12's scope note keeps warning about. A ceiling keeps storage a
 * buffer rather than a second economy. */
export const WAREHOUSE_MAX_CAPACITY = WAREHOUSE_BASE_CAPACITY + 3 * WAREHOUSE_EXPANSION_CAPACITY;

/** What the landlord's agent gets for the contents when the rent goes unpaid — half, which is
 * always worse than selling the same goods properly, so a lapse can never be the profitable move
 * (see `resolveWeeklyWarehouses`). */
const DISTRESS_FRACTION = 0.5;

/** Rent scales with the space leased rather than being flat, so expanding is a standing commitment
 * and not just a one-off fee: 2f/week at base, 7f/week fully grown, against the escort's 4f. */
export function warehouseRentPerWeek(capacity: number): number {
  return Math.ceil(capacity / 10);
}

export function warehouseList(state: GameState): Warehouse[] {
  return Object.values(state.warehouses ?? {});
}

export function warehouseAt(state: GameState, cityId: string): Warehouse | null {
  return state.warehouses?.[cityId] ?? null;
}

export function totalWarehouseRent(state: GameState): number {
  return warehouseList(state).reduce((sum, w) => sum + warehouseRentPerWeek(w.capacity), 0);
}

export function warehouseUsed(warehouse: Warehouse): number {
  return cargoTotal(warehouse.cargo);
}

export function warehouseSpaceLeft(warehouse: Warehouse): number {
  return Math.max(0, warehouse.capacity - warehouseUsed(warehouse));
}

/**
 * Where a warehouse can be leased. Not a hand-written list of cities (the `canInsureAt` precedent
 * would be wrong here — insurance is underwritten in three specific banking towns because that is a
 * fact about the trade): storage only means anything where there is a market to time a sale into,
 * so the condition derives from the city's own content. Timbuktu qualifies; a city with no market
 * block does not.
 */
export function canLeaseWarehouseAt(cityId: string): boolean {
  return marketGoodsAt(cityId).length > 0;
}

export function leaseWarehouse(state: GameState, cityId: string): GameState {
  const city = findCity(cityId);
  if (!city) throw new Error(`No such city: ${cityId}`);
  if (!canLeaseWarehouseAt(cityId)) throw new Error(`${city.name} has no market to store goods for`);
  if (warehouseAt(state, cityId)) throw new Error(`The house already leases a warehouse at ${city.name}`);
  // Exile (Chapter 7). Signing a lease in a city the house is barred from is not a thing the house
  // can do, and the same check guards `dispatchVessel` for the same reason.
  if (cityBarred(state.flags, cityId)) {
    throw new Error(`${city.name} is closed to the house while the ban stands`);
  }
  if (WAREHOUSE_LEASE_COST > state.cash) {
    throw new Error(`Not enough cash (need ${WAREHOUSE_LEASE_COST}, have ${Math.round(state.cash)})`);
  }

  const warehouse: Warehouse = { cityId, capacity: WAREHOUSE_BASE_CAPACITY, cargo: {} };
  return {
    ...state,
    cash: state.cash - WAREHOUSE_LEASE_COST,
    warehouses: { ...(state.warehouses ?? {}), [cityId]: warehouse },
  };
}

export function expandWarehouse(state: GameState, cityId: string): GameState {
  const warehouse = warehouseAt(state, cityId);
  if (!warehouse) throw new Error('The house leases no warehouse there');
  if (warehouse.capacity >= WAREHOUSE_MAX_CAPACITY) {
    throw new Error('That warehouse is already as large as the ground allows');
  }
  if (WAREHOUSE_EXPANSION_COST > state.cash) {
    throw new Error(`Not enough cash (need ${WAREHOUSE_EXPANSION_COST}, have ${Math.round(state.cash)})`);
  }

  const capacity = Math.min(WAREHOUSE_MAX_CAPACITY, warehouse.capacity + WAREHOUSE_EXPANSION_CAPACITY);
  return {
    ...state,
    cash: state.cash - WAREHOUSE_EXPANSION_COST,
    warehouses: { ...(state.warehouses ?? {}), [cityId]: { ...warehouse, capacity } },
  };
}

/** Both directions share every check except which side is the source, so they share one body —
 * the two are exact inverses and a divergence between them would be a duplication bug. */
function moveGoods(
  state: GameState,
  direction: 'store' | 'withdraw',
  vesselId: string,
  goodId: string,
  quantity: number,
  grade: GradeId,
): GameState {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number');

  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel) throw new Error(`No such vessel: ${vesselId}`);
  if (vessel.destination) throw new Error(`${vessel.name} is under way and cannot load or unload`);

  const warehouse = warehouseAt(state, vessel.location);
  const cityName = findCity(vessel.location)?.name ?? vessel.location;
  if (!warehouse) throw new Error(`The house leases no warehouse at ${cityName}`);

  const goodName = findGood(goodId)?.name ?? goodId;
  if (direction === 'store') {
    const held = gradeHeld(vessel.cargo, vessel.cargoGrades, goodId, grade);
    if (quantity > held) throw new Error(`${vessel.name} is not carrying that much ${goodName} of that grade`);
    const spaceLeft = warehouseSpaceLeft(warehouse);
    if (quantity > spaceLeft) {
      throw new Error(`The warehouse at ${cityName} has room for only ${spaceLeft} more unit${spaceLeft === 1 ? '' : 's'}`);
    }
  } else {
    const held = gradeHeld(warehouse.cargo, warehouse.grades, goodId, grade);
    if (quantity > held) throw new Error(`The warehouse at ${cityName} does not hold that much ${goodName} of that grade`);
    if (vessel.capacity <= 0) throw new Error(`${vessel.name} has no cargo hold`);
    const spaceLeft = vessel.capacity - cargoTotal(vessel.cargo);
    if (quantity > spaceLeft) {
      throw new Error(`Only ${spaceLeft} unit${spaceLeft === 1 ? '' : 's'} of cargo space left aboard ${vessel.name}`);
    }
  }

  const toVessel = direction === 'withdraw' ? quantity : -quantity;
  const toWarehouse = -toVessel;

  // Deliberately does NOT call `adjustScarcity`, in either direction. Moving the house's own goods
  // between its own hull and its own shed is not a market transaction — nobody bought and nobody
  // sold. This is what keeps the Phase-16-era exploit fix intact: buying still never lifts a price
  // and selling still depresses one, so buy -> store -> sell-later-at-a-recovered-price is not free
  // money, it is a real bet that the price recovers faster than the rent accrues. If storing moved
  // scarcity, a player could pump a market by shuffling one lot in and out of the warehouse all day.
  return {
    ...state,
    vessels: state.vessels.map(v =>
      v.id === vesselId
        ? {
            ...v,
            cargo: { ...v.cargo, [goodId]: (v.cargo[goodId] ?? 0) + toVessel },
            cargoGrades:
              toVessel > 0
                ? addGrade(v.cargoGrades, goodId, grade, quantity)
                : removeGrade(v.cargoGrades, goodId, grade, quantity),
          }
        : v,
    ),
    warehouses: {
      ...(state.warehouses ?? {}),
      [warehouse.cityId]: {
        ...warehouse,
        cargo: { ...warehouse.cargo, [goodId]: (warehouse.cargo[goodId] ?? 0) + toWarehouse },
        grades:
          toWarehouse > 0
            ? addGrade(warehouse.grades, goodId, grade, quantity)
            : removeGrade(warehouse.grades, goodId, grade, quantity),
      },
    },
  };
}

export function storeGood(state: GameState, vesselId: string, goodId: string, quantity: number, grade: GradeId = 'common'): GameState {
  return moveGoods(state, 'store', vesselId, goodId, quantity, grade);
}

export function withdrawGood(state: GameState, vesselId: string, goodId: string, quantity: number, grade: GradeId = 'common'): GameState {
  return moveGoods(state, 'withdraw', vesselId, goodId, quantity, grade);
}

export interface WarehouseResolution {
  cash: number;
  warehouses: Record<string, Warehouse>;
  /** Every lease lost this week for want of rent, so the UI can name what happened. */
  lapses: WarehouseLapse[];
}

/**
 * Runs every ADVANCE_WEEK, alongside the household's wages and the escort's pay.
 *
 * **Unpaid rent lapses the lease; it does not accrue a debt.** That is the same choice
 * `resolveWeeklyUpkeep` and `resolveWeeklyConvoy` already make, and for the same reason: the
 * insolvency ladder in `credit.ts` is specifically about *obligations the house has written* coming
 * due, and quietly inventing a second class of invisible arrears would put the player under a debt
 * no screen shows. Rent still tightens the insolvency path in the way that matters — it competes
 * for the same cash a maturing bill needs.
 *
 * **A shortfall sheds the emptiest lease first, not all of them.** A single flat "can you cover the
 * whole bill" test would lose four leases over a 2f shortfall, which reads as a bug rather than a
 * consequence. So leases are dropped one at a time, emptiest first, until the remaining rent is
 * affordable — which keeps the most stored value, is what a factor would actually do, and is
 * deterministic (no dice here, so a driver can assert exactly which lease went).
 *
 * The first draft of this sorted the *other* way and paid the fullest shed first, which looks
 * equivalent and is not: with no cash at all, nothing is affordable, so that order lapsed the
 * fullest warehouse first and kept the empty ones. Exactly backwards. The decision is which lease
 * to *shed*, so the sort has to be over the sheddable ones.
 *
 * **What happens to the goods.** The landlord's agent sells the contents at half the local price
 * and the proceeds come back net of nothing — a real loss, always worse than having sold the same
 * goods properly, so letting a lease lapse can never be a profitable liquidation route. Two
 * deliberate exceptions get no proceeds at all: a good with no market at that city, and a good
 * currently under a `guild_embargo` (`tradeBlockedAt`). The second matters — without it, lapsing a
 * lease would be a way to sell into a market the embargo has closed, which would make an event
 * designed to block trade into a mildly taxed way of doing it.
 */
export function resolveWeeklyWarehouses(state: GameState): WarehouseResolution {
  const all = warehouseList(state);
  if (all.length === 0) return { cash: state.cash, warehouses: state.warehouses ?? {}, lapses: [] };

  // Emptiest first: this is the order leases are *shed* in, so the least valuable goes first.
  const sheddable = [...all].sort((a, b) => warehouseUsed(a) - warehouseUsed(b) || a.cityId.localeCompare(b.cityId));

  let cash = state.cash;
  let surviving = sheddable;
  const lapses: WarehouseLapse[] = [];

  while (surviving.length > 0 && surviving.reduce((sum, w) => sum + warehouseRentPerWeek(w.capacity), 0) > cash) {
    const [gone, ...rest] = surviving;
    surviving = rest;

    let proceeds = 0;
    let unitsLost = 0;
    for (const [goodId, held] of Object.entries(gone.cargo)) {
      if (held <= 0) continue;
      unitsLost += held;
      if (tradeBlockedAt(state.marketEvents, gone.cityId, goodId)) continue;
      const price = priceAt(state.scarcity, gone.cityId, goodId, state.marketEvents);
      if (price === null) continue;
      proceeds += price * held * DISTRESS_FRACTION;
    }
    // The proceeds land before the next iteration's affordability test, so a distress sale can
    // genuinely save the leases behind it — the money did arrive. What it can never do is save the
    // lease it came from: if the rent went unpaid, that shed is gone.
    cash += proceeds;
    lapses.push({ week: state.week, cityId: gone.cityId, unitsLost, proceeds: Math.round(proceeds) });
  }

  const kept: Record<string, Warehouse> = {};
  for (const w of surviving) {
    cash -= warehouseRentPerWeek(w.capacity);
    kept[w.cityId] = w;
  }

  return { cash, warehouses: kept, lapses };
}

/**
 * What the house's stored goods are worth at their own city's current price — the warehouse twin of
 * `cargoValue`. Used by the epilogue's reckoning, which would otherwise report a player who ended
 * the campaign with four full warehouses as poorer than one who had dumped it all at a loss.
 */
export function warehousesValue(state: GameState): number {
  let total = 0;
  for (const warehouse of warehouseList(state)) {
    for (const [goodId, held] of Object.entries(warehouse.cargo)) {
      if (held <= 0) continue;
      const price = priceAt(state.scarcity, warehouse.cityId, goodId, state.marketEvents);
      if (price !== null) total += price * held;
    }
  }
  return total;
}
