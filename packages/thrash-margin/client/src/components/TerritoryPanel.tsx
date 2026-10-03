/**
 * The selected territory: what it produces, what defends it, and (if it is yours) recruiting,
 * building and raising the settlement. For anybody else's territory, intelligence and spies.
 */
import { useEffect, useState } from 'react';
import {
  BASE_BUILDINGS, BUILDING_UPGRADES, BUILDINGS, LEVELS, MAX_LV, SPY_REVEAL_COST, SPY_SABOTAGE_COST,
  defenceOf, explain, factionName, foodOf, fortificationOf, goldOf, matOf, neighboursOf, popOf,
  slotsOf, terrainOf, troopCapOf, upgradeCost, FACTION_COLORS, NEUTRAL,
  type BuildingType, type GameAction, type GameState, type Territory,
} from 'shared/sim';
import { FONT, UI, signed } from '../theme';
import Icon from './Icon';
import { PIP } from './MapView';
import { Button, Card, Chip, Cost, Label, Muted, Stat, Stepper, Why } from './ui';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

interface Props {
  state: GameState;
  node: Territory;
  visible: boolean;
  act: (a: GameAction) => void;
  onPlanAssault: (target: number) => void;
}

export default function TerritoryPanel({ state, node, visible, act, onPlanAssault }: Props) {
  const me = state.activeFaction;
  const mine = node.owner === me;
  const f = state.factions[me];
  const research = state.factions[node.owner]?.research ?? [];
  const fc = FACTION_COLORS[node.owner] ?? FACTION_COLORS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: fc.fill, border: `1px solid ${fc.edge}` }} />
          <h3 style={{ margin: 0, fontFamily: FONT.display, fontSize: 19, fontWeight: 600 }}>{node.name}</h3>
          <span style={{ fontFamily: FONT.data, fontSize: 12, color: UI.textSoft }}>Lv {ROMAN[node.lv]}</span>
          <span style={{ flex: 1 }} />
          {node.capital && <span title="Capital" style={{ color: UI.accent }}><Icon name="capital" size={15} /></span>}
          {node.stronghold && <span title="Stronghold: +3 gold" style={{ color: '#f0b64f' }}><Icon name="stronghold" size={15} /></span>}
        </div>
        <Muted style={{ marginTop: 4 }}>
          {node.owner === NEUTRAL ? 'Neutral' : factionName(state, node.owner)} · {terrainOf(node.terrain).label}: {terrainOf(node.terrain).note}
        </Muted>
        {visible ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 12px', marginTop: 12 }}>
            <Stat label="Troops" value={`${node.troops}/${troopCapOf(node)}`} />
            <Stat label="Defence" value={defenceOf(node, research)} sub={`${node.troops} + ${fortificationOf(node, research)} fixed`} />
            <Stat label="Slots" value={`${node.buildings.length}/${slotsOf(node)}`} />
            <Stat label="Gold" value={signed(goldOf(node, research))} color={UI.gold} />
            <Stat label="Food" value={signed(foodOf(node))} color={UI.food} />
            <Stat label="Materials" value={signed(matOf(node, research))} color={UI.mat} />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: UI.textSoft, fontSize: 12 }}>
            <Icon name="fog" /> Beyond your sight. Its garrison and buildings are unknown.
          </div>
        )}
        {visible && node.buildings.length > 0 && !mine && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {node.buildings.map((b, i) => <BuildingTag key={i} b={b} />)}
          </div>
        )}
      </Card>

      {mine ? (
        <>
          <Recruit state={state} node={node} act={act} />
          <Buildings state={state} node={node} act={act} />
          <Settlement state={state} node={node} act={act} />
          <Muted style={{ fontSize: 11.5 }}>
            Click a highlighted neighbour to attack it, or any of your territories to march troops there.
          </Muted>
        </>
      ) : (
        <>
          {neighboursOf(state, node.id).some(m => state.nodes[m].owner === me) && (
            <Button tone="attack" icon="attack" full onClick={() => onPlanAssault(node.id)}>Plan an assault on {node.name}</Button>
          )}
          {state.config.enableSpies && (
            <Card title="Spies" right={<Chip kind="influence" value={f.resources.influence} compact />}>
              <div style={{ display: 'grid', gap: 8 }}>
                <SpyRow
                  label="Watch it" desc={`See its garrison for 3 turns`} cost={SPY_REVEAL_COST}
                  why={explain(state, { type: 'SPY', nodeId: node.id, mode: 'reveal' })}
                  onClick={() => act({ type: 'SPY', nodeId: node.id, mode: 'reveal' })}
                />
                <SpyRow
                  label="Sabotage" desc="Wreck its best building one tier" cost={SPY_SABOTAGE_COST}
                  why={explain(state, { type: 'SPY', nodeId: node.id, mode: 'sabotage' })}
                  onClick={() => act({ type: 'SPY', nodeId: node.id, mode: 'sabotage' })}
                />
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SpyRow({ label, desc, cost, why, onClick }: { label: string; desc: string; cost: number; why: string | null; onClick: () => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 11, color: UI.textSoft }}>{desc}</div>
        </div>
        <Cost influence={cost} />
        <Button small icon="spy" onClick={onClick} disabled={!!why}>Go</Button>
      </div>
      <Why text={why} />
    </div>
  );
}

function BuildingTag({ b }: { b: BuildingType }) {
  const d = BUILDINGS[b];
  return (
    <span title={d.desc} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 7px', borderRadius: 5, background: UI.panel, border: `1px solid ${UI.rule}`, fontSize: 11.5 }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: PIP[d.family] }} />{d.name}
    </span>
  );
}

function Recruit({ state, node, act }: { state: GameState; node: Territory; act: (a: GameAction) => void }) {
  const f = state.factions[state.activeFaction];
  const cost = state.config.recruitCost;
  const room = troopCapOf(node) - node.troops;
  const max = Math.max(0, Math.min(room, Math.floor(f.resources.gold / cost)));
  const [n, setN] = useState(Math.min(5, max));
  useEffect(() => { setN(v => Math.max(max ? 1 : 0, Math.min(v || Math.min(5, max), max))); }, [max, node.id]);
  const action: GameAction = { type: 'RECRUIT', nodeId: node.id, amount: Math.max(1, n) };
  const why = explain(state, action);
  return (
    <Card title="Recruit" right={<span style={{ fontSize: 11, color: UI.textFaint }}>{cost} gold each · no action cost</span>}>
      {room < 1 ? (
        <Muted>At capacity ({troopCapOf(node)}). Barracks, forts and higher levels raise it.</Muted>
      ) : (
        <>
          <Stepper value={n} min={max ? 1 : 0} max={max} onChange={setN} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontSize: 11.5, color: UI.textSoft }}>Upkeep {state.config.upkeep * Math.max(1, n)} food a turn</span>
            <Button small tone="primary" icon="troops" disabled={!!why || n < 1} onClick={() => act(action)}>Recruit {n} for {n * cost}</Button>
          </div>
          <Why text={max < 1 ? why : null} />
        </>
      )}
    </Card>
  );
}

