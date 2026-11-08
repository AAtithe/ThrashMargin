import { ITEM, LODGING } from '../../sim/content';
import { MISSION, MISSIONS, activeStatus, nextMission, objectiveStatus } from '../../sim/missions';
import type { Mission } from '../../sim/types';
import { FONT, UI } from '../../theme';
import { duration, gr } from '../../lib/format';
import { Blurb, Meta, Meter, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

function rewardText(m: Mission): string {
  const r = m.reward;
  const out: string[] = [];
  if (r.groats) out.push(gr(r.groats));
  if (r.xp) out.push(`${r.xp} experience`);
  if (r.standing) out.push(`${r.standing} standing`);
  for (const [id, qty] of Object.entries(r.items ?? {})) out.push(`${qty > 1 ? `${qty} × ` : ''}${ITEM[id]?.name ?? id}`);
  if (r.lodging) out.push(LODGING[r.lodging]?.name ?? r.lodging);
  return out.join(' · ') || 'the story moves on';
}

function Brief({ m }: { m: Mission }) {
  return (
    <>
      <Meta>from {m.giver}</Meta>
      <p style={{ fontSize: '0.88rem', lineHeight: 1.55, margin: '0.5rem 0 0.4rem', color: UI.text }}>{m.brief}</p>
    </>
  );
}

export default function Missions(p: PlaceProps) {
  const { s, now } = p;
  const active = s.missions.active;
  const current = active ? MISSION[active.id] : null;
  const upcoming = nextMission(s);
  const done = MISSIONS.filter(m => s.missions.done.includes(m.id));

  return (
    <>
      {current && active && (
        <Panel
          title={current.title}
          aside={active.deadline !== null ? <Meta colour={active.deadline - now < 6 * 3_600_000 ? UI.bad : UI.warn}>{duration(active.deadline - now)} left</Meta> : undefined}
        >
          <Brief m={current} />
          {activeStatus(s).map((o, i) => (
            <Row key={i}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.85rem', color: o.met ? UI.good : UI.text, marginBottom: 4 }}>{o.label}</div>
                <Meter value={o.have} max={o.need} colour={o.met ? UI.good : UI.brass} height={4} />
              </div>
              <span style={{ fontFamily: FONT.data, fontSize: '0.75rem', color: o.met ? UI.good : UI.textSoft, minWidth: 70, textAlign: 'right' }}>
                {o.have.toLocaleString('en-GB')}/{o.need.toLocaleString('en-GB')}
              </span>
            </Row>
          ))}
          <Row>
            <Meta>Reward: {rewardText(current)}</Meta>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <ActButton p={p} verb={{ type: 'ABANDON_MISSION' }} tone="quiet">Abandon</ActButton>
              <ActButton p={p} verb={{ type: 'COMPLETE_MISSION' }} tone="primary">Report back</ActButton>
            </div>
          </Row>
          <Blurb>
            Schemes, duels, training and journeys count from the moment you accepted. Goods and groats asked for are
            handed over when you report back, in Bruges.
          </Blurb>
        </Panel>
      )}

      {!current && upcoming && (
        <Panel title={upcoming.title} aside={<Meta>level {upcoming.minLevel}{upcoming.hours ? ` · ${upcoming.hours} hours once accepted` : ''}</Meta>}>
          <Brief m={upcoming} />
          {upcoming.objectives.map((o, i) => (
            <Row key={i}>
              <span style={{ fontSize: '0.85rem', flex: 1 }}>{objectiveStatus(s, o, 0).label}</span>
              <Meta>{objectiveStatus(s, o, 0).need.toLocaleString('en-GB')}</Meta>
            </Row>
          ))}
          <Row>
            <Meta>Reward: {rewardText(upcoming)}</Meta>
            <ActButton p={p} verb={{ type: 'ACCEPT_MISSION', missionId: upcoming.id }} tone="primary">Accept</ActButton>
          </Row>
        </Panel>
      )}

      {!current && !upcoming && (
        <Panel title="The story so far">
          <Blurb>
            The first book is told. Claes the apprentice is Nicholas vander Poele, and Simon de St Pol has been beaten in
            the street. The vendetta is not over; it is only waiting.
          </Blurb>
        </Panel>
      )}

      <Panel title="The chronicle of Claes" aside={<Meta>{done.length}/{MISSIONS.length}</Meta>}>
        {done.length === 0 && <Blurb>Nothing yet. Every story starts with a joke that goes too far.</Blurb>}
        {done.map(m => (
          <Row key={m.id} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.85rem', color: UI.brass }}>{m.title}</div>
              <Blurb>{m.done}</Blurb>
            </div>
          </Row>
        ))}
      </Panel>
    </>
  );
}
