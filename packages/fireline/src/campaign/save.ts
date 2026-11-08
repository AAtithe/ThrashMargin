import type { CampaignSave } from './types';

/** CONTRACT STUBS: implemented by the campaign workstream. */
export function isCampaignSave(raw: unknown): raw is CampaignSave {
  return !!raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'campaign';
}

/** A save from an older build, made current; null if it is not a campaign. */
export function migrateCampaignSave(_raw: unknown): CampaignSave | null {
  throw new Error('Not implemented yet: campaign/save.ts migrateCampaignSave');
}

export function newCampaignSave(_id: string, _name: string, _commanderName: string, _createdAt: number): CampaignSave {
  throw new Error('Not implemented yet: campaign/save.ts newCampaignSave');
}