function Buildings({ state, node, act }: { state: GameState; node: Territory; act: (a: GameAction) => void }) {
  const f = state.factions[state.activeFaction];
  const free = slotsOf(node) - node.buildings.length;
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [node.id]);
  return (
    <Card title={`Buildings ${node.buildings.length}/${slotsOf(node)}`}>
      <div style={{ display: 'grid', gap: 6 }}>
        {node.buildings.map((b, i) => {
          const up = BUILDING_UPGRADES[b];
          const a: GameAction | null = up ? { type: 'BUILD', nodeId: node.id, building: up } : null;
          const why = a ? explain(state, a) : null;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: UI.panel, borderRadius: 6, border: `1px solid ${UI.rule}` }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: PIP[BUILDINGS[b].family] }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{BUILDINGS[b].name}</div>
                <div style={{ fontSize: 11, color: UI.textSoft }}>{BUILDINGS[b].desc}</div>
              </div>
              {up && a && (
                <div style={{ textAlign: 'right' }}>
                  <Button small icon="upgrade" disabled={!!why} onClick={() => act(a)} title={why ?? `Upgrade to ${BUILDINGS[up].name}: ${BUILDINGS[up].desc}`}>{BUILDINGS[up].name}</Button>
                  <div style={{ marginTop: 3 }}><Cost gold={BUILDINGS[up].cost.gold} mat={BUILDINGS[up].cost.mat} have={f.resources} /></div>
                </div>
              )}
            </div>
          );
        })}
        {free > 0 && !open && (
          <Button icon="build" onClick={() => setOpen(true)} full>{`Build in ${free === 1 ? 'the free slot' : `one of ${free} free slots`}`}</Button>
        )}
        {free > 0 && open && (
          <div style={{ display: 'grid', gap: 6 }}>
            {BASE_BUILDINGS.map(b => {
              const a: GameAction = { type: 'BUILD', nodeId: node.id, building: b };
              const why = explain(state, a);
              return (
                <button key={b} type="button" className="tm-btn tm-row-hover" disabled={!!why} onClick={() => { act(a); setOpen(false); }} title={why ?? undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 6, background: UI.panelSunk, border: `1px solid ${UI.rule}`, cursor: why ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: why ? 0.55 : 1 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: PIP[BUILDINGS[b].family] }} />
                  <span style={{ flex: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block' }}>{BUILDINGS[b].name}</span>
                    <span style={{ fontSize: 11, color: UI.textSoft }}>{BUILDINGS[b].desc}</span>
                  </span>
                  <Cost gold={BUILDINGS[b].cost.gold} mat={BUILDINGS[b].cost.mat} have={f.resources} />
                </button>
              );
            })}
            <Button small tone="quiet" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        )}
        {free <= 0 && node.buildings.length === 0 && <Muted>No slots.</Muted>}
      </div>
      <div style={{ fontSize: 11, color: UI.textFaint, marginTop: 8 }}>Building or upgrading costs 1 action.</div>
    </Card>
  );
}

