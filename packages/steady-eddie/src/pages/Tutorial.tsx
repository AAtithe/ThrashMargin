/**
 * How to play, as a page rather than a wall of tooltips.
 *
 * **Every number here is read from `sim/rules.ts`.** That is the whole reason this file is worth
 * having rather than a paragraph of prose in a README: the constants in this game have been
 * retuned repeatedly, and a page with a wage rate hardcoded into it would be lying to players
 * within the hour. If a rule changes, this page changes with it.
 *
 * Structured as the questions a new haulier actually asks, in the order they ask them, and it says
 * plainly which parts are the base ruleset and which are optional extras that may not be switched
 * on in the game they are about to play.
 *
 * The companion to this page is the guided run in `components/GuidedTour.tsx`, which teaches the
 * same loop by making the player drive it. This page is the reference; that is the lesson.
 */

import { Link } from 'react-router-dom';
import {
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
  VEHICLE_PRICE,
  VICTORY_CASH,
  WAGES_PER_VEHICLE,
  hostileBidPrice,
  sharePriceFor,
  slotsOf,
} from '../sim/rules';
import { GLUT_FACTOR, SHORTAGE_FACTOR } from '../sim/events';
import { PRICE_CEILING, PRICE_FLOOR } from '../sim/pricing';
import { FONT, UI, money } from '../theme';
import PortalNav from '../components/PortalNav';
import { Button, Label, Panel, bodySmall } from '../components/ui';

const pct = (n: number) => `${Math.round(n * 100)}%`;

const BAY_SLOTS = slotsOf(DEFAULT_VEHICLE_CLASS);

