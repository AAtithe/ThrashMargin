/**
 * War for the Planet: the pending battle card, the debrief after a battle, and the end of the war
 * (fireline-planet-design.md, section 17). W4.
 */
import { BusyLabel } from '../../lib/Loading';
import { buildingName } from '../../planet/cities';
import { attackOdds } from '../../planet/resolve';
import { PLANET_RANKS, planetRankFor } from '../../planet/turn';
import { regionShare } from '../../planet/victory';
import type { BattleReport, BattleSetup, PendingBattle, PlanetMap, PlanetState, SupplyState, SupportGrant } from '../../planet/types';
import { SUPPORT_NAMES } from '../../planet/links';
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

// ---- Battle rules 3 (round 7): what the war brings, and what the battle sends back ----------------

const SUPPLY_TEXT: Record<SupplyState, string> = {
  cut: 'Cut off: the staging region has no route to the capital. Half the credits, half the harvest, vehicles arrive battered.',
  short: 'Short of fuel or food: a fifth fewer credits and a slower harvest.',
  supplied: 'Supplied from the capital.',
  depot: 'Supplied, with a depot behind it: the garrison sends a reinforcement wave partway through.',
};
const WHY_TEXT: Record<SupportGrant['why'], string> = { institute: 'research institute', fortifications: 'citadel', artillery: 'artillery in the garrison', airfield: 'airfield' };

/**
 * What the war brings into a battle on battle rules 3: supply, support from neighbouring regions,
 * the reinforcement wave and prepared defences (the time limit is in the card's first line).
 * Nothing for an older war's setup. Shown on the attack preview and the pending battle card.
 */
export function WarLinks({ s, map, setup }: { s: PlanetState; map: PlanetMap; setup: BattleSetup }) {
  const links = setup.links;
  if (!links) return null;
  const atk = setup.sides.findIndex(x => x.role === 'attacker');
  const atkName = s.factions[setup.sides[atk].faction]?.name ?? 'The attacker';
  const def = setup.sides[setup.defenderSeat];
  const defName = def.faction < 0 ? 'The independents' : s.factions[def.faction]?.name ?? 'The defender';
  const battered = setup.sides[atk].units.filter(u => u.hp !== undefined).length;
  const bySeat = (seat: number) => links.support.filter(g => g.seat === seat);
  const supportLine = (seat: number) =>
    bySeat(seat)
      .map(g => `${SUPPORT_NAMES[g.power]}${g.uses !== undefined ? ` (${g.uses} use${g.uses === 1 ? '' : 's'})` : ''} from the ${WHY_TEXT[g.why]} at ${map.regions[g.from]?.city ?? 'a nearby region'}`)
      .join('; ');
  const wave = links.reinforce;
  const base = setup.sides[atk].structures;
  return (
    <div className="fl-pl-links" data-testid="war-links" data-supply={links.supply}>
      <p className="fl-eyebrow">What the war brings</p>
      <span className="fl-small" data-testid="links-supply">
        <strong>{atkName}:</strong> {SUPPLY_TEXT[links.supply]}
        {links.creditsLost ? ` ${links.creditsLost} credits lost to supply.` : ''}
        {battered ? ` ${battered} vehicle${battered === 1 ? '' : 's'} below full health.` : ''}
      </span>
      <span className="fl-small" data-testid="links-base">
        Base from {map.regions[links.from]?.city ?? 'the staging region'}: {base.includes('factory') ? 'a War Factory' : 'no War Factory (build a factory there first)'},{' '}
        {base.includes('refinery') ? 'a refinery' : 'no refinery (no harvest)'}.
      </span>
      {wave && (
        <span className="fl-small" data-testid="links-wave">
          Reinforcements expected after {Math.round(wave.at / (60 * TICKS_PER_SECOND))} minutes: {wave.units.length} units from the garrison ({wave.units.map(k => unitName(k)).join(', ')}).
        </span>
      )}
      <p className="fl-eyebrow">Support from neighbouring regions</p>
      <span className="fl-small" data-testid="links-support">
        {atkName}: {supportLine(atk) || 'none'}.
      </span>
      {def.faction >= 0 && (
        <span className="fl-small">
          {defName}: {supportLine(setup.defenderSeat) || 'none'}.
        </span>
      )}
      {(links.walls > 0 || links.defCut) && (
        <span className="fl-small" data-testid="links-defence">
          {links.walls > 0 ? `${defName} has prepared defences: ${links.walls} sandbag posts in front of the city. ` : ''}
          {links.defCut ? `The city is cut off: ${links.defCreditsLost} fewer credits to defend it.` : ''}
        </span>
      )}
    </div>
  );
}

/** What a battle on battle rules 3 sent back to the war, read from the states either side of it. */
export function BattleReturns({ d, map }: { d: Debrief; map: PlanetMap }) {
  const { before, after, pb, report } = d;
  if (!pb.setup.links || !report.links) return null;
  const r = pb.region;
  const lines: string[] = [];
  const seeded = CITY_BUILDINGS.filter(b => report.links!.built.includes(b) && (after.regions[r].city.b[b] ?? 0) > (before.regions[r].city.b[b] ?? 0));
  if (seeded.length) lines.push(`Built in the battle and still standing: ${seeded.map(b => buildingName(b, after.regions[r].city.b[b] ?? 1)).join(', ')} added to ${map.regions[r].city}.`);
  const ore = after.factions[0].stock.ore - before.factions[0].stock.ore;
  if (ore > 0) lines.push(`${ore} ore comes home from unspent credits and the harvest.`);
  const armyBefore = before.factions[0].army?.units.length ?? 0;
  const seat = pb.setup.sides.findIndex(x => x.faction === 0 && x.role !== 'ally');
  if (seat >= 0) {
    const lostCore = pb.setup.sides[seat].units.filter(u => u.core !== null && !report.sides[seat].survivors.some(v => v.core === u.core)).length;
    const joined = (after.factions[0].army?.units.length ?? 0) - (armyBefore - lostCore);
    if (joined > 0) lines.push(`${joined} troop${joined === 1 ? '' : 's'} raised in the battle join the field army.`);
    const hurt = report.links.wounded[seat]?.length ?? 0;
    if (hurt) lines.push(`${hurt} vehicle${hurt === 1 ? '' : 's'} came back wounded: repairs cost ore and alloys at the end of the turn.`);
  }
  const trust: string[] = [];
  for (const f of after.factions) if (f.id !== 0 && f.alive && after.trust[f.id][0] !== before.trust[f.id][0]) trust.push(`${f.name} ${after.trust[f.id][0] > before.trust[f.id][0] ? '+' : ''}${after.trust[f.id][0] - before.trust[f.id][0]}`);
  if (trust.length) lines.push(`Trust in you: ${trust.join(', ')}.`);
  const shaken = after.regions.flatMap((x, i) => (x.shaken !== undefined && before.regions[i].shaken !== x.shaken ? [map.regions[i].city] : []));
  if (shaken.length) lines.push(`Shaken by the result: ${shaken.join(', ')} (garrisons fight at three quarters until the end of next turn).`);
  if (!lines.length) return null;
  return (
    <div className="fl-pl-links" data-testid="battle-returns">
      <p className="fl-eyebrow">What the battle sends back</p>
      {lines.map((t, i) => (
        <span key={i} className="fl-small">
          {t}
        </span>
      ))}
    </div>
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
      <WarLinks s={s} map={map} setup={setup} />
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
        <BattleReturns d={d} map={map} />
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
