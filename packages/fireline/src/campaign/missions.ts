import type { BuildingKind, UnitKind } from '../sim/rules';
import type { MissionSpec, SpawnSpec } from '../sim/types';
import { ACT_TWO } from './act2';

/**
 * The campaign, in order: the Meridian Corps against the Ashen Combine.
 *
 * Maps are generated from each mission's seed exactly as a skirmish map is (side 0 bottom-left,
 * side 1 top-right). Every coordinate below (reach and hold points, trigger spawns and their
 * targets) was picked on the map its seed generates and is checked by `scripts/campaign-check.ts`:
 * in bounds, on passable ground, with the tiles around it passable too. Change a seed and the
 * check will tell you which points need moving.
 *
 * Times are in ticks: ten a second, 600 a minute.
 */

const MIN = 600;

const n = (kind: UnitKind, count: number): UnitKind[] => Array.from({ length: count }, () => kind);

/** Every structure and unit side 0 can ever build, for the last two missions. */
const ALL_TECH: (BuildingKind | UnitKind)[] = [
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

export const MISSIONS: MissionSpec[] = [
  // 1 ------------------------------------------------------------------------------------------
  {
    id: 'first-light',
    order: 1,
    title: 'First Light',
    briefing: [
      'Commander, welcome to the Meridian Corps. The Ashen Combine has pushed a small outpost across the Varn valley, and Command wants it gone before it grows roots.',
      'You have a Command Yard, a little money and three riflemen. Raise a Generator, then a Refinery, and get ore moving. Barracks and Gun Turrets are cleared for this operation.',
      'The outpost is lightly held: a Generator, a Barracks and two turrets in the north-east. Take your time, build up, then break it.',
    ],
    summary: 'Build a base and break a small Combine outpost.',
    seed: 'first-light',
    difficulty: 'easy',
    player: { credits: 4000, structures: ['hq'], units: n('rifleman', 3), heroes: [] },
    enemy: {
      credits: 0,
      base: 'outpost',
      structures: ['power', 'barracks', 'turret', 'turret'],
      units: n('rifleman', 4),
      ai: 'passive',
    },
    tech: ['power', 'refinery', 'barracks', 'turret', 'rifleman', 'rocketeer'],
    powers: [],
    objectives: [{ kind: 'destroyAll' }],
    bonus: [
      { kind: 'build', building: 'refinery', count: 2 },
      { kind: 'harvest', credits: 3000 },
    ],
    triggers: [
      {
        at: 2 * MIN + 30 * 10,
        spawn: { owner: 0, kind: 'rifleman', count: 2, x: 3.5, y: 36.5, order: 'guard' },
        say: 'Two riflemen have walked in from the western road. They are yours, Commander.',
      },
      {
        at: 5 * MIN,
        spawn: enemyWave('rifleman', 3, 50.5, 14.5, 12.5, 50.5),
        say: 'Combine riflemen are probing our lines. Turrets would not go amiss.',
      },
    ],
    rewards: { xp: 150, unlockTech: ['factory', 'hauler', 'buggy', 'tank'] },
  },

  // 2 ------------------------------------------------------------------------------------------
  {
    id: 'quiet-man',
    order: 2,
    title: 'The Quiet Man',
    briefing: [
      'No base this time. Command is lending you an agent it will not name. The Combine cannot see him unless their troops come within a couple of paces.',
      'Their outpost relays orders through a Comms Uplink. Walk the Spy inside it, then bring him out to the extraction point in the far north-west. Four riflemen will cover him, but they are not quiet and they are not subtle.',
      'Lose the Spy and the operation is over. If he has the time, their Refinery and Generator are worth a visit too.',
    ],
    summary: 'Slip the Spy into the outpost Uplink and get him out.',
    seed: 'quiet-man',
    difficulty: 'easy',
    player: { credits: 0, structures: [], units: n('rifleman', 4), heroes: ['spy'] },
    enemy: {
      credits: 1500,
      base: 'outpost',
      structures: ['power', 'refinery', 'barracks', 'uplink', 'turret', 'turret'],
      units: [...n('rifleman', 6), 'rocketeer'],
      ai: 'passive',
    },
    tech: [],
    powers: [],
    objectives: [
      { kind: 'infiltrate', building: 'uplink' },
      { kind: 'reach', who: 'spy', x: 3.5, y: 5.5, r: 2 },
      { kind: 'keepAlive', hero: 'spy' },
    ],
    bonus: [
      { kind: 'infiltrate', building: 'refinery' },
      { kind: 'infiltrate', building: 'power' },
    ],
    timeLimit: 15 * MIN,
    triggers: [
      {
        at: 2 * MIN,
        spawn: { owner: 1, kind: 'rifleman', count: 3, x: 50.5, y: 14.5, order: 'guard' },
        say: 'A Combine patrol has taken up position on the eastern road. Go round, or go quietly.',
      },
      {
        afterObjective: 0,
        spawn: enemyWave('buggy', 2, 55.5, 20.5, 3.5, 5.5),
        say: 'We are reading their traffic. They know something is wrong: buggies are out. Get him to the extraction point.',
      },
    ],
    rewards: { xp: 200, unlockHeroes: ['spy'] },
  },

  // 3 ------------------------------------------------------------------------------------------
  {
    id: 'hold-the-ford',
    order: 3,
    title: 'Hold the Ford',
    briefing: [
      'The Combine wants the river crossing at Halden, and our forward base sits right on it. Their main column is eight minutes out. Until it is turned back, the raids will not stop.',
      'You have a base, two tanks and some infantry, and the War Factory is cleared. Dig in. Raids will come down the north road, along the eastern bank and over the shallows.',
      'Hold for eight minutes. Engineering would like to see three turrets on that line, and Supply wants the refineries kept busy.',
    ],
    summary: 'A base under siege: survive eight minutes of raids.',
    seed: 'hold-the-ford',
    difficulty: 'normal',
    player: {
      credits: 2500,
      structures: ['hq', 'power', 'refinery', 'barracks'],
      units: [...n('tank', 2), ...n('rifleman', 4), ...n('rocketeer', 2)],
      heroes: [],
    },
    enemy: {
      credits: 3000,
      base: 'full',
      structures: ['power', 'power', 'refinery', 'barracks', 'factory', 'turret', 'turret'],
      units: [...n('rifleman', 4), ...n('buggy', 2)],
      ai: 'raid',
    },
    tech: ['power', 'refinery', 'barracks', 'factory', 'turret', 'rifleman', 'rocketeer', 'hauler', 'buggy', 'tank'],
    powers: [],
    objectives: [{ kind: 'survive', ticks: 8 * MIN }],
    bonus: [
      { kind: 'build', building: 'turret', count: 3 },
      { kind: 'harvest', credits: 4000 },
    ],
    triggers: [
      { at: 90 * 10, spawn: enemyWave('buggy', 2, 50.5, 12.5, 12.5, 50.5), say: 'Raiders on the north road!' },
      { at: 3 * MIN, spawn: enemyWave('tank', 2, 58.5, 29.5, 12.5, 50.5), say: 'Combine tanks along the eastern bank.' },
      {
        at: 4 * MIN + 30 * 10,
        spawn: enemyWave('rocketeer', 4, 29.5, 5.5, 12.5, 50.5),
        say: 'Rocket teams wading the shallows. Riflemen will see them off.',
      },
      {
        at: 5 * MIN,
        spawn: { owner: 0, kind: 'tank', count: 2, x: 3.5, y: 38.5, order: 'guard' },
        say: 'Two tanks from the reserve have reached you from the west. Use them well.',
      },
      { at: 6 * MIN, spawn: enemyWave('tank', 3, 50.5, 12.5, 12.5, 50.5), say: 'Heavy armour coming down the north road.' },
      { at: 7 * MIN, spawn: enemyWave('buggy', 4, 58.5, 29.5, 20.5, 44.5), say: 'One last push. Hold them, Commander.' },
    ],
    rewards: { xp: 250, unlockTech: ['uplink', 'artillery'] },
  },

  // 4 ------------------------------------------------------------------------------------------
  {
    id: 'demolition',
    order: 4,
    title: 'Demolition',
    briefing: [
      'Three Generators power the Combine outpost at Ferris Cut, and everything on that hill runs off them. Command is sending in a specialist.',
      'The Commando cuts down infantry at range and carries demolition charges that bring a structure down three seconds after they are planted. Take out all three Generators, then get him to the extraction point in the south-east.',
      'A small squad goes with him. Their Gun Turrets outrange him: let the squad draw their fire, or come round to the north-east, beyond their reach. The Commando must come home.',
    ],
    summary: 'Bring down three Generators with the Commando, then extract.',
    seed: 'demolition',
    difficulty: 'normal',
    player: { credits: 0, structures: [], units: [...n('rifleman', 4), ...n('rocketeer', 2)], heroes: ['commando'] },
    // A fixed garrison the Commando picks apart (passive: it trains nothing). On 'defend' it ran its
    // refinery and trained a rifleman every five seconds, and the mission could not be won.
    enemy: {
      credits: 0,
      base: 'outpost',
      structures: ['power', 'power', 'power', 'barracks', 'refinery', 'turret', 'turret'],
      units: [...n('rifleman', 4), ...n('rocketeer', 1)],
      ai: 'passive',
    },
    tech: [],
    powers: [],
    objectives: [
      { kind: 'destroy', building: 'power', count: 3 },
      { kind: 'reach', who: 'commando', x: 58.5, y: 56.5, r: 2 },
      { kind: 'keepAlive', hero: 'commando' },
    ],
    bonus: [
      { kind: 'destroy', building: 'refinery', count: 1 },
      { kind: 'destroy', building: 'turret', count: 2 },
    ],
    timeLimit: 20 * MIN,
    triggers: [
      {
        at: 4 * MIN,
        spawn: { owner: 1, kind: 'rifleman', count: 4, x: 38.5, y: 20.5, order: 'guard' },
        say: 'A Combine squad has dug in on the approach road.',
      },
      {
        afterObjective: 0,
        spawn: enemyWave('rifleman', 5, 6.5, 8.5, 58.5, 56.5),
        say: 'Lights out at Ferris Cut. A Combine squad is making for the extraction point from the north-west: get there first.',
      },
    ],
    rewards: { xp: 300, unlockHeroes: ['commando'] },
  },

  // 5 ------------------------------------------------------------------------------------------
  {
    id: 'borrowed-steel',
    order: 5,
    title: 'Borrowed Steel',
    briefing: [
      'We have the money for a tank column and nowhere to build one. The Combine has a War Factory at Orlen Yard. We are going to borrow it.',
      'The Engineer can take over an enemy structure if he stands beside it for five seconds undisturbed. Three tanks and a squad go with him: clear the turrets and the garrison first, and keep him back until they are down. Beside our tanks he patches them up as they fight. Your troops will not fire on the War Factory unless you order them to.',
      'Capture it, build with the credits we have sent along, then clear the outpost with its own steel. They will want it back. Keep the Engineer alive: nobody else knows how to run that factory.',
    ],
    summary: 'Capture a War Factory with the Engineer, then destroy the outpost.',
    seed: 'borrowed-steel',
    difficulty: 'normal',
    player: { credits: 2400, structures: [], units: [...n('tank', 3), ...n('rifleman', 4), ...n('rocketeer', 2)], heroes: ['engineer'] },
    // Three tanks go in with him, which he repairs as they fight, against a fixed garrison (passive: it
    // trains nothing). As first written, six infantry faced three turrets, two tanks and five riflemen
    // on 'defend', and played by script the Engineer never reached the factory by any way in.
    enemy: {
      credits: 0,
      base: 'outpost',
      structures: ['factory', 'power', 'power', 'barracks', 'refinery', 'turret', 'turret'],
      units: [...n('rifleman', 4), ...n('rocketeer', 1)],
      ai: 'passive',
    },
    tech: ['rifleman', 'rocketeer', 'hauler', 'buggy', 'tank'],
    powers: [],
    objectives: [
      { kind: 'capture', building: 'factory' },
      { kind: 'destroyAll' },
      { kind: 'keepAlive', hero: 'engineer' },
    ],
    bonus: [
      { kind: 'capture', building: 'refinery' },
      { kind: 'capture', building: 'power' },
    ],
    triggers: [
      // The counter-attack comes for the factory once it is taken, from the far west, so the first
      // tanks are off the line before it arrives. At a fixed six minutes it could land before the
      // capture, on a squad still fighting the garrison.
      {
        afterObjective: 0,
        spawn: enemyWave('tank', 2, 2.5, 4.5, 54.5, 12.5),
        say: 'The War Factory is ours and the credits are loaded: start building tanks. Combine armour is coming from the west to take it back.',
      },
    ],
    rewards: { xp: 350, unlockHeroes: ['engineer'] },
  },

  // 6 ------------------------------------------------------------------------------------------
  {
    id: 'ace-of-spades',
    order: 6,
    title: 'Ace of Spades',
    briefing: [
      'Spade Ridge overlooks every road into the Combine heartland. Whoever holds it for the next three minutes holds the valley.',
      'You have a tank column, the Engineer to keep it running, and on loan from the proving grounds, the Ace: a veteran in a prototype tank that outfights anything on the field. Overdrive makes her faster still, for a while.',
      'Take the ridge, hold it for three minutes against everything they send, then go over the top and clear the outpost beyond. A Recon sweep is at your disposal.',
    ],
    summary: 'Hold the ridge for three minutes, then destroy the outpost beyond.',
    seed: 'ace-of-spades',
    difficulty: 'normal',
    player: {
      credits: 0,
      structures: [],
      units: [...n('tank', 3), ...n('buggy', 2), ...n('rocketeer', 2)],
      heroes: ['ace', 'engineer'],
    },
    enemy: {
      credits: 0,
      base: 'outpost',
      structures: ['power', 'power', 'barracks', 'factory', 'refinery', 'turret', 'turret', 'turret'],
      units: [...n('tank', 2), ...n('rifleman', 4)],
      ai: 'defend',
    },
    tech: [],
    powers: ['recon'],
    objectives: [
      { kind: 'holdZone', x: 32.5, y: 32.5, r: 3, ticks: 3 * MIN },
      { kind: 'destroyAll' },
    ],
    bonus: [
      { kind: 'keepAlive', hero: 'ace' },
      { kind: 'destroy', building: 'turret', count: 3 },
    ],
    triggers: [
      { at: 40 * 10, spawn: enemyWave('tank', 2, 52.5, 12.5, 32.5, 32.5), say: 'Armour on the ridge road!' },
      { at: 90 * 10, spawn: enemyWave('rocketeer', 4, 58.5, 24.5, 32.5, 32.5), say: 'Rocket teams climbing the eastern slope.' },
      { at: 150 * 10, spawn: enemyWave('tank', 3, 38.5, 4.5, 32.5, 32.5), say: 'Another column from the north. Hold the line.' },
      {
        afterObjective: 0,
        spawn: { owner: 0, kind: 'tank', count: 2, x: 12.5, y: 50.5, order: 'attackMove', tx: 32.5, ty: 32.5 },
        say: 'Spade Ridge is ours. Two more tanks are coming up behind you: push on and clear the outpost.',
      },
    ],
    rewards: { xp: 400, unlockHeroes: ['ace'] },
  },

  // 7 ------------------------------------------------------------------------------------------
  {
    id: 'blackout',
    order: 7,
    title: 'Blackout',
    briefing: [
      'This is no outpost. The Combine has a full base at Cinder Flats: a Command Yard, a War Factory, refineries and the turrets to guard them. It builds, and it will come for you.',
      'Bring down their War Factory and the rest is a matter of time. The Commando can do it with a single charge if he gets close. Send the Spy into a Generator first and their turrets will fall silent while he works.',
      'Then finish them. If the Spy can walk into their Command Yard, we learn everything they know.',
    ],
    summary: 'Black out a full Combine base and bring down its War Factory.',
    seed: 'blackout',
    difficulty: 'normal',
    player: {
      credits: 5000,
      structures: ['hq', 'power', 'refinery', 'barracks'],
      units: [...n('tank', 2), ...n('rifleman', 3)],
      heroes: ['spy', 'commando'],
    },
    enemy: {
      credits: 5000,
      base: 'full',
      structures: ['power', 'power', 'refinery', 'barracks', 'factory', 'uplink', 'turret', 'turret', 'turret'],
      units: [...n('tank', 2), ...n('rifleman', 4)],
      ai: 'normal',
    },
    tech: ALL_TECH,
    powers: ['recon'],
    objectives: [{ kind: 'destroy', building: 'factory', count: 1 }, { kind: 'destroyAll' }],
    bonus: [
      { kind: 'infiltrate', building: 'power' },
      { kind: 'infiltrate', building: 'hq' },
    ],
    triggers: [
      {
        at: 8 * MIN,
        spawn: enemyWave('tank', 4, 50.5, 14.5, 12.5, 50.5),
        say: 'A Combine armoured column is moving on our base.',
      },
      { afterObjective: 0, say: 'Their War Factory is rubble. No more tanks from Cinder Flats. Finish it.' },
    ],
    rewards: { xp: 500 },
  },

  // 8 ------------------------------------------------------------------------------------------
  {
    id: 'fireline',
    order: 8,
    title: 'Fireline',
    briefing: [
      'Everything comes down to this. The Combine has dug its last stronghold into the Ashen Reach and filled it with all it has left. Its commander is good, fast and well supplied.',
      'You have every hero, every support power and every factory we own. Destroy everything they have.',
      'Bring your people home, Commander. All of them.',
    ],
    summary: 'The finale: every hero, every power, destroy everything.',
    seed: 'fireline',
    difficulty: 'hard',
    player: {
      credits: 6000,
      structures: ['hq', 'power', 'power', 'refinery', 'barracks', 'factory'],
      units: [...n('tank', 3), ...n('rocketeer', 2), ...n('rifleman', 4)],
      heroes: ['spy', 'commando', 'engineer', 'ace'],
    },
    enemy: {
      credits: 8000,
      base: 'full',
      structures: [
        'power',
        'power',
        'power',
        'refinery',
        'refinery',
        'barracks',
        'factory',
        'factory',
        'uplink',
        'turret',
        'turret',
        'turret',
        'turret',
      ],
      units: [...n('tank', 4), ...n('rocketeer', 3)],
      ai: 'normal',
    },
    tech: ALL_TECH,
    powers: ['recon', 'barrage', 'reinforce'],
    objectives: [{ kind: 'destroyAll' }],
    bonus: [
      { kind: 'keepAlive', hero: 'spy' },
      { kind: 'keepAlive', hero: 'commando' },
    ],
    triggers: [
      {
        at: 60 * 10,
        spawn: { owner: 0, kind: 'rocketeer', count: 3, x: 3.5, y: 40.5, order: 'guard' },
        say: 'The last of the reserve has arrived from the west: three rocket teams. There is nothing more behind them.',
      },
      { at: 5 * MIN, spawn: enemyWave('tank', 4, 60.5, 27.5, 12.5, 50.5), say: 'Combine tanks along the eastern flank!' },
      { at: 10 * MIN, spawn: enemyWave('artillery', 3, 50.5, 14.5, 12.5, 50.5), say: 'Enemy artillery moving up. Find it before it finds you.' },
      { at: 15 * MIN, spawn: enemyWave('tank', 6, 43.5, 1.5, 12.5, 50.5), say: 'Their reserve is committed. This is everything they have.' },
    ],
    rewards: { xp: 650 },
  },
  // Act two, missions 9 to 14 (act2.ts), opened by winning mission 8.
  ...ACT_TWO,
];

export function missionById(id: string): MissionSpec | undefined {
  return MISSIONS.find(m => m.id === id);
}
