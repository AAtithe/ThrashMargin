import type { CampaignSave } from '../campaign/types';
import type { LoadedSave, NewPlanetRequest, SaveMeta, useSaves } from '../hooks/useSaves';
import type { PlanetSave } from '../planet/save';
import type { GameState } from '../sim/types';

/**
 * The campaign half of the saves API, as the screens use it: a narrow view of hooks/useSaves.ts.
 *
 * It began as a stand-in implementation, written while the campaign workstream built the real
 * calls in parallel. Those exist now, so this only passes them through with the types the screens
 * want (load may return a campaign or a planet war; save takes any kind of save).
 */
export interface CampaignSavesApi {
  createCampaign(name: string, commander: string): Promise<string | null>;
  createPlanet(p: NewPlanetRequest): Promise<string | null>;
  load(id: string): Promise<GameState | CampaignSave | PlanetSave | null>;
  save(x: GameState | CampaignSave | PlanetSave): void;
}

type Saves = ReturnType<typeof useSaves>;

/** A saves-list row; `kind` marks a campaign or a planet war (the server returns `state->>'kind'`). */
export type ListedSave = SaveMeta & { kind?: 'campaign' | 'planet' | string };

export const isCampaignMeta = (m: SaveMeta) => (m as ListedSave).kind === 'campaign';
export const isPlanetMeta = (m: SaveMeta) => (m as ListedSave).kind === 'planet';

export function campaignSaves(saves: Saves): CampaignSavesApi {
  return {
    createCampaign: saves.createCampaign,
    createPlanet: saves.createPlanet,
    load: id => saves.load<LoadedSave>(id),
    save: x => saves.save(x),
  };
}
