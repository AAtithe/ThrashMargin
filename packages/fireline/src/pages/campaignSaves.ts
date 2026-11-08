import type { CampaignSave } from '../campaign/types';
import type { LoadedSave, SaveMeta, useSaves } from '../hooks/useSaves';
import type { GameState } from '../sim/types';

/**
 * The campaign half of the saves API, as the screens use it: a narrow view of hooks/useSaves.ts.
 *
 * It began as a stand-in implementation, written while the campaign workstream built the real
 * calls in parallel. Those exist now, so this only passes them through with the types the screens
 * want (load may return a campaign; save takes either kind of save).
 */
export interface CampaignSavesApi {
  createCampaign(name: string, commander: string): Promise<string | null>;
  load(id: string): Promise<GameState | CampaignSave | null>;
  save(x: GameState | CampaignSave): void;
}

type Saves = ReturnType<typeof useSaves>;

/** A saves-list row; `kind` marks a campaign (the server returns `state->>'kind'`). */
export type ListedSave = SaveMeta & { kind?: 'campaign' | string };

export const isCampaignMeta = (m: SaveMeta) => (m as ListedSave).kind === 'campaign';

export function campaignSaves(saves: Saves): CampaignSavesApi {
  return {
    createCampaign: saves.createCampaign,
    load: id => saves.load<LoadedSave>(id),
    save: x => saves.save(x),
  };
}
