import { COURSE, HONOURS, ITEM, perks, currentLodging, jobRank } from '../../sim/content';
import { UI } from '../../theme';
import { Blurb, Meta, Panel, Row } from '../ui';
import type { PlaceProps } from '../types';

export default function Home(p: PlaceProps) {
  const { s } = p;
  const pk = perks(s);
  const job = jobRank(s);
  const c = s.counters;
  return (
    <>
      <Panel title="Where things stand">
        <Row><span style={{ flex: 1, fontSize: '0.85rem' }}>Post</span><Meta>{job ? `${job.rank.name}, ${job.job.name}` : 'none'}</Meta></Row>
        <Row><span style={{ flex: 1, fontSize: '0.85rem' }}>Lodging</span><Meta>{currentLodging(s).name}</Meta></Row>
        <Row><span style={{ flex: 1, fontSize: '0.85rem' }}>Weapon and armour</span><Meta>{s.equipped.weapon ? ITEM[s.equipped.weapon]?.name : 'bare hands'} · {s.equipped.armour ? ITEM[s.equipped.armour]?.name : 'a shirt'}</Meta></Row>
        <Row><span style={{ flex: 1, fontSize: '0.85rem' }}>Courses</span><Meta>{s.coursesDone.map(id => COURSE[id]?.name).join(', ') || 'none yet'}</Meta></Row>
        <Row><span style={{ flex: 1, fontSize: '0.85rem' }}>Schemes</span><Meta>{c.schemesWon} of {c.schemes} came off</Meta></Row>
        <Row><span style={{ flex: 1, fontSize: '0.85rem' }}>Duels</span><Meta>{c.duelsWon} won, {c.duelsLost} lost</Meta></Row>
        <Row><span style={{ flex: 1, fontSize: '0.85rem' }}>Journeys</span><Meta>{c.voyages}</Meta></Row>
        <Row>
          <span style={{ flex: 1, fontSize: '0.85rem' }}>Standing perks</span>
          <Meta>
            training +{pk.gymPct}% · schemes +{pk.schemePct}% · journeys −{pk.travelPct}% · pay +{pk.payPct}%
          </Meta>
        </Row>
      </Panel>
      <Panel title="Honours" aside={<Meta>{s.honours.length}/{HONOURS.length}</Meta>}>
        {HONOURS.map(h => {
          const have = s.honours.includes(h.id);
          return (
            <Row key={h.id}>
              <span style={{ flex: 1, fontSize: '0.85rem', color: have ? UI.brass : UI.textFaint }}>{h.name}</span>
              <Meta colour={have ? UI.textSoft : UI.textFaint}>{have ? h.text : 'not yet'}</Meta>
            </Row>
          );
        })}
      </Panel>
      <Blurb>
        Time runs while you are away. Spend your Energy in the yard or on a duel, your Nerve on a scheme, then set out on a
        journey while the bars refill.
      </Blurb>
    </>
  );
}
