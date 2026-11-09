import type { BuildingKind, UnitKind } from '../sim/rules';
import type { MissionSpec, SpawnSpec } from '../sim/types';

/**
 * Act two: the northern theatre (fireline-round4-design.md, section 5). Six missions, orders 9 to
 * 14, opened by winning mission 8. The Combine has fallen back along the northern coast and into
 * the highlands, and brought the heavy arms of the round-3 advanced tech with it.
 *
 * Each mission brings in one or two of those arms, in the enemy's hands first and then the
 * player's: sandbag walls and Grenadiers (9), Medics and the Repair Bay (10), Rocket Turrets and
 * Missile Carriers (11), the Tech Centre and Flame Tanks (12), Bastions and the Strike Command (13),
 * and everything at once in the final assault (14). A mission's own tech list may offer what its
 * rewards unlock, so the player meets a new arm in the mission that introduces it.
 *
 * As in act one, maps come from each mission's seed (side 0 bottom-left, side 1 top-right), and
 * every point below was picked on its generated map. `scripts/campaign-check.ts` checks them all:
 * in bounds, on open ground, and the convoy's route walkable from end to end.
 *
 * Times are in ticks: ten a second, 600 a minute.
 */

const MIN = 600;

const n = (kind: UnitKind, count: number): UnitKind[] => Array.from({ length: count }, () => kind);

/** The original game's structures and units, which every base mission in act two offers. */
const STANDARD: (BuildingKind | UnitKind)[] = [
  'power',
  'refinery',
  'barracks',
  'factory',
  'turret',
  'uplink',
  'rifleman',
  'rocketeer',
  'hauler',
  'buggy',
  'tank',
  'artillery',
];

/** Act two's arms, in the order the missions bring them in. */
const AFTER_9: (BuildingKind | UnitKind)[] = [...STANDARD, 'wall', 'grenadier'];
const AFTER_10: (BuildingKind | UnitKind)[] = [...AFTER_9, 'medic', 'repairbay'];
const AFTER_11: (BuildingKind | UnitKind)[] = [...AFTER_10, 'rocketturret', 'missilecarrier'];
const AFTER_12: (BuildingKind | UnitKind)[] = [...AFTER_11, 'skyhunter', 'techcentre', 'flametank'];
const AFTER_13: (BuildingKind | UnitKind)[] = [...AFTER_12, 'flakcannon', 'bastion', 'strikecommand'];
/** The final assault: the whole air arm and research, met in mission 14. */
const AIR: (BuildingKind | UnitKind)[] = ['helipad', 'researchlab', 'gunship', 'bomber', 'flaktrack'];

const enemyWave = (kind: UnitKind, count: number, x: number, y: number, tx: number, ty: number): SpawnSpec => ({
  owner: 1,
  kind,
  count,
  x,
  y,
  order: 'attackMove',
  tx,
  ty,
});

