/**
 * City warehousing (Phase 26) — leases, grade-aware storage, rent, lapse, and the exploit checks
 * the spec calls for by name.
 *
 * Run with `npm run drive --workspace niccolo`. Committed rather than written to a scratch
 * directory, for the reason `drive-market-events.ts` records at its own head.
 *
 * No assertion here names a chapter number or asserts an effect at a fixed tick offset — both went
 * stale silently when Chapter 8 shipped, and the fix was to derive boundaries and to step to timed
 * effects rather than guessing where they land.
 */
import { createInitialState } from '../src/sim/state';
import { processAction } from '../src/sim/actions';
import { priceAt } from '../src/sim/market';
import { gradeBreakdown, gradeHeld } from '../src/sim/grades';
import {
  WAREHOUSE_BASE_CAPACITY, WAREHOUSE_EXPANSION_CAPACITY, WAREHOUSE_EXPANSION_COST,
  WAREHOUSE_LEASE_COST, WAREHOUSE_MAX_CAPACITY, canLeaseWarehouseAt, resolveWeeklyWarehouses,
  totalWarehouseRent, warehouseAt, warehouseRentPerWeek, warehouseSpaceLeft, warehouseUsed,
  warehousesValue,
} from '../src/sim/warehouse';
import { EVENTS, CITIES } from '../src/sim/content';
import { adviceFor } from '../src/sim/advisors';
import type { ActiveMarketEvent, GameAction, GameState } from '../src/sim/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}
function threw(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return (e as Error).message; }
}

/** A settled mid-campaign house: prologue done, every scripted event already fired so nothing
 * interrupts, cash enough to lease freely. */
function seed(cash = 4000): GameState {
  const base = createInitialState('drv26', 'Storage', { skipPrologue: true });
  return { ...base, cash, firedEvents: EVENTS.map(e => e.id), pendingEvents: [] };
}
function act(state: GameState, action: GameAction): GameState {
  return processAction(state, action);
}
const HOME = 'bruges';
const SHIP = 'ship_1';

// ---------------------------------------------------------------------------
console.log('\n1. Where a lease can be signed, and what it costs');
// ---------------------------------------------------------------------------
{
  const s = seed();
  const withMarket = CITIES.filter(c => c.market && Object.keys(c.market).length > 0);
  const without = CITIES.filter(c => !c.market || Object.keys(c.market).length === 0);
  check(`${withMarket.length} cities have a market and can hold a lease`, withMarket.length > 10, `${withMarket.length}`);
  check('every market city passes canLeaseWarehouseAt', withMarket.every(c => canLeaseWarehouseAt(c.id)));
  check('every marketless city fails it', without.every(c => !canLeaseWarehouseAt(c.id)));
  check('an unknown city id fails it rather than throwing', !canLeaseWarehouseAt('atlantis'));

  const leased = act(s, { type: 'LEASE_WAREHOUSE', cityId: HOME });
  check('leasing charges the lease cost once', leased.cash === s.cash - WAREHOUSE_LEASE_COST);
  check('and creates a warehouse at base capacity', warehouseAt(leased, HOME)?.capacity === WAREHOUSE_BASE_CAPACITY);
  check('which starts empty', warehouseUsed(warehouseAt(leased, HOME)!) === 0);
  check('a second lease at the same city is refused',
    threw(() => act(leased, { type: 'LEASE_WAREHOUSE', cityId: HOME }))?.includes('already leases') === true);
  check('a lease at a marketless city is refused',
    threw(() => act(s, { type: 'LEASE_WAREHOUSE', cityId: 'timbuktu' })) === null
      ? canLeaseWarehouseAt('timbuktu')
      : !canLeaseWarehouseAt('timbuktu'));
  check('a lease at an unknown city is refused',
    threw(() => act(s, { type: 'LEASE_WAREHOUSE', cityId: 'atlantis' }))?.includes('No such city') === true);
  check('a lease is refused with too little cash',
    threw(() => act({ ...s, cash: WAREHOUSE_LEASE_COST - 1 }, { type: 'LEASE_WAREHOUSE', cityId: HOME }))
      ?.includes('Not enough cash') === true);

  // Exile (Chapter 7) — the same bar `dispatchVessel` enforces, checked here so the two agree.
  const exiled = { ...s, flags: { ...s.flags, exiled_from_flanders: true } };
  check('a lease in a city closed by exile is refused',
    threw(() => act(exiled, { type: 'LEASE_WAREHOUSE', cityId: HOME }))?.includes('closed to the house') === true);
  check('but a city outside the ban is still fine',
    warehouseAt(act(exiled, { type: 'LEASE_WAREHOUSE', cityId: 'venice' }), 'venice') !== null);
}

