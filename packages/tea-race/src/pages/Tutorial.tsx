/**
 * How to play, as a page rather than a wall of tooltips.
 *
 * **Every number here is read from `sim/rules.ts`.** That is the whole reason this file is worth
 * having rather than a paragraph of prose in the README: the constants in this game have been retuned
 * a dozen times — the wage rate alone moved from £26 to £5 after measurement — and a tutorial with
 * £26 hardcoded into it would have been lying to players within the hour. If a rule changes, this
 * page changes with it.
 *
 * Structured as the questions a new captain actually asks, in the order they ask them, and it says
 * plainly which parts are the published 1988 rules and which are optional extras that may not be
 * switched on in the game they are about to play.
 */

import { Link } from 'react-router-dom';
import {
  DECLARATION_TURNS,
  DIFFICULTIES,
  FACE_UP_CONTRACTS,
  HOLD_SLOTS,
  LOAN_INTEREST_PER_ROUND,
  MAX_SHIPS,
  PAYOUT_MULTIPLIERS,
  PRESETS,
  SHARE_MAJORITY,
  SHIP_PRICE,
  STARTING_CASH,
  TOTAL_SHARES,
  VICTORY_CASH,
  WAGES_PER_SHIP,
  hostileBidPrice,
  sharePriceFor,
  DAMAGE_SPEED_PENALTY,
  REPAIR_PRICE,
  TEA_RACE_PREMIUM,
  TEA_RACE_PURSE,
} from '../sim/rules';
import { AGENT_LADING_DISCOUNT, AGENT_PRICE } from '../sim/agents';
import { GLUT_FACTOR, SHORTAGE_FACTOR } from '../sim/events';
import { PRICE_CEILING, PRICE_FLOOR } from '../sim/pricing';
import { FONT, UI, money } from '../theme';
import PortalNav from '../components/PortalNav';
import { Button, Label, Panel, bodySmall } from '../components/ui';
import { Vignette, type VignetteKind } from '../components/Art';

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function Tutorial() {
  return (
    <div style={page}>
      <PortalNav />

      <header style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <Label>How to play</Label>
        <h1 style={title}>The Tea Race</h1>
        <p style={{ ...bodySmall, maxWidth: '68ch', margin: 0 }}>
          You run a shipping company in the age of the clipper. Buy cargo where it is cheap, land it
          where somebody wants it, and turn the profit into shares of your own company. Carry enough
          of those shares and the company is yours.
        </p>
      </header>

      <Panel title="The short version">
        <ol style={list}>
          <li>
            <strong>{FACE_UP_CONTRACTS} commissions</strong> are posted at all times. Each names a
            cargo, a port that wants it, and a price.
          </li>
          <li>
            <strong>Only the first two ships home are paid.</strong> First landing takes{' '}
            {PAYOUT_MULTIPLIERS[1]}× the commission price a lot, second takes{' '}
            {PAYOUT_MULTIPLIERS[2]}×, and everybody after that takes nothing. It is a race, not a
            delivery job.
          </li>
          <li>
            <strong>Buy the cargo wherever you like.</strong> A commission names the buyer, never the
            seller — sourcing is your decision.
          </li>
          <li>
            <strong>Turn the money into shares.</strong> Hold {SHARE_MAJORITY} of the {TOTAL_SHARES},
            declare, and hold {money(VICTORY_CASH)} and a ship still afloat {DECLARATION_TURNS} turns
            later. That is the game.
          </li>
        </ol>
      </Panel>

      <Panel title="Your first few turns">
        <p style={para}>
          You start at Liverpool with one ship and {money(STARTING_CASH)}. A turn is three steps and
          you can stop after any of them.
        </p>
        <ol style={list}>
          <li>
            <strong>Take the wind.</strong> Roll for the whole fleet. Every ship gets her own two
            dice, and any ship already at sea sails the moment you roll — you do not steer her again.
          </li>
          <li>
            <strong>Work the quay.</strong> A ship in port can load, land a commission, sell cargo
            off, or be fitted out. Her hold takes <strong>{HOLD_SLOTS} lots</strong>, and three lots
            of the same good landed together pay three times over. Filling the hull with one cargo is
            usually the strongest move in the game.
          </li>
          <li>
            <strong>Lay off a course.</strong> Click a port on the chart. She spends her points
            towards it and carries on next turn.
          </li>
        </ol>
        <p style={{ ...para, color: UI.brass }}>
          If a ship is left in port with her dice unspent, the end-turn button will stop and tell you
          before you waste the roll.
        </p>
      </Panel>

      <Panel title="The mistakes that cost the most">
        <ul style={list}>
          <li>
            <strong>Chasing a commission a rival will reach first.</strong> Second money is half of
            first, and third is nothing. Check who is already carrying that cargo — every hold on the
            board is public.
          </li>
          <li>
            <strong>Filling the hold with something nobody wants.</strong> A clogged hull cannot take
            the good cargo when it appears. Dumping recovers <strong>nothing at all</strong>; if
            quayside sales are on you can at least take a loss instead.
          </li>
          <li>
            <strong>Spending down to nothing.</strong> Below the price of the cheapest lot you cannot
            trade, and cannot earn your way out. Keep a working float.
          </li>
          <li>
            <strong>Buying shares too late.</strong> The bank's {TOTAL_SHARES} get dearer as they go —
            the first costs {money(sharePriceFor(TOTAL_SHARES))} and the last{' '}
            {money(sharePriceFor(1))}. Once they are gone, shares only change hands between captains.
          </li>
        </ul>
      </Panel>

      <Panel title="Optional rules" aside={<Label>{Object.keys(PRESETS).length} preset games</Label>}>
        <p style={para}>
          Everything above is the published 1988 game. Everything below is optional and switched on in
          the lobby — the four presets are the quick way in, and each is a{' '}
          <em>different kind</em> of game rather than more or less of the same one.
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
          <Rule name="Wind and weather" art="storm">
            A seasonal wind chart, so the fast way round changes through the year. Green chevrons on
            the chart point where the wind is fair. Storms cost time, never cargo.
          </Rule>
          <Rule name="Pirates" art="piracy">
            Ransoms, and occasionally the whole hold. Guns halve the chance and talk most boarders down
            to money. Insurance is a <em>cargo</em> policy: an empty hull costs nothing and is covered
            for nothing, and the premium scales with the cargo aboard and how piratical the route is.
            It is worth buying for a full hold on a dangerous run and a poor buy otherwise.
          </Rule>
          <Rule name="World events" art="event">
            Strikes shut a port to all trade. Embargoes stop a good being loaded anywhere. A glut pays{' '}
            ×{GLUT_FACTOR}, a shortage ×{SHORTAGE_FACTOR}, and an Admiralty bounty pays a premium a
            lot. Everything expires.
          </Rule>
          <Rule name="Per-port prices" art="deliver">
            Always on. Each quay sets its own price, between {pct(PRICE_FLOOR)} and{' '}
            {pct(PRICE_CEILING)} of the commission's reckoning. You are paid on the{' '}
            <strong>commission's</strong> price, so buying cheap is the margin.
          </Rule>
          <Rule name="Crew wages" art="insurance">
            {money(WAGES_PER_SHIP)} a ship every round, more when laden. Cash stops being a score and
            becomes a constraint. If you cannot pay you fall into arrears, which come off the top of
            what you earn next round — nobody goes bankrupt, but a broke captain's next delivery is
            not really theirs.{' '}
            In a hole with nothing aboard, a docked hull can be sold back to the yard for half her
            price (never your last), which pays the arrears first.
          </Rule>
          <Rule name="Loans" art="insurance">
            Borrow against your ships and shares at {pct(LOAN_INTEREST_PER_ROUND)} a round. Useful
            through a bad season. What you owe counts against you if a claim is settled on assets.
          </Rule>
          <Rule name="Hostile bids" art="declare">
            Buy a share off anyone, the leader included, whatever your own holding. Cheapest when you
            hold least — a first bid from nothing costs {money(hostileBidPrice(0, 0))} — and every bid
            anyone makes doubles the price for everyone after. This is the way back in if you fall
            behind, and it runs out fast.
          </Rule>
          <Rule name="Port agents" art="deliver">
            {money(AGENT_PRICE)} for a permanent man at one quay: {pct(AGENT_LADING_DISCOUNT)} off
            everything you lade there, more for anything you sell off there, and word ahead of the
            market. Where you trade becomes a position you hold.
          </Rule>
          <Rule name="Ship classes" art="trader">
            A fast clipper, a roomy barque and an armed Indiaman instead of one hull repeated. Up to{' '}
            {MAX_SHIPS} ships, from {money(SHIP_PRICE)}.
          </Rule>
          <Rule name="Commissions expire" art="contract">
            Cards come off the board if nobody fills them, and cargo loses value the longer it sits in
            the hold. Counter-intuitively this makes for the <em>shortest</em> games.
          </Rule>
          <Rule name="The Great Tea Race" art="teaRace">
            Every summer the new season's tea comes down to Foochow, Shanghai and Hong Kong. Tea
            loaded there while the race is open is marked as the new season's; land it in London and
            the first ship home takes {money(TEA_RACE_PURSE[1])} and {TEA_RACE_PREMIUM[1]}x a lot, the
            second {money(TEA_RACE_PURSE[2])} and {TEA_RACE_PREMIUM[2]}x. It lands itself the moment
            she ties up. Everybody can see it coming, which is the point: it is the one contest the
            whole table plans towards.
          </Rule>
          <Rule name="Cracking on" art="crackOn">
            Once a turn, any ship may be driven for one more die: at sea she runs it at once, in port
            it is added to the wind she has yet to sail on. Throw a 1 (a 1 or 2 rounding a great cape)
            and she carries away a spar instead: nothing gained, {DAMAGE_SPEED_PENALTY} points slower
            every roll, and {money(REPAIR_PRICE)} at a quay to make her good. Worth it to win a race
            or make port this turn; a poor habit on a long, quiet passage.
          </Rule>
          <Rule name="Encounters at sea" art="derelict">
            A ship under way sometimes meets something that asks for a decision, good for that turn
            only. A derelict to salvage for the ground it costs, castaways whose owners pay to have
            them taken off, a country trader with a lot going cheap, a pilot who will take her through
            the reefs for a fee (most of them know the way). Holding your course is always an answer.
          </Rule>
          <Rule name="The shipping exchange" art="event">
            Three companies whose prices rise and fall with the cargo actually landed in their waters.
            Not another way to win — somewhere for money to go, and a market to read. If you can see
            where the commissions are sending everyone, you can see which company is about to move.
          </Rule>
        </dl>
      </Panel>

      <Panel title="If you keep losing">
        <p style={para}>
          Two dials, and the second matters more than people expect.
        </p>
        <ul style={list}>
          <li>
            <strong>How well the rivals play.</strong>{' '}
            {(Object.keys(DIFFICULTIES) as (keyof typeof DIFFICULTIES)[])
              .map(k => DIFFICULTIES[k].label)
              .join(', ')}
            . Every handicap is knowledge and discipline — a gentle captain ignores the wind chart and
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
          <Button tone="primary">Set up a voyage →</Button>
        </Link>
      </div>

      <PortalNav />
    </div>
  );
}

function Rule({ name, art, children }: { name: string; art?: VignetteKind; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
      {art ? (
        <Vignette kind={art} size={40} colour={UI.verdigris} style={{ border: `1px solid ${UI.rule}`, background: UI.panel, marginTop: '0.15rem' }} />
      ) : (
        <span style={{ width: 42, flex: '0 0 42px' }} />
      )}
      <div style={{ minWidth: 0 }}>
        <dt style={term}>{name}</dt>
        <dd style={{ ...para, margin: '0.1rem 0 0 0' }}>{children}</dd>
      </div>
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
