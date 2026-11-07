/**
 * How to play, as a page rather than a wall of tooltips.
 *
 * **Every number here is read from `sim/rules.ts`.** That is the whole reason this file is worth
 * having rather than a paragraph of prose in a README: the constants in this engine have been
 * retuned repeatedly, and a page with a wage rate hardcoded into it would be lying to players
 * within the hour. If a rule changes, this page changes with it.
 *
 * Two numbers in particular are read rather than written out, because this is a fork of The Tea
 * Race and they are the two that differ: the default rig carries **two** pallets where the clipper
 * carried three, and the home depot stocks **nothing**, so every opening move is a run out empty.
 * Both are read from content and rules here so the page cannot drift back to its parent's answers.
 *
 * Structured as the questions a new haulier actually asks, in the order they ask them, and it says
 * plainly which parts are the base ruleset and which are optional extras that may not be switched
 * on in the game they are about to play.
 */

import { Link } from 'react-router-dom';
import {
  CONTRACT_LIFE_ROUNDS,
  DECLARATION_TURNS,
  DEFAULT_VEHICLE_CLASS,
  DIFFICULTIES,
  FACE_UP_CONTRACTS,
  FITTING_PRICES,
  LOAN_INTEREST_PER_ROUND,
  MAX_VEHICLES,
  PAYOUT_MULTIPLIERS,
  PRESETS,
  SHARE_MAJORITY,
  STARTING_CASH,
  TOTAL_SHARES,
  VEHICLE_CLASSES,
  VEHICLE_PRICE,
  VICTORY_CASH,
  WAGES_PER_LADEN_SLOT,
  WAGES_PER_VEHICLE,
  hostileBidPrice,
  sharePriceFor,
  slotsOf,
} from '../sim/rules';
import { DEPOT_BY_ID, HOME_DEPOT, depotName } from '../sim/content';
import { BOUNTY_PER_UNIT, GLUT_FACTOR, SHORTAGE_FACTOR } from '../sim/events';
import { PRICE_CEILING, PRICE_FLOOR } from '../sim/pricing';
import { FONT, UI, money } from '../theme';
import PortalNav from '../components/PortalNav';
import { Button, Label, Panel, bodySmall } from '../components/ui';

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** What the lorry you are given actually carries, rather than what her parent ship carried. */
const STARTING_SLOTS = slotsOf(DEFAULT_VEHICLE_CLASS);
/** The home depot stocks nothing, which is the single fact that shapes every opening turn. */
const HOME_STOCKS = DEPOT_BY_ID[HOME_DEPOT]?.supplies.length ?? 0;

