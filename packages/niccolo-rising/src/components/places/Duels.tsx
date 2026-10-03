import { OPPONENTS, OPPONENT, CONFIG } from '../../sim/content';
import { BATTLE_STATS } from '../../sim/types';
import { UI } from '../../theme';
import { duration, gr } from '../../lib/format';
import { Blurb, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

/** A rough reading of an opponent against the player's own total, in the words a street would use. */
function reading(mine: number, theirs: number): { text: string; colour: string } {
  const r = mine / theirs;
  if (r > 2) return { text: 'no contest', colour: UI.good };
  if (r > 1.25) return { text: 'you should win', colour: UI.good };
  if (r > 0.85) return { text: 'an even fight', colour: UI.warn };
  if (r > 0.5) return { text: 'you will probably lose', colour: UI.bad };
  return { text: 'do not', colour: UI.bad };
}

export default function Duels(p: PlaceProps) {
  const { s, now } = p;
  const mine = BATTLE_STATS.reduce((n, k) => n + s.battle[k], 0);
  const last = s.lastFight;
  return (
    <>
      {last && (
        <Panel title={`Last fight: ${OPPONENT[last.opponentId]?.name}`} aside={<Meta colour={last.outcome === 'won' ? UI.good : last.outcome === 'lost' ? UI.bad : UI.warn}>{last.outcome}</Meta>}>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {last.lines.map((line, i) => (
              <div key={i} style={{ fontSize: '0.75rem', color: UI.textSoft, lineHeight: 1.5 }}>{line}</div>
            ))}
          </div>
        </Panel>
      )}
      <Panel title="Duels" aside={<Meta>{CONFIG.duel.energyCost} energy a fight</Meta>}>
        <Blurb>
          You fight with the Health you have. A beaten opponent needs {CONFIG.duel.opponentRecoveryMinutes} minutes before
          they can be fought again; a beaten player goes to the Infirmary.
        </Blurb>
        {OPPONENTS.map(o => {
          const theirs = BATTLE_STATS.reduce((n, k) => n + o.stats[k], 0);
          const read = reading(mine, theirs);
          const recovering = (s.opponents[o.id] ?? 0) > now;
          return (
            <Row key={o.id} style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.88rem' }}>{o.name} <span style={{ color: UI.textFaint, fontSize: '0.75rem' }}>level {o.level}</span></div>
                <Blurb>{o.blurb}</Blurb>
                <Meta>
                  <span style={{ color: read.colour }}>{read.text}</span> · purse {gr(o.groats[0])} to {gr(o.groats[1])}
                  {recovering ? ` · recovering, ${duration((s.opponents[o.id] ?? 0) - now)}` : ''}
                </Meta>
              </div>
              <ActButton p={p} verb={{ type: 'DUEL', opponentId: o.id }} tone={read.colour === UI.bad ? 'danger' : 'default'}>Fight</ActButton>
            </Row>
          );
        })}
      </Panel>
    </>
  );
}
