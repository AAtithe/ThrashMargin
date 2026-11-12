/**
 * War for the Planet: the pending battle card, the debrief after a battle, and the end of the war
 * (fireline-planet-design.md, section 17). W4.
 */
import { BusyLabel } from '../../lib/Loading';
import { buildingName } from '../../planet/cities';
import { attackOdds } from '../../planet/resolve';
import { PLANET_RANKS, planetRankFor } from '../../planet/turn';
import { regionShare } from '../../planet/victory';
import type { BattleReport, BattleSetup, PendingBattle, PlanetMap, PlanetState } from '../../planet/types';
import { CITY_BUILDINGS } from '../../planet/types';
import { BIG_CITY_LEVEL, battleMapSizeOf } from '../../planet/battle';
import { MAP_SIZE_NAMES, MAP_TYPE_NAMES, TICKS_PER_SECOND, UNITS, heroLevelFor, mapTilesFor } from '../../sim/rules';
import { FactionName, Odds, rankName, unitName } from './common';

/** The battle's map size and width, as the attack preview and the pending battle card show it (section 9.7). */
export function BattleMapSize({ setup }: { setup: Pick<BattleSetup, 'mapSize' | 'sides' | 'cityLevel'> }) {
  const size = battleMapSizeOf(setup);
  const n = setup.sides.length;
  const tiles = mapTilesFor({ size, sides: n as 2 | 3 | 4 });
  // Why it is larger, read back from battleMapSize's rule: more sides, else a big city, else a capital.
  const why = n > 2 ? `${n} sides fight here` : setup.cityLevel >= BIG_CITY_LEVEL ? 'a big city is at stake' : 'a capital is at stake';
  return (
    <span className="fl-small" data-testid="battle-map-size" data-size={size}>
      Map: {MAP_SIZE_NAMES[size]}, {tiles} tiles across{size === 'standard' ? '.' : `, because ${why}.`}
    </span>
  );
}

/** The player's seat in a battle, or -1 when the player has no side (never for a pending battle). */
const playerSeat = (pb: PendingBattle) => pb.setup.sides.findIndex(x => x.faction === 0);

