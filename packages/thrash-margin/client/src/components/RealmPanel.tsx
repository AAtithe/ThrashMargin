/**
 * The realm at large: where every faction stands, how each victory race is going, treaties, and
 * the exchange. Shown when nothing is selected, and on its own tab.
 */
import {
  CEASEFIRE_COST, TECH_BRANCHES, TRADE_LOT, TRADE_LOTS_PER_TURN, TRADE_PRICES, BRANCH_LABELS,
  BUILDINGS, FACTION_COLORS, economicTarget, explain, incomeOf, scoreOf, troopsOf,
  type GameAction, type GameState, type TechBranch,
} from 'shared/sim';
import { FONT, UI } from '../theme';
import Icon from './Icon';
import { Button, Card, Chip, Cost, Muted, Why } from './ui';

interface Props {
  state: GameState;
  act: (a: GameAction) => void;
  onJump: (id: number) => void;
}

export default function RealmPanel({ state, act, onJump }: Props) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Overview state={state} onJump={onJump} />
      <Standings state={state} act={act} />
      <Races state={state} />
      <Exchange state={state} act={act} />
    </div>
  );
}

function Overview({ state, onJump }: { state: GameState; onJump: (id: number) => void }) {
  const me = state.activeFaction;
  const owned = state.nodes.filter(n => n.owner === me);
  const inc = incomeOf(state, me);
  const cap = owned.find(n => n.capital);
  const turnsOfFood = inc.foodNet < 0 ? Math.floor(state.factions[me].resources.food / -inc.foodNet) : null;
  return (
    <Card title="Your realm">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div><div style={{ fontSize: 10.5, color: UI.textFaint }}>Territories</div><div className="tm-num" style={{ fontFamily: FONT.data, fontSize: 18, fontWeight: 700 }}>{owned.length}<span style={{ fontSize: 11, color: UI.textFaint }}>/{state.nodes.length}</span></div></div>
        <div><div style={{ fontSize: 10.5, color: UI.textFaint }}>Troops</div><div className="tm-num" style={{ fontFamily: FONT.data, fontSize: 18, fontWeight: 700 }}>{troopsOf(state, me)}</div></div>
        <div><div style={{ fontSize: 10.5, color: UI.textFaint }}>Upkeep</div><div className="tm-num" style={{ fontFamily: FONT.data, fontSize: 18, fontWeight: 700, color: UI.food }}>{inc.upkeep}</div></div>
      </div>
      {turnsOfFood !== null && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, padding: 8, borderRadius: 6, background: '#2e1d1b', border: `1px solid ${UI.bad}`, fontSize: 12, color: '#f3c6c1' }}>
          <Icon name="warn" color={UI.bad} />
          <span>Your troops eat {-inc.foodNet} more food than you grow. {turnsOfFood > 0 ? `Stores last ${turnsOfFood} turn${turnsOfFood === 1 ? '' : 's'}` : 'Stores are empty'}; then troops starve. Build farms, take fertile land, or trade.</span>
        </div>
      )}
      {cap && <Button small tone="quiet" icon="capital" full style={{ marginTop: 10 }} onClick={() => onJump(cap.id)}>Select {cap.name}</Button>}
    </Card>
  );
}

