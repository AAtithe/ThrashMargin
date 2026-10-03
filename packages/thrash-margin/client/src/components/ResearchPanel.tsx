/**
 * The tech tree: three branches of four, each tier unlocking the next.
 */
import { BRANCH_LABELS, TECH_BRANCHES, TECH_BY_ID, explain, type GameAction, type GameState, type TechBranch } from 'shared/sim';
import { FONT, UI } from '../theme';
import Icon from './Icon';
import { Button, Card, Cost, Muted } from './ui';

const BRANCH_COLOR: Record<TechBranch, string> = { military: UI.attack, economic: UI.gold, expansion: UI.move };

export default function ResearchPanel({ state, act }: { state: GameState; act: (a: GameAction) => void }) {
  const me = state.factions[state.activeFaction];
  if (!state.config.enableTechTree) return <Card><Muted>The tech tree is off in this game.</Muted></Card>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Muted style={{ fontSize: 11.5 }}>Each technology costs 1 action plus its price. {state.config.enableAltVictory ? 'Completing a branch wins the game.' : ''}</Muted>
      {(Object.keys(TECH_BRANCHES) as TechBranch[]).map(branch => (
        <Card key={branch} title={<span style={{ color: BRANCH_COLOR[branch] }}>{BRANCH_LABELS[branch]}</span>} right={<span style={{ fontSize: 11, color: UI.textFaint }}>{TECH_BRANCHES[branch].filter(id => me.research.includes(id)).length}/4</span>}>
          <div style={{ display: 'grid', gap: 6 }}>
            {TECH_BRANCHES[branch].map(id => {
              const t = TECH_BY_ID[id];
              const done = me.research.includes(id);
              const a: GameAction = { type: 'RESEARCH', techId: id };
              const why = done ? null : explain(state, a);
              const locked = !done && !!t.prereq && !me.research.includes(t.prereq);
              return (
                <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 9px', borderRadius: 6, background: done ? '#1a2a1e' : UI.panel, border: `1px solid ${done ? '#34573c' : UI.rule}`, opacity: locked ? 0.55 : 1 }}>
                  <span style={{ fontFamily: FONT.data, fontSize: 10.5, color: UI.textFaint, width: 14 }}>{t.tier}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {t.name}{done && <Icon name="check" size={12} color={UI.good} />}
                    </div>
                    <div style={{ fontSize: 11, color: UI.textSoft }}>{t.desc}</div>
                  </div>
                  {!done && (
                    <div style={{ textAlign: 'right' }}>
                      <Cost gold={t.cost.gold} mat={t.cost.mat} have={me.resources} />
                      <div style={{ marginTop: 4 }}>
                        <Button small icon="research" disabled={!!why} onClick={() => act(a)} title={why ?? undefined}>Research</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
