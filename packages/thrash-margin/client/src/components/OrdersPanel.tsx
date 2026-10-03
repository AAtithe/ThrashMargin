/**
 * Orders against a target: an assault (with a column from every bordering territory and a live
 * preview of the exact outcome), a peaceful annexation, or a march between your own territories.
 */
import { useEffect, useState } from 'react';
import {
  annexCost, apCost, explain, factionName, friendlyPath, troopCapOf, FACTION_COLORS, NEUTRAL,
  type GameAction, type GameState,
} from 'shared/sim';
import { attackFrom, possibleColumns, previewAttack } from '../game/plan';
import { FONT, UI } from '../theme';
import Icon from './Icon';
import { Button, Card, Cost, Muted, Stepper, Why } from './ui';

interface Props {
  state: GameState;
  selected: number;
  target: number;
  visible: boolean;
  columns: Map<number, number>;
  setColumns: (m: Map<number, number>) => void;
  act: (a: GameAction) => void;
  onCancel: () => void;
}

export function AttackOrders({ state, target, visible, columns, setColumns, act, onCancel }: Omit<Props, 'selected'>) {
  const t = state.nodes[target];
  const cols = possibleColumns(state, target);
  const action = attackFrom(target, columns);
  const why = action ? explain(state, action) : 'Commit at least one troop.';
  const p = previewAttack(state, target, columns);
  const fc = FACTION_COLORS[t.owner] ?? FACTION_COLORS[0];
  const cost = action ? apCost(state, action) : 2;
  const annex: GameAction = { type: 'ANNEX', nodeId: target };
  const annexWhy = state.config.enableDiplomacy && t.owner === NEUTRAL ? explain(state, annex) : undefined;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="attack" color={UI.attack} size={16} />
          <h3 style={{ margin: 0, fontFamily: FONT.display, fontSize: 18, fontWeight: 600, flex: 1 }}>Assault on {t.name}</h3>
          <button type="button" onClick={onCancel} aria-label="Cancel" style={{ background: 'none', border: 'none', color: UI.textSoft, cursor: 'pointer' }}><Icon name="close" /></button>
        </div>
        <Muted style={{ marginTop: 4 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: fc.fill, marginRight: 6 }} />
          {t.owner === NEUTRAL ? 'Held by the local militia' : `Held by ${factionName(state, t.owner)}`}
          {visible ? ` · ${t.troops} troops, defence ${p?.defence ?? '?'}` : ' · strength unknown'}
        </Muted>
      </Card>

      <Card title="Columns" right={<span style={{ fontSize: 11, color: UI.textFaint }}>every bordering territory may join</span>}>
        <div style={{ display: 'grid', gap: 10 }}>
          {cols.length === 0 && <Muted>None of your territories bordering {t.name} has troops to spare.</Muted>}
          {cols.map(c => (
            <Stepper
              key={c.id} label={<span style={{ display: 'inline-block', width: 92 }}>{state.nodes[c.id].name}</span>}
              value={columns.get(c.id) ?? 0} min={0} max={c.max}
              onChange={n => { const m = new Map(columns); if (n > 0) m.set(c.id, n); else m.delete(c.id); setColumns(m); }}
            />
          ))}
        </div>
      </Card>

      <Card title="Forecast">
        {!p ? <Muted>Commit troops to see the outcome.</Muted> : !visible ? (
          <Muted>Your scouts cannot see {t.name}'s garrison. This is a blind attack: {p.sent} troops at strength {p.attack.toFixed(1)} against an unknown defence.</Muted>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: FONT.display, fontSize: 20, fontWeight: 600, color: p.won ? UI.good : UI.bad }}>{p.won ? 'Victory' : 'Defeat'}</span>
              <span style={{ fontSize: 12.5, color: UI.textSoft }}>{p.tier} · odds {p.ratio.toFixed(2)} : 1</span>
            </div>
            <RatioBar ratio={p.ratio} />
            <div style={{ fontSize: 12.5, color: UI.text, marginTop: 8, lineHeight: 1.55 }}>
              {p.won
                ? <>You lose <b>{p.attackerLoss}</b> of {p.sent}; <b>{p.surviving}</b> occupy {t.name}{p.surviving > troopCapOf(t) ? ' (over its capacity until you raise it)' : ''}.</>
                : <>All <b>{p.sent}</b> are lost; the defenders lose <b>{p.defenderLoss}</b> of {t.troops}.</>}
              {t.capital && p.won && t.owner !== NEUTRAL && <> Their capital falls and you plunder a quarter of their gold.</>}
            </div>
            {!p.won && (
              <div style={{ fontSize: 11.5, color: UI.warn, marginTop: 6 }}>You need odds of at least 1 : 1 to win; 1.8 : 1 keeps losses to about a third.</div>
            )}
          </>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <Button tone="attack" icon="attack" disabled={!!why} onClick={() => action && act(action)} style={{ flex: 1 }}>
            Attack · {cost} action{cost === 1 ? '' : 's'}
          </Button>
        </div>
        <Why text={action ? why : null} />
      </Card>

      {annexWhy !== undefined && (
        <Card title="Or annex peacefully" right={<Cost influence={annexCost(state.factions[state.activeFaction])} have={state.factions[state.activeFaction].resources} />}>
          <Muted>Spend influence to take {t.name} without a fight. Half its militia joins you.</Muted>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <Button small icon="annex" disabled={!!annexWhy} onClick={() => act(annex)}>Annex · 1 action</Button>
          </div>
          <Why text={annexWhy} />
        </Card>
      )}
    </div>
  );
}

function RatioBar({ ratio }: { ratio: number }) {
  // 0 .. 3 : 1 scale with the tier thresholds marked
  const pos = (r: number) => `${Math.min(100, (r / 3) * 100)}%`;
  return (
    <div style={{ position: 'relative', height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${UI.bad} 0%, ${UI.bad} 33%, ${UI.warn} 33%, ${UI.warn} 60%, ${UI.good} 60%)`, marginTop: 8, opacity: 0.9 }}>
      {[1, 1.3, 1.8, 2.5].map(r => <span key={r} style={{ position: 'absolute', left: pos(r), top: -2, width: 1, height: 12, background: UI.ground }} />)}
      <span style={{ position: 'absolute', left: pos(ratio), top: -4, width: 4, height: 16, marginLeft: -2, borderRadius: 2, background: '#fff', boxShadow: '0 0 0 2px rgba(0,0,0,0.5)' }} />
    </div>
  );
}

export function MoveOrders({ state, selected, target, act, onCancel }: Omit<Props, 'columns' | 'setColumns' | 'visible'>) {
  const from = state.nodes[selected];
  const to = state.nodes[target];
  const room = troopCapOf(to) - to.troops;
  const max = Math.max(0, Math.min(from.troops - 1, room));
  const [n, setN] = useState(max);
  useEffect(() => { setN(Math.max(0, Math.min(from.troops - 1, troopCapOf(to) - to.troops))); }, [selected, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const path = friendlyPath(state, state.activeFaction, selected, target);
  const action: GameAction = { type: 'MOVE', fromId: selected, toId: target, troops: Math.max(1, n) };
  const why = explain(state, action);
  const cost = apCost(state, action);
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon name="move" color={UI.move} size={16} />
        <h3 style={{ margin: 0, fontFamily: FONT.display, fontSize: 18, fontWeight: 600, flex: 1 }}>March to {to.name}</h3>
        <button type="button" onClick={onCancel} aria-label="Cancel" style={{ background: 'none', border: 'none', color: UI.textSoft, cursor: 'pointer' }}><Icon name="close" /></button>
      </div>
      <Muted>
        From {from.name} ({from.troops}) {path && path.length > 2 ? `via ${path.slice(1, -1).map(i => state.nodes[i].name).join(', ')} ` : ''}to {to.name} ({to.troops}/{troopCapOf(to)}).
      </Muted>
      <div style={{ marginTop: 10 }}>
        {max < 1 ? <Muted style={{ color: UI.warn }}>{why}</Muted> : <Stepper value={n} min={1} max={max} onChange={setN} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <Button tone="move" icon="move" disabled={!!why || max < 1} onClick={() => act(action)}>March {n} · {cost} action{cost === 1 ? '' : 's'}</Button>
      </div>
      {max >= 1 && <Why text={why} />}
    </Card>
  );
}
