/**
 * Everything that interrupts the board: the turn dispatch, event decisions, the hot seat hand-
 * over, the end screen, the ledger, the help sheet, and the tutorial coach.
 */
import {
  ACHIEVEMENT_BY_ID, CAMPAIGN_SCENARIOS, FACTION_COLORS, explain, factionName, foodOf, goldOf, incomeOf,
  matOf, popOf, scoreOf, troopsOf,
  type GameAction, type GameState, type PendingEvent, type TurnReport,
} from 'shared/sim';
import { FONT, UI, signed } from '../theme';
import HistoryChart from './HistoryChart';
import Icon from './Icon';
import { Button, Chip, Label, Modal, ModalHeader, Muted, Why } from './ui';

const TONE_COLOR = { positive: UI.good, negative: UI.bad, neutral: UI.accent } as const;

// ---------------------------------------------------------------------------
// Dispatch: what happened while you were away
// ---------------------------------------------------------------------------

export function reportHasNews(r: TurnReport | undefined): boolean {
  return !!r && (r.attacksSuffered.length > 0 || r.headlines.length > 0 || !!r.event || (r.income?.starved ?? 0) > 0);
}

export function DispatchModal({ state, report, onClose }: { state: GameState; report: TurnReport; onClose: () => void }) {
  const inc = report.income;
  return (
    <Modal onClose={onClose} label="Dispatch" width={480}>
      <ModalHeader kicker={`Turn ${state.turn} · ${factionName(state, report.faction)}`} title="The dispatch" onClose={onClose} />
      <div style={{ padding: 18, display: 'grid', gap: 14 }}>
        {inc && (
          <div>
            <Label style={{ marginBottom: 6 }}>Collected at the end of your turn</Label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <Chip kind="gold" value={signed(inc.gold)} />
              <Chip kind="food" value={signed(inc.food - inc.upkeep)} title={`Grew ${inc.food}, troops ate ${inc.upkeep}`} />
              <Chip kind="mat" value={signed(inc.mat)} />
              {inc.influence > 0 && <Chip kind="influence" value={signed(inc.influence)} />}
              {inc.population > 0 && <Chip kind="pop" value={signed(inc.population)} />}
            </div>
            {inc.starved > 0 && <div style={{ color: UI.bad, fontSize: 12.5, marginTop: 6 }}>{inc.starved} troops starved for want of food.</div>}
          </div>
        )}
        {report.event && (
          <div style={{ borderLeft: `3px solid ${TONE_COLOR[report.event.tone]}`, paddingLeft: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{report.event.title}</div>
            <Muted>{report.event.message}</Muted>
          </div>
        )}
        {report.attacksSuffered.length > 0 && (
          <div>
            <Label style={{ marginBottom: 6, color: UI.bad }}>Attacks on your land</Label>
            <div style={{ display: 'grid', gap: 4 }}>
              {report.attacksSuffered.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'center' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: FACTION_COLORS[a.by]?.fill }} />
                  <span>
                    {factionName(state, a.by)} {a.captured ? <b style={{ color: UI.bad }}>took</b> : 'was repelled at'} {state.nodes[a.target].name}
                    {a.captured ? ` (${a.lost} of yours fell)` : ` (you lost ${a.lost})`}.
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {report.headlines.length > 0 && (
          <div>
            <Label style={{ marginBottom: 6 }}>Across the realm</Label>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 3, fontSize: 12.5, color: UI.textSoft }}>
              {report.headlines.slice(-8).map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        )}
        {!reportHasNews(report) && <Muted>A quiet turn.</Muted>}
        <Button tone="primary" full onClick={onClose}>To the map</Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Event decisions
// ---------------------------------------------------------------------------

export function EventModal({ state, event, act }: { state: GameState; event: PendingEvent; act: (a: GameAction) => void }) {
  return (
    <Modal label={event.title} width={440}>
      <ModalHeader kicker="A decision" title={event.title} color={TONE_COLOR[event.tone]} />
      <div style={{ padding: 18, display: 'grid', gap: 10 }}>
        <Muted style={{ fontSize: 13 }}>{event.text}</Muted>
        {event.choices.map((c, i) => {
          const a: GameAction = { type: 'CHOICE', choiceIndex: i };
          const why = explain(state, a);
          return (
            <div key={i}>
              <button type="button" className="tm-btn tm-row-hover" disabled={!!why} onClick={() => act(a)}
                style={{ width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8, background: UI.panelRaised, border: `1px solid ${UI.ruleStrong}`, cursor: why ? 'not-allowed' : 'pointer' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.label}</div>
                <div style={{ fontSize: 12, color: UI.textSoft }}>{c.desc}</div>
              </button>
              <Why text={why} />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Hot seat hand-over
// ---------------------------------------------------------------------------

export function PassScreen({ state, onReady }: { state: GameState; onReady: () => void }) {
  const fc = FACTION_COLORS[state.activeFaction];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, background: UI.ground, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ width: 54, height: 54, borderRadius: 12, margin: '0 auto 16px', background: fc.fill, border: `2px solid ${fc.edge}` }} />
        <Label>Turn {state.turn} · hot seat</Label>
        <h2 style={{ fontFamily: FONT.display, fontSize: 28, margin: '8px 0 6px' }}>{factionName(state, state.activeFaction)}</h2>
        <Muted style={{ fontSize: 13 }}>Pass the device. The other player should look away until you press ready.</Muted>
        <div style={{ marginTop: 20 }}><Button tone="primary" onClick={onReady}>I am ready</Button></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// End of the game
// ---------------------------------------------------------------------------

export function VictoryScreen({ state, onLobby, onNext, onClose }: { state: GameState; onLobby: () => void; onNext?: () => void; onClose: () => void }) {
  const won = state.status === 'victory';
  const winner = state.winner;
  const how = state.victoryType === 'economic' ? 'an economic victory' : state.victoryType === 'research' ? `mastery of ${state.researchBranch} research` : 'conquest';
  const me = state.factions[1];
  const earned = state.achievements.map(id => ACHIEVEMENT_BY_ID[id]).filter(Boolean);
  const nextAct = state.config.campaignScenario !== undefined ? CAMPAIGN_SCENARIOS[state.config.campaignScenario + 1] : undefined;
  return (
    <Modal label="Game over" width={560} onClose={onClose}>
      <ModalHeader
        onClose={onClose}
        kicker={`Turn ${state.turn}`}
        color={won ? UI.good : UI.bad}
        title={winner !== null ? `${factionName(state, winner)} wins by ${how}` : won ? 'Victory' : 'Defeat'}
      />
      <div style={{ padding: 18, display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[
            ['Battles won', me.stats.battlesWon],
            ['Captures', me.stats.captures],
            ['Troops lost', me.stats.troopsLost],
            ['Score', scoreOf(state, 1)],
          ].map(([l, v]) => (
            <div key={l as string} style={{ background: UI.panelRaised, borderRadius: 8, padding: 10, border: `1px solid ${UI.rule}` }}>
              <div style={{ fontSize: 10.5, color: UI.textFaint }}>{l}</div>
              <div className="tm-num" style={{ fontFamily: FONT.data, fontSize: 18, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
        <div>
          <Label style={{ marginBottom: 8 }}>How it went</Label>
          <HistoryChart state={state} />
        </div>
        {earned.length > 0 && (
          <div>
            <Label style={{ marginBottom: 6 }}>Achievements this game</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {earned.map(a => (
                <span key={a.id} title={a.desc} style={{ padding: '4px 9px', borderRadius: 12, border: `1px solid ${UI.accent}`, color: UI.accent, fontSize: 11.5 }}>{a.name}</span>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button tone="quiet" onClick={onClose}>Look at the map</Button>
          <Button tone="quiet" onClick={onLobby}>Back to the lobby</Button>
          {won && nextAct && onNext && <Button tone="primary" icon="next" onClick={onNext}>{nextAct.title}</Button>}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The ledger: a profit-and-loss by territory
// ---------------------------------------------------------------------------

export function LedgerModal({ state, onClose, onPick }: { state: GameState; onClose: () => void; onPick: (id: number) => void }) {
  const me = state.activeFaction;
  const research = state.factions[me].research;
  const owned = state.nodes.filter(n => n.owner === me).sort((a, b) => goldOf(b, research) - goldOf(a, research));
  const inc = incomeOf(state, me);
  const raw = owned.reduce((s, t) => ({ gold: s.gold + goldOf(t, research), food: s.food + foodOf(t), mat: s.mat + matOf(t, research), pop: s.pop + popOf(t) }), { gold: 0, food: 0, mat: 0, pop: 0 });
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: UI.textFaint, fontSize: 11 };
  const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontFamily: FONT.data, fontSize: 12.5 };
  return (
    <Modal onClose={onClose} label="Ledger" width={620}>
      <ModalHeader kicker={`Turn ${state.turn}`} title="The ledger" onClose={onClose} />
      <div style={{ padding: 18, display: 'grid', gap: 16 }}>
        <Muted>Income per turn by territory, then what the army costs. The margin is what is left to build, recruit and research with.</Muted>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${UI.ruleStrong}` }}>
                <th style={{ ...th, textAlign: 'left' }}>Territory</th>
                <th style={th}>Troops</th><th style={th}>Gold</th><th style={th}>Food</th><th style={th}>Materials</th><th style={th}>Pop</th>
              </tr>
            </thead>
            <tbody>
              {owned.map(t => (
                <tr key={t.id} className="tm-row-hover" style={{ borderBottom: `1px solid ${UI.rule}`, cursor: 'pointer' }} onClick={() => { onPick(t.id); onClose(); }}>
                  <td style={{ ...td, textAlign: 'left', fontFamily: FONT.body }}>
                    {t.capital && <Icon name="capital" size={12} color={UI.accent} style={{ marginRight: 4 }} />}{t.name}
                  </td>
                  <td style={td}>{t.troops}</td>
                  <td style={{ ...td, color: UI.gold }}>{goldOf(t, research)}</td>
                  <td style={{ ...td, color: UI.food }}>{foodOf(t)}</td>
                  <td style={{ ...td, color: UI.mat }}>{matOf(t, research)}</td>
                  <td style={{ ...td, color: UI.pop }}>{popOf(t)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${UI.ruleStrong}` }}>
                <td style={{ ...td, textAlign: 'left', fontFamily: FONT.body, color: UI.textSoft }}>Production</td>
                <td style={td}>{troopsOf(state, me)}</td>
                <td style={td}>{raw.gold}</td><td style={td}>{raw.food}</td><td style={td}>{raw.mat}</td><td style={td}>{raw.pop}</td>
              </tr>
              {inc.gold !== raw.gold && (
                <tr><td style={{ ...td, textAlign: 'left', fontFamily: FONT.body, color: UI.textSoft }}>Trade routes</td><td style={td} /><td style={td}>{signed(inc.gold - raw.gold)}</td><td style={td} /><td style={td} /><td style={td} /></tr>
              )}
              <tr><td style={{ ...td, textAlign: 'left', fontFamily: FONT.body, color: UI.textSoft }}>Troop upkeep</td><td style={td} /><td style={td} /><td style={{ ...td, color: UI.bad }}>-{inc.upkeep}</td><td style={td} /><td style={td} /></tr>
              <tr style={{ borderTop: `2px solid ${UI.ruleStrong}` }}>
                <td style={{ ...td, textAlign: 'left', fontFamily: FONT.body, fontWeight: 700 }}>Margin per turn</td><td style={td} />
                <td style={{ ...td, fontWeight: 700 }}>{signed(inc.gold)}</td>
                <td style={{ ...td, fontWeight: 700, color: inc.foodNet < 0 ? UI.bad : UI.text }}>{signed(inc.foodNet)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{signed(inc.mat)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{signed(inc.population)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <Label style={{ marginBottom: 8 }}>History</Label>
          <HistoryChart state={state} height={160} />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['Select', 'Click one of your territories. Hostile neighbours glow orange, your other territories teal.'],
    ['Attack', 'Click a hostile neighbour. Every one of your territories bordering it can send a column; the forecast is exact when you can see the defenders. 2 actions.'],
    ['Combat', 'Odds = your strength against its troops plus fixed defence (capital, level, towers, terrain). Below 1 : 1 you lose the lot; 1.8 : 1 wins for about a third of your force.'],
    ['March', 'Click any of your territories reachable through your own land. 1 action next door, 2 farther.'],
    ['Recruit', 'Costs gold, no actions, up to the territory\'s capacity. Every troop eats 1 food a turn.'],
    ['Build and raise', 'Buildings fill slots; raising a settlement adds slots, capacity, gold and food. 1 action each.'],
    ['Food', 'If upkeep outruns farms and stores, troops starve from your largest garrison down.'],
    ['Capitals', 'Taking one plunders a quarter of its owner\'s gold, and their court moves to their next best territory.'],
    ['Undo', 'Recruiting, building, marching, research, trade and annexing can be undone until you attack, spy or end the turn.'],
    ['Keys', 'Esc clears the selection · E ends the turn · Z undoes · L opens the ledger · ? opens this sheet.'],
  ];
  return (
    <Modal onClose={onClose} label="How to play" width={560}>
      <ModalHeader kicker="Thrash Margin" title="How to play" onClose={onClose} />
      <div style={{ padding: 18, display: 'grid', gap: 10 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, fontSize: 12.5 }}>
            <b>{k}</b><span style={{ color: UI.textSoft, lineHeight: 1.5 }}>{v}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tutorial coach
// ---------------------------------------------------------------------------

export function coachStep(state: GameState, selected: number | null, target: number | null): { title: string; text: string } {
  const me = state.factions[1];
  const cap = state.nodes.find(n => n.owner === 1 && n.capital);
  if (me.stats.captures === 0) {
    if (selected === null || state.nodes[selected].owner !== 1) return { title: 'Select your capital', text: `Click ${cap?.name ?? 'your capital'}, the territory with the crown. Its badge shows its troops.` };
    if (target === null) return { title: 'Pick a target', text: 'Orange outlines are neighbours you can attack. Click Meadowkeep: a farm already stands there.' };
    return { title: 'Read the forecast', text: 'The forecast shows exactly what the attack will cost. Aim for odds of 1.8 : 1 or better, then press Attack.' };
  }
  const built = state.nodes.some(n => n.owner === 1 && n.buildings.length > 0 && n.id !== 1);
  if (!built) return { title: 'Build for the future', text: 'Select a territory you own and build a farm or a mine. Farms feed troops; every troop eats 1 food a turn.' };
  if (state.turn === 1) return { title: 'End the turn', text: 'Press End turn. You collect income, the rival moves, and a dispatch tells you what happened.' };
  if (state.nodes.filter(n => n.owner === 1).length < 4) return { title: 'Expand', text: 'Recruiting costs gold but no actions. Recruit, then take more neutral land: each territory adds gold and food.' };
  return { title: 'Take Ashpeak', text: 'The rival capital is fortified. Bring columns from every territory bordering it into one assault.' };
}

export function Coach({ state, selected, target }: { state: GameState; selected: number | null; target: number | null }) {
  const s = coachStep(state, selected, target);
  return (
    <div style={{ background: '#16261c', border: `1px solid #3b6b48`, borderRadius: 8, padding: 12 }}>
      <Label style={{ color: UI.good, marginBottom: 4 }}>Tutorial</Label>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 3 }}>{s.title}</div>
      <Muted>{s.text}</Muted>
    </div>
  );
}
