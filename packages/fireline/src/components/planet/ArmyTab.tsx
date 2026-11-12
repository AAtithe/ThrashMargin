/**
 * War for the Planet: the Army screen (fireline-planet-design.md, section 17). W4.
 * The field army's roster with ranks and kills, recruit, station and disband; the heroes, with heal.
 */
import { HeroPortrait } from '../CampaignArt';
import { armyCapOf, upkeepOf } from '../../planet/economy';
import { HEAL_FOOD } from '../../planet/rules';
import { HERO_ABILITY, HERO_KINDS, HERO_LEVEL_XP, HERO_MAX_LEVEL, UNITS, heroLevelFor } from '../../sim/rules';
import { RecruitRow } from './RegionPanel';
import { OrderButton, rankName, stockText, unitName, type PlanetProps } from './common';

export default function ArmyTab({ s, map, act, onShowRegion }: PlanetProps & { onShowRegion: (r: number) => void }) {
  const army = s.factions[0].army;
  const cap = armyCapOf(s, 0);
  const up = upkeepOf(s, 0);
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
      <section className="fl-pl-card" data-testid="army-roster">
        <h3>The field army</h3>
        {!army ? (
          <p className="fl-small">There is no field army.</p>
        ) : (
          <>
            <span className="fl-small">
              {army.units.length} of {cap} units, at{' '}
              <button type="button" className="fl-pl-btn" onClick={() => onShowRegion(army.region)}>
                {map.regions[army.region].city}
              </button>
              . Moved {army.moved} of {s.options.armyMove} hops; {army.attacked ? 'has attacked this turn.' : 'may attack this turn.'}
            </span>
            <span className="fl-small">Upkeep of everything you field: {stockText(up)} a turn.</span>
            <ul className="fl-pl-list">
              {army.units.map((u, slot) => (
                <li key={slot} className="fl-pl-item" data-testid={`army-unit-${slot}`}>
                  <span>
                    <strong>{unitName(u.kind)}</strong> <span className="fl-small">{rankName(u.kills)} · {u.kills} {u.kills === 1 ? 'kill' : 'kills'}</span>
                  </span>
                  <span className="fl-pl-row">
                    <OrderButton s={s} act={act} a={{ type: 'station', slot }}>
                      Station here
                    </OrderButton>
                    <OrderButton s={s} act={act} a={{ type: 'disband', from: 'army', slot }} tone="danger">
                      Disband
                    </OrderButton>
                  </span>
                </li>
              ))}
              {army.units.length === 0 && <li className="fl-small">No units. Recruit where the army stands, in a region you hold.</li>}
            </ul>
            {s.regions[army.region].owner === 0 && <RecruitRow s={s} map={map} act={act} region={army.region} to="army" />}
            <p className="fl-small" style={{ margin: 0 }}>
              Units rank up in battle at 3 kills (Veteran) and 7 (Elite), and keep their rank for the whole war. Muster garrison units into the army from the
              region panel.
            </p>
          </>
        )}
      </section>

      <section className="fl-pl-card" data-testid="army-heroes">
        <h3>Heroes</h3>
        <span className="fl-small">
          Up to {s.options.heroesPerBattle} join an attack; the defence of the region where your army stands takes them by itself.
          {s.options.ironRule ? ' Iron rule: a hero who falls is lost for the war.' : ' A hero who falls is wounded, not lost.'}
        </span>
        <ul className="fl-pl-list">
          {HERO_KINDS.map(h => {
            const rec = s.heroes[h];
            const level = heroLevelFor(rec.xp);
            return (
              <li key={h} className="fl-pl-item" data-testid={`planet-hero-${h}`}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <HeroPortrait hero={h} level={Math.max(1, level)} wounded={rec.wounded || rec.lost} size={40} />
                  <span>
                    <strong>{UNITS[h].name}</strong>{' '}
                    {rec.unlocked ? (
                      <span className="fl-small">
                        Level {level}
                        {level < HERO_MAX_LEVEL ? `, ${rec.xp} / ${HERO_LEVEL_XP[level]} xp` : ', top level'}
                        {rec.lost ? ' · lost' : rec.wounded ? ' · wounded' : ''}
                      </span>
                    ) : (
                      <span className="fl-small">{h === 'spy' ? 'Joins when you hold a research institute at Mk 2.' : h === 'ace' ? 'Joins when you hold an airfield at Mk 2.' : 'Not yet with you.'}</span>
                    )}
                    <br />
                    <span className="fl-small">{HERO_ABILITY[h].name}: {HERO_ABILITY[h].blurb}</span>
                  </span>
                </span>
                {rec.unlocked && rec.wounded && !rec.lost && (
                  <OrderButton s={s} act={act} a={{ type: 'healHero', hero: h }} testId={`heal-${h}`}>
                    Heal · {HEAL_FOOD} food
                  </OrderButton>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