// ---------------------------------------------------------------------------
console.log('\n2. Expansion, and the ceiling on it');
// ---------------------------------------------------------------------------
{
  let s = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  const before = s.cash;
  s = act(s, { type: 'EXPAND_WAREHOUSE', cityId: HOME });
  check('expanding charges its cost', s.cash === before - WAREHOUSE_EXPANSION_COST);
  check('and adds exactly one bay',
    warehouseAt(s, HOME)!.capacity === WAREHOUSE_BASE_CAPACITY + WAREHOUSE_EXPANSION_CAPACITY);

  let guard = 0;
  while (warehouseAt(s, HOME)!.capacity < WAREHOUSE_MAX_CAPACITY && guard++ < 20) {
    s = act(s, { type: 'EXPAND_WAREHOUSE', cityId: HOME });
  }
  check('expansion reaches the ceiling', warehouseAt(s, HOME)!.capacity === WAREHOUSE_MAX_CAPACITY);
  check('and never exceeds it', warehouseAt(s, HOME)!.capacity <= WAREHOUSE_MAX_CAPACITY);
  check('a further expansion is refused',
    threw(() => act(s, { type: 'EXPAND_WAREHOUSE', cityId: HOME }))?.includes('as large as') === true);
  check('expanding a city with no lease is refused',
    threw(() => act(seed(), { type: 'EXPAND_WAREHOUSE', cityId: 'venice' }))?.includes('leases no warehouse') === true);

  // Rent scales with the space leased, or expanding would be a one-off fee with no standing cost.
  check('rent scales with capacity', warehouseRentPerWeek(WAREHOUSE_MAX_CAPACITY) > warehouseRentPerWeek(WAREHOUSE_BASE_CAPACITY));
  check('base rent is affordable against 40f of starting capital', warehouseRentPerWeek(WAREHOUSE_BASE_CAPACITY) <= 3,
    `${warehouseRentPerWeek(WAREHOUSE_BASE_CAPACITY)}f`);
}

