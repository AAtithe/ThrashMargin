import { useState } from 'react';
import { CONFIG, CONTRACT, HOUSE, HOUSES, OPPONENTS, chainMult, houseOf } from '../../sim/content';
import { contractStatus, objectiveStatus } from '../../sim/missions';
import type { Perks } from '../../sim/types';
import { FONT, UI } from '../../theme';
import { duration, gr } from '../../lib/format';
import { Blurb, Meta, Meter, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

function perkText(p: Perks): string {
  const out: string[] = [];
  if (p.gymPct) out.push(`+${p.gymPct}% training`);
  if (p.schemePct) out.push(`+${p.schemePct}% schemes`);
  if (p.travelPct) out.push(`${p.travelPct}% shorter journeys`);
  if (p.carry) out.push(`carry ${p.carry} more`);
  if (p.infirmaryPct) out.push(`${p.infirmaryPct}% shorter Infirmary`);
  if (p.steenPct) out.push(`${p.steenPct}% shorter Steen`);
  if (p.payPct) out.push(`+${p.payPct}% pay`);
  if (p.depositPct) out.push(`+${p.depositPct}% Medici interest`);
  if (p.abroadPct) out.push(`${p.abroadPct}% cheaper abroad`);
  return out.join(', ');
}

/** Outside every house: the four to choose from. */
function Choose(p: PlaceProps) {
  const { s, now } = p;
  const wait = s.houseLeftAt !== null ? s.houseLeftAt + CONFIG.house.rejoinHours * 3_600_000 - now : 0;
  return (
    <>
      <Panel title="The great houses of Bruges">
        <Blurb>
          A house gives you its standing perks, its contracts and its quarrels. It asks an entry fee, dues every day,
          and loyalty: you cannot fight its own people, and three missed days of dues and it is done with you. Favour,
          earned by contracts, gifts and duels, carries you up its ranks. Wins in quick succession build a chain that
          multiplies favour, and a win against your house's rival counts double.
        </Blurb>
        {wait > 0 && <Meta colour={UI.warn}>No house will take you for another {duration(wait)}.</Meta>}
      </Panel>
      {HOUSES.map(h => {
        const fighters = OPPONENTS.filter(o => o.house === h.id).map(o => o.name);
        return (
          <Panel key={h.id} title={h.name} aside={<Meta>led by {h.head}</Meta>}>
            <Blurb>{h.blurb}</Blurb>
            <Row style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <Meta>
                  level {h.minLevel} · standing {h.minStanding} · entry {gr(h.fee)} · rival: {HOUSE[h.rival]?.name}
                  {fighters.length ? ` · its people: ${fighters.join(', ')}` : ''}
                </Meta>
                {h.ranks.map((r, i) => (
                  <div key={i} style={{ fontSize: '0.75rem', color: UI.textSoft, marginTop: 3 }}>
                    <span style={{ color: UI.text }}>{r.name}</span>
                    <span style={{ fontFamily: FONT.data, color: UI.textFaint }}> · {r.favour.toLocaleString('en-GB')} favour · {r.dues} gr a day · </span>
                    {perkText(r.perks)}
                  </div>
                ))}
              </div>
              <ActButton p={p} verb={{ type: 'JOIN_HOUSE', houseId: h.id }} tone="primary">Join</ActButton>
            </Row>
          </Panel>
        );
      })}
    </>
  );
}

export default function House(p: PlaceProps) {
  const { s, now } = p;
  const [amount, setAmount] = useState('');
  const h = houseOf(s);
  if (!h || !s.house) return <Choose {...p} />;

  const mine = s.house;
  const next = h.house.ranks[h.index + 1];
  const chainLive = mine.chain.expires > now ? mine.chain.count : 0;
  const nextTier = CONFIG.house.chainTiers.find(t => t.count > chainLive);
  const held = mine.contract ? CONTRACT[mine.contract.id]?.contract : null;
  const offered = h.house.contracts;
  const n = Math.floor(Number(amount));

  return (
    <>
      <Panel title={h.house.name} aside={<Meta>{h.rank.name}</Meta>}>
        <Row>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.85rem', marginBottom: 4 }}>
              Favour {mine.favour.toLocaleString('en-GB')}
              {next ? ` of ${next.favour.toLocaleString('en-GB')} for ${next.name}` : ', the highest rank there is'}
            </div>
            <Meter value={mine.favour - h.rank.favour} max={next ? next.favour - h.rank.favour : 1} colour={UI.brass} />
          </div>
        </Row>
        <Row>
          <Meta>Your rank gives: {perkText(h.rank.perks) || 'nothing yet'}</Meta>
        </Row>
        <Row>
          <Meta colour={mine.missedDues ? UI.bad : undefined}>
            Dues {gr(h.rank.dues)} a day, taken at the hour you joined
            {mine.missedDues ? `. Missed ${mine.missedDues} in a row: ${CONFIG.house.maxMissedDues - mine.missedDues} more and you are out.` : '.'}
          </Meta>
        </Row>
        <Row>
          <Meta colour={chainLive ? UI.good : undefined}>
            {chainLive
              ? `Chain of ${chainLive}, ×${chainMult(chainLive)}: win again within ${duration(mine.chain.expires - now)} to keep it`
              : `No chain running. Win duels within ${CONFIG.house.chainMinutes} minutes of each other to build one`}
            {nextTier ? `. ×${nextTier.mult} from ${nextTier.count}.` : '.'} Rival: {HOUSE[h.house.rival]?.name}, worth ×{CONFIG.house.rivalMult}.
          </Meta>
        </Row>
      </Panel>

      {held && mine.contract ? (
        <Panel title={`Contract: ${held.title}`} aside={mine.contract.deadline !== null ? <Meta colour={UI.warn}>{duration(mine.contract.deadline - now)} left</Meta> : undefined}>
          <Blurb>{held.brief}</Blurb>
          {contractStatus(s).map((o, i) => (
            <Row key={i}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.85rem', color: o.met ? UI.good : UI.text, marginBottom: 4 }}>{o.label}</div>
                <Meter value={o.have} max={o.need} colour={o.met ? UI.good : UI.brass} height={4} />
              </div>
              <Meta>{o.have.toLocaleString('en-GB')}/{o.need.toLocaleString('en-GB')}</Meta>
            </Row>
          ))}
          <Row>
            <Meta>Reward: {held.reward.favour} favour{held.reward.groats ? ` · ${gr(held.reward.groats)}` : ''}</Meta>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <ActButton p={p} verb={{ type: 'ABANDON_CONTRACT' }} tone="quiet">Abandon</ActButton>
              <ActButton p={p} verb={{ type: 'COMPLETE_CONTRACT' }} tone="primary">Report back</ActButton>
            </div>
          </Row>
        </Panel>
      ) : (
        <Panel title="Contracts" aside={mine.contractReadyAt > now ? <Meta>more in {duration(mine.contractReadyAt - now)}</Meta> : undefined}>
          <Blurb>Repeatable work for the house. One at a time; after each, a short wait before the next.</Blurb>
          {offered.map(c => (
            <Row key={c.id} style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.85rem', color: c.minRank > h.index ? UI.textFaint : UI.text }}>{c.title}</div>
                <Blurb>{c.brief}</Blurb>
                <Meta>
                  {c.objectives.map(o => objectiveStatus(s, o, 0).label).join('; ')}
                  {c.hours ? ` · ${c.hours} hours` : ''} · {c.reward.favour} favour{c.reward.groats ? ` · ${gr(c.reward.groats)}` : ''}
                  {c.minRank > h.index ? ` · from ${h.house.ranks[c.minRank].name}` : ''}
                </Meta>
              </div>
              <ActButton p={p} verb={{ type: 'ACCEPT_CONTRACT', contractId: c.id }}>Accept</ActButton>
            </Row>
          ))}
        </Panel>
      )}

      <Panel title="Give to the house" aside={<Meta>{CONFIG.house.groatsPerFavour} gr a favour</Meta>}>
        <Row>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="groats"
            style={{ flex: 1, background: UI.ground, border: `1px solid ${UI.rule}`, color: UI.text, fontFamily: FONT.data, padding: '0.4rem 0.6rem' }}
          />
          <Meta>{n >= CONFIG.house.groatsPerFavour ? `${Math.floor(n / CONFIG.house.groatsPerFavour).toLocaleString('en-GB')} favour` : ''}</Meta>
          <ActButton p={p} verb={{ type: 'DONATE', amount: n }}>Give</ActButton>
        </Row>
      </Panel>

      <Panel title="Leave the house">
        <Row>
          <Meta>All favour is lost, and no house will take you for {CONFIG.house.rejoinHours} hours.</Meta>
          <ActButton p={p} verb={{ type: 'LEAVE_HOUSE' }} tone="danger">Leave</ActButton>
        </Row>
      </Panel>
    </>
  );
}
