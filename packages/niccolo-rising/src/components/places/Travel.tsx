import { COURSE, DESTINATION, DESTINATIONS, ITEM, abroadStock, carryCapacity, journeyMs, saleValue } from '../../sim/content';
import { UI } from '../../theme';
import { duration, gr } from '../../lib/format';
import { Blurb, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

export default function Travel(p: PlaceProps) {
  const { s, now } = p;
  const st = s.status;

  if (st.kind === 'travelling') {
    const total = st.arrives - st.departs;
    return (
      <Panel title={`On the road to ${st.to === 'bruges' ? 'Bruges' : DESTINATION[st.to]?.name}`}>
        <Meta colour={UI.verdigris}>
          Arriving in {duration(st.arrives - now)} of {duration(total)}. Your bars refill on the road, so a journey is
          the best use of an empty Energy bar.
        </Meta>
      </Panel>
    );
  }

  if (st.kind === 'abroad') {
    const dest = DESTINATION[st.city];
    const room = carryCapacity(s) - s.tripBought;
    return (
      <Panel title={dest?.name ?? st.city} aside={<Meta>room for {room} more of {carryCapacity(s)}</Meta>}>
        <Blurb>{dest?.blurb}</Blurb>
        {dest?.market.map(m => {
          const item = ITEM[m.item];
          const stock = abroadStock(s, st.city, m.item);
          const home = saleValue(s, m.item, now);
          return (
            <Row key={m.item} style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.88rem' }}>{item?.name}</div>
                <Blurb>{item?.blurb}</Blurb>
                <Meta>
                  {gr(m.cost)} here · {stock} in stock · {item?.kind === 'trade' ? `the Waterhalle pays ${gr(home)} today` : `worth ${gr(home)} at home`}
                </Meta>
              </div>
              <ActButton p={p} verb={{ type: 'BUY_ABROAD', itemId: m.item, qty: 1 }}>Buy 1</ActButton>
              <ActButton p={p} verb={{ type: 'BUY_ABROAD', itemId: m.item, qty: Math.max(1, Math.min(room, stock, Math.floor(s.groats / m.cost))) }}>
                Buy {Math.max(1, Math.min(room, stock, Math.floor(s.groats / m.cost)))}
              </ActButton>
            </Row>
          );
        })}
        <Row>
          <Meta>Home takes {duration(journeyMs(s, st.city))}. The passage back is already paid.</Meta>
          <ActButton p={p} verb={{ type: 'TRAVEL', to: 'bruges' }} tone="primary">Sail for Bruges</ActButton>
        </Row>
      </Panel>
    );
  }

  return (
    <Panel title="Travel" aside={<Meta>carry {carryCapacity(s)} items home</Meta>}>
      <Blurb>
        Leave from Sluys or by the Ghent road. Every place sells something Bruges pays more for, in limited stock that
        restocks hourly. A fare covers the journey there and back.
      </Blurb>
      {DESTINATIONS.map(d => {
        const locked = d.requiresCourse && !s.coursesDone.includes(d.requiresCourse);
        return (
          <Row key={d.id} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.88rem', color: locked ? UI.textFaint : UI.text }}>{d.name}</div>
              <Blurb>{d.blurb}</Blurb>
              <Meta>
                {duration(journeyMs(s, d.id))} each way · {gr(d.fare)} · sells {d.market.map(m => ITEM[m.item]?.name).join(', ')}
                {locked ? ` · needs ${COURSE[d.requiresCourse!]?.name}` : ''}
              </Meta>
            </div>
            <ActButton p={p} verb={{ type: 'TRAVEL', to: d.id }}>Set out</ActButton>
          </Row>
        );
      })}
    </Panel>
  );
}