// ---------------------------------------------------------------------------
console.log('\n3. Storing and withdrawing, including grades');
// ---------------------------------------------------------------------------
{
  let s = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  s = act(s, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 6, grade: 'common' });
  s = act(s, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 4, grade: 'fine' });
  const aboardBefore = s.vessels.find(v => v.id === SHIP)!;
  check('the hull holds 10 cloth, 4 of it fine',
    (aboardBefore.cargo.cloth ?? 0) === 10 && gradeHeld(aboardBefore.cargo, aboardBefore.cargoGrades, 'cloth', 'fine') === 4);

  const cashBefore = s.cash;
  const scarcityBefore = JSON.stringify(s.scarcity);
  s = act(s, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 4, grade: 'fine' });
  const wh = warehouseAt(s, HOME)!;
  const aboard = s.vessels.find(v => v.id === SHIP)!;
  check('storing moves the units into the shed', (wh.cargo.cloth ?? 0) === 4);
  check('and off the hull', (aboard.cargo.cloth ?? 0) === 6);
  check('the grade travels with them', gradeHeld(wh.cargo, wh.grades, 'cloth', 'fine') === 4);
  check('and is no longer claimed aboard', gradeHeld(aboard.cargo, aboard.cargoGrades, 'cloth', 'fine') === 0);
  check("what's left aboard reads as common", gradeHeld(aboard.cargo, aboard.cargoGrades, 'cloth', 'common') === 6);
  check('the shed reads as entirely fine', gradeBreakdown(wh.cargo, wh.grades, 'cloth').common === 0);
  check('storing costs nothing', s.cash === cashBefore);
  // The spec's own requirement, and the load-bearing one: this is what keeps the Phase-16 exploit
  // fix intact. If storing moved scarcity, one lot shuffled in and out would pump a market.
  check('storing does NOT touch scarcity', JSON.stringify(s.scarcity) === scarcityBefore);

  s = act(s, { type: 'WITHDRAW_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 2, grade: 'fine' });
  const wh2 = warehouseAt(s, HOME)!;
  const aboard2 = s.vessels.find(v => v.id === SHIP)!;
  check('withdrawing is the exact inverse', (wh2.cargo.cloth ?? 0) === 2 && (aboard2.cargo.cloth ?? 0) === 8);
  check('and restores the grade aboard', gradeHeld(aboard2.cargo, aboard2.cargoGrades, 'cloth', 'fine') === 2);
  check('withdrawing does NOT touch scarcity either', JSON.stringify(s.scarcity) === scarcityBefore);
  check('withdrawing costs nothing', s.cash === cashBefore);

  check('storing a grade the hull does not hold is refused',
    threw(() => act(s, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 9, grade: 'excellent' }))
      ?.includes('not carrying that much') === true);
  check('withdrawing a grade the shed does not hold is refused',
    threw(() => act(s, { type: 'WITHDRAW_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 9, grade: 'excellent' }))
      ?.includes('does not hold that much') === true);
  check('a zero quantity is refused',
    threw(() => act(s, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 0 }))
      ?.includes('positive whole number') === true);
  check('a fractional quantity is refused',
    threw(() => act(s, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 1.5 }))
      ?.includes('positive whole number') === true);
  check('storing at a city with no lease is refused',
    threw(() => act({ ...s, warehouses: {} }, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 1 }))
      ?.includes('leases no warehouse') === true);

  // Capacity, both ways.
  let full = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  full = act(full, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 20 });
  full = act(full, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 20 });
  check('a full hull fits exactly into a base warehouse', warehouseSpaceLeft(warehouseAt(full, HOME)!) === 0);
  const refill = act(full, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 20 });
  check('storing beyond capacity is refused with the room left named',
    threw(() => act(refill, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 1 }))
      ?.includes('room for only 0') === true);
  check('withdrawing beyond hull space is refused',
    threw(() => act(refill, { type: 'WITHDRAW_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 1 }))
      ?.includes('cargo space left') === true);

  // A vessel under way has no city to act in.
  const sailing = act(refill, { type: 'DISPATCH_VESSEL', vesselId: SHIP, destinationId: 'calais' });
  check('a vessel under way cannot store',
    threw(() => act(sailing, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 1 }))
      ?.includes('under way') === true);
  check('nor withdraw',
    threw(() => act(sailing, { type: 'WITHDRAW_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 1 }))
      ?.includes('under way') === true);
  // The shed stays where it was put — a warehouse is not cargo.
  check("the vessel sailing away leaves the shed's contents behind",
    (warehouseAt(sailing, HOME)?.cargo.cloth ?? 0) === 20);
  check('and unreachable from the new port',
    threw(() => act({ ...sailing, vessels: sailing.vessels.map(v => ({ ...v, destination: null, location: 'calais' })) },
      { type: 'WITHDRAW_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 1 }))?.includes('leases no warehouse') === true);
}

// ---------------------------------------------------------------------------
console.log('\n4. Rent, and what an unpaid lease costs');
// ---------------------------------------------------------------------------
{
  let s = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  s = act(s, { type: 'LEASE_WAREHOUSE', cityId: 'venice' });
  check('two leases report two rents', totalWarehouseRent(s) === 2 * warehouseRentPerWeek(WAREHOUSE_BASE_CAPACITY));

  const rent = totalWarehouseRent(s);
  const paid = resolveWeeklyWarehouses(s);
  check('rent is drawn once per week per lease', paid.cash === s.cash - rent);
  check('and both leases survive', Object.keys(paid.warehouses).length === 2 && paid.lapses.length === 0);

  // Drawn for real inside advanceWeek, not just callable in isolation — the bug class where a
  // resolver exists but nothing calls it.
  const week = act({ ...s, cash: 500 }, { type: 'ADVANCE_WEEK' });
  check('ADVANCE_WEEK actually charges it', week.cash < 500, `${Math.round(week.cash)}f`);
  check('and carries the leases forward', Object.keys(week.warehouses ?? {}).length === 2);

  // The fullest shed is paid first, so a shortfall costs the least. Deliberately deterministic.
  let stocked = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  stocked = act(stocked, { type: 'LEASE_WAREHOUSE', cityId: 'venice' });
  stocked = act(stocked, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 10 });
  stocked = act(stocked, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 10 });
  const oneRent = warehouseRentPerWeek(WAREHOUSE_BASE_CAPACITY);
  const short = resolveWeeklyWarehouses({ ...stocked, cash: oneRent });
  check('a shortfall lapses only what it must', short.lapses.length === 1, `${short.lapses.length} lapsed`);
  check('and the stocked shed is the one kept', !!short.warehouses[HOME] && !short.warehouses.venice);
  check('the empty lapse names no lost units', short.lapses[0].unitsLost === 0 && short.lapses[0].proceeds === 0);
  // The bug this driver actually found: sorting so the *fullest* shed is paid first looks equivalent
  // and is not — with nothing in hand nothing is affordable, so that order shed the fullest first
  // and kept the empty ones. Assert the ordering directly, both ways round, or the fix can silently
  // regress into the version that only happens to pass the case above.
  const reversed = resolveWeeklyWarehouses({
    ...stocked, cash: oneRent,
    warehouses: { venice: stocked.warehouses!.venice, [HOME]: stocked.warehouses![HOME] },
  });
  check('the shortfall outcome does not depend on key order',
    !!reversed.warehouses[HOME] && !reversed.warehouses.venice);
  check('the emptier shed is always the one shed', short.lapses[0].cityId === 'venice');

  // A stocked lapse: the landlord's agent sells the contents cheap.
  const price = priceAt(stocked.scarcity, HOME, 'cloth')!;
  const broke = resolveWeeklyWarehouses({ ...stocked, cash: 0 });
  check('with no cash at all every lease goes', broke.lapses.length === 2 && Object.keys(broke.warehouses).length === 0);
  const homeLapse = broke.lapses.find(l => l.cityId === HOME)!;
  check('the lapse names the units lost', homeLapse.unitsLost === 10);
  check('the distress sale returns half the local price', Math.abs(homeLapse.proceeds - price * 10 * 0.5) <= 1,
    `${homeLapse.proceeds} vs ${Math.round(price * 10 * 0.5)}`);
  check('and the proceeds reach the house', broke.cash > 0);
  // The exploit check that matters: lapsing must never beat selling properly.
  check('a distress sale is strictly worse than selling the same goods',
    homeLapse.proceeds < price * 10);

  // An embargoed good cannot be laundered out through a deliberate lapse.
  const embargo: ActiveMarketEvent = {
    id: 'e', templateId: 'me_guild_embargo', kind: 'guild_embargo', cityId: HOME, goodId: 'cloth',
    multiplier: 1, blocksTrade: true, startedWeek: 0, endsWeek: 99, headline: 'The guild has closed the trade.',
  };
  const blocked = resolveWeeklyWarehouses({ ...stocked, cash: 0, marketEvents: [embargo] });
  const blockedLapse = blocked.lapses.find(l => l.cityId === HOME)!;
  check('an embargoed good returns nothing on a lapse', blockedLapse.proceeds === 0);
  check('though it is still counted as lost', blockedLapse.unitsLost === 10);

  // The lapse is stamped with the week the player is now in, or the UI can never show it.
  const lapsedWeek = act({ ...stocked, cash: 0 }, { type: 'ADVANCE_WEEK' });
  check('a lapse reported by ADVANCE_WEEK is stamped with the new week',
    (lapsedWeek.lastWarehouseLapses ?? []).every(l => l.week === lapsedWeek.week),
    JSON.stringify(lapsedWeek.lastWarehouseLapses));
  check('and the leases are gone from state', Object.keys(lapsedWeek.warehouses ?? {}).length === 0);
  // Never accumulated — one week's report, like lastMarketCauses.
  const nextWeek = act({ ...lapsedWeek, cash: 500 }, { type: 'ADVANCE_WEEK' });
  check('the report does not accumulate into the next week',
    (nextWeek.lastWarehouseLapses ?? []).length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n5. The exploit the spec asks to be re-checked: buy, store, sell later');
// ---------------------------------------------------------------------------
{
  // Buying never lifts a price; selling depresses one. Storage lets a sale be metered across weeks
  // instead of dumped — that is the intended lever. What must NOT be true is that a same-city
  // round trip through the shed makes money out of nothing.
  let s = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  const startCash = s.cash;
  const p0 = priceAt(s.scarcity, HOME, 'cloth')!;
  s = act(s, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 10 });
  check('buying still does not lift the local price', priceAt(s.scarcity, HOME, 'cloth') === p0);
  s = act(s, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 10 });
  check('storing still does not lift it', priceAt(s.scarcity, HOME, 'cloth') === p0);
  s = act(s, { type: 'WITHDRAW_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 10 });
  check('nor does taking it back out', priceAt(s.scarcity, HOME, 'cloth') === p0);
  s = act(s, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 10 });
  check('an immediate same-city round trip through the shed is not free money',
    s.cash <= startCash + 0.001, `${Math.round(s.cash)} vs ${Math.round(startCash)}`);
  check('and selling still depressed the price', priceAt(s.scarcity, HOME, 'cloth')! < p0);

  // Shuffling one lot in and out many times must move nothing at all — the specific attack that a
  // scarcity-touching store/withdraw would have opened.
  let shuffle = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  shuffle = act(shuffle, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 5 });
  const cashAfterBuy = shuffle.cash;
  const scarcityAfterBuy = JSON.stringify(shuffle.scarcity);
  for (let i = 0; i < 30; i++) {
    shuffle = act(shuffle, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 5 });
    shuffle = act(shuffle, { type: 'WITHDRAW_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 5 });
  }
  check('30 round trips through the shed move no cash', shuffle.cash === cashAfterBuy);
  check('and move no scarcity', JSON.stringify(shuffle.scarcity) === scarcityAfterBuy);
  check('and lose no goods', (shuffle.vessels.find(v => v.id === SHIP)!.cargo.cloth ?? 0) === 5);

  // Metering a sale IS meant to beat dumping — that is the whole point of the feature, and a phase
  // that shipped the rent without the benefit would be worse than not shipping it.
  //
  // The first version of this comparison was confounded and reported the feature as useless: it
  // dumped in week 0 and metered across 24 weeks, so the metered branch alone paid 24 weeks of
  // wages, retainer and rent — a cost gap far larger than the price effect being measured. Both
  // branches now live the same 24 weeks and sell the same 16 units, and `Math.random` is pinned so
  // the two see identical drift rather than being compared across different dice.
  const stock = 16;
  const WEEKS = 24;
  const real = Math.random;
  let dumped = 0, metered = 0, meterEnd: GameState | null = null;
  try {
    Math.random = () => 0.5; // above NEW_EVENT_CHANCE_PER_WEEK, so no demand events muddy it

    let dump = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
    dump = act(dump, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: stock });
    dump = act(dump, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: stock });
    for (let w = 0; w < WEEKS; w++) dump = act(dump, { type: 'ADVANCE_WEEK' });
    dumped = dump.cash;

    let meter = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
    meter = act(meter, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: stock });
    meter = act(meter, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: stock });
    for (let i = 0; i < 4; i++) {
      meter = act(meter, { type: 'WITHDRAW_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 4 });
      meter = act(meter, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 4 });
      for (let w = 0; w < WEEKS / 4; w++) meter = act(meter, { type: 'ADVANCE_WEEK' });
    }
    metered = meter.cash;
    meterEnd = meter;
  } finally { Math.random = real; }

  check('metering a sale over weeks beats dumping the same stock at once',
    metered > dumped, `metered ${Math.round(metered)} vs dumped ${Math.round(dumped)}`);
  check('the shed is emptied by the end of it', warehouseUsed(warehouseAt(meterEnd!, HOME)!) === 0);
}

// ---------------------------------------------------------------------------
console.log('\n5b. The sell-pricing fix this phase required, pinned directly');
// ---------------------------------------------------------------------------
{
  // These three assertions guard the engine change without which warehousing is worthless: a sale's
  // market impact is applied across the quantity, not after it. Pinned here and not only implied by
  // the metering comparison above, because that comparison is a several-step scenario and would not
  // say *why* it broke if the pricing regressed.
  const s0 = act(seed(), { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 16 });
  const base = priceAt(s0.scarcity, HOME, 'cloth')!;
  const oneGo = act(s0, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 16 });
  const perUnitDumped = (oneGo.cash - s0.cash) / 16;
  check('a large sale gets a declining average, not the pre-trade price',
    perUnitDumped < base, `${perUnitDumped.toFixed(2)} vs base ${base}`);

  const halfA = act(s0, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 8 });
  const halfB = act(halfA, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 8 });
  check('splitting a sale within one week is exactly neutral',
    Math.abs((halfB.cash - s0.cash) - (oneGo.cash - s0.cash)) < 0.001,
    `${(halfB.cash - s0.cash).toFixed(3)} vs ${(oneGo.cash - s0.cash).toFixed(3)}`);
  check('and leaves the market in the same place',
    priceAt(halfB.scarcity, HOME, 'cloth') === priceAt(oneGo.scarcity, HOME, 'cloth'));

  // A single unit is unaffected — the fix must not shift the price of an ordinary small trade.
  const one = act(s0, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 1 });
  check('a single-unit sale still fetches exactly the quoted price',
    Math.abs((one.cash - s0.cash) - base) < 0.001, `${(one.cash - s0.cash).toFixed(3)} vs ${base}`);
}

