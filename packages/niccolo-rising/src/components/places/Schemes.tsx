import { COURSE, SCHEMES, schemeChance } from '../../sim/content';
import { UI } from '../../theme';
import { gr } from '../../lib/format';
import { Blurb, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

export default function Schemes(p: PlaceProps) {
  const { s } = p;
  return (
    <Panel title="Schemes" aside={<Meta>scheme skill {Math.floor(s.schemeSkill)}</Meta>}>
      <Blurb>
        Spend Nerve on a scheme. Success pays and builds skill; failure builds a little skill and may end in
        the Steen or the Infirmary. Skill is what makes the harder schemes worth trying.
      </Blurb>
      {SCHEMES.map(x => {
        const locked = x.requiresCourse && !s.coursesDone.includes(x.requiresCourse);
        const chance = schemeChance(s, x);
        return (
          <Row key={x.id} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.88rem', color: locked ? UI.textFaint : UI.text }}>{x.name}</div>
              <Blurb>{x.blurb}</Blurb>
              <Meta>
                {x.nerve} nerve · {gr(x.groats[0])} to {gr(x.groats[1])} ·{' '}
                {locked ? `needs ${COURSE[x.requiresCourse!]?.name}` : <span style={{ color: chance >= 0.6 ? UI.good : chance >= 0.4 ? UI.warn : UI.bad }}>{Math.round(chance * 100)}% chance</span>}
              </Meta>
            </div>
            <ActButton p={p} verb={{ type: 'SCHEME', schemeId: x.id }}>Attempt</ActButton>
          </Row>
        );
      })}
    </Panel>
  );
}
