import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PortalNav from '../components/PortalNav';
import { Button, Panel, bodySmall } from '../components/ui';
import { iconFor } from '../game/icons';
import { Controls } from './GameScreen';
import { statsOf } from '../game/Sidebar';
import { TECH_TEXT } from '../components/SkirmishSetup';
import { MAP_SIZE_NAMES, MAP_SIZE_TILES, MAP_SIZES } from '../sim/rules';
import {
  AIR_MENU,
  NAVAL_MENU,
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
import { CITY_BUILDING_SPECS, LENGTH_PRESETS, PRESETS } from '../planet/rules';
import { CITY_BUILDINGS } from '../planet/types';
// round5:D. Neutral sites and tier three (fireline-round5-design.md, workstream D).
import {
  DERRICK_INCOME,
  DERRICK_TICKS,
  HOSPITAL_HEAL,
  HOSPITAL_RANGE,
  HOSPITAL_TICKS,
  RELAY_RADIUS,
  SITE_CAPTURE_RANGE,
  SITE_CAPTURE_TICKS,
  SITE_KINDS,
  SITES,
  SITES_PER_SIDE,
  STEALTH_DETECT_RANGE,
  STEALTH_REVEAL_TICKS,
} from '../sim/rules';

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
              Click <strong>Build</strong> (or press <kbd>`</kbd>), then <strong>Generator</strong>. When it says Ready, click it again and
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
              with advanced tech the list runs on to <kbd>U</kbd> <kbd>I</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> <kbd>B</kbd> <kbd>N</kbd> <kbd>D</kbd>. Each button shows its letter. <kbd>Tab</kbd> moves to the next list. Hold <kbd>Shift</kbd> to queue five infantry or
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
              The build window gains an Air tab and a longer tree. Items marked <span style={advBadge}>Advanced</span> below appear only
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

        {/* round5:A. The build window (fireline-round5-design.md): its panel goes on the line below. */}
        <Panel title="The build window">
          <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              Everything you can build is in the <strong>build window</strong>. Open it with the <strong>Build</strong> button in
              the sidebar or the <kbd>`</kbd> key; close it the same way, with <kbd>Esc</kbd>, or with its ×. The battle keeps
              running while it is open, and on a computer you can drag it by its title bar to wherever suits you.
            </li>
            <li>
              Each list is a <strong>tech tree</strong>: items in tiers from left to right, a line from each one to every structure
              it needs. A greyed item names what is missing under it. A structure from another list shows as a small box at the
              start of the tree.
            </li>
            <li>
              The letter keys work with the window open or closed, on the list the Build button names; <kbd>Tab</kbd> changes the
              list. A list's fifteenth item onwards has no key: click it in the tree.
            </li>
            <li>
              When a structure is ready and you pick it up, the window steps aside while you place it and comes back afterwards.
              Under the Build button, the <strong>production strip</strong> shows everything under way; click a ready structure
              there to place it, or anything else to cancel the last one queued.
            </li>
            <li>Once a Research Lab stands, the window gains a <strong>Research</strong> tab for upgrades.</li>
          </ul>
        </Panel>
        {/* round5:B. Larger maps and long games: its panel goes on the line below. */}
        <Panel title="Larger maps and long games">
          <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              Choose the <strong>Map size</strong> in the lobby. Standard is the original size; Large and Huge spread the bases
              further apart and lay out more ore, with a second field behind each base and more out on the flanks.
            </li>
            <li>
              {MAP_SIZES.map(z => `${MAP_SIZE_NAMES[z]}: ${MAP_SIZE_TILES[z][2]}, ${MAP_SIZE_TILES[z][3]} or ${MAP_SIZE_TILES[z][4]} tiles across for two, three or four sides.`).join(' ')}
            </li>
            <li>
              On Large and Huge maps a worked-out ore field grows back from its edges: while one tile of a field still holds
              ore, the empty tiles beside it slowly fill again. Nothing grows under a structure.
            </li>
            <li>
              The computer plays the long game on a larger map: it builds more refineries and turrets, waits longer before
              its first attack and sends bigger waves less often. Expect battles of 30 minutes to an hour.
            </li>
          </ul>
        </Panel>
        {/* round5:C. Engineering vehicles: its panel goes on the line below. */}
        <Panel title="Engineering vehicles">
          <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              Two unarmed vehicles from the War Factory, with advanced tech only. Neither appears in a campaign mission.
            </li>
            <li>
              The <strong>{UNITS.repairtruck.name}</strong> ({UNITS.repairtruck.cost} credits, needs a Repair Bay) mends the most
              damaged of your vehicles right beside it, free and a little faster than the Repair Bay. It never mends infantry,
              aircraft or itself. Left idle, it drives to a damaged vehicle nearby; select it and press <strong>Stay put</strong> to keep
              it where you parked it, and <strong>Roam</strong> to let it go looking again. The computer sends its own with its attack waves.
            </li>
            <li>
              The <strong>{UNITS.basetruck.name}</strong> ({UNITS.basetruck.cost} credits, needs a Comms Uplink) drives anywhere
              and <strong>deploys</strong> where it stands into a <strong>{BUILDINGS.fieldyard.name}</strong>: select it and press{' '}
              <strong>Deploy</strong> (or F). It needs a clear 2x2 patch of open ground, but not near your base.
            </li>
            <li>
              A Field Yard is a second base. You may build within {BUILDINGS.fieldyard.buildRadius} tiles of it, and it works the
              Structures list, so you can keep building if your Command Yard falls. It counts as a structure for victory. Select it
              and press <strong>Pack up</strong> to turn it back into a truck, as long as something else of yours still stands.
              You may have three Field Yards and trucks at once.
            </li>
            <li>
              On large and huge maps the computer sends a Forward Base Truck to a distant ore field and builds a Refinery and a
              Gun Turret beside it.
            </li>
          </ul>
        </Panel>
        {/* round5:D. Neutral sites and tier three: its panel goes on the line below. */}
        <SitesPanel />

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

        <Panel title="War for the Planet">
          <p style={{ ...bodySmall, margin: 0 }}>
            A whole planet held by you, the Meridian Corps, and two to four computer factions, each with its own temperament. Start a war from
            the lobby: choose a length, the number of factions, a difficulty and the optional rules. Tick <strong>Guided first turn</strong> for
            a tutorial that walks your first turn one step at a time; <strong>Tour</strong> at the top of the war screen reopens it.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {LENGTH_PRESETS.map(k => {
              const o = PRESETS[k];
              return (
                <div key={k} style={{ ...tile, flexDirection: 'column', gap: 2 }}>
                  <strong style={{ fontSize: '0.88rem' }}>{k === 'short' ? 'Short' : k === 'long' ? 'Long' : 'Very long'}</strong>
                  <span style={{ fontSize: '0.76rem', color: UI.textSoft, lineHeight: 1.4 }}>
                    {o.regions} regions on {o.continents} continents, {o.factions} factions. {o.openingTruce} turns of truce, then {o.turnLimit} turns in all;
                    {' '}{o.victoryShare}% of the planet wins outright. Field army of up to {o.armyCap}.
                  </span>
                </div>
              );
            })}
          </div>
          <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              <strong>The turn.</strong> Give any number of orders: build, recruit, research, trade, negotiate, move the field army up to two
              regions, and attack one neighbouring region. Then press <strong>End turn</strong>: every other faction moves, everyone produces, and
              any attack on you becomes a battle to settle before your next orders.
            </li>
            <li>
              <strong>Cities.</strong> Every region has one city, level 1 to 5. A city holds one more building than its level, and buildings go up
              to Mk 3 (no higher than the city level). One build or growth per city per turn. What a city has built decides what its defenders
              start the battle with:
              <ul style={{ margin: '4px 0 0', paddingLeft: '1.1rem' }}>
                {CITY_BUILDINGS.map(b => (
                  <li key={b}>
                    <strong>{CITY_BUILDING_SPECS[b].name}</strong>: {CITY_BUILDING_SPECS[b].blurb}
                  </li>
                ))}
              </ul>
            </li>
            <li>
              <strong>Resources.</strong> Ore, fuel, alloys and food come from the land and the cities. Food feeds cities and infantry, fuel
              runs vehicles and airfields, alloys pay for vehicles, buildings and the credits you bring to a battle. Research needs science,
              from research institutes and the capital. A shortfall disbands units.
            </li>
            <li>
              <strong>Trade.</strong> A route between two of your cities pays ore and food; a route to a city of a trading partner pays fuel and
              alloys to you both. A route whose path is cut by war pays nothing that turn: it is blockaded. Treaties can add tribute and exchanges
              of resources each turn, and exchanges flow only while a route between you is open.
            </li>
            <li>
              <strong>Diplomacy.</strong> War, ceasefire, trade pact, alliance. Every faction trusts every other to a degree, shown as a bar.
              A proposal shows whether they would accept before you send it, and why. The computer factions sign treaties for a set number of
              turns and renew them only while peace pays them better than war: trade that flows, a stronger neighbour, enemies elsewhere. A
              treaty that runs out leaves you at war. They turn on a weak or exposed neighbour, and every one of them turns on a faction close to
              winning, you included. Breaking a treaty before its end is a breach: the victim's trust in you falls by 30 and everyone else's by
              10. Peace and war wear trust up or down each turn, but never past 90 or below 10 on their own. Allies bordering a battle join it
              on your side, and their regions are open to your army.
            </li>
            <li>
              <strong>Battles.</strong> Each attack is a Fireline battle on the region's own terrain, two to four sides on two teams, with the
              defender's city as its base and both sides' research in place. Fight it yourself, or auto-resolve it from the strength of each side.
              When time runs out, the defenders win. Your units keep their kills and rank from battle to battle; heroes join attacks and defences.
            </li>
            <li>
              <strong>Encirclement.</strong> A region with no path to its owner's capital through friendly ground is cut off: it yields half, and
              after a few turns it surrenders to the enemy next to it. Lose the capital and the largest remaining city takes its place.
            </li>
            <li>
              <strong>Winning.</strong> Hold the share of the planet the length sets, drive every rival out, or (with allied victory on) hold it
              together with your allies while you lead them. At the turn limit you win only if you hold more regions than any other faction. Lose every region, or
              let a rival reach the share first, and the war is lost.
            </li>
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
        <Panel title="Aircraft">
          <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: UI.textSoft, lineHeight: 1.5 }}>
            Advanced tech only. A Helipad builds and rearms two aircraft. They fly over water, rock and structures, and only
            anti-air (Skyhunters, Flak Tracks, Flak Cannons, Interceptors) and machine guns can reach them. Once a Research Lab
            stands, the build window's Research tab offers upgrades, one at a time, that last the rest of the battle: six with
            classic research, the development lines below otherwise.
          </p>
          <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: UI.textSoft, lineHeight: 1.5 }}>
            The air war has four jobs. Scout: send a Recon Plane over the fog and it circles there, seeing far and uncovering
            Stealth Tanks and Spies for everything on your side, until its fuel brings it home (shift-click waypoints for a patrol).
            Strike: Gunships against vehicles and haulers, Bombers against structures, and the Heavy Bomber, which takes a whole
            Helipad, for ten bombs in one run. Carry: right-click a Troop Carrier with infantry selected and up to six walk to it and
            climb in; fly it anywhere and press Unload (F) to set them down, at once if it is hovering, or where it stops. A carrier
            shot down takes everyone aboard with it. Defend: an Interceptor left on its Helipad
            scrambles at enemy aircraft that come near, chases them a short way and lands again; Countermeasures research cuts what
            flak and missiles do to your aircraft by a quarter. Send Interceptors on attack-move with a strike and they take on
            the fighters that come up to meet it.
          </p>
          <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: UI.textSoft, lineHeight: 1.5 }}>
            With development lines (the default for a new advanced skirmish), research is five lines: Logistics, Armour, Engines,
            Weapons and Air, all on the build window's Research tab. Each has three marks, researched in order. At the top of each
            line you adopt one of two doctrines and the other closes for the rest of the battle. Research also unlocks modules: on
            the build window's Vehicles tab, under the tree, set a loadout for each vehicle type, and every one built afterwards
            carries it, for a little more money. Countermeasures is classic research only: in the lines, the Air line's Armoured
            cockpits doctrine does its job and more.
          </p>
          <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: UI.textSoft, lineHeight: 1.5 }}>
            A new battle starts with its game size. Quick is the original pace. Standard, Long and Epic give both sides more time
            before the waves come, and with development lines make research cheaper and quicker, so Mk II and the doctrines
            come within reach. Long and Epic are also played on a Large and a Huge map. Every size, and the map size on its own,
            can be changed in Customise.
          </p>
          <Grid kinds={AIR_MENU} />
        </Panel>
        <Panel title="Naval">
          <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: UI.textSoft, lineHeight: 1.5 }}>
            Advanced tech, on a map with open sea (the Coast map has one between the bases). Build a Naval Yard on the shore and
            its ships sail open water only. Patrol Boats are fast and their machine guns reach aircraft too; Destroyers carry the
            deck gun and the sonar that finds Submarines seven tiles off; Submarines are unseen until close, or until they fire, and
            their torpedoes hit ships alone; the Battleship shells the shore from eleven tiles out. Anything that hits the ground
            hits a ship, so turrets on the beach defend a coast. For a landing, right-click a Landing Craft beside the shore with
            infantry or vehicles selected (a vehicle takes two of its six places), sail it to the enemy's beach and press Unload (F).
            Ships beside your Naval Yard are mended for nothing.
          </p>
          <Grid kinds={NAVAL_MENU} />
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

