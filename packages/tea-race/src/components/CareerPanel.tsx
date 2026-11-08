import {
  BRANCH_NAMES,
  LEVEL_XP,
  MAX_LEVEL,
  SKILLS,
  canLearn,
  careerOn,
  hasSkill,
  levelProgress,
  skillPoints,
  type Branch,
  type Skill,
} from '../sim/career';
import { FONT, UI } from '../theme';
import { Label, Panel, bodySmall, dataText } from './ui';
import type { Captain, GameAction, GameState } from '../sim/types';

/**
 * The captain's career: level, experience, and the skill tree to spend points on.
 *
 * Drawn as a tree rather than a list on purpose. The interesting decision is which branch to climb,
 * and a tree shows at a glance what each choice locks in and what it leads to.
 */
export default function CareerPanel({
  state,
  captain,
  dispatch,
  enabled,
}: {
  state: GameState;
  captain: Captain;
  dispatch: (action: GameAction) => void;
  enabled: boolean;
}) {
  if (!careerOn(state)) return null;
  const { level, into, span } = levelProgress(captain.xp);
  const points = skillPoints(captain);
  const branches: Branch[] = ['seamanship', 'trade', 'command'];

  return (
    <Panel title="Your career" aside={<Label>{points > 0 ? `${points} point${points === 1 ? '' : 's'} to spend` : `level ${level}`}</Label>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center' }}>
          <LevelBadge level={level} colour={captain.colour} glowing={points > 0} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontFamily: FONT.display, fontSize: '0.9rem', color: UI.text }}>
              {captain.name}, {rankName(level)}
            </span>
            <span style={track} role="progressbar" aria-valuemin={0} aria-valuemax={span} aria-valuenow={into}>
              <span style={{ ...fill, width: `${Math.round((into / span) * 100)}%` }} />
            </span>
            <span style={{ ...dataText, fontSize: '0.64rem', color: UI.textFaint }}>
              {level >= MAX_LEVEL
                ? `${captain.xp ?? 0} experience, the top of the list`
                : `${captain.xp ?? 0} experience · level ${level + 1} at ${LEVEL_XP[level]}`}
            </span>
          </div>
        </div>

        <div style={tree}>
          {branches.map(branch => (
            <div key={branch} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0, minWidth: 0 }}>
              <span style={{ ...dataText, fontSize: '0.58rem', letterSpacing: '0.14em', color: UI.textFaint, textAlign: 'center', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                {BRANCH_NAMES[branch]}
              </span>
              {SKILLS.filter(s => s.branch === branch).map((skill, i) => (
                <div key={skill.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                  {i > 0 && (
                    <span
                      style={{
                        alignSelf: 'center',
                        width: 2,
                        height: 10,
                        background: hasSkill(captain, skill.id) ? UI.brass : UI.rule,
                      }}
                    />
                  )}
                  <SkillNode
                    skill={skill}
                    learned={hasSkill(captain, skill.id)}
                    learnable={enabled && canLearn(captain, skill.id)}
                    onLearn={() => dispatch({ type: 'LEARN_SKILL', skill: skill.id })}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
        <p style={{ ...bodySmall, fontSize: '0.7rem', margin: 0, color: UI.textFaint }}>
          Experience comes from landing cargo, first homes, the tea race, charters, encounters taken up
          and weather and pirates weathered. A captain behind on shares learns faster.
        </p>
      </div>
    </Panel>
  );
}

const RANKS = ['Second mate', 'First mate', 'Master', 'Captain', 'Senior captain', 'Commander', 'Commodore', 'Shipowner', 'Merchant venturer'];
export const rankName = (level: number): string => RANKS[Math.min(RANKS.length, Math.max(1, level)) - 1];

function SkillNode({
  skill,
  learned,
  learnable,
  onLearn,
}: {
  skill: Skill;
  learned: boolean;
  learnable: boolean;
  onLearn: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!learnable}
      onClick={onLearn}
      title={`${skill.name}: ${skill.blurb}${learned ? ' (learned)' : learnable ? ' Click to learn.' : ''}`}
      style={{
        ...node,
        borderColor: learned ? UI.brass : learnable ? UI.verdigris : UI.rule,
        background: learned ? UI.tintBrass : learnable ? UI.tintVerdigris : 'transparent',
        cursor: learnable ? 'pointer' : 'default',
        opacity: learned || learnable ? 1 : 0.62,
      }}
    >
      <SkillGlyph id={skill.id} colour={learned ? UI.brass : learnable ? UI.verdigris : UI.textFaint} />
      <span style={{ fontFamily: FONT.display, fontSize: '0.72rem', color: UI.text, lineHeight: 1.15 }}>{skill.name}</span>
      <span style={{ fontFamily: FONT.body, fontSize: '0.64rem', color: UI.textSoft, lineHeight: 1.3 }}>{skill.blurb}</span>
      {learnable && <span style={{ ...dataText, fontSize: '0.58rem', color: UI.verdigris, letterSpacing: '0.1em' }}>LEARN</span>}
    </button>
  );
}

/** A ship's wheel with the level at its hub. Glows when there is a point to spend. */
export function LevelBadge({ level, colour, glowing = false, size = 54 }: { level: number; colour: string; glowing?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 54 54" style={{ flex: '0 0 auto' }} aria-label={`level ${level}`}>
      {glowing && <circle cx={27} cy={27} r={26} fill={UI.tintBrass} stroke={UI.brass} strokeWidth={1} strokeDasharray="3 3" />}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <line
            key={i}
            x1={27 + Math.cos(a) * 9}
            y1={27 + Math.sin(a) * 9}
            x2={27 + Math.cos(a) * 24}
            y2={27 + Math.sin(a) * 24}
            stroke={UI.textSoft}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={27} cy={27} r={18} fill="none" stroke={UI.textSoft} strokeWidth={2.6} />
      <circle cx={27} cy={27} r={11} fill={colour} stroke={UI.text} strokeWidth={1} />
      <text x={27} y={31} textAnchor="middle" fontFamily={FONT.display} fontSize={12} fontWeight={700} fill={UI.text}>
        {level}
      </text>
    </svg>
  );
}

/** A small mark for each skill. */
function SkillGlyph({ id, colour }: { id: Skill['id']; colour: string }) {
  const paths: Record<Skill['id'], string> = {
    weatherEye: 'M3 9 Q3 4 8 5 Q10 1 14 3 Q19 3 18 8 Z M6 12 l-1 3 M10 12 l-1 3 M14 12 l-1 3',
    driver: 'M2 13 L18 13 L15 16 L5 16 Z M10 13 V2 M10 3 L16 10 L10 10 M1 6 h4 M0 9 h4',
    navigator: 'M10 1 L12 9 L10 19 L8 9 Z M1 10 L9 8 L19 10 L9 12 Z',
    haggler: 'M3 4 H17 L15 14 H5 Z M7 4 V2 H13 V4 M8 9 h4',
    factor: 'M4 2 H14 L17 5 V18 H4 Z M7 8 H14 M7 11 H14 M7 14 H11',
    merchantPrince: 'M3 15 L4 6 L8 10 L10 4 L12 10 L16 6 L17 15 Z',
    bosun: 'M4 16 L14 6 M12 4 l4 4 l-3 3 l-4 -4 Z',
    gunner: 'M2 12 H14 L17 9 H19 M4 12 a3 3 0 1 0 6 0 M14 8 h3',
    commodore: 'M10 2 L12 8 H18 L13 12 L15 18 L10 14 L5 18 L7 12 L2 8 H8 Z',
  };
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" style={{ alignSelf: 'center' }} aria-hidden="true">
      <path d={paths[id]} fill="none" stroke={colour} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const tree: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '0.4rem',
};

const node: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.15rem',
  textAlign: 'center',
  border: '1px solid',
  borderRadius: 3,
  padding: '0.35rem 0.3rem',
  font: 'inherit',
  minHeight: 92,
  boxSizing: 'border-box',
};

const track: React.CSSProperties = {
  display: 'block',
  height: 7,
  background: UI.panelRaised,
  border: `1px solid ${UI.rule}`,
  borderRadius: 4,
  overflow: 'hidden',
};

const fill: React.CSSProperties = {
  display: 'block',
  height: '100%',
  background: UI.brass,
  transition: 'width 500ms ease',
};
