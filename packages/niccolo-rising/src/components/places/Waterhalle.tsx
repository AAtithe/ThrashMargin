import { ITEM, ITEMS, saleValue } from '../../sim/content';
import type { Item } from '../../sim/types';
import { UI } from '../../theme';
import { gr } from '../../lib/format';
import { Blurb, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps, Verb } from '../types';

function effectText(item: Item): string {
  const e = item.effect;
  if (e) {
    const out: string[] = [];
    if (e.energy) out.push(`+${e.energy} energy`);
    if (e.nerve) out.push(`+${e.nerve} nerve`);
    if (e.spirits) out.push(`+${e.spirits} spirits`);
    if (e.health) out.push(`+${e.health} health`);
    if (e.infirmaryMinutes) out.push(`${e.infirmaryMinutes} minutes off an Infirmary stay`);
    return out.join(', ');
  }
  if (item.kind === 'weapon') return `damage ×${item.damage}, accuracy +${item.accuracy}`;
  if (item.kind === 'armour') return `turns ${Math.round((item.armour ?? 0) * 100)}% of every blow`;
  if (item.kind === 'kit') return `carry ${item.carry} more from abroad`;
  return 'trade goods';
}

const SECTIONS: { kind: Item['kind']; title: string }[] = [
  { kind: 'consumable', title: 'Victuals and physic' },
  { kind: 'weapon', title: "The armourers' row: weapons" },
  { kind: 'armour', title: "The armourers' row: armour" },
  { kind: 'kit', title: 'Travelling kit' },
];

export default function Waterhalle(p: PlaceProps) {
  const { s, now } = p;
  const held = Object.entries(s.inventory).filter(([, q]) => q > 0);
  return (
    <>
      <Panel title="What you carry">
        {(['weapon', 'armour'] as const).map(slot => {
          const id = s.equipped[slot];
          return (
            <Row key={slot}>
              <span style={{ fontSize: '0.85rem', flex: 1 }}>
                <span style={{ color: UI.textSoft, textTransform: 'capitalize' }}>{slot}: </span>
                {id ? ITEM[id]?.name : 'none'}
              </span>
              {id && <ActButton p={p} verb={{ type: 'UNEQUIP', slot }} tone="quiet">Take off</ActButton>}
            </Row>
          );
        })}
        {held.length === 0 && <Blurb>Nothing else.</Blurb>}
        {held.map(([id, qty]) => {
          const item = ITEM[id];
          if (!item) return null;
          const each = saleValue(s, id, now);
          // A row's buttons often share one reason (abroad, every one is refused alike): the first
          // button that has it writes it, the rest do not repeat it.
          const first: { verb: Verb; label: string } | null =
            item.kind === 'consumable' ? { verb: { type: 'USE_ITEM', itemId: id }, label: 'Use' }
            : item.kind === 'weapon' || item.kind === 'armour' ? { verb: { type: 'EQUIP', itemId: id }, label: 'Equip' }
            : null;
          const sellOne: Verb = { type: 'SELL', itemId: id, qty: 1 };
          return (
            <Row key={id}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.85rem' }}>
                  {item.name} <span style={{ color: UI.textFaint }}>×{qty}</span>
                </div>
                <Meta>{effectText(item)} · sells for {gr(each)} today</Meta>
              </div>
              {first && <ActButton p={p} verb={first.verb}>{first.label}</ActButton>}
              <ActButton p={p} verb={sellOne} tone="quiet" reasonShownBy={first?.verb}>Sell 1</ActButton>
              {qty > 1 && <ActButton p={p} verb={{ type: 'SELL', itemId: id, qty }} tone="quiet" reasonShownBy={sellOne}>Sell all</ActButton>}
            </Row>
          );
        })}
      </Panel>
      {SECTIONS.map(sec => (
        <Panel key={sec.kind} title={sec.title}>
          {ITEMS.filter(i => i.kind === sec.kind && i.price > 0).map(i => (
            <Row key={i.id} style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.85rem' }}>{i.name}</div>
                <Blurb>{i.blurb}</Blurb>
                <Meta>{gr(i.price)} · {effectText(i)}</Meta>
              </div>
              <ActButton p={p} verb={{ type: 'BUY', itemId: i.id, qty: 1 }}>Buy</ActButton>
            </Row>
          ))}
        </Panel>
      ))}
    </>
  );
}
