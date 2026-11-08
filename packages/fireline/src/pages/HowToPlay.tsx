import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PortalNav from '../components/PortalNav';
import { Button, Panel, bodySmall } from '../components/ui';
import { iconFor } from '../game/icons';
import { Controls } from './GameScreen';
import { statsOf } from '../game/Sidebar';
import { BUILD_MENU, BUILDINGS, INFANTRY_MENU, UNITS, VEHICLE_MENU, type BuildingKind, type UnitKind } from '../sim/rules';
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
              each button shows its letter. <kbd>Tab</kbd> moves to the next list. Hold <kbd>Shift</kbd> to queue five infantry or
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
          <Controls />
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
              <strong style={{ fontSize: '0.88rem' }}>{spec.name}</strong>
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
