/**
 * War for the Planet: the region panel beside the map (fireline-planet-design.md, section 17). W4.
 * Name, terrain, owner, yields and supply; the city with Build and Grow; the garrison with recruit
 * and muster; routes; and, for a region the field army can reach, Move and Attack with credits,
 * heroes, the allies who would join and the odds.
 */
import { useMemo, useState } from 'react';
import { attackOdds } from '../../planet/resolve';
import { attackCost, battleSetupFor, targetProblem } from '../../planet/battleSetup';
import { buildBlock, buildingName, scaleStock } from '../../planet/cities';
import { buildCost, garrisonCap, growCost, recruitCost, regionYield } from '../../planet/economy';
import { ATTACK_CREDITS, CITY_BUILDING_SPECS, isVehicle } from '../../planet/rules';
import { armyPath, suppliedRegions } from '../../planet/supply';
import { routePartner, routeYield, routePath } from '../../planet/trade';
import { ARMY_KINDS, CITY_BUILDINGS, NEUTRAL, type ArmyKind, type RegionId } from '../../planet/types';
import { garrisonTotal } from '../../planet/state';
import { HERO_KINDS, MAP_TYPE_NAMES, UNITS, heroLevelFor, type HeroKind } from '../../sim/rules';
import { BattleMapSize } from './BattleCards';
import { FactionName, Odds, OrderButton, stockText, unitName, type PlanetProps } from './common';

