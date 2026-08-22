import {
  DECLARATION_TURNS,
  FITTING_PRICES,
  MAX_VEHICLES,
  SHARE_MAJORITY,
  shareBuybackFor,
  sharePriceFor,
  SHARE_RAID_MULTIPLIER,
  VEHICLE_CLASSES,
  DEFAULT_VEHICLE_CLASS,
  TOTAL_SHARES,
  VICTORY_CASH,
  canBuyOut,
  canHostileBid,
  hostileBidPrice,
  loanCeilingFor,
  loanRateLabel,
  LOAN_INTEREST_PER_ROUND,
  LOAN_STEP,
  wagesFor,
} from '../sim/rules';
import { HOME_DEPOT, depotName } from '../sim/content';
import { COMPANIES, STOCK_IDS, standing } from '../sim/stocks';
import { insurancePremium } from '../sim/hazards';
import { FONT, UI, money } from '../theme';
import { Button, Label, Panel, bodySmall, dataText } from './ui';
import type { Haulier, GameAction, GameState, Vehicle } from '../sim/types';
import type { VehicleClassId } from '../sim/rules';

interface Props {
  state: GameState;
  haulier: Haulier;
  fleetSize: number;
  dispatch: (action: GameAction) => void;
  enabled: boolean;
  /** The haulier's own vehicles, so fittings can be bought for whichever is in depot. */
  vehicles: Vehicle[];
}

/**
 * Shares, vehicles and the claim to the company. Everything here is how a haulier converts a good
 * trading season into an actual win, which is a separate skill from running cargo well.
 */