function Settlement({ state, node, act }: { state: GameState; node: Territory; act: (a: GameAction) => void }) {
  const f = state.factions[state.activeFaction];
  const cost = upgradeCost(node);
  if (!cost) return <Card title="Settlement"><Muted>{node.name} is at the highest level.</Muted></Card>;
  const to = node.lv + 1;
  const a: GameAction = { type: 'UPGRADE', nodeId: node.id };
  const why = explain(state, a);
  return (
    <Card title={`Raise to level ${ROMAN[to]}`} right={<Cost gold={cost.gold} mat={cost.mat} pop={cost.pop} have={f.resources} />}>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: UI.textSoft, flexWrap: 'wrap' }}>
        <span>Slots {LEVELS.slots[node.lv]} → <b style={{ color: UI.text }}>{LEVELS.slots[to]}</b></span>
        <span>Capacity +{LEVELS.troopCap[to] - LEVELS.troopCap[node.lv]}</span>
        <span>Gold +{LEVELS.gold[to] - LEVELS.gold[node.lv]}</span>
        <span>Food +{LEVELS.food[to] - LEVELS.food[node.lv]}</span>
        <span>Defence +{to > 1 ? (node.lv > 1 ? 1 : 2) : 0}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <Button small icon="upgrade" disabled={!!why || node.lv >= MAX_LV} onClick={() => act(a)}>Raise settlement</Button>
      </div>
      <Why text={why} />
      {popOf(node) > 0 && <div style={{ fontSize: 11, color: UI.textFaint, marginTop: 6 }}>Farms here grow {popOf(node)} population a turn.</div>}
    </Card>
  );
}

export { Label };