export const ACT_TWO: MissionSpec[] = [
  // 9 ------------------------------------------------------------------------------------------
  {
    id: 'iron-coast',
    order: 9,
    title: 'Iron Coast',
    briefing: [
      'The Ashen Reach has fallen, but the Combine did not die there. Its survivors have crossed to the northern coast and dug in along the shore at Harrow Sound, behind a new kind of gun.',
      'Rocket Turrets: long range, deadly to armour, weak against infantry. Engineering has answered with sandbag walls to slow their raiders and Grenadiers to crack open their emplacements. Both are cleared for this operation.',
      'Build up, wall in, then clear the shore. Command would like those Rocket Turrets gone quickly, before they are reinforced.',
    ],
    summary: 'Land on the northern coast and clear the Combine from the shore.',
    seed: 'iron-coast',
    difficulty: 'normal',
    player: {
      credits: 4000,
      structures: ['hq', 'power', 'refinery', 'barracks'],
      units: [...n('tank', 2), ...n('rifleman', 4), ...n('rocketeer', 2)],
      heroes: [],
    },
    enemy: {
      credits: 2500,
      base: 'outpost',
      structures: ['power', 'power', 'refinery', 'barracks', 'factory', 'rocketturret', 'rocketturret', 'turret', 'turret'],
      units: [...n('rifleman', 4), ...n('tank', 2)],
      ai: 'raid',
    },
    tech: AFTER_9,
    powers: [],
    objectives: [{ kind: 'destroyAll' }],
    bonus: [
      { kind: 'build', building: 'wall', count: 8 },
      { kind: 'destroyWithin', building: 'rocketturret', count: 2, ticks: 12 * MIN },
    ],
    triggers: [
      { at: 2 * MIN, spawn: enemyWave('buggy', 3, 50.5, 26.5, 12.5, 50.5), say: 'Combine buggies coming along the shore road. Walls would hold them up.' },
      {
        at: 3 * MIN + 30 * 10,
        spawn: { owner: 0, kind: 'grenadier', count: 3, x: 5.5, y: 47.5, order: 'guard' },
        say: 'Three Grenadiers have landed on the western beach. Point them at a Rocket Turret.',
      },
      { at: 6 * MIN, spawn: enemyWave('tank', 3, 50.5, 26.5, 12.5, 50.5), say: 'Combine armour on the shore road.' },
    ],
    rewards: { xp: 700, unlockTech: ['wall', 'grenadier'] },
  },

  // 10 -----------------------------------------------------------------------------------------
  {
    id: 'convoy-north',
    order: 10,
    title: 'Convoy North',
    briefing: [
      'Our forward units in the highlands are running out of everything. Four haulers of supplies are leaving the coast for the depot at Vell Crossing, and the only road north runs past every Combine patrol in the hills.',
      'The convoy follows the road on its own, but you can direct it. The Ace and a tank column will escort it, with the Engineer to keep the haulers running and two Medics, new to the Corps, to patch up the infantry.',
      'Three haulers must reach the depot. All four would be better. There is a Combine outpost in the north-east: leave it alone unless it comes to you.',
    ],
    summary: 'Escort a supply convoy through the highlands to the depot.',
    seed: 'convoy-north',
    difficulty: 'normal',
    player: {
      credits: 0,
      structures: [],
      units: [...n('tank', 3), ...n('rocketeer', 3), ...n('medic', 2)],
      heroes: ['ace', 'engineer'],
    },
    enemy: {
      credits: 1500,
      base: 'outpost',
      structures: ['power', 'barracks', 'factory', 'rocketturret', 'turret', 'turret'],
      units: [...n('rifleman', 4), ...n('rocketeer', 2)],
      ai: 'defend',
    },
    tech: [],
    powers: [],
    objectives: [{ kind: 'escort', x: 22.5, y: 4.5, r: 3, count: 3 }],
    bonus: [
      { kind: 'escort', x: 22.5, y: 4.5, r: 3, count: 4 },
      { kind: 'keepAlive', hero: 'engineer' },
    ],
    timeLimit: 14 * MIN,
    convoy: {
      kinds: n('hauler', 4),
      x: 12.5,
      y: 57.5,
      route: [
        { x: 16.5, y: 46.5 },
        { x: 14.5, y: 35.5 },
        { x: 7.5, y: 28.5 },
        { x: 8.5, y: 19.5 },
        { x: 21.5, y: 17.5 },
        { x: 15.5, y: 13.5 },
        { x: 14.5, y: 8.5 },
        { x: 22.5, y: 4.5 },
      ],
    },
    triggers: [
      // Three Combine posts dug in along the road from the start. The haulers drive straight into
      // them: the escort has to clear each one first, or stop the convoy and wait.
      {
        at: 1,
        spawn: { owner: 1, kind: 'rifleman', count: 4, x: 16.5, y: 40.5, order: 'guard' },
        say: 'Scouts report Combine posts along the road. The haulers will drive straight into them: clear the way, or stop the convoy until you have.',
      },
      { at: 1, spawn: { owner: 1, kind: 'rocketeer', count: 2, x: 8.5, y: 23.5, order: 'guard' } },
      { at: 1, spawn: { owner: 1, kind: 'rifleman', count: 2, x: 8.5, y: 23.5, order: 'guard' } },
      { at: 1, spawn: { owner: 1, kind: 'tank', count: 2, x: 17.5, y: 9.5, order: 'guard' } },
      { at: 1, spawn: { owner: 1, kind: 'rocketeer', count: 2, x: 17.5, y: 9.5, order: 'guard' } },
      { at: 2 * MIN, spawn: enemyWave('buggy', 3, 44.5, 20.5, 8.5, 20.5), say: 'Buggies coming down from the east. They are after the haulers.' },
      { at: 3 * MIN + 30 * 10, spawn: enemyWave('rocketeer', 4, 25.5, 12.5, 15.5, 13.5), say: 'More rocket teams on the ridge above the pass.' },
      { at: 5 * MIN, spawn: enemyWave('tank', 2, 40.5, 5.5, 22.5, 4.5), say: 'Combine tanks heading for the depot. Get there first.' },
    ],
    rewards: { xp: 750, unlockTech: ['medic', 'repairbay'] },
  },

  // 11 -----------------------------------------------------------------------------------------
  {
    id: 'the-long-hold',
    order: 11,
    title: 'The Long Hold',
    briefing: [
      'Graystone Ford is the only crossing of the Vell for forty miles, and the Combine wants it badly. We need it held for four minutes while the main column comes up behind you.',
      'Not four minutes in total: four minutes unbroken. If the Combine stands on the ford with none of ours there, the count starts again.',
      'You have a base south of the river. Rocket Turrets and Missile Carriers are cleared: use them to break their armour before it reaches the water.',
      'The Combine has gunships now. You have three Skyhunters, infantry with anti-air missiles, and can train more: keep them by the ford.',
    ],
    summary: 'Hold Graystone Ford for four unbroken minutes.',
    seed: 'the-long-hold',
    difficulty: 'normal',
    player: {
      credits: 5000,
      structures: ['hq', 'power', 'power', 'refinery', 'barracks', 'factory'],
      units: [...n('tank', 5), ...n('rifleman', 4), ...n('rocketeer', 2), ...n('grenadier', 2), ...n('skyhunter', 3)],
      heroes: [],
    },
    enemy: {
      credits: 5000,
      base: 'full',
      structures: ['power', 'power', 'refinery', 'barracks', 'factory', 'turret', 'turret', 'rocketturret'],
      units: [...n('tank', 2), ...n('rifleman', 4)],
      ai: 'raid',
    },
    tech: [...AFTER_11, 'skyhunter'],
    powers: [],
    objectives: [{ kind: 'holdZone', x: 31.5, y: 32.5, r: 3, ticks: 4 * MIN, reset: true }],
    bonus: [
      { kind: 'build', building: 'rocketturret', count: 2 },
      { kind: 'harvest', credits: 5000 },
    ],
    triggers: [
      { at: 2 * MIN, spawn: enemyWave('tank', 2, 44.5, 18.5, 31.5, 32.5), say: 'Combine tanks moving on the ford.' },
      { at: 4 * MIN, spawn: enemyWave('rifleman', 5, 40.5, 22.5, 31.5, 32.5), say: 'Infantry wading across from the north bank.' },
      { at: 6 * MIN, spawn: enemyWave('tank', 3, 44.5, 18.5, 31.5, 32.5), say: 'Heavier armour on the north road.' },
      { at: 8 * MIN, spawn: enemyWave('buggy', 4, 40.5, 22.5, 31.5, 32.5), say: 'Fast raiders making for the ford.' },
      { at: 3 * MIN, spawn: enemyWave('gunship', 2, 50.5, 8.5, 31.5, 32.5), say: 'Combine gunships inbound on the ford. Skyhunters, eyes up.' },
      { at: 7 * MIN, spawn: enemyWave('gunship', 3, 50.5, 8.5, 31.5, 32.5), say: 'A second flight of gunships from the north.' },
    ],
    rewards: { xp: 800, unlockTech: ['rocketturret', 'missilecarrier', 'skyhunter'] },
  },

  // 12 -----------------------------------------------------------------------------------------
  {
    id: 'firestorm',
    order: 12,
    title: 'Firestorm',
    briefing: [
      'Reconnaissance has found a Strike Command at the Combine base on Cinder Tor. It is fuelling a missile now, and when it launches it will be aimed at us. Their Tech Centre is calling down artillery on anything that gathers in the open.',
      'Destroy the Strike Command, and the Tech Centre with it. The Spy can black out their power; the Commando can bring the Strike Command down with one charge. You now have a Tech Centre of your own to build, and Flame Tanks to burn a way in.',
      'Their first missile will be ready in eight minutes. Stop it if you can. If it flies, keep your structures spread out.',
      'Expect bombers over our base. Flak Cannons are cleared: two or three by the yard will see them off.',
    ],
    summary: 'Destroy the Combine Strike Command before its missiles flatten you.',
    seed: 'firestorm',
    difficulty: 'normal',
    player: {
      credits: 7000,
      structures: ['hq', 'power', 'power', 'refinery', 'refinery', 'barracks', 'factory', 'uplink'],
      units: [...n('flametank', 2), ...n('tank', 2), ...n('rifleman', 4), ...n('grenadier', 2)],
      heroes: ['spy', 'commando'],
    },
    enemy: {
      credits: 4000,
      base: 'full',
      structures: [
        'power',
        'power',
        'power',
        'power',
        'refinery',
        'barracks',
        'factory',
        'uplink',
        'techcentre',
        'strikecommand',
        'turret',
        'turret',
        'rocketturret',
        'rocketturret',
      ],
      units: [...n('tank', 2), ...n('rifleman', 4)],
      ai: 'normal',
    },
    tech: [...AFTER_12, 'flakcannon'],
    powers: ['recon'],
    structurePowers: true,
    objectives: [
      { kind: 'destroyWithin', building: 'strikecommand', count: 1, ticks: 15 * MIN },
      { kind: 'destroy', building: 'techcentre', count: 1 },
    ],
    bonus: [
      { kind: 'destroyWithin', building: 'strikecommand', count: 1, ticks: 8 * MIN },
      { kind: 'infiltrate', building: 'power' },
    ],
    triggers: [
      { at: 5 * MIN, spawn: enemyWave('tank', 3, 50.5, 14.5, 12.5, 50.5), say: 'A Combine armoured column is moving on our base.' },
      { afterObjective: 1, say: 'Their Tech Centre is down. No more barrages from Cinder Tor.' },
      { at: 6 * MIN, spawn: enemyWave('bomber', 1, 56.5, 8.5, 12.5, 50.5), say: 'Bomber over Cinder Tor, heading for our base. Flak Cannons will bring it down.' },
      { at: 10 * MIN, spawn: enemyWave('bomber', 2, 56.5, 8.5, 12.5, 50.5), say: 'Two more bombers on the same line.' },
    ],
    rewards: { xp: 900, unlockTech: ['techcentre', 'flametank', 'flakcannon'] },
  },

  // 13 -----------------------------------------------------------------------------------------
  {
    id: 'bastion-line',
    order: 13,
    title: 'Bastion Line',
    briefing: [
      'The Combine has built a line across the Kessel highlands: Rocket Turrets behind sandbags, with Bastions, their heaviest siege tanks, parked between them. It does not move. It does not have to.',
      'Command has sent you two Bastions of our own and cleared the Strike Command. Break the four Rocket Turrets, then take and hold the ground in front of their base for two minutes so the column can pass.',
      'The Ace leads the armour and the Engineer keeps it running. Their Tech Centre directs their guns: if it falls early, the line will crack faster.',
    ],
    summary: 'Break the Combine line of Rocket Turrets and Bastions.',
    seed: 'bastion-line',
    difficulty: 'normal',
    player: {
      credits: 7000,
      structures: ['hq', 'power', 'power', 'refinery', 'refinery', 'barracks', 'factory', 'uplink', 'techcentre'],
      units: [...n('bastion', 2), ...n('flametank', 2), ...n('tank', 2), ...n('missilecarrier', 2)],
      heroes: ['ace', 'engineer'],
    },
    enemy: {
      credits: 3000,
      base: 'outpost',
      structures: [
        'power',
        'power',
        'power',
        'barracks',
        'factory',
        'uplink',
        'techcentre',
        'rocketturret',
        'rocketturret',
        'rocketturret',
        'rocketturret',
        'turret',
        'turret',
        'wall',
        'wall',
        'wall',
        'wall',
        'wall',
        'wall',
      ],
      units: [...n('bastion', 2), ...n('missilecarrier', 2), ...n('grenadier', 3)],
      ai: 'defend',
    },
    tech: AFTER_13,
    powers: ['recon'],
    structurePowers: true,
    objectives: [
      { kind: 'destroy', building: 'rocketturret', count: 4 },
      { kind: 'holdZone', x: 42.5, y: 24.5, r: 3, ticks: 2 * MIN },
    ],
    bonus: [
      { kind: 'destroyWithin', building: 'techcentre', count: 1, ticks: 15 * MIN },
      { kind: 'keepAlive', hero: 'ace' },
    ],
    triggers: [
      { at: 5 * MIN, spawn: enemyWave('flametank', 2, 50.5, 14.5, 12.5, 50.5), say: 'Combine Flame Tanks coming for our base. Keep them off the structures.' },
      { at: 10 * MIN, spawn: enemyWave('bastion', 2, 50.5, 14.5, 12.5, 50.5), say: 'Two Bastions have left the line and are grinding towards us.' },
      { afterObjective: 0, say: 'The last Rocket Turret is down. Take the ground in front of their base and hold it.' },
    ],
    rewards: { xp: 1000, unlockTech: ['bastion', 'strikecommand'] },
  },

  // 14 -----------------------------------------------------------------------------------------
  {
    id: 'last-light',
    order: 14,
    title: 'Last Light',
    briefing: [
      'This is the Combine, all of it: one fortress on the cliffs at Last Light, with every structure they know how to build and a commander who has learned from every defeat. It will build, it will attack, and it will fire its missiles at you.',
      'You have every hero, every support power and everything our factories can make, the Strike Command included. Destroy everything they have.',
      'Their Strike Command is the first thing to go if you can reach it. And bring the Commando home: we will need him for what comes after.',
      'The whole air arm is yours for this: Helipads, Gunships, Bombers, Flak Tracks and the Research Lab. The Combine will fly everything it has left.',
    ],
    summary: 'The final assault on a full Combine fortress.',
    seed: 'last-light',
    difficulty: 'hard',
    player: {
      credits: 8000,
      structures: ['hq', 'power', 'power', 'power', 'refinery', 'refinery', 'barracks', 'factory', 'uplink', 'techcentre', 'repairbay'],
      units: [...n('bastion', 1), ...n('flametank', 2), ...n('tank', 3), ...n('missilecarrier', 2), ...n('rifleman', 4), ...n('medic', 2)],
      heroes: ['spy', 'commando', 'engineer', 'ace'],
    },
    enemy: {
      credits: 10000,
      base: 'full',
      structures: [
        'power',
        'power',
        'power',
        'power',
        'refinery',
        'refinery',
        'barracks',
        'factory',
        'factory',
        'uplink',
        'techcentre',
        'repairbay',
        'strikecommand',
        // Their air wing: the pads rearm the gunships and bombers that raid us by trigger.
        'power',
        'helipad',
        'helipad',
        'researchlab',
        'flakcannon',
        'flakcannon',
        'rocketturret',
        'rocketturret',
        'turret',
        'turret',
        'turret',
        'wall',
        'wall',
        'wall',
        'wall',
      ],
      units: [...n('bastion', 2), ...n('flametank', 2), ...n('tank', 3), ...n('missilecarrier', 2), ...n('grenadier', 3)],
      ai: 'normal',
    },
    tech: [...AFTER_13, ...AIR],
    powers: ['recon', 'barrage', 'reinforce'],
    structurePowers: true,
    objectives: [{ kind: 'destroyAll' }],
    bonus: [
      { kind: 'destroyWithin', building: 'strikecommand', count: 1, ticks: 10 * MIN },
      { kind: 'keepAlive', hero: 'commando' },
    ],
    triggers: [
      {
        at: 60 * 10,
        spawn: { owner: 0, kind: 'grenadier', count: 4, x: 8.5, y: 47.5, order: 'guard' },
        say: 'Four Grenadiers from the coast garrison have reached you. That is the last of the reserve.',
      },
      { at: 6 * MIN, spawn: enemyWave('flametank', 3, 60.5, 27.5, 12.5, 50.5), say: 'Flame Tanks along the eastern cliffs!' },
      { at: 12 * MIN, spawn: enemyWave('bastion', 3, 50.5, 14.5, 12.5, 50.5), say: 'Their Bastions are moving. This is the last of their armour.' },
      { at: 4 * MIN, spawn: enemyWave('gunship', 3, 60.5, 8.5, 12.5, 50.5), say: 'Gunships off the Combine pads. Get anti-air on the base.' },
      { at: 9 * MIN, spawn: enemyWave('bomber', 2, 60.5, 8.5, 12.5, 50.5), say: 'Bombers on the north approach.' },
      { at: 14 * MIN, spawn: enemyWave('gunship', 4, 60.5, 8.5, 12.5, 50.5), say: 'Their last air wing is up.' },
    ],
    rewards: { xp: 1200, unlockTech: AIR },
  },
];
