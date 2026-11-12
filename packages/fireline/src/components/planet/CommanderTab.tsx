/**
 * War for the Planet: the Commander screen (fireline-planet-design.md, sections 6.4 and 17). W4.
 * The story campaign's perks and their cards (the campaign's own fl-perk styling), with the war's
 * longer rank ladder. Learning a perk is the `perk` order, checked by the reducer.
 */
import { RankInsignia } from '../CampaignArt';
import { PERKS, RANKS } from '../../campaign/progression';
import type { PerkBranch } from '../../campaign/types';
import { PLANET_RANKS, planetRankFor } from '../../planet/turn';
import { UI } from '../../theme';
import { why, type PlanetProps } from './common';

const BRANCHES: { key: PerkBranch; title: string; blurb: string }[] = [
  { key: 'economy', title: 'Economy', blurb: 'More credits, sooner, in every battle.' },
  { key: 'industry', title: 'Industry', blurb: 'Build faster and cheaper in battle.' },
  { key: 'command', title: 'Command', blurb: 'Tougher units and support powers.' },
];

export default function CommanderTab({ s, act }: PlanetProps) {
  const c = s.commander;
  const i = planetRankFor(c.xp);
  const lo = PLANET_RANKS[i].xp;
  const hi = PLANET_RANKS[i + 1]?.xp ?? null;
  const frac = hi ? Math.max(0, Math.min(1, (c.xp - lo) / (hi - lo))) : 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="planet-commander">
      <section className="fl-pl-card">
        <div className="fl-commander">
          <RankInsignia rank={Math.min(i, RANKS.length - 1)} size={56} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
            <span className="fl-eyebrow">{PLANET_RANKS[i].name}</span>
            <strong className="fl-commander-name">{c.name}</strong>
            <span className="fl-bar fl-bar-xp fl-bar-wide">
              <span style={{ width: `${Math.round(frac * 100)}%` }} />
            </span>
            <span className="fl-small">
              {hi ? `${c.xp.toLocaleString('en-GB')} / ${hi.toLocaleString('en-GB')} xp to ${PLANET_RANKS[i + 1].name}` : `${c.xp.toLocaleString('en-GB')} xp, highest rank`}
              {' · '}
              <span style={{ color: c.points ? UI.accent : undefined }}>
                {c.points} skill {c.points === 1 ? 'point' : 'points'}
              </span>
            </span>
          </div>
        </div>
        <p className="fl-small" style={{ margin: 0 }}>
          Xp for every battle you lead: a won attack more for a bigger city, a won defence, a little even for a loss, and 2 for each kill in battles you fight
          yourself. A skill point for every rank. Perks apply to every battle you fight in this war.
        </p>
      </section>
      <div className="fl-branches">
        {BRANCHES.map(br => (
          <section key={br.key} className="fl-branch" aria-label={br.title}>
            <h3>{br.title}</h3>
            <p className="fl-small">{br.blurb}</p>
            {PERKS.filter(p => p.branch === br.key).map(p => {
              const level = c.perks[p.id] ?? 0;
              const maxed = level >= p.maxLevel;
              const problem = maxed ? null : why(s, { type: 'perk', perk: p.id });
              return (
                <div key={p.id} className="fl-perk" data-level={level} data-maxed={maxed ? '1' : '0'} data-testid={`planet-perk-${p.id}`}>
                  <div className="fl-perk-head">
                    <strong>{p.name}</strong>
                    <span className="fl-pips" aria-label={`Level ${level} of ${p.maxLevel}`}>
                      {Array.from({ length: p.maxLevel }, (_, j) => (
                        <span key={j} data-on={j < level ? '1' : '0'} />
                      ))}
                    </span>
                  </div>
                  <span className="fl-small">{p.blurb}</span>
                  {maxed ? (
                    <span className="fl-tag" style={{ alignSelf: 'flex-start', color: UI.good, borderColor: UI.good }}>
                      Learned
                    </span>
                  ) : (
                    <button type="button" className="fl-camp-btn primary" disabled={!!problem} title={problem ?? undefined} onClick={() => act({ type: 'perk', perk: p.id })}>
                      Learn · {p.cost[level]} {p.cost[level] === 1 ? 'point' : 'points'}
                    </button>
                  )}
                  {problem && <span className="fl-small fl-perk-why">{problem}</span>}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
