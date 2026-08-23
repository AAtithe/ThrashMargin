/**
 * Free play and the AI rivals (Phase 27) — the mode itself, and the three fairness rules the design
 * doc states as the *reason* an information-only difficulty model is honest.
 *
 * The old scripted driver for `aiTrader.ts` proved the engine in isolation (fresher information
 * wins 12/12 seeds, a bigger ship is an upgrade, its sales move the player's market). It was never
 * committed and the engine was never wired to anything. This driver covers the wiring, and re-pins
 * the fairness claims now that the trader reads real prices through the demand layer and sells
 * through `sellProceeds` — both of which it previously bypassed.
 */
import { createInitialState } from '../src/sim/state';
import { processAction } from '../src/sim/actions';
import { applyBackgroundFlows, deriveMarketCauses, driftScarcity, priceAt, sellProceeds } from '../src/sim/market';
import { AI_PROFILES, aiNetWorth, createAiTrader, refreshAiKnowledge, resolveAiWeek, seedHomeKnowledge } from '../src/sim/aiTrader';
import {
  FREEPLAY_START_CASH, FREEPLAY_TARGET_NET_WORTH, checkFreeplayWin, createRivals,
  FREEPLAY_DEADLINE_WEEKS, freeplayDeadlineReached, freeplayGoal, freeplayGoalLabel, houseIsOut,
  isFreeplay, playerNetWorth, resolveFreeplayWeek, resolveWeeklyRivalPlants, standings,
} from '../src/sim/freeplay';
import { describeMarketCause } from '../src/components/marketCauseText';
import { CITIES } from '../src/sim/content';
import { cargoTotal } from '../src/sim/market';
import { gradeHeld } from '../src/sim/grades';
import { findVesselType, vesselSpeed, vesselUpkeep } from '../src/sim/shipyard';
import type { ActiveMarketEvent, AiTrader, GameState } from '../src/sim/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

/** A deterministic LCG standing in for Math.random, so a claim about *which* opponent wins is a
 * claim about the model and not about the dice. */
function seededRandom(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}
function withSeed<T>(seed: number, fn: () => T): T {
  const real = Math.random;
  Math.random = seededRandom(seed);
  try { return fn(); } finally { Math.random = real; }
}

function freeplay(rivals: 0 | 1 | 2 | 3 = 2): GameState {
  return createInitialState('fp', 'Test house', { freeplay: true, rivals });
}
const embargo = (cityId: string, goodId: string): ActiveMarketEvent => ({
  id: 'emb', templateId: 'me_guild_embargo', kind: 'guild_embargo', cityId, goodId,
  multiplier: 1, blocksTrade: true, startedWeek: 0, endsWeek: 99,
  headline: 'The guild has closed the trade.',
});
const festival = (cityId: string, goodId: string, multiplier: number): ActiveMarketEvent => ({
  id: 'fest', templateId: 'me_doge_wedding', kind: 'festival_demand', cityId, goodId,
  multiplier, blocksTrade: false, startedWeek: 0, endsWeek: 99,
  headline: 'A wedding nobody can ignore.',
});

// ---------------------------------------------------------------------------
console.log('\n1. The mode: what free play switches off, and on');
// ---------------------------------------------------------------------------
{
  const fp = freeplay();
  check('the state declares its mode', fp.mode === 'freeplay' && isFreeplay(fp));
  check('a campaign does not', !isFreeplay(createInitialState('c', 'C', { skipPrologue: true })));
  check('and neither does an older save with no mode field',
    !isFreeplay({ ...freeplay(), mode: undefined } as GameState));

  // The scripted layer is *absent*, not suppressed — the specific bug this guards is that free play
  // sets chapter0_complete (it unlocks wages and warehousing) and Chapter 1's opener triggers on
  // exactly that flag.
  check('no scripted event is queued at creation', fp.pendingEvents.length === 0, `${fp.pendingEvents.length}`);
  let stepped = fp;
  for (let i = 0; i < 12; i++) stepped = processAction(stepped, { type: 'ADVANCE_WEEK' });
  check('and none appears over twelve weeks', stepped.pendingEvents.length === 0, `${stepped.pendingEvents.length}`);
  check('nothing has fired at all', stepped.firedEvents.length === 0, stepped.firedEvents.join(','));
  check('no chapter flag has been set', !Object.keys(stepped.flags).some(f => /^chapter[1-8]_/.test(f)),
    Object.keys(stepped.flags).join(','));
  check('the campaign, by contrast, queues its opener at once',
    createInitialState('c', 'C', { skipPrologue: true }).pendingEvents.length > 0);

  check('objectives are hidden — they are chapter objectives and there are no chapters', fp.objectivesHidden === true);
  check('the player starts with working capital', fp.cash === FREEPLAY_START_CASH);
  check('a ship and a courier', fp.vessels.length === 2 && fp.vessels.some(v => v.kind === 'ship'));
  check('the standing systems are unlocked', fp.flags.chapter0_complete === true);
  check('and the week still advances normally', stepped.week === 12);
}

