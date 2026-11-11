import type { MapType, SideMode } from '../sim/rules';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API, authHeaders } from '../lib/api';
import { readJson, serverFailure } from '../lib/apiReply';
import { getToken } from '../lib/portalAuth';
import { createSaver, SAVE_ERRORS, SAVE_MESSAGES, type Saver } from '../lib/saveQueue';
import { campaignSaveStatus, campaignSaveTurn, isCampaignSave, migrateCampaignSave, newCampaignSave } from '../campaign/save';
import type { CampaignSave } from '../campaign/types';
import { isPlanetSave, migratePlanetSave, newPlanetSave, planetSaveStatus, planetSaveTooLarge, planetSaveTurn, type PlanetSave } from '../planet/save';
import type { LengthPreset } from '../planet/types';
import type { Difficulty } from '../sim/rules';
import { wonBy } from '../sim/sides';
import { createInitialState, migrateState, type NewGameOptions } from '../sim/state';
import type { GameState } from '../sim/types';

/**
 * Saved battles: on the account when signed in (the shared `games` table, `game = 'fireline'`),
 * in this browser's localStorage otherwise (local UI checks only: the lobby requires an account).
 *
 * Unlike the turn-based games, Fireline does not save after every action: the battle advances ten
 * ticks a second. The game screen calls `save` every few seconds of play, on pause, on leaving
 * and when the battle ends. The client is authoritative, the same trust model as every game here.
 */

export const SESSION_EXPIRED =
  'Your sign-in has expired. Use "Sign out" above, then sign in again to reach your saved battles.';

const ENDPOINT = `${API}/api/play/fireline`;
const INDEX_KEY = 'fireline_saves';
const stateKey = (id: string) => `fireline_save_${id}`;

export interface SaveMeta {
  id: string;
  name: string;
  /** Minutes of battle played; for a campaign, missions won; for a planet war, the strategic turn. */
  turn: number;
  status: 'active' | 'victory' | 'defeated';
  savedAt: number;
  /** Present on a campaign or planet war save; absent on a skirmish. */
  kind?: 'campaign' | 'planet';
  /** A planet war's length preset (absent when the server could not read one). */
  preset?: LengthPreset;
  /** The map type a skirmish was drawn on, when it was set up with one. */
  mapType?: MapType;
  /** A battle of three or four sides: how many, and whether as teams. Absent for two sides. */
  sides?: 3 | 4;
  mode?: SideMode;
  /** Round 5: a battle on a larger map. Absent for standard size. */
  size?: 'large' | 'huge';
}

/**
 * What a save row holds: a skirmish battle, a whole campaign or a whole planet war (tell them apart
 * with isCampaignSave and isPlanetSave).
 */
export type LoadedSave = GameState | CampaignSave | PlanetSave;

/** What the lobby's War for the Planet panel sends. Every field is checked again by the server. */
export interface NewPlanetRequest {
  name: string;
  commander: string;
  seed: string;
  preset: LengthPreset;
  options: unknown;
  difficulty: Difficulty;
}

export const PLANET_TOO_LARGE = 'This war is too large to save.';

export const statusOf = (s: GameState): SaveMeta['status'] =>
  s.winner === null ? 'active' : wonBy(s, 0) ? 'victory' : 'defeated';

function metaOf(s: LoadedSave): SaveMeta {
  if (isCampaignSave(s)) {
    return { id: s.id, name: s.name, turn: campaignSaveTurn(s), status: campaignSaveStatus(s), savedAt: Date.now(), kind: 'campaign' };
  }
  if (isPlanetSave(s)) {
    return { id: s.id, name: s.name, turn: planetSaveTurn(s), status: planetSaveStatus(s), savedAt: Date.now(), kind: 'planet', preset: s.planet.options.preset };
  }
  return { id: s.id, name: s.name, turn: Math.floor(s.tick / 600), status: statusOf(s), savedAt: Date.now(), ...(s.mapType ? { mapType: s.mapType } : {}),
    ...(s.players.length > 2 ? { sides: s.players.length as 3 | 4, mode: s.setup?.mode === 'teams' ? ('teams' as const) : ('ffa' as const) } : {}),
    ...(s.setup?.size === 'large' || s.setup?.size === 'huge' ? { size: s.setup.size } : {}),
  };
}