export default function RegionPanel({ s, map, act, region, onSelect }: PlanetProps & { region: RegionId | null; onSelect: (r: RegionId | null) => void }) {
  const capital = s.factions[0].capital;
  const picker = (
    <div className="fl-pl-row" style={{ alignItems: 'flex-end' }}>
      <label className="fl-pl-field">
        Region
        <select className="fl-pl-input" value={region ?? ''} id="pl-region-select" data-testid="region-select" onChange={e => onSelect(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">Choose a region</option>
          {map.regions.map(g => (
            <option key={g.id} value={g.id}>
              {g.city} ({s.regions[g.id].owner === 0 ? 'yours' : s.regions[g.id].owner === NEUTRAL ? 'independent' : s.factions[s.regions[g.id].owner].name})
            </option>
          ))}
        </select>
      </label>
      {capital >= 0 && region !== capital && map.regions[capital] && (
        <button type="button" className="fl-pl-btn" onClick={() => onSelect(capital)} id="pl-goto-capital" data-testid="goto-capital">
          Your capital
        </button>
      )}
    </div>
  );
  if (region === null || !map.regions[region]) {
    return (
      <div className="fl-pl-card" data-testid="region-panel">
        {picker}
        <p className="fl-small" style={{ margin: 0 }}>
          Choose a region on the map to see its city, garrison and yields. Your field army is the marker with your colour and its unit count;
          regions it can attack now are ringed.
        </p>
      </div>
    );
  }
  return (
    <div className="fl-pl-card" data-testid="region-panel" data-region={region}>
      {picker}
      <RegionBody s={s} map={map} act={act} region={region} />
    </div>
  );
}

function RegionBody({ s, map, act, region }: PlanetProps & { region: RegionId }) {
  const geo = map.regions[region];
  const st = s.regions[region];
  const mine = st.owner === 0;
  const y = regionYield(s, region);
  const supplied = st.owner >= 0 ? suppliedRegions(s, st.owner)[region] : true;
  const capitalOf = s.factions.find(f => f.alive && f.capital === region);
  const army = s.factions[0].army;
  const armyHere = army?.region === region;
  const others = s.factions.filter(f => f.id !== 0 && f.alive && f.army?.region === region);
  const cap = garrisonCap(s, region);
  const routes = s.routes.filter(r => r.from === region || r.to === region);

  return (
    <>
      <div>
        <h3 data-testid="region-name">{geo.city}</h3>
        <span className="fl-small">
          {geo.name} · {MAP_TYPE_NAMES[geo.terrain]} · {geo.ore} ore{geo.coastal ? ' · coastal' : ''}
          {capitalOf ? ` · capital of ${capitalOf.name}` : ''}
        </span>
      </div>
      <dl className="fl-pl-facts">
        <dt>Held by</dt>
        <dd>
          <FactionName s={s} f={st.owner} />
        </dd>
        <dt>Yields</dt>
        <dd>
          {stockText(y)}
          {y.science ? `, ${y.science} science` : ''} a turn
        </dd>
        {st.owner >= 0 && (
          <>
            <dt>Supply</dt>
            <dd style={{ color: supplied ? undefined : 'var(--ui-bad)' }} data-testid="region-supply">
              {supplied
                ? 'Linked to the capital'
                : `Cut off for ${st.cut} ${st.cut === 1 ? 'turn' : 'turns'}: half yields, surrenders after ${s.options.surrenderTurns} if an enemy borders it`}
            </dd>
          </>
        )}
        <dt>Armies</dt>
        <dd>
          {[armyHere ? `Your field army (${army!.units.length})` : null, ...others.map(f => `${f.name} (${f.army!.units.length})`)].filter(Boolean).join(', ') || 'None'}
        </dd>
      </dl>

      <MoveAndAttack s={s} map={map} act={act} region={region} />

      <h4>City: level {st.city.level}</h4>
      <span className="fl-small">
        {CITY_BUILDINGS.filter(b => st.city.b[b]).length} of {st.city.level + 1} building slots used; buildings up to Mk {Math.min(3, st.city.level)}.
        {st.city.built === s.turn ? ' Already built this turn.' : ''}
      </span>
      <ul className="fl-pl-list" data-testid="city-buildings">
        {CITY_BUILDINGS.map(b => {
          const mk = st.city.b[b] ?? 0;
          if (!mine && !mk) return null;
          const spec = CITY_BUILDING_SPECS[b];
          const cost = buildCost(s, region, b) ?? (mk < 3 ? scaleStock(spec.cost, mk + 1) : null);
          const block = mine ? buildBlock(s, region, b) : null;
          if (mine && !mk && block && /coastal/.test(block)) return null;
          return (
            <li key={b} className="fl-pl-item" title={spec.blurb}>
              <span>
                <strong>{buildingName(b, Math.max(1, mk))}</strong> {mk ? `Mk ${mk}` : <span className="fl-small">not built</span>}
                <br />
                <span className="fl-small">{spec.blurb}</span>
              </span>
              {mine && (
                <OrderButton s={s} act={act} a={{ type: 'build', region, building: b }} testId={`build-${b}`} id={`pl-build-${b}`}>
                  {mk ? `Mk ${mk + 1}` : 'Build'}
                  {cost ? ` · ${stockText(cost)}` : ''}
                </OrderButton>
              )}
            </li>
          );
        })}
      </ul>
      {mine && st.city.level < 5 && (
        <div className="fl-pl-row">
          <OrderButton s={s} act={act} a={{ type: 'growCity', region }} testId="grow-city">
            Grow to level {st.city.level + 1} · {stockText(growCost(st.city.level))}
          </OrderButton>
          <span className="fl-small">More building slots and higher marks; eats 1 more food a turn.</span>
        </div>
      )}

      <h4>
        Garrison: {garrisonTotal(st.garrison)} of {cap}
      </h4>
      <ul className="fl-pl-list" data-testid="garrison">
        {ARMY_KINDS.map((k, i) =>
          st.garrison[i] > 0 ? (
            <li key={k} className="fl-pl-item">
              <span>
                {st.garrison[i]} x {unitName(k)}
              </span>
              {mine && armyHere && (
                <OrderButton s={s} act={act} a={{ type: 'muster', region, kind: k }} testId={`muster-${k}`}>
                  Muster into the army
                </OrderButton>
              )}
            </li>
          ) : null,
        )}
        {garrisonTotal(st.garrison) === 0 && <li className="fl-small">No garrison.</li>}
      </ul>
      {mine && <RecruitRow s={s} map={map} act={act} region={region} to="garrison" />}

      {routes.length > 0 && (
        <>
          <h4>Trade routes</h4>
          <ul className="fl-pl-list">
            {routes.map(r => {
              const path = routePath(s, r);
              const other = r.from === region ? r.to : r.from;
              const partner = routePartner(s, r);
              return (
                <li key={r.id} className="fl-pl-item">
                  <span>
                    To {map.regions[other].city}
                    {partner !== null ? ` (${s.factions[partner].name})` : ''}: {path ? stockText(routeYield(s, r)) : 'blockaded'}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

/** Recruit one unit into the army or a garrison, the kind chosen from a list. */
export function RecruitRow({ s, act, region, to }: PlanetProps & { region: RegionId; to: 'army' | 'garrison' }) {
  const factory = (s.regions[region]?.city.b.factory ?? 0) > 0;
  const kinds = ARMY_KINDS.filter(k => factory || !isVehicle(k));
  const [kind, setKind] = useState<ArmyKind>('rifleman');
  const k = kinds.includes(kind) ? kind : kinds[0];
  return (
    <div className="fl-pl-row">
      <select className="fl-pl-input" value={k} aria-label={to === 'army' ? 'Unit to recruit into the field army' : 'Unit to recruit into the garrison'} onChange={e => setKind(e.target.value as ArmyKind)} id={`pl-recruit-kind${to === 'army' ? '-army' : ''}`} data-testid={`recruit-kind-${to}`}>
        {kinds.map(x => (
          <option key={x} value={x}>
            {unitName(x)} ({stockText(recruitCost(x))})
          </option>
        ))}
      </select>
      <OrderButton s={s} act={act} a={{ type: 'recruit', region, kind: k, to }} testId={`recruit-${to}`} id={`pl-recruit-${to}`}>
        Recruit
      </OrderButton>
      {!factory && <span className="fl-small">Vehicles need a factory here.</span>}
    </div>
  );
}

function MoveAndAttack({ s, map, act, region }: PlanetProps & { region: RegionId }) {
  const army = s.factions[0].army;
  const st = s.regions[region];
  const [credits, setCredits] = useState<0 | 1000 | 2000 | 3000>(0);
  const [heroes, setHeroes] = useState<HeroKind[]>([]);
  const available = HERO_KINDS.filter(h => s.heroes[h].unlocked && !s.heroes[h].lost);
  const chosen = heroes.filter(h => available.includes(h));
  const tp = army && st.owner !== 0 ? targetProblem(s, 0, region) : null;
  const adjacent = !!army && map.regions[army.region].links.some(l => l.to === region);
  const setup = useMemo(
    () => (army && st.owner !== 0 && !tp ? battleSetupFor(s, 0, region, credits, chosen, s.nextId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, region, credits, chosen.join(',')],
  );
  if (!army) return null;
  const path = army.region !== region ? armyPath(s, 0, region) : null;
  const canMove = !!path;
  const showAttack = st.owner !== 0 && (adjacent || !tp);

  return (
    <>
      {army.region !== region && (st.owner === 0 || canMove) && (
        <div className="fl-pl-row">
          <OrderButton s={s} act={act} a={{ type: 'moveArmy', to: region }} testId="move-army" id="pl-move-army">
            Move the field army here{path ? ` (${path.length - 1} ${path.length === 2 ? 'hop' : 'hops'})` : ''}
          </OrderButton>
          <span className="fl-small">
            {army.moved} of {s.options.armyMove} hops used this turn.
          </span>
        </div>
      )}
      {showAttack && (
        <div className="fl-pl-card" data-tone="war" data-testid="attack-box">
          <h4 style={{ margin: 0 }}>Attack {map.regions[region].city}</h4>
          {tp ? (
            <span className="fl-small">{tp}</span>
          ) : (
            <>
              <div className="fl-pl-row" role="group" aria-label="Credits to bring">
                <span className="fl-small">Extra credits</span>
                {ATTACK_CREDITS.map(c => (
                  <button key={c} type="button" className="fl-pl-btn" aria-pressed={credits === c} onClick={() => setCredits(c)} data-testid={`credits-${c}`}>
                    {c}
                  </button>
                ))}
              </div>
              <span className="fl-small">Cost: {stockText(attackCost(s, 0, credits))}.</span>
              {available.length > 0 && (
                <div className="fl-pl-row" role="group" aria-label="Heroes to bring">
                  <span className="fl-small">Heroes (up to {s.options.heroesPerBattle})</span>
                  {available.map(h => {
                    const on = chosen.includes(h);
                    const full = !on && chosen.length >= s.options.heroesPerBattle;
                    return (
                      <button
                        key={h}
                        type="button"
                        className="fl-pl-btn"
                        aria-pressed={on}
                        disabled={full}
                        title={full ? 'No room for another hero in this battle.' : s.heroes[h].wounded ? 'Wounded: starts at half health.' : undefined}
                        onClick={() => setHeroes(on ? chosen.filter(x => x !== h) : [...chosen, h])}
                        data-testid={`hero-pick-${h}`}
                      >
                        {UNITS[h].name} {heroLevelFor(s.heroes[h].xp)}
                        {s.heroes[h].wounded ? ' (wounded)' : ''}
                      </button>
                    );
                  })}
                </div>
              )}
              {setup && (
                <>
                  <div className="fl-pl-sides">
                    {setup.sides.map((side, i) => (
                      <div key={i} className="fl-pl-side">
                        <strong>
                          <FactionName s={s} f={side.faction} />
                        </strong>
                        <span className="fl-small">
                          {side.role === 'ally' ? `Ally of the ${side.team === 0 ? 'attack' : 'defence'}` : side.role === 'attacker' ? 'Attacker' : 'Defender'} · {side.units.length} units
                        </span>
                      </div>
                    ))}
                  </div>
                  <BattleMapSize setup={setup} />
                  <Odds p={attackOdds(setup)} label="Chance of taking it" />
                </>
              )}
              <OrderButton s={s} act={act} a={{ type: 'attack', target: region, credits, heroes: chosen }} tone="primary" testId="attack">
                Attack
              </OrderButton>
            </>
          )}
        </div>
      )}
    </>
  );
}