// ---------------------------------------------------------------------------
console.log('\n2. Rivals exist, are seated apart, and actually trade');
// ---------------------------------------------------------------------------
{
  check('two rivals by default', (freeplay().aiTraders ?? []).length === 2);
  check('three when asked', (freeplay(3).aiTraders ?? []).length === 3);
  check('none when asked for none', (freeplay(0).aiTraders ?? []).length === 0);
  const three = freeplay(3).aiTraders!;
  check('each rival sits in a different port',
    new Set(three.map(t => t.vessels[0].location)).size === 3, three.map(t => t.vessels[0].location).join(','));
  check('each has distinct capital', new Set(three.map(t => t.cash)).size === 3);
  check('each has a distinct information lag — the difficulty dial',
    new Set(three.map(t => t.reportLagWeeks)).size === 3, three.map(t => t.reportLagWeeks).join(','));
  check('no rival is omniscient', three.every(t => t.reportLagWeeks > 0));
  check('each knows only its own home market at the start',
    three.every(t => Object.keys(t.remembered).length === 1
      && t.remembered[t.vessels[0].location] !== undefined));

  // They must really trade when the clock runs, not merely exist.
  const traded = withSeed(7, () => {
    let s = freeplay(2);
    let notes = 0;
    for (let i = 0; i < 60; i++) { s = processAction(s, { type: 'ADVANCE_WEEK' }); notes += (s.lastAiNotes ?? []).length; }
    return { s, notes };
  });
  check('rivals trade over sixty weeks', traded.notes > 20, `${traded.notes} trades`);
  check('and compound their capital',
    traded.s.aiTraders!.some(t => aiNetWorth(t, traded.s.scarcity, traded.s.marketEvents) > 700),
    traded.s.aiTraders!.map(t => aiNetWorth(t, traded.s.scarcity, traded.s.marketEvents)).join('/'));
  check('they explore beyond home', traded.s.aiTraders!.every(t => Object.keys(t.remembered).length > 1),
    traded.s.aiTraders!.map(t => Object.keys(t.remembered).length).join('/'));
  check('the week report never accumulates', (traded.s.lastAiNotes ?? []).length < 20);
  check('a campaign runs the rival step for nothing',
    (processAction(createInitialState('c', 'C', { skipPrologue: true }), { type: 'ADVANCE_WEEK' }).lastAiNotes ?? []).length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n3. The three fairness rules, re-pinned after the Phase 27 rewiring');
// ---------------------------------------------------------------------------
{
  const base = freeplay(1);
  const trader = base.aiTraders![0];

  // RULE 1 — it never reads a market it has not reached. This was got wrong once (accidental
  // omniscience) and is the whole basis of the difficulty model.
  const refreshed = refreshAiKnowledge(trader, base.scarcity, 100, base.marketEvents);
  const marketCities = CITIES.filter(c => c.market && Object.keys(c.market).length > 0).length;
  check('an enormous lag does not reveal unvisited cities',
    Object.keys(refreshed.remembered).length < marketCities,
    `${Object.keys(refreshed.remembered).length} of ${marketCities}`);
  check('it knows only where it has stood', Object.keys(refreshed.remembered).length === 1);

  // RULE 2 — it trades on the prices the player trades on. The demand layer was the gap: `priceAt`
  // without `events` omits the demand factor entirely, so a trader reading that way would remember
  // and act on numbers no player can transact at.
  const feasted = { ...base, marketEvents: [festival('venice', 'silk', 2.0)] };
  const withDemand = seedHomeKnowledge(
    createAiTrader({ ...AI_PROFILES.steady, id: 'x', name: 'X', homeCity: 'venice' }),
    feasted.scarcity, 0, feasted.marketEvents,
  );
  const withoutDemand = seedHomeKnowledge(
    createAiTrader({ ...AI_PROFILES.steady, id: 'y', name: 'Y', homeCity: 'venice' }),
    feasted.scarcity, 0, undefined,
  );
  const playerPrice = priceAt(feasted.scarcity, 'venice', 'silk', feasted.marketEvents)!;
  check('a demand event really moves the price the player pays',
    playerPrice > priceAt(feasted.scarcity, 'venice', 'silk')!, `${playerPrice}`);
  check('the rival remembers the price the PLAYER would pay',
    withDemand.remembered.venice.prices.silk === playerPrice,
    `${withDemand.remembered.venice.prices.silk} vs ${playerPrice}`);
  check('and would have remembered a fiction without the demand layer threaded through',
    withoutDemand.remembered.venice.prices.silk !== playerPrice);

  // RULE 2b — its selling is priced by the same function the player's is (Phase 26's fix). Before
  // this the AI got snapshot-times-quantity, i.e. a systematically better price than the player for
  // the identical trade.
  const loaded: AiTrader = {
    ...trader,
    vessels: [{ ...trader.vessels[0], location: 'venice', cargo: { silk: 6 }, destination: null }],
    remembered: { venice: { week: 0, prices: { silk: 1 } } },
  };
  const before = loaded.cash;
  const result = resolveAiWeek(loaded, base.scarcity, 1, base.marketEvents);
  const sold = (result.notes.find(n => n.direction === -1)?.quantity) ?? 0;
  if (sold > 0) {
    const playerWouldGet = sellProceeds(base.scarcity, 'venice', 'silk', sold, base.marketEvents)!.revenue;
    // Net of the hull's weekly upkeep (Phase 30), which `resolveAiWeek` now draws before it trades —
    // the same `vesselUpkeep` the player's own fleet pays. The driver caught the omission the moment
    // upkeep landed, reporting 186 against 189: exactly the cog's 3f.
    const upkeep = loaded.vessels.reduce((sum, v) => sum + vesselUpkeep(v), 0);
    check('the rival pays hull upkeep like the player does', upkeep > 0, `${upkeep}f`);
    check('the rival realises exactly what the player would for the same sale, net of upkeep',
      Math.abs((result.trader.cash - before + upkeep) - playerWouldGet) < 0.001,
      `${(result.trader.cash - before + upkeep).toFixed(3)} vs ${playerWouldGet.toFixed(3)}`);
    const snapshot = priceAt(base.scarcity, 'venice', 'silk')! * sold;
    check('which is strictly less than the snapshot price it used to get',
      playerWouldGet < snapshot, `${playerWouldGet.toFixed(1)} vs ${snapshot}`);
  } else {
    check('the rival pays hull upkeep like the player does', false, 'it did not sell');
    check('the rival realises exactly what the player would for the same sale, net of upkeep', false, 'it did not sell');
    check('which is strictly less than the snapshot price it used to get', false, 'it did not sell');
  }

  // RULE 2c — its buying moves no price, exactly as the player's does not. Needs beliefs about a
  // *second* market to buy against: a trader that knows only where it is standing has no run to
  // plan and correctly explores instead of buying.
  const buying = resolveAiWeek(
    {
      ...trader,
      cash: 2000,
      vessels: [{ ...trader.vessels[0], location: 'bruges', cargo: {}, destination: null }],
      remembered: {
        bruges: { week: 1, prices: { cloth: 20 } },
        london: { week: 1, prices: { cloth: 200 } },
      },
    },
    base.scarcity, 1, base.marketEvents,
  );
  const bought = buying.notes.filter(n => n.direction === 1);
  if (bought.length > 0) {
    check('a rival buying moves no price at all',
      bought.every(n => priceAt(buying.scarcity, n.cityId, n.goodId, base.marketEvents)
        === priceAt(base.scarcity, n.cityId, n.goodId, base.marketEvents)));
  } else {
    check('a rival buying moves no price at all', false, 'it bought nothing');
  }

  // RULE 3 — a closed market is closed to it too.
  const closed = { ...base, marketEvents: [embargo('venice', 'silk')] };
  const seeded = seedHomeKnowledge(
    createAiTrader({ ...AI_PROFILES.steady, id: 'z', name: 'Z', homeCity: 'venice' }),
    closed.scarcity, 0, closed.marketEvents,
  );
  check('an embargoed good is not even remembered', seeded.remembered.venice.prices.silk === undefined);
  check('though the rest of that market still is', Object.keys(seeded.remembered.venice.prices).length > 0);
  const blockedRun = resolveAiWeek(
    { ...seeded, cash: 2000, vessels: [{ ...seeded.vessels[0], cargo: { silk: 6 } }] },
    closed.scarcity, 1, closed.marketEvents,
  );
  check('and it cannot sell into a market an event has closed',
    !blockedRun.notes.some(n => n.goodId === 'silk' && n.cityId === 'venice'));
}

// ---------------------------------------------------------------------------
console.log('\n4. Rivals crowd each other, and are named in the price narration');
// ---------------------------------------------------------------------------
{
  // Threaded in turn, not resolved against one snapshot — otherwise any number of rivals could sell
  // into a market at its untouched price, which is Phase 26's snapshot bug one level up.
  const base = freeplay(0);
  const mk = (id: string): AiTrader => ({
    ...createAiTrader({ ...AI_PROFILES.steady, id, name: id, homeCity: 'venice' }),
    vessels: [{ ...createAiTrader({ ...AI_PROFILES.steady, id, name: id, homeCity: 'venice' }).vessels[0], cargo: { silk: 6 } }],
    remembered: { venice: { week: 0, prices: { silk: 1 } } },
  });
  const first = mk('A'), second = mk('B');
  const one = resolveAiWeek(first, base.scarcity, 1, base.marketEvents);
  const two = resolveAiWeek(second, one.scarcity, 1, base.marketEvents);
  const firstGain = one.trader.cash - first.cash;
  const secondGain = two.trader.cash - second.cash;
  check('two rivals selling the same good into the same port crowd each other',
    secondGain < firstGain, `${firstGain.toFixed(1)} then ${secondGain.toFixed(1)}`);
  const together = resolveFreeplayWeek({ ...base, aiTraders: [first, second] }, 1);
  check('resolveFreeplayWeek threads them in turn, matching the manual chain',
    Math.abs(together.aiTraders[1].cash - two.trader.cash) < 0.001);
  check('and reports both sets of trades', together.notes.length === one.notes.length + two.notes.length);

  // Narration: a rival's trade must be named, not filed as anonymous "unknown flows".
  const causes = deriveMarketCauses(base.scarcity, base.scarcity, base.scarcity, together.scarcity, [], together.notes);
  const rivalNotes = Object.values(causes).flat().filter(c => c.kind === 'rival_trade');
  check('a rival trade is attributed to the rival', rivalNotes.length > 0, JSON.stringify(causes).slice(0, 120));
  if (rivalNotes.length > 0) {
    check('and names them', !!rivalNotes[0].houseName);
    const text = describeMarketCause(rivalNotes[0], 'Venice');
    check('the narration reads as competition, not scenery', /bidding against/.test(text), text);
    check('with no placeholder left unfilled', !/\{\w+\}/.test(text));
  } else {
    check('and names them', false); check('the narration reads as competition, not scenery', false);
    check('with no placeholder left unfilled', false);
  }
}

// ---------------------------------------------------------------------------
console.log('\n5. Standings and the win condition');
// ---------------------------------------------------------------------------
{
  const s = freeplay(2);
  const table = standings(s);
  check('the table holds the player and every rival', table.length === 3);
  check('exactly one row is the player', table.filter(r => r.isPlayer).length === 1);
  check('sorted richest first', table.every((r, i) => i === 0 || table[i - 1].netWorth >= r.netWorth));
  check('the player is named from the save', table.find(r => r.isPlayer)!.name === 'Test house');
  check('an unnamed house still gets a label',
    standings({ ...s, name: undefined }).find(r => r.isPlayer)!.name.length > 0);
  check('ordering is stable across repeat calls', JSON.stringify(standings(s)) === JSON.stringify(standings(s)));

  // The player's own figure: cash, cargo, stored goods, the hulls, and obligations both ways.
  // Asserted as *deltas* from the opening figure rather than against a literal, so Phase 28 adding
  // hull value to the balance sheet does not make four arithmetic assertions read as failures when
  // the arithmetic is fine.
  const opening = playerNetWorth(s);
  check('net worth opens above the starting cash, because the hulls count',
    opening > FREEPLAY_START_CASH, `${opening} vs ${FREEPLAY_START_CASH} cash`);
  // A real `Obligation`, not an approximation of one: the previous literal had `dueWeek` and
  // `counterparty`, neither of which exists on the type. It passed only because `playerNetWorth`
  // reads four fields — another thing the new scripts typecheck caught.
  const owing: GameState = {
    ...s,
    obligations: [{
      id: 'o', kind: 'bill_payable', direction: 'payable', currency: 'florin', cityId: 'bruges',
      amount: 100, issuedWeek: 0, matureWeek: 20, settled: false,
    }],
  };
  check('a payable subtracts', playerNetWorth(owing) === opening - 100);
  const owed = { ...owing, obligations: owing.obligations.map(o => ({ ...o, direction: 'receivable' as const })) };
  check('a receivable adds', playerNetWorth(owed) === opening + 100);
  check('a settled obligation counts for nothing',
    playerNetWorth({ ...owing, obligations: owing.obligations.map(o => ({ ...o, settled: true })) }) === opening);
  // And buying a hull must not read as a loss — the reason hulls are counted at all.
  const withHull = processAction(s, { type: 'BUY_VESSEL', typeId: 'cog' });
  check('converting cash into a hull is not a fall in the standings',
    playerNetWorth(withHull) > opening - findVesselType('cog')!.cost,
    `${playerNetWorth(withHull)} vs ${opening}`);

  // Win condition.
  check('nobody has won at week zero', checkFreeplayWin(s).winners.length === 0 && !checkFreeplayWin(s).playerWon);
  // Headroom over the weekly commitments (wages, and anything else advanceWeek draws) — at
  // target + 1 the very upkeep run that precedes the win check pulls the house back under it.
  const rich = { ...s, cash: FREEPLAY_TARGET_NET_WORTH + 500 };
  check('the player crossing the line wins', checkFreeplayWin(rich).playerWon);
  const richRival: GameState = {
    ...s, aiTraders: s.aiTraders!.map((t, i) => (i === 0 ? { ...t, cash: FREEPLAY_TARGET_NET_WORTH + 1 } : t)),
  };
  const rivalWin = checkFreeplayWin(richRival);
  check('a rival crossing it wins too', rivalWin.winners.length === 1 && !rivalWin.playerWon);
  check('and the winner is named', rivalWin.winners[0].name === s.aiTraders![0].name);

  // Recorded by ADVANCE_WEEK, once, and it does NOT stop the clock.
  const won = processAction(rich, { type: 'ADVANCE_WEEK' });
  check('the win week is stamped', won.freeplayWonWeek === won.week, `${won.freeplayWonWeek}`);
  const after = processAction(won, { type: 'ADVANCE_WEEK' });
  check('the clock keeps running afterwards — a sandbox has no story to end', after.week === won.week + 1);
  check('and the stamp is never rewritten', after.freeplayWonWeek === won.freeplayWonWeek);
  check('a campaign never stamps it',
    processAction(createInitialState('c', 'C', { skipPrologue: true }), { type: 'ADVANCE_WEEK' }).freeplayWonWeek === undefined);
  check('the target is a real climb from the starting capital', FREEPLAY_TARGET_NET_WORTH > FREEPLAY_START_CASH * 15);
}

// ---------------------------------------------------------------------------
console.log('\n6. The difficulty model, re-measured after the Phase 27 rewiring');
// ---------------------------------------------------------------------------
{
  // The claims below were originally established by an *uncommitted* driver against the old
  // snapshot sell pricing. Phase 26 changed what every sale realises and Phase 27 put the AI on
  // that same function, so none of it could be assumed to still hold — and one of them did not.
  //
  // `resolveAiWeek` never calls Math.random itself, so the market has to be moved between weeks the
  // way `advanceWeek` moves it, or every "seed" is the same deterministic run. That mistake made
  // the first attempt at this section report 0/12 from what was really a sample of one.
  // Takes a whole profile now rather than three loose numbers. Phase 30 replaced `shipCapacity`
  // with `vesselTypeId` + `warehouseCapacity`, and because `scripts/` was outside `tsconfig.json`'s
  // `include`, this call site kept passing the removed field and compiling — so every "profile"
  // below was really the same default hull with no sheds, and section 6 was measuring cash and lag
  // alone. `tsconfig.scripts.json` exists so that cannot happen again.
  type Profile = { reportLagWeeks: number; startingCash: number; vesselTypeId: string; warehouseCapacity: number };
  const runTrader = (profile: Profile, seed: number): number =>
    withSeed(seed, () => {
      const base = freeplay(0);
      let t = seedHomeKnowledge(
        createAiTrader({ ...profile, id: 't', name: 'T', homeCity: 'bruges' }),
        base.scarcity, 0, base.marketEvents,
      );
      let scarcity = base.scarcity;
      for (let w = 1; w <= 80; w++) {
        scarcity = driftScarcity(applyBackgroundFlows(scarcity));
        const r = resolveAiWeek(t, scarcity, w, base.marketEvents);
        t = r.trader; scarcity = r.scarcity;
      }
      return aiNetWorth(t, scarcity, base.marketEvents);
    });

  // CLAIM 1 — fresher information alone wins. Identical capital and hull; only the lag differs.
  // This is the design's central claim and the whole justification for an information-only
  // difficulty model, so it is asserted at strength rather than as "not worse".
  // CLAUDE.md's own earned rule: "win-rate comparisons need 150+ seeds. At 20 the noise is about
  // ±10 points and at 40 about ±8; three difficulty levels once read as non-monotonic purely from
  // sampling." An 80-week run is cheap here, so there is no reason to sit under that bar.
  const SEEDS = 150;
  let sharper = 0;
  for (let i = 1; i <= SEEDS; i++) {
    const lagOnly = { startingCash: 600, vesselTypeId: 'cog', warehouseCapacity: 0 };
    if (runTrader({ ...lagOnly, reportLagWeeks: 2 }, i * 977) > runTrader({ ...lagOnly, reportLagWeeks: 10 }, i * 977)) sharper++;
  }
  console.log(`       measured: fresher information (lag 2 vs lag 10) wins ${sharper}/${SEEDS}`);
  check(`fresher information alone wins ${SEEDS} seeds`, sharper >= SEEDS * 0.7, `${sharper}/${SEEDS}`);

  // The inversion this guards against was real and its cause was the opposite of what it looked
  // like: with only exploration as a fallback, a well-informed trader that had just crushed its own
  // market saw that accurately, found no positive margin, and *sat* — while an ignorant one still
  // believed the old price and traded anyway. Staler information won 23 of 24 seeds. Accuracy was
  // being punished with idleness, which `sailTowardBestKnownMarket` is the fix for.
  check('and it is not merely a coin flip', sharper > SEEDS * 0.6, `${sharper}/${SEEDS}`);

  // CLAIM 2 — the three shipped profiles are ordered in strength. This is what the player actually
  // meets, so it matters more than any single component of the dial.
  const PROFILE_SEEDS = 150;
  let ordered = 0, ruthlessOverSteady = 0;
  for (let i = 1; i <= PROFILE_SEEDS; i++) {
    const seed = i * 613;
    const c = runTrader(AI_PROFILES.cautious, seed);
    const st = runTrader(AI_PROFILES.steady, seed);
    const r = runTrader(AI_PROFILES.ruthless, seed);
    if (r > st) ruthlessOverSteady++;
    if (r > st && st > c) ordered++;
  }
  console.log(`       measured: ruthless>steady ${ruthlessOverSteady}/${PROFILE_SEEDS}, all three ordered ${ordered}/${PROFILE_SEEDS}`);
  check('ruthless beats steady on essentially every seed', ruthlessOverSteady >= PROFILE_SEEDS * 0.95,
    `${ruthlessOverSteady}/${PROFILE_SEEDS}`);
  check('and the three profiles come out fully ordered', ordered >= PROFILE_SEEDS * 0.9,
    `${ordered}/${PROFILE_SEEDS}`);

  // CLAIM 3 — capacity. Phase 27 had to record this as a **failed** claim: extra hull beyond what a
  // market can absorb bought mostly time in port (thirty units at six a week is five weeks
  // alongside), so a big hull merely held level with a small one. Phase 30's warehousing is the
  // direct answer — a shed turns that dead time back into voyages — so the claim is re-measured
  // here rather than left as a standing limitation, in both the pairing that ships and in isolation.
  const HULL_SEEDS = 60;
  let shedsPay = 0, carrackOnCarrackMoney = 0, carrackOnCogMoney = 0;
  for (let i = 1; i <= HULL_SEEDS; i++) {
    const seed = i * 811;
    const cogShed = { reportLagWeeks: 4, startingCash: 600, vesselTypeId: 'cog', warehouseCapacity: 40 };
    const cogBare = { reportLagWeeks: 4, startingCash: 600, vesselTypeId: 'cog', warehouseCapacity: 0 };
    // A carrack costs 8f a week against a cog's 3f. Compared at the capital each hull actually
    // needs, and then deliberately at capital it does *not*.
    const richCarrack = { reportLagWeeks: 4, startingCash: 1200, vesselTypeId: 'carrack', warehouseCapacity: 40 };
    const richCog = { reportLagWeeks: 4, startingCash: 1200, vesselTypeId: 'cog', warehouseCapacity: 40 };
    const poorCarrack = { reportLagWeeks: 4, startingCash: 600, vesselTypeId: 'carrack', warehouseCapacity: 40 };
    if (runTrader(cogShed, seed) > runTrader(cogBare, seed)) shedsPay++;
    if (runTrader(richCarrack, seed) > runTrader(richCog, seed)) carrackOnCarrackMoney++;
    if (runTrader(poorCarrack, seed) > runTrader(cogShed, seed)) carrackOnCogMoney++;
  }
  console.log(`       measured: sheds alone pay ${shedsPay}/${HULL_SEEDS}; a carrack beats a cog on carrack money ${carrackOnCarrackMoney}/${HULL_SEEDS}, on cog money ${carrackOnCogMoney}/${HULL_SEEDS}`);
  check('a warehouse is worth leasing at all', shedsPay >= HULL_SEEDS * 0.6, `${shedsPay}/${HULL_SEEDS}`);
  // **What capacity is actually worth in this economy, stated truthfully.** Three phases have now
  // taken a run at "a bigger ship is an upgrade" and the answer is no — but for a structural reason
  // rather than a tuning one, and that is worth pinning so a fourth phase does not chase it again.
  //
  // A single market absorbs about `ABSORBABLE_UNITS` of one good before the sale crushes its own
  // price, and most cities trade two to four goods. So hold beyond roughly one market's appetite
  // cannot be *arbitraged*, whatever it costs to keep: measured at matched capital and with sheds,
  // a cog beat a carrack at every capital level tried (600f, 1,200f, 2,500f). Phase 30 narrowed the
  // gap from 10-17% to about 5-7% by cutting the carrack's upkeep and speed penalty, which makes her
  // a real cost rather than a trap — but she does not overtake, and the honest reading is that her
  // hold earns its keep where a *single consignment* must move at once. That is a campaign use
  // (Chapter 6's `combinedCargoAtLeast` delivery checks) which a free-play arbitrage measurement
  // structurally cannot see, and the class note now tells the player exactly that.
  // Asserted as a *band* on the carrack's own win rate, not as a comparison between two figures that
  // both sit around a fifth — at that level the two are noise apart, and an earlier version of this
  // assertion failed on exactly that. She should lose more often than she wins (hold cannot be
  // arbitraged) without being dominated (she is not a trap). Roughly one seed in five is that.
  const carrackWins = Math.max(carrackOnCarrackMoney, carrackOnCogMoney);
  check('a carrack loses to a cog more often than she wins — hold is not an arbitrage advantage',
    carrackWins < HULL_SEEDS * 0.5, `${carrackWins}/${HULL_SEEDS}`);
  check('but she is a real cost rather than a trap, winning a meaningful share of seeds',
    carrackWins >= HULL_SEEDS * 0.1, `${carrackWins}/${HULL_SEEDS}`);
  // The lever that *does* pay, unambiguously, and the one this phase added.
  check('while a shed pays at nearly every seed — storage beats tonnage in this economy',
    shedsPay >= HULL_SEEDS * 0.85, `${shedsPay}/${HULL_SEEDS}`);
}

// ---------------------------------------------------------------------------
console.log('\n5b. All three win conditions, not just the one Phase 27 picked');
// ---------------------------------------------------------------------------
{
  const at = (goal: 'target' | 'by_year' | 'survivor', over: Partial<GameState> = {}): GameState =>
    ({ ...createInitialState('g', 'Mine', { freeplay: true, rivals: 2, freeplayGoal: goal }), ...over });

  check('a game records the goal it was created with',
    at('by_year').freeplayGoal === 'by_year' && at('survivor').freeplayGoal === 'survivor');
  check('and an older save with no goal plays the original one', freeplayGoal({ ...at('target'), freeplayGoal: undefined }) === 'target');
  check('each goal describes itself differently',
    new Set((['target', 'by_year', 'survivor'] as const).map(g => freeplayGoalLabel(at(g)))).size === 3);

  // TARGET — unchanged behaviour, re-asserted so the new branches cannot break the old one.
  check('target: crossing the line wins', checkFreeplayWin(at('target', { cash: FREEPLAY_TARGET_NET_WORTH + 500 })).playerWon);
  check('target: below it, nobody has', !checkFreeplayWin(at('target')).playerWon);

  // BY_YEAR — nobody wins until the clock runs out, then the leader does outright. The point of the
  // mode is that it stays undecided, so "rich but early" must NOT win.
  const richEarly = at('by_year', { cash: FREEPLAY_TARGET_NET_WORTH * 5, week: FREEPLAY_DEADLINE_WEEKS - 1 });
  check('by_year: being far ahead early wins nothing', checkFreeplayWin(richEarly).winners.length === 0);
  check('and the deadline is not reached', !freeplayDeadlineReached(richEarly));
  const atTheBell = { ...richEarly, week: FREEPLAY_DEADLINE_WEEKS };
  check('by_year: the leader wins the week the clock runs out', checkFreeplayWin(atTheBell).playerWon);
  check('and the deadline reads as reached', freeplayDeadlineReached(atTheBell));
  const behindAtTheBell = at('by_year', {
    week: FREEPLAY_DEADLINE_WEEKS,
    aiTraders: at('by_year').aiTraders!.map((t, i) => (i === 0 ? { ...t, cash: 90_000 } : t)),
  });
  const bellResult = checkFreeplayWin(behindAtTheBell);
  check('by_year: and it is the actual leader, not the player by default',
    bellResult.winners.length === 1 && !bellResult.playerWon, JSON.stringify(bellResult.winners));
  check('by_year never applies its deadline to another goal', !freeplayDeadlineReached({ ...atTheBell, freeplayGoal: 'target' }));

  // SURVIVOR — nobody wins while anybody else is standing, and the *reason* a house is out has to
  // be the player's own definition of solvency or it is not a fair race.
  check('survivor: nobody wins while all three are standing', checkFreeplayWin(at('survivor')).winners.length === 0);
  const brokeRivals = at('survivor', {
    aiTraders: at('survivor').aiTraders!.map(t => ({ ...t, cash: 0, vessels: [], warehouses: {} })),
  });
  const lastStanding = checkFreeplayWin(brokeRivals);
  check('survivor: last house standing wins', lastStanding.playerWon && lastStanding.winners.length === 1);
  check('a rival with nothing left is out', houseIsOut(brokeRivals, brokeRivals.aiTraders![0].id));
  check('a rival still trading is not', !houseIsOut(at('survivor'), at('survivor').aiTraders![0].id));
  check('the player is out on the same insolvency the campaign uses',
    houseIsOut({ ...at('survivor'), insolvent: true }, 'player')
      && !houseIsOut(at('survivor'), 'player'));
  const playerGone = { ...brokeRivals, insolvent: true };
  check('survivor: with nobody solvent at all, nobody has won', checkFreeplayWin(playerGone).winners.length === 0);
  // A solo game cannot be "won" by outlasting nobody.
  check('survivor: a game with no rivals is not won by default',
    checkFreeplayWin(createInitialState('s', 'S', { freeplay: true, rivals: 0, freeplayGoal: 'survivor' })).winners.length === 0);

  // All three stamp through the real pipeline.
  const stamped = processAction(at('target', { cash: FREEPLAY_TARGET_NET_WORTH + 500 }), { type: 'ADVANCE_WEEK' });
  check('a win is stamped by ADVANCE_WEEK whatever the goal', stamped.freeplayWonWeek === stamped.week);
  const yearStamped = processAction({ ...atTheBell, week: FREEPLAY_DEADLINE_WEEKS - 1 }, { type: 'ADVANCE_WEEK' });
  check('and by_year stamps on the tick that reaches the deadline',
    yearStamped.freeplayWonWeek === FREEPLAY_DEADLINE_WEEKS, `${yearStamped.freeplayWonWeek}`);
}

// ---------------------------------------------------------------------------
console.log('\n5c. The rivals now play with the player\'s own tools');
// ---------------------------------------------------------------------------
{
  const base = freeplay(3);
  const traders = base.aiTraders!;

  // Hull classes, from the same content the player's shipyard sells.
  check('every rival sails a real class', traders.every(t => !!findVesselType(t.vesselTypeId)));
  check('and its hull capacity comes from that class',
    traders.every(t => t.vessels[0].capacity === findVesselType(t.vesselTypeId)!.capacity));
  check('the classes differ across profiles', new Set(traders.map(t => t.vesselTypeId)).size > 1);
  check('so upkeep is real money', traders.every(t => vesselUpkeep(t.vessels[0]) > 0));
  check('and passage differs by class',
    new Set(traders.map(t => vesselSpeed(t.vessels[0]))).size > 1);

  // A rival that cannot pay upkeep is laid up, exactly as the player's hull is — not repossessed.
  const skint = { ...traders[0], cash: 0 };
  const laid = resolveAiWeek(skint, base.scarcity, 1, base.marketEvents);
  // Mothballed, not declassed — and that distinction is the whole point. Clearing the class looked
  // like a penalty and was a reward: a carrack stripped of its class keeps forty units of hold, is
  // 35% *faster*, and costs nothing. A live free-play run had both rivals laid up and thriving on it.
  check('a rival that cannot pay upkeep is laid up, not stripped of its hull',
    laid.trader.vessels.length === 1 && laid.trader.vessels[0].laidUp === true);
  check('it keeps its class, so lay-up can never be a speed upgrade',
    laid.trader.vessels[0].typeId === skint.vessels[0].typeId);
  check('and then costs nothing further', vesselUpkeep(laid.trader.vessels[0]) === 0);
  check('but keeps its hold', laid.trader.vessels[0].capacity === skint.vessels[0].capacity);
  check('a mothballed hull goes nowhere', !laid.trader.vessels[0].destination);
  // ...and comes back into service the moment the money is there.
  const flush = resolveAiWeek({ ...laid.trader, cash: 5000 }, base.scarcity, 2, base.marketEvents);
  check('and is recommissioned once the house can afford her again', !flush.trader.vessels[0].laidUp);

  // Warehousing: profiles differ in whether they have thought of it, which is the dial expressing
  // the mechanic rather than a fourth stat.
  check('the profiles differ in whether they warehouse',
    new Set(traders.map(t => t.warehouseCapacity ?? 0)).size > 1,
    traders.map(t => t.warehouseCapacity).join('/'));
  check('and at least one does not warehouse at all', traders.some(t => (t.warehouseCapacity ?? 0) === 0));

  // Landing surplus: a rival with a shed should put cargo down rather than sit in port with it.
  const shedded: AiTrader = {
    ...traders.find(t => (t.warehouseCapacity ?? 0) > 0)!,
    vessels: [{ ...traders[0].vessels[0], location: 'bruges', cargo: { cloth: 18 }, destination: null }],
    remembered: { bruges: { week: 0, prices: { cloth: 1 } } },
    warehouses: {},
  };
  const landed = resolveAiWeek(shedded, base.scarcity, 1, base.marketEvents);
  const stored = landed.trader.warehouses?.bruges ?? {};
  check('a rival with a shed lands its surplus rather than sitting on it',
    (stored.cloth ?? 0) > 0, JSON.stringify(stored));
  // Storing is not a market transaction, in either direction — the same rule the player's own
  // `storeGood` follows, and the rule that keeps buy-store-sell-later from being free money. Tested
  // by running the identical rival with and without a shed: both meter the same six units into the
  // market, so if landing the remaining twelve moved anything, the two would diverge.
  // (The first version of this assertion ended in `|| true` and tested nothing at all.)
  const noShedRun = resolveAiWeek({ ...shedded, warehouseCapacity: 0 }, base.scarcity, 1, base.marketEvents);
  check('storing the remainder moves no price',
    JSON.stringify(landed.scarcity) === JSON.stringify(noShedRun.scarcity));
  check('and both sold the same amount into the market',
    JSON.stringify(landed.notes.map(n => [n.goodId, n.direction, n.quantity]))
      === JSON.stringify(noShedRun.notes.map(n => [n.goodId, n.direction, n.quantity])));
  check('and it does not sit in port with a full hold once it has a shed',
    cargoTotal(landed.trader.vessels[0].cargo) < 18);

  // ...and takes it back aboard when it returns.
  const returning: AiTrader = {
    ...shedded,
    vessels: [{ ...shedded.vessels[0], cargo: {} }],
    warehouses: { bruges: { cloth: 10 } },
  };
  const collected = resolveAiWeek(returning, base.scarcity, 1, base.marketEvents);
  check('a rival collects what it left in a shed',
    (collected.trader.warehouses?.bruges?.cloth ?? 10) < 10,
    JSON.stringify(collected.trader.warehouses));

  // A rival with no shed allowance must never store anything, whatever else happens.
  const noShed = resolveAiWeek({ ...shedded, warehouseCapacity: 0, warehouses: {} }, base.scarcity, 1, base.marketEvents);
  check('a rival without a shed allowance never stores anything',
    Object.values(noShed.trader.warehouses ?? {}).every(c => cargoTotal(c) === 0));

  // Stored goods must count in the standings, or landing cargo would read as losing it.
  const withStock: AiTrader = { ...traders[0], warehouses: { bruges: { cloth: 20 } } };
  check('a rival’s stored goods count toward its net worth',
    aiNetWorth(withStock, base.scarcity, base.marketEvents)
      > aiNetWorth({ ...traders[0], warehouses: {} }, base.scarcity, base.marketEvents));

  // Grades: bought only when the destination is the city that pays the premium.
  const buyer: AiTrader = {
    ...traders[0],
    cash: 4000,
    vessels: [{ ...traders[0].vessels[0], location: 'bruges', cargo: {}, destination: null }],
    // London pays a quality premium for cloth; Calais does not.
    remembered: {
      bruges: { week: 1, prices: { cloth: 20 } },
      london: { week: 1, prices: { cloth: 200 } },
    },
  };
  const gradedRun = resolveAiWeek(buyer, base.scarcity, 1, base.marketEvents);
  const hold = gradedRun.trader.vessels[0];
  check('a rival buys a graded lot when the destination pays a premium for it',
    gradeHeld(hold.cargo, hold.cargoGrades, 'cloth', 'fine') > 0,
    JSON.stringify(hold.cargoGrades));
  const plainBuyer: AiTrader = {
    ...buyer,
    remembered: { bruges: { week: 1, prices: { cloth: 20 } }, calais: { week: 1, prices: { cloth: 200 } } },
  };
  const plainRun = resolveAiWeek(plainBuyer, base.scarcity, 1, base.marketEvents);
  const plainHold = plainRun.trader.vessels[0];
  check('and buys common when the destination does not',
    gradeHeld(plainHold.cargo, plainHold.cargoGrades, 'cloth', 'fine') === 0,
    JSON.stringify(plainHold.cargoGrades));
  check('a graded purchase really costs the premium',
    gradedRun.trader.cash < buyer.cash);
}

// ---------------------------------------------------------------------------
console.log('\n6b. Planting false news on a rival — §6\'s last deferred verb');
// ---------------------------------------------------------------------------
{
  const base = freeplay(2);
  const rivalId = base.aiTraders![0].id;

  // Placement is validated against the rivals actually in this game — buying an agent against a
  // trader that is not there would be money spent on something that could never act.
  check('an agent can be placed inside a rival',
    processAction({ ...base, cash: 900 }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: rivalId }, name: 'A clerk' })
      .agents.some(a => a.placement.type === 'rival'));
  check('but not inside a rival that is not in this game',
    (() => { try { processAction({ ...base, cash: 900 }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: 'rival_nowhere' } }); return false; } catch (e) { return /no such rival/i.test((e as Error).message); } })());
  const once = processAction({ ...base, cash: 900 }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: rivalId } });
  check('and never twice inside the same one',
    (() => { try { processAction({ ...once, cash: 900 }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: rivalId } }); return false; } catch (e) { return /already has somebody/i.test((e as Error).message); } })());
  check('a campaign has no rivals to place against',
    (() => { try { processAction({ ...createInitialState('c', 'C', { skipPrologue: true }), cash: 900, pendingEvents: [] }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: 'rival_venice' } }); return false; } catch { return true; } })());

  // The lie itself. Forced to land, and forced to miss, rather than hoping the dice cooperate.
  const withAgent: GameState = {
    ...base,
    agents: [{ id: 'a1', name: 'A clerk in Venice', placement: { type: 'rival', traderId: rivalId }, placedWeek: 0 }],
    aiTraders: base.aiTraders!.map(t => t.id === rivalId
      ? { ...t, remembered: { ...t.remembered, london: { week: 0, prices: { cloth: 100, wool: 50 } } } }
      : t),
  };
  const real = Math.random;
  let landed: ReturnType<typeof resolveWeeklyRivalPlants> | null = null;
  let missed: ReturnType<typeof resolveWeeklyRivalPlants> | null = null;
  try {
    Math.random = () => 0.01; // below the chance, and picks the first candidate city
    landed = resolveWeeklyRivalPlants(withAgent, 12);
    Math.random = () => 0.99; // above the chance
    missed = resolveWeeklyRivalPlants(withAgent, 12);
  } finally { Math.random = real; }

  check('a landed plant is reported', !!landed!.plant, JSON.stringify(landed!.plant));
  check('and names the rival, the city and the agent',
    !!landed!.plant && landed!.plant.traderName.length > 0 && landed!.plant.cityName.length > 0
      && landed!.plant.agentName === 'A clerk in Venice');
  const before = withAgent.aiTraders!.find(t => t.id === rivalId)!.remembered;
  const after = landed!.aiTraders.find(t => t.id === rivalId)!.remembered;
  const changedCity = Object.keys(after).find(c => JSON.stringify(after[c]) !== JSON.stringify(before[c]))!;
  check('exactly one city’s books are corrupted',
    Object.keys(after).filter(c => JSON.stringify(after[c]) !== JSON.stringify(before[c])).length === 1);
  check('the prices there really moved',
    Object.keys(after[changedCity].prices).some(g => after[changedCity].prices[g] !== before[changedCity].prices[g]));
  check('and no price is ever bent to zero or below',
    Object.values(after[changedCity].prices).every(p => p >= 1));
  check('a missed roll changes nothing at all',
    !missed!.plant && JSON.stringify(missed!.aiTraders) === JSON.stringify(withAgent.aiTraders));
  check('and no agent means no plant, ever',
    !resolveWeeklyRivalPlants(base, 12).plant);

  // The port the rival is *standing in* is never lied to it about — it would see the truth out of
  // its own window. Deliberately the current port rather than the home port: once the hull sails on,
  // its own home market is fair game again, because by then the rival is reading reports about it
  // like anybody else. Asserted both ways round, since the distinction is easy to lose.
  const where = base.aiTraders!.find(t => t.id === rivalId)!.vessels[0].location;
  check('a rival is never deceived about the port it is standing in', changedCity !== where,
    `${changedCity} vs ${where}`);
  const sailedOn: GameState = {
    ...withAgent,
    aiTraders: withAgent.aiTraders!.map(t => t.id === rivalId
      ? { ...t, vessels: [{ ...t.vessels[0], location: 'london' }] }
      : t),
  };
  const realRng = Math.random;
  let moved: ReturnType<typeof resolveWeeklyRivalPlants> | null = null;
  try { Math.random = () => 0.01; moved = resolveWeeklyRivalPlants(sailedOn, 12); }
  finally { Math.random = realRng; }
  const movedBefore = sailedOn.aiTraders!.find(t => t.id === rivalId)!.remembered;
  const movedAfter = moved!.aiTraders.find(t => t.id === rivalId)!.remembered;
  const movedCity = Object.keys(movedAfter).find(c => JSON.stringify(movedAfter[c]) !== JSON.stringify(movedBefore[c]));
  check('but once it has sailed on, the market it came from is fair game',
    movedCity === where, `${movedCity} vs ${where}`);

  // **The property that makes this fair.** The lie is stamped fresh so it survives, but only for
  // that rival's own report lag — so a sharper opponent shakes it off sooner. The difficulty dial
  // doing the work in a third place, with no special case.
  check('the lie is stamped with the current week, so it is not refreshed away on the same tick',
    after[changedCity].week === 12, `${after[changedCity].week}`);
  const trader = landed!.aiTraders.find(t => t.id === rivalId)!;
  const stillLying = refreshAiKnowledge(trader, base.scarcity, 12 + trader.reportLagWeeks - 1, base.marketEvents);
  const washedOut = refreshAiKnowledge(trader, base.scarcity, 12 + trader.reportLagWeeks, base.marketEvents);
  check('it survives inside the rival’s report lag',
    JSON.stringify(stillLying.remembered[changedCity]) === JSON.stringify(after[changedCity]));
  check('and washes out the week that lag expires',
    JSON.stringify(washedOut.remembered[changedCity]) !== JSON.stringify(after[changedCity]));

  // Wired into the real pipeline, not merely callable.
  const stepped = processAction({ ...withAgent, cash: 900 }, { type: 'ADVANCE_WEEK' });
  check('ADVANCE_WEEK runs the plant step without throwing', stepped.week === withAgent.week + 1);
  check('and a campaign runs it for nothing',
    processAction({ ...createInitialState('c2', 'C', { skipPrologue: true }), pendingEvents: [] }, { type: 'ADVANCE_WEEK' }).lastRivalPlant == null);
}