export default function CountingHouse({ state, haulier, fleetSize, dispatch, enabled, vehicles }: Props) {
  const bankHasShares = state.sharesRemaining > 0;
  const sharePrice = bankHasShares
    ? sharePriceFor(state.sharesRemaining)
    : sharePriceFor(0) * SHARE_RAID_MULTIPLIER;
  // During the countdown anyone may buy off anyone — The Tea Race's sabotage window.
  const sabotage = state.declaration !== null;

  const buyoutTarget = state.hauliers
    .filter(c => c.id !== haulier.id && c.shares > 0 && canBuyOut(haulier.shares, c.shares, sabotage))
    .sort((a, b) =>
      sabotage
        ? b.shares - a.shares || state.hauliers.indexOf(a) - state.hauliers.indexOf(b)
        : a.shares - b.shares || state.hauliers.indexOf(a) - state.hauliers.indexOf(b),
    )[0];

  const canBuyShare = bankHasShares
    ? haulier.cash >= sharePrice
    : Boolean(buyoutTarget) && haulier.cash >= sharePrice;

  const wagesOn = state.hazards?.wages ?? false;
  const loansOn = state.hazards?.loans ?? false;
  const arrears = haulier.arrears ?? 0;
  const debt = haulier.debt ?? 0;
  const ceiling = loanCeilingFor(fleetSize, haulier.shares);
  const ladenSlots = vehicles.reduce((n, sh) => n + sh.hold.length, 0);
  const classesOn = state.hazards?.vehicleClasses ?? false;
  const stocksOn = state.hazards?.stocks ?? false;

  const canDeclare = haulier.shares >= SHARE_MAJORITY && !state.declaration;
  const buyback = shareBuybackFor(state.sharesRemaining);

  /**
   * The hostile bid, and who it is worth making against.
   *
   * Targets the biggest holder: taking one off the leader is a two-share swing, which is the whole
   * reason to pay this price. This is the panel that used to read "No share to be had" and stop —
   * stating the dead end without naming the way out of it.
   */
  const bidsEnabled = state.hazards?.hostileBids ?? false;
  const bidsMade = state.hostileBids ?? 0;
  const bidPrice = hostileBidPrice(bidsMade, haulier.shares);
  const bidTarget = bidsEnabled
    ? [...state.hauliers]
        .filter(c => c.id !== haulier.id && c.shares > 0)
        .sort((a, b) => b.shares - a.shares)[0]
    : undefined;
  const canBid =
    bidsEnabled &&
    Boolean(bidTarget) &&
    canHostileBid(haulier.shares, haulier.cash, bidTarget!.shares, bidsMade);

  return (
    <Panel
      title="Counting house"
      aside={
        <Label>
          {haulier.shares}/{TOTAL_SHARES} shares
        </Label>
      }
    >
      <p style={{ ...bodySmall, margin: 0 }}>
        To carry the company you need {SHARE_MAJORITY} of the {TOTAL_SHARES} shares, then{' '}
        {money(VICTORY_CASH)} and a vehicle still on the road {DECLARATION_TURNS} turns later.
      </p>

      {/* The haulage exchange. Investments, never a second way to win — the ten shares above stay
          the only route to the company, so the endgame is untouched. */}
      {stocksOn && (
        <div style={ledger}>
          <span style={{ color: UI.textFaint, letterSpacing: '0.12em', fontSize: '0.6rem' }}>
            THE HAULAGE EXCHANGE
          </span>
          {STOCK_IDS.map(id => {
            const co = COMPANIES[id];
            const price = state.stockPrices?.[id] ?? co.base;
            const held = haulier.holdings?.[id] ?? 0;
            const trend = standing(price, co.base);
            return (
              <span key={id} style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                <span
                  style={{ minWidth: '9.5rem', color: UI.text }}
                  title={`${co.blurb} Opens at ${money(co.base)}; moves with cargo landed in its region.`}
                >
                  {co.name}
                </span>
                <span
                  style={{
                    color: trend === 'high' ? UI.warn : trend === 'low' ? UI.verdigris : UI.textSoft,
                    minWidth: '3.2rem',
                  }}
                >
                  {money(price)}
                  {trend === 'high' ? ' ▲' : trend === 'low' ? ' ▼' : ''}
                </span>
                <span style={{ color: UI.textFaint, minWidth: '3.5rem' }}>
                  {held > 0 ? `${held} held` : '—'}
                </span>
                <Button
                  disabled={!enabled || haulier.cash < price}
                  title={`Buy one at ${money(price)}. It is worth having when the price is under ${money(
                    co.base,
                  )} and the cards are about to send everyone that way.`}
                  onClick={() => dispatch({ type: 'BUY_STOCK', stock: id, lots: 1 })}
                >
                  Buy
                </Button>
                <Button
                  tone="quiet"
                  disabled={!enabled || held <= 0}
                  onClick={() => dispatch({ type: 'SELL_STOCK', stock: id, lots: held })}
                >
                  Sell{held > 1 ? ` all ${held}` : ''}
                </Button>
              </span>
            );
          })}
        </div>
      )}

      {/* The running costs, and what can be done about them. Shown above the share market because a
          haulier in arrears has no business buying shares. */}
      {(wagesOn || loansOn) && (
        <div style={ledger}>
          {wagesOn && (
            <span>
              Wages next round{' '}
              <strong style={{ color: UI.text }}>{money(wagesFor(fleetSize, ladenSlots))}</strong>
              <span style={{ color: UI.textFaint }}>
                {' '}
                ({fleetSize} vehicle{fleetSize === 1 ? '' : 's'}, {ladenSlots} laden)
              </span>
            </span>
          )}
          {arrears > 0 && (
            <span style={{ color: UI.bad }}>
              <strong>{money(arrears)} in arrears</strong> — it comes off the top next round
            </span>
          )}
          {loansOn && debt > 0 && (
            <span style={{ color: UI.warn }}>
              {money(debt)} owed, {money(Math.ceil(debt * LOAN_INTEREST_PER_ROUND))} interest a round
            </span>
          )}
        </div>
      )}

      {loansOn && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <Button
            disabled={!enabled || debt + LOAN_STEP > ceiling}
            title={
              ceiling === 0
                ? 'The bank lends against vehicles and shares, and you have nothing to pledge.'
                : `Draws ${money(LOAN_STEP)} now against your vehicles and shares. Interest of ` +
                  `${loanRateLabel()} a round accrues on the whole ` +
                  `balance, and the debt counts against you if a claim is settled on assets. ` +
                  `Your ceiling is ${money(ceiling)}.`
            }
            onClick={() => dispatch({ type: 'TAKE_LOAN' })}
          >
            Borrow {money(LOAN_STEP)}
          </Button>
          <Button
            tone="quiet"
            disabled={!enabled || debt <= 0 || haulier.cash <= 0}
            onClick={() => dispatch({ type: 'REPAY_LOAN' })}
          >
            Repay {money(Math.min(debt, LOAN_STEP, haulier.cash))}
          </Button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <Button disabled={!enabled || !canBuyShare} onClick={() => dispatch({ type: 'BUY_SHARE' })}>
          {bankHasShares
            ? `Take up a share — ${money(sharePrice)}`
            : buyoutTarget
              ? `Buy out ${buyoutTarget.name} — ${money(sharePrice)}`
              : 'No share to be had'}
        </Button>

        {bidsEnabled && bidTarget && (
          <Button
            disabled={!enabled || !canBid}
            title={
              haulier.shares >= SHARE_MAJORITY
                ? 'You already hold a majority — declare instead.'
                : haulier.cash < bidPrice
                  ? `A bid costs ${money(bidPrice)} and you hold ${money(haulier.cash)}.`
                  : `Takes one share off ${bidTarget.name} whatever your own holding. Dearer the ` +
                    `more you already hold, and every bid anyone makes doubles the price for ` +
                    `everyone after — both compound, so your next would cost ${money(
                      hostileBidPrice(bidsMade + 1, haulier.shares + 1),
                    )}.`
            }
            onClick={() => dispatch({ type: 'HOSTILE_BID', targetId: bidTarget.id })}
          >
            Bid for {bidTarget.name}'s share — {money(bidPrice)}
          </Button>
        )}

        <Button
          tone="quiet"
          disabled={!enabled || haulier.shares === 0}
          title={`The bank pays half. Use it when you cannot afford a cargo.`}
          onClick={() => dispatch({ type: 'SELL_SHARE' })}
        >
          Surrender a share — {money(buyback)}
        </Button>

        {(classesOn ? (Object.keys(VEHICLE_CLASSES) as VehicleClassId[]) : [DEFAULT_VEHICLE_CLASS]).map(
          id => {
            const option = VEHICLE_CLASSES[id];
            return (
              <Button
                key={id}
                disabled={!enabled || fleetSize >= MAX_VEHICLES || haulier.cash < option.price}
                title={
                  fleetSize >= MAX_VEHICLES
                    ? `No haulier may run more than ${MAX_VEHICLES} vehicles`
                    : `${option.blurb} ${option.slots} slots, ${
                        option.speed === 0
                          ? 'no speed penalty'
                          : `${option.speed} to every roll`
                      }${option.fittings?.tracker ? ', built with a tracker' : ''}. She fits out at ${depotName(
                        HOME_DEPOT,
                      )}.`
                }
                onClick={() => dispatch({ type: 'BUY_VEHICLE', vehicleClass: id })}
              >
                {classesOn ? option.name : 'Buy a vehicle'} — {money(option.price)}
                {classesOn && (
                  <span style={{ color: UI.textFaint }}>
                    {' '}
                    {option.slots} slots{option.speed !== 0 ? `, ${option.speed}` : ""}
                  </span>
                )}
              </Button>
            );
          },
        )}
      </div>

      {!bankHasShares && (
        <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
          The bank's ten are all out. A share now costs {SHARE_RAID_MULTIPLIER}×{' '}
          {sabotage
            ? '— and while the countdown runs you may buy one off anyone, including the leader.'
            : 'and can only be bought off a haulier holding no more than you do.'}
          {bidsEnabled && !sabotage && (
            <>
              {' '}
              Falling behind is not the end of it: a <strong style={{ color: UI.text }}>bid</strong>{' '}
              takes a share off anyone at all, and costs least when you hold least.
            </>
          )}
        </p>
      )}

      {/* The standing position, so the route to a win is never something you have to work out. */}
      {bidsEnabled && !canDeclare && (
        <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
          You hold {haulier.shares} of {TOTAL_SHARES}; {bidTarget?.name ?? 'no rival'} leads on{' '}
          {bidTarget?.shares ?? 0}. {bidsMade === 0 ? 'No bid' : `${bidsMade} bid${bidsMade === 1 ? '' : 's'}`}{' '}
          made so far, so the next costs {money(bidPrice)}.
        </p>
      )}

      {canDeclare && (
        <div style={{ borderTop: `1px solid ${UI.rule}`, paddingTop: '0.55rem' }}>
          <Button tone="primary" disabled={!enabled} onClick={() => dispatch({ type: 'DECLARE' })}>
            Declare a majority
          </Button>
          <p style={{ ...bodySmall, fontSize: '0.75rem', margin: '0.4rem 0 0', color: UI.warn }}>
            {DECLARATION_TURNS} turns from the declaration the books close. You must still hold{' '}
            {SHARE_MAJORITY} shares, {money(VICTORY_CASH)} and a vehicle, or the claim lapses and
            trading goes on.
          </p>
        </div>
      )}

      <p style={{ ...dataText, fontSize: '0.7rem', margin: 0, color: UI.textFaint }}>
        Bank holds {state.sharesRemaining} · you hold {haulier.shares} · {fleetSize}/{MAX_VEHICLES} vehicles
      </p>

      {/* --- Fitting out ------------------------------------------------------------------ */}
      {(state.hazards?.weather || state.hazards?.theft) && (
        <div style={{ borderTop: `1px solid ${UI.rule}`, paddingTop: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          <Label>Fitting out</Label>
          {vehicles.length === 0 ? (
            <p style={{ ...bodySmall, margin: 0, color: UI.textFaint }}>No vehicles.</p>
          ) : (
            vehicles.map(vehicle => {
              const parked = vehicle.location !== null;
              // What the underwriters would be covering, and therefore what they would charge.
              const holdValue = vehicle.hold.reduce((n, lot) => n + lot.paid, 0);
              return (
                <div key={vehicle.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ ...dataText, fontSize: '0.7rem', color: UI.textSoft }}>
                    {vehicle.name}
                    {!parked && ' — on the road'}
                  </span>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {state.hazards?.weather && (
                      <Button
                        disabled={!enabled || !parked || Boolean(vehicle.fittings?.aeroKit) || haulier.cash < FITTING_PRICES.aeroKit}
                        title="A well-kept rig loses less: a point of speed always, and less ground lost to heavy weather."
                        onClick={() => dispatch({ type: 'BUY_FITTING', vehicleId: vehicle.id, fitting: 'aeroKit' })}
                      >
                        {vehicle.fittings?.aeroKit ? '✓ Serviced' : `AeroKit — ${money(FITTING_PRICES.aeroKit)}`}
                      </Button>
                    )}
                    {state.hazards?.theft && (
                      <>
                        <Button
                          disabled={!enabled || !parked || Boolean(vehicle.fittings?.tracker) || haulier.cash < FITTING_PRICES.tracker}
                          title="Tracker halve the chance of being troubled, and talk most boarders down to a ransom."
                          onClick={() => dispatch({ type: 'BUY_FITTING', vehicleId: vehicle.id, fitting: 'tracker' })}
                        >
                          {vehicle.fittings?.tracker ? '✓ Armed' : `Tracker — ${money(FITTING_PRICES.tracker)}`}
                        </Button>
                        <Button
                          tone={vehicle.insured ? 'default' : 'quiet'}
                          disabled={!enabled}
                          title={
                            `A cargo policy: premium taken at each dispatch, scaled by what she is ` +
                            `carrying and how theft-prone the route. Covers goods taken and ransoms ` +
                            `paid, never lost time. An empty vehicle costs nothing and is covered for ` +
                            `nothing.` +
                            (vehicle.hold.length === 0
                              ? ' She is light, so no premium would fall due.'
                              : ` As laden, a calm passage would cost about ${money(
                                  insurancePremium(holdValue, 0),
                                )} and a theft-prone one about ${money(insurancePremium(holdValue, 1))}.`)
                          }
                          onClick={() =>
                            dispatch({ type: 'SET_INSURANCE', vehicleId: vehicle.id, insured: !vehicle.insured })
                          }
                        >
                          {vehicle.insured ? '✓ Insured' : 'Insure her'}
                          {holdValue > 0 && (
                            <span style={{ color: UI.textFaint }}>
                              {' '}
                              — {money(insurancePremium(holdValue, 0))}–
                              {money(insurancePremium(holdValue, 1))} a passage
                            </span>
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <p style={{ ...bodySmall, fontSize: '0.74rem', margin: 0, color: UI.textFaint }}>
            Fittings are permanent and fitted in depot. A policy can be opened or closed at any time.
          </p>
        </div>
      )}
    </Panel>
  );
}

const ledger: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2rem',
  padding: '0.4rem 0.55rem',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  fontFamily: FONT.data,
  fontSize: '0.7rem',
  color: UI.textSoft,
};
