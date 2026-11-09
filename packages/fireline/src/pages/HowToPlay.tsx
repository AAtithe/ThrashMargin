import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PortalNav from '../components/PortalNav';
import { Button, Panel, bodySmall } from '../components/ui';
import { iconFor } from '../game/icons';
import { Controls } from './GameScreen';
import { statsOf } from '../game/Sidebar';
import { TECH_TEXT } from '../components/SkirmishSetup';
import {
  BUILD_MENU,
  BUILDINGS,
  HERO_ABILITY,
  HERO_KINDS,
  INFANTRY_MENU,
  MAP_TYPE_BLURBS,
  MAP_TYPE_NAMES,
  MAP_TYPES,
  MISSILE_DAMAGE,
  POWERS,
  SKIRMISH_POWERS,
  STANDARD_TECH,
  TICKS_PER_SECOND,
  UNITS,
  VEHICLE_MENU,
  type BuildingKind,
  type SupportPower,
  type UnitKind,
} from '../sim/rules';
import { FONT, UI } from '../theme';

/** The rules, generated from the same tables the simulation reads, so they cannot drift apart. */
export default function HowToPlay() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body }}>
      <PortalNav />
      <main style={{ flex: 1, width: '100%', maxWidth: 860, margin: '0 auto', padding: '2rem 1rem 3rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
        <div>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <Button tone="quiet">← Back to the lobby</Button>
          </Link>
        </div>
        <h1 style={{ margin: 0, fontFamily: FONT.display, letterSpacing: '0.1em' }}>HOW TO PLAY FIRELINE</h1>

        <Panel title="The first five minutes">
          <ol style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              Open <strong>Structures</strong> and click <strong>Generator</strong>. When it says Ready, click it again and
              place it on open ground near your Command Yard.
            </li>
            <li>Build a <strong>Refinery</strong> close to the nearest ore. It comes with a hauler, which starts work by itself.</li>
            <li>Add a <strong>Barracks</strong> for infantry, then a <strong>War Factory</strong> for vehicles. Keep power ahead of demand with more Generators.</li>
            <li>A second refinery and hauler roughly doubles your income. Ore regrows slowly, but fields do run thin.</li>
            <li>Put a <strong>Gun Turret</strong> or two on the side facing the enemy. The first attack comes after a few minutes.</li>
            <li>Build a <strong>Comms Uplink</strong> to bring the radar online and unlock artillery. Then go and find their base.</li>
          </ol>
        </Panel>

        <Panel title="The rules that matter">
          <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Everything is paid for when you queue it, and refunded in full if you cancel (right-click its button).</li>
            <li>One structure is built at a time. Infantry and vehicles each have their own queue of up to five.</li>
            <li>New structures must go within four tiles of one you already own, on clear ground, not on ore.</li>
            <li>
              <strong>Power:</strong> when demand passes supply, all production runs at half speed, turrets fire half as fast and
              the radar goes dark. Damaged generators make less.
            </li>
            <li>Selling returns half the cost, less for a damaged structure. Repair costs credits as it goes.</li>
            <li>Units guard where they stand and return fire. Attack-move (A) makes them fight their way to a point; a plain move does not stop to fight.</li>
            <li>You win when the enemy has no structures left, and lose when you have none.</li>
          </ul>
        </Panel>

        <Panel title="Playing faster">
          <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>T</kbd> <kbd>Y</kbd> press the build buttons of the open list in order;
              with advanced tech the list runs on to <kbd>U</kbd> <kbd>I</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd>. Each button shows its letter. <kbd>Tab</kbd> moves to the next list. Hold <kbd>Shift</kbd> to queue five infantry or
              vehicles in one go.
            </li>
            <li>Hover any build button, or a unit or structure in the selection panel, for its full card: cost, build time, armour, weapon, range, reload and speed.</li>
            <li>
              When your base or a hauler is hit, the radar pings the spot (even while the radar itself is offline) and a chip
              appears on the battlefield. <kbd>Space</kbd> jumps the view there.
            </li>
            <li>A red banner on the battlefield means power is short. Build a Generator before anything else.</li>
          </ul>
        </Panel>

        <Panel title="Setting up a skirmish">
          <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              <strong>Battlefield.</strong> Pick a map type, or Random to let the seed choose. Each card in the lobby shows the
              real map for the current seed, so you see the layout before you deploy; <strong>New map</strong> draws another.
              Every map is mirrored, so both sides get the same ground and the same ore.
            </li>
            <li>
              <strong>Tech level.</strong> {TECH_TEXT.standard.name}: {TECH_TEXT.standard.text} {TECH_TEXT.advanced.name}:{' '}
              {TECH_TEXT.advanced.text}
            </li>
            <li>
              <strong>Starting credits</strong> are the same for both sides. <strong>Ore</strong> sets how rich the fields are:
              poor fields run dry quickly, rich ones are denser and wider.
            </li>
          </ul>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {MAP_TYPES.map(t => (
              <div key={t} style={{ ...tile, flexDirection: 'column', gap: 4 }}>
                <strong style={{ fontSize: '0.88rem' }}>{MAP_TYPE_NAMES[t]}</strong>
                <span style={{ fontSize: '0.76rem', color: UI.textSoft, lineHeight: 1.4 }}>{MAP_TYPE_BLURBS[t]}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Advanced tech">
          <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              The build lists grow to three buttons a row. Items marked <span style={advBadge}>Advanced</span> below appear only
              with advanced tech; the computer builds from the same list.
            </li>
            <li>
              <strong>Medics</strong> heal hurt infantry near them and walk to the wounded. <strong>Grenadiers</strong> lob
              grenades over cover but cannot hit anything right beside them. <strong>Flame Tanks</strong> burn infantry and
              structures at short range. <strong>Missile Carriers</strong> outrange turrets but back away from anything that gets
              close. The <strong>Bastion</strong> is slow and enormous, and mends itself out of combat.
            </li>
            <li>
              <strong>Sandbag Walls</strong> are cheap and block movement. They do not extend your build area and do not count as
              structures for victory. A <strong>Repair Bay</strong> mends vehicles parked beside it, paid as it goes.
            </li>
            <li>
              <strong>Support powers</strong> come with structures and go when the last of them falls. Each charges first, then
              sits in the bar at the bottom of the battlefield: click it, then click the map.
            </li>
          </ul>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {(Object.entries(SKIRMISH_POWERS) as [SupportPower, BuildingKind][]).map(([p, b]) => (
              <div key={p} style={{ ...tile, flexDirection: 'column', gap: 4 }}>
                <strong style={{ fontSize: '0.88rem' }}>{POWERS[p].name}</strong>
                <span style={{ fontSize: '0.72rem', color: UI.textFaint, fontFamily: FONT.mono }}>
                  From a {BUILDINGS[b].name} · recharges in {duration(POWERS[p].cooldown)}
                </span>
                <span style={{ fontSize: '0.76rem', color: UI.textSoft, lineHeight: 1.4 }}>
                  {POWERS[p].blurb}
                  {p === 'missile' && ` Up to ${MISSILE_DAMAGE} damage at the centre.`}
                </span>
              </div>
            ))}
          </div>
          <p style={{ ...bodySmall, margin: 0 }}>
            When the enemy launches a missile at you, a red banner counts down to impact and a red ring marks the target. Click
            the banner to jump there, and move everything you can out of the ring.
          </p>
        </Panel>

        <Panel title="Campaign">
          <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              Start a campaign in the lobby and name your Commander. The campaign map shows eight missions in order; each one
              you win opens the next. Click an open mission for its briefing, then <strong>Deploy</strong>.
            </li>
            <li>
              A mission is won by its <strong>objectives</strong> (top right of the battlefield), not by flattening the map. Bonus
              objectives are optional and earn a star each. Some missions have a time limit, shown beside the objectives.
            </li>
            <li>
              Your <strong>Commander</strong> earns experience from every mission, even a lost one, and gains a skill point with
              every rank. Spend them in the Commander panel on income, faster and cheaper production, tougher units and support
              powers.
            </li>
            <li>
              <strong>Heroes</strong> join as the campaign goes on. They level up from kills and carry their experience between
              missions. A hero who falls is out for the rest of the mission and starts the next one wounded, at half health.
            </li>
            <li>
              The hero bar sits at the bottom of the battlefield. <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd> select heroes one
              to four (press twice to jump to the hero). <kbd>F</kbd> uses the selected hero's ability; Infiltrate, Demolition charge
              and Capture then want a click on an enemy structure. Right-click or <kbd>Esc</kbd> cancels.
            </li>
            <li>
              Support powers sit beside the heroes. Click one, then click the map: a Recon sweep reveals an area (and any Spies in
              it), an Artillery barrage shells it, Reinforcements arrive at the edge of the map nearest your base.
            </li>
          </ul>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {HERO_KINDS.map(k => (
              <div key={k} style={{ ...tile, flexDirection: 'column', gap: 4 }}>
                <strong style={{ fontSize: '0.88rem' }}>{UNITS[k].name}</strong>
                <span style={{ fontSize: '0.76rem', color: UI.textSoft, lineHeight: 1.4 }}>
                  <strong style={{ color: UI.text }}>{HERO_ABILITY[k].name}.</strong> {HERO_ABILITY[k].blurb}
                </span>
                <span style={{ fontSize: '0.72rem', color: UI.textFaint, lineHeight: 1.4 }}>{UNITS[k].blurb}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Structures">
          <Grid kinds={BUILD_MENU} />
        </Panel>
        <Panel title="Infantry">
          <Grid kinds={INFANTRY_MENU} />
        </Panel>
        <Panel title="Vehicles">
          <Grid kinds={VEHICLE_MENU} />
        </Panel>
        <Panel title="Controls">
          <Controls campaign skirmish />
        </Panel>
      </main>
      <PortalNav variant="footer" />
    </div>
  );
}

function Grid({ kinds }: { kinds: (BuildingKind | UnitKind)[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
      {kinds.map(k => {
        const isB = k in BUILDINGS;
        const spec = isB ? BUILDINGS[k as BuildingKind] : UNITS[k as UnitKind];
        const needs = spec.requires.map(r => BUILDINGS[r].name).join(', ');
        const facts: ReactNode[] = [`${spec.cost} credits`, `${spec.hp} hp`];
        if (isB) {
          const p = BUILDINGS[k as BuildingKind].power;
          facts.push(p > 0 ? `+${p} power` : `${p} power`);
        }
        const w = spec.weapon;
        if (w) facts.push(`range ${w.range}`);
        // The full card, the same one the build menu shows on hover.
        const rows = statsOf(k).filter(r => r.label !== 'Needs' && r.label !== 'Cost' && r.label !== 'Health');
        return (
          <div key={k} style={tile}>
            <img src={iconFor(k)} alt="" width={96} height={64} style={{ borderRadius: 3, flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <strong style={{ fontSize: '0.88rem' }}>
                {spec.name}
                {!STANDARD_TECH.includes(k) && <span style={{ ...advBadge, marginLeft: 6 }}>Advanced</span>}
              </strong>
              <span style={{ fontSize: '0.72rem', color: UI.textFaint, fontFamily: FONT.mono }}>{facts.join(' · ')}</span>
              <span style={{ fontSize: '0.76rem', color: UI.textSoft, lineHeight: 1.4 }}>{spec.blurb}</span>
              <details style={{ fontSize: '0.72rem', color: UI.textSoft }}>
                <summary style={{ cursor: 'pointer', color: UI.textFaint }}>All numbers</summary>
                <dl style={{ margin: '4px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 8, rowGap: 1 }}>
                  {rows.map(r => (
                    <div key={r.label} style={{ display: 'contents' }}>
                      <dt style={{ color: UI.textFaint }}>{r.label}</dt>
                      <dd style={{ margin: 0 }}>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              {needs && <span style={{ fontSize: '0.7rem', color: UI.textFaint }}>Needs: {needs}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const tile: CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: 8,
  border: `1px solid ${UI.rule}`,
  borderRadius: 4,
  background: UI.panelRaised,
};

const advBadge: CSSProperties = {
  display: 'inline-block',
  padding: '0 5px',
  fontSize: '0.62rem',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  verticalAlign: '1px',
  color: UI.accent,
  border: `1px solid ${UI.accent}`,
  borderRadius: 3,
};

/** A cooldown in words: seconds under two minutes, else minutes. */
const duration = (ticks: number) => {
  const secs = Math.round(ticks / TICKS_PER_SECOND);
  return secs < 120 ? `${secs}s` : `${Math.round((secs / 60) * 10) / 10} min`;
};