/** Any kind of save, made current; null if it is none of them (or a war that cannot be trusted). */
function migrateAny(raw: unknown): LoadedSave | null {
  if (isCampaignSave(raw)) return migrateCampaignSave(raw);
  if (isPlanetSave(raw)) return migratePlanetSave(raw);
  return migrateState(raw);
}

function readIndex(): SaveMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as SaveMeta[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(s: LoadedSave): void {
  try {
    localStorage.setItem(stateKey(s.id), JSON.stringify(s));
    const meta = metaOf(s);
    const index = [meta, ...readIndex().filter(m => m.id !== s.id)];
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* Storage full or blocked: nothing more to do in local mode. */
  }
}

function localId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function useSaves() {
  const cloud = !!getToken();
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [savesLoaded, setSavesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  const saver = useRef<Saver | null>(null);
  if (!saver.current && cloud) {
    saver.current = createSaver(ENDPOINT, authHeaders, outcome => {
      if (outcome === 'saved') {
        setError(prev => (prev && SAVE_ERRORS.has(prev) ? null : prev));
        setLastSaved(Date.now());
      } else {
        if (outcome === 'expired') setExpired(true);
        setError(outcome === 'expired' ? SESSION_EXPIRED : SAVE_MESSAGES[outcome]);
      }
    });
  }

  const refresh = useCallback(async () => {
    if (!cloud) {
      setSaves(readIndex());
      setSavesLoaded(true);
      return;
    }
    try {
      const res = await fetch(ENDPOINT, { headers: authHeaders() });
      if (res.status === 401) {
        setExpired(true);
        setError(SESSION_EXPIRED);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setSaves(data.saves ?? []);
    } catch {
      /* Non-fatal: the lobby shows what it has. */
    } finally {
      setSavesLoaded(true);
    }
  }, [cloud]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string, opts: Omit<NewGameOptions, 'createdAt'>): Promise<string | null> => {
      setError(null);
      if (!cloud) {
        const s = createInitialState(localId(), name || 'Battle', { ...opts, createdAt: Date.now() });
        writeLocal(s);
        return s.id;
      }
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: authHeaders(),
          // The server validates the setup itself (normaliseSetup); this only carries the choice.
          body: JSON.stringify({ name, seed: opts.seed, difficulty: opts.difficulty, setup: opts.setup }),
        });
        if (res.status === 401) {
          setExpired(true);
          setError(SESSION_EXPIRED);
          return null;
        }
        const data = await readJson(res);
        if (!data) {
          setError(serverFailure('starting the battle', res));
          return null;
        }
        if (!res.ok) {
          setError(data.message ?? 'Could not start the battle.');
          return null;
        }
        return data.gameId as string;
      } catch {
        setError('Network error: the battle could not be started.');
        return null;
      }
    },
    [cloud],
  );

  /** Starts a campaign. Resolves to its id, or null with `error` set. */
  const createCampaign = useCallback(
    async (name: string, commander: string): Promise<string | null> => {
      setError(null);
      if (!cloud) {
        const s = newCampaignSave(localId(), name || 'Campaign', commander, Date.now());
        writeLocal(s);
        setSaves(readIndex());
        return s.id;
      }
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ mode: 'campaign', name, commander }),
        });
        if (res.status === 401) {
          setExpired(true);
          setError(SESSION_EXPIRED);
          return null;
        }
        const data = await readJson(res);
        if (!data) {
          setError(serverFailure('starting the campaign', res));
          return null;
        }
        if (!res.ok) {
          setError(data.message ?? 'Could not start the campaign.');
          return null;
        }
        return data.gameId as string;
      } catch {
        setError('Network error: the campaign could not be started.');
        return null;
      }
    },
    [cloud],
  );

  /**
   * Starts a planet war. Resolves to its id, or null with `error` set. In local mode the save is
   * built here, the clock read in the hook and passed into the pure newPlanetSave.
   */
  const createPlanet = useCallback(
    async (p: NewPlanetRequest): Promise<string | null> => {
      setError(null);
      if (!cloud) {
        const id = localId();
        const seed = typeof p.seed === 'string' ? p.seed.slice(0, 64) : '';
        const s = newPlanetSave(id, p.name || 'War', {
          seedText: seed.trim() ? seed : id,
          preset: p.preset,
          options: p.options,
          difficulty: p.difficulty,
          commander: p.commander,
          createdAt: Date.now(),
        });
        writeLocal(s);
        setSaves(readIndex());
        return s.id;
      }
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            mode: 'planet', name: p.name, commander: p.commander, seed: p.seed, preset: p.preset, options: p.options, difficulty: p.difficulty,
          }),
        });
        if (res.status === 401) {
          setExpired(true);
          setError(SESSION_EXPIRED);
          return null;
        }
        const data = await readJson(res);
        if (!data) {
          setError(serverFailure('starting the war', res));
          return null;
        }
        if (!res.ok) {
          setError(data.message ?? 'Could not start the war.');
          return null;
        }
        return data.gameId as string;
      } catch {
        setError('Network error: the war could not be started.');
        return null;
      }
    },
    [cloud],
  );

  /**
   * Loads one save. At run time it resolves to a skirmish GameState, a CampaignSave or a PlanetSave (or null with
   * `error` set). The type parameter defaults to GameState so skirmish-only callers keep compiling;
   * a caller that can open any passes `LoadedSave` and checks with `isCampaignSave` and `isPlanetSave`.
   */
  const load = useCallback(
    async <T extends LoadedSave = GameState>(id: string): Promise<T | null> => {
      setError(null);
      if (!cloud) {
        try {
          const raw = localStorage.getItem(stateKey(id));
          const s = raw ? migrateAny(JSON.parse(raw)) : null;
          if (!s) setError('That battle could not be found in this browser.');
          return s as T | null;
        } catch {
          setError('That battle could not be read.');
          return null;
        }
      }
      try {
        const res = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
        if (res.status === 401) {
          setExpired(true);
          setError(SESSION_EXPIRED);
          return null;
        }
        const data = await readJson(res);
        if (!data) {
          setError(serverFailure('loading the battle', res));
          return null;
        }
        if (!res.ok) {
          setError(data.message ?? 'Could not load the battle.');
          return null;
        }
        const s = migrateAny(data.state);
        if (!s) {
          setError('This save is from an older version of Fireline and cannot be opened.');
          return null;
        }
        saver.current?.reset(id, data.version);
        return s as T;
      } catch {
        setError('Network error: the battle could not be loaded.');
        return null;
      }
    },
    [cloud],
  );

  /**
   * Saves a skirmish battle, a whole campaign or a whole planet war (with its battle in progress, if
   * any). A war over PLANET_SAVE_MAX_BYTES is not sent: the server would refuse it with 413.
   */
  const save = useCallback(
    (s: LoadedSave) => {
      if (isPlanetSave(s)) {
        if (planetSaveTooLarge(s)) {
          setError(PLANET_TOO_LARGE);
          return;
        }
        setError(prev => (prev === PLANET_TOO_LARGE ? null : prev));
      }
      if (!cloud) {
        writeLocal(s);
        setLastSaved(Date.now());
        return;
      }
      saver.current?.save(s.id, s);
    },
    [cloud],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!cloud) {
        try {
          localStorage.removeItem(stateKey(id));
          localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter(m => m.id !== id)));
        } catch {
          /* ignore */
        }
        setSaves(readIndex());
        return;
      }
      try {
        await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
        setSaves(prev => prev.filter(s => s.id !== id));
      } catch {
        /* ignore */
      }
    },
    [cloud],
  );

  return { cloud, saves, savesLoaded, error, expired, lastSaved, create, createCampaign, createPlanet, load, save, remove, refresh };
}