function Standings({ state, act }: { state: GameState; act: (a: GameAction) => void }) {
  const me = state.activeFaction;
  const fog = state.config.fogOfWar && !state.factions[me].research.includes('cartography');
  const rows = Object.values(state.factions).sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || scoreOf(state, b.id) - scoreOf(state, a.id));
  return (
    <Card title="Standings">
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px 44px 48px', fontSize: 10.5, color: UI.textFaint, padding: '0 4px 4px' }}>
          <span>Faction</span><span style={{ textAlign: 'right' }}>Land</span><span style={{ textAlign: 'right' }}>Army</span><span style={{ textAlign: 'right' }}>Score</span>
        </div>
        {rows.map(f => {
          const fc = FACTION_COLORS[f.id];
          const peace = state.factions[me].ceasefires[f.id] ?? 0;
          const cf: GameAction = { type: 'CEASEFIRE', faction: f.id };
          const why = f.id !== me && state.config.enableDiplomacy && !f.eliminated ? explain(state, cf) : undefined;
          return (
            <div key={f.id} style={{ padding: '6px 4px', borderTop: `1px solid ${UI.rule}`, opacity: f.eliminated ? 0.45 : 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px 44px 48px', alignItems: 'center', fontSize: 12.5 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: fc.fill, border: `1px solid ${fc.edge}`, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: f.id === me ? 700 : 500 }}>
                    {f.name}{f.id === me ? ' (you)' : ''}{f.eliminated ? ' (fallen)' : ''}
                  </span>
                  {peace > 0 && <span title={`Ceasefire: ${peace} turns left`} style={{ color: UI.good, display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10.5 }}><Icon name="peace" size={11} />{peace}</span>}
                </span>
                <span className="tm-num" style={{ textAlign: 'right', fontFamily: FONT.data }}>{state.nodes.filter(n => n.owner === f.id).length}</span>
                <span className="tm-num" style={{ textAlign: 'right', fontFamily: FONT.data }}>{fog && f.id !== me ? '?' : troopsOf(state, f.id)}</span>
                <span className="tm-num" style={{ textAlign: 'right', fontFamily: FONT.data, color: UI.textSoft }}>{scoreOf(state, f.id)}</span>
              </div>
              {why !== undefined && peace === 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Cost influence={CEASEFIRE_COST} have={state.factions[me].resources} />
                  <Button small icon="peace" disabled={!!why} onClick={() => act(cf)} title={why ?? 'Neither side may attack the other for 4 turns.'}>Ceasefire</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Races({ state }: { state: GameState }) {
  const cfg = state.config;
  const alive = Object.values(state.factions).filter(f => !f.eliminated);
  return (
    <Card title="Ways to win">
      <div style={{ display: 'grid', gap: 8, fontSize: 12.5 }}>
        <div><b>Conquest.</b> <span style={{ color: UI.textSoft }}>Be the last faction standing.</span></div>
        {cfg.enableAltVictory ? (
          <>
            <div>
              <b>Economic.</b> <span style={{ color: UI.textSoft }}>Hold the target in gold at the end of your own turn.</span>
              <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                {alive.map(f => <Race key={f.id} color={FACTION_COLORS[f.id].fill} label={f.name} have={f.resources.gold} need={economicTarget(state, f.id)} />)}
              </div>
            </div>
            {cfg.enableTechTree && (
              <div>
                <b>Research.</b> <span style={{ color: UI.textSoft }}>Complete any one branch of the tree.</span>
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  {alive.map(f => {
                    const best = (Object.keys(TECH_BRANCHES) as TechBranch[])
                      .map(b => ({ b, n: TECH_BRANCHES[b].filter(id => f.research.includes(id)).length }))
                      .sort((x, y) => y.n - x.n)[0];
                    return <Race key={f.id} color={FACTION_COLORS[f.id].fill} label={`${f.name}: ${BRANCH_LABELS[best.b]}`} have={best.n} need={4} />;
                  })}
                </div>
              </div>
            )}
          </>
        ) : <Muted>Alternative victories are off in this game.</Muted>}
      </div>
    </Card>
  );
}

function Race({ color, label, have, need }: { color: string; label: string; have: number; need: number }) {
  const pct = Math.min(100, (have / need) * 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: UI.textSoft }}>
        <span>{label}</span><span className="tm-num" style={{ fontFamily: FONT.data }}>{have}/{need}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: UI.panel, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}

function Exchange({ state, act }: { state: GameState; act: (a: GameAction) => void }) {
  const me = state.activeFaction;
  const f = state.factions[me];
  const hasMarket = state.nodes.some(n => n.owner === me && n.buildings.some(b => BUILDINGS[b].family === 'market'));
  return (
    <Card title="Exchange" right={<span style={{ fontSize: 11, color: UI.textFaint }}>no action cost</span>}>
      {!hasMarket ? (
        <Muted>Build a market anywhere to trade gold for food and materials, {TRADE_LOTS_PER_TURN} lots of each a turn.</Muted>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {(['mat', 'food'] as const).map(r => {
            const buy: GameAction = { type: 'TRADE', resource: r, side: 'buy', lots: 1 };
            const sell: GameAction = { type: 'TRADE', resource: r, side: 'sell', lots: 1 };
            const bw = explain(state, buy), sw = explain(state, sell);
            return (
              <div key={r}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Chip kind={r} value={`${TRADE_LOT}`} compact />
                  <span style={{ flex: 1, fontSize: 11, color: UI.textFaint }}>{TRADE_LOTS_PER_TURN - f.traded[r]} lots left</span>
                  <Button small disabled={!!bw} onClick={() => act(buy)} title={bw ?? undefined}>Buy {TRADE_PRICES[r].buy}g</Button>
                  <Button small tone="quiet" disabled={!!sw} onClick={() => act(sell)} title={sw ?? undefined}>Sell {TRADE_PRICES[r].sell}g</Button>
                </div>
                {bw && sw && <Why text={bw} />}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
