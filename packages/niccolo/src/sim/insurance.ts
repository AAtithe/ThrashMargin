import { priceAt } from './market';
import type { Cargo, GameState, Insurance, MarketScarcity, Route, Vessel, VoyageLossEvent } from './types';

/** Design doc §4: "Insurance is purchasable in Bruges/Venice/Genoa." */
export const UNDERWRITING_CITIES = ['bruges', 'venice', 'genoa'];

export function canInsureAt(cityId: string): boolean {
  return UNDERWRITING_CITIES.includes(cityId);
}

/** Florin value of a cargo manifest at the prices of the city it's currently sitting in. */
export function cargoValue(scarcity: MarketScarcity, cargo: Cargo, cityId: string): number {
  let total = 0;
  for (const [goodId, qty] of Object.entries(cargo)) {
    if (qty <= 0) continue;
    const price = priceAt(scarcity, cityId, goodId);
    if (price !== null) total += price * qty;
  }
  return total;
}

const SEA_PREMIUM_RATE = 0.05;
const LAND_PREMIUM_RATE = 0.02;
const SEASONAL_PREMIUM_SURCHARGE = 0.02;
/**
 * "A premium that reflects the insurer's information, not the player's" (design doc §4): the
 * underwriter, sitting at the port, prices in how stale — or altogether absent — their own
 * knowledge of the destination is, reusing the existing news/latency system's own notion of a
 * report's age rather than inventing a second information model just for this.
 */
const STALE_INFO_SURCHARGE_PER_WEEK = 0.002;
const MAX_STALE_INFO_SURCHARGE = 0.03;
const NO_REPORT_SURCHARGE = 0.03;

export interface InsuranceQuote {
  coverage: number;
  premium: number;
}

export function quoteInsurance(state: GameState, vessel: Vessel, route: Route, destinationId: string): InsuranceQuote {
  const coverage = cargoValue(state.scarcity, vessel.cargo, vessel.location);
  const baseRate = route.type === 'sea' ? SEA_PREMIUM_RATE : LAND_PREMIUM_RATE;
  const seasonalSurcharge = route.seasonal ? SEASONAL_PREMIUM_SURCHARGE : 0;
  const report = state.knownPrices[destinationId];
  const staleSurcharge = report
    ? Math.min(MAX_STALE_INFO_SURCHARGE, (state.week - report.trueAsOfWeek) * STALE_INFO_SURCHARGE_PER_WEEK)
    : NO_REPORT_SURCHARGE;
  const rate = baseRate + seasonalSurcharge + staleSurcharge;
  return { coverage, premium: Math.round(coverage * rate) };
}

const SEA_RISK_PER_WEEK = 0.05;
const LAND_RISK_PER_WEEK = 0.015;
const SEASONAL_RISK_SURCHARGE = 0.02;
const LOSS_FRACTION_MIN = 0.2;
const LOSS_FRACTION_MAX = 0.5;

export interface VoyageRiskResolution {
  vessels: Vessel[];
  insurance: Insurance[];
  cashDelta: number;
  event: VoyageLossEvent | null;
}

/**
 * Cargo in transit is capital at risk (design doc §4). Every week a vessel is under way with
 * cargo aboard, roll a chance of a storm/piracy loss — sea routes riskier than land, seasonal
 * routes riskier still. At most one vessel is hit per week, the same one-event-per-week shape
 * `resolveHouseSabotage` already uses, so a bad week reads as one dramatic loss rather than a
 * slow bleed across the whole fleet. An active insurance policy on the hit vessel pays out cash
 * scaled to the fraction of its coverage actually lost; an uninsured vessel just loses the goods.
 */
export function resolveVoyageRisk(
  vessels: Vessel[],
  insurance: Insurance[],
  routes: Route[],
  week: number,
): VoyageRiskResolution {
  const candidates = vessels.filter(v => v.destination && Object.values(v.cargo).some(q => q > 0));

  for (const vessel of candidates) {
    const route = routes.find(r => r.id === vessel.routeId);
    if (!route) continue;
    const risk =
      (route.type === 'sea' ? SEA_RISK_PER_WEEK : LAND_RISK_PER_WEEK) + (route.seasonal ? SEASONAL_RISK_SURCHARGE : 0);
    if (Math.random() >= risk) continue;

    const goodIds = Object.keys(vessel.cargo).filter(id => (vessel.cargo[id] ?? 0) > 0);
    if (goodIds.length === 0) continue;
    const goodId = goodIds[Math.floor(Math.random() * goodIds.length)];
    const held = vessel.cargo[goodId];
    const fraction = LOSS_FRACTION_MIN + Math.random() * (LOSS_FRACTION_MAX - LOSS_FRACTION_MIN);
    const lost = Math.max(1, Math.floor(held * fraction));

    const policy = insurance.find(i => i.vesselId === vessel.id);
    const payout = policy ? Math.round(policy.coverage * fraction) : 0;

    return {
      vessels: vessels.map(v => (v.id === vessel.id ? { ...v, cargo: { ...v.cargo, [goodId]: held - lost } } : v)),
      insurance: insurance.filter(i => i.vesselId !== vessel.id),
      cashDelta: payout,
      event: {
        week,
        vesselId: vessel.id,
        vesselName: vessel.name,
        goodId,
        quantityLost: lost,
        insured: !!policy,
        payout,
      },
    };
  }

  return { vessels, insurance, cashDelta: 0, event: null };
}

/** A policy lapses, unused, once its vessel actually arrives — the voyage went fine. */
export function clearArrivedInsurance(insurance: Insurance[], vessels: Vessel[]): Insurance[] {
  const underWay = new Set(vessels.filter(v => v.destination).map(v => v.id));
  return insurance.filter(i => underWay.has(i.vesselId));
}
