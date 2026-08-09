import {
  DECLARATION_TURNS,
  FITTING_PRICES,
  MAX_SHIPS,
  SHARE_MAJORITY,
  shareBuybackFor,
  sharePriceFor,
  SHARE_RAID_MULTIPLIER,
  SHIP_PRICE,
  TOTAL_SHARES,
  VICTORY_CASH,
  canBuyOut,
} from '../sim/rules';
import { HOME_PORT, portName } from '../sim/content';
import { UI, money } from '../theme';
import { Button, Label, Panel, bodySmall, dataText } from './ui';
import type { Captain, GameAction, GameState, Ship } from '../sim/types';

interface Props {
  state: GameState;
  captain: Captain;
  fleetSize: number;
  dispatch: (action: GameAction) => void;
  enabled: boolean;
  /** The captain's own ships, so fittings can be bought for whichever is in port. */
  ships: Ship[];
}

/**
 * Shares, ships and the claim to the company. Everything here is how a captain converts a good
 * trading season into an actual win, which is a separate skill from running cargo well.
 */
export default function CountingHouse({ state, captain, fleetSize, dispatch, enabled, ships }: Props) {
  const bankHasShares = state.sharesRemaining > 0;
  const sharePrice = bankHasShares
    ? sharePriceFor(state.sharesRemaining)
    : sharePriceFor(0) * SHARE_RAID_MULTIPLIER;
  // During the countdown anyone may buy off anyone — the source's sabotage window.
  const sabotage = state.declaration !== null;

  const buyoutTarget = state.captains
    .filter(c => c.id !== captain.id && c.shares > 0 && canBuyOut(captain.shares, c.shares, sabotage))
    .sort((a, b) =>
      sabotage
        ? b.shares - a.shares || state.captains.indexOf(a) - state.captains.indexOf(b)
        : a.shares - b.shares || state.captains.indexOf(a) - state.captains.indexOf(b),
    )[0];

  const canBuyShare = bankHasShares
    ? captain.cash >= sharePrice
    : Boolean(buyoutTarget) && captain.cash >= sharePrice;

  const canDeclare = captain.shares >= SHARE_MAJORITY && !state.declaration;
  const buyback = shareBuybackFor(state.sharesRemaining);

  return (
    <Panel
      title="Counting house"
      aside={
        <Label>
          {captain.shares}/{TOTAL_SHARES} shares
        </Label>
      }
    >
      <p style={{ ...bodySmall, margin: 0 }}>
        To carry the company you need {SHARE_MAJORITY} of the {TOTAL_SHARES} shares, then{' '}
        {money(VICTORY_CASH)} and a ship still afloat {DECLARATION_TURNS} turns later.
      </p>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <Button disabled={!enabled || !canBuyShare} onClick={() => dispatch({ type: 'BUY_SHARE' })}>
          {bankHasShares
            ? `Take up a share — ${money(sharePrice)}`
            : buyoutTarget
              ? `Buy out ${buyoutTarget.name} — ${money(sharePrice)}`
              : 'No share to be had'}
        </Button>

        <Button
          tone="quiet"
          disabled={!enabled || captain.shares === 0}
          title={`The bank pays half. Use it when you cannot afford a cargo.`}
          onClick={() => dispatch({ type: 'SELL_SHARE' })}
        >
          Surrender a share — {money(buyback)}
        </Button>

        <Button
          disabled={!enabled || fleetSize >= MAX_SHIPS || captain.cash < SHIP_PRICE}
          title={
            fleetSize >= MAX_SHIPS
              ? `No captain may run more than ${MAX_SHIPS} ships`
              : `She fits out at ${portName(HOME_PORT)}`
          }
          onClick={() => dispatch({ type: 'BUY_SHIP' })}
        >
          Buy a clipper — {money(SHIP_PRICE)}
        </Button>
      </div>

      {!bankHasShares && (
        <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
          The bank's ten are all out. A share now costs {SHARE_RAID_MULTIPLIER}×{' '}
          {sabotage
            ? '— and while the countdown runs you may buy one off anyone, including the leader.'
            : 'and can only be bought off a captain holding no more than you do.'}
        </p>
      )}

      {canDeclare && (
        <div style={{ borderTop: `1px solid ${UI.rule}`, paddingTop: '0.55rem' }}>
          <Button tone="primary" disabled={!enabled} onClick={() => dispatch({ type: 'DECLARE' })}>
            Declare a majority
          </Button>
          <p style={{ ...bodySmall, fontSize: '0.75rem', margin: '0.4rem 0 0', color: UI.warn }}>
            {DECLARATION_TURNS} turns from the declaration the books close. You must still hold{' '}
            {SHARE_MAJORITY} shares, {money(VICTORY_CASH)} and a ship, or the claim lapses and
            trading goes on.
          </p>
        </div>
      )}

      <p style={{ ...dataText, fontSize: '0.7rem', margin: 0, color: UI.textFaint }}>
        Bank holds {state.sharesRemaining} · you hold {captain.shares} · {fleetSize}/{MAX_SHIPS} ships
      </p>

      {/* --- Fitting out ------------------------------------------------------------------ */}
      {(state.hazards?.weather || state.hazards?.piracy) && (
        <div style={{ borderTop: `1px solid ${UI.rule}`, paddingTop: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          <Label>Fitting out</Label>
          {ships.length === 0 ? (
            <p style={{ ...bodySmall, margin: 0, color: UI.textFaint }}>No ships.</p>
          ) : (
            ships.map(ship => {
              const docked = ship.location !== null;
              return (
                <div key={ship.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ ...dataText, fontSize: '0.7rem', color: UI.textSoft }}>
                    {ship.name}
                    {!docked && ' — at sea'}
                  </span>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {state.hazards?.weather && (
                      <Button
                        disabled={!enabled || !docked || Boolean(ship.fittings?.copper) || captain.cash < FITTING_PRICES.copper}
                        title="Coppered hulls foul less: a point of speed always, and less ground lost to heavy weather."
                        onClick={() => dispatch({ type: 'BUY_FITTING', shipId: ship.id, fitting: 'copper' })}
                      >
                        {ship.fittings?.copper ? '✓ Coppered' : `Copper — ${money(FITTING_PRICES.copper)}`}
                      </Button>
                    )}
                    {state.hazards?.piracy && (
                      <>
                        <Button
                          disabled={!enabled || !docked || Boolean(ship.fittings?.guns) || captain.cash < FITTING_PRICES.guns}
                          title="Guns halve the chance of being troubled, and talk most boarders down to a ransom."
                          onClick={() => dispatch({ type: 'BUY_FITTING', shipId: ship.id, fitting: 'guns' })}
                        >
                          {ship.fittings?.guns ? '✓ Armed' : `Guns — ${money(FITTING_PRICES.guns)}`}
                        </Button>
                        <Button
                          tone={ship.insured ? 'default' : 'quiet'}
                          disabled={!enabled}
                          title="An open policy: every voyage covered, premium taken at cast-off. Covers goods taken and ransoms paid — never lost time."
                          onClick={() =>
                            dispatch({ type: 'SET_INSURANCE', shipId: ship.id, insured: !ship.insured })
                          }
                        >
                          {ship.insured ? '✓ Insured' : 'Insure her'}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <p style={{ ...bodySmall, fontSize: '0.74rem', margin: 0, color: UI.textFaint }}>
            Fittings are permanent and fitted in port. A policy can be opened or closed at any time.
          </p>
        </div>
      )}
    </Panel>
  );
}