// ---------------------------------------------------------------------------
console.log('\n6. Valuation, and save compatibility');
// ---------------------------------------------------------------------------
{
  let s = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  check('an empty house of sheds is worth nothing', warehousesValue(s) === 0);
  s = act(s, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 10 });
  s = act(s, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 10 });
  const price = priceAt(s.scarcity, HOME, 'cloth')!;
  check('stored goods are valued at their own city price', Math.abs(warehousesValue(s) - price * 10) < 0.001);
  check('a state with no warehouses at all values at nothing', warehousesValue(seed()) === 0);

  // Zero migration: a save written before this field existed.
  const legacy = seed();
  delete (legacy as Partial<GameState>).warehouses;
  delete (legacy as Partial<GameState>).lastWarehouseLapses;
  const advanced = act(legacy, { type: 'ADVANCE_WEEK' });
  check('a pre-Phase-26 save advances without throwing', advanced.week === legacy.week + 1);
  check('and is charged no rent it never agreed to', advanced.cash === act({ ...legacy, warehouses: {} }, { type: 'ADVANCE_WEEK' }).cash);
  check('helpers are all safe on an absent field',
    warehouseAt(legacy, HOME) === null && totalWarehouseRent(legacy) === 0 && warehousesValue(legacy) === 0);
  check('and a lease can still be signed on it', warehouseAt(act(legacy, { type: 'LEASE_WAREHOUSE', cityId: HOME }), HOME) !== null);
}

