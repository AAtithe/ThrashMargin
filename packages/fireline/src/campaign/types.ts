import type { BuildingKind, Difficulty, HeroKind, SupportPower, UnitKind } from '../sim/rules';
import type { GameState } from '../sim/types';

/**
 * The campaign's own data: the Commander's career, the hero roster and the record of missions.
 * Pure data, saved as part of a CampaignSave. See fireline-campaign-design.md.
 */

export type PerkBranch = 'economy' | 'industry' | 'command';

export type PerkId =
  | 'logistics' // economy: haulers carry and unload faster (harvest income)
  | 'surveyors' // economy: more starting credits
  | 'assembly' // industry: faster production
  | 'procurement' // industry: cheaper everything
  | 'armour' // command: more unit health
  | 'recon' // command: unlocks the Recon sweep power
  | 'barrage' // command: unlocks the Artillery barrage power
  | 'reinforce' // command: unlocks Reinforcements
  | 'staff'; // command: shorter support power cooldowns

export interface PerkSpec {
  id: PerkId;
  branch: PerkBranch;
  name: string;
  /** What one level does, in words, e.g. "+10% harvest income per level". */
  blurb: string;
  maxLevel: number;
  /** Skill points the next level costs (index = current level). */
  cost: number[];
  /** Must have this perk at this level first. */
  requires?: { perk: PerkId; level: number };
}

export interface HeroRecord {
  unlocked: boolean;
  /** Carried between missions; level is heroLevelFor(xp) in rules.ts. */
  xp: number;
  /** Fell in the last mission: starts the next at half health. */
  wounded: boolean;
}

export interface MissionRecord {
  won: boolean;
  /** Best stars earned, 0..1 + number of bonus objectives. */
  stars: number;
  /** Fastest win, in ticks, or null. */
  bestTicks: number | null;
}

export interface CampaignState {
  version: 1;
  commander: {
    name: string;
    xp: number;
    /** Unspent skill points. */
    points: number;
    perks: Partial<Record<PerkId, number>>;
  };
  heroes: Record<HeroKind, HeroRecord>;
  missions: Record<string, MissionRecord>;
  /**
   * Engagements fought, keyed by region id (campaign/theatre.ts, campaign/territory.ts). A won one
   * holds its region. Never counts as a mission won. A record for a region the theatre no longer
   * has is kept and ignored.
   */
  engagements: Record<string, MissionRecord>;
  /** Tech unlocked by missions so far. */
  tech: (BuildingKind | UnitKind)[];
  /** The mission last opened from the campaign map, for "Continue". */
  lastMission: string | null;
  /** Campaign difficulty (campaign/difficulty.ts): applies to each mission when it is deployed. */
  difficulty: Difficulty;
}

/**
 * One save row holding a whole campaign. `name` is read by the server's saves list;
 * `battle` is the mission in progress, or null between missions. Kind tells it apart from a
 * skirmish GameState.
 */
export interface CampaignSave {
  version: 1;
  kind: 'campaign';
  id: string;
  name: string;
  createdAt: number;
  campaign: CampaignState;
  battle: GameState | null;
}