export default function Tutorial() {
  return (
    <div style={page}>
      <PortalNav />

      <header style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <Label>How to play</Label>
        <h1 style={title}>Steady Eddie</h1>
        <p style={{ ...bodySmall, maxWidth: '68ch', margin: 0 }}>
          You run a haulage firm. Buy cargo where it is cheap, run it to somebody who wants it, and
          turn the profit into shares of your own company. Hold enough of those shares and the firm
          is yours.
        </p>
      </header>

      <Panel title="The short version">
        <ol style={list}>
          <li>
            <strong>{FACE_UP_CONTRACTS} commissions</strong> are posted at all times. Each names a
            cargo, a depot that wants it, and a price.
          </li>
          <li>
            <strong>Only the first two home are paid.</strong> First in takes{' '}
            {PAYOUT_MULTIPLIERS[1]}× the commission price a lot, second takes{' '}
            {PAYOUT_MULTIPLIERS[2]}×, and everybody after that takes nothing. It is a race, not a
            delivery job.
          </li>
          <li>
            <strong>Buy the cargo wherever you like.</strong> A commission names the buyer, never the
            supplier — sourcing is your decision, and it is where the margin is.
          </li>
          <li>
            <strong>Turn the money into shares.</strong> Hold {SHARE_MAJORITY} of the {TOTAL_SHARES},
            declare, and hold {money(VICTORY_CASH)} and a vehicle still on the road{' '}
            {DECLARATION_TURNS} turns later. That is the game.
          </li>
        </ol>
      </Panel>

      <Panel title="Your first few turns">
        <p style={para}>
          You start at London with one vehicle and {money(STARTING_CASH)}. A turn is three steps and
          you can stop after any of them. If you would rather be shown than told, start a game and
          press <strong>Guided run</strong> in the header: it walks you through one complete job on
          your own live game, from empty bay to landed commission.
        </p>
        <ol style={list}>
          <li>
            <strong>Roll for the day.</strong> Roll for the whole fleet. Every vehicle gets her own
            two dice, and any vehicle already on the road drives the moment you roll — you do not
            steer her again.
          </li>
          <li>
            <strong>Work the depot.</strong> A vehicle parked up can load, land a commission, sell
            cargo off, or be fitted out. Her bay takes <strong>{BAY_SLOTS} lots</strong>, and three
            lots of the same good landed together pay three times over. Running her full on one
            cargo is usually the strongest move in the game.
          </li>
          <li>
            <strong>Set a route.</strong> Click a depot on the map. She spends her miles towards it
            and carries on next turn.
          </li>
        </ol>
        <p style={{ ...para, color: UI.brass }}>
          Note that <strong>London sells nothing</strong>. Every run starts by driving somewhere to
          pick the load up, which is the first thing the game is teaching you: the card tells you
          who is buying, and finding the cheapest seller within reach is your job, not the card's.
        </p>
        <p style={{ ...para, color: UI.brass }}>
          If a vehicle is left in a depot with her dice unspent, the end-turn button will stop and
          tell you before you waste the roll.
        </p>
      </Panel>

      <Panel title="The mistakes that cost the most">
        <ul style={list}>
          <li>
            <strong>Chasing a commission a rival will reach first.</strong> Second money is half of
            first, and third is nothing. Check who is already carrying that cargo — every bay on the
            board is public.
          </li>
          <li>
            <strong>Filling the bay with something nobody wants.</strong> A clogged vehicle cannot
            take the good cargo when it appears. Tipping it recovers <strong>nothing at all</strong>;
            if depot sales are on you can at least take a loss instead.
          </li>
          <li>
            <strong>Spending down to nothing.</strong> Below the price of the cheapest lot you cannot
            trade, and cannot earn your way out. Keep a working float.
          </li>
          <li>
            <strong>Buying shares too late.</strong> The bank's {TOTAL_SHARES} get dearer as they go —
            the first costs {money(sharePriceFor(TOTAL_SHARES))} and the last{' '}
            {money(sharePriceFor(1))}. Once they are gone, shares only change hands between hauliers.
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
          <Rule name="Weather and the forecast">
            A seasonal forecast, so the quick way round changes through the year. Fog and flood sit
            on particular legs and cost time, never cargo. An aero kit at{' '}
            {money(FITTING_PRICES.aeroKit)} halves the chance of a delay and adds to every roll.
          </Rule>
          <Rule name="Theft">
            Loads go missing off the hard shoulder, and occasionally the whole bay. A tracker at{' '}
            {money(FITTING_PRICES.tracker)} halves the encounters and recovers most of what does go.
            Insurance is a <em>cargo</em> policy: an empty bay costs nothing and is covered for
            nothing, and the premium scales with what she is carrying and how bad the roads are. Worth
            buying for a full bay on a rough run and a poor buy otherwise.
          </Rule>
          <Rule name="World events">
            Strikes shut a depot to all trade. Embargoes stop a good being loaded anywhere. A glut
            pays ×{GLUT_FACTOR}, a shortage ×{SHORTAGE_FACTOR}, and a government contract pays a
            premium a lot. Everything expires.
          </Rule>
          <Rule name="Per-depot prices">
            Always on. Each depot sets its own price, between {pct(PRICE_FLOOR)} and{' '}
            {pct(PRICE_CEILING)} of the commission's reckoning. You are paid on the{' '}
            <strong>commission's</strong> price, so buying cheap is the margin.
          </Rule>
          <Rule name="Driver wages">
            {money(WAGES_PER_VEHICLE)} a vehicle every round, more when laden. Cash stops being a
            score and becomes a constraint. If you cannot pay you fall into arrears, which come off
            the top of what you earn next round — nobody goes bankrupt, but a broke haulier's next
            delivery is not really theirs.
          </Rule>
          <Rule name="Loans">
            Borrow against your vehicles and shares at {pct(LOAN_INTEREST_PER_ROUND)} a round. Useful
            through a bad season. What you owe counts against you if a claim is settled on assets.
          </Rule>
          <Rule name="Hostile bids">
            Buy a share off anyone, the leader included, whatever your own holding. Cheapest when you
            hold least — a first bid from nothing costs {money(hostileBidPrice(0, 0))} — and every bid
            anyone makes doubles the price for everyone after. This is the way back in if you fall
            behind, and it runs out fast.
          </Rule>
          <Rule name="Vehicle classes">
            A quick rigid, a roomy artic and the sizes between, instead of one cab repeated. Up to{' '}
            {MAX_VEHICLES} vehicles, from {money(VEHICLE_PRICE)}. Slots and speed trade off against
            each other, so the right fleet depends on the ruleset you are playing.
          </Rule>
          <Rule name="Commissions expire">
            Cards come off the board if nobody fills them, and cargo loses value the longer it sits in
            the bay. Counter-intuitively this makes for the <em>shortest</em> games.
          </Rule>
          <Rule name="The haulage exchange">
            Three firms whose prices rise and fall with the cargo actually landed on their patch. Not
            another way to win — somewhere for money to go, and a market to read. If you can see where
            the commissions are sending everyone, you can see which firm is about to move.
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
            company three times in four even when everybody plays equally well. If you are losing most
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
