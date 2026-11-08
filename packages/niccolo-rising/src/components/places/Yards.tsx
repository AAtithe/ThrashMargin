import { YARDS, trainGain } from '../../sim/content';
import { BATTLE_STATS } from '../../sim/types';
import { FONT, UI } from '../../theme';
import { gr, stat } from '../../lib/format';
import { Blurb, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

export default function Yards(p: PlaceProps) {
  const { s } = p;
  return (
    <>
      <Panel title="Battle stats">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem' }}>
          {BATTLE_STATS.map(k => (
            <div key={k}>
              <div style={{ fontSize: '0.72rem', color: UI.textSoft, textTransform: 'capitalize' }}>{k}</div>
              <div style={{ fontFamily: FONT.data, fontSize: '1rem' }}>{stat(s.battle[k])}</div>
            </div>
          ))}
        </div>
        <Blurb>
          Each train spends Energy and some Spirits. The higher your Spirits, the more each train is worth, so
          eat and drink before a session rather than after it.
        </Blurb>
      </Panel>
      {YARDS.map(y => {
        const member = s.yards.includes(y.id);
        const most = Math.floor(s.bars.energy.cur / y.energy);
        return (
          <Panel key={y.id} title={y.name} aside={<Meta>{y.energy} energy per train · quality {y.dots}</Meta>}>
            <Blurb>{y.blurb}</Blurb>
            {member ? (
              BATTLE_STATS.map(k => (
                <Row key={k}>
                  <span style={{ textTransform: 'capitalize', fontSize: '0.85rem', flex: 1 }}>{k}</span>
                  <Meta>+{trainGain(s, y, s.battle[k], s.bars.spirits.cur).toFixed(2)} per train</Meta>
                  <ActButton p={p} verb={{ type: 'TRAIN', yardId: y.id, stat: k, times: 1 }}>Train</ActButton>
                  {most > 1 && (
                    <ActButton p={p} verb={{ type: 'TRAIN', yardId: y.id, stat: k, times: most }}>
                      Train ×{most}
                    </ActButton>
                  )}
                </Row>
              ))
            ) : (
              <Row>
                <Meta>Level {y.minLevel} · membership {gr(y.cost)}</Meta>
                <ActButton p={p} verb={{ type: 'BUY_YARD', yardId: y.id }}>Join</ActButton>
              </Row>
            )}
          </Panel>
        );
      })}
    </>
  );
}
