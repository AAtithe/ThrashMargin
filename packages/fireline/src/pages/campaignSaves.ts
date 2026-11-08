import { isCampaignSave, migrateCampaignSave, newCampaignSave } from '../campaign/save';
import type { CampaignSave } from '../campaign/types';
import type { SaveMeta, useSaves } from '../hooks/useSaves';
import { API, authHeaders } from '../lib/api';
import { readJson } from '../lib/apiReply';
import { migrateState } from '../sim/state';
import type { GameState } from '../sim/types';

/**
 * The campaign half of the saves API, as the screens use it.
 *
 * The campaign workstream adds `createCampaign`, a `load` that can return a CampaignSave and a
 * `save` that takes one to `hooks/useSaves.ts`. When those are present this hands them straight
 * through. Until then (a build without that work merged) it supplies the same three calls itself,
 * so the screens can be built and checked; nothing here outlives that merge in practice.
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

const ENDPOINT = `${API}/api/play/fireline`;
const INDEX_KEY = 'fireline_saves';
const stateKey = (id: string) => `fireline_save_${id}`;

function localId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function writeLocalCampaign(c: CampaignSave): void {
  try {
    localStorage.setItem(stateKey(c.id), JSON.stringify(c));
    const raw = localStorage.getItem(INDEX_KEY);
    const index = (raw ? (JSON.parse(raw) as ListedSave[]) : []).filter(m => m.id !== c.id);
    const meta: ListedSave = {
      id: c.id,
      name: c.name,
      turn: c.battle ? Math.floor(c.battle.tick / 600) : 0,
      status: 'active',
      savedAt: Date.now(),
      kind: 'campaign',
    };
    localStorage.setItem(INDEX_KEY, JSON.stringify([meta, ...index]));
  } catch {
    /* Storage full or blocked: nothing more to do in local mode. */
  }
}

export function campaignSaves(saves: Saves): CampaignSavesApi {
  const own = saves as Saves & Partial<CampaignSavesApi>;
  if (typeof own.createCampaign === 'function') {
    return {
      createCampaign: own.createCampaign,
      load: own.load as CampaignSavesApi['load'],
      save: own.save as CampaignSavesApi['save'],
    };
  }

  const createCampaign = async (name: string, commander: string): Promise<string | null> => {
    if (!saves.cloud) {
      const c = newCampaignSave(localId(), name || 'Campaign', commander || 'Commander', Date.now());
      writeLocalCampaign(c);
      return c.id;
    }
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ mode: 'campaign', name, commander }) });
      const data = await readJson(res);
      return res.ok && data ? (data.gameId as string) : null;
    } catch {
      return null;
    }
  };

  const load = async (id: string): Promise<GameState | CampaignSave | null> => {
    if (!saves.cloud) {
      try {
        const raw = JSON.parse(localStorage.getItem(stateKey(id)) ?? 'null');
        if (isCampaignSave(raw)) return migrateCampaignSave(raw);
      } catch {
        return null;
      }
      return saves.load(id);
    }
    try {
      const res = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
      const data = await readJson(res);
      if (!res.ok || !data) return saves.load(id);
      return isCampaignSave(data.state) ? migrateCampaignSave(data.state) : migrateState(data.state);
    } catch {
      return null;
    }
  };

  const save = (x: GameState | CampaignSave) => {
    if (isCampaignSave(x) && !saves.cloud) writeLocalCampaign(x);
    else saves.save(x as GameState);
  };

  return { createCampaign, load, save };
}
