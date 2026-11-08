import { distanceBetween } from '../sim/content';
import { TEA_RACE_PREMIUM, TEA_RACE_PURSE } from '../sim/rules';
import { RACE_FINISH, TEA_RACE_PORTS, nextRaceRound, openRace, raceLots } from '../sim/seamanship';
import { FONT, UI, money } from '../theme';
import { TeaChest, Vignette } from './Art';
import { Label, Panel, bodySmall, dataText } from './ui';
import type { GameState, Ship } from '../sim/types';

/** How far a ship still has to run to London, by the shortest line. */
function toFinish(ship: Ship): number {
  if (ship.location) return distanceBetween(ship.location, RACE_FINISH);
  const v = ship.voyage!;
  return v.legRemaining + distanceBetween(v.route[0], RACE_FINISH);
}

/** The longest run home from any tea port, which sets the scale of the course. */
const COURSE = Math.max(...TEA_RACE_PORTS.map(p => distanceBetween(p, RACE_FINISH)));

/**
 * The Great Tea Race: when the tea comes down, who is carrying it, and how far each of them has
 * still to run. A race course rather than a table, because the whole point of the race is that the
 * table can watch it happen.
 */
export default function TeaRacePanel({ state, viewerId }: { state: GameState; viewerId: string | null }) {
  if (!state.hazards?.teaRace || state.rules !== 'classic') return null;

  const race = openRace(state);
  const last = state.teaRace;
  const colourOf = Object.fromEntries(state.captains.map(c => [c.id, c.colour]));
  const nameOf = Object.fromEntries(state.captains.map(c => [c.id, c.id === viewerId ? 'you' : c.name.replace('Capt. ', '')]));

  const runners = race
    ? state.ships
        .filter(sh => raceLots(sh, race).length > 0)
        .map(sh => ({ ship: sh, left: toFinish(sh), lots: raceLots(sh, race).length }))
        .sort((a, b) => a.left - b.left)
    : [];

  const opensIn = nextRaceRound(state.round) - state.round;

  return (
    <Panel
      title="The Great Tea Race"
      aside={<Label>{race ? `closes in ${race.closesOn - state.round + 1}` : opensIn === 0 ? 'today' : `in ${opensIn} rounds`}</Label>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start' }}>
          <Vignette kind="teaRace" size={46} colour={UI.brass} style={{ border: `1px solid ${UI.rule}`, background: UI.panel }} />
          <p style={{ ...bodySmall, margin: 0, fontSize: '0.76rem', lineHeight: 1.4 }}>
            {race ? (
              <>
                The new season's tea is down. Load it at Foochow, Shanghai or Hong Kong and land it
                in <strong>London</strong>: first home {money(TEA_RACE_PURSE[1])} and {TEA_RACE_PREMIUM[1]}x a lot,
                second {money(TEA_RACE_PURSE[2])} and {TEA_RACE_PREMIUM[2]}x.
              </>
            ) : (
              <>
                Every summer the new season's tea comes down to the China ports, and the first two
                ships to land it in London take a purse. Next race opens round {nextRaceRound(state.round)}.
              </>
            )}
          </p>
        </div>

        {race && <Course runners={runners} placings={race.placings.length} colourOf={colourOf} />}

        {race && runners.length === 0 && race.placings.length === 0 && (
          <span style={{ ...dataText, fontSize: '0.68rem', color: UI.textFaint }}>
            No ship has loaded the new season's tea yet.
          </span>
        )}

        {race &&
          runners.map(r => (
            <span key={r.ship.id} style={{ ...dataText, fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: UI.textSoft }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: colourOf[r.ship.ownerId], flex: '0 0 auto' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                {r.ship.name} ({nameOf[r.ship.ownerId]}) {r.lots}
                <TeaChest size={11} />
              </span>
              <span>{r.ship.location === RACE_FINISH ? 'in London' : `${r.left} pts`}</span>
            </span>
          ))}

        {last && last.placings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', borderTop: `1px solid ${UI.rule}`, paddingTop: '0.4rem' }}>
            <span style={{ ...dataText, fontSize: '0.6rem', letterSpacing: '0.14em', color: UI.textFaint, textTransform: 'uppercase' }}>
              Year {last.year}{last.closed ? ', finished' : ''}
            </span>
            {last.placings.map(p => (
              <span key={p.rank} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', fontFamily: FONT.body }}>
                <Medal rank={p.rank} />
                <span style={{ color: colourOf[p.captainId] }}>{p.shipName}</span>
                <span style={{ color: UI.textFaint }}>({nameOf[p.captainId]}), round {p.round}</span>
                <span style={{ ...dataText, marginLeft: 'auto', color: UI.brass, fontSize: '0.7rem' }}>{money(p.paid)}</span>
              </span>
            ))}
          </div>
        )}
        {last?.closed && last.placings.length === 0 && !race && (
          <span style={{ ...dataText, fontSize: '0.66rem', color: UI.textFaint }}>
            Year {last.year}'s race went unclaimed.
          </span>
        )}
      </div>
    </Panel>
  );
}

/** A rosette: gold for first, silver for second. */
function Medal({ rank }: { rank: 1 | 2 }) {
  const fill = rank === 1 ? UI.brass : UI.textFaint;
  return (
    <svg width={16} height={18} viewBox="0 0 16 18" aria-label={rank === 1 ? 'first' : 'second'}>
      <path d="M4 10 L2 18 L5.5 16 L8 18 L7 10 Z M12 10 L14 18 L10.5 16 L8 18 L9 10 Z" fill={UI.ensign} opacity={0.8} />
      <circle cx={8} cy={7} r={6} fill={fill} />
      <text x={8} y={9.6} textAnchor="middle" fontSize={7.5} fontFamily={FONT.data} fill={UI.panel} fontWeight={700}>
        {rank}
      </text>
    </svg>
  );
}

/**
 * The course itself: China on the left, London's flag on the right, every runner placed by how far
 * she still has to sail. Two runners level are stacked rather than drawn on top of one another.
 */
function Course({
  runners,
  placings,
  colourOf,
}: {
  runners: { ship: Ship; left: number }[];
  placings: number;
  colourOf: Record<string, string>;
}) {
  const W = 240;
  const H = 54;
  const x0 = 18;
  const x1 = W - 22;
  const placed: { x: number; lane: number }[] = [];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Tea race course">
      <rect x={0} y={0} width={W} height={H} fill={UI.tintVerdigris} />
      {[0, 1, 2].map(i => (
        <path
          key={i}
          d={`M0 ${40 + i * 5} ${Array.from({ length: 12 }, () => 'q10 -3 20 0').join(' ')}`}
          transform={`translate(${i * 6} 0)`}
          fill="none"
          stroke={UI.verdigris}
          strokeWidth={0.6}
          opacity={0.35 - i * 0.08}
        />
      ))}
      <line x1={x0} y1={30} x2={x1} y2={30} stroke={UI.ruleStrong} strokeWidth={1} strokeDasharray="3 3" />
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={x0 + (x1 - x0) * f} y1={27} x2={x0 + (x1 - x0) * f} y2={33} stroke={UI.ruleStrong} strokeWidth={0.8} />
      ))}
      <text x={x0} y={48} fontSize={8} fontFamily={FONT.data} fill={UI.textFaint} textAnchor="middle">
        CHINA
      </text>
      <text x={x1} y={48} fontSize={8} fontFamily={FONT.data} fill={UI.textFaint} textAnchor="middle">
        LONDON
      </text>
      {/* The finishing flag. */}
      <line x1={x1} y1={8} x2={x1} y2={34} stroke={UI.text} strokeWidth={1} />
      <rect x={x1} y={8} width={12} height={8} fill={UI.text} />
      <rect x={x1} y={8} width={4} height={4} fill={UI.panel} />
      <rect x={x1 + 8} y={8} width={4} height={4} fill={UI.panel} />
      <rect x={x1 + 4} y={12} width={4} height={4} fill={UI.panel} />
      {placings > 0 && (
        <text x={x1 - 4} y={22} fontSize={7} fontFamily={FONT.data} fill={UI.brass} textAnchor="end">
          {placings === 1 ? '1st home' : '2 home'}
        </text>
      )}
      {runners.map(r => {
        const f = Math.max(0, Math.min(1, 1 - r.left / COURSE));
        const x = x0 + (x1 - x0) * f;
        let lane = 0;
        while (placed.some(p => p.lane === lane && Math.abs(p.x - x) < 14)) lane++;
        placed.push({ x, lane });
        const y = 30 - (lane % 3) * 9;
        const c = colourOf[r.ship.ownerId];
        return (
          <g key={r.ship.id} transform={`translate(${x} ${y})`}>
            <path d="M-7 0 L7 0 Q5 3.5 2 3.5 L-5 3.5 Q-6.5 2.5 -7 0 Z" fill={c} stroke={UI.text} strokeWidth={0.5} />
            <line x1={-2} y1={0} x2={-2} y2={-9} stroke={UI.text} strokeWidth={0.7} />
            <line x1={2.5} y1={0} x2={2.5} y2={-10} stroke={UI.text} strokeWidth={0.7} />
            <path d="M-4.5 -8 L0 -8 L-0.3 -2 L-4.2 -2 Z M0.5 -9 L5 -9 L4.7 -2 L0.8 -2 Z" fill={UI.panel} stroke={UI.text} strokeWidth={0.4} />
            <title>{`${r.ship.name}: ${r.left} points from London`}</title>
          </g>
        );
      })}
    </svg>
  );
}

