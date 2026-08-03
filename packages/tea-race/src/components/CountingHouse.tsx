import {
  MAX_SHIPS,
  SHARE_BUYBACK_FRACTION,
  SHARE_MAJORITY,
  SHARE_PRICE,
  SHARE_RAID_MULTIPLIER,
  SHIP_PRICE,
  TOTAL_SHARES,
  VICTORY_CASH,
  canBuyOut,
} from '../sim/rules';
import { HOME_PORT, portName } from '../sim/content';
import { UI, money } from '../theme';
import { Button, Label, Panel, bodySmall, dataText } from './ui';
import type { Captain, GameAction, GameState } from '../sim/types';

interface Props {
  state: GameState;
  captain: Captain;
  fleetSize: number;
  dispatch: (action: GameAction) => void;
  enabled: boolean;
}

/**
 * Shares, ships and the claim to the company. Everything here is how a captain converts a good
 * trading season into an actual win, which is a separate skill from running cargo well.
 */
export default function CountingHouse({ state, captain, fleetSize, dispatch, enabled }: Props) {
  const bankHasShares = state.sharesRemaining > 0;
  const sharePrice = bankHasShares ? SHARE_PRICE : SHARE_PRICE * SHARE_RAID_MULTIPLIER;

  const buyoutTarget = state.captains
    .filter(c => c.id !== captain.id && c.shares > 0 && canBuyOut(captain.shares, c.shares))
    .sort((a, b) => a.shares - b.shares || state.captains.indexOf(a) - state.captains.indexOf(b))[0];

  const canBuyShare = bankHasShares
    ? captain.cash >= sharePrice
    : Boolean(buyoutTarget) && captain.cash >= sharePrice;

  const canDeclare = captain.shares >= SHARE_MAJORITY && !state.declaration;
  const buyback = Math.floor(SHARE_PRICE * SHARE_BUYBACK_FRACTION);

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
        {money(VICTORY_CASH)} and a ship still afloat twelve rounds later.
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
          The bank's ten are all out. A share now costs {SHARE_RAID_MULTIPLIER}× and can only be
          bought off a captain holding no more than you do.
        </p>
      )}

      {canDeclare && (
        <div style={{ borderTop: `1px solid ${UI.rule}`, paddingTop: '0.55rem' }}>
          <Button tone="primary" disabled={!enabled} onClick={() => dispatch({ type: 'DECLARE' })}>
            Declare a majority
          </Button>
          <p style={{ ...bodySmall, fontSize: '0.75rem', margin: '0.4rem 0 0', color: UI.warn }}>
            Twelve rounds from the declaration the books close. You must still hold{' '}
            {SHARE_MAJORITY} shares, {money(VICTORY_CASH)} and a ship, or the claim lapses and
            trading goes on.
          </p>
        </div>
      )}

      <p style={{ ...dataText, fontSize: '0.7rem', margin: 0, color: UI.textFaint }}>
        Bank holds {state.sharesRemaining} · you hold {captain.shares} · {fleetSize}/{MAX_SHIPS} ships
      </p>
    </Panel>
  );
}