// round5:D begin. Neutral sites and tier three: the panel, from the same numbers the battle reads.
const seconds = (ticks: number) => `${ticks / TICKS_PER_SECOND} second${ticks === TICKS_PER_SECOND ? '' : 's'}`;
const SITE_EFFECT: Record<(typeof SITE_KINDS)[number], string> = {
  derrick: `${DERRICK_INCOME} credits every ${seconds(DERRICK_TICKS)} to its holder: ${(DERRICK_INCOME * 600) / DERRICK_TICKS} a minute, half a Hauler's load.`,
  hospital: `${HOSPITAL_HEAL} health every ${seconds(HOSPITAL_TICKS)} to each of its holder's infantry within ${HOSPITAL_RANGE} tiles.`,
  relay: `Its holder and the holder's allies see everything within ${RELAY_RADIUS} tiles of it.`,
};

function SitesPanel() {
  return (
    <Panel title="Neutral sites and tier three">
      <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li>
          Turn on <strong>Neutral sites</strong> in the lobby and every side's share of the map holds the same set of sites, at
          the same distances from every base. They start neutral, with a grey flag.
        </li>
        <li>
          <strong>Infantry take a site</strong>: stand them within {SITE_CAPTURE_RANGE} tiles of it for {seconds(SITE_CAPTURE_TICKS)}{' '}
          and it flies your colours. A ring round the site fills as they work. If an enemy's infantry are there too, the ring
          stops; walk away and it empties again. Vehicles and aircraft cannot take sites, and allies never take each other's.
        </li>
        <li>
          A site is not a structure: nothing can shoot it, it never shoots, and it does not keep you in the battle. A side that is
          out loses its sites, which go back to neutral.
        </li>
      </ul>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
        {SITE_KINDS.map(k => (
          <div key={k} style={{ ...tile, flexDirection: 'column', gap: 4 }}>
            <strong style={{ fontSize: '0.88rem' }}>{SITES[k].name}</strong>
            <span style={{ fontSize: '0.72rem', color: UI.textFaint, fontFamily: FONT.mono }}>
              {MAP_SIZES.map(z => `${MAP_SIZE_NAMES[z]} ${SITES_PER_SIDE[z][k]}`).join(' · ')} per side
            </span>
            <span style={{ fontSize: '0.76rem', color: UI.textSoft, lineHeight: 1.4 }}>{SITE_EFFECT[k]}</span>
          </div>
        ))}
      </div>
      <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li>
          <strong>Tier three</strong> comes with advanced tech. A <strong>{BUILDINGS.protoworks.name}</strong> needs a{' '}
          {BUILDINGS.researchlab.name} and a {BUILDINGS.techcentre.name}, and unlocks the {UNITS.railtank.name}, the{' '}
          {UNITS.stealthtank.name} and the {BUILDINGS.fortress.name}. The {BUILDINGS.protoworks.name} and the{' '}
          {BUILDINGS.fortress.name} are the fifteenth and sixteenth Structures, so they have no hotkey: click them in the build
          list.
        </li>
        <li>
          The <strong>{UNITS.railtank.name}</strong> fires a slug that lands the instant it fires: the heaviest hit on armour in
          the game, and little use against infantry.
        </li>
        <li>
          The <strong>{UNITS.stealthtank.name}</strong> cannot be seen or targeted by an enemy unless one of that enemy's units or
          structures is within {STEALTH_DETECT_RANGE} tiles of it, or for {seconds(STEALTH_REVEAL_TICKS)} after it fires. Yours
          are drawn faint. A recon sweep shows them too.
        </li>
        <li>
          The computer turns to tier three late in a long battle, and on a map with sites sends small parties of infantry to take
          them, the nearest first.
        </li>
      </ul>
    </Panel>
  );
}
// round5:D end.