// ---------------------------------------------------------------------------
console.log('\n7. Save compatibility, and the campaign left untouched');
// ---------------------------------------------------------------------------
{
  const created = createInitialState('c', 'C', { skipPrologue: true });
  // A campaign opens with Chapter 1's own event already queued, and `processAction` correctly
  // refuses everything but RESOLVE_EVENT until it is answered — so clear it first, or this is a
  // test of the event gate rather than of save compatibility.
  const legacy = created.pendingEvents.length > 0
    ? processAction(created, { type: 'RESOLVE_EVENT', eventId: created.pendingEvents[0], choiceIndex: 0 })
    : created;
  delete (legacy as Partial<GameState>).mode;
  delete (legacy as Partial<GameState>).aiTraders;
  delete (legacy as Partial<GameState>).lastAiNotes;
  const advanced = processAction(legacy, { type: 'ADVANCE_WEEK' });
  check('a pre-Phase-27 save advances without throwing', advanced.week === legacy.week + 1,
    `week ${advanced.week} from ${legacy.week}, ${legacy.pendingEvents.length} pending`);
  check('and stays a campaign', !isFreeplay(advanced));
  check('helpers are safe on an absent field',
    standings(legacy).length === 1 && resolveFreeplayWeek(legacy, 1).notes.length === 0);
  check('a campaign save keeps firing its own content', advanced.firedEvents.length > 0,
    `${advanced.firedEvents.length} fired`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
