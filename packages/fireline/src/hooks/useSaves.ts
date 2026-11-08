import { useCallback, useEffect, useRef, useState } from 'react';
import { API, authHeaders } from '../lib/api';
import { readJson, serverFailure } from '../lib/apiReply';
import { getToken } from '../lib/portalAuth';
import { createSaver, SAVE_ERRORS, SAVE_MESSAGES, type Saver } from '../lib/saveQueue';
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
  /** Minutes of battle played. */
  turn: number;
  status: 'active' | 'victory' | 'defeated';
  savedAt: number;
}

export const statusOf = (s: GameState): SaveMeta['status'] =>
  s.winner === null ? 'active' : s.winner === 0 ? 'victory' : 'defeated';

function readIndex(): SaveMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as SaveMeta[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(s: GameState): void {
  try {
    localStorage.setItem(stateKey(s.id), JSON.stringify(s));
    const meta: SaveMeta = { id: s.id, name: s.name, turn: Math.floor(s.tick / 600), status: statusOf(s), savedAt: Date.now() };
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
          body: JSON.stringify({ name, seed: opts.seed, difficulty: opts.difficulty }),
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

  /** Loads one battle. Resolves to the state, or null with `error` set. */
  const load = useCallback(
    async (id: string): Promise<GameState | null> => {
      setError(null);
      if (!cloud) {
        try {
          const raw = localStorage.getItem(stateKey(id));
          const s = raw ? migrateState(JSON.parse(raw)) : null;
          if (!s) setError('That battle could not be found in this browser.');
          return s;
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
        const s = migrateState(data.state);
        if (!s) {
          setError('This save is from an older version of Fireline and cannot be opened.');
          return null;
        }
        saver.current?.reset(id, data.version);
        return s;
      } catch {
        setError('Network error: the battle could not be loaded.');
        return null;
      }
    },
    [cloud],
  );

  const save = useCallback(
    (s: GameState) => {
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

  return { cloud, saves, savesLoaded, error, expired, lastSaved, create, load, save, remove, refresh };
}
