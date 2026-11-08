import { LODGINGS, currentLodging } from '../../sim/content';
import { UI } from '../../theme';
import { gr } from '../../lib/format';
import { Blurb, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

export default function Lodging(p: PlaceProps) {
  const { s } = p;
  const home = currentLodging(s);
  return (
    <Panel title="Lodging" aside={<Meta>living in: {home.name}</Meta>}>
      <Blurb>Where you sleep sets your Spirits, and Spirits are what make a session in the yard worth having.</Blurb>
      {LODGINGS.map(l => {
        const owned = s.lodgings.includes(l.id);
        return (
          <Row key={l.id} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.88rem', color: l.id === home.id ? UI.brass : UI.text }}>{l.name}</div>
              <Blurb>{l.blurb}</Blurb>
              <Meta>Spirits up to {l.spiritsMax.toLocaleString('en-GB')} · {l.cost ? gr(l.cost) : 'free'}</Meta>
            </div>
            {owned ? <Meta colour={UI.good}>yours</Meta> : <ActButton p={p} verb={{ type: 'BUY_LODGING', lodgingId: l.id }}>Buy</ActButton>}
          </Row>
        );
      })}
    </Panel>
  );
}
