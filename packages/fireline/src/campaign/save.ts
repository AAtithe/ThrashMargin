import { HERO_KINDS, type HeroKind } from '../sim/rules';
import { migrateState } from '../sim/state';
import { MISSIONS } from './missions';
import { campaignComplete, cleanCommander, missionsWon, newCampaign, PERKS } from './progression';
import type { CampaignSave, CampaignState, HeroRecord, MissionRecord, PerkId } from './types';

/** Save helpers for a whole campaign in one row. Pure. */
export function isCampaignSave(raw: unknown): raw is CampaignSave {
  return !!raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'campaign';
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function migrateCampaignState(raw: unknown, fallbackName: string): CampaignState {
  const fresh = newCampaign(fallbackName);
  if (!raw || typeof raw !== 'object') return fresh;
  const c = raw as Partial<CampaignState>;
  const cmd = (c.commander ?? {}) as Partial<CampaignState['commander']>;

  const perks: Partial<Record<PerkId, number>> = {};
  const rawPerks = (cmd.perks ?? {}) as Record<string, unknown>;
  for (const p of PERKS) {
    const l = Math.floor(num(rawPerks[p.id], 0));
    if (l > 0) perks[p.id] = Math.min(l, p.maxLevel);
  }

  const heroes = {} as Record<HeroKind, HeroRecord>;
  const rawHeroes = (c.heroes ?? {}) as Partial<Record<HeroKind, Partial<HeroRecord>>>;
  for (const k of HERO_KINDS) {
    const h = rawHeroes[k] ?? {};
    heroes[k] = { unlocked: h.unlocked === true, xp: Math.max(0, num(h.xp, 0)), wounded: h.wounded === true };
  }

  const missions: Record<string, MissionRecord> = {};
  const rawMissions = (c.missions ?? {}) as Record<string, Partial<MissionRecord>>;
  for (const [id, m] of Object.entries(rawMissions)) {
    if (!m || typeof m !== 'object') continue;
    missions[id] = {
      won: m.won === true,
      stars: Math.max(0, Math.floor(num(m.stars, 0))),
      bestTicks: typeof m.bestTicks === 'number' && Number.isFinite(m.bestTicks) ? m.bestTicks : null,
    };
  }

  return {
    version: 1,
    commander: {
      name: cleanCommander(cmd.name ?? fallbackName),
      xp: Math.max(0, num(cmd.xp, 0)),
      points: Math.max(0, Math.floor(num(cmd.points, 0))),
      perks,
    },
    heroes,
    missions,
    tech: Array.isArray(c.tech) ? c.tech.filter((t): t is CampaignState['tech'][number] => typeof t === 'string') : [],
    lastMission: typeof c.lastMission === 'string' ? c.lastMission : null,
  };
}

/** A save from an older build, made current; null if it is not a campaign. */
export function migrateCampaignSave(raw: unknown): CampaignSave | null {
  if (!isCampaignSave(raw)) return null;
  const s = raw as Partial<CampaignSave>;
  if (typeof s.id !== 'string' || !s.id) return null;
  const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 40) : 'Campaign';
  const campaign = migrateCampaignState(s.campaign, name);
  const battle = s.battle ? migrateState(s.battle) : null;
  return {
    version: 1,
    kind: 'campaign',
    id: s.id,
    name,
    createdAt: num(s.createdAt, 0),
    campaign,
    battle,
  };
}

export function newCampaignSave(id: string, name: string, commanderName: string, createdAt: number): CampaignSave {
  return {
    version: 1,
    kind: 'campaign',
    id,
    name: (name || '').trim().slice(0, 40) || 'Campaign',
    createdAt,
    campaign: newCampaign(commanderName),
    battle: null,
  };
}

/** What the saves list shows for a campaign: missions won in `turn`, victory once the last is won. */
export function campaignSaveStatus(s: CampaignSave): 'active' | 'victory' {
  return campaignComplete(s.campaign) ? 'victory' : 'active';
}
export function campaignSaveTurn(s: CampaignSave): number {
  return missionsWon(s.campaign);
}
/** Number of missions in the campaign, for "3 of 8" in the saves list. */
export const CAMPAIGN_LENGTH = MISSIONS.length;
