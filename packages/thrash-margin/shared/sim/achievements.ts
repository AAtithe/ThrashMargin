/**
 * Achievements for faction 1. Checked against counters on `FactionState.stats`, not by scanning
 * the log: the prototype grepped log text, and the log is capped, so a long game could forget a
 * capture it had already counted, and renaming a log line silently broke an achievement.
 */
import { BUILDINGS, TECH_BRANCHES, TECH_TREE } from './content';
import type { GameState } from './types';
import { PLAYER } from './types';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  check: (s: GameState) => boolean;
}

const me = (s: GameState) => s.factions[PLAYER];
const owned = (s: GameState) => s.nodes.filter(n => n.owner === PLAYER);
const countBuilding = (s: GameState, family: string) =>
  owned(s).reduce((sum, n) => sum + n.buildings.filter(b => BUILDINGS[b].family === family).length, 0);
const won = (s: GameState) => s.status === 'victory' && s.winner === PLAYER;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_blood',       name: 'First Blood',       desc: 'Win your first battle.',                     check: s => me(s).stats.battlesWon >= 1 },
  { id: 'diplomat',          name: 'Pacifist Diplomat', desc: 'Annex 3 territories peacefully.',            check: s => me(s).stats.annexed >= 3 },
  { id: 'scholar',           name: 'Scholar',           desc: 'Research 6 technologies.',                   check: s => me(s).research.length >= 6 },
  { id: 'grandmaster',       name: 'Grandmaster',       desc: 'Complete a tech branch.',                    check: s => Object.values(TECH_BRANCHES).some(ids => ids.every(id => me(s).research.includes(id))) },
  { id: 'hoarder',           name: 'Hoarder',           desc: 'Hold 400 gold at once.',                     check: s => me(s).resources.gold >= 400 },
  { id: 'conqueror',         name: 'Conqueror',         desc: 'Hold 15 territories at once.',               check: s => owned(s).length >= 15 },
  { id: 'regicide',          name: 'Regicide',          desc: 'Take a rival capital.',                      check: s => me(s).stats.capitalsTaken >= 1 },
  { id: 'speed_run',         name: 'Blitz',             desc: 'Win in 15 turns or fewer.',                  check: s => won(s) && s.turn <= 15 },
  { id: 'tech_savant',       name: 'Tech Savant',       desc: 'Research all 12 technologies.',              check: s => me(s).research.length >= TECH_TREE.length },
  { id: 'warmonger',         name: 'Warmonger',         desc: 'Eliminate 2 rival factions.',                check: s => Object.values(s.factions).filter(f => f.id !== PLAYER && f.eliminated).length >= 2 },
  { id: 'economic_victory',  name: 'Merchant Prince',   desc: 'Win an economic victory.',                   check: s => won(s) && s.victoryType === 'economic' },
  { id: 'research_victory',  name: 'Renaissance',       desc: 'Win a research victory.',                    check: s => won(s) && s.victoryType === 'research' },
  { id: 'brutal_win',        name: 'Ironclad',          desc: 'Win on Brutal.',                             check: s => won(s) && s.config.diff === 'brutal' && !s.config.hotseat },
  { id: 'peacemaker',        name: 'Peacemaker',        desc: 'Broker 3 ceasefires in one game.',           check: s => me(s).stats.ceasefires >= 3 },
  { id: 'grand_conqueror',   name: 'Grand Conqueror',   desc: 'Win on the Grand Continent.',                check: s => won(s) && s.config.mapId === 'grand_continent' },
  { id: 'fortress',          name: 'Fortress Builder',  desc: 'Have 5 towers or fortresses at once.',       check: s => countBuilding(s, 'tower') >= 5 },
  { id: 'trading_empire',    name: 'Trading Empire',    desc: 'Have 5 markets or grand markets at once.',   check: s => countBuilding(s, 'market') >= 5 },
  { id: 'tutorial_complete', name: 'Tutorial Graduate', desc: 'Win the tutorial.',                          check: s => won(s) && s.config.mapId === 'tutorial' },
  { id: 'stronghold_king',   name: 'Stronghold King',   desc: 'Hold 2 strongholds at once.',                check: s => owned(s).filter(n => n.stronghold).length >= 2 },
  { id: 'hotseat_winner',    name: 'Champion',          desc: 'Win a hot seat game as Player 1.',           check: s => won(s) && s.config.hotseat },
  { id: 'adventurer',        name: 'Adventurer',        desc: 'Win on a random map.',                       check: s => won(s) && s.config.mapId === 'random' },
  { id: 'no_starve',         name: 'Well Fed',          desc: 'Win without a single troop starving.',      check: s => won(s) && me(s).stats.starved === 0 },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));