export function PendingCard({
  s,
  map,
  busy,
  onFight,
  onAuto,
  onSimulate,
  onResume,
  onRetreat,
}: {
  s: PlanetState;
  map: PlanetMap;
  busy: 'simulate' | null;
  onFight: () => void;
  onAuto: () => void;
  onSimulate: () => void;
  onResume: () => void;
  onRetreat: () => void;
}) {
  const pb = s.pending[0];
  const setup = pb.setup;
  const seat = playerSeat(pb);
  const defending = seat >= 0 && setup.sides[seat].team === 1;
  const p = attackOdds(setup);
  const geo = map.regions[pb.region];
  const attacker = setup.sides.find(x => x.role === 'attacker')!;
  const title = pb.kind === 'attack' ? `Your attack on ${geo.city}` : `${s.factions[attacker.faction]?.name ?? 'An enemy'} attacks ${geo.city}`;
  return (
    <section className="fl-pl-card" data-tone="war" id="pl-pending" data-testid="pending-battle" data-kind={pb.kind} data-fighting={pb.fighting ? '1' : '0'} aria-live="polite">
      <p className="fl-eyebrow">{pb.kind === 'attack' ? 'Battle' : 'Defence'}{s.pending.length > 1 ? ` · ${s.pending.length} battles waiting` : ''}</p>
      <h3>{title}</h3>
      <span className="fl-small">
        {geo.name}, a {MAP_TYPE_NAMES[setup.mapType]} battlefield with {setup.ore} ore; city level {setup.cityLevel}. {Math.round(setup.timeLimit / (60 * TICKS_PER_SECOND))} minutes: if
        time runs out, the defenders win.
      </span>
      <BattleMapSize setup={setup} />
      <div className="fl-pl-sides">
        {setup.sides.map((side, i) => (
          <div key={i} className="fl-pl-side" data-team={side.team}>
            <strong>
              <FactionName s={s} f={side.faction} />
            </strong>
            <span className="fl-small">
              {side.team === 0 ? 'Attacking' : 'Defending'}
              {side.role === 'ally' ? ' (ally)' : ''} · {side.units.length} units
              {side.heroes.length ? ` · ${side.heroes.map(h => UNITS[h.kind].name).join(', ')}` : ''}
              {side.human ? ' · you command' : ''}
            </span>
          </div>
        ))}
      </div>
      <Odds p={defending ? 1 - p : p} label={defending ? 'Chance of holding' : 'Chance of taking it'} />
      <div className="fl-pl-row">
        {pb.fighting ? (
          <>
            <button type="button" className="fl-pl-btn primary" onClick={onResume} data-testid="resume-battle">
              Return to the battle
            </button>
            <button type="button" className="fl-pl-btn danger" onClick={onRetreat} data-testid="retreat">
              Retreat (counts as a defeat)
            </button>
          </>
        ) : (
          <>
            {setup.sides.some(x => x.human) && (
              <button type="button" className="fl-pl-btn primary" onClick={onFight} disabled={!!busy} data-testid="fight">
                Fight it
              </button>
            )}
            <button type="button" className="fl-pl-btn" onClick={onAuto} disabled={!!busy} data-testid="auto-resolve" title="Decided at once from the strength of each side, the terrain and the city.">
              Auto-resolve
            </button>
            {s.options.simulatedAutoResolve && (
              <button type="button" className="fl-pl-btn" onClick={onSimulate} disabled={!!busy} data-testid="simulate" title="The computer plays the whole battle out on every side.">
                {busy === 'simulate' ? <BusyLabel>Simulating…</BusyLabel> : 'Simulate'}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export interface Debrief {
  before: PlanetState;
  after: PlanetState;
  pb: PendingBattle;
  report: BattleReport;
}

const HOW_TEXT: Record<BattleReport['how'], string> = { fought: 'Fought', quick: 'Auto-resolved', simulated: 'Simulated', retreat: 'Retreated' };

export function DebriefCard({ d, map, onClose }: { d: Debrief; map: PlanetMap; onClose: () => void }) {
  const { before, after, pb, report } = d;
  const seat = playerSeat(pb);
  const side = seat >= 0 ? pb.setup.sides[seat] : null;
  const won = side ? (side.team === 0) === (report.winner === 'attacker') : report.winner === 'attacker';
  const geo = map.regions[pb.region];
  const was = before.regions[pb.region].owner;
  const now = after.regions[pb.region].owner;
  const out = seat >= 0 ? report.sides[seat] : null;
  const cores = side ? side.units.filter(u => u.core !== null) : [];
  const promoted = out
    ? out.survivors.filter(u => u.core !== null).flatMap(u => {
        const from = cores.find(c => c.core === u.core);
        return from && rankName(from.kills) !== rankName(u.kills) ? [`${unitName(u.kind)} to ${rankName(u.kills)}`] : [];
      })
    : [];
  const lostCore = out ? cores.filter(c => !out.survivors.some(u => u.core === c.core)).length : 0;
  const xp = after.commander.xp - before.commander.xp;
  const rankNow = planetRankFor(after.commander.xp);
  const ranked = rankNow > planetRankFor(before.commander.xp);
  const damage = CITY_BUILDINGS.filter(b => (report.cityDamage[b] ?? 0) > 0);
  return (
    <div className="fl-scrim fixed" onClick={onClose}>
      <div className="fl-debrief" role="dialog" aria-label="Battle debrief" data-testid="planet-debrief" data-result={won ? 'won' : 'lost'} onClick={e => e.stopPropagation()}>
        <p className="fl-eyebrow">
          {HOW_TEXT[report.how]} · {geo.city}
        </p>
        <h2 className="fl-debrief-title" data-won={won ? '1' : '0'}>
          {won ? 'VICTORY' : 'DEFEAT'}
        </h2>
        <p className="fl-small" style={{ margin: 0 }} data-testid="debrief-region">
          {was !== now ? (
            <>
              {geo.city} passes from {was < 0 ? 'the independents' : before.factions[was].name} to {now < 0 ? 'the independents' : after.factions[now].name}.
            </>
          ) : (
            <>{geo.city} stays with {now < 0 ? 'the independents' : after.factions[now].name}.</>
          )}
          {report.cityLevelLost ? ' The city loses a level.' : ''}
        </p>
        {out && cores.length > 0 && (
          <p className="fl-small" style={{ margin: 0 }}>
            {out.survivors.filter(u => u.core !== null).length} of {cores.length} field army units came back
            {lostCore ? `; ${lostCore} lost` : ''}.{promoted.length ? ` Promoted: ${promoted.join(', ')}.` : ''}
          </p>
        )}
        {out && out.heroes.length > 0 && (
          <div className="fl-debrief-heroes">
            {out.heroes.map(h => {
              const start = side!.heroes.find(x => x.kind === h.kind);
              const lvl = heroLevelFor(h.xp);
              const up = start ? lvl > heroLevelFor(start.xp) : false;
              return (
                <div key={h.kind} className="fl-brief-hero">
                  <span>
                    <strong>{UNITS[h.kind].name}</strong>
                    <span className="fl-small">
                      {' '}+{h.xp - (start?.xp ?? h.xp)} xp{up ? ` · level ${lvl}` : ''}
                      {!h.alive && <span style={{ color: 'var(--ui-bad)' }}>{after.heroes[h.kind].lost ? ' · lost for the war' : ' · wounded'}</span>}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {damage.length > 0 && (
          <p className="fl-small" style={{ margin: 0 }}>
            City damage: {damage.map(b => `${buildingName(b, before.regions[pb.region].city.b[b] ?? 1)} -${report.cityDamage[b]} Mk`).join(', ')}.
          </p>
        )}
        {xp > 0 && (
          <p className="fl-small" style={{ margin: 0 }}>
            {after.commander.name}: +{xp} xp{ranked ? `, promoted to ${PLANET_RANKS[rankNow].name}` : ''}.
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="fl-camp-btn primary" onClick={onClose} data-testid="debrief-close">
            Back to the planet
          </button>
        </div>
      </div>
    </div>
  );
}

const RESULT_TEXT: Record<NonNullable<PlanetState['result']>['how'], string> = {
  domination: 'You hold enough of the planet to rule it.',
  elimination: 'Every rival faction has been driven from the planet.',
  alliance: 'You and your allies hold the planet, and you lead the alliance.',
  turnLimit: 'The war was decided on regions held when time ran out.',
  fallen: 'Your last region has fallen.',
  rival: 'A rival faction holds enough of the planet to rule it.',
};

export function EndCard({ s, onLobby }: { s: PlanetState; onLobby: () => void }) {
  const r = s.result!;
  const rows = [...s.factions.map(f => ({ f: f.id, share: regionShare(s, f.id) })), { f: -1, share: s.regions.filter(x => x.owner < 0).length / s.regions.length }].sort(
    (a, b) => b.share - a.share,
  );
  return (
    <section className="fl-pl-card" data-tone={r.won ? 'good' : 'bad'} data-testid="planet-end" data-result={r.won ? 'won' : 'lost'}>
      <p className="fl-eyebrow">The war is over · turn {r.turn}</p>
      <h3 style={{ fontSize: '1.4rem' }}>{r.won ? 'Victory' : 'Defeat'}</h3>
      <span className="fl-small">{RESULT_TEXT[r.how]}</span>
      <ul className="fl-pl-list">
        {rows.map(x => (
          <li key={x.f} className="fl-pl-item">
            <span>
              <FactionName s={s} f={x.f} />
            </span>
            <strong>{Math.round(x.share * 100)}%</strong>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" className="fl-pl-btn primary" onClick={onLobby}>
          Back to the lobby
        </button>
      </div>
    </section>
  );
}
