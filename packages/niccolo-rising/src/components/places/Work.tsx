import { DAY, JOBS, JOB, perks } from '../../sim/content';
import { WORK_STATS } from '../../sim/types';
import type { WorkStat } from '../../sim/types';
import { FONT, UI } from '../../theme';
import { duration, gr, stat } from '../../lib/format';
import { Blurb, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

function reqText(req: Record<WorkStat, number>) {
  return WORK_STATS.filter(k => req[k] > 0).map(k => `${k} ${req[k]}`).join(', ') || 'no requirement';
}

export default function Work(p: PlaceProps) {
  const { s, now } = p;
  const job = s.job ? JOB[s.job.id] : null;
  const rank = job && s.job ? job.ranks[s.job.rank] : null;
  const nextRank = job && s.job ? job.ranks[s.job.rank + 1] : null;
  return (
    <>
      <Panel title="Working stats">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
          {WORK_STATS.map(k => (
            <div key={k}>
              <div style={{ fontSize: '0.72rem', color: UI.textSoft, textTransform: 'capitalize' }}>{k}</div>
              <div style={{ fontFamily: FONT.data, fontSize: '1rem' }}>{stat(s.work[k])}</div>
            </div>
          ))}
        </div>
        <Blurb>A post pays once a day and raises your working stats a little each day you hold it.</Blurb>
      </Panel>
      {job && rank && s.job && (
        <Panel title={`${rank.name}, ${job.name}`}>
          <Meta>
            {gr(Math.round(rank.pay * (1 + perks(s).payPct / 100)))} a day · next payday in{' '}
            {duration(s.job.since + (s.job.paidDays + 1) * DAY - now)}
          </Meta>
          <Row>
            <Meta>{nextRank ? `Next: ${nextRank.name}, needs ${reqText(nextRank.req)}` : 'The top of the ladder.'}</Meta>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <ActButton p={p} verb={{ type: 'PROMOTE' }} tone="primary">Seek promotion</ActButton>
              <ActButton p={p} verb={{ type: 'LEAVE_JOB' }} tone="quiet">Leave</ActButton>
            </div>
          </Row>
        </Panel>
      )}
      <Panel title="Employers">
        {JOBS.map(j => (
          <Row key={j.id} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.88rem' }}>{j.name}</div>
              <Blurb>{j.blurb}</Blurb>
              <Meta>
                {j.ranks.map(r => r.name).join(' → ')} · starts at {gr(j.ranks[0].pay)} a day, needs {reqText(j.ranks[0].req)}
              </Meta>
            </div>
            <ActButton p={p} verb={{ type: 'JOIN_JOB', jobId: j.id }}>Take a post</ActButton>
          </Row>
        ))}
      </Panel>
    </>
  );
}