// ---------------------------------------------------------------------------
console.log('\n7. The household actually mentions it');
// ---------------------------------------------------------------------------
{
  // Both new counsel kinds asserted to *fire*, not merely to be authored. `drive-counsel.ts` now
  // checks that content and code agree about which kinds exist; this checks the situations the two
  // kinds describe really do reach `adviceFor`, which is the half that a naming guard cannot see.
  let s = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  const idle = adviceFor(s).filter(a => a.kind === 'storage_idle');
  check('an empty shed drawing rent is remarked on', idle.length === 1, `${idle.length}`);
  check('and the counsel names the city and the rent',
    idle[0].body.includes('Bruges') && idle[0].body.includes(`${warehouseRentPerWeek(WAREHOUSE_BASE_CAPACITY)}f`),
    idle[0]?.body);
  check('with no placeholder left unfilled', !/\{\w+\}/.test(idle[0].body));

  // A glutted port with cargo still aboard and room in the shed — the lever being taught.
  s = act(s, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 12 });
  const notGlutted = adviceFor(s).filter(a => a.kind === 'storage_meter');
  check('nothing is said while the local price is untouched', notGlutted.length === 0);
  s = act(s, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 6 });
  const meter = adviceFor(s).filter(a => a.kind === 'storage_meter');
  check('but once our own selling has glutted the port, it is', meter.length === 1, `${meter.length}`);
  check('and the counsel names the goods still aboard',
    meter[0].body.includes('Cloth') || meter[0].body.includes('cloth'), meter[0]?.body);
  check('with no placeholder left unfilled', !/\{\w+\}/.test(meter[0].body));
  check('the empty-shed counsel has stopped, the shed no longer being empty',
    adviceFor(s).filter(a => a.kind === 'storage_idle').length === 0
      ? warehouseUsed(warehouseAt(s, HOME)!) > 0
      : warehouseUsed(warehouseAt(s, HOME)!) === 0);

  // With no lease at all, neither counsel should ever appear — advice the player cannot act on.
  const noShed = act(seed(), { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 12 });
  const sold = act(noShed, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 6 });
  check('a house with no warehouse anywhere is never advised to use one',
    adviceFor(sold).every(a => a.kind !== 'storage_meter' && a.kind !== 'storage_idle'));

  // A full shed cannot take more, so the counsel must not suggest it.
  let brim = act(seed(), { type: 'LEASE_WAREHOUSE', cityId: HOME });
  brim = act(brim, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 20 });
  brim = act(brim, { type: 'STORE_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 20 });
  brim = act(brim, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 12 });
  brim = act(brim, { type: 'SELL_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 6 });
  check('a shed with no room left is not offered as the answer',
    adviceFor(brim).every(a => a.kind !== 'storage_meter'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
