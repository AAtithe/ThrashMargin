import { useState } from 'react';
import { ITEM, LODGING } from '../../sim/content';
import { MISSION, MISSIONS, activeStatus, missionReady, nextMission, objectiveStatus } from '../../sim/missions';
import type { Mission } from '../../sim/types';
import { FONT, UI } from '../../theme';
import { duration, gr } from '../../lib/format';
import { Blurb, Button, Meta, Meter, Panel, Row } from '../ui';
import ActButton from './ActButton';
import { TimerBar } from '../motion';
import type { PlaceProps, Verb } from '../types';

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

/**
 * Why a mission button is greyed out, written on the page. A disabled button's tooltip never shows on
 * a touch screen, and this is the panel a new player is steered by: "Level 3 required" or "You cannot
 * report back while abroad" has to be readable without a mouse.
 */
function Why({ p, verb }: { p: PlaceProps; verb: Verb }) {
  const reason = p.why(verb);
  if (!reason) return null;
  return (
    <p style={{ margin: '0.1rem 0 0', textAlign: 'right' }}>
      <Meta colour={UI.textSoft}>{reason}</Meta>
    </p>
  );
}

export default function Missions(p: PlaceProps) {
  const { s, now } = p;
  // Abandoning throws away every count made since accepting (a journey to Geneva, an hour waiting on a
  // recovering opponent) and sits beside Report back, so it asks once before it acts. The question is
  // keyed to the mission in hand (its acceptance time), so it cannot carry over to the next one if this
  // one ends some other way while the question is showing.
  const [abandonAsked, setAbandonAsked] = useState<number | null>(null);
  const active = s.missions.active;
  const current = active ? MISSION[active.id] : null;
  const upcoming = nextMission(s);
  const done = MISSIONS.filter(m => s.missions.done.includes(m.id));
  const confirmAbandon = active !== null && abandonAsked === active.accepted;

  return (
    <>
      {current && active && (
        <Panel
          title={current.title}
          aside={active.deadline !== null ? <Meta colour={active.deadline - now < 6 * 3_600_000 ? UI.bad : UI.warn}>{duration(active.deadline - now)} left</Meta> : undefined}
        >
          {active.deadline !== null && (
            <TimerBar start={active.accepted} end={active.deadline} now={now} colour={active.deadline - now < 6 * 3_600_000 ? UI.bad : UI.warn} style={{ height: 3, marginTop: 0 }} />
          )}
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
            {confirmAbandon ? (
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ color: UI.bad, fontSize: '0.75rem' }}>Abandon, and lose the progress?</span>
                <Button tone="danger" onClick={() => { setAbandonAsked(null); p.act({ type: 'ABANDON_MISSION' }); }}>Yes</Button>
                <Button tone="quiet" onClick={() => setAbandonAsked(null)}>No</Button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <Button tone="quiet" onClick={() => setAbandonAsked(active.accepted)}>Abandon</Button>
                <ActButton p={p} verb={{ type: 'COMPLETE_MISSION' }} tone="primary" reasonShownBy="page">Report back</ActButton>
              </div>
            )}
          </Row>
          {missionReady(s) && <Why p={p} verb={{ type: 'COMPLETE_MISSION' }} />}
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
            <ActButton p={p} id={`nr-mission-accept`} verb={{ type: 'ACCEPT_MISSION', missionId: upcoming.id }} tone="primary" reasonShownBy="page">Accept</ActButton>
          </Row>
          <Why p={p} verb={{ type: 'ACCEPT_MISSION', missionId: upcoming.id }} />
          <Blurb>Schemes, duels, training and journeys count only once you have accepted, so accept before you start.</Blurb>
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