export default function Tutorial() {
  return (
    <div style={page}>
      <PortalNav />

      <header style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <Label>How to play</Label>
        <h1 style={title}>Steady Eddie</h1>
        <p style={{ ...bodySmall, maxWidth: '68ch', margin: 0 }}>
          You run a haulage firm. Buy a load where it is cheap, deliver it where somebody wants it,
          and turn the profit into shares of your own firm. Hold enough of those shares and the firm
          is yours.
        </p>
      </header>

      <Panel title="The short version">
        <ol style={list}>
          <li>
            <strong>{FACE_UP_CONTRACTS} contracts</strong> are posted at all times. Each names a
            load, a depot that wants it, and a price.
          </li>
          <li>
            <strong>Only the first two lorries in are paid.</strong> First delivery takes{' '}
            {PAYOUT_MULTIPLIERS[1]}× the contract price a pallet, second takes{' '}
            {PAYOUT_MULTIPLIERS[2]}×, and everybody after that takes nothing. It is a race, not a
            delivery job.
          </li>
          <li>
            <strong>Buy the load wherever you like.</strong> A contract names the consignee, never
            the supplier — sourcing is your decision.
          </li>
          <li>
            <strong>Turn the money into shares.</strong> Hold {SHARE_MAJORITY} of the {TOTAL_SHARES},
            declare, and still hold {money(VICTORY_CASH)} and a vehicle on the road{' '}
            {DECLARATION_TURNS} turns later. That is the game.
          </li>
        </ol>
      </Panel>

      <Panel title="Your first few turns">
        <p style={para}>
          You start at {depotName(HOME_DEPOT)} with one lorry and {money(STARTING_CASH)}. A turn is
          three steps and you can stop after any of them.
        </p>
        <ol style={list}>
          <li>
            <strong>Roll for the day.</strong> Every vehicle gets her own two dice, and any vehicle
            already on the road moves the moment you roll — you do not steer her again.
          </li>
          <li>
            <strong>Work the depot.</strong> A vehicle at a depot can load, deliver a contract, sell
            a load off, or be fitted out. Her bed takes{' '}
            <strong>
              {STARTING_SLOTS} pallet{STARTING_SLOTS === 1 ? '' : 's'}
            </strong>
            , and pallets of the same good delivered together are paid for one by one. Filling the
            bed with a single load is usually the strongest move in the game.
          </li>
          <li>
            <strong>Plan the run.</strong> Click a depot on the map. She drives her miles towards it
            and carries on next turn.
          </li>
        </ol>
        {HOME_STOCKS === 0 && (
          <p style={{ ...para, color: UI.brass }}>
            One thing that catches everybody on turn one: {depotName(HOME_DEPOT)} is a distribution
            hub, not a producer. It stocks <strong>nothing</strong>. Your first move is always a run
            out empty to wherever the load actually is — read the board first, then drive to the
            supplier, not to the customer.
          </p>
        )}
        <p style={{ ...para, color: UI.brass }}>
          If a vehicle is left parked with her dice unspent, the end-turn button will stop and tell
          you before you waste the roll.
        </p>
        <p style={para}>
          You do not have to take any of this on trust. Start a game and the walkthrough offers
          itself on the opening turn: it points at the control you want next, waits until you use it,
          and works through a real first run on the board you were actually dealt. It is reachable
          afterwards from <strong>Walk me through a turn</strong> in the game's header, for as long
          as the position still fits.
        </p>
      </Panel>

      <Panel title="The mistakes that cost the most">
        <ul style={list}>
          <li>
            <strong>Chasing a contract a rival will reach first.</strong> Second money is half of
            first, and third is nothing. Check who is already carrying that load — every bed on the
            board is public.
          </li>
          <li>
            <strong>Filling the bed with something nobody wants.</strong> A full bed cannot take the
            good load when it appears. Dumping recovers <strong>nothing at all</strong>; if depot
            sales are on you can at least take a loss instead.
          </li>
          <li>
            <strong>Spending down to nothing.</strong> Below the price of the cheapest pallet you
            cannot trade, and cannot earn your way out. Keep a working float.
          </li>
          <li>
            <strong>Buying shares too late.</strong> The bank's {TOTAL_SHARES} get dearer as they go
            — the first costs {money(sharePriceFor(TOTAL_SHARES))} and the last{' '}
            {money(sharePriceFor(1))}. Once they are gone, shares only change hands between
            hauliers.
          </li>
        </ul>
      </Panel>

      <Panel title="Optional rules" aside={<Label>{Object.keys(PRESETS).length} preset games</Label>}>
        <p style={para}>
          Everything above is the base ruleset. Everything below is optional and switched on in the
          lobby — the four presets are the quick way in, and each is a <em>different kind</em> of
          game rather than more or less of the same one.
        </p>
        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map(key => (
            <div key={key}>
              <dt style={term}>{PRESETS[key].label}</dt>
              <dd style={{ ...para, margin: '0.1rem 0 0 0' }}>{PRESETS[key].blurb}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title="What the optional rules actually do">
        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <Rule name="Road and weather">
            A seasonal forecast, so the quick way round changes through the year. Fog, snow and
            flooding cost time on the legs authored for them, and never cost you the load.
          </Rule>
          <Rule name="Load theft">
            Losses, and occasionally the whole bed, on the corridors authored for it. A tracker
            halves the chance and turns most losses into a recovery. Insurance is a <em>cargo</em>{' '}
            policy: an empty bed costs nothing and is covered for nothing, and the premium scales
            with what is aboard and how bad the route is. Worth buying for a full bed on a bad run
            and a poor buy otherwise.
          </Rule>
          <Rule name="World events">
            Strikes shut a depot to all trade. Bans stop a good being loaded anywhere. A glut pays ×
            {GLUT_FACTOR}, a shortage ×{SHORTAGE_FACTOR}, and a bounty pays {money(BOUNTY_PER_UNIT)}{' '}
            a pallet over the market. Everything expires.
          </Rule>
          <Rule name="Per-depot prices">
            Always on. Each depot sets its own price, between {pct(PRICE_FLOOR)} and{' '}
            {pct(PRICE_CEILING)} of the contract's reckoning. You are paid on the{' '}
            <strong>contract's</strong> price, so buying cheap is the margin.
          </Rule>
          <Rule name="Driver wages and diesel">
            {money(WAGES_PER_VEHICLE)} a vehicle every round, plus {money(WAGES_PER_LADEN_SLOT)} for
            every laden pallet. Cash stops being a score and becomes a constraint. If you cannot pay
            you fall into arrears, which come off the top of what you earn next round — nobody goes
            bust, but a broke haulier's next delivery is not really theirs.
          </Rule>
          <Rule name="Loans">
            Borrow against your fleet and shares at {pct(LOAN_INTEREST_PER_ROUND)} a round. Useful
            through a bad season. What you owe counts against you if a claim is settled on assets.
          </Rule>
          <Rule name="Hostile bids">
            Buy a share off anyone, the leader included, whatever your own holding. Cheapest when you
            hold least — a first bid from nothing costs {money(hostileBidPrice(0, 0))} — and every
            bid anyone makes doubles the price for everyone after. This is the way back in if you
            fall behind, and it runs out fast.
          </Rule>
          <Rule name="Vehicle classes">
            {Object.values(VEHICLE_CLASSES)
              .map(c => c.name)
              .join(', ')}{' '}
            instead of one rig repeated. Up to {MAX_VEHICLES} vehicles, from {money(VEHICLE_PRICE)}.
            The artic's extra slot costs both money and time: she is dearer than either of the others
            and slower off the line than both, so capacity is the only thing she wins on. Fittings
            run to {money(FITTING_PRICES.tracker)} for a tracker and {money(FITTING_PRICES.aeroKit)}{' '}
            for an aero kit.
          </Rule>
          <Rule name="Contracts expire">
            Cards come off the board after {CONTRACT_LIFE_ROUNDS} rounds if nobody fills them, and a
            load loses value the longer it sits on the bed. Counter-intuitively this makes for the{' '}
            <em>shortest</em> games.
          </Rule>
          <Rule name="The haulage exchange">
            Rival firms whose prices rise and fall with the trade actually run through their regions.
            Not another way to win — somewhere for money to go, and a market to read. If you can see
            where the contracts are sending everyone, you can see which firm is about to move.
          </Rule>
        </dl>
      </Panel>

      <Panel title="If you keep losing">
        <p style={para}>Two dials, and the second matters more than people expect.</p>
        <ul style={list}>
          <li>
            <strong>How well the rivals play.</strong>{' '}
            {(Object.keys(DIFFICULTIES) as (keyof typeof DIFFICULTIES)[])
              .map(k => DIFFICULTIES[k].label)
              .join(', ')}
            . Every handicap is knowledge and discipline — a gentle haulier ignores the forecast and
            does not watch her rivals. <strong>They never roll better than you do.</strong>
          </li>
          <li>
            <strong>How many rivals.</strong> Against three opponents, one of <em>them</em> takes the
            firm three times in four even when everybody plays equally well. If you are losing most
            games that is arithmetic before it is skill. Play one or two rivals first.
          </li>
        </ul>
      </Panel>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Button tone="primary">Set up a run →</Button>
        </Link>
      </div>

      <PortalNav />
    </div>
  );
}

function Rule({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt style={term}>{name}</dt>
      <dd style={{ ...para, margin: '0.1rem 0 0 0' }}>{children}</dd>
    </div>
  );
}

const page: React.CSSProperties = {
  maxWidth: '52rem',
  margin: '0 auto',
  padding: '1.2rem 1rem 2.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

const title: React.CSSProperties = {
  fontFamily: FONT.display,
  fontSize: '2rem',
  margin: 0,
  color: UI.text,
};

const para: React.CSSProperties = {
  ...bodySmall,
  margin: 0,
  maxWidth: '68ch',
};

const list: React.CSSProperties = {
  ...bodySmall,
  margin: 0,
  paddingLeft: '1.2rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  maxWidth: '68ch',
};

const term: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.66rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: UI.brass,
};
